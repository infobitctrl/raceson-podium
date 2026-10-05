import assert from "node:assert/strict";
import test from "node:test";
import { decodeProgrammeExecutionStatusV3 as decode, programmeExecutionProgressV3 as progress } from "../../../packages/domain/dist/rewards/programme-execution-status-v3.js";
import { readProgrammeExecutionStatusV3 as read } from "../../../packages/db/dist/rewards/index.js";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";
const id = n => `8d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { userId: id(1), sessionId: id(2) }, scope = { chainId: 31337, draftId: id(3), slot: 1, approvalId: id(4), uploadId: id(5) };
const wire = () => ({ schema: "raceson-programme-execution-status-v3", ...scope, packageHash: "a".repeat(64), documentHash: "b".repeat(64),
  current: true, campaignAddress: `0x${"3".repeat(40)}`, entitlementCount: "20", steps: [] });
const step = (n, state = "confirmed") => ({ intentId: id(10 + n), step: n, action: n === 0 ? "complete_funding" : "upload_awards",
  batchStart: n === 0 ? null : 0, batchSize: n === 0 ? null : 20, state,
  transactionHash: state === "reserved" ? null : `0x${String(n + 1).repeat(64)}`, receipt: state !== "confirmed" ? null : {
    blockNumber: String(n + 100), blockHash: `0x${String(n + 3).repeat(64)}`, blockTimestamp: "1789030000",
    feeWei: "1000000000000000", recordedAt: "2026-09-10T10:00:00.000Z" } });

test("execution projection derives progress only from ordered confirmed receipts, including held history and empty pots", () => {
  assert.deepEqual(progress(decode(wire())), { fundingClosed: false, uploaded: 0, uploadComplete: false });
  for (const state of ["reserved", "signed", "queued", "leased", "broadcasting", "submitted"])
    assert.equal(progress(decode({ ...wire(), steps: [step(0, state)] })).fundingClosed, false);
  const full = decode({ ...wire(), current: false, steps: [step(0), step(1)] });
  assert.deepEqual(progress(full), { fundingClosed: true, uploaded: 20, uploadComplete: true }); assert.equal(full.current, false);
  assert.deepEqual(progress(decode({ ...wire(), entitlementCount: "0", steps: [step(0)] })), { fundingClosed: true, uploaded: 0, uploadComplete: true });
});
test("strict shared decoder refuses private extras, incomplete receipts, misordered batches and contradictory status", () => {
  const good = () => ({ ...wire(), steps: [step(0), step(1)] });
  for (const mutate of [v => v.privateKey = "never", v => v.chainId = 143, v => v.slot = 7,
    v => v.steps[0].leaseToken = id(999), v => v.steps[0].receipt = null, v => v.steps[1].batchStart = 1,
    v => v.steps[1].batchSize = 21, v => v.steps[0] = step(0, "submitted"), v => v.steps[1].step = 2,
    v => v.steps[1].transactionHash = v.steps[0].transactionHash, v => v.steps[1].receipt.blockNumber = "1",
    v => v.steps[1].receipt.feeWei = "-1", v => v.steps[1].receipt.recordedAt = "tomorrow",
    v => v.steps[1].receipt.signedTransaction = "0x02", v => v.steps[0].transactionHash = null,
    v => v.steps[1].intentId = v.steps[0].intentId, v => delete v.steps[0]]) {
    const v = good(); mutate(v); assert.throws(() => decode(v));
  }
  const v = good(); Object.defineProperty(v, "current", { enumerable: true, get() { throw Error("getter must not run"); } });
  assert.throws(() => decode(v), /invalid_reward_programme_execution_status/);
});
test("final-slot execution projects ordered publication receipts but rejects missing confirmed predecessors", () => {
  for (const slot of [5, 6]) {
    const value = { ...wire(), slot, steps: [step(0), step(1)] };
    assert.equal(progress(decode(value)).uploadComplete, true);
    const stage = { ...step(2), action: "stage_allocation", batchStart: null, batchSize: null };
    const activation = { ...step(3), action: "activate", batchStart: null, batchSize: null };
    assert.equal(decode({ ...value, steps: [...value.steps, stage, activation] }).steps.length, 4);
    assert.throws(() => decode({ ...value, steps: [...value.steps, { ...activation, step: 2 }] }));
    assert.throws(() => decode({ ...value, steps: [...value.steps, { ...stage, state: "submitted", receipt: null }, activation] }));
  }
});
test("repository captures scope before await and refuses mismatched evidence, unsupported networks and private provider errors", async () => {
  const original = { ...scope }, actor = { ...identity };
  const result = await read(actor, original, async () => { original.draftId = id(999); actor.userId = id(999); return { data: wire(), error: null }; });
  assert.equal(result.draftId, scope.draftId);
  for (const patch of [{ chainId: 143 }, { slot: 0 }, { slot: 1.1 }, { uploadId: "zero" }]) {
    let called = false; await assert.rejects(read(identity, { ...scope, ...patch }, () => { called = true; throw Error("must not call"); })); assert.equal(called, false);
  }
  await assert.rejects(read(identity, scope, async () => ({ data: { ...wire(), uploadId: id(8) }, error: null })), { code: "invalid_reward_programme_execution_status" });
  await assert.rejects(read(identity, scope, async () => { throw Error("secret-bearing response"); }), { code: "reward_ledger_unavailable" });
});
test("organizer GET is authenticated, origin checked, no-store and read-only; rejects query/scope drift and sanitized errors", async () => {
  const run = async ({ method = "GET", query = "", authError, rpcError, patch = {}, slot = 1 } = {}) => {
    const response = {}, calls = [];
    const handled = await dispatchRewardPlanningRoutes({ method }, response,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${scope.draftId}/${slot >= 5 ? 'final-' : ''}allocation-execution/${slot}/${scope.approvalId}/${scope.uploadId}${query}`), {
        config: () => ({ chainId: 31337 }), requireIdentity: async () => { if (authError) throw Error(authError); return identity; },
        applyPrivateSessionHeaders: () => response.private = true, readJsonBody: () => { throw Error("read must not consume body"); },
        sendSuccess: (_, data) => Object.assign(response, { status: 200, data }), sendError: (_, status, code) => Object.assign(response, { status, code }),
        rpc: async (name, args) => { calls.push({ name, args }); return { data: { ...wire(), slot, ...patch }, error: rpcError ? { message: rpcError } : null }; } });
    return { handled, response, calls };
  };
  const good = await run(); assert.equal(good.response.status, 200); assert.equal(good.response.private, true);
  for (const slot of [5, 6]) {
    const final = await run({ slot }); assert.equal(final.response.status, 200); assert.equal(final.response.private, true);
    assert.equal(final.calls[0].args.p_slot, slot);
    assert.equal((await run({ slot, method: 'POST' })).handled, false);
    assert.equal((await run({ slot, query: '?chainId=143' })).response.status, 400);
    assert.equal((await run({ slot, authError: 'Unauthorized' })).response.status, 401);
    assert.equal((await run({ slot, authError: 'Untrusted browser origin' })).response.status, 403);
  }
  assert.equal(good.calls[0].name, "service_read_reward_programme_execution_status_v3");
  assert.equal(good.calls[0].args.p_actor_session_id, identity.sessionId); assert.deepEqual(good.response.data, wire());
  for (const method of ["POST", "PATCH", "DELETE"]) { const r = await run({ method }); assert.equal(r.handled, false); assert.equal(r.calls.length, 0); }
  for (const authError of ["Unauthorized", "Missing bearer token"]) { const r = await run({ authError }); assert.equal(r.response.status, 401); assert.equal(r.calls.length, 0); }
  assert.equal((await run({ authError: "Untrusted browser origin" })).response.status, 403);
  assert.equal((await run({ query: "?chainId=143" })).response.status, 400);
  assert.equal((await run({ rpcError: "reward_allocation_upload_not_found" })).response.status, 404);
  assert.equal((await run({ rpcError: "reward_planning_revision_changed" })).response.status, 409);
  assert.equal((await run({ patch: { privateKey: "not-for-browser" } })).response.status, 503);
  const failed = await run({ rpcError: "credential-bearing upstream error" }); assert.equal(failed.response.status, 503);
  assert.doesNotMatch(JSON.stringify(failed.response), /credential-bearing/);
});
