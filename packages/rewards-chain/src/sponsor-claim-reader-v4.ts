import {parseAbi, type Address, type Hex} from "viem";
import type {SponsorExecutionPlan} from "@raceson/domain/rewards/sponsor-execution";
import {observeSponsorProgrammePot, type SponsorChainReader} from "./sponsor-v4.js";
import {sponsorAllocationCommitmentV4} from "./sponsor-claims-v4.js";
import {canonicalRewardJson} from "./canonical.js";
import {normalizeRewardClubSafeExpectation, readVerifiedRewardClubSafe, type RewardSafeBlock} from "./club-safe.js";
import {readVerifiedRewardClubSafeDeployment, type RewardClubSafeDeploymentExpectation, type RewardClubSafeDeploymentReader} from "./club-safe-deployment.js";
import {bytes32, demand, walletAddress, uint, RewardProtocolError} from "./validation.js";

const abi = parseAbi([
  "function allocationDigest() view returns(bytes32)", "function snapshotDigest() view returns(bytes32)",
  "function uploadDigest() view returns(bytes32)", "function reviewStartedAt() view returns(uint256)",
  "function officialPublishedAt() view returns(uint256)", "function publicationEvidenceHash() view returns(bytes32)",
  "function entitlements(bytes32) view returns(bytes32 beneficiaryId,uint256 amount,bytes32 explanationHash,uint256 authorizationNonce,address recipient,uint8 pot,bool paid,uint8 beneficiaryKind)",
]);
type Commitment = ReturnType<typeof sponsorAllocationCommitmentV4>;
/** Exact finalized EOA entitlement observation. This is not proof of profile
 * ownership/readiness or current sporting-source approval. A service must check
 * those independently before/after this IO, then persist the exact claim intent.
 * Clubs deliberately require their separate original-Safe verification path. */
export type SponsorClaimExpectationV4 = {
  plan: SponsorExecutionPlan; deploymentHash: Hex; fundingHash: Hex; slot: number;
  allocation: Commitment; entitlementId: Hex; recipient: Address;
};
export async function readSponsorAthleteClaimV4(reader: SponsorChainReader, input: SponsorClaimExpectationV4) {
  return readSponsorAwardV4(reader, input, 0);
}
async function readSponsorAwardV4(reader: SponsorChainReader, input: SponsorClaimExpectationV4, kind: 0 | 1) {
  // Capture caller-owned objects before awaiting external IO.
  const raw = JSON.parse(canonicalRewardJson(input)) as typeof input;
  const a = raw.allocation;
  const allocation = sponsorAllocationCommitmentV4(raw.plan, raw.slot, {snapshotDigest: a.snapshotDigest,
    awards: a.awards.map(r => ({...r, amount: BigInt(r.amount)})), reviewPeriod: BigInt(a.reviewPeriod),
    reviewStartedAt: BigInt(a.reviewStartedAt), officialPublishedAt: BigInt(a.officialPublishedAt), publicationEvidenceHash: a.publicationEvidenceHash});
  demand(canonicalRewardJson(allocation) === canonicalRewardJson(a), "invalid_sponsor_allocation_commitment");
  const recipient = walletAddress(raw.recipient), entitlementId = bytes32(raw.entitlementId);
  const expected = allocation.awards.find(r => r.entitlementId === entitlementId);
  demand(expected && expected.beneficiaryKind === kind, kind === 0 ? "sponsor_athlete_award_required" : "sponsor_club_award_required");
  const observed = await observeSponsorProgrammePot(reader, raw.plan, raw.deploymentHash, raw.fundingHash, raw.slot);
  const pot = observed.pots.find(p => p.slot === raw.slot);
  demand(observed.funded && !observed.cancelled && pot && pot.state === 3 && !pot.paused
    && BigInt(observed.blockTimestamp) < BigInt(pot.claimDeadline), "sponsor_claim_unavailable");
  demand(BigInt(pot.allocatedWei) === allocation.allocated[allocation.enabledPot]
    && BigInt(pot.entitlementCount) === allocation.entitlementCount, "sponsor_allocation_mismatch");
  const address = pot.address as Address, blockNumber = BigInt(observed.blockNumber), args = {address, abi, blockNumber};
  const [digest, snapshot, upload, started, published, publication, row, recipientCode] = await Promise.all([
    reader.readContract({...args, functionName: "allocationDigest"}), reader.readContract({...args, functionName: "snapshotDigest"}),
    reader.readContract({...args, functionName: "uploadDigest"}), reader.readContract({...args, functionName: "reviewStartedAt"}),
    reader.readContract({...args, functionName: "officialPublishedAt"}), reader.readContract({...args, functionName: "publicationEvidenceHash"}),
    reader.readContract({...args, functionName: "entitlements", args: [entitlementId]}), reader.getCode({address: recipient, blockNumber}),
  ]);
  demand(digest === allocation.allocationDigest && snapshot === allocation.snapshotDigest && upload === allocation.uploadDigest
    && started === allocation.reviewStartedAt && published === allocation.officialPublishedAt && publication === allocation.publicationEvidenceHash,
    "sponsor_allocation_mismatch");
  demand(row[0] === expected.beneficiaryId && row[1] === expected.amount && row[2] === expected.explanationHash
    && row[5] === expected.pot && row[7] === kind && !row[6] && BigInt(row[4]) === 0n, "sponsor_entitlement_unavailable");
  if (kind === 0) demand(recipientCode === undefined || recipientCode === "0x", "reward_eoa_recipient_required");
  const after = await reader.getBlock({blockNumber});
  demand(after.hash === observed.blockHash && after.timestamp.toString() === observed.blockTimestamp
    && await reader.getChainId() === raw.plan.chainId, "sponsor_claim_observation_changed");
  return {protocolVersion: 4 as const, context: {environment: raw.plan.chainId === 31337 ? "local-simulation" as const : "monad-testnet" as const,
    chainId: raw.plan.chainId, verifyingContract: address}, recipient, award: {...expected, nonce: row[3]},
    allocationDigest: allocation.allocationDigest, claimDeadline: BigInt(pot.claimDeadline),
    finalizedBlock: {number: blockNumber, hash: observed.blockHash as Hex, timestamp: BigInt(observed.blockTimestamp)}};
}

