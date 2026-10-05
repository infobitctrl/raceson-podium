import { requireReward } from "@raceson/domain/rewards";
import { readRewardClubReviewContext, recordRewardClubReview, revokeRewardClubReview, normalizeRewardClubReviewInput,
  rewardDocumentUuid as uuid, type RewardAccountIdentity, type RewardClubReviewInput, type RewardClubReviewRevocationReason, type RewardLedgerRpc } from "@raceson/db/rewards";
import { readVerifiedRewardClubSafeDeployment, type RewardClubSafeDeploymentReader } from "@raceson/rewards-chain";

/** Private designated-operator service, not mounted to HTTP. New reviews verify
 * original initialization and the human's exact selected checkpoint, not an
 * automatically refreshed block. Audit refs remain explicit human assertions;
 * this neither traces execution history nor authorizes/queues a payment. */
export async function reviewClubRewardTreasury(identity: RewardAccountIdentity, input: RewardClubReviewInput,
  deps: { chainId: 31337 | 10143; reader: RewardClubSafeDeploymentReader | (() => RewardClubSafeDeploymentReader); rpc?: RewardLedgerRpc }) {
  const fixed = { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) }, request = normalizeRewardClubReviewInput(input);
  const { chainId, reader, rpc } = deps;
  requireReward(request.evidence.chainId === chainId, "reward_club_review_chain_mismatch");
  const context = await readRewardClubReviewContext(fixed, request.programmeId, request.requestId, rpc, request.idempotencyKey);
  requireReward(context.chainId === chainId && JSON.stringify(context.nomination.candidate) === JSON.stringify(request.evidence.candidate), "reward_club_review_candidate_mismatch");
  // An exact historical retry may survive later revisions/identity changes and
  // unavailable archival RPC. SQL compares all original fields and never renews it.
  const previous = context.latestReview;
  if (context.retryReview !== null) return recordRewardClubReview(fixed, request, rpc);
  requireReward(context.reviewState !== "identity_hold" && context.reviewState !== "request_withdrawn", "reward_club_review_hold");
  requireReward(context.identityFingerprintSha256 === request.expectedIdentityFingerprintSha256, "reward_club_review_identity_changed");
  requireReward((previous?.revision ?? 0) === request.expectedRevision, "reward_club_review_revision_changed");
  const e = request.evidence, candidate = context.nomination.candidate;
  const observed = await readVerifiedRewardClubSafeDeployment(typeof reader === "function" ? reader() : reader, { safe: {
    context: { environment: chainId === 31337 ? "local-simulation" : "monad-testnet", chainId, verifyingContract: candidate.safeAddress },
    singletonAddress: candidate.singletonAddress, fallbackHandlerAddress: candidate.fallbackHandlerAddress, owners: candidate.owners,
  }, factoryAddress: e.factoryAddress, deploymentTransactionHash: e.deploymentTransactionHash },
  { number: BigInt(e.reviewedBlock.number), hash: e.reviewedBlock.hash, timestamp: BigInt(e.reviewedBlock.timestamp) });
  requireReward(observed.initializerHash === e.initializerHash && observed.deploymentBlock.number === BigInt(e.deploymentBlock.number)
    && observed.deploymentBlock.hash === e.deploymentBlock.hash && observed.deploymentBlock.timestamp === BigInt(e.deploymentBlock.timestamp), "reward_club_review_chain_evidence_mismatch");
  // SQL fences the operator's original identity/revision and current session
  // after actual lock waits. Never replace those expectations with newer values.
  return recordRewardClubReview(fixed, request, rpc);
}
export async function revokeClubRewardTreasuryReview(identity: RewardAccountIdentity,
  input: { programmeId: string; reviewId: string; reason: RewardClubReviewRevocationReason }, rpc?: RewardLedgerRpc) {
  return revokeRewardClubReview(identity, input, rpc);
}
