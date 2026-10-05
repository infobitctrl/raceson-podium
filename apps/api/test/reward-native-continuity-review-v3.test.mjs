import assert from "node:assert/strict";
import test from "node:test";
import { nativeContinuityReviewV3, previewNativeFinaleContinuityV3 } from "../dist/features/rewards/native-finale-continuity-service.js";
import { decodeNativeContinuityChangeV3, decodeNativeContinuityViewV3 } from "../../../packages/domain/dist/rewards/native-finale-continuity-v3.js";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";
import { nativeContinuityFixture } from "./fixtures/native-finale-continuity-v3.mjs";
import { nativeId as n } from "./fixtures/native-finale-v3.mjs";
const identity = { userId: n(800), sessionId: n(801) };
function transport() {
  const f = nativeContinuityFixture(), decisions = new Map(), calls = [];
  const data = { historical: { record: f.record, workspace: f.workspace, snapshot: f.snapshot, sourceHash: "c".repeat(64),
    contextHash: f.historicalContextHash, decisions: f.historicalDecisions, observedAt: f.native.observedAt, recordedDecision: null },
    native: f.native, guardHash: "d".repeat(64), labels: { athletes: [], clubs: [] }, review: null, recordedReview: null };
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === "service_review_reward_native_continuity_v3") {
      assert.equal(args.p_source_guard_hash, data.guardHash);
      assert.deepEqual(JSON.parse(args.p_context_text), previewNativeFinaleContinuityV3(f).context);
      const contextHash = previewNativeFinaleContinuityV3(f).contextHash;
      data.review = { id: args.p_request_id, previousReviewId: args.p_expected_review_id, contextHash, selection: args.p_selection,
        decision: args.p_decision, reviewedAt: "2026-09-10T04:45:00.000Z" };
      decisions.set(data.review.id, structuredClone(data.review));
    }
    return { error: null, data: structuredClone({ ...data, recordedReview: decisions.get(args.p_request_id) ?? null }) };
  };
  const run = c => nativeContinuityReviewV3(identity, 31337, f.record.draftId, c, rpc);
  const change = { requestId: n(802), expectedReviewId: null, contextHash: previewNativeFinaleContinuityV3(f).contextHash, selection: f.selection, decision: "confirmed" };
  return { f, data, calls, rpc, run, change };
}
test("private continuity projection exposes choices, seven categories and retained/proposed totals only", async () => {
  const t = transport(), view = await t.run();
  assert.equal(view.options.categories.length, 7); assert.equal(view.options.athletes.length, 6); assert.equal(view.proposedWei, "0");
  assert.deepEqual(decodeNativeContinuityViewV3(view), view);
  assert.doesNotMatch(JSON.stringify(view), /snapshot|guardHash|nativeSourceHash|sourceOrigin|finishTimeMs|context_text/);
  const confirmed = await t.run(t.change); assert.equal(confirmed.reviewState, "confirmed_selection"); assert.ok(BigInt(confirmed.proposedWei) > 0n);
  assert.equal(confirmed.payableWei, "0"); assert.equal(t.calls.filter(c => c.name.startsWith("service_review")).length, 1);
  const held = await t.run({ ...t.change, requestId: n(803), expectedReviewId: n(802), decision: "held" });
  assert.equal(held.reviewState, "held"); assert.equal(held.proposedWei, "0");
  const retry = await t.run(t.change); assert.equal(retry.recordedReview.id, n(802)); assert.equal(retry.review.id, n(803));
  assert.equal(t.calls.filter(c => c.name.startsWith("service_review")).length, 2);
});
test("review API refuses incomplete choices, changed requests, foreign context and private extras", async () => {
  const t = transport();
  await assert.rejects(t.run({ ...t.change, selection: { ...t.change.selection, athletes: [] } }), { code: "reward_continuity_not_ready" });
  await assert.rejects(t.run({ ...t.change, contextHash: "f".repeat(64) }), { code: "reward_planning_revision_changed" });
  for (const extra of [{ wallet: "secret" }, { officialPublishedAt: "2026-09-01" }, { amount: "10000" }])
    assert.throws(() => decodeNativeContinuityChangeV3({ ...t.change, ...extra }));
  await t.run(t.change); await assert.rejects(t.run({ ...t.change, decision: "held" }), { code: "reward_continuity_conflict" });
  t.data.native.document.races[0].rows[0].finishTimeMs = "1900000";
  const stale = await t.run(); assert.equal(stale.reviewState, "stale"); assert.equal(stale.proposedWei, "0");
});
test("continuity HTTP authenticates and accepts only choices, with sanitized errors and no query overrides", async () => {
  const t = transport();
  async function request({ method = "GET", body, query = "", authError, rpc = t.rpc } = {}) {
    const res = {}, handled = await dispatchRewardPlanningRoutes({ method }, res,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${t.f.record.draftId}/native-continuity${query}`), {
        config: () => ({ chainId: 31337 }), requireIdentity: async () => { if (authError) throw Error(authError); return identity; }, rpc,
        readJsonBody: async () => body, applyPrivateSessionHeaders: () => res.private = true,
        sendSuccess: (_, data) => Object.assign(res, { status: 200, data }), sendError: (_, status, code) => Object.assign(res, { status, code }) });
    return { ...res, handled };
  }
  assert.equal((await request()).status, 200); assert.equal((await request()).private, true);
  assert.equal((await request({ method: "PATCH" })).handled, false);
  assert.equal((await request({ query: "?chainId=1" })).status, 400);
  assert.equal((await request({ authError: "Unauthorized" })).status, 401);
  assert.equal((await request({ method: "POST", body: { ...t.change, snapshot: t.f.snapshot } })).status, 400);
  assert.equal((await request({ method: "POST", body: t.change })).data.reviewState, "confirmed_selection");
  const failed = await request({ rpc: async () => ({ error: { message: "private secret detail" }, data: null }) });
  assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(failed), /private secret detail/);
});
