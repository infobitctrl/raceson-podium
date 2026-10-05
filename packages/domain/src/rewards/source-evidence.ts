import { compareRewardKeys, parseRewardUnits, requireReward, requireRewardKey, requireUnsigned } from "./arithmetic.js";
import { type RewardPodiumManifest } from "./calculator.js";
import { selectRewardFinishes, type RewardAdjudication, type RewardFinish } from "./eligibility.js";
import { allocateRewardPodium } from "./ranking.js";

type JsonObject = Record<string, unknown>;
export type RewardClassificationRule = {
  id: string; competitionId: string; gender: "M" | "F" | null;
  minimumAgeHundredths: bigint | null; maximumAgeHundredths: bigint | null;
};
/** Server-owned frozen sporting configuration. Never derive it from the same
 * snapshot being checked, or accept it from an athlete's request body. */
export type RewardSourceConfiguration = {
  organizationId: string; leagueId: string; seasonId: string; year: number;
  rounds: readonly {
    id: string; number: number; eventEditionId: string;
    races: readonly {
      id: string; mappingId: string; competitionId: string; distanceMetres: bigint;
      trackVersionId: string; courseFormat: "standard" | "laps"; lapCount: number;
    }[];
  }[];
  competitions: readonly { id: string; scoringTarget: "individual"; resultBasis: string }[];
  classifications: readonly RewardClassificationRule[];
};
export type RewardSourceDiagnostic = {
  code: "age_membership_review" | "gender_membership_review" | "race_start_missing" | "publication_signature_unverified" | "open_adjudication";
  roundId: string; sourceId: string;
};
export type AdaptedRewardEvidence = {
  snapshotId: string; sourceFingerprintSha256: string;
  finishes: RewardFinish[];
  /** Potential additional memberships, not automatic exclusions or payout holds. */
  uncertainMemberships: { sourceId: string; classificationIds: string[] }[];
  rounds: {
    id: string; classificationIds: string[]; raceStartTimes: [string, bigint | null][];
    latestPublicationAt: bigint; sourceReviewEndsAt: bigint; openCaseIds: string[];
  }[];
  diagnostics: RewardSourceDiagnostic[];
};

function object(value: unknown): JsonObject {
  requireReward(value !== null && typeof value === "object" && !Array.isArray(value), "invalid_reward_source_object");
  return value as JsonObject;
}
function key(value: unknown): string { requireRewardKey(value as string); return value as string; }
function array(value: unknown, max = 20_000): JsonObject[] {
  requireReward(Array.isArray(value) && value.length <= max, "invalid_reward_source_array");
  return value.map(object);
}
function integer(value: unknown): bigint {
  requireReward(typeof value === "string", "reward_source_integer_string_required");
  return parseRewardUnits(value, 0);
}
function nullableInteger(value: unknown): bigint | null { return value === null ? null : integer(value); }
function unique<T>(rows: readonly T[], id: (row: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) { const value = key(id(row)); requireReward(!result.has(value), "duplicate_reward_source_key"); result.set(value, row); }
  return result;
}
function sameKeys(actual: readonly string[], expected: readonly string[], code: string): void {
  requireReward(JSON.stringify([...actual].sort(compareRewardKeys)) === JSON.stringify([...expected].sort(compareRewardKeys)), code);
}

/** SQL reader uses UTC. Reject permissive Date.parse normalization; retain
 * microseconds until rounding publication deadlines UP to on-chain seconds. */
export function parseRewardSourceTimestamp(value: unknown): bigint {
  requireReward(typeof value === "string", "invalid_reward_source_timestamp");
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  requireReward(match, "invalid_reward_source_timestamp");
  const ms = Date.parse(`${match[1]}Z`);
  requireReward(Number.isSafeInteger(ms) && ms >= 0 && new Date(ms).toISOString() === `${match[1]}.000Z`, "invalid_reward_source_timestamp");
  return BigInt(ms) * 1000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
}

function identity(row: JsonObject, club: boolean): { id: string; path: string[] } {
  const sourceId = key(row[club ? "representedClubId" : "sourceAthleteId"]);
  const id = key(row[club ? "canonicalClubId" : "canonicalAthleteId"]);
  const path = row[club ? "clubIdentityPath" : "identityPath"];
  requireReward(Array.isArray(path) && path.length >= 1 && path.length <= 17, "unresolved_reward_identity");
  const ids = path.map(key);
  requireReward(ids[0] === sourceId && ids.at(-1) === id && new Set(ids).size === ids.length
    && row[club ? "clubIdentityCycle" : "identityCycle"] === false
    && row[club ? "unresolvedClubMergeId" : "unresolvedMergeId"] === null, "unresolved_reward_identity");
  return { id, path: ids };
}

