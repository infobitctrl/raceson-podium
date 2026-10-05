import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { canonicalRewardJson } from "../../../packages/rewards-chain/dist/index.js";
import { leaguePolicyWorkspaceV3 } from "../dist/features/rewards/league-policy-v3-service.js";
import { previewNativeFinaleContinuityV3 } from "../dist/features/rewards/native-finale-continuity-service.js";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";
import { nativeContinuityFixture } from "./fixtures/native-finale-continuity-v3.mjs";
import { nativeId as n } from "./fixtures/native-finale-v3.mjs";
const identity = { userId: n(800), sessionId: n(801) };
function transport() {
  const f = nativeContinuityFixture(), reviews = new Map(), calls = [];
  const facts = { historical: { record: f.record, workspace: f.workspace, snapshot: f.snapshot, sourceHash: "c".repeat(64),
    contextHash: f.historicalContextHash, decisions: f.historicalDecisions, observedAt: f.native.observedAt, recordedDecision: null },
    native: f.native, guardHash: "d".repeat(64), labels: { athletes: [], clubs: [] }, review: { id: n(810), previousReviewId: null,
      contextHash: previewNativeFinaleContinuityV3(f).contextHash, selection: f.selection, decision: "confirmed", reviewedAt: "2026-09-10T04:45:00.000Z" }, recordedReview: null };
  const data = { facts, guardHash: "e".repeat(64), review: null, recordedReview: null };
  const policy = { schema: "raceson-league-scoring-policy-v3", categories: f.snapshot.catalogue.categories.filter(c => c.target === "individual")
    .map(c => ({ categoryId: c.id, points: [100, 80, 60], participationPoints: 1, bestN: 4, minimumRounds: 2, tieBreak: "best_finish" })),
    club: { categoryId: f.snapshot.catalogue.categories.find(c => c.target === "club").id, membersPerRound: 3 } };
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === "service_review_reward_league_policy_v3") {
      assert.equal(args.p_source_guard_hash, data.guardHash);
      assert.equal(canonicalRewardJson(JSON.parse(args.p_context_text)), args.p_context_text);
      data.review = { id: args.p_request_id, previousReviewId: args.p_expected_review_id,
        contextHash: createHash("sha256").update(args.p_context_text).digest("hex"), policy: args.p_policy,
        decision: args.p_decision, reviewedAt: "2026-09-10T04:50:00.000Z" };
      reviews.set(data.review.id, structuredClone(data.review));
    }
    return { error: null, data: structuredClone({ ...data, recordedReview: reviews.get(args.p_request_id) ?? null }) };
  };
  const run = c => leaguePolicyWorkspaceV3(identity, 31337, f.record.draftId, c, rpc);
  return { f, facts, data, policy, rpc, run, calls };
}
test("private saved policy recomputes all five source tables without publishing or paying", async () => {
  const t = transport(), initial = await t.run(); assert.equal(initial.reviewState, "missing"); assert.equal(initial.proposal, null);
  const c = { requestId: n(820), expectedReviewId: null, contextHash: initial.contextHash, policy: t.policy, decision: "selected" };
  const saved = await t.run(c); assert.equal(saved.reviewState, "selected"); assert.equal(saved.proposal.state, "unapproved_proposal");
  assert.equal(saved.proposal.athleteTables.length, 7); assert.equal(saved.proposal.clubTables.length, 6);
  assert.equal(saved.finalPublished, false); assert.equal(saved.payableWei, "0");
  assert.doesNotMatch(JSON.stringify(saved), /date_of_birth|athleteName|finishTimeMs|wallet|guardHash|context_text/);
  t.facts.native.observedAt = "2026-09-10T04:55:00.000Z";
  assert.equal((await t.run()).proposalHash, saved.proposalHash, "refresh time does not change exact proposal");
  const hold = await t.run({ ...c, requestId: n(821), expectedReviewId: c.requestId, decision: "held" }); assert.equal(hold.proposal, null);
  const retry = await t.run(c); assert.equal(retry.review.id, n(821)); assert.equal(retry.recordedReview.id, n(820)); assert.equal(retry.proposal, null);
  assert.equal(t.calls.filter(c => c.name.startsWith("service_review")).length, 2);
  await assert.rejects(t.run({ ...c, decision: "held" }), { code: "reward_league_policy_conflict" });
});
test("source corrections change proposal, policy scope changes stale selection, neither leaks old ready table", async () => {
  const t = transport(), initial = await t.run();
  const c = { requestId: n(820), expectedReviewId: null, contextHash: initial.contextHash, policy: t.policy, decision: "selected" };
  const saved = await t.run(c);
  t.facts.historical.decisions[0].decision = "held";
  let changed = await t.run(); assert.equal(changed.contextHash, saved.contextHash); assert.notEqual(changed.proposalHash, saved.proposalHash);
  assert.equal(changed.proposal.state, "held"); assert.deepEqual(changed.proposal.athleteTables, []);
  t.facts.historical.decisions[0].decision = "confirmed_final";
  t.facts.native.document.races[0].rows[0].finishTimeMs = "1900000";
  changed = await t.run(); assert.equal(changed.reviewState, "selected"); assert.equal(changed.proposal.state, "held");
  t.facts.historical.workspace.mapping.leagueCategories[0].shareBps--;
  changed = await t.run(); assert.equal(changed.reviewState, "stale"); assert.equal(changed.proposal, null);
  await assert.rejects(t.run({ ...c, requestId: n(822), expectedReviewId: c.requestId }), { code: "reward_planning_revision_changed" });
});
test("league-policy HTTP uses authenticated facts only and sanitizes failures", async () => {
  const t = transport();
  async function request({ method = "GET", body, query = "", authError, rpc = t.rpc } = {}) {
    const res = {}, handled = await dispatchRewardPlanningRoutes({ method }, res,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${t.f.record.draftId}/league-policy${query}`), {
        config: () => ({ chainId: 31337 }), requireIdentity: async () => { if (authError) throw Error(authError); return identity; }, rpc,
        readJsonBody: async () => body, applyPrivateSessionHeaders: () => res.private = true,
        sendSuccess: (_, data) => Object.assign(res, { status: 200, data }), sendError: (_, status, code) => Object.assign(res, { status, code }) });
    return { ...res, handled };
  }
  const initial = await request(); assert.equal(initial.status, 200); assert.equal(initial.private, true);
  assert.equal((await request({ method: "PATCH" })).handled, false);
  assert.equal((await request({ query: "?chainId=1" })).status, 400);
  assert.equal((await request({ authError: "Unauthorized" })).status, 401);
  const body = { requestId: n(820), expectedReviewId: null, contextHash: initial.data.contextHash, policy: t.policy, decision: "selected" };
  for (const extra of [{ source: t.f.snapshot }, { officialPublished: true }, { amountWei: "1" }]) assert.equal((await request({ method: "POST", body: { ...body, ...extra } })).status, 400);
  assert.equal((await request({ method: "POST", body })).data.proposal.state, "unapproved_proposal");
  const failed = await request({ rpc: async () => ({ data: null, error: { message: "private details" } }) });
  assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(failed), /private details/);
});
test("raw historical rank corruption cannot be hidden by category rank compaction", async () => {
  const t = transport(), initial = await t.run();
  const c = { requestId: n(820), expectedReviewId: null, contextHash: initial.contextHash, policy: t.policy, decision: "selected" };
  await t.run(c);
  const raceId = t.f.snapshot.catalogue.rounds[0].races[0].id;
  const rows = t.f.snapshot.results.filter(r => r.raceId === raceId); rows[1].rankOverall = 1; rows[2].rankOverall = 2;
  // Keep synthetic continuity current to isolate the malformed overall-order
  // check from the independently tested stale-review gate.
  t.facts.review.contextHash = previewNativeFinaleContinuityV3(t.f).contextHash;
  const v = await t.run(); assert.equal(v.proposal.state, "held");
  assert.ok(v.proposal.holds.some(h => h.slot === 1 && h.reason === "source_not_final"));
  assert.deepEqual(v.proposal.athleteTables, []);
});
