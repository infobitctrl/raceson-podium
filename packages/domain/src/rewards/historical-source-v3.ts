import { decodeStoredRewardSnapshot, type StoredRewardSnapshot } from "./published-preview-v2.js";
import { decodeRewardAllocationSourceV3, type RewardAllocationSourceV3 } from "./allocation-preview-v3.js";
import { decodeRewardSourceMappingV2, type RewardSourceMappingV2 } from "./source-mapping-v2.js";
import { compareRewardKeys } from "./arithmetic.js";

export type HistoricalSourceDecisionV3 = {
  id: string; slot: number; contextHash: string; decision: "confirmed_final" | "held";
  reviewedAt: string; current: boolean;
};
const fail = () => { throw new Error("invalid_reward_historical_source"); };
function check(v: unknown): asserts v { if (!v) fail(); }
function instant(v: unknown) {
  check(typeof v === "string");
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(parts && Number.isFinite(Date.parse(v)));
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  check(month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
    && Number(parts[4]) < 24 && Number(parts[5]) < 60 && Number(parts[6]) < 60);
  return new Date(v).toISOString();
}
export function decodeHistoricalSourceDecisionV3(value: unknown): HistoricalSourceDecisionV3 {
  check(value && typeof value === "object" && !Array.isArray(value)); const r = value as Record<string, unknown>;
  check(Object.keys(r).sort().join(",") === "contextHash,current,decision,id,reviewedAt,slot"
    && typeof r.id === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(r.id)
    && r.id !== "00000000-0000-0000-0000-000000000000" && Number.isInteger(r.slot) && Number(r.slot) >= 1 && Number(r.slot) <= 4
    && typeof r.contextHash === "string" && /^[0-9a-f]{64}$/.test(r.contextHash)
    && ["confirmed_final", "held"].includes(r.decision as string) && typeof r.current === "boolean");
  return { id: r.id, slot: r.slot as number, contextHash: r.contextHash, decision: r.decision as HistoricalSourceDecisionV3["decision"],
    reviewedAt: instant(r.reviewedAt), current: r.current };
}

/** Server-only caller supplies authenticated stored decisions. This pure adapter
 * does not authenticate them. It does not copy labels, identity data or clocks.
 * Historical overall ranks order each classification; official round club points
 * order clubs. Neither becomes a final five-round league standing.
 */