export type SponsorClubClaimExpectationV4 = SponsorClaimExpectationV4 & {
  treasury: RewardClubSafeDeploymentExpectation;
  review: {reviewedBlock: RewardSafeBlock; deploymentBlock: RewardSafeBlock; initializerHash: Hex};
};
export type SponsorClubClaimReaderV4 = SponsorChainReader & RewardClubSafeDeploymentReader;
const nonceAbi = parseAbi(["function nonce() view returns(uint256)"]);
const block = (b: RewardSafeBlock) => ({number: uint(b.number), hash: bytes32(b.hash), timestamp: uint(b.timestamp)});
const sameBlock = (a: RewardSafeBlock, b: RewardSafeBlock) => a.number === b.number && a.hash === b.hash && a.timestamp === b.timestamp;
/** A separate club entry preserves the athlete EOA-only policy. Club identity
 * and the four human evidence references remain application responsibilities. */
export async function readSponsorClubClaimV4(reader: SponsorClubClaimReaderV4, input: SponsorClubClaimExpectationV4) {
  const safe = normalizeRewardClubSafeExpectation(input.treasury.safe);
  const treasury = {safe, factoryAddress: walletAddress(input.treasury.factoryAddress), deploymentTransactionHash: bytes32(input.treasury.deploymentTransactionHash)};
  const review = {reviewedBlock: block(input.review.reviewedBlock), deploymentBlock: block(input.review.deploymentBlock), initializerHash: bytes32(input.review.initializerHash)};
  demand(safe.context.chainId === input.plan.chainId && safe.context.verifyingContract === walletAddress(input.recipient)
    && ![safe.context.verifyingContract, safe.singletonAddress, safe.fallbackHandlerAddress].includes(treasury.factoryAddress), "reward_club_claim_scope_mismatch");
  demand(review.deploymentBlock.number > 0n && review.deploymentBlock.number <= review.reviewedBlock.number
    && review.deploymentBlock.timestamp <= review.reviewedBlock.timestamp
    && (review.deploymentBlock.number !== review.reviewedBlock.number || sameBlock(review.deploymentBlock, review.reviewedBlock)), "reward_club_review_checkpoint_mismatch");
  const chainId = input.plan.chainId;
  try {
    const claim = await readSponsorAwardV4(reader, input, 1), at = claim.finalizedBlock, anchor = review.reviewedBlock;
    demand(safe.context.verifyingContract !== claim.context.verifyingContract && anchor.number <= at.number && anchor.timestamp <= at.timestamp
      && (anchor.number !== at.number || sameBlock(anchor, at)), "reward_club_review_checkpoint_mismatch");
    const [provenance, historical, reviewedNonce, currentNonce] = await Promise.all([
      readVerifiedRewardClubSafeDeployment(reader, treasury, at), readVerifiedRewardClubSafe(reader, safe, anchor),
      reader.readContract({address: claim.recipient, abi: nonceAbi, functionName: "nonce", blockNumber: anchor.number}),
      reader.readContract({address: claim.recipient, abi: nonceAbi, functionName: "nonce", blockNumber: at.number}),
    ]);
    demand(sameBlock(provenance.deploymentBlock, review.deploymentBlock) && provenance.initializerHash === review.initializerHash, "reward_club_review_chain_evidence_mismatch");
    const executionNonce = uint(currentNonce);
    demand(uint(reviewedNonce) === executionNonce, "reward_club_execution_changed_since_review");
    const [chain, head, current, reviewed] = await Promise.all([reader.getChainId(), reader.getBlock({blockTag: "finalized"}),
      reader.getBlock({blockNumber: at.number}), reader.getBlock({blockNumber: anchor.number})]);
    demand(chain === chainId, "reward_observed_chain_mismatch");
    demand(head.number !== null && head.hash !== null && [provenance.observedFinalizedHead, provenance.safe.observedFinalizedHead, historical.observedFinalizedHead]
      .every(f => uint(head.number!) >= f.number && uint(head.timestamp) >= f.timestamp), "reward_finality_regressed");
    demand(current.number === at.number && current.hash === at.hash && current.timestamp === at.timestamp
      && reviewed.number === anchor.number && reviewed.hash === anchor.hash && reviewed.timestamp === anchor.timestamp
      && (head.number !== at.number || head.hash === at.hash && head.timestamp === at.timestamp), "reward_chain_changed_during_observation");
    return {...claim, treasury: {safe, factoryAddress: treasury.factoryAddress, deploymentTransactionHash: treasury.deploymentTransactionHash,
      reviewedBlock: anchor, deploymentBlock: review.deploymentBlock, initializerHash: review.initializerHash, executionNonce}};
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_club_claim_observation_unavailable");
  }
}
