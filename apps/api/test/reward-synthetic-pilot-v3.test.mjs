import assert from "node:assert/strict";
import test from "node:test";
import { createSyntheticPilotV3, syntheticPilotIdV3 as id } from "../../../packages/domain/dist/rewards/synthetic-pilot-v3.js";
import { decodeStoredRewardSnapshot, decodePublishedRewardSnapshotV2, previewPublishedRewardsV2 } from "../../../packages/domain/dist/rewards/published-preview-v2.js";
import { createRewardAllocationRehearsalV3 } from "../../../packages/domain/dist/rewards/allocation-rehearsal-v3.js";
import { historicalAllocationSourceV3 } from "../../../packages/domain/dist/rewards/historical-source-v3.js";
import { previewRewardAllocationV3 } from "../../../packages/domain/dist/rewards/allocation-preview-v3.js";
import { buildAllocationDocumentV3, decodeAllocationDocumentV3, allocationApprovalReasonsV3 } from "../../../packages/domain/dist/rewards/allocation-approval-v3.js";
import { buildRewardProposalV2 } from "../../../packages/domain/dist/rewards/frozen-proposal-v2.js";
import { readRewardPublishedPreviewV2, rewardFrozenProposalsV2, rewardHistoricalSourceV3 } from "../../../packages/db/dist/rewards/index.js";
import { compactPilotSeedSql } from "../../../demo/rewards/scripts/seed-compact-pilot.mjs";

