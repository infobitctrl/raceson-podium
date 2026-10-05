import { allocateRewardWeights, compareRewardKeys, requireReward, requireRewardKey, requireUnsigned } from "./arithmetic.js";

export type RewardRank = { key: string; rank: number };

/** Competition ranking: 1,1,3; never silently reinterpret dense ranks 1,1,2. */
export function allocateRewardPodium(budget: bigint, input: readonly RewardRank[]) {
  const seen = new Set<string>();
  const ranks = [...input].sort((a, b) => a.rank - b.rank || compareRewardKeys(a.key, b.key));
  for (const row of ranks) {
    requireRewardKey(row.key);
    requireReward(!seen.has(row.key), "duplicate_podium_beneficiary");
    requireReward(Number.isSafeInteger(row.rank) && row.rank > 0, "invalid_podium_rank");
    seen.add(row.key);
  }
  const slots = allocateRewardWeights(budget, [
    { key: "1", weight: 5n }, { key: "2", weight: 3n }, { key: "3", weight: 2n },
  ]).allocations;
  const allocations: { key: string; amount: bigint; rank: number; tieSize: number; sharedPrizeWei: bigint; prizeSlots: number[] }[] = [];
  let index = 0;
  while (index < ranks.length) {
    const rank = ranks[index].rank;
    requireReward(rank === index + 1, "inconsistent_podium_rank_structure");
    let end = index + 1;
    while (end < ranks.length && ranks[end].rank === rank) end += 1;
    const occupied = slots.filter((slot) => Number(slot.key) >= rank && Number(slot.key) < rank + end - index);
    const pool = occupied.reduce((sum, slot) => sum + slot.amount, 0n);
    allocations.push(...allocateRewardWeights(pool, ranks.slice(index, end).map(({ key }) => ({ key, weight: 1n })))
      .allocations.map(({ key, amount }) => ({ key, amount, rank, tieSize: end - index, sharedPrizeWei: pool,
        prizeSlots: occupied.map((slot) => Number(slot.key)) })));
    index = end;
  }
  return {
    allocations: allocations.sort((a, b) => compareRewardKeys(a.key, b.key)),
    unallocated: budget - allocations.reduce((sum, row) => sum + row.amount, 0n),
  };
}

export function rankRewardScores(input: readonly { key: string; score: bigint }[]): RewardRank[] {
  const seen = new Set<string>();
  for (const { key, score } of input) {
    requireRewardKey(key);
    requireReward(!seen.has(key), "duplicate_score_beneficiary");
    requireUnsigned(score, "invalid_ranking_score");
    seen.add(key);
  }
  const sorted = [...input].sort((a, b) => a.score === b.score
    ? compareRewardKeys(a.key, b.key) : a.score > b.score ? -1 : 1);
  let previousScore: bigint | undefined;
  let rank = 0;
  return sorted.map(({ key, score }, index) => {
    if (score !== previousScore) rank = index + 1;
    previousScore = score;
    return { key, rank };
  });
}
