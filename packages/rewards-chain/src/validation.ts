import { getAddress, isAddress, type Address, type Hex } from "viem";

export class RewardProtocolError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "RewardProtocolError"; }
}
export function demand(condition: unknown, code: string): asserts condition {
  if (!condition) throw new RewardProtocolError(code);
}
export function uint(value: bigint, bits: 64 | 256 = 256): bigint {
  demand(typeof value === "bigint" && value >= 0n && value < (1n << BigInt(bits)), "invalid_reward_uint");
  return value;
}
export function bytes32(value: Hex, allowZero = false): Hex {
  demand(typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value), "invalid_reward_bytes32");
  demand(allowZero || BigInt(value) !== 0n, "zero_reward_identifier");
  return value.toLowerCase() as Hex;
}
export function walletAddress(value: Address): Address {
  demand(typeof value === "string" && isAddress(value), "invalid_reward_address");
  demand(BigInt(value) !== 0n, "zero_reward_address");
  return getAddress(value);
}
export function signatureBytes(value: Hex): Hex {
  demand(typeof value === "string" && /^0x(?:[0-9a-fA-F]{2}){1,8192}$/.test(value), "invalid_reward_signature_bytes");
  return value.toLowerCase() as Hex;
}
export function potIndex(pot: "race" | "league"): 0 | 1 {
  demand(pot === "race" || pot === "league", "invalid_reward_pot");
  return pot === "race" ? 0 : 1;
}
export function kindIndex(kind: "athlete" | "club"): 0 | 1 {
  demand(kind === "athlete" || kind === "club", "invalid_reward_beneficiary_kind");
  return kind === "athlete" ? 0 : 1;
}
export type RewardChainContext = {
  environment: "monad-testnet" | "local-simulation";
  chainId: number;
  verifyingContract: Address;
};
export function rewardChainContext(input: RewardChainContext): RewardChainContext {
  demand((input.environment === "monad-testnet" && input.chainId === 10143)
    || (input.environment === "local-simulation" && input.chainId === 31337), "unsupported_reward_chain");
  return { environment: input.environment, chainId: input.chainId, verifyingContract: walletAddress(input.verifyingContract) };
}
