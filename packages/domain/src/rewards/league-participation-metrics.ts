import { compareRewardKeys } from "./arithmetic.js";
import { decodeStoredRewardSnapshot, type StoredRewardSnapshot } from "./published-preview-v2.js";

export type ParticipationMetric = "athlete_finishes" | "athlete_metres" | "club_metres";
export type ParticipationIssueCode = "duplicate_athlete_round" | "missing_distance" |
  "unknown_outcome" | "invalid_finish_time" | "unclassified_finish" | "unattributed_club";
export type ParticipationIssue = {
  code: ParticipationIssueCode; round: number; athleteId: string;
  resultIds: string[]; affects: ParticipationMetric[];
};
export type ParticipationContribution = {
  resultId: string; publicationId: string; raceId: string; raceName: string;
  round: number; athleteId: string; athleteName: string | null;
  clubId: string | null; clubName: string | null; metres: string | null;
};
export type ParticipationAthlete = {
  id: string; name: string | null; rawFinishes: number; finishedRounds: number;
  rawMetres: string; missingDistances: number; resultIds: string[];
};
export type ParticipationClub = {
  id: string; name: string | null; athletes: number; rawFinishes: number;
  rawMetres: string; missingDistances: number; resultIds: string[];
};
export type LeagueParticipationMetrics = {
  version: 1; state: "historical_progress"; sourceKind: "published_import" | "synthetic_rehearsal";
  sourceHash: string; capturedAt: string; sourceSeasonId: string; sourceLeagueId: string;
  plannedRounds: 5; availableRounds: number;
  summary: {
    resultRows: number; rawFinishes: number; athletes: number; clubs: number;
    finishedAthleteRounds: number; duplicateAthleteRounds: number;
    missingDistances: number; unattributedFinishes: number; unclassifiedFinishes: number;
    rawMetres: string; rawClubMetres: string; rawUnattributedMetres: string;
  };
  rounds: Array<{
    slot: number; id: string; name: string; date: string; rawFinishes: number;
    rawMetres: string; missingDistances: number;
    races: Array<{ id: string; name: string; metres: string | null }>;
  }>;
  athletes: ParticipationAthlete[]; clubs: ParticipationClub[];
  contributions: ParticipationContribution[]; issues: ParticipationIssue[];
};

/** Source diagnostics only. Raw contributions remain inspectable even when
 * ambiguous. This projection cannot authorize a rule, denominator or payment.
 * Sporting identity is never inferred from names, accounts or current clubs. */
