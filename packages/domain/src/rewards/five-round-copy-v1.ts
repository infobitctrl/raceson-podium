import { deriveLeagueStandings, deriveLeagueClubStandings, pointsForLeaguePlace, type LeagueScoringEntry } from "../leagues/standings.js";
import { previewPublishedPrizeSlots } from "./published-preview-v2.js";

/** Isolated copy read model. Frozen membership is evidence, never identity or consent.
 * V2 snapshots and their four-round review/contract history remain unchanged. */
export type FiveRoundCopyV1 = {
  version: "raceson-five-round-copy-v1"; batchSha256: string; sportingSha256: string;
  leagueId: string; seasonId: string; capturedAt: string; closedAfterRound: 5; clubScoringScope: "combined";
  athletes: Array<{ id: string; ordinal: number; name: string; username: string }>;
  clubs: Array<{ id: string; name: string }>;
  classifications: Array<{ id: string; competitionId: string; name: string }>;
  policies: Array<{ id: string; points: number[]; participationPoints: number; bestN: number; minimumRounds: number;
    tieBreak: "best_finish" | "most_wins" | "last_round"; clubMode: "best_three" }>;
  races: Array<{ id: string; roundId: string; slot: number; competitionId: string; publicationId: string; runId: string;
    publicationState: "official" | "corrected"; publishedAt: string; distanceMetres: string | null; resultCount: number }>;
  results: Array<{ id: string; registrationId: string; raceId: string; athleteId: string; clubId: string | null;
    publicationId: string; runId: string; status: "finished" | "dns" | "dnf" | "dsq";
    finishTimeMs: string | null; rankOverall: number | null; classificationIds: string[] }>;
};
const fail = () => { throw new Error("invalid_five_round_copy_v1"); };
function check(v: unknown): asserts v { if (!v) fail(); }
function obj(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v)); const r = v as Record<string, unknown>;
  check(Object.keys(r).length === keys.length && keys.every(k => Object.hasOwn(r, k))); return r;
}
function str(v: unknown) { check(typeof v === "string" && v.length > 0 && v.length <= 200); return v; }
function id(v: unknown) { const s = str(v); check(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(s) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(s)); return s; }
function hash(v: unknown) { const s = str(v); check(/^[0-9a-f]{64}$/.test(s)); return s; }
function int(v: unknown, min = 0, max = 1_000_000) { check(typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max); return v; }
function uint(v: unknown) { const s = str(v); check(/^(0|[1-9][0-9]*)$/.test(s) && BigInt(s) <= 9223372036854775807n); return s; }
function instant(v: unknown) { const s = str(v); check(Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s); return s; }
function rows(v: unknown, max = 10_000) { check(Array.isArray(v) && v.length <= max); return v as unknown[]; }
function unique(v: string[]) { check(new Set(v).size === v.length); }

