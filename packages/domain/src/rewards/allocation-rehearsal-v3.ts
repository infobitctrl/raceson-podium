import { createDefaultRewardProgrammeDraftV2 } from "./programme-draft-v2.js";
import type { RewardSourceMappingV2 } from "./source-mapping-v2.js";
import type { RewardAllocationSourceV3, RewardSourceEvidenceV3 } from "./allocation-preview-v3.js";
import { deriveLeagueStandings, deriveLeagueClubStandings, pointsForLeaguePlace, type LeagueScoringEntry } from "../leagues/standings.js";

export type RehearsalScoreV3 = { beneficiaryId: string; points: number; roundScores: number[]; countedRounds: boolean[];
  contributors: Array<{ athleteId: string; round: number; points: number; counted: boolean }> };

/** Public, invented calculation fixture only. No athlete accounts, keys, source
 * import, review approval, chain funding or sporting publication is created. */
export function createRewardAllocationRehearsalV3(scenario: "four_rounds" | "five_rounds" | "distance_hold" = "five_rounds",
  cohort: "full" | "compact_20" = "full") {
  if (cohort !== "full" && cohort !== "compact_20") throw new Error("invalid_rehearsal_cohort");
  const compact = cohort === "compact_20";
  // Separate invented IDs; never resize/relabel the saved 100,000-MON programme.
  const id = (n: number) => `${compact ? "8a000000" : "89000000"}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const counts = compact ? [2, 2, 4, 4, 2, 3, 3] : Array(7).fill(30) as number[];
  const evidence = (n: number): RewardSourceEvidenceV3 => ({ kind: "synthetic", digest: n.toString(16).padStart(64, "0"),
    publishedAt: "2026-09-10T00:00:00.000Z", held: false });
  const categories: RewardAllocationSourceV3["categories"] = Array.from({ length: 7 }, (_, i) => ({ id: id(i + 1), target: "individual" }));
  categories.push({ id: id(8), target: "club" });
  const shares = categories.map((c, i) => ({ categoryId: c.id, shareBps: i === 7 ? 10000 : i < 4 ? 1429 : 1428 }));
  const rounds: RewardAllocationSourceV3["rounds"] = Array.from({ length: 5 }, (_, r) => {
    const results: RewardAllocationSourceV3["rounds"][number]["results"] = categories.slice(0, 7).flatMap((category, c) => Array.from({ length: counts[c]! }, (_, a) => ({
      id: id(10000 + r * 1000 + c * 30 + a), athleteId: id(1000 + c * 30 + a), categoryId: category.id, clubId: id(5000 + a % 12),
      status: compact ? c === 2 && a === 3 && r === 1 ? "dnf" as const
        : c === 3 && a === 3 && r === 2 ? "dns" as const : c === 4 && a === 1 && r === 3 ? "dsq" as const : "finished" as const
        : a === 29 && r === 1 ? "dnf" as const : "finished" as const, distanceMetres: c < 5 ? "5000" : "10000",
    })));
    return { slot: r + 1, roundId: id(100 + r), evidence: evidence(r + 1), resultsComplete: true, expectedResultCount: results.length, results };
  });
  // These are labelled example policies, not imported/approved Ši Trail rules.
  // Real source adapters must read the exact saved competition policies; neither
  // this fixture nor the shared scorer publishes an official league standing.
  const policy = { bestN: 4, minimumRounds: 2, clubMembersPerRound: 3,
    pointsTables: categories.slice(0, 7).map((category, c) => ({ categoryId: category.id,
      points: Array.from({ length: 30 }, (_, i) => c < 5 ? 100 - 3 * i : 150 - 4 * i) })) };
  const standings: RewardAllocationSourceV3["standings"] = [];
  const scoringTables: Array<{ slot: number | null; categoryId: string; rows: RehearsalScoreV3[] }> = [];
  const entries: Array<LeagueScoringEntry & { categoryId: string; leaguePoints: number }> = [];
  for (const round of rounds) for (const [c, category] of categories.slice(0, 7).entries()) {
    const candidates = round.results.filter(r => r.categoryId === category.id && r.status === "finished");
    // Athlete #2 improves after R1. The season winner must emerge from actual
    // category scores/best-N aggregation, not an artificially reversed table.
    const order = (athleteId: string) => (Number(athleteId.slice(-12)) - 1000 - c * 30 + (round.slot === 1 ? 0 : counts[c]! - 1)) % counts[c]!;
    candidates.sort((a, b) => order(a.athleteId) - order(b.athleteId));
    const pointsTable = policy.pointsTables[c]!.points;
    standings.push({ slot: round.slot, categoryId: category.id, complete: true, evidence: evidence(100 + round.slot * 10 + c),
      roundDigests: [round.evidence!.digest], rows: candidates.map((r, i) => ({ sourceRowId: r.id, beneficiaryId: r.athleteId, rank: i + 1 })) });
    for (const [i, r] of candidates.entries()) entries.push({ athleteId: r.athleteId, athleteSlug: r.athleteId, name: r.athleteId,
      club: r.clubId!, clubSlug: r.clubId, gender: "U", ageCategory: "", leagueClassificationIds: [category.id], categoryId: category.id,
      roundNumber: round.slot, roundStatus: "completed", publicationState: "official", participationStatus: "finished", overall: i + 1,
      leaguePoints: pointsForLeaguePlace(i + 1, pointsTable, 0) });
    scoringTables.push({ slot: round.slot, categoryId: category.id, rows: entries.filter(e => e.roundNumber === round.slot && e.categoryId === category.id)
      .map(e => ({ beneficiaryId: e.athleteId, points: e.leaguePoints, roundScores: Array.from({ length: 5 }, (_, i) => i + 1 === round.slot ? e.leaguePoints : 0),
        countedRounds: Array.from({ length: 5 }, (_, i) => i + 1 === round.slot), contributors: [] })) });
  }
  for (const [c, category] of categories.slice(0, 7).entries()) {
    const scored = deriveLeagueStandings(entries.filter(e => e.categoryId === category.id), policy.pointsTables[c]!.points,
      0, policy.bestN, policy.minimumRounds, "best_finish").filter(s => s.eligible);
    standings.push({ slot: null, categoryId: category.id, complete: true, evidence: evidence(160 + c),
      roundDigests: rounds.map(r => r.evidence!.digest), rows: scored.map((s, i) => ({ sourceRowId: id(26000 + c * 30 + i), beneficiaryId: s.athleteId, rank: i + 1 })) });
    scoringTables.push({ slot: null, categoryId: category.id, rows: scored.map(s => {
      const performances = entries.filter(e => e.categoryId === category.id && e.athleteId === s.athleteId)
        .sort((a, b) => b.leaguePoints - a.leaguePoints || a.overall - b.overall);
      const counted = new Set(performances.slice(0, policy.bestN).map(e => e.roundNumber));
      return { beneficiaryId: s.athleteId, points: s.points, roundScores: Array.from({ length: 5 }, (_, i) => s.roundScores[i] ?? 0),
        countedRounds: Array.from({ length: 5 }, (_, i) => counted.has(i + 1)), contributors: [] };
    }) });
  }
  for (const slot of [1, 2, 3, 4, 5, null]) {
    const clubs = deriveLeagueClubStandings(slot === null ? entries : entries.filter(e => e.roundNumber === slot), [], 0, `best_${policy.clubMembersPerRound}`);
    const categoryId = id(8);
    standings.push({ slot, categoryId, complete: true, evidence: evidence(100 + (slot ?? 6) * 10 + 7),
      roundDigests: (slot === null ? rounds : [rounds[slot - 1]!]).map(r => r.evidence!.digest),
      rows: clubs.map((club, i) => ({ sourceRowId: id(20000 + (slot ?? 6) * 1000 + 7 * 30 + i), beneficiaryId: club.clubSlug, rank: i + 1 })) });
    scoringTables.push({ slot, categoryId, rows: clubs.map(club => ({ beneficiaryId: club.clubSlug, points: club.points,
      roundScores: Array.from({ length: 5 }, (_, i) => club.roundPoints[i] ?? 0),
      countedRounds: Array.from({ length: 5 }, (_, i) => (club.roundPoints[i] ?? 0) > 0),
      contributors: club.memberRows.flatMap(member => member.roundScores.flatMap((points, i) =>
        points > 0 ? [{ athleteId: member.athleteId, round: i + 1, points, counted: member.countedRounds[i] === true }] : [])) })) });
  }
  const source: RewardAllocationSourceV3 = { version: 3, kind: "synthetic_rehearsal", sourceLeagueId: id(50), sourceSeasonId: id(51),
    capturedAt: "2026-09-10T01:00:00.000Z", categories, rounds, league: { evidence: evidence(99), roundDigests: rounds.map(r => r.evidence!.digest) }, standings };
  const mapping: RewardSourceMappingV2 = { version: 2, rounds: rounds.map(r => ({ slot: r.slot, roundId: r.roundId, categories: shares.map(s => ({ ...s })) })), leagueCategories: shares.map(s => ({ ...s })) };
  if (scenario === "four_rounds") {
    source.rounds[4] = { slot: 5, roundId: null, evidence: null, resultsComplete: false, expectedResultCount: 0, results: [] };
    source.league = null; source.standings = source.standings.filter(t => t.slot !== 5 && t.slot !== null); mapping.rounds[4]!.roundId = null;
  } else if (scenario === "distance_hold") source.rounds[4]!.results[0]!.distanceMetres = null;
  const rules = createDefaultRewardProgrammeDraftV2();
  if (compact) rules.budgetMon = "100";
  return { rules, mapping, source, policy,
    scoringTables: scoringTables.filter(t => scenario !== "four_rounds" || t.slot !== null && t.slot !== 5) };
}
