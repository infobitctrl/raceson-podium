import { parseAbi, type Address, type Hex } from "viem";
import { normalizeRewardClubClaimExpectation, type RewardClubClaimExpectation, type RewardClubClaimReader } from "./club-claim-reader.js";
import { readVerifiedRewardClubSafeDeployment } from "./club-safe-deployment.js";
import { readVerifiedRewardClubSafe, verifyRewardClubSafeConsent, rewardClubSafeBuild, type RewardSafeBlock } from "./club-safe.js";
import { verifyRewardClaimEoaProof } from "./claim-reader.js";
import { encodeRewardClaim, rewardClaimMessages, rewardClaimDigests, type RewardClaim } from "./claims.js";
import { rewardCampaignBuild } from "./deployment.js";
import { bytes32, demand, RewardProtocolError, signatureBytes, uint, walletAddress } from "./validation.js";
import { rewardSignedPaymentBytes, verifyRewardSignedPaymentEnvelope } from "./signed-payment-envelope.js";

export type RewardClubPaymentPlan = { expected: RewardClubClaimExpectation; claim: RewardClaim;
  proofs: { operator: Hex; recipient: Hex }; relayerAddress: Address; nonce: bigint;
  /** Canonical saved recipient-consent block, not a new approval window. */
  consentCheckpoint: RewardSafeBlock };
const executionNonceAbi = parseAbi(["function nonce() view returns (uint256)"]);
const sameBlock = (a: RewardSafeBlock, b: RewardSafeBlock) => a.number === b.number && a.hash === b.hash && a.timestamp === b.timestamp;

export function normalizeRewardClubPaymentPlan(input: RewardClubPaymentPlan) {
  const expected = normalizeRewardClubClaimExpectation(input.expected), e = expected;
  const c = rewardClaimMessages(e.deployment.context, input.claim).consent.message;
  demand(c.entitlementId === e.entitlementId && c.recipient === e.recipient && c.amount === e.award.amount && c.pot === e.award.pot
    && c.allocationDigest === e.upload.allocationDigest, "reward_payment_claim_mismatch");
  demand(c.nonce < (1n << 256n) - 1n, "reward_claim_nonce_exhausted");
  const relayerAddress = walletAddress(input.relayerAddress), nonce = uint(input.nonce, 64);
  demand(nonce <= BigInt(Number.MAX_SAFE_INTEGER), "invalid_reward_payment_nonce");
  demand(BigInt(relayerAddress) > 1n && ![e.deployment.operatorAddress, e.deployment.treasuryAddress, e.recipient, e.deployment.context.verifyingContract]
    .some(a => a.toLowerCase() === relayerAddress.toLowerCase()), "reward_separate_relayer_required");
  const claim: RewardClaim = { entitlementId: c.entitlementId, recipient: c.recipient, amount: c.amount, pot: c.pot === 0 ? "race" : "league",
    nonce: c.nonce, issuedAt: c.issuedAt, expiresAt: c.expiresAt, allocationDigest: c.allocationDigest };
  const proofs = { operator: signatureBytes(input.proofs.operator), recipient: signatureBytes(input.proofs.recipient) };
  demand(proofs.operator.length === 132 && proofs.recipient.length <= 16386, "invalid_reward_claim_signature");
  const b = input.consentCheckpoint, consentCheckpoint = { number: uint(b.number), hash: bytes32(b.hash), timestamp: uint(b.timestamp) };
  const anchor = e.review.reviewedBlock;
  demand(consentCheckpoint.number >= anchor.number && consentCheckpoint.timestamp >= anchor.timestamp
    && (consentCheckpoint.number !== anchor.number || sameBlock(consentCheckpoint, anchor))
    && claim.issuedAt <= consentCheckpoint.timestamp && consentCheckpoint.timestamp < claim.expiresAt, "reward_club_consent_checkpoint_mismatch");
  return { expected, claim, proofs, relayerAddress, nonce, consentCheckpoint };
}

/** Canonical historical consent/provenance verification, not live payment
 * permission. It remains possible after expiry, payment or a later Safe change. */
