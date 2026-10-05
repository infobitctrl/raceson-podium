import { encodeAbiParameters, encodeFunctionData, hashTypedData, parseAbi, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { rewardCampaignAbi } from "./abi.js";
import { rewardClaimMessages, type RewardClaim } from "./claims.js";
import { demand, RewardProtocolError, rewardChainContext, signatureBytes, uint, walletAddress, type RewardChainContext } from "./validation.js";

/** Explicit new artifact/signing boundary. Historical v1 readers remain unchanged. */
export const rewardCampaignV2Abi = [...rewardCampaignAbi, ...parseAbi([
  "function PROTOCOL_VERSION() view returns (uint256)",
  "function REVIEW_PERIOD() view returns (uint256)",
  "function reviewStartedAt() view returns (uint256)",
])] as const;
export function rewardClaimMessagesV2(context: RewardChainContext, input: RewardClaim) {
  const validated = rewardClaimMessages(context, input);
  const domain = { ...validated.authorization.domain, version: "3" } as const;
  return { authorization: { ...validated.authorization, domain }, consent: { ...validated.consent, domain } };
}
export function rewardClaimDigestsV2(context: RewardChainContext, input: RewardClaim): { authorization: Hex; consent: Hex } {
  const messages = rewardClaimMessagesV2(context, input);
  return { authorization: hashTypedData(messages.authorization), consent: hashTypedData(messages.consent) };
}
/** V2 EOA proof only, never a live-state/identity check or payment permission.
 * Rebuild domain v3 locally; accepting an API-selected domain would permit a
 * downgrade. Safe/EIP-1271 consent remains a separate two-owner verification.
 * The explicit protocol tag must survive future V2 persistence; do not insert
 * this proof into the historical V1 claim ledger. */
export async function verifyRewardClaimEoaProofV2(context: RewardChainContext, claim: RewardClaim,
  role: "operator" | "recipient", operator: Address, signature: Hex) {
  demand(role === "operator" || role === "recipient", "invalid_reward_claim_proof_role");
  const messages = rewardClaimMessagesV2(context, claim);
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
  return { protocolVersion: 2 as const, role, signer: signer.toLowerCase() as Address, digest, signature: normalized };
}
export function encodeRewardClaimV2(context: RewardChainContext, input: RewardClaim, proofs: { operator: Hex; recipient: Hex }): Hex {
  const { message } = rewardClaimMessagesV2(context, input).authorization;
  return encodeFunctionData({ abi: rewardCampaignV2Abi, functionName: "claim", args: [message.entitlementId, message.recipient,
    message.nonce, message.issuedAt, message.expiresAt, signatureBytes(proofs.operator), signatureBytes(proofs.recipient)] });
}
export function safeRewardConsentMessageV2(context: RewardChainContext, input: RewardClaim) {
  const chain = rewardChainContext(context), digest = rewardClaimDigestsV2(chain, input).consent;
  return { domain: { chainId: chain.chainId, verifyingContract: walletAddress(input.recipient) },
    types: { SafeMessage: [{ name: "message", type: "bytes" }] } as const, primaryType: "SafeMessage" as const,
    message: { message: encodeAbiParameters([{ type: "bytes32" }], [digest]) } };
}
/** Consistency check AFTER a verified stage receipt/block; a timestamp alone is not evidence. */
export function requireRewardReviewClockV2(input: { protocolVersion: bigint; period: bigint; reviewStartedAt: bigint;
  stageBlockTimestamp: bigint; activationNotBefore: bigint; latestPublicationAt: bigint }) {
  for (const value of Object.values(input)) uint(value);
  demand(input.protocolVersion === 2n && input.period === 86400n, "wrong_reward_review_protocol");
  demand(input.stageBlockTimestamp > 0n && input.reviewStartedAt === input.stageBlockTimestamp
    && input.latestPublicationAt > 0n && input.latestPublicationAt <= input.reviewStartedAt
    && input.activationNotBefore === input.reviewStartedAt + 86400n, "invalid_reward_v2_review_anchor");
  return { reviewStartedAt: input.reviewStartedAt, activationNotBefore: input.activationNotBefore };
}