export function deriveLeagueParticipationMetrics(
  input: StoredRewardSnapshot, sourceHash: string,
): LeagueParticipationMetrics {
  if (!/^[0-9a-f]{64}$/.test(sourceHash)) throw new Error("invalid_reward_metric_source");
  const source = decodeStoredRewardSnapshot(input);
  const races = new Map(source.catalogue.rounds.flatMap(round => round.races.map(race =>
    [race.id, { ...race, slot: round.slot }] as const)));
  const byAthleteRound = new Map<string, typeof source.results>();
  const contributions: ParticipationContribution[] = [], issues: ParticipationIssue[] = [];
  const allMetrics: ParticipationMetric[] = ["athlete_finishes", "athlete_metres", "club_metres"];
  for (const result of source.results) {
    const race = races.get(result.raceId)!;
    const key = `${race.slot}:${result.athleteId}`;
    const entries = byAthleteRound.get(key) ?? [];
    entries.push(result); byAthleteRound.set(key, entries);
    const issue = (code: ParticipationIssueCode, affects: ParticipationMetric[]) => issues.push({
      code, round: race.slot, athleteId: result.athleteId, resultIds: [result.id], affects,
    });
    if (!["finished", "dns", "dnf", "dsq"].includes(result.participationStatus ?? "")) {
      issue("unknown_outcome", allMetrics); continue;
    }
    if (result.participationStatus !== "finished") continue;
    if (result.finishTimeMs === null || result.finishTimeMs <= 0) {
      issue("invalid_finish_time", allMetrics); continue;
    }
    if (race.distanceMetres === null) issue("missing_distance", ["athlete_metres", "club_metres"]);
    if (!result.classificationIds.length) issue("unclassified_finish", []);
    if (result.clubId === null) issue("unattributed_club", ["club_metres"]);
    contributions.push({ resultId: result.id, publicationId: result.publicationId,
      raceId: race.id, raceName: race.name, round: race.slot, athleteId: result.athleteId,
      athleteName: result.athleteName, clubId: result.clubId, clubName: result.clubName,
      metres: race.distanceMetres });
  }
  for (const group of byAthleteRound.values()) if (group.length > 1) {
    issues.push({ code: "duplicate_athlete_round", round: races.get(group[0]!.raceId)!.slot,
      athleteId: group[0]!.athleteId, resultIds: group.map(r => r.id).sort(compareRewardKeys), affects: allMetrics });
  }
  contributions.sort((a, b) => a.round - b.round || compareRewardKeys(a.resultId, b.resultId));
  issues.sort((a, b) => a.round - b.round || compareRewardKeys(a.athleteId, b.athleteId) || compareRewardKeys(a.code, b.code));
  const sumMetres = (rows: ParticipationContribution[]) => rows.reduce((n, r) => n + BigInt(r.metres ?? "0"), 0n).toString();
  const groupContributions = (key: (row: ParticipationContribution) => string | null) => {
    const groups = new Map<string, ParticipationContribution[]>();
    for (const row of contributions) {
      const id = key(row); if (id === null) continue;
      const entries = groups.get(id) ?? []; entries.push(row); groups.set(id, entries);
    }
    return [...groups].sort(([a], [b]) => compareRewardKeys(a, b));
  };
  const athletes = groupContributions(r => r.athleteId).map(([id, rows]): ParticipationAthlete => ({
    id, name: rows[0]!.athleteName, rawFinishes: rows.length, finishedRounds: new Set(rows.map(r => r.round)).size,
    rawMetres: sumMetres(rows), missingDistances: rows.filter(r => r.metres === null).length,
    resultIds: rows.map(r => r.resultId),
  }));
  const clubs = groupContributions(r => r.clubId).map(([id, rows]): ParticipationClub => ({
    id, name: rows[0]!.clubName, athletes: new Set(rows.map(r => r.athleteId)).size,
    rawFinishes: rows.length, rawMetres: sumMetres(rows), missingDistances: rows.filter(r => r.metres === null).length,
    resultIds: rows.map(r => r.resultId),
  }));
  return {
    version: 1, state: "historical_progress", sourceKind: source.version === 2 ? "published_import" : "synthetic_rehearsal",
    sourceHash, capturedAt: source.capturedAt, sourceSeasonId: source.sourceSeasonId, sourceLeagueId: source.sourceLeagueId,
    plannedRounds: 5, availableRounds: source.catalogue.rounds.length,
    summary: { resultRows: source.results.length, rawFinishes: contributions.length, athletes: athletes.length, clubs: clubs.length,
      finishedAthleteRounds: athletes.reduce((n, a) => n + a.finishedRounds, 0),
      duplicateAthleteRounds: issues.filter(i => i.code === "duplicate_athlete_round").length,
      missingDistances: contributions.filter(r => r.metres === null).length,
      unattributedFinishes: contributions.filter(r => r.clubId === null).length,
      unclassifiedFinishes: issues.filter(i => i.code === "unclassified_finish").length,
      rawMetres: sumMetres(contributions), rawClubMetres: sumMetres(contributions.filter(r => r.clubId !== null)),
      rawUnattributedMetres: sumMetres(contributions.filter(r => r.clubId === null)) },
    rounds: source.catalogue.rounds.map(round => {
      const rows = contributions.filter(r => r.round === round.slot);
      return { slot: round.slot, id: round.id, name: round.name, date: round.date, rawFinishes: rows.length,
        rawMetres: sumMetres(rows), missingDistances: rows.filter(r => r.metres === null).length,
        races: round.races.map(r => ({ id: r.id, name: r.name, metres: r.distanceMetres })) };
    }), athletes, clubs, contributions, issues,
  };
}
