import { encodeAbiParameters, encodeFunctionData, hashTypedData, parseAbi, recoverTypedDataAddress, keccak256, type Address, type Hex } from "viem";
import { rewardAllocationCommitment, type RewardPublicAward } from "./allocation.js";
import { rewardCampaignAbi } from "./abi.js";
import { rewardClaimMessages, type RewardClaim } from "./claims.js";
import { bytes32, demand, RewardProtocolError, rewardChainContext, signatureBytes, uint, walletAddress, type RewardChainContext } from "./validation.js";

/** Explicit new artifact/signing boundary. Historical v1 readers remain unchanged. */
export const rewardCampaignV3Abi = [
  ...rewardCampaignAbi.filter(item => item.type !== "constructor" && !("name" in item && item.name === "stageAllocation")),
  ...parseAbi([
    "constructor(address operator_, address treasury_, bytes32 programmeId_, bytes32 campaignId_, bytes32 programmeManifestHash_, uint8 enabledPot_, uint64 reviewPeriod_)",
    "function stageAllocation(bytes32 snapshotDigest_, bytes32 expectedUploadDigest, uint256 expectedCount, uint64 reviewStartedAt_, uint64 officialPublishedAt_, bytes32 publicationEvidenceHash_)",
    "function PROTOCOL_VERSION() view returns (uint256)",
    "function reviewPeriod() view returns (uint256)",
    "function reviewStartedAt() view returns (uint256)",
    "function officialPublishedAt() view returns (uint256)",
    "function publicationEvidenceHash() view returns (bytes32)",
    "event FinalResultsApproved(bytes32 indexed allocationDigest, bytes32 indexed publicationEvidenceHash, uint256 reviewStartedAt, uint256 reviewPeriod, uint256 officialPublishedAt, uint256 approvedAt)",
  ]),
] as const;
export function rewardClaimMessagesV3(context: RewardChainContext, input: RewardClaim) {
  const validated = rewardClaimMessages(context, input);
  const domain = { ...validated.authorization.domain, version: "4" } as const;
  return { authorization: { ...validated.authorization, domain }, consent: { ...validated.consent, domain } };
}
export function rewardClaimDigestsV3(context: RewardChainContext, input: RewardClaim): { authorization: Hex; consent: Hex } {
  const messages = rewardClaimMessagesV3(context, input);
  return { authorization: hashTypedData(messages.authorization), consent: hashTypedData(messages.consent) };
}
/** V3 EOA proof only, never a live-state/identity check or payment permission.
 * Rebuild domain v4 locally; accepting an API-selected domain would permit a
 * downgrade. Safe/EIP-1271 consent remains a separate two-owner verification.
 * The explicit protocol tag must survive future V3 persistence; do not insert
 * this proof into the historical V1 claim ledger. */
