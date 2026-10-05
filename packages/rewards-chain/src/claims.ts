import { encodeAbiParameters, encodeFunctionData, hashTypedData, type Address, type Hex } from "viem";
import { rewardCampaignAbi } from "./abi.js";
import { bytes32, demand, potIndex, rewardChainContext, signatureBytes, uint, walletAddress, type RewardChainContext } from "./validation.js";

export const claimAuthorizationTypes = { ClaimAuthorization: [
  { name: "entitlementId", type: "bytes32" }, { name: "recipient", type: "address" },
  { name: "nonce", type: "uint256" }, { name: "issuedAt", type: "uint64" },
  { name: "expiresAt", type: "uint64" }, { name: "allocationDigest", type: "bytes32" },
] } as const;
export const receiveRewardTypes = { ReceiveReward: [
  { name: "entitlementId", type: "bytes32" }, { name: "recipient", type: "address" },
  { name: "amount", type: "uint256" }, { name: "pot", type: "uint8" },
  { name: "nonce", type: "uint256" }, { name: "issuedAt", type: "uint64" },
  { name: "expiresAt", type: "uint64" }, { name: "allocationDigest", type: "bytes32" },
] } as const;

export type RewardClaim = {
  entitlementId: Hex; recipient: Address; amount: bigint; pot: "race" | "league";
  nonce: bigint; issuedAt: bigint; expiresAt: bigint; allocationDigest: Hex;
};

/** Amount/pot/digest come from approved DB + matching on-chain state, never browser input. */
export function rewardClaimMessages(context: RewardChainContext, input: RewardClaim) {
  const chain = rewardChainContext(context);
  const amount = uint(input.amount);
  demand(amount > 0n, "zero_reward_claim");
  const pot = potIndex(input.pot);
  const shared = { entitlementId: bytes32(input.entitlementId), recipient: walletAddress(input.recipient), nonce: uint(input.nonce),
    issuedAt: uint(input.issuedAt, 64), expiresAt: uint(input.expiresAt, 64), allocationDigest: bytes32(input.allocationDigest) };
  demand(shared.expiresAt > shared.issuedAt && shared.expiresAt - shared.issuedAt <= 86_400n, "invalid_reward_claim_lifetime");
  const domain = { name: "RacesOnRewardCampaign", version: "2", chainId: chain.chainId, verifyingContract: chain.verifyingContract } as const;
  return {
    authorization: { domain, types: claimAuthorizationTypes, primaryType: "ClaimAuthorization" as const, message: { ...shared } },
    consent: { domain, types: receiveRewardTypes, primaryType: "ReceiveReward" as const, message: { ...shared, amount, pot } },
  };
}

export function rewardClaimDigests(context: RewardChainContext, input: RewardClaim) {
  const { authorization, consent } = rewardClaimMessages(context, input);
  return { authorization: hashTypedData(authorization), consent: hashTypedData(consent) };
}

/** Signature lifetime does not extend during a campaign pause. Call before signing/queueing/sending. */
export function requireLiveRewardClaim(context: RewardChainContext, input: RewardClaim, chainTime: bigint, claimDeadline: bigint): void {
  rewardClaimMessages(context, input);
  uint(chainTime); uint(claimDeadline);
  demand(input.issuedAt <= chainTime && chainTime < input.expiresAt && chainTime < claimDeadline, "reward_claim_not_live");
}

export function encodeRewardClaim(context: RewardChainContext, input: RewardClaim, proofs: { operator: Hex; recipient: Hex }): Hex {
  const { message } = rewardClaimMessages(context, input).authorization;
  return encodeFunctionData({ abi: rewardCampaignAbi, functionName: "claim", args: [message.entitlementId, message.recipient,
    message.nonce, message.issuedAt, message.expiresAt, signatureBytes(proofs.operator), signatureBytes(proofs.recipient)] });
}

/** Safe 1.4.1 compatibility-handler wrapping. UI should use the vetted Protocol Kit;
 *  this canonical message also supports cross-language compatibility checks. */
export function safeRewardConsentMessage(context: RewardChainContext, input: RewardClaim) {
  const chain = rewardChainContext(context);
  const digest = rewardClaimDigests(context, input).consent;
  return { domain: { chainId: chain.chainId, verifyingContract: walletAddress(input.recipient) },
    types: { SafeMessage: [{ name: "message", type: "bytes" }] } as const, primaryType: "SafeMessage" as const,
    message: { message: encodeAbiParameters([{ type: "bytes32" }], [digest]) } };
}