function eligibility(value: unknown) {
  const rule = object(value);
  requireReward(Object.keys(rule).every((field) => ["gender", "minimumAge", "maximumAge"].includes(field)), "unsupported_reward_classification_rule");
  const gender = rule.gender === undefined ? null : rule.gender;
  requireReward(gender === null || gender === "M" || gender === "F", "unsupported_reward_classification_rule");
  const age = (value: unknown) => {
    if (value === undefined || value === null) return null;
    requireReward(typeof value === "number" && Number.isFinite(value), "unsupported_reward_classification_rule");
    const result = parseRewardUnits(String(value), 2);
    requireReward(result <= 15_000n, "unsupported_reward_classification_rule");
    return result;
  };
  return { gender, minimumAgeHundredths: age(rule.minimumAge), maximumAgeHundredths: age(rule.maximumAge) };
}

/** PRIVATE preview conversion only. This does not approve results, authenticate
 * signatures, prove source freshness, reserve contributions or authorize payment. */
export function adaptRewardSourceEvidence(
  snapshot: { snapshotId: string; sourceFingerprintSha256: string; source: unknown },
  config: RewardSourceConfiguration,
): AdaptedRewardEvidence {
  key(snapshot.snapshotId);
  requireReward(/^[0-9a-f]{64}$/.test(snapshot.sourceFingerprintSha256), "invalid_reward_source_fingerprint");
  for (const id of [config.organizationId, config.leagueId, config.seasonId]) key(id);
  requireReward(Number.isInteger(config.year) && config.year >= 2000 && config.year <= 2200, "invalid_reward_season_year");
  const expectedRounds = unique(config.rounds, (row) => row.id);
  const expectedCompetitions = unique(config.competitions, (row) => row.id);
  const expectedClasses = unique(config.classifications, (row) => row.id);
  requireReward(expectedRounds.size >= 1 && expectedRounds.size <= 5 && expectedCompetitions.size === 2 && expectedClasses.size === 7,
    "invalid_reward_programme_configuration");
  const expectedRaces = unique(config.rounds.flatMap((round) => round.races.map((race) => ({ ...race, roundId: round.id }))), (row) => row.id);
  unique([...expectedRaces.values()], (row) => row.mappingId);
  for (const round of config.rounds) {
    key(round.eventEditionId);
    requireReward(Number.isInteger(round.number) && round.number >= 1 && round.number <= 5, "invalid_reward_round_number");
    sameKeys(round.races.map((race) => race.competitionId), [...expectedCompetitions.keys()], "invalid_reward_round_competitions");
  }
  requireReward(new Set(config.rounds.map((round) => round.number)).size === config.rounds.length, "invalid_reward_round_number");
  for (const rule of config.classifications) {
    requireReward(expectedCompetitions.has(rule.competitionId) && [null, "M", "F"].includes(rule.gender), "invalid_reward_classification_configuration");
    for (const age of [rule.minimumAgeHundredths, rule.maximumAgeHundredths]) if (age !== null) {
      requireUnsigned(age); requireReward(age <= 15_000n, "invalid_reward_classification_configuration");
    }
    requireReward(rule.minimumAgeHundredths === null || rule.maximumAgeHundredths === null
      || rule.minimumAgeHundredths <= rule.maximumAgeHundredths, "invalid_reward_classification_configuration");
  }
  const source = object(snapshot.source); const season = object(source.season);
  requireReward(source.schemaVersion === 1 && season.id === config.seasonId && season.organizationId === config.organizationId
    && season.leagueId === config.leagueId && season.year === config.year, "reward_source_scope_mismatch");
  const rounds = unique(array(source.rounds, 5), (row) => key(row.id));
  sameKeys([...rounds.keys()], [...expectedRounds.keys()], "reward_source_rounds_mismatch");
  const mappings = unique(array(source.mappings, 10), (row) => key(row.id));
  sameKeys([...mappings.keys()], [...expectedRaces.values()].map((race) => race.mappingId), "reward_source_mappings_mismatch");
  const competitions = unique(array(source.competitions, 2), (row) => key(row.id));
  sameKeys([...competitions.keys()], [...expectedCompetitions.keys()], "reward_source_competitions_mismatch");
  for (const [id, row] of competitions) {
    const expected = expectedCompetitions.get(id)!;
    requireReward(row.status === "active" && row.seasonId === config.seasonId && row.scoringTarget === expected.scoringTarget
      && row.resultBasis === expected.resultBasis, "reward_competition_configuration_changed");
  }
  const classifications = unique(array(source.classifications, 100), (row) => key(row.id));
  sameKeys([...classifications.values()].filter((row) => row.status === "active").map((row) => key(row.id)),
    [...expectedClasses.keys()], "reward_source_classifications_mismatch");
  for (const [id, expected] of expectedClasses) {
    const row = classifications.get(id)!; const actual = eligibility(row.eligibility);
    requireReward(row.competitionId === expected.competitionId && actual.gender === expected.gender
      && actual.minimumAgeHundredths === expected.minimumAgeHundredths && actual.maximumAgeHundredths === expected.maximumAgeHundredths,
    "reward_classification_configuration_changed");
  }
  const result: AdaptedRewardEvidence = { snapshotId: snapshot.snapshotId, sourceFingerprintSha256: snapshot.sourceFingerprintSha256,
    finishes: [], uncertainMemberships: [], rounds: [], diagnostics: [] };
  const diagnostic = (code: RewardSourceDiagnostic["code"], roundId: string, sourceId: string) => result.diagnostics.push({ code, roundId, sourceId });
  for (const [id, row] of rounds) {
    const expected = expectedRounds.get(id)!;
    requireReward(row.number === expected.number && row.eventEditionId === expected.eventEditionId && row.status === "completed"
      && row.isPractice === false && row.organizerDeletedAt === null && row.eventStatus !== "cancelled", "reward_round_not_ready");
    const state: AdaptedRewardEvidence["rounds"][number] = {
      id, classificationIds: [...expectedClasses.keys()].sort(compareRewardKeys), raceStartTimes: [],
      latestPublicationAt: 0n, sourceReviewEndsAt: 0n, openCaseIds: [],
    };
    for (const race of expected.races) {
      const mapping = mappings.get(race.mappingId)!;
      const publication = object(mapping.publication); const run = object(mapping.run);
      requireReward(mapping.raceId === race.id && mapping.roundId === id && mapping.competitionId === race.competitionId
        && mapping.status === "mapped" && mapping.raceEditionId === expected.eventEditionId
        && mapping.raceStatus !== "cancelled" && mapping.organizerDeletedAt === null && mapping.resultsMode === "standard",
      "reward_mapping_source_not_ready");
      requireReward(mapping.publicationId === key(publication.id) && mapping.latestPublicationId === publication.id
        && publication.raceId === race.id && publication.runId === key(run.id) && run.raceId === race.id
        && run.status === "succeeded" && ["official", "corrected"].includes(String(publication.state)), "reward_publication_not_ready");
      const published = parseRewardSourceTimestamp(publication.publishedAt);
      requireReward(parseRewardSourceTimestamp(run.completedAt) <= published, "reward_publication_precedes_run");
      const publicationAt = (published + 999_999n) / 1_000_000n;
      if (publicationAt > state.latestPublicationAt) state.latestPublicationAt = publicationAt;
      // Even `signed` is metadata, not cryptographic verification of the artifact.
      diagnostic("publication_signature_unverified", id, key(publication.id));
      const startsAt = mapping.startAt === null ? null : parseRewardSourceTimestamp(mapping.startAt) / 1000n;
      if (startsAt === null) diagnostic("race_start_missing", id, race.id);
      else requireReward(startsAt * 1000n <= published, "reward_publication_precedes_race");
      state.raceStartTimes.push([race.id, startsAt]);
      requireUnsigned(race.distanceMetres);
      requireReward(race.distanceMetres > 0n && integer(mapping.distanceMetres) === race.distanceMetres
        && mapping.trackVersionId === key(race.trackVersionId) && mapping.courseFormat === race.courseFormat
        && Number.isInteger(race.lapCount) && race.lapCount >= 1 && race.lapCount <= 100 && mapping.lapCount === race.lapCount
        && ["standard", "laps"].includes(race.courseFormat) && (race.courseFormat !== "standard" || race.lapCount === 1)
        && (race.courseFormat !== "laps" || race.lapCount >= 2)
        && integer(mapping.trackMetres) * BigInt(race.lapCount) === race.distanceMetres, "reward_course_configuration_changed");
    }
    state.raceStartTimes.sort(([a], [b]) => compareRewardKeys(a, b));
    state.sourceReviewEndsAt = state.latestPublicationAt + 72n * 60n * 60n;
    result.rounds.push(state);
  }
  for (const item of unique(array(source.adjudicationCases), (row) => key(row.id)).values()) {
    const race = expectedRaces.get(key(item.raceId));
    requireReward(race && typeof item.recomputeRequired === "boolean", "invalid_reward_adjudication_source");
    if (!["closed", "withdrawn"].includes(String(item.state)) || item.recomputeRequired) {
      result.rounds.find((round) => round.id === race.roundId)!.openCaseIds.push(key(item.id));
      diagnostic("open_adjudication", race.roundId, key(item.id));
    }
  }
  const rows = unique(array(source.rows), (row) => key(row.id));
  for (const [sourceId, row] of rows) {
    const race = expectedRaces.get(key(row.raceId));
    requireReward(race && row.roundId === race.roundId && row.mappingId === race.mappingId, "reward_row_mapping_mismatch");
    const mapping = mappings.get(race.mappingId)!;
    requireReward(row.publicationId === mapping.publicationId && row.resultRunId === object(mapping.run).id
      && row.registrationRaceId === race.id, "reward_row_provenance_mismatch");
    key(row.registrationId);
    const athlete = identity(row, false);
    requireReward(athlete.path.includes(key(row.registrationAthleteId)), "reward_registration_identity_mismatch");
    const clubId = row.representedClubId === null ? null : identity(row, true).id;
    const rawGender = typeof row.gender === "string" ? row.gender.trim().toUpperCase() : "";
    const gender = ["M", "MALE"].includes(rawGender) ? "M" : ["F", "FEMALE", "W"].includes(rawGender) ? "F" : "U";
    const years = [row.registrationBirthYear, row.profileBirthYear, row.profileDateBirthYear].filter((year) => year !== null);
    const validYears = years.every((year) => typeof year === "number" && Number.isInteger(year) && year >= 1900 && year <= config.year);
    const age = validYears && years.length > 0 && new Set(years).size === 1 ? BigInt(config.year - (years[0] as number)) * 100n : null;
    const classificationIds: string[] = []; const uncertain: string[] = [];
    for (const rule of config.classifications.filter((rule) => rule.competitionId === race.competitionId)) {
      if (gender !== "U" && rule.gender !== null && gender !== rule.gender) continue;
      if (age !== null && ((rule.minimumAgeHundredths !== null && age < rule.minimumAgeHundredths)
        || (rule.maximumAgeHundredths !== null && age > rule.maximumAgeHundredths))) continue;
      if ((gender === "U" && rule.gender !== null) || (age === null && (rule.minimumAgeHundredths !== null || rule.maximumAgeHundredths !== null))) uncertain.push(rule.id);
      else classificationIds.push(rule.id);
    }
    const finish: RewardFinish = {
      sourceId, publicationId: key(row.publicationId), roundId: race.roundId, raceId: race.id, athleteId: athlete.id,
      representedClubId: clubId, gender, classificationIds: classificationIds.sort(compareRewardKeys),
      courseComparisonKey: `course:${race.trackVersionId}:${race.courseFormat}:${race.lapCount}:${race.distanceMetres}`,
      distanceMetres: race.distanceMetres, finishTimeMs: nullableInteger(row.finishTimeMs), clubPoints: nullableInteger(row.clubPointsHundredths),
      participationStatus: key(row.participationStatus), resultStatus: key(row.resultStatus),
    };
    // Validate each finish without resolving duplicate athlete-rounds prematurely.
    const selected = selectRewardFinishes([finish]);
    if (selected.finishes.length && uncertain.length) {
      result.uncertainMemberships.push({ sourceId, classificationIds: uncertain.sort(compareRewardKeys) });
      if (age === null) diagnostic("age_membership_review", race.roundId, sourceId);
      if (gender === "U") diagnostic("gender_membership_review", race.roundId, sourceId);
    }
    result.finishes.push(finish);
  }
  result.finishes.sort((a, b) => compareRewardKeys(a.sourceId, b.sourceId));
  result.uncertainMemberships.sort((a, b) => compareRewardKeys(a.sourceId, b.sourceId));
  result.rounds.sort((a, b) => compareRewardKeys(a.id, b.id));
  result.rounds.forEach((round) => round.openCaseIds.sort(compareRewardKeys));
  result.diagnostics.sort((a, b) => compareRewardKeys(JSON.stringify([a.roundId, a.sourceId, a.code]), JSON.stringify([b.roundId, b.sourceId, b.code])));
  return result;
}

