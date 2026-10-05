import type { RequestSession } from "@raceson/domain";
import { decodeRewardRecordComparison, requireReward, verifyRewardRecordCandidate } from "@raceson/domain/rewards";
import { captureRewardRecordSource, readRewardCalculationContext, rewardDocumentUuid as uuid,
  type RewardLedgerRpc, type RewardRecordSourceRpc } from "@raceson/db/rewards";

/** PRIVATE review work only. Captures prior source evidence and checks a proposed
 * comparison against it. This does not persist an operator approval; the separate
 * approval service and atomic ledger guards are required. Never expose raw evidence in
 * a public route, chain metadata, notification, URL or application log. */
export async function captureRewardRecordCandidate(session: RequestSession, input: {
  campaignId: string; targetSnapshotId: string; priorRaceId: string; targetRaceId: string;
  baselineSourceId: string; gender: "M" | "F"; comparison: unknown; idempotencyKey: string;
}, dependencies: { ledgerRpc?: RewardLedgerRpc; recordRpc?: RewardRecordSourceRpc } = {}) {
  const actorUserId = uuid(session.account.userId); const campaignId = uuid(input.campaignId);
  const targetSnapshotId = uuid(input.targetSnapshotId); const priorRaceId = uuid(input.priorRaceId);
  const targetRaceId = uuid(input.targetRaceId); const baselineSourceId = uuid(input.baselineSourceId);
  const idempotencyKey = input.idempotencyKey; const gender = input.gender;
  requireReward(gender === "M" || gender === "F", "invalid_record_gender");
  requireReward(typeof idempotencyKey === "string" && idempotencyKey.length >= 8 && idempotencyKey.length <= 128, "invalid_reward_record_capture");
  // Copy/validate all caller decisions before awaiting. Session authentication is
  // the future HTTP boundary's responsibility; an injected actor is not a login.
  const decoded = decodeRewardRecordComparison(input.comparison);
  const comparison = { ...decoded, priorPrecisionMs: decoded.priorPrecisionMs.toString(), targetPrecisionMs: decoded.targetPrecisionMs.toString() };
  const context = await readRewardCalculationContext({ campaignId, actorUserId, snapshotId: targetSnapshotId }, dependencies.ledgerRpc);
  requireReward(context.campaign.pot === "race" && context.campaign.roundIds.length === 1, "reward_record_target_scope_mismatch");
  const round = context.programme.configuration.rounds.find((row) => row.id === context.campaign.scopeKey);
  requireReward(round && round.races.some((race) => race.id === targetRaceId) && !round.races.some((race) => race.id === priorRaceId),
    "reward_record_target_scope_mismatch");
  const priorSnapshot = await captureRewardRecordSource({ actorUserId, campaignId, targetSnapshotId, priorRaceId, idempotencyKey }, dependencies.recordRpc);
  return verifyRewardRecordCandidate({ campaignId, roundId: round.id, targetRaceId, baselineSourceId, gender,
    configuration: context.programme.configuration, targetSnapshot: context.snapshot, priorSnapshot, comparison });
}
