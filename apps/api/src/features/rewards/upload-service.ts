import type { RequestSession } from "@raceson/domain";
import { aggregateRewardEntitlements, requireReward } from "@raceson/domain/rewards";
import { readRewardAllocationExport, rewardAllocationRequest, rewardDocumentUuid as uuid, rewardRecordApprovalRequest,
  saveRewardUploadPackage, type RewardLedgerRpc } from "@raceson/db/rewards";
import { canonicalRewardJson, commitPrivateRewardDocument, prepareRewardCampaignUpload } from "@raceson/rewards-chain";
import { calculateRewardSportingContext } from "./calculation-service.js";

/** Rebuild the exact reserved calculation, explanations and evidence before
 * encoding any upload. No wallet/account readiness filtering or browser amounts.
 * All server-only identity bindings and salts stop at this boundary. */
export async function prepareReservedRewardUpload(session: RequestSession, input: {
  campaignId: string; allocationId: string; idempotencyKey: string;
}, rpc?: RewardLedgerRpc) {
  const actorUserId = uuid(session.account.userId); const campaignId = uuid(input.campaignId); const allocationId = uuid(input.allocationId);
  const idempotencyKey = input.idempotencyKey;
  requireReward(typeof idempotencyKey === "string" && idempotencyKey.length >= 8 && idempotencyKey.length <= 128, "invalid_reward_upload");
  const stored = await readRewardAllocationExport({ actorUserId, campaignId, allocationId }, rpc);
  const { context, allocation, chain } = stored;
  requireReward(context.review, "reward_sporting_review_required");
  const calculated = await calculateRewardSportingContext(context, context.review.body, rpc);
  requireReward(canonicalRewardJson(rewardAllocationRequest(calculated)) === canonicalRewardJson(allocation.body), "reward_reserved_calculation_mismatch");
  const aggregates = aggregateRewardEntitlements(calculated.result);
  requireReward(aggregates.length === allocation.entitlements.length, "reward_reserved_entitlements_mismatch");
  const expectedByBeneficiary = new Map(aggregates.map((row) => [`${row.beneficiaryKind}:${row.beneficiaryId}`, row]));
  for (const entitlement of allocation.entitlements) {
    const expected = expectedByBeneficiary.get(`${entitlement.beneficiaryKind}:${entitlement.beneficiaryId}`);
    requireReward(expected && expected.amountWei === entitlement.amountWei
      && canonicalRewardJson(expected) === canonicalRewardJson(entitlement.explanation), "reward_reserved_entitlements_mismatch");
    requireReward(entitlement.explanationSalt !== allocation.snapshotSalt, "reward_evidence_salt_reused");
  }
  // Bind exact immutable source fingerprints inside the salted document. Raw SQL
  // eligibility JSON contains fractional ages and is not our integer-only wire
  // format; never silently round/stringify it with a different hash convention.
  const evidenceDocument = {
    schemaVersion: 1, kind: "raceson-allocation-evidence-v1", programmeId: context.programme.id, campaignId, allocationId,
    configuration: context.programme.configuration,
    targetSnapshot: { snapshotId: context.snapshot.snapshotId, sourceFingerprintSha256: context.snapshot.sourceFingerprintSha256 },
    sportingReview: context.review, calculation: calculated.result,
    recordApprovals: calculated.recordEvidence.map((record) => ({ approvalId: record.approvalId,
      targetSnapshotId: record.targetSnapshotId, priorSnapshotId: record.priorSnapshotId,
      priorSourceFingerprintSha256: record.priorSourceFingerprintSha256, body: rewardRecordApprovalRequest(record) }))
      .sort((a, b) => a.approvalId < b.approvalId ? -1 : a.approvalId > b.approvalId ? 1 : 0),
  };
  requireReward(canonicalRewardJson(evidenceDocument) === canonicalRewardJson(stored.evidenceDocument), "reward_upload_evidence_mismatch");
  requireReward(calculated.sourceReviewEndsAt > 259200n, "invalid_reward_publication_time");
  const prepared = prepareRewardCampaignUpload(calculated.result, {
    programmeId: chain.programmeId, campaignId: chain.campaignId, programmeManifestHash: chain.programmeManifestHash,
    snapshotDigest: commitPrivateRewardDocument("snapshot", evidenceDocument, allocation.snapshotSalt),
    latestPublicationAt: calculated.sourceReviewEndsAt - 259200n,
  }, allocation.entitlements);
  const upload = { ...prepared, schemaVersion: 1, chainId: context.programme.chainId,
    operatorAddress: chain.operatorAddress, treasuryAddress: chain.treasuryAddress, sourceReviewEndsAt: calculated.sourceReviewEndsAt };
  // SQL independently rechecks current sources/approval state on first save.
  // An exact retry returns history, not a fresh activation/claim authorization.
  const saved = await saveRewardUploadPackage({ campaignId, actorUserId, allocationId, idempotencyKey, upload, evidenceDocument }, rpc);
  return { ...saved, upload };
}