export function decodeFiveRoundCopyV1(value: unknown): FiveRoundCopyV1 {
  const o = obj(value, ["version", "batchSha256", "sportingSha256", "leagueId", "seasonId", "capturedAt", "closedAfterRound", "clubScoringScope", "athletes", "clubs", "classifications", "policies", "races", "results"]);
  check(o.version === "raceson-five-round-copy-v1" && o.closedAfterRound === 5 && o.clubScoringScope === "combined");
  const athletes = rows(o.athletes).map(v => {
    const r = obj(v, ["id", "ordinal", "name", "username"]), ordinal = int(r.ordinal, 1, 10_000);
    check(r.name === `Races Mon${ordinal}` && r.username === `racesmon${ordinal}`);
    return { id: id(r.id), ordinal, name: str(r.name), username: str(r.username) };
  }); unique(athletes.map(a => String(a.ordinal)));
  const clubs = rows(o.clubs).map(v => { const r = obj(v, ["id", "name"]); check(/^Races Club[1-9][0-9]*$/.test(str(r.name))); return { id: id(r.id), name: str(r.name) }; });
  unique(clubs.map(c => c.name));
  const policies = rows(o.policies, 32).map(v => {
    const r = obj(v, ["id", "points", "participationPoints", "bestN", "minimumRounds", "tieBreak", "clubMode"]);
    check(["best_finish", "most_wins", "last_round"].includes(str(r.tieBreak)) && r.clubMode === "best_three");
    const points = rows(r.points, 1_000).map(n => int(n)); check(points.length > 0);
    const bestN = int(r.bestN, 1, 5), minimumRounds = int(r.minimumRounds, 1, bestN);
    return { id: id(r.id), points, participationPoints: int(r.participationPoints), bestN, minimumRounds,
      tieBreak: r.tieBreak as FiveRoundCopyV1["policies"][number]["tieBreak"], clubMode: "best_three" as const };
  }); check(policies.length > 0);
  const classifications = rows(o.classifications, 64).map(v => { const r = obj(v, ["id", "competitionId", "name"]);
    check(policies.some(p => p.id === r.competitionId)); return { id: id(r.id), competitionId: id(r.competitionId), name: str(r.name) }; });
  check(policies.every(p => classifications.some(c => c.competitionId === p.id)));
  const races = rows(o.races, 160).map(v => {
    const r = obj(v, ["id", "roundId", "slot", "competitionId", "publicationId", "runId", "publicationState", "publishedAt", "distanceMetres", "resultCount"]);
    check(policies.some(p => p.id === r.competitionId) && ["official", "corrected"].includes(str(r.publicationState)));
    return { id: id(r.id), roundId: id(r.roundId), slot: int(r.slot, 1, 5), competitionId: id(r.competitionId), publicationId: id(r.publicationId), runId: id(r.runId),
      publicationState: r.publicationState as "official" | "corrected", publishedAt: instant(r.publishedAt), distanceMetres: r.distanceMetres === null ? null : uint(r.distanceMetres), resultCount: int(r.resultCount, 0, 10_000) };
  });
  unique(races.map(r => r.publicationId)); unique(races.map(r => r.runId));
  const roundIds: string[] = [];
  for (let slot = 1; slot <= 5; slot++) {
    const round = races.filter(r => r.slot === slot); check(round.length === policies.length && new Set(round.map(r => r.roundId)).size === 1);
    unique(round.map(r => r.competitionId)); roundIds.push(round[0]!.roundId);
  } unique(roundIds);
  const results = rows(o.results).map(v => {
    const r = obj(v, ["id", "registrationId", "raceId", "athleteId", "clubId", "publicationId", "runId", "status", "finishTimeMs", "rankOverall", "classificationIds"]);
    const race = races.find(c => c.id === r.raceId); check(race && race.publicationId === r.publicationId && race.runId === r.runId);
    check(athletes.some(a => a.id === r.athleteId) && (r.clubId === null || clubs.some(c => c.id === r.clubId)));
    check(["finished", "dns", "dnf", "dsq"].includes(str(r.status)));
    const classificationIds = rows(r.classificationIds, 1).map(id); // Known empty membership is preserved.
    check(classificationIds.every(c => classifications.some(d => d.id === c && d.competitionId === race.competitionId)));
    const finishTimeMs = r.finishTimeMs === null ? null : uint(r.finishTimeMs), rankOverall = r.rankOverall === null ? null : int(r.rankOverall, 1);
    check(r.status !== "finished" || (finishTimeMs !== null && BigInt(finishTimeMs) > 0n && rankOverall !== null));
    return { id: id(r.id), registrationId: id(r.registrationId), raceId: race.id, athleteId: id(r.athleteId), clubId: r.clubId === null ? null : id(r.clubId),
      publicationId: id(r.publicationId), runId: id(r.runId), status: r.status as FiveRoundCopyV1["results"][number]["status"], finishTimeMs, rankOverall, classificationIds };
  });
  for (const collection of [athletes, clubs, policies, classifications, races, results]) unique(collection.map(r => r.id));
  unique(results.map(r => r.registrationId));
  for (const race of races) check(results.filter(r => r.raceId === race.id).length === race.resultCount);
  check(athletes.every(a => results.some(r => r.athleteId === a.id)) && clubs.every(c => results.some(r => r.clubId === c.id)));
  return { version: "raceson-five-round-copy-v1", batchSha256: hash(o.batchSha256), sportingSha256: hash(o.sportingSha256),
    leagueId: id(o.leagueId), seasonId: id(o.seasonId), capturedAt: instant(o.capturedAt), closedAfterRound: 5, clubScoringScope: "combined",
    athletes, clubs, policies, classifications, races, results };
}