export type RewardRoundSportingReview = {
  snapshotId: string; sourceFingerprintSha256: string; approvalId: string;
  memberships: readonly { sourceId: string; classificationIds: readonly string[]; evidenceId: string }[];
  podiums: readonly RewardPodiumManifest[];
  adjudications?: readonly RewardAdjudication[];
};

/** Preview readiness on freshly re-read evidence; does not replace the contract's
 * independent 72-hour publication and 24-hour staged-allocation clocks. */
export function assertRewardSourceReviewElapsed(evidence: AdaptedRewardEvidence, roundIds: readonly string[], nowSeconds: bigint): void {
  requireUnsigned(nowSeconds);
  requireReward(roundIds.length >= 1 && roundIds.length <= 5 && new Set(roundIds).size === roundIds.length, "invalid_reward_review_scope");
  for (const id of roundIds) {
    const round = evidence.rounds.find((row) => row.id === id);
    requireReward(round, "invalid_reward_review_scope");
    requireReward(round.openCaseIds.length === 0, "reward_round_has_unresolved_adjudication");
    requireReward(nowSeconds >= round.sourceReviewEndsAt, "reward_publication_review_not_elapsed");
  }
}

/** Build inputs from a trusted persisted review, not an HTTP-supplied approval.
 * Coverage is mandatory: an omitted unknown-age/faster runner cannot silently
 * improve another runner's prize. The service still checks actor authority,
 * review signatures, current source fingerprint and release clocks at staging. */
