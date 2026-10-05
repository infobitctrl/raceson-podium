import { compareRewardKeys, requireReward, requireRewardKey, requireUnsigned } from "./arithmetic.js";

/** Trusted immutable source input, never an athlete-submitted calculation body. */
export type RewardFinish = {
  sourceId: string;
  publicationId: string;
  roundId: string;
  raceId: string;
  athleteId: string;
  representedClubId: string | null;
  gender: "M" | "F" | "U";
  classificationIds: readonly string[];
  courseComparisonKey: string;
  distanceMetres: bigint;
  finishTimeMs: bigint | null;
  clubPoints: bigint | null;
  participationStatus: string;
  resultStatus: string;
};

export type RewardAdjudication = {
  roundId: string;
  athleteId: string;
  sourceIds: readonly string[];
  selectedSourceId: string | null;
  approvalId: string;
};

export function selectRewardFinishes(input: readonly RewardFinish[], decisions: readonly RewardAdjudication[] = []) {
  const allSources = new Set<string>();
  const groups = new Map<string, RewardFinish[]>();
  const excludedSourceIds: string[] = [];
  for (const row of input) {
    for (const key of [row.sourceId, row.publicationId, row.roundId, row.raceId, row.athleteId, row.courseComparisonKey, ...row.classificationIds]) requireRewardKey(key);
    if (row.representedClubId !== null) requireRewardKey(row.representedClubId);
    requireReward(!allSources.has(row.sourceId), "duplicate_result_source");
    requireReward(["M", "F", "U"].includes(row.gender), "invalid_result_gender");
    allSources.add(row.sourceId);
    if (row.finishTimeMs !== null) requireUnsigned(row.finishTimeMs, "invalid_finish_time");
    if (row.clubPoints !== null) requireUnsigned(row.clubPoints, "invalid_club_points");
    requireUnsigned(row.distanceMetres, "invalid_course_distance");
    const finished = row.participationStatus === "finished";
    const positiveTime = row.finishTimeMs !== null && row.finishTimeMs > 0n;
    requireReward(finished === positiveTime, "contradictory_finish_state");
    if (!finished) { excludedSourceIds.push(row.sourceId); continue; }
    requireReward(["official", "corrected"].includes(row.resultStatus), "finish_requires_official_publication");
    requireReward(row.distanceMetres > 0n, "finished_course_has_no_distance");
    const group = JSON.stringify([row.roundId, row.athleteId]);
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  const decisionByGroup = new Map<string, RewardAdjudication>();
  for (const decision of decisions) {
    for (const key of [decision.roundId, decision.athleteId, decision.approvalId, ...decision.sourceIds]) requireRewardKey(key);
    const group = JSON.stringify([decision.roundId, decision.athleteId]);
    requireReward(!decisionByGroup.has(group), "duplicate_adjudication");
    requireReward(groups.has(group), "stale_adjudication");
    decisionByGroup.set(group, decision);
  }
  const finishes: RewardFinish[] = [];
  for (const [group, rows] of groups) {
    const decision = decisionByGroup.get(group);
    requireReward(rows.length === 1 || decision, "duplicate_athlete_round_requires_review");
    if (!decision) { finishes.push(rows[0]); continue; }
    const actual = rows.map(({ sourceId }) => sourceId).sort(compareRewardKeys);
    requireReward(JSON.stringify(actual) === JSON.stringify([...decision.sourceIds].sort(compareRewardKeys)), "stale_adjudication_sources");
    requireReward(decision.selectedSourceId === null || actual.includes(decision.selectedSourceId), "invalid_adjudicated_source");
    for (const row of rows) {
      if (row.sourceId === decision.selectedSourceId) finishes.push(row);
      else excludedSourceIds.push(row.sourceId);
    }
  }
  return {
    finishes: finishes.sort((a, b) => compareRewardKeys(a.sourceId, b.sourceId)),
    excludedSourceIds: excludedSourceIds.sort(compareRewardKeys),
  };
}

export type RewardReadiness = {
  kind: "athlete" | "club";
  ownershipVerified: boolean;
  walletVerified: boolean;
  ageStatus?: "adult_verified" | "minor" | "unknown";
};

/** Kept separate from all weight calculations: no readiness-driven redistribution. */
export function rewardPayoutHolds(readiness: RewardReadiness): string[] {
  const holds: string[] = [];
  if (!readiness.ownershipVerified) holds.push(readiness.kind === "athlete" ? "profile_claim_required" : "club_owner_required");
  if (!readiness.walletVerified) holds.push(readiness.kind === "athlete" ? "wallet_required" : "club_treasury_required");
  if (readiness.kind === "athlete" && readiness.ageStatus !== "adult_verified") holds.push(readiness.ageStatus === "minor" ? "minor_payout_hold" : "age_verification_required");
  return holds;
}