export async function verifyRewardClaimEoaProofV3(context: RewardChainContext, claim: RewardClaim,
  role: "operator" | "recipient", operator: Address, signature: Hex) {
  demand(role === "operator" || role === "recipient", "invalid_reward_claim_proof_role");
  const messages = rewardClaimMessagesV3(context, claim);
  const signer = walletAddress(role === "operator" ? operator : claim.recipient);
  demand(typeof signature === "string" && /^0x[0-9a-fA-F]{130}$/.test(signature), "invalid_reward_claim_signature");
  const normalized = signature.toLowerCase() as Hex;
  // Match the deployed OpenZeppelin ECDSA path: canonical 65-byte, low-S,
  // recovery ID 27/28. Compact, contract-wallet and malleable proofs are refused.
  const s = BigInt(`0x${normalized.slice(66, 130)}`);
  demand(s > 0n && s <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n
    && ["1b", "1c"].includes(normalized.slice(130)), "invalid_reward_claim_signature");
  // All values are copied before awaiting recovery, including the digest.
  const digest = role === "operator" ? hashTypedData(messages.authorization) : hashTypedData(messages.consent);
  let recovered: Address;
  try { recovered = role === "operator"
    ? await recoverTypedDataAddress({ ...messages.authorization, signature: normalized })
    : await recoverTypedDataAddress({ ...messages.consent, signature: normalized }); }
  catch { throw new RewardProtocolError("invalid_reward_claim_signature"); }
  demand(recovered.toLowerCase() === signer.toLowerCase(), "reward_claim_signature_mismatch");
  return { protocolVersion: 3 as const, role, signer: signer.toLowerCase() as Address, digest, signature: normalized };
}
export function encodeRewardClaimV3(context: RewardChainContext, input: RewardClaim, proofs: { operator: Hex; recipient: Hex }): Hex {
  const { message } = rewardClaimMessagesV3(context, input).authorization;
  return encodeFunctionData({ abi: rewardCampaignV3Abi, functionName: "claim", args: [message.entitlementId, message.recipient,
    message.nonce, message.issuedAt, message.expiresAt, signatureBytes(proofs.operator), signatureBytes(proofs.recipient)] });
}
export function safeRewardConsentMessageV3(context: RewardChainContext, input: RewardClaim) {
  const chain = rewardChainContext(context), digest = rewardClaimDigestsV3(chain, input).consent;
  return { domain: { chainId: chain.chainId, verifyingContract: walletAddress(input.recipient) },
    types: { SafeMessage: [{ name: "message", type: "bytes" }] } as const, primaryType: "SafeMessage" as const,
    message: { message: encodeAbiParameters([{ type: "bytes32" }], [digest]) } };
}
/** Evidence is an explicit platform/operator attestation, not chain knowledge of race results. */
export type RewardFinalPublicationV3 = {
  reviewPeriod: bigint; reviewStartedAt: bigint; officialPublishedAt: bigint; publicationEvidenceHash: Hex;
};
export function normalizeRewardFinalPublicationV3(input: RewardFinalPublicationV3) {
  const reviewPeriod = uint(input.reviewPeriod, 64), reviewStartedAt = uint(input.reviewStartedAt, 64);
  const officialPublishedAt = uint(input.officialPublishedAt, 64), publicationEvidenceHash = bytes32(input.publicationEvidenceHash);
  demand(reviewStartedAt > 0n && officialPublishedAt >= reviewStartedAt + reviewPeriod, "reward_review_not_completed");
  return { reviewPeriod, reviewStartedAt, officialPublishedAt, publicationEvidenceHash };
}
export function rewardAllocationCommitmentV3(input: RewardFinalPublicationV3 & {
  programmeId: Hex; campaignId: Hex; programmeManifestHash: Hex; snapshotDigest: Hex;
  awards: readonly RewardPublicAward[]; enabledPot: 0 | 1; budget: bigint;
}) {
  const publication = normalizeRewardFinalPublicationV3(input);
  // Reuse row normalization/conservation only; never use the historical digest.
  const { latestPublicationAt: _, allocationDigest: __, ...rows } = rewardAllocationCommitment({
    ...input, latestPublicationAt: publication.officialPublishedAt,
  });
  const allocationDigest = keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint8" },
    { type: "uint256[2]" }, { type: "uint256[2]" }, { type: "bytes32" }, { type: "uint256" },
    { type: "uint256" }, { type: "uint64" }, { type: "uint64" }, { type: "bytes32" },
  ], [rows.programmeId, rows.campaignId, rows.programmeManifestHash, rows.snapshotDigest, rows.enabledPot,
    rows.budgets, rows.allocated, rows.uploadDigest, rows.entitlementCount, publication.reviewPeriod,
    publication.reviewStartedAt, publication.officialPublishedAt, publication.publicationEvidenceHash]));
  return { ...rows, ...publication, protocolVersion: 3 as const, allocationDigest };
}
export function requireRewardReviewClockV3(input: RewardFinalPublicationV3 & {
  protocolVersion: bigint; stageBlockTimestamp: bigint; activationNotBefore: bigint;
}) {
  const publication = normalizeRewardFinalPublicationV3(input);
  demand(input.protocolVersion === 3n, "wrong_reward_review_protocol");
  const stageBlockTimestamp = uint(input.stageBlockTimestamp), activationNotBefore = uint(input.activationNotBefore);
  demand(stageBlockTimestamp >= publication.officialPublishedAt && activationNotBefore === stageBlockTimestamp,
    "invalid_reward_v3_review_anchor");
  return { ...publication, activationNotBefore };
}
