import { parseRewardUnits, requireRewardKey, type RewardSourceConfiguration } from "@raceson/domain/rewards";
import type { RewardSportingReviewBody } from "./programme-ledger.js";

export class RewardDocumentError extends Error {
  constructor(readonly code: string) { super(code); this.name = "RewardDocumentError"; }
}
function demand(condition: unknown): asserts condition {
  if (!condition) throw new RewardDocumentError("invalid_reward_stored_document");
}
/** Strict private transport decoding, not chain canonicalization. Pick fields
 * explicitly; reject unknown fields, lossy integers and executable serializers. */
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  demand(value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
  const descriptors = Object.getOwnPropertyDescriptors(value);
  demand(Object.getOwnPropertySymbols(value).length === 0 && Object.keys(descriptors).length === keys.length
    && keys.every((key) => descriptors[key]?.enumerable && "value" in descriptors[key]));
  return value as Record<string, unknown>;
}
export { object as rewardDocumentObject };
function array<T>(value: unknown, max: number, decode: (raw: unknown) => T): T[] {
  demand(Array.isArray(value) && value.length <= max);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  demand(Object.getOwnPropertySymbols(value).length === 0 && Object.keys(descriptors).length === value.length + 1);
  return Array.from({ length: value.length }, (_, index) => {
    const field = descriptors[String(index)]; demand(field?.enumerable && "value" in field); return decode(field.value);
  });
}
export { array as rewardDocumentArray };
export function rewardDocumentUuid(value: unknown): string {
  demand(typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    && value !== "00000000-0000-0000-0000-000000000000"); return value;
}
function key(value: unknown): string {
  try { requireRewardKey(value as string); } catch { throw new RewardDocumentError("invalid_reward_stored_document"); }
  return value as string;
}
export function rewardDocumentInteger(value: unknown): bigint {
  demand(typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value));
  try { return parseRewardUnits(value, 0); } catch { throw new RewardDocumentError("invalid_reward_stored_document"); }
}
const nullableInteger = (value: unknown) => value === null ? null : rewardDocumentInteger(value);
function number(value: unknown, min: number, max: number): number {
  demand(typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max); return value;
}
function unique<T>(values: T[], getKey: (row: T) => string): T[] {
  demand(new Set(values.map(getKey)).size === values.length); return values;
}
const uuid = rewardDocumentUuid;
const ids = (value: unknown, max: number) => unique(array(value, max, uuid), (id) => id);

/** The full operated programme always has five frozen rounds, not a preview subset. */
export function decodeRewardConfiguration(value: unknown): RewardSourceConfiguration {
  const raw = object(value, ["organizationId", "leagueId", "seasonId", "year", "rounds", "competitions", "classifications"]);
  const competitions = unique(array(raw.competitions, 2, (value) => {
    const row = object(value, ["id", "scoringTarget", "resultBasis"]);
    demand(row.scoringTarget === "individual");
    return { id: uuid(row.id), scoringTarget: "individual" as const, resultBasis: key(row.resultBasis) };
  }), (row) => row.id);
  demand(competitions.length === 2);
  const classifications = unique(array(raw.classifications, 7, (value) => {
    const row = object(value, ["id", "competitionId", "gender", "minimumAgeHundredths", "maximumAgeHundredths"]);
    demand(row.gender === null || row.gender === "M" || row.gender === "F");
    const minimumAgeHundredths = nullableInteger(row.minimumAgeHundredths); const maximumAgeHundredths = nullableInteger(row.maximumAgeHundredths);
    demand((minimumAgeHundredths === null || minimumAgeHundredths <= 15000n)
      && (maximumAgeHundredths === null || maximumAgeHundredths <= 15000n)
      && (minimumAgeHundredths === null || maximumAgeHundredths === null || minimumAgeHundredths <= maximumAgeHundredths));
    const competitionId = uuid(row.competitionId); demand(competitions.some((item) => item.id === competitionId));
    const gender: "M" | "F" | null = row.gender;
    return { id: uuid(row.id), competitionId, gender, minimumAgeHundredths, maximumAgeHundredths };
  }), (row) => row.id);
  demand(classifications.length === 7);
  const rounds = unique(array(raw.rounds, 5, (value) => {
    const row = object(value, ["id", "number", "eventEditionId", "races"]);
    const races = unique(array(row.races, 2, (value) => {
      const race = object(value, ["id", "mappingId", "competitionId", "distanceMetres", "trackVersionId", "courseFormat", "lapCount"]);
      demand(race.courseFormat === "standard" || race.courseFormat === "laps");
      const lapCount = number(race.lapCount, 1, 100);
      const distanceMetres = rewardDocumentInteger(race.distanceMetres);
      demand(distanceMetres > 0n && (race.courseFormat === "standard" ? lapCount === 1 : lapCount >= 2));
      const courseFormat: "standard" | "laps" = race.courseFormat;
      return { id: uuid(race.id), mappingId: uuid(race.mappingId), competitionId: uuid(race.competitionId), distanceMetres,
        trackVersionId: uuid(race.trackVersionId), courseFormat, lapCount };
    }), (race) => race.id);
    demand(races.length === 2 && competitions.every((competition) => races.some((race) => race.competitionId === competition.id)));
    return { id: uuid(row.id), number: number(row.number, 1, 5), eventEditionId: uuid(row.eventEditionId), races };
  }), (round) => round.id);
  demand(rounds.length === 5 && new Set(rounds.map((round) => round.number)).size === 5);
  unique(rounds.flatMap((round) => round.races), (race) => race.id);
  unique(rounds.flatMap((round) => round.races), (race) => race.mappingId);
  return { organizationId: uuid(raw.organizationId), leagueId: uuid(raw.leagueId), seasonId: uuid(raw.seasonId),
    year: number(raw.year, 2000, 2200), rounds, competitions, classifications };
}

