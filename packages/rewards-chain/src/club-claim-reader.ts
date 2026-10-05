import { parseAbi, type Hex } from "viem";
import { normalizeRewardClaimExpectation, readRewardClaimAward, type RewardClaimExpectation } from "./claim-observation.js";
import type { RewardCampaignReader } from "./campaign-checkpoint.js";
import { normalizeRewardClubSafeExpectation, readVerifiedRewardClubSafe, type RewardSafeBlock } from "./club-safe.js";
import { readVerifiedRewardClubSafeDeployment, type RewardClubSafeDeploymentExpectation, type RewardClubSafeDeploymentReader } from "./club-safe-deployment.js";
import { bytes32, demand, RewardProtocolError, uint, walletAddress } from "./validation.js";

export type RewardClubClaimExpectation = RewardClaimExpectation & {
  treasury: RewardClubSafeDeploymentExpectation;
  /** The exact historical block and initialization evidence in the human review.
   * The application must separately verify that review and its current identity. */
  review: { reviewedBlock: RewardSafeBlock; deploymentBlock: RewardSafeBlock; initializerHash: Hex };
};
export type RewardClubClaimReader = RewardCampaignReader & RewardClubSafeDeploymentReader;
const executionNonceAbi = parseAbi(["function nonce() view returns (uint256)"]);
function block(raw: RewardSafeBlock) { return { number: uint(raw.number), hash: bytes32(raw.hash), timestamp: uint(raw.timestamp) }; }
function sameBlock(a: RewardSafeBlock, b: RewardSafeBlock) { return a.number === b.number && a.hash === b.hash && a.timestamp === b.timestamp; }
export function normalizeRewardClubClaimExpectation(input: RewardClubClaimExpectation) {
  const award = normalizeRewardClaimExpectation(input, 1), safe = normalizeRewardClubSafeExpectation(input.treasury.safe);
  const treasury = { safe, factoryAddress: walletAddress(input.treasury.factoryAddress), deploymentTransactionHash: bytes32(input.treasury.deploymentTransactionHash) };
  const review = { reviewedBlock: block(input.review.reviewedBlock), deploymentBlock: block(input.review.deploymentBlock), initializerHash: bytes32(input.review.initializerHash) };
  demand(safe.context.chainId === award.deployment.context.chainId && safe.context.environment === award.deployment.context.environment
    && safe.context.verifyingContract === award.recipient && safe.context.verifyingContract !== award.deployment.context.verifyingContract
    && ![safe.context.verifyingContract, safe.singletonAddress, safe.fallbackHandlerAddress].includes(treasury.factoryAddress), "reward_club_claim_scope_mismatch");
  demand(review.deploymentBlock.number > 0n && review.deploymentBlock.number <= review.reviewedBlock.number
    && review.deploymentBlock.timestamp <= review.reviewedBlock.timestamp
    && (review.deploymentBlock.number !== review.reviewedBlock.number || sameBlock(review.deploymentBlock, review.reviewedBlock)), "reward_club_review_checkpoint_mismatch");
  return { ...award, treasury, review };
}

/** Read-only composition, not a treasury review or payment authority. The full
 * package and exact unpaid CLUB row, original Safe provenance and current 2/3
 * configuration share one finalized claim checkpoint. Historical configuration
 * and nonce are also read at the operator's exact review checkpoint. A changed
 * execution nonce requires fresh human review. Equality is only a freshness
 * signal: it does not prove complete execution history or hidden-storage safety. */
export async function readVerifiedRewardClubClaim(reader: RewardClubClaimReader, input: RewardClubClaimExpectation, creationCode: Hex) {
  const expected = normalizeRewardClubClaimExpectation(input);
  try {
    const claim = await readRewardClaimAward(reader, expected, creationCode), at = claim.observation.finalizedBlock, anchor = expected.review.reviewedBlock;
    demand(anchor.number <= at.number && anchor.timestamp <= at.timestamp && (anchor.number !== at.number || sameBlock(anchor, at)), "reward_club_review_checkpoint_mismatch");
    const [provenance, historical, reviewedNonce, currentNonce] = await Promise.all([
      readVerifiedRewardClubSafeDeployment(reader, expected.treasury, at),
      readVerifiedRewardClubSafe(reader, expected.treasury.safe, anchor),
      reader.readContract({ address: expected.recipient, abi: executionNonceAbi, functionName: "nonce", blockNumber: anchor.number }),
      reader.readContract({ address: expected.recipient, abi: executionNonceAbi, functionName: "nonce", blockNumber: at.number }),
    ]);
    demand(sameBlock(provenance.deploymentBlock, expected.review.deploymentBlock)
      && provenance.initializerHash === expected.review.initializerHash, "reward_club_review_chain_evidence_mismatch");
    const executionNonce = uint(currentNonce); demand(uint(reviewedNonce) === executionNonce, "reward_club_execution_changed_since_review");
    const [chain, head, current, reviewed] = await Promise.all([reader.getChainId(), reader.getBlock({ blockTag: "finalized" }),
      reader.getBlock({ blockNumber: at.number }), reader.getBlock({ blockNumber: anchor.number })]);
    demand(chain === expected.deployment.context.chainId, "reward_observed_chain_mismatch");
    demand(head.number !== null && head.hash !== null && [provenance.observedFinalizedHead, provenance.safe.observedFinalizedHead, historical.observedFinalizedHead]
      .every(f => uint(head.number!) >= f.number && uint(head.timestamp) >= f.timestamp), "reward_finality_regressed");
    demand(current.number === at.number && current.hash !== null && sameBlock(block({ number: current.number, hash: current.hash, timestamp: current.timestamp }), at)
      && reviewed.number === anchor.number && reviewed.hash !== null && sameBlock(block({ number: reviewed.number, hash: reviewed.hash, timestamp: reviewed.timestamp }), anchor)
      && (head.number !== at.number || (bytes32(head.hash) === at.hash && head.timestamp === at.timestamp)), "reward_chain_changed_during_observation");
    return { ...claim, treasury: { schemaVersion: 1 as const, buildId: provenance.safe.buildId, provenanceId: provenance.provenanceId,
      scope: "initialization_only" as const, executionHistoryReviewRequired: true as const,
      safeAddress: expected.recipient.toLowerCase(), singletonAddress: expected.treasury.safe.singletonAddress.toLowerCase(),
      fallbackHandlerAddress: expected.treasury.safe.fallbackHandlerAddress.toLowerCase(), owners: [...expected.treasury.safe.owners],
      factoryAddress: expected.treasury.factoryAddress.toLowerCase(), deploymentTransactionHash: expected.treasury.deploymentTransactionHash,
      initializerHash: provenance.initializerHash, deploymentBlock: expected.review.deploymentBlock, reviewedBlock: anchor, finalizedBlock: at, executionNonce } };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_club_claim_observation_unavailable");
  }
}
