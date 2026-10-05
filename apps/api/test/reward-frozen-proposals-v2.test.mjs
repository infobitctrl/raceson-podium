import assert from "node:assert/strict";
import test from "node:test";
import { buildRewardProposalV2, canonicalRewardProposalV2, decodeFrozenRewardProposalV2, rewardProposalReadinessV2 } from "../../../packages/domain/dist/rewards/frozen-proposal-v2.js";
import { createDefaultRewardProgrammeDraftV2 } from "../../../packages/domain/dist/rewards/programme-draft-v2.js";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";
import { publishedSnapshot, publishedMapping, id } from "./fixtures/published-reward-v2.mjs";
function fixture() {
  const snapshot = publishedSnapshot(), record = { draftId: id(30), organizationId: id(31), seasonId: id(32), chainId: 31337, organizationName: "Synthetic", seasonName: "Synthetic", revision: 1, updatedAt: "2026-09-09T12:00:00Z", rules: createDefaultRewardProgrammeDraftV2() };
  const workspace = { draftId: id(30), revision: 1, rulesRevision: 1, catalogueHash: "a".repeat(64), boundCatalogueHash: "a".repeat(64), mapping: publishedMapping(), catalogue: snapshot.catalogue };
  return { record, workspace, snapshot, sourceHash: "b".repeat(64) };
}
const wire = value => JSON.parse(canonicalRewardProposalV2(value));
function frozen(f = fixture(), slot = 1) { return { revision: 1, frozenAt: "2026-09-09T13:00:00Z", proposalHash: "c".repeat(64), document: buildRewardProposalV2(f.record, f.workspace, f.snapshot, f.sourceHash, slot) }; }
test("frozen proposals preserve exact calculations without claiming sporting approval, review or payment", () => {
  const f = fixture(), p = frozen(f), scope = { ...f.record, slot: 1, sourceHash: f.sourceHash };
  assert.deepEqual(decodeFrozenRewardProposalV2(wire(p), f.snapshot, scope), p);
  const ready = rewardProposalReadinessV2(p.document);
  assert.equal(ready.state, "frozen_unapproved"); assert.equal(ready.reviewSeconds, 86400); assert.equal(ready.reviewStartedAt, null); assert.equal(ready.payableWei, 0n);
  assert.deepEqual(ready.reasons, ["organizer_approval", "chain_review_anchor"]);
  const pending = rewardProposalReadinessV2(frozen(f, 5).document); assert.ok(pending.reasons.includes("source_missing"));
});
test("historical versions recompute with frozen rules, not a subsequently edited programme", () => {
  const f = fixture(), p = frozen(f), original = wire(p);
  f.record = { ...f.record, revision: 2, rules: { ...f.record.rules, budgetMon: "200000" } };
  const decoded = decodeFrozenRewardProposalV2(original, f.snapshot, { ...f.record, slot: 1, sourceHash: f.sourceHash });
  assert.equal(decoded.document.record.revision, 1); assert.equal(decoded.document.calculation.budgetWei, 10000n * 10n ** 18n);
});
test("tampered amounts, clocks, source, scope, extra secrets and malformed history fail closed", () => {
  const f = fixture(), scope = { ...f.record, slot: 1, sourceHash: f.sourceHash };
  for (const mutate of [p => p.document.calculation.proposedWei = "1", p => p.document.calculation.categories[0].awards[0].amountWei = "1",
    p => p.document.reviewStartedAt = "2026-01-01T00:00:00Z", p => p.document.record.chainId = 10143, p => p.document.record.seasonId = id(99),
    p => p.document.slot = 2, p => p.document.sourceHash = "d".repeat(64), p => p.revision = 0, p => p.frozenAt = "yesterday", p => p.secret = "private",
    p => p.document.workspace.boundCatalogueHash = "e".repeat(64), p => p.document.record.rules.reviewSeconds = 259200]) {
    const p = wire(frozen(f)); mutate(p); assert.throws(() => decodeFrozenRewardProposalV2(p, f.snapshot, scope));
  }
});
test("unassigned budgets and ambiguous results stay explicit approval blockers", () => {
  const f = fixture(); f.workspace.mapping.rounds[0].categories[0].shareBps = 8750; f.snapshot.results[0].classificationIds = [];
  const ready = rewardProposalReadinessV2(frozen(f).document);
  assert.ok(ready.reasons.includes("ambiguous_results")); assert.ok(ready.reasons.includes("unassigned_categories"));
});
async function request({ method = "POST", body, data = fixture(), stored, error, query = "", slot = "1", authError } = {}) {
  const res = {}, calls = [];
  const payload = body ?? { rulesRevision: 1, mappingRevision: 1, catalogueHash: data.workspace.catalogueHash, sourceHash: data.sourceHash };
  const handled = await dispatchRewardPlanningRoutes({ method }, res, new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${id(30)}/proposals/${slot}${query}`), {
    config: () => ({ chainId: 31337 }), requireIdentity: async () => { if (authError) throw Error(authError); return { userId: id(40), sessionId: id(41) }; }, readJsonBody: async () => payload,
    applyPrivateSessionHeaders: () => res.private = true, sendSuccess: (_, data) => Object.assign(res, { status: 200, data }), sendError: (_, status, code) => Object.assign(res, { status, code }),
    rpc: async (name, args) => { calls.push({ name, args });
      return { data: name === "service_read_reward_published_preview_v2" ? data : stored ?? (method === "GET" ? [wire(frozen(data))] : wire(frozen(data))), error: error ? { message: error } : null }; } });
  return { res, calls, handled };
}
test("freeze HTTP uses only strict expectations and server-calculated conserved amounts", async () => {
  const { res, calls } = await request(); assert.equal(res.status, 200); assert.equal(res.private, true); assert.equal(calls.length, 2);
  assert.equal(calls[1].name, "service_freeze_reward_proposal_v2"); assert.equal(calls[1].args.p_actor_session_id, id(41));
  assert.equal(calls[1].args.p_calculation.budgetWei, "10000000000000000000000");
  assert.equal(calls[1].args.p_rules_revision, 1); assert.equal(calls[1].args.p_mapping_revision, 1);
  assert.ok(!Object.keys(calls[1].args).some(k => /time|review|wallet/i.test(k)));
  assert.equal((await request({ method: "GET" })).res.data.items.length, 1);
});
test("freeze refuses client amounts/backdating, stale inputs, query overrides and wrong methods", async () => {
  const f = fixture(), base = { rulesRevision: 1, mappingRevision: 1, catalogueHash: f.workspace.catalogueHash, sourceHash: f.sourceHash };
  for (const extra of [{ amount: "1" }, { calculation: {} }, { reviewStartedAt: "2026-01-01T00:00:00Z" }, { slot: 2 }]) {
    const r = await request({ body: { ...base, ...extra } }); assert.equal(r.res.status, 400); assert.equal(r.calls.length, 0);
  }
  for (const extra of [{ rulesRevision: 2 }, { mappingRevision: 2 }, { sourceHash: "c".repeat(64) }, { catalogueHash: "c".repeat(64) }]) {
    const r = await request({ body: { ...base, ...extra } }); assert.equal(r.res.status, 409); assert.equal(r.calls.length, 1);
  }
  assert.equal((await request({ query: "?amount=1" })).res.status, 400);
  assert.equal((await request({ method: "PATCH" })).handled, false); assert.equal((await request({ slot: "6" })).handled, false);
});
test("history enforces private scope, order, bounded responses and fresh SQL authorization errors", async () => {
  for (const [error, status] of [["reward_planning_not_found", 404], ["reward_account_session_required", 401], ["private secret", 503]]) {
    const r = await request({ error }); assert.equal(r.res.status, status); assert.ok(!JSON.stringify(r.res).includes("private secret"));
  }
  assert.equal((await request({ authError: "Untrusted browser origin" })).res.status, 403);
  for (const stored of [Array(11).fill(wire(frozen())), [wire(frozen()), wire(frozen())], [{ ...wire(frozen()), secret: true }]])
    assert.notEqual((await request({ method: "GET", stored })).res.status, 200);
});
