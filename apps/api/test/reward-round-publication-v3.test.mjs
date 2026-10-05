import assert from "node:assert/strict";
import test from "node:test";
import { decodeRoundPublicationV3, decodeRoundPublicationChangeV3 } from "../../../packages/domain/dist/rewards/round-publication-v3.js";
import { rewardRoundPublicationV3 } from "../../../packages/db/dist/rewards/index.js";
import { dispatchRoundPublicationV3 } from "../dist/routes/rewards/round-publication-v3.js";
import { compactRoundCommand } from "../../../demo/rewards/scripts/compact-round-one.mjs";
const id = n => `8e000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const identity = { userId: id(1), sessionId: id(2) }, scope = { chainId: 31337, draftId: id(3), slot: 1, approvalId: id(4), uploadId: id(5), packageHash: "a".repeat(64) };
const fixture = () => ({ schema: "raceson-round-publication-view-v3", ...scope, supported: true, current: true,
  observedAt: "2026-09-10T16:00:00Z", review: { id: id(6), seconds: 86400, startedAt: "2026-09-10T15:00:00Z", endsAt: "2026-09-11T15:00:00Z" },
  publication: null, canPublish: false });
test("historical testnet publication supports only the explicitly selected Privy synthetic pilot", () => {
  const selected={...scope,chainId:10143,draftId:"9a000000-0000-4000-8000-000000000052"};
  const view={...fixture(),...selected};assert.equal(decodeRoundPublicationV3(view,selected).supported,true);
  for(const draftId of [scope.draftId,"8a000000-0000-4000-8000-000000000052"])
    assert.throws(()=>decodeRoundPublicationV3({...view,draftId},{...selected,draftId}));
});
test("publication view reconciles exact scope, server clocks, holds and complete review without implying a payment", () => {
  const v = fixture(); assert.equal(decodeRoundPublicationV3(v, scope).canPublish, false);
  for (const patch of [{ canPublish: true }, { review: { ...v.review, seconds: 0 } }, { publication: { id: id(7), publishedAt: v.observedAt, evidenceHash: `0x${"b".repeat(64)}` } },
    { observedAt: "2026-09-09T12:00:00Z" }, { chainId: 10143 }, { packageHash: "b".repeat(64) }, { privateKey: "not-a-key" }])
    assert.throws(() => decodeRoundPublicationV3({ ...v, ...patch }, scope));
  const ready = { ...v, observedAt: v.review.endsAt, canPublish: true }; assert.equal(decodeRoundPublicationV3(ready, scope).canPublish, true);
  assert.equal(decodeRoundPublicationV3({ ...ready, current: false, canPublish: false }, scope).current, false);
  const pub = { ...ready, canPublish: false, publication: { id: id(7), publishedAt: ready.observedAt, evidenceHash: `0x${"b".repeat(64)}` } };
  assert.equal(decodeRoundPublicationV3(pub, scope).publication.id, id(7));
  assert.throws(() => decodeRoundPublicationV3({ ...v, observedAt: "2026-02-30T12:00:00Z" }, scope));
  const precise = { ...v, review: { ...v.review, startedAt: "2026-09-10T15:00:00.000999Z", endsAt: "2026-09-11T15:00:00.000999Z" },
    observedAt: "2026-09-11T15:00:00.000998Z" };
  assert.equal(decodeRoundPublicationV3(precise, scope).canPublish, false);
});
test("review commands refuse clocks, arbitrary destinations and missing explicit review identity", () => {
  const start = { action: "start", requestId: id(8), reviewId: null, packageHash: scope.packageHash };
  assert.deepEqual(decodeRoundPublicationChangeV3(start), start);
  for (const patch of [{ startedAt: "2026-01-01" }, { reviewSeconds: 0 }, { destination: "0x00" }, { action: "activate" }, { action: "publish" }, { reviewId: id(6) }])
    assert.throws(() => decodeRoundPublicationChangeV3({ ...start, ...patch }));
  compactRoundCommand(["rehearse"]);
  for (const args of [[], ["publish"], ["rehearse", "--network=10143"], ["rehearse", "--key=not-a-key"]]) assert.throws(() => compactRoundCommand(args));
});
test("publication repository validates before RPC and never reflects private provider diagnostics", async () => {
  for (const patch of [{ chainId: 143 }, { slot: 5 }, { packageHash: "" }, { draftId: "bad" }]) {
    let calls = 0; await assert.rejects(rewardRoundPublicationV3(identity, { ...scope, ...patch }, undefined, async () => { calls++; })); assert.equal(calls, 0);
  }
  await assert.rejects(rewardRoundPublicationV3(identity, scope, undefined, async () => { throw Error("private provider diagnostic"); }), { code: "reward_ledger_unavailable" });
  const result = await rewardRoundPublicationV3(identity, scope, undefined, async (name, args) => {
    assert.equal(name, "service_reward_round_publication_v3"); assert.equal(args.p_actor_session_id, identity.sessionId);
    assert.equal(args.p_action, "read"); return { data: fixture(), error: null };
  }); assert.equal(result.review.seconds, 86400);
});
test("demo-only publication route enforces normal Auth, exact body, scope and private responses", async () => {
  async function run({ body, method = "GET", query = "", authError } = {}) {
    const response = {}, calls = [];
    const handled = await dispatchRoundPublicationV3({ method }, response, new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${scope.draftId}/round-publication/1/${scope.approvalId}/${scope.uploadId}/${scope.packageHash}${query}`), {
      config: () => ({ chainId: 31337 }), requireIdentity: async () => { if (authError) throw Error(authError); return identity; },
      readJsonBody: async () => body, applyPrivateSessionHeaders: () => response.private = true,
      sendSuccess: (_, data) => Object.assign(response, { status: 200, data }), sendError: (_, status, code) => Object.assign(response, { status, code }),
      rpc: async (name, args) => { calls.push({ name, args }); return { data: fixture(), error: null }; } });
    return { response, calls, handled };
  }
  const ok = await run(); assert.equal(ok.response.status, 200); assert.equal(ok.response.private, true);
  for (const authError of ["Unauthorized", "Missing bearer token", "Untrusted browser origin"]) {
    const r = await run({ authError }); assert.equal(r.calls.length, 0); assert.equal(r.response.status, authError.startsWith("Untrusted") ? 403 : 401);
  }
  for (const body of [{ action: "activate" }, { action: "publish", requestId: id(8), reviewId: id(6), packageHash: scope.packageHash, officialPublishedAt: 1 }])
    assert.equal((await run({ method: "POST", body })).response.status, 400);
  assert.equal((await run({ query: "?chainId=143" })).response.status, 400);
  assert.equal((await run({ method: "DELETE" })).handled, false);
});
