import { readReadinessV3, recordReadinessV3, revokeReadinessV3, decodeRewardReadinessAttestationV3, requireReadinessPolicyChainV3,
  rewardDocumentUuid as uuid, type RewardAccountIdentity, type ReadinessScopeV3, type ReadinessContextV3,
  type RewardLedgerRpc, type RewardReadinessRevocationReason } from "@raceson/db/rewards";
import { verifyRewardWalletControl } from "@raceson/rewards-chain";
import { requireReward } from "@raceson/domain/rewards";
type Dependencies = { chainId: 10143 | 31337; origin: string; rpc?: RewardLedgerRpc };
const actor = (identity: RewardAccountIdentity) => ({ userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) });
export async function verifyReadinessWalletV3(context: ReadinessContextV3, deps: Dependencies) {
  const c = context.challenge;
  requireReward(context.source.chainId === deps.chainId && c.origin === deps.origin, "reward_wallet_context_mismatch");
  requireReward(c.proof, "reward_destination_proof_required");
  const verified = await verifyRewardWalletControl(c, c.proof.signature);
  requireReward(verified.messageHash === c.proof.messageHash, "invalid_reward_readiness_v3");
}
/** Whitelisted status for UI consumers, not the private context or a payout
 * capability. Recipient reads use their own session, never operator credentials. */
export async function getAthleteReadinessV3(identity: RewardAccountIdentity, input: Omit<ReadinessScopeV3, "chainId">, deps: Dependencies) {
  const context = await readReadinessV3(actor(identity), { ...input, chainId: deps.chainId }, deps.rpc);
  await verifyReadinessWalletV3(context, deps);
  return { schema: "raceson-athlete-readiness-v3" as const, uploadId: context.source.uploadId, destinationId: context.destination.requestId,
    chainId: context.source.chainId, athleteProfileId: context.destination.athleteProfileId, address: context.destination.address,
    state: context.state, sourceCurrent: context.source.current, sourceGuardHash: context.source.sourceGuardHash,
    profileFingerprint: context.profileFingerprint, reviewId: context.review?.id ?? null,
    reviewedAt: context.review?.reviewedAt ?? null, revokedAt: context.review?.revocation?.revokedAt ?? null,
    walletSecurityPolicy: context.review?.attestation.policy ?? null };
}
export async function reviewAthleteReadinessV3(identity: RewardAccountIdentity, input: Omit<ReadinessScopeV3, "chainId" | "role"> & {
  reviewId: string; previousReviewId: string | null; sourceGuardHash: string; profileFingerprint: string; attestation: unknown }, deps: Dependencies) {
  const fixed = actor(identity), request = { uploadId: uuid(input.uploadId), destinationId: uuid(input.destinationId), reviewId: uuid(input.reviewId),
    previousReviewId: input.previousReviewId === null ? null : uuid(input.previousReviewId), sourceGuardHash: input.sourceGuardHash,
    profileFingerprint: input.profileFingerprint, attestation: decodeRewardReadinessAttestationV3(input.attestation), chainId: deps.chainId };
  requireReadinessPolicyChainV3(request.attestation, deps.chainId);
  const context = await readReadinessV3(fixed, { ...request, role: "operator" }, deps.rpc);
  await verifyReadinessWalletV3(context, deps);
  // Preserve the operator's inspected versions. Fresh reads never silently
  // replace an expected fingerprint/hash and approve a changed identity.
  const review = await recordReadinessV3(fixed, request, deps.rpc);
  return { schema: "raceson-readiness-record-v3" as const, reviewId: review.id, reviewedAt: review.reviewedAt,
    revokedAt: review.revocation?.revokedAt ?? null };
}
export async function revokeAthleteReadinessV3(identity: RewardAccountIdentity, input: Omit<ReadinessScopeV3, "chainId" | "role"> & {
  reviewId: string; reason: RewardReadinessRevocationReason }, deps: Dependencies) {
  const review = await revokeReadinessV3(actor(identity), { ...input, chainId: deps.chainId }, deps.rpc);
  return { schema: "raceson-readiness-record-v3" as const, reviewId: review.id, reviewedAt: review.reviewedAt,
    revokedAt: review.revocation!.revokedAt };
}
