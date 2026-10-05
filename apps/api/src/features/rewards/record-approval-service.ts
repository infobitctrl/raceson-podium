import type { RequestSession } from "@raceson/domain";
import { decodeRewardRecordComparison, requireReward, verifyRewardRecordCandidate, type RewardRecordDivision } from "@raceson/domain/rewards";
import { readRewardCalculationContext, readRewardRecordSnapshot, readRewardRecordApproval, rewardRecordApprovalRequest,
  rewardRecordComparisonWire, storeRewardRecordApproval, withdrawRewardRecordApproval, rewardDocumentUuid as uuid,
  type RewardCalculationContext, type RewardRecordApproval, type RewardLedgerRpc } from "@raceson/db/rewards";

/** Re-derive all baseline facts from the stored packets and comparison, not the
 * stored derived values alone. Historical integrity is not current freshness;
 * SQL checks withdrawal/supersession and BOTH sources before each new write. */
export function verifyStoredRewardRecordApproval(context: RewardCalculationContext, approval: RewardRecordApproval) {
  const { body, priorSnapshot } = approval;
  requireReward(context.campaign.pot === "race" && approval.campaignId === context.campaign.id
    && approval.targetSnapshotId === context.snapshot.snapshotId && approval.priorSnapshotId === priorSnapshot.snapshotId
    && approval.approvedByUserId === context.programme.operatorUserId, "reward_record_approval_mismatch");
  const candidate = verifyRewardRecordCandidate({ campaignId: context.campaign.id, roundId: context.campaign.scopeKey,
    targetRaceId: body.targetRaceId, baselineSourceId: body.baselineSourceId, gender: body.gender,
    comparison: rewardRecordComparisonWire(body.comparison), priorSnapshot,
    targetSnapshot: context.snapshot, configuration: context.programme.configuration });
  requireReward(JSON.stringify(rewardRecordApprovalRequest(candidate)) === JSON.stringify(rewardRecordApprovalRequest({ ...body,
    targetSnapshotId: approval.targetSnapshotId, priorSnapshotId: approval.priorSnapshotId })), "reward_record_approval_mismatch");
  return { ...candidate, approvalId: approval.approvalId,
    priorSourceFingerprintSha256: priorSnapshot.sourceFingerprintSha256 };
}

export async function approveRewardRecordCandidate(session: RequestSession, input: {
  campaignId: string; priorSnapshotId: string; targetRaceId: string; baselineSourceId: string;
  gender: "M" | "F"; comparison: unknown; idempotencyKey: string;
}, rpc?: RewardLedgerRpc) {
  const actorUserId = uuid(session.account.userId); const campaignId = uuid(input.campaignId); const priorSnapshotId = uuid(input.priorSnapshotId);
  const targetRaceId = uuid(input.targetRaceId); const baselineSourceId = uuid(input.baselineSourceId); const gender = input.gender;
  const idempotencyKey = input.idempotencyKey;
  requireReward(gender === "M" || gender === "F", "invalid_record_gender");
  requireReward(typeof idempotencyKey === "string" && idempotencyKey.length >= 8 && idempotencyKey.length <= 128, "invalid_reward_record_approval");
  const comparison = rewardRecordComparisonWire(decodeRewardRecordComparison(input.comparison));
  const priorSnapshot = await readRewardRecordSnapshot({ campaignId, actorUserId, snapshotId: priorSnapshotId }, rpc);
  const context = await readRewardCalculationContext({ campaignId, actorUserId, snapshotId: priorSnapshot.targetSnapshotId }, rpc);
  requireReward(context.campaign.pot === "race", "reward_record_target_scope_mismatch");
  const candidate = verifyRewardRecordCandidate({ campaignId, roundId: context.campaign.scopeKey, targetRaceId, baselineSourceId, gender,
    comparison, priorSnapshot, targetSnapshot: context.snapshot, configuration: context.programme.configuration });
  const approved = await storeRewardRecordApproval({ campaignId, actorUserId, candidate, idempotencyKey }, rpc);
  verifyStoredRewardRecordApproval(context, approved);
  return approved;
}

/** Up to four independent reads; their combination is historical preview only.
 * The single SQL write revalidates every used approval/source under programme
 * serialization, so separate HTTP reads are never described as one transaction. */
export async function loadRewardRecordApprovals(context: RewardCalculationContext, records: readonly RewardRecordDivision[], rpc?: RewardLedgerRpc) {
  return Promise.all(records.filter((record) => record.baseline !== null).map(async (record) => {
    const baseline = record.baseline!;
    try { uuid(baseline.approvalId); } catch { requireReward(false, "reward_record_approval_required"); }
    const approval = await readRewardRecordApproval({ campaignId: context.campaign.id,
      actorUserId: context.programme.operatorUserId, approvalId: baseline.approvalId }, rpc);
    const verified = verifyStoredRewardRecordApproval(context, approval);
    requireReward(verified.targetRaceId === record.raceId && verified.gender === record.gender
      && baseline.publicationId === verified.baseline.publicationId && baseline.establishedAtMs === verified.baseline.establishedAtMs
      && baseline.finishTimeMs === verified.baseline.finishTimeMs && baseline.courseComparisonKey === verified.baseline.courseComparisonKey,
    "reward_record_approval_mismatch");
    return verified;
  }));
}

export async function withdrawApprovedRewardRecord(session: RequestSession, input: {
  campaignId: string; approvalId: string; idempotencyKey: string; reason: string;
}, rpc?: RewardLedgerRpc) {
  return withdrawRewardRecordApproval({ actorUserId: uuid(session.account.userId), campaignId: input.campaignId,
    approvalId: input.approvalId, idempotencyKey: input.idempotencyKey, reason: input.reason }, rpc);
}