/** Review wire integers are decimal strings. Athlete/club IDs stay UUIDs, while
 * separately reviewed evidence references are opaque bounded keys, not authority. */
export function decodeRewardSportingReview(value: unknown): RewardSportingReviewBody {
  const raw = object(value, ["schemaVersion", "adjudications", "roundReviews"]); demand(raw.schemaVersion === 1);
  let entries = 0;
  const bounded = <T>(value: unknown, decode: (row: unknown) => T) => array(value, 20000, (row) => {
    demand(++entries <= 100000); return decode(row);
  });
  const adjudications = unique(bounded(raw.adjudications, (value) => {
    const row = object(value, ["roundId", "athleteId", "sourceIds", "selectedSourceId", "approvalId"]);
    const sourceIds = ids(row.sourceIds, 20000); entries += sourceIds.length; demand(entries <= 100000 && sourceIds.length > 0);
    const selectedSourceId = row.selectedSourceId === null ? null : uuid(row.selectedSourceId);
    demand(selectedSourceId === null || sourceIds.includes(selectedSourceId));
    return { roundId: uuid(row.roundId), athleteId: uuid(row.athleteId), sourceIds, selectedSourceId, approvalId: key(row.approvalId) };
  }), (row) => `${row.roundId}:${row.athleteId}`);
  const roundReviews = unique(array(raw.roundReviews, 5, (value) => {
    const row = object(value, ["roundId", "podiums", "records", "memberships"]);
    const podiums = unique(array(row.podiums, 7, (value) => {
      const podium = object(value, ["classificationId", "approvalId", "entries"]);
      return { classificationId: uuid(podium.classificationId), approvalId: key(podium.approvalId),
        entries: unique(bounded(podium.entries, (value) => {
          const entry = object(value, ["sourceId", "rank"]);
          return { sourceId: uuid(entry.sourceId), rank: number(entry.rank, 1, 20000) };
        }), (entry) => entry.sourceId) };
    }), (podium) => podium.classificationId);
    const memberships = unique(bounded(row.memberships, (value) => {
      const member = object(value, ["sourceId", "classificationIds", "evidenceId"]);
      return { sourceId: uuid(member.sourceId), classificationIds: ids(member.classificationIds, 7), evidenceId: key(member.evidenceId) };
    }), (member) => member.sourceId);
    const records = unique(array(row.records, 4, (value) => {
      const record = object(value, ["id", "raceId", "gender", "baseline"]); demand(record.gender === "M" || record.gender === "F");
      let baseline = null;
      if (record.baseline !== null) {
        const prior = object(record.baseline, ["approvalId", "publicationId", "establishedAtMs", "finishTimeMs", "courseComparisonKey"]);
        const finishTimeMs = rewardDocumentInteger(prior.finishTimeMs); demand(finishTimeMs > 0n);
        baseline = { approvalId: key(prior.approvalId), publicationId: uuid(prior.publicationId),
          establishedAtMs: rewardDocumentInteger(prior.establishedAtMs), finishTimeMs, courseComparisonKey: key(prior.courseComparisonKey) };
      }
      const gender: "M" | "F" = record.gender;
      return { id: key(record.id), raceId: uuid(record.raceId), gender, baseline };
    }), (record) => record.id);
    return { roundId: uuid(row.roundId), podiums, memberships, records };
  }), (row) => row.roundId);
  return { schemaVersion: 1, adjudications, roundReviews };
}