export function reviewRewardRoundEvidence(evidence: AdaptedRewardEvidence, roundId: string, review: RewardRoundSportingReview) {
  requireReward(review.snapshotId === evidence.snapshotId && review.sourceFingerprintSha256 === evidence.sourceFingerprintSha256,
    "stale_reward_sporting_review");
  key(review.approvalId);
  const round = evidence.rounds.find((row) => row.id === roundId);
  requireReward(round && round.openCaseIds.length === 0, "reward_round_has_unresolved_adjudication");
  const selected = selectRewardFinishes(evidence.finishes.filter((row) => row.roundId === roundId), review.adjudications);
  const selectedIds = new Set(selected.finishes.map((row) => row.sourceId));
  const unknown = unique(evidence.uncertainMemberships.filter((row) => selectedIds.has(row.sourceId)), (row) => row.sourceId);
  const decisions = unique(review.memberships, (row) => row.sourceId);
  sameKeys([...decisions.keys()], [...unknown.keys()], "reward_membership_review_incomplete");
  const finishes = selected.finishes.map((row) => {
    const decision = decisions.get(row.sourceId);
    if (!decision) return { ...row, classificationIds: [...row.classificationIds] };
    key(decision.evidenceId);
    requireReward(new Set(decision.classificationIds).size === decision.classificationIds.length
      && row.classificationIds.length + decision.classificationIds.length <= 1
      && decision.classificationIds.every((id) => unknown.get(row.sourceId)!.classificationIds.includes(id)), "invalid_reviewed_reward_membership");
    return { ...row, classificationIds: [...row.classificationIds, ...decision.classificationIds].sort(compareRewardKeys) };
  });
  unique(review.podiums, (row) => row.classificationId);
  sameKeys(review.podiums.map((row) => row.classificationId), round.classificationIds, "reward_podium_review_incomplete");
  for (const podium of review.podiums) {
    key(podium.approvalId);
    sameKeys(podium.entries.map((row) => row.sourceId), finishes.filter((row) => row.classificationIds.includes(podium.classificationId)).map((row) => row.sourceId),
      "reward_podium_members_missing");
    allocateRewardPodium(0n, podium.entries.map((entry) => ({ key: entry.sourceId, rank: entry.rank })));
  }
  const reviewedBySource = new Map(finishes.map((row) => [row.sourceId, row]));
  return { finishes: evidence.finishes.filter((row) => row.roundId === roundId).map((row) =>
    reviewedBySource.get(row.sourceId) ?? { ...row, classificationIds: [...row.classificationIds] }),
    adjudications: review.adjudications?.map((decision) => ({ ...decision, sourceIds: [...decision.sourceIds] })),
    excludedSourceIds: selected.excludedSourceIds, raceStartsAtMs: null,
    raceStartTimes: new Map(round.raceStartTimes), latestPublicationAt: round.latestPublicationAt,
    sourceReviewEndsAt: round.sourceReviewEndsAt, approvalId: review.approvalId,
    podiums: review.podiums.map((podium) => ({ ...podium, entries: podium.entries.map((entry) => ({ ...entry })) })) };
}