const now = "2026-09-10T12:00:00.000Z", hash = "a".repeat(64), actor = { userId: id(700), sessionId: id(701) };
function fixture() {
  const p = createSyntheticPilotV3(now);
  const record = { draftId: p.draftId, organizationId: id(702), seasonId: p.snapshot.sourceSeasonId, chainId: 31337,
    revision: 1, organizationName: "Synthetic", seasonName: "Synthetic pilot", updatedAt: now, rules: p.rules };
  const workspace = { draftId: p.draftId, revision: 1, rulesRevision: 1, catalogueHash: hash, boundCatalogueHash: hash, mapping: p.mapping, catalogue: p.snapshot.catalogue };
  return { ...p, record, workspace, stored: { record, workspace, snapshot: p.snapshot, sourceHash: hash } };
}
test("compact saved source reuses 20 recurring beneficiaries, seven categories and four clubs without identities or keys", () => {
  const p = fixture(); assert.equal(p.rules.budgetMon, "100"); assert.equal(p.snapshot.results.length, 80);
  assert.equal(new Set(p.snapshot.results.map(r => r.athleteId)).size, 20); assert.equal(p.snapshot.clubs.length, 4);
  assert.equal(p.snapshot.catalogue.categories.filter(c => c.target === "individual").length, 7);
  assert.equal(p.snapshot.results.filter(r => r.participationStatus === "finished").length, 77);
  assert.equal(p.mapping.rounds[4].roundId, null);
  assert.doesNotMatch(JSON.stringify(p.snapshot), /wallet|privateKey|password|birth_year|@|https:/);
  assert.deepEqual(decodeStoredRewardSnapshot(p.snapshot), p.snapshot);
  assert.throws(() => decodePublishedRewardSnapshotV2(p.snapshot));
  assert.throws(() => createSyntheticPilotV3("invalid")); assert.throws(() => id(-1));
});
test("synthetic source decoder rejects foreign origin/IDs, missing participants, private fields and cross-kind claims", () => {
  for (const mutate of [p => p.version = 2, p => p.sourceOrigin = "https://www.raceson.com", p => p.sourceSeasonId = id(900),
    p => { p.version = 2; p.sourceOrigin = "https://www.raceson.com"; },
    p => p.results[0].athleteId = "00000001-0000-4000-8000-000000000001", p => p.results.pop(),
    p => p.results[0].athleteId = p.results[1].athleteId, p => p.catalogue.categories[0].eligibility.demoOnly = false,
    p => p.privateKey = "secret", p => p.results[0].wallet = "secret", p => p.clubs.pop()]) {
    const p = fixture().snapshot; mutate(p); assert.throws(() => decodeStoredRewardSnapshot(p));
  }
});
test("persisted-source adapter conserves the exact existing compact round allocations while retaining finale and league", () => {
  const p = fixture(), decisions = [1, 2, 3, 4].map(slot => ({ id: id(800 + slot), slot, contextHash: hash, decision: "confirmed_final", current: true, reviewedAt: now }));
  const unreviewed = historicalAllocationSourceV3(p.snapshot, p.mapping, hash, [], now);
  assert.equal(unreviewed.kind, "synthetic_rehearsal"); assert.equal(previewRewardAllocationV3(p.rules, p.mapping, unreviewed).proposedWei, 0n);
  const source = historicalAllocationSourceV3(p.snapshot, p.mapping, hash, decisions, now);
  assert.ok(source.rounds.slice(0, 4).every(r => r.evidence.kind === "synthetic"));
  const computed = previewRewardAllocationV3(p.rules, p.mapping, source);
  const original = createRewardAllocationRehearsalV3("four_rounds", "compact_20"), expected = previewRewardAllocationV3(original.rules, original.mapping, original.source);
  for (let slot = 0; slot < 4; slot++) {
    assert.equal(computed.rounds[slot].proposedWei, expected.rounds[slot].proposedWei);
    const awards = p => p.families.flatMap(f => f.categories.flatMap(c => c.awards.map(a => [c.categoryId, a.beneficiaryId, a.rank, a.amountWei])));
    assert.deepEqual(awards(computed.rounds[slot]), awards(expected.rounds[slot]));
  }
  assert.equal(computed.rounds[4].proposedWei, 0n); assert.equal(computed.league.proposedWei, 0n);
  assert.equal(computed.budgetWei, 100n * 10n ** 18n); assert.equal(computed.payableWei, 0n);
  const legacyPreview = previewPublishedRewardsV2(p.rules, p.mapping, p.snapshot);
  assert.equal(legacyPreview.finishedCount, 77); assert.equal(legacyPreview.leagueRetainedWei, 50n * 10n ** 18n);
  const document = buildAllocationDocumentV3(p.record, p.workspace, hash, hash, 1, source, decisions[0], null);
  assert.equal(document.source.kind, "synthetic_rehearsal"); assert.deepEqual(decodeAllocationDocumentV3(document), document);
  assert.deepEqual(allocationApprovalReasonsV3(document), ["funding_required"]);
});
test("shared saved preview/review repositories retain synthetic provenance and the V2 writer refuses before mutation", async () => {
  const p = fixture(), calls = [];
  const rpc = async name => { calls.push(name); return { data: structuredClone(p.stored) }; };
  assert.equal((await readRewardPublishedPreviewV2(actor, 31337, p.draftId, rpc)).snapshot.version, 3);
  await assert.rejects(rewardFrozenProposalsV2(actor, 31337, p.draftId, 1, undefined, rpc), { code: "invalid_reward_planning_request" });
  assert.ok(calls.every(name => name === "service_read_reward_published_preview_v2"));
  assert.throws(() => buildRewardProposalV2(p.record, p.workspace, p.snapshot, hash, 1));
  const review = await rewardHistoricalSourceV3(actor, 31337, p.draftId, undefined, async () => ({ data: {
    ...structuredClone(p.stored), contextHash: hash, decisions: [], recordedDecision: null, observedAt: now } }));
  assert.equal(review.source.kind, "synthetic_rehearsal"); assert.equal(review.preview.proposedWei, 0n);
});
test("fixed pilot SQL creates only source/planning/finale scope; never reviews, profiles, credentials or transactions", () => {
  const p = fixture(); const input = createSyntheticPilotV3(now);
  const sql = compactPilotSeedSql(input, p.record.organizationId, actor.userId);
  assert.match(sql, /pg_advisory_xact_lock/); assert.match(sql, /Synthetic pilot source conflict/);
  assert.doesNotMatch(sql, /insert into (?:auth\.|public\.(?:athlete_profiles|clubs|result_rows|result_publications)|app_private\.reward_(?:historical_source_reviews|result_review|programme_approval|programme_deployment|allocation_approval|athlete))/);
  assert.throws(() => compactPilotSeedSql({ ...input, draftId: id(999) }, p.record.organizationId, actor.userId));
});
