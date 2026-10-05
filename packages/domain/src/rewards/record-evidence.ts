import { parseRewardUnits, requireReward, requireRewardKey } from "./arithmetic.js";
import { adaptRewardSourceEvidence, parseRewardSourceTimestamp, type RewardSourceConfiguration } from "./source-evidence.js";
import type { RewardRecordDivision } from "./calculator.js";

export type RewardRecordComparison = {
  priorDirection: "forward" | "reverse"; targetDirection: "forward" | "reverse";
  priorTimingMethod: "manual" | "electronic"; targetTimingMethod: "manual" | "electronic";
  priorTimingBasis: "gun" | "net"; targetTimingBasis: "gun" | "net";
  priorPrecisionMs: bigint; targetPrecisionMs: bigint;
  courseEquivalent: true; historyReviewed: true; exceptionsReviewed: true;
  rationale: string;
};
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  requireReward(value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), "invalid_reward_record_evidence");
  const fields = Object.getOwnPropertyDescriptors(value);
  requireReward(Object.getOwnPropertySymbols(value).length === 0
    && Object.values(fields).every((field) => field.enumerable && "value" in field), "invalid_reward_record_evidence");
  return value as ObjectValue;
}
function exact(value: unknown, keys: readonly string[]): ObjectValue {
  const row = object(value);
  requireReward(Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key)), "invalid_reward_record_comparison");
  return row;
}
function key(value: unknown): string { requireRewardKey(value as string); return value as string; }
function integer(value: unknown): bigint {
  requireReward(typeof value === "string", "invalid_reward_record_integer"); return parseRewardUnits(value, 0);
}
function rows(value: unknown): ObjectValue[] {
  requireReward(Array.isArray(value) && value.length <= 20000 && Object.keys(value).length === value.length, "invalid_reward_record_rows");
  const fields = Object.getOwnPropertyDescriptors(value);
  return Array.from({ length: value.length }, (_, index) => {
    const field = fields[String(index)]; requireReward(field && "value" in field, "invalid_reward_record_rows"); return object(field.value);
  });
}

/** Human comparability review, not a machine assertion that two GPX files,
 * timing methods or all historical performances have been independently audited.
 * Must be persisted by a currently authorized operator before use in a payout. */
export function decodeRewardRecordComparison(value: unknown): RewardRecordComparison {
  const row = exact(value, ["priorDirection", "targetDirection", "priorTimingMethod", "targetTimingMethod",
    "priorTimingBasis", "targetTimingBasis", "priorPrecisionMs", "targetPrecisionMs", "courseEquivalent", "historyReviewed", "exceptionsReviewed", "rationale"]);
  requireReward(["forward", "reverse"].includes(String(row.priorDirection)) && row.priorDirection === row.targetDirection,
    "reward_record_direction_not_comparable");
  requireReward(["manual", "electronic"].includes(String(row.priorTimingMethod)) && row.priorTimingMethod === row.targetTimingMethod,
    "reward_record_timing_not_comparable");
  requireReward(["gun", "net"].includes(String(row.priorTimingBasis)) && row.priorTimingBasis === row.targetTimingBasis,
    "reward_record_timing_not_comparable");
  const priorPrecisionMs = integer(row.priorPrecisionMs); const targetPrecisionMs = integer(row.targetPrecisionMs);
  requireReward([1n, 10n, 100n, 1000n].includes(priorPrecisionMs) && priorPrecisionMs === targetPrecisionMs,
    "reward_record_precision_not_comparable");
  requireReward(row.courseEquivalent === true && row.historyReviewed === true && row.exceptionsReviewed === true,
    "reward_record_comparison_review_required");
  requireReward(typeof row.rationale === "string" && row.rationale.trim().length >= 20 && row.rationale.length <= 4000
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(row.rationale), "reward_record_comparison_review_required");
  return { priorDirection: row.priorDirection as "forward" | "reverse", targetDirection: row.targetDirection as "forward" | "reverse",
    priorTimingMethod: row.priorTimingMethod as "manual" | "electronic", targetTimingMethod: row.targetTimingMethod as "manual" | "electronic",
    priorTimingBasis: row.priorTimingBasis as "gun" | "net", targetTimingBasis: row.targetTimingBasis as "gun" | "net",
    priorPrecisionMs, targetPrecisionMs, courseEquivalent: true, historyReviewed: true, exceptionsReviewed: true, rationale: row.rationale.trim() };
}

