import {decodeStoredRewardSnapshot, type StoredRewardSnapshot} from "./published-preview-v2.js";
import {historicalAllocationSourceV3, type HistoricalSourceDecisionV3} from "./historical-source-v3.js";
import type {RewardSourceMappingV2} from "./source-mapping-v2.js";

/** V4 uses explicit published league membership. An empty membership is an
 * official unclassified finisher, retained for participation, not a missing
 * result. Only fresh imports that attest this API contract can opt in; existing
 * V3 snapshots/allocations retain their original completeness semantics. */
export function historicalAllocationSourceV4(input: StoredRewardSnapshot, mapping: RewardSourceMappingV2,
  contextHash: string, decisions: HistoricalSourceDecisionV3[], observedAt: string) {
  const snapshot = decodeStoredRewardSnapshot(input);
  const source = historicalAllocationSourceV3(snapshot, mapping, contextHash, decisions, observedAt);
  if (snapshot.version !== 2) return source;
  for (const table of source.standings) {
    const category = snapshot.catalogue.categories.find(c => c.id === table.categoryId);
    if (category?.target !== "individual" || category.eligibility.classificationSource !== "public_current_results_explicit") continue;
    const round = source.rounds.find(r => r.slot === table.slot);
    const race = snapshot.catalogue.rounds.find(r => r.id === round?.roundId)?.races.find(r => r.competitionId === category.competitionId);
    if (!round || !race) continue;
    const finished = snapshot.results.filter(r => r.raceId === race.id && round.results.some(result => result.id === r.id && result.status === "finished"));
    const members = finished.filter(r => r.classificationIds.includes(category.id));
    table.complete = finished.every(r => r.classificationIds.length <= 1 && r.rankOverall !== null)
      && new Set(members.map(r => r.athleteId)).size === members.length;
  }
  return source;
}
