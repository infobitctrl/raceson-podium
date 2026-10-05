import type { AthleteAllocationV3 } from "@raceson/domain/rewards/athlete-allocations-v3";
import type { RewardAllocation } from "./athleteRewards";

/** Entitlements are counted once. Claim attempts and wallet balances are never earnings. */
export function allocationTotal(awards: Array<Pick<RewardAllocation | AthleteAllocationV3, "chainId" | "entitlementId" | "amountWei">>) {
  const unique = new Map<string, string>();
  for (const award of awards) {
    const key = `${award.chainId}:${award.entitlementId}`;
    if (unique.has(key) && unique.get(key) !== award.amountWei) return null;
    unique.set(key, award.amountWei);
  }
  // Never combine testnet and local simulation balances into a single amount.
  if (new Set(awards.map(a => a.chainId)).size > 1) return null;
  return [...unique.values()].reduce((sum, amount) => sum + BigInt(amount), 0n);
}
