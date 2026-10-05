export const MAX_REWARD_UINT256 = (1n << 256n) - 1n;

export class RewardCalculationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "RewardCalculationError";
  }
}

export function requireReward(condition: unknown, code: string): asserts condition {
  if (!condition) throw new RewardCalculationError(code);
}

export function requireUnsigned(value: bigint, code = "invalid_unsigned_amount"): void {
  requireReward(typeof value === "bigint" && value >= 0n && value <= MAX_REWARD_UINT256, code);
}

/** Byte/code-point ordering, never locale-dependent sporting or money ordering. */
export function compareRewardKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function requireRewardKey(value: string): void {
  requireReward(typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value), "invalid_reward_key");
}

/** Parse exact decimal inputs, allowing insignificant trailing zeros, never rounding. */
export function parseRewardUnits(value: string, decimals: number): bigint {
  requireReward(Number.isInteger(decimals) && decimals >= 0 && decimals <= 18, "invalid_unit_precision");
  requireReward(typeof value === "string" && value.length <= 100 && /^(0|[1-9]\d*)(\.\d+)?$/.test(value), "invalid_decimal_amount");
  const [whole, fraction = ""] = value.split(".");
  const significant = fraction.replace(/0+$/, "");
  requireReward(significant.length <= decimals, "unsupported_decimal_precision");
  const result = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(significant.padEnd(decimals, "0") || "0");
  requireUnsigned(result);
  return result;
}

export type WeightedReward = { key: string; weight: bigint };
export type WeightedAllocation = WeightedReward & { amount: bigint };

export function allocateRewardWeights(budget: bigint, input: readonly WeightedReward[]): {
  allocations: WeightedAllocation[];
  unallocated: bigint;
} {
  requireUnsigned(budget);
  const seen = new Set<string>();
  const rows = input.map(({ key, weight }) => {
    requireRewardKey(key);
    requireReward(!seen.has(key), "duplicate_weight_key");
    seen.add(key);
    requireUnsigned(weight, "invalid_reward_weight");
    return { key, weight, amount: 0n, remainder: 0n };
  });
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0n);
  if (totalWeight === 0n) {
    return { allocations: rows.sort((a, b) => compareRewardKeys(a.key, b.key)).map(({ key, weight, amount }) => ({ key, weight, amount })), unallocated: budget };
  }
  for (const row of rows) {
    // Intermediates intentionally use arbitrary precision; outputs remain uint256.
    row.amount = budget * row.weight / totalWeight;
    row.remainder = budget * row.weight % totalWeight;
  }
  let remaining = budget - rows.reduce((sum, row) => sum + row.amount, 0n);
  rows.sort((a, b) => a.remainder === b.remainder
    ? compareRewardKeys(a.key, b.key) : a.remainder > b.remainder ? -1 : 1);
  for (const row of rows) {
    if (remaining === 0n) break;
    requireReward(row.weight > 0n, "invalid_remainder_allocation");
    row.amount += 1n;
    remaining -= 1n;
  }
  requireReward(remaining === 0n, "allocation_does_not_conserve_budget");
  return {
    allocations: rows.sort((a, b) => compareRewardKeys(a.key, b.key)).map(({ key, weight, amount }) => ({ key, weight, amount })),
    unallocated: 0n,
  };
}

export function splitRewardProgramme(budget: bigint, roundIds: readonly string[]) {
  requireUnsigned(budget);
  requireReward(roundIds.length === 5, "programme_requires_five_rounds");
  const raceBudget = budget * 3n / 5n;
  const leagueBudget = budget - raceBudget;
  return {
    raceBudget,
    leagueBudget,
    rounds: allocateRewardWeights(raceBudget, roundIds.map((key) => ({ key, weight: 1n }))).allocations,
    leagueFamilies: allocateRewardWeights(leagueBudget, [
      { key: "athlete_metres", weight: 3n }, { key: "club_finishes", weight: 1n },
    ]).allocations,
  };
}

export function splitRaceRewardBudget(budget: bigint) {
  return allocateRewardWeights(budget, [
    { key: "podium", weight: 4n }, { key: "record", weight: 1n }, { key: "club_performance", weight: 1n },
  ]).allocations;
}
