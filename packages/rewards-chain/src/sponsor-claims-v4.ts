import {encodeAbiParameters, encodeFunctionData, hashTypedData, keccak256, recoverTypedDataAddress, parseAbi, parseAbiParameters, type Address, type Hex} from "viem";
import {rewardClaimMessages, type RewardClaim} from "./claims.js";
import {rewardAllocationCommitment, type RewardPublicAward} from "./allocation.js";
import {normalizeRewardFinalPublicationV3, type RewardFinalPublicationV3} from "./campaign-v3.js";
import {sponsorContractConfiguration} from "./sponsor-v4.js";
import type {SponsorExecutionPlan} from "@raceson/domain/rewards/sponsor-execution";
import {demand, signatureBytes, walletAddress, type RewardChainContext} from "./validation.js";

/** V4 has EIP-712 version 5. No caller-selected domain or V3 proof downgrade. */
export function sponsorClaimMessagesV4(context: RewardChainContext, input: RewardClaim) {
  const messages = rewardClaimMessages(context, input), domain = {...messages.authorization.domain, version: "5"} as const;
  return {authorization: {...messages.authorization, domain}, consent: {...messages.consent, domain}};
}
export function sponsorClaimDigestsV4(context: RewardChainContext, claim: RewardClaim) {
  const m = sponsorClaimMessagesV4(context, claim);
  return {authorization: hashTypedData(m.authorization), consent: hashTypedData(m.consent)};
}
/** EOA cryptographic proof only. Identity, source freshness, live entitlement,
 * consent ordering and execution permission remain independent service checks. */
export async function verifySponsorClaimProofV4(context: RewardChainContext, claim: RewardClaim,
  role: "operator" | "recipient", operator: Address, signature: Hex) {
  demand(role === "operator" || role === "recipient", "invalid_reward_claim_proof_role");
  const m = sponsorClaimMessagesV4(context, claim);
  const signer = walletAddress(role === "operator" ? operator : claim.recipient).toLowerCase() as Address;
  demand(typeof signature === "string" && /^0x[0-9a-fA-F]{130}$/.test(signature), "invalid_reward_claim_signature");
  const normalized = signature.toLowerCase() as Hex, s = BigInt(`0x${normalized.slice(66, 130)}`);
  demand(s > 0n && s <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n
    && ["1b", "1c"].includes(normalized.slice(130)), "invalid_reward_claim_signature");
  const digest = role === "operator" ? hashTypedData(m.authorization) : hashTypedData(m.consent);
  const recovered = role === "operator" ? await recoverTypedDataAddress({...m.authorization, signature: normalized})
    : await recoverTypedDataAddress({...m.consent, signature: normalized});
  demand(recovered.toLowerCase() === signer, "reward_claim_signature_mismatch");
  return {protocolVersion: 4 as const, role, signer, digest, signature: normalized};
}
const claimAbi = parseAbi(["function claim(bytes32 entitlementId,address recipient,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes operatorSignature,bytes recipientSignature)"]);
export function encodeSponsorClaimV4(context: RewardChainContext, claim: RewardClaim, proofs: {operator: Hex; recipient: Hex}) {
  const {message: m} = sponsorClaimMessagesV4(context, claim).authorization;
  return encodeFunctionData({abi: claimAbi, functionName: "claim", args: [m.entitlementId, m.recipient, m.nonce,
    m.issuedAt, m.expiresAt, signatureBytes(proofs.operator), signatureBytes(proofs.recipient)]});
}
/** Original Safe compatibility-handler wrapping only; no Safe control or
 * threshold/identity approval follows from constructing this message. */
export function sponsorSafeConsentMessageV4(context: RewardChainContext, claim: RewardClaim) {
  const digest = sponsorClaimDigestsV4(context, claim).consent;
  return {domain: {chainId: context.chainId, verifyingContract: walletAddress(claim.recipient)},
    types: {SafeMessage: [{name: "message", type: "bytes"}]} as const, primaryType: "SafeMessage" as const,
    message: {message: encodeAbiParameters([{type: "bytes32"}], [digest])}};
}
/** Matches V4 Solidity including claim lifetime and all return destinations.
 * Reuses V1 row conservation and V3 clock validation, never their commitments. */
export function sponsorAllocationCommitmentV4(plan: SponsorExecutionPlan, slot: number,
  input: RewardFinalPublicationV3 & {snapshotDigest: Hex; awards: readonly RewardPublicAward[]}) {
  const c = sponsorContractConfiguration(plan), publication = normalizeRewardFinalPublicationV3(input);
  demand(Number.isInteger(slot) && slot >= 0 && slot < 6 && c.caps[slot]! > 0n, "invalid_sponsor_allocation_slot");
  demand(publication.reviewPeriod === c.reviewPeriods[slot], "sponsor_review_policy_mismatch");
  const {latestPublicationAt: _, allocationDigest: __, ...rows} = rewardAllocationCommitment({programmeId: c.programmeId,
    campaignId: c.campaignIds[slot]!, programmeManifestHash: c.manifestHash, snapshotDigest: input.snapshotDigest,
    latestPublicationAt: publication.officialPublishedAt, awards: input.awards, enabledPot: slot === 0 ? 1 : 0, budget: c.caps[slot]!});
  const parameters = parseAbiParameters("bytes32,bytes32,bytes32,bytes32,uint8,uint256[2],uint256[2],bytes32,uint256,uint256,uint256,address,address,address,uint64,uint64,bytes32" + (plan.version===5?",address":""));
  const allocationDigest = keccak256(encodeAbiParameters(parameters,[rows.programmeId, rows.campaignId, rows.programmeManifestHash, rows.snapshotDigest, rows.enabledPot,
    rows.budgets, rows.allocated, rows.uploadDigest, rows.entitlementCount, publication.reviewPeriod,
    c.claimLifetime, c.unallocatedTreasury, c.expiredTreasury, c.funder, publication.reviewStartedAt,
    publication.officialPublishedAt, publication.publicationEvidenceHash, ...(plan.version===5 ? [plan.walletRegistry as Address] : [])]));
  return {...rows, ...publication, protocolVersion: plan.version, allocationDigest};
}