export async function verifyRewardClubPaymentPlan(reader: RewardClubClaimReader, input: RewardClubPaymentPlan) {
  const p = normalizeRewardClubPaymentPlan(input), e = p.expected, at = p.consentCheckpoint, anchor = e.review.reviewedBlock;
  try {
    await verifyRewardClaimEoaProof(e.deployment.context, p.claim, "operator", e.deployment.operatorAddress, p.proofs.operator);
    const [original, historical, consent, reviewedNonce, consentNonce] = await Promise.all([
      readVerifiedRewardClubSafeDeployment(reader, e.treasury, at), readVerifiedRewardClubSafe(reader, e.treasury.safe, anchor),
      verifyRewardClubSafeConsent(reader, { safe: e.treasury.safe, campaignContext: e.deployment.context,
        claim: p.claim, signature: p.proofs.recipient, checkpoint: at }),
      reader.readContract({ address: e.recipient, abi: executionNonceAbi, functionName: "nonce", blockNumber: anchor.number }),
      reader.readContract({ address: e.recipient, abi: executionNonceAbi, functionName: "nonce", blockNumber: at.number }),
    ]);
    demand(sameBlock(original.deploymentBlock, e.review.deploymentBlock) && original.initializerHash === e.review.initializerHash,
      "reward_club_review_chain_evidence_mismatch");
    demand(uint(reviewedNonce) === uint(consentNonce), "reward_club_execution_changed_since_review");
    const anchors = [at, anchor, original.deploymentBlock], heads = [original.safe.observedFinalizedHead, historical.observedFinalizedHead, consent.observation.observedFinalizedHead];
    const [chain, head, canonical] = await Promise.all([reader.getChainId(), reader.getBlock({ blockTag: "finalized" }),
      Promise.all(anchors.map(b => reader.getBlock({ blockNumber: b.number })))]);
    demand(chain === e.deployment.context.chainId, "reward_observed_chain_mismatch");
    demand(head.number !== null && head.hash !== null && heads.every(b => head.number! >= b.number && head.timestamp >= b.timestamp), "reward_finality_regressed");
    demand(canonical.every((b, i) => b.number !== null && b.hash !== null && sameBlock({ number: b.number, hash: bytes32(b.hash), timestamp: b.timestamp }, anchors[i]))
      && anchors.every(b => head.number !== b.number || (bytes32(head.hash!) === b.hash && head.timestamp === b.timestamp)), "reward_chain_changed_during_observation");
    return { plan: p, wrappedRecipientDigest: consent.wrappedDigest, safeExecutionNonce: uint(consentNonce) };
  } catch (error) { if (error instanceof RewardProtocolError) throw error; throw new RewardProtocolError("reward_club_payment_observation_unavailable"); }
}

/** Encoding only; not a signature, reservation, send lease or broadcast. */
export function encodeRewardClubPayment(input: RewardClubPaymentPlan) {
  const p = normalizeRewardClubPaymentPlan(input);
  return { chainId: p.expected.deployment.context.chainId, to: p.expected.deployment.context.verifyingContract, nonce: Number(p.nonce), value: 0n,
    data: encodeRewardClaim(p.expected.deployment.context, p.claim, p.proofs) };
}
export async function verifySignedRewardClubPayment(reader: RewardClubClaimReader, input: RewardClubPaymentPlan, serialized: Hex) {
  const fixed = normalizeRewardClubPaymentPlan(input), signed = rewardSignedPaymentBytes(serialized, 12288);
  const verified = await verifyRewardClubPaymentPlan(reader, fixed), p = verified.plan, encoded = encodeRewardClubPayment(p);
  const envelope = await verifyRewardSignedPaymentEnvelope(encoded, p.relayerAddress, signed, 12288), digests = rewardClaimDigests(p.expected.deployment.context, p.claim);
  return { schemaVersion: 1 as const, action: "pay_club" as const, chainId: encoded.chainId, ...envelope,
    nonce: p.nonce, contractAddress: encoded.to.toLowerCase() as Address, buildId: rewardCampaignBuild.id,
    entitlementId: p.claim.entitlementId, recipient: p.claim.recipient.toLowerCase() as Address, amount: p.claim.amount, pot: p.claim.pot,
    authorizationNonce: p.claim.nonce, issuedAt: p.claim.issuedAt, expiresAt: p.claim.expiresAt, allocationDigest: p.claim.allocationDigest,
    operatorDigest: digests.authorization, recipientDigest: digests.consent, wrappedRecipientDigest: verified.wrappedRecipientDigest,
    safeBuildId: rewardClubSafeBuild.id, safeExecutionNonce: verified.safeExecutionNonce, consentCheckpoint: p.consentCheckpoint };
}
