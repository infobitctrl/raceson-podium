import assert from "node:assert/strict";
import test from "node:test";
import { decodePublishedRewardSnapshotV2, previewPublishedPrizeSlots, previewPublishedRewardsV2 } from "../../../packages/domain/dist/rewards/published-preview-v2.js";
import { createDefaultRewardProgrammeDraftV2 } from "../../../packages/domain/dist/rewards/programme-draft-v2.js";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";
import { publishedSnapshot, publishedMapping, id } from "./fixtures/published-reward-v2.mjs";
const rules = createDefaultRewardProgrammeDraftV2(), unit = 10n ** 18n;
test("published evidence rejects private data, duplicate IDs, wrong scope and mismatched publications", () => {
  assert.deepEqual(decodePublishedRewardSnapshotV2(publishedSnapshot()), publishedSnapshot());
  for (const mutate of [s => s.privateKey = "secret", s => s.results[0].dateOfBirth = "2000-01-01", s => s.results[0].walletAddress = "0x1",
    s => s.results[1].id = s.results[0].id, s => s.results[0].classificationIds = [id(99)], s => s.results[0].publicationId = id(99),
    s => s.results[0].rankOverall = 0, s => s.results.pop(), s => s.catalogue.rounds[3].slot = 5, s => s.clubs[0].rounds[0].sourceRoundId = id(99),
    s => s.results[0].runId = id(99), s => s.sourceOrigin = "https://attacker.invalid"]) {
    const s = publishedSnapshot(); mutate(s); assert.throws(() => decodePublishedRewardSnapshotV2(s));
  }
});
test("result-backed athlete and club proposals retain unused positions and all league/fifth-round funds", () => {
  const p = previewPublishedRewardsV2(rules, publishedMapping(), publishedSnapshot());
  assert.equal(p.state, "unapproved_snapshot_preview"); assert.equal(p.payableWei, 0n); assert.equal(p.reviewStartedAt, null);
  assert.equal(p.rounds[0].categories[0].awards[0].amountWei, 2800n * unit);
  assert.equal(p.rounds[0].categories[0].unusedWei, 2400n * unit);
  assert.equal(p.rounds[0].categories[1].awards[0].amountWei, 700n * unit);
  assert.equal(p.rounds[4].proposedWei, 0n); assert.equal(p.rounds[4].retainedWei, 10000n * unit);
  assert.equal(p.leagueRetainedWei, 50000n * unit);
  assert.equal(p.rounds.reduce((n, r) => n + r.proposedWei + r.retainedWei, p.leagueRetainedWei), 100000n * unit);
  assert.ok(p.participation.every(r => r.metres === 20000n && r.finishes === 4));
});
test("ties share occupied slots including the top-ten boundary with deterministic wei rounding", () => {
  const slots = Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, amountWei: BigInt(11 - i) }));
  const candidates = Array.from({ length: 12 }, (_, i) => ({ beneficiaryId: id(1000 + i), name: null, order: i >= 8 ? 9 : i + 1, evidenceIds: [], evidenceValue: i }));
  const a = previewPublishedPrizeSlots(slots, candidates), b = previewPublishedPrizeSlots(slots, [...candidates].reverse());
  assert.deepEqual(a, b); assert.equal(a.unusedWei, 0n);
  assert.deepEqual(a.awards.slice(8).map(r => r.amountWei), [2n, 1n, 1n, 1n]);
  assert.ok(a.awards.slice(8).every(r => r.place === 9));
});
test("ambiguous/overlapping/unranked results hold a category without promoting other finishers", () => {
  for (const mutate of [s => s.results[0].classificationIds = [], s => s.results[0].rankOverall = null,
    s => s.results[1].athleteId = s.results[0].athleteId]) {
    const s = publishedSnapshot(); mutate(s); const p = previewPublishedRewardsV2(rules, publishedMapping(), s);
    assert.equal(p.rounds[0].categories[0].blockedReason, "ambiguous_results"); assert.equal(p.rounds[0].categories[0].unusedWei, 8000n * unit);
    assert.equal(p.rounds[1].categories[0].blockedReason, null); assert.ok(p.rounds[0].categories[1].awards.length);
  }
});
test("DNS/DNF/DSQ and duplicate athlete-round metres do not inflate the provisional distance view", () => {
  const s = publishedSnapshot(); s.results[0].participationStatus = "dns"; s.results[1].participationStatus = "dnf"; s.results[2].participationStatus = "dsq";
  const p = previewPublishedRewardsV2(rules, publishedMapping(), s);
  assert.equal(p.finishedCount, 9); assert.ok(p.participation.every(r => r.metres === 15000n));
  s.results[4].athleteId = s.results[3].athleteId;
  const duplicate = previewPublishedRewardsV2(rules, publishedMapping(), s); assert.equal(duplicate.duplicateAthleteRounds, 1);
  assert.equal(duplicate.participation.find(r => r.athleteId === id(10)).metres, 10000n);
});
test("club equal points are tied; tiny programmes conserve every wei", () => {
  const s = publishedSnapshot(); s.clubs[1].rounds[0].points = s.clubs[0].rounds[0].points;
  const p = previewPublishedRewardsV2(rules, publishedMapping(), s);
  assert.deepEqual(p.rounds[0].categories[1].awards.map(a => a.amountWei), [550n * unit, 550n * unit]);
  const tiny = previewPublishedRewardsV2({ ...rules, budgetMon: "0.000000000000000011" }, publishedMapping(), s);
  assert.equal(tiny.rounds.reduce((n, r) => n + r.proposedWei + r.retainedWei, tiny.leagueRetainedWei), 11n);
});
const record = () => ({ draftId: id(30), organizationId: id(31), seasonId: id(32), chainId: 31337, organizationName: "Synthetic", seasonName: "Synthetic", revision: 1, updatedAt: "2026-09-09T12:00:00Z", rules });
const stored = () => ({ record: record(), workspace: { draftId: id(30), revision: 1, rulesRevision: 1, catalogueHash: "a".repeat(64), boundCatalogueHash: "a".repeat(64), mapping: publishedMapping(), catalogue: publishedSnapshot().catalogue }, snapshot: publishedSnapshot(), sourceHash: "b".repeat(64) });
async function request({ data = stored(), method = "GET", error, authError, query = "" } = {}) {
  const res = {}, calls = []; const handled = await dispatchRewardPlanningRoutes({ method }, res, new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${id(30)}/published-preview${query}`), {
    config: () => ({ chainId: 31337 }), requireIdentity: async () => { if (authError) throw Error(authError); return { userId: id(40), sessionId: id(41) }; }, applyPrivateSessionHeaders: () => res.private = true,
    sendSuccess: (_, data) => Object.assign(res, { status: 200, data }), sendError: (_, status, code) => Object.assign(res, { status, code }),
    rpc: async (name, args) => { calls.push({ name, args }); return { data, error: error ? { message: error } : null }; } }); return { res, calls, handled };
}
test("private preview API reads one atomic rules/mapping/snapshot projection and recomputes amounts", async () => {
  const { res, calls } = await request(); assert.equal(res.status, 200); assert.equal(res.private, true); assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "service_read_reward_published_preview_v2"); assert.equal(calls[0].args.p_actor_session_id, id(41));
  assert.equal(res.data.preview.rounds[0].categories[0].awards[0].amountWei, "2800000000000000000000"); assert.equal(res.data.preview.payableWei, "0");
});
test("preview API refuses writes, client overrides, stale rules, foreign chain and private errors", async () => {
  assert.equal((await request({ method: "PATCH" })).handled, false);
  assert.equal((await request({ query: "?amount=500" })).res.status, 400);
  for (const mutate of [d => d.record.chainId = 10143, d => d.workspace.rulesRevision = 2, d => d.record.draftId = id(99), d => d.workspace.catalogue.rounds[0].name = "Changed"]) {
    const data = stored(); mutate(data); assert.equal((await request({ data })).res.status, 503);
  }
  for (const [error, status] of [["reward_planning_not_found", 404], ["reward_account_session_required", 401], ["SECRET", 503]]) {
    const { res } = await request({ error }); assert.equal(res.status, status); assert.ok(!JSON.stringify(res).includes("SECRET"));
  }
  assert.equal((await request({ authError: "Untrusted browser origin" })).res.status, 403);
});
