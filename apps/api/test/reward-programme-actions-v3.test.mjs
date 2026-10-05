import assert from "node:assert/strict";
import test from "node:test";
import { decodeProgrammeActionsV3 as decode, decodeProgrammeActionRequestV3 as request, nextProgrammeActionV3 as next } from "../../../packages/domain/dist/rewards/programme-actions-v3.js";
import { dispatchProgrammeActionsV3 } from "../dist/routes/rewards/programme-actions-v3.js";
const id = n => `8d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { userId: id(1), sessionId: id(2) }, scope = { chainId: 31337, draftId: id(3), slot: 1, approvalId: id(4), uploadId: id(5) };
const fees = { gasLimit: "6000000", maxFeePerGas: "100000000000", maxPriorityFeePerGas: "0", maxGasCostWei: "600000000000000000" };
const execution = () => ({ schema: "raceson-programme-execution-status-v3", ...scope, packageHash: "a".repeat(64), documentHash: "b".repeat(64),
  current: true, campaignAddress: `0x${"3".repeat(40)}`, entitlementCount: "100", steps: [] });
const step = (state = "reserved") => ({ intentId: id(10), step: 0, action: "complete_funding", batchStart: null, batchSize: null, state,
  transactionHash: state === "reserved" ? null : `0x${"1".repeat(64)}`, receipt: state !== "confirmed" ? null : {
    blockNumber: "100", blockHash: `0x${"2".repeat(64)}`, blockTimestamp: "1789030000", feeWei: "100000", recordedAt: "2026-09-10T10:00:00Z" } });
const wire = (state = "reserved") => ({ schema: "raceson-programme-actions-v3", publication: null, execution: { ...execution(), steps: [step(state)] }, selected: {
  intentId: id(10), operatorAddress: `0x${"4".repeat(40)}`, nonce: "12", fees, attemptId: state === "reserved" ? null : id(11),
  jobId: ["reserved", "signed"].includes(state) ? null : id(12) }, ack: null });
const prepare = () => ({ kind: "prepare", requestId: id(10), expectedPredecessorId: null, packageHash: "a".repeat(64), fees });

test("organizer action derives closure then bounded uploads only from confirmed current history", () => {
  assert.deepEqual(next(execution()), { action: "complete_funding", predecessorId: null, batchStart: null, batchSize: null });
  for (const state of ["reserved", "signed", "queued", "leased", "broadcasting", "submitted"]) assert.equal(next(decode(wire(state)).execution), null);
  assert.deepEqual(next(decode(wire("confirmed")).execution), { action: "upload_awards", predecessorId: id(10), batchStart: 0, batchSize: 64 });
  const partial = wire("confirmed"); partial.execution.steps.push({ ...step("confirmed"), intentId: id(20), step: 1,
    action: "upload_awards", batchStart: 0, batchSize: 64, transactionHash: `0x${"3".repeat(64)}` });
  partial.selected.intentId = id(20);
  assert.equal(next(decode(partial).execution).batchSize, 36);
  partial.execution.current = false; assert.equal(next(decode(partial).execution), null);
  const empty = wire("confirmed"); empty.execution.entitlementCount = "0"; assert.equal(next(decode(empty).execution), null);
});
test("strict action projections and requests refuse secrets, accessors, contradictory states and unsafe fees", () => {
  for (const state of ["reserved", "signed", "queued", "leased", "broadcasting", "submitted", "confirmed"]) assert.equal(decode(wire(state)).execution.steps[0].state, state);
  for (const mutate of [v => v.selected.signedTransaction = "never", v => v.selected.fees.privateKey = "never", v => v.ack = {},
    v => v.selected.intentId = id(99), v => v.selected.attemptId = id(11), v => v.selected.jobId = id(12),
    v => v.selected.nonce = "9007199254740992", v => v.selected = null, v => v.execution.steps = [],
    v => v.selected.fees.maxGasCostWei = "1", v => v.selected.fees.gasLimit = "30000001", v => v.selected.fees.maxPriorityFeePerGas = "100000000001"]) {
    const value = structuredClone(wire()); mutate(value); assert.throws(() => decode(value));
  }
  assert.deepEqual(request(prepare()), prepare());
  for (const patch of [{ kind: "activate" }, { signedTransaction: "never" }, { chainId: 143 }, { requestId: "bad" }, { recipient: id(99) }, { expectedPredecessorId: undefined }])
    assert.throws(() => request({ ...prepare(), ...patch }));
  let called = false; const getter = { ...prepare() }; Object.defineProperty(getter, "kind", { enumerable: true, get() { called = true; return "prepare"; } });
  assert.throws(() => request(getter)); assert.equal(called, false);
});
test("publication-bound actions require exact scope and ordered complete uploads, stage and activation", () => {
  const v = wire("confirmed"); v.execution.entitlementCount = "0";
  const p = { schema: "raceson-round-publication-view-v3", ...scope, packageHash: "a".repeat(64), current: true, supported: true,
    observedAt: "2026-09-10T10:00:00Z", review: { id: id(30), seconds: 86400, startedAt: "2026-09-09T09:00:00Z", endsAt: "2026-09-10T09:00:00Z" },
    publication: { id: id(31), publishedAt: "2026-09-10T09:00:01Z", evidenceHash: `0x${"a".repeat(64)}` }, canPublish: false };
  v.publication = p;
  assert.equal(next(decode(v).execution, decode(v).publication).action, "stage_allocation");
  assert.deepEqual(decode(decode(v)), decode(v)); // Server -> JSON -> browser remains decodable.
  for (const patch of [{ packageHash: "b".repeat(64) }, { uploadId: id(99) }, { chainId: 10143 }, { current: false }, { publication: null }])
    assert.equal(next(v.execution, { ...p, ...patch }), null);
  for (const [n, action] of ["stage_allocation", "activate"].entries()) {
    v.execution.steps.push({ ...step("confirmed"), intentId: id(40 + n), step: n + 1, action, transactionHash: `0x${String(6 + n).repeat(64)}` });
    v.selected.intentId = id(40 + n);
    assert.equal(next(decode(v).execution, decode(v).publication)?.action ?? null, n === 0 ? "activate" : null);
  }
  for (const mutate of [x => x.execution.steps[1].action = "activate", x => x.execution.steps[2].action = "stage_allocation",
    x => x.execution.entitlementCount = "1", x => x.execution.steps[1].batchStart = 0, x => x.publication.publication.publishedAt = "2026-09-10T08:59:59Z",
    x => x.publication.uploadId = id(99), x => x.publication.privateKey = "never"]) {
    const bad = structuredClone(v); mutate(bad); assert.throws(() => decode(bad));
  }
  for (const patch of [{ publication: p }, { reviewStartedAt: "1" }, { officialPublishedAt: "1" }]) assert.throws(() => request({ ...prepare(), ...patch }));
});
test("demo action HTTP is authenticated and no-store, supports only read/prepare/queue, and sanitizes failures", async () => {
  const run = async ({ method = "GET", query = "", body, authError, rpcError, drift = false } = {}) => {
    const response = {}, calls = [];
    const handled = await dispatchProgrammeActionsV3({ method }, response,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${scope.draftId}/allocation-actions/1/${scope.approvalId}/${scope.uploadId}${query}`), {
        config: () => ({ chainId: scope.chainId }), requireIdentity: async () => { if (authError) throw Error(authError); return identity; },
        applyPrivateSessionHeaders: () => response.private = true, readJsonBody: async () => { assert.equal(method, "POST"); return body; },
        sendSuccess: (_, data) => Object.assign(response, { status: 200, data }), sendError: (_, status, code) => Object.assign(response, { status, code }),
        rpc: async (name, args) => { calls.push({ name, args }); const data = execution(); if (drift && calls.length > 1) data.current = false;
          return { data, error: rpcError ? { message: rpcError } : null }; } });
    return { response, calls, handled };
  };
  const good = await run(); assert.equal(good.response.status, 200); assert.equal(good.response.private, true); assert.equal(good.response.data.selected, null);
  assert.equal(good.calls.length, 2); assert.ok(good.calls.every(c => c.name === "service_read_reward_programme_execution_status_v3" && c.args.p_actor_session_id === identity.sessionId));
  assert.equal((await run({ drift: true })).response.status, 409);
  for (const authError of ["Unauthorized", "Missing bearer token"]) { const r = await run({ method: "POST", authError }); assert.equal(r.response.status, 401); assert.equal(r.calls.length, 0); }
  assert.equal((await run({ authError: "Untrusted browser origin" })).response.status, 403);
  for (const method of ["PUT", "PATCH", "DELETE"]) assert.equal((await run({ method })).handled, false);
  assert.equal((await run({ query: "?chainId=143" })).response.status, 400);
  for (const kind of ["sign", "send", "activate", "pay", "lease"]) { const r = await run({ method: "POST", body: { kind } }); assert.equal(r.response.status, 400); assert.equal(r.calls.length, 0); }
  for (const patch of [{ requestId: "bad" }, { expectedPredecessorId: "bad" }, { fees: { ...fees, gasLimit: "0" } }]) {
    const r = await run({ method: "POST", body: { ...prepare(), ...patch } }); assert.equal(r.response.status, 400); assert.equal(r.calls.length, 0);
  }
  assert.equal((await run({ rpcError: "reward_allocation_upload_not_found" })).response.status, 404);
  const failure = await run({ rpcError: "private credential-bearing response" }); assert.equal(failure.response.status, 503); assert.doesNotMatch(JSON.stringify(failure.response), /credential-bearing/);
});