export type RewardRecordEvidenceSnapshot = {
  snapshotId: string; campaignId: string; targetSnapshotId: string; priorRaceId: string;
  sourceFingerprintSha256: string; source: unknown;
};

/** Validate a PRIVATE baseline candidate from independently captured SQL source.
 * Returns no approvalId: validation/preview alone cannot satisfy the calculator's
 * persisted operator-approval boundary. Freshness and revocation are DB/service
 * checks at review/reservation/activation, not claims made by this pure function. */
export function verifyRewardRecordCandidate(input: {
  campaignId: string; roundId: string; targetRaceId: string; gender: "M" | "F"; baselineSourceId: string;
  targetSnapshot: { snapshotId: string; sourceFingerprintSha256: string; source: unknown };
  configuration: RewardSourceConfiguration; priorSnapshot: RewardRecordEvidenceSnapshot; comparison: unknown;
}): {
  baseline: Omit<NonNullable<RewardRecordDivision["baseline"]>, "approvalId">;
  baselineSourceId: string; priorSnapshotId: string; targetSnapshotId: string;
  targetRaceId: string; gender: "M" | "F"; comparison: RewardRecordComparison;
  sourceReviewEndsAt: bigint; publicationSignature: "unverified";
  establishmentBasis: "gun_finish" | "result_run_completed_upper_bound";
} {
  for (const id of [input.campaignId, input.roundId, input.targetRaceId, input.baselineSourceId]) key(id);
  requireReward(input.gender === "M" || input.gender === "F", "invalid_record_gender");
  const comparison = decodeRewardRecordComparison(input.comparison);
  const round = input.configuration.rounds.find((row) => row.id === input.roundId);
  const race = round?.races.find((row) => row.id === input.targetRaceId);
  requireReward(round && race, "reward_record_target_scope_mismatch");
  const target = adaptRewardSourceEvidence(input.targetSnapshot, { ...input.configuration, rounds: [round] });
  const roundEvidence = target.rounds[0];
  requireReward(roundEvidence.openCaseIds.length === 0, "reward_round_has_unresolved_adjudication");
  const targetStart = new Map(roundEvidence.raceStartTimes).get(race.id);
  requireReward(targetStart !== null && targetStart !== undefined, "record_requires_verified_race_start");
  const snapshot = input.priorSnapshot;
  key(snapshot.snapshotId);
  requireReward(snapshot.campaignId === input.campaignId && snapshot.targetSnapshotId === input.targetSnapshot.snapshotId
    && /^[0-9a-f]{64}$/.test(snapshot.sourceFingerprintSha256), "reward_record_source_scope_mismatch");
  const source = object(snapshot.source); const prior = object(source.race); const track = object(source.track);
  const publication = object(source.publication); const run = object(source.run);
  requireReward(source.schemaVersion === 1 && source.organizationId === input.configuration.organizationId
    && prior.id === snapshot.priorRaceId && prior.id !== race.id && prior.eventEditionId !== round.eventEditionId,
    "reward_record_source_scope_mismatch");
  requireReward(prior.status === "completed" && prior.eventStatus === "completed" && prior.isPractice === false
    && prior.organizerDeletedAt === null && prior.editionDeletedAt === null && prior.resultsMode === "standard", "reward_record_source_not_ready");
  for (const id of [track.snapshotId, track.versionId, track.templateId, publication.id, run.id]) key(id);
  requireReward(publication.raceId === prior.id && publication.runId === run.id && source.latestPublicationId === publication.id
    && run.raceId === prior.id && run.status === "succeeded" && ["official", "corrected"].includes(String(publication.state)),
    "reward_record_publication_not_ready");
  const priorStartUs = parseRewardSourceTimestamp(prior.startAt);
  const publishedUs = parseRewardSourceTimestamp(publication.publishedAt); const completedUs = parseRewardSourceTimestamp(run.completedAt);
  requireReward(priorStartUs <= completedUs && completedUs <= publishedUs, "reward_record_publication_not_ready");
  requireReward(integer(prior.distanceMetres) === race.distanceMetres && prior.courseFormat === race.courseFormat
    && prior.lapCount === race.lapCount && integer(track.distanceMetres) * BigInt(race.lapCount) === race.distanceMetres,
    "reward_record_course_not_comparable");
  // A different track version is allowed ONLY with the explicit persisted human
  // equivalence review. Same UUID/distance alone never implies same direction.
  for (const item of rows(source.adjudicationCases)) {
    requireReward(item.raceId === prior.id && typeof item.recomputeRequired === "boolean", "invalid_reward_record_evidence");
    requireReward(["closed", "withdrawn"].includes(String(item.state)) && !item.recomputeRequired, "reward_record_unresolved_adjudication");
  }
  const ids = new Set<string>(); const athletes = new Set<string>();
  const candidates: { id: string; time: bigint }[] = [];
  for (const row of rows(source.rows)) {
    const id = key(row.id); requireReward(!ids.has(id), "duplicate_reward_record_source"); ids.add(id);
    requireReward(row.raceId === prior.id && row.registrationRaceId === prior.id && row.publicationId === publication.id
      && row.resultRunId === run.id, "reward_record_row_provenance_mismatch");
    key(row.registrationId);
    const path = row.identityPath;
    requireReward(Array.isArray(path) && path.length >= 1 && path.length <= 17 && path.every((id) => typeof id === "string")
      && path[0] === key(row.sourceAthleteId) && path.at(-1) === key(row.canonicalAthleteId)
      && path.includes(key(row.registrationAthleteId)) && new Set(path).size === path.length
      && row.identityCycle === false && row.unresolvedMergeId === null, "unresolved_reward_identity");
    requireReward(["not_started", "checked_in", "started", "finished", "dns", "dnf", "dsq", "withdrawn", "stopped", "evacuated", "missing"].includes(String(row.participationStatus))
      && ["uncomputed", "provisional", "official", "corrected", "void"].includes(String(row.resultStatus)), "reward_record_result_state_invalid");
    const time = row.finishTimeMs === null ? null : integer(row.finishTimeMs);
    if (row.participationStatus !== "finished" || !["official", "corrected"].includes(String(row.resultStatus))) {
      requireReward(time === null || time === 0n, "reward_record_contradictory_finish"); continue;
    }
    requireReward(time !== null && time > 0n, "reward_record_contradictory_finish");
    requireReward(!athletes.has(row.canonicalAthleteId as string), "reward_record_duplicate_finish_requires_review");
    athletes.add(row.canonicalAthleteId as string);
    const rawGender = String(row.gender).trim().toUpperCase();
    const gender = ["M", "MALE"].includes(rawGender) ? "M" : ["F", "FEMALE", "W"].includes(rawGender) ? "F" : null;
    requireReward(gender !== null, "record_gender_requires_review");
    requireReward(time % comparison.priorPrecisionMs === 0n && priorStartUs + time * 1000n <= completedUs,
      "reward_record_precision_or_time_invalid");
    if (gender === input.gender) candidates.push({ id, time });
  }
  const baseline = candidates.find((row) => row.id === input.baselineSourceId);
  requireReward(baseline && candidates.every((row) => row.time >= baseline.time), "reward_record_not_fastest_verified_source");
  // A net/chip timer starts after the gun. Without a per-runner start timestamp,
  // start_at + net elapsed UNDERSTATES the finish instant. A completed result run
  // is a conservative latest-known bound; if it is not before the target start,
  // this evidence cannot establish a prior net-timed record.
  const establishmentBasis = comparison.priorTimingBasis === "gun" ? "gun_finish" : "result_run_completed_upper_bound";
  const establishedAtUs = comparison.priorTimingBasis === "gun" ? priorStartUs + baseline.time * 1000n : completedUs;
  requireReward((establishedAtUs + 999n) / 1000n < targetStart, "record_baseline_must_precede_race");
  for (const finish of target.finishes.filter((row) => row.raceId === race.id && row.participationStatus === "finished")) {
    requireReward(finish.gender !== "U", "record_gender_requires_review");
    requireReward(finish.finishTimeMs !== null && finish.finishTimeMs % comparison.targetPrecisionMs === 0n,
      "reward_record_precision_or_time_invalid");
  }
  const priorReviewEndsAt = (publishedUs + 999999n) / 1000000n + 72n * 60n * 60n;
  return { baseline: { publicationId: publication.id as string, establishedAtMs: (establishedAtUs + 999n) / 1000n,
    finishTimeMs: baseline.time, courseComparisonKey: `course:${race.trackVersionId}:${race.courseFormat}:${race.lapCount}:${race.distanceMetres}` },
    baselineSourceId: baseline.id, priorSnapshotId: snapshot.snapshotId, targetSnapshotId: input.targetSnapshot.snapshotId,
    targetRaceId: race.id, gender: input.gender, comparison, publicationSignature: "unverified", establishmentBasis,
    sourceReviewEndsAt: priorReviewEndsAt > roundEvidence.sourceReviewEndsAt ? priorReviewEndsAt : roundEvidence.sourceReviewEndsAt };
}
