import { requireReward } from "@raceson/domain/rewards";
import { readRewardAthleteReviewContext, recordRewardAthleteReview, revokeRewardAthleteReview,
  decodeRewardReadinessAttestation, rewardDocumentUuid as uuid, type RewardAccountIdentity, type RewardLedgerRpc,
  type RewardReadinessRevocationReason } from "@raceson/db/rewards";
import { verifyRewardWalletControl } from "@raceson/rewards-chain";
import type { RewardPortalConfig } from "./request-identity.js";

/** Designated operator only. Does not infer real-world evidence from DOB or a
 * wallet signature, provision a provider, activate a destination or sign/pay.
 * The demo HTTP adapter exposes only a separate strict browser projection. */
export async function reviewAthleteRewardReadiness(identity: RewardAccountIdentity, input: {
  programmeId: string; requestId: string; expectedProfileFingerprintSha256: string; expectedRevision: number;
  attestation: unknown; idempotencyKey: string;
}, deps: RewardPortalConfig & { rpc?: RewardLedgerRpc }) {
  const fixed = { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) };
  const request = { programmeId: uuid(input.programmeId), requestId: uuid(input.requestId),
    expectedProfileFingerprintSha256: input.expectedProfileFingerprintSha256, expectedRevision: input.expectedRevision,
    attestation: decodeRewardReadinessAttestation(input.attestation), idempotencyKey: input.idempotencyKey };
  const { chainId, origin, rpc } = deps;
  const context = await readRewardAthleteReviewContext(fixed, request.programmeId, request.requestId, rpc);
  requireReward(context.chainId === chainId && context.challenge.origin === origin, "reward_wallet_context_mismatch");
  requireReward(context.challenge.proof !== null, "reward_destination_proof_required");
  const verified = await verifyRewardWalletControl(context.challenge, context.challenge.proof.signature);
  requireReward(verified.messageHash === context.challenge.proof.messageHash, "invalid_reward_readiness_document");
  // SQL checks reviewed profile version/revision under locks. Do not replace the
  // operator's expected values with this read: that would approve unseen changes.
  return recordRewardAthleteReview(fixed, request, rpc);
}

export async function revokeAthleteRewardReadiness(identity: RewardAccountIdentity, input: {
  programmeId: string; reviewId: string; reason: RewardReadinessRevocationReason;
}, rpc?: RewardLedgerRpc) {
  return revokeRewardAthleteReview(identity, input, rpc);
}
