import { createDefaultRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import type { PublishedRewardSnapshotV2 } from "@raceson/domain/rewards/published-preview-v2";
import type { RewardMappingWorkspaceV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { historicalAllocationSourceV3, type HistoricalSourceDecisionV3 } from "@raceson/domain/rewards/historical-source-v3";
import { previewRewardAllocationV3 } from "@raceson/domain/rewards/allocation-preview-v3";
import { createSyntheticPilotV3 } from "@raceson/domain/rewards/synthetic-pilot-v3";
// Test-only fixture; no production/demo route imports this module.
const id = (n: number) => `8c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function historicalFixture(decision?: "confirmed_final" | "held") {
  const now = "2026-09-10T03:00:00.000Z", hash = "a".repeat(64);
  const record: SavedRewardPlanningDraft = { draftId: id(1), organizationId: id(2), seasonId: id(3), chainId: 31337,
    revision: 1, organizationName: "Synthetic", seasonName: "Synthetic", updatedAt: now, rules: createDefaultRewardProgrammeDraftV2() };
  const snapshot: PublishedRewardSnapshotV2 = { version: 2, sourceOrigin: "https://www.raceson.com", sourceLeagueId: id(4), sourceSeasonId: id(5), capturedAt: now,
    catalogue: { rounds: Array.from({ length: 4 }, (_, i) => ({ id: id(100 + i), editionId: id(200 + i), slot: i + 1, name: `Synthetic round ${i + 1}`,
      date: "2026-09-01", status: "completed", races: [{ id: id(300 + i), competitionId: id(8), name: "Synthetic race", distanceMetres: "5000",
        publicationId: id(400 + i), publicationState: "official", resultCount: 1 }] })),
      categories: [{ id: id(9), competitionId: id(8), competitionName: "Short", name: "Female", target: "individual", eligibility: {} }] },
    results: Array.from({ length: 4 }, (_, i) => ({ id: id(500 + i), publicationId: id(400 + i), publicationState: "official", publishedAt: "2026-09-01T12:00:00Z", runId: id(600 + i),
      athleteId: id(7), athleteName: "Synthetic runner", raceId: id(300 + i), classificationIds: [id(9)], participationStatus: "finished",
      finishTimeMs: 120000, rankOverall: 1, clubId: null, clubName: null })), clubs: [] };
  const mapping = { version: 2 as const, leagueCategories: [], rounds: Array.from({ length: 5 }, (_, i) => ({ slot: i + 1,
    roundId: snapshot.catalogue.rounds[i]?.id ?? null, categories: [{ categoryId: id(9), shareBps: 10000 }] })) };
  const workspace: RewardMappingWorkspaceV2 = { draftId: record.draftId, revision: 1, rulesRevision: 1, catalogueHash: hash, boundCatalogueHash: hash, mapping, catalogue: snapshot.catalogue };
  const decisions: HistoricalSourceDecisionV3[] = decision ? [{ id: id(901), slot: 1, contextHash: hash, decision, reviewedAt: now, current: true }] : [];
  const source = historicalAllocationSourceV3(snapshot, mapping, hash, decisions, now), preview = previewRewardAllocationV3(record.rules, mapping, source);
  const data = { contextHash: hash, decisions, source, preview, recordedDecision: decision ? decisions[0] : null };
  return { context: { record, workspace, sourceHash: hash, slot: 1 }, data,
    wire: JSON.parse(JSON.stringify({ schema: "raceson-historical-source-v3", record, workspace, sourceHash: hash, ...data }, (_, v) => typeof v === "bigint" ? v.toString() : v)) };
}

export function syntheticPilotReviewFixture() {
  const p = createSyntheticPilotV3("2026-09-10T12:00:00.000Z"), f = historicalFixture();
  const record = { ...f.context.record, draftId: p.draftId, seasonId: p.snapshot.sourceSeasonId, rules: p.rules, updatedAt: p.snapshot.capturedAt };
  const workspace = { ...f.context.workspace, draftId: p.draftId, mapping: p.mapping, catalogue: p.snapshot.catalogue };
  const source = historicalAllocationSourceV3(p.snapshot, p.mapping, f.data.contextHash, [], p.snapshot.capturedAt);
  const data = { ...f.data, source, preview: previewRewardAllocationV3(p.rules, p.mapping, source) };
  const context = { ...f.context, record, workspace };
  return { snapshot: p.snapshot, context, data,
    wire: JSON.parse(JSON.stringify({ schema: "raceson-historical-source-v3", record, workspace, sourceHash: context.sourceHash, ...data }, (_, v) => typeof v === "bigint" ? v.toString() : v)) };
}