type Candidate = { beneficiaryId: string; name: string | null; order: number; evidenceIds: string[]; evidenceValue: number };
type Table = { slot: number | null; scope: "classification" | "combined_clubs"; classificationId: string | null; heldReason: string | null; candidates: Candidate[] };
export type FiveRoundCombinedSelection = { slot: number; athleteId: string; resultIds: string[]; keepResultId: string };
/** Explicit source-bound sporting choices affect combined rewards only. Both
 * published results and every classification table remain unchanged. */
export function selectFiveRoundCombinedFinishesV1(input: FiveRoundCopyV1, selections: readonly FiveRoundCombinedSelection[] = []) {
  const source = decodeFiveRoundCopyV1(input), finishes = source.results.filter(r => r.status === "finished");
  const excluded = new Set<string>(), seen = new Set<string>();
  for (const selection of selections) {
    const key = `${selection.slot}:${selection.athleteId}`;
    const actual = finishes.filter(r => r.athleteId === selection.athleteId && source.races.find(c => c.id === r.raceId)!.slot === selection.slot).map(r => r.id).sort();
    check(!seen.has(key) && actual.length > 1 && new Set(selection.resultIds).size === selection.resultIds.length
      && [...selection.resultIds].sort().join() === actual.join() && actual.includes(selection.keepResultId));
    seen.add(key); actual.filter(id => id !== selection.keepResultId).forEach(id => excluded.add(id));
  }
  return { finishes: finishes.filter(r => !excluded.has(r.id)), excludedResultIds: [...excluded].sort() };
}
export function previewFiveRoundCopyV1(input: FiveRoundCopyV1, selections: readonly FiveRoundCombinedSelection[] = []) {
  const source = decodeFiveRoundCopyV1(input), raceById = new Map(source.races.map(r => [r.id, r]));
  const finishes = source.results.filter(r => r.status === "finished");
  const combined = selectFiveRoundCombinedFinishesV1(source, selections), included = new Set(combined.finishes.map(r => r.id));
  const tables: Table[] = [], scored: Array<LeagueScoringEntry & { leaguePoints: number; resultId: string }> = [];
  const duplicateSlots = new Set<number>();
  for (let slot = 1; slot <= 5; slot++) {
    const ids = combined.finishes.filter(r => raceById.get(r.raceId)!.slot === slot).map(r => r.athleteId);
    if (new Set(ids).size !== ids.length) duplicateSlots.add(slot);
  }
  for (const category of source.classifications) {
    const policy = source.policies.find(p => p.id === category.competitionId)!;
    const entries: Array<LeagueScoringEntry & { resultId: string }> = [];
    let categoryHeld = false;
    for (let slot = 1; slot <= 5; slot++) {
      const results = finishes.filter(r => raceById.get(r.raceId)!.slot === slot && r.classificationIds.includes(category.id))
        .sort((a, b) => a.rankOverall! - b.rankOverall! || a.id.localeCompare(b.id));
      const heldReason = new Set(results.map(r => r.athleteId)).size !== results.length ? "duplicate_classified_finish" : null;
      categoryHeld ||= heldReason !== null;
      let rank = 0;
      const ranked = results.map((r, i) => {
        if (i === 0 || results[i - 1]!.rankOverall !== r.rankOverall) rank = i + 1;
        const athlete = source.athletes.find(a => a.id === r.athleteId)!, club = source.clubs.find(c => c.id === r.clubId);
        return { athleteId: r.athleteId, athleteSlug: athlete.username, name: athlete.name, club: club?.name ?? "Independent", clubSlug: r.clubId,
          // Compatibility-only unknown values; membership is never inferred from demographics.
          gender: "U" as const, ageCategory: "", roundNumber: slot, roundStatus: "completed" as const, participationStatus: "finished", overall: rank, resultId: r.id };
      });
      entries.push(...ranked);
      scored.push(...ranked.map(r => ({ ...r, leaguePoints: pointsForLeaguePlace(r.overall, policy.points, policy.participationPoints) })));
      tables.push({ slot, scope: "classification", classificationId: category.id, heldReason, candidates: heldReason ? [] : ranked.map(r => ({ beneficiaryId: r.athleteId,
        name: r.name, order: r.overall, evidenceIds: [r.resultId], evidenceValue: r.overall })) });
    }
    const standings = categoryHeld ? [] : deriveLeagueStandings(entries, policy.points, policy.participationPoints, policy.bestN, policy.minimumRounds, policy.tieBreak).filter(r => r.eligible);
    // Shared scoring already orders the declared sporting tie-break fields; names never break reward ties.
    const signature = (r: typeof standings[number]) => [r.points, r.bestFinish, r.wins, r.lastRoundPoints].join(":");
    let rank = 0;
    tables.push({ slot: null, scope: "classification", classificationId: category.id, heldReason: categoryHeld ? "duplicate_classified_finish" : null,
      candidates: standings.map((r, i) => { if (i === 0 || signature(r) !== signature(standings[i - 1]!)) rank = i + 1;
        return { beneficiaryId: r.athleteId, name: r.name, order: rank, evidenceIds: entries.filter(e => e.athleteId === r.athleteId).map(e => e.resultId), evidenceValue: r.points }; }) });
  }
  for (const slot of [1, 2, 3, 4, 5, null]) {
    const heldReason = (slot === null ? duplicateSlots.size > 0 : duplicateSlots.has(slot)) ? "duplicate_round_finish_requires_review" : null;
    const selected = scored.filter(r => included.has(r.resultId) && (slot === null || r.roundNumber === slot));
    const standings = heldReason ? [] : deriveLeagueClubStandings(selected, [], 0, "best_three");
    let rank = 0;
    tables.push({ slot, scope: "combined_clubs", classificationId: null, heldReason, candidates: standings.map((r, i) => {
      if (i === 0 || r.points !== standings[i - 1]!.points || r.scoredRounds !== standings[i - 1]!.scoredRounds) rank = i + 1;
      return { beneficiaryId: r.clubSlug, name: r.club, order: rank, evidenceValue: r.points, evidenceIds: selected.filter(e => e.clubSlug === r.clubSlug).map(e => e.resultId) };
    }) });
  }
  const participation = [1, 2, 3, 4, 5, null].map(slot => {
    const results = combined.finishes.filter(r => slot === null || raceById.get(r.raceId)!.slot === slot);
    const heldReason = (slot === null ? duplicateSlots.size > 0 : duplicateSlots.has(slot)) ? "duplicate_round_finish_requires_review" : null;
    const missingDistance = results.some(r => raceById.get(r.raceId)!.distanceMetres === null);
    return { slot, heldReason, distanceHeldReason: heldReason ?? (missingDistance ? "missing_distance" : null),
      rows: heldReason ? [] : source.athletes.flatMap(a => { const own = results.filter(r => r.athleteId === a.id); return own.length ? [{ athleteId: a.id, finishes: own.length,
        distanceMetres: missingDistance ? null : own.reduce((n, r) => n + BigInt(raceById.get(r.raceId)!.distanceMetres!), 0n).toString(), evidenceIds: own.map(r => r.id) }] : []; }) };
  });
  return { version: "raceson-five-round-copy-preview-v1" as const, state: "unapproved" as const, payableWei: 0n,
    batchSha256: source.batchSha256, tables, participation,
    counts: { rounds: 5, results: source.results.length, finishes: finishes.length, unclassifiedFinishes: finishes.filter(r => !r.classificationIds.length).length },
    duplicateFinishSlots: [...duplicateSlots].sort(), combinedFinishCount: combined.finishes.length, excludedCombinedResultIds: combined.excludedResultIds };
}

/** Quotes one explicit prize table. Does not approve or persist an allocation. */
export function quoteFiveRoundCopyPrizesV1(input: FiveRoundCopyV1, selector: { slot: number | null; classificationId: string | null }, slots: Array<{ rank: number; amountWei: bigint }>) {
  check(slots.length > 0 && slots.length <= 100 && slots.every((s, i) => s.rank === i + 1 && typeof s.amountWei === "bigint" && s.amountWei >= 0n));
  const preview = previewFiveRoundCopyV1(input), table = preview.tables.find(t => t.slot === selector.slot && t.classificationId === selector.classificationId);
  check(table);
  return { state: "unapproved" as const, payableWei: 0n, heldReason: table.heldReason,
    ...(table.heldReason ? { awards: [], unusedWei: slots.reduce((n, s) => n + s.amountWei, 0n) } : previewPublishedPrizeSlots(slots, table.candidates)) };
}