export function historicalAllocationSourceV3(input: StoredRewardSnapshot, mappingInput: RewardSourceMappingV2,
  contextHash: string, decisionsInput: HistoricalSourceDecisionV3[], observedAt: string): RewardAllocationSourceV3 {
  check(/^[0-9a-f]{64}$/.test(contextHash));
  const snapshot = decodeStoredRewardSnapshot(input), mapping = decodeRewardSourceMappingV2(mappingInput);
  const capturedAt = instant(observedAt), importedAt = instant(snapshot.capturedAt);
  check(importedAt <= capturedAt);
  const decisions = decisionsInput.map(decodeHistoricalSourceDecisionV3);
  check(new Set(decisions.map(d => d.slot)).size === decisions.length);
  for (const d of decisions) check(d.current === (d.contextHash === contextHash) && d.reviewedAt <= capturedAt);
  const standings: RewardAllocationSourceV3["standings"] = [];
  const categories = snapshot.catalogue.categories.map(c => ({ id: c.id, target: c.target }));
  const rounds: RewardAllocationSourceV3["rounds"] = mapping.rounds.map(mapped => {
    if (mapped.roundId === null || mapped.slot === 5) return { slot: mapped.slot, roundId: mapped.roundId, evidence: null, resultsComplete: false, expectedResultCount: 0, results: [] };
    const round = snapshot.catalogue.rounds.find(r => r.id === mapped.roundId && r.slot === mapped.slot); check(round);
    const raw = snapshot.results.filter(r => round.races.some(race => race.id === r.raceId));
    const publications = round.races.map(race => {
      check(race.publicationId !== null && ["official", "corrected"].includes(race.publicationState ?? ""));
      const rows = raw.filter(r => r.raceId === race.id), dates = new Set(rows.map(r => instant(r.publishedAt)));
      check(dates.size <= 1); const date = [...dates][0] ?? null;
      if (date) check(date <= importedAt);
      // Real imported races still need a source publication timestamp. The
      // finite owner-approved workflow v2 fixture defines empty-course synthetic
      // publication at its capture instant; this is never real sporting evidence.
      return date ?? (snapshot.version === 3 && snapshot.sourceOrigin === "urn:raceson:synthetic:workflow-20260930:v2"
        && race.resultCount === 0 && rows.length === 0 ? importedAt : null);
    });
    const decision = decisions.find(d => d.slot === mapped.slot);
    const publishedAt = publications.every(p => p !== null) ? [...publications].sort().at(-1)! : null;
    const evidence = publishedAt ? { kind: snapshot.version === 3 ? "synthetic" as const : "historical_final" as const, digest: contextHash, publishedAt,
      held: !decision?.current || decision.decision !== "confirmed_final" } : null;
    const results = raw.map(r => ({ id: r.id, athleteId: r.athleteId,
      categoryId: r.classificationIds.length === 1 ? r.classificationIds[0]! : null, clubId: r.clubId,
      status: r.participationStatus === "finished" && r.finishTimeMs !== null && r.finishTimeMs > 0 ? "finished" as const
        : ["dns", "dnf", "dsq"].includes(r.participationStatus ?? "") ? r.participationStatus as "dns" | "dnf" | "dsq" : "unknown" as const,
      distanceMetres: round.races.find(race => race.id === r.raceId)!.distanceMetres }));
    const resultById = new Map(results.map(r => [r.id, r]));
    if (evidence) for (const category of snapshot.catalogue.categories) {
      const race = round.races.find(r => r.competitionId === category.competitionId);
      const raceRows = raw.filter(r => r.raceId === race?.id && resultById.get(r.id)!.status === "finished");
      const complete = category.target === "club" || Boolean(race) && raceRows.every(r => r.classificationIds.length === 1 && r.rankOverall !== null);
      const candidates = category.target === "individual"
        ? raceRows.filter(r => r.classificationIds.includes(category.id) && r.rankOverall !== null).map(r => ({
          sourceRowId: r.id, beneficiaryId: r.athleteId, order: r.rankOverall! }))
        : snapshot.clubs.flatMap(c => { const score = c.rounds.find(r => r.sourceRoundId === round.id && r.points > 0);
          // The source reference identifies this club's aggregate within the exact
          // imported round document, not an invented per-result row UUID.
          return score ? [{ sourceRowId: c.clubId, beneficiaryId: c.clubId, order: -score.points }] : []; });
      candidates.sort((a, b) => a.order - b.order || compareRewardKeys(a.beneficiaryId, b.beneficiaryId));
      let rank = 0;
      // Ambiguous duplicates remain in results and hold the pot. Do not emit an
      // invalid standing table or pick one of the duplicate athletes here.
      const duplicate = new Set(candidates.map(c => c.beneficiaryId)).size !== candidates.length;
      standings.push({ slot: mapped.slot, categoryId: category.id, complete: complete && !duplicate,
        evidence, roundDigests: [contextHash], rows: duplicate ? [] : candidates.map((r, i) => {
          if (i === 0 || candidates[i - 1]!.order !== r.order) rank = i + 1;
          return { sourceRowId: r.sourceRowId, beneficiaryId: r.beneficiaryId, rank };
        }) });
    }
    return { slot: mapped.slot, roundId: mapped.roundId, evidence, resultsComplete: true,
      expectedResultCount: round.races.reduce((n, r) => n + r.resultCount, 0), results };
  });
  return decodeRewardAllocationSourceV3({ version: 3, kind: snapshot.version === 3 ? "synthetic_rehearsal" : "minimized_source", sourceLeagueId: snapshot.sourceLeagueId,
    sourceSeasonId: snapshot.sourceSeasonId, capturedAt, categories, rounds, league: null, standings });
}
