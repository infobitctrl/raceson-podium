import type { StoredRewardSnapshot } from "./published-preview-v2.js";
import { decodeRewardSourceCatalogueV2, validateRewardSourceMappingV2, type RewardSourceCatalogueV2, type RewardSourceMappingV2 } from "./source-mapping-v2.js";

/** A hybrid planning workspace may append one explicitly bound local finale.
 * It may never replace historical IDs, results, distances or classifications.
 * This does not make the native finale part of the immutable V2 snapshot.
 */
export function requireHistoricalCatalogueV3(snapshot: StoredRewardSnapshot, input: RewardSourceCatalogueV2) {
  const catalogue = decodeRewardSourceCatalogueV2(input);
  const historical = { categories: catalogue.categories, rounds: catalogue.rounds.filter(r => r.slot <= 4) };
  const original = { categories: snapshot.catalogue.categories, rounds: snapshot.catalogue.rounds };
  if (JSON.stringify(historical) !== JSON.stringify(original) || catalogue.rounds.length < 4 || catalogue.rounds.length > 5
    || catalogue.rounds.some(r => r.slot > 5)) throw new Error("invalid_reward_historical_catalogue");
  return catalogue;
}

/** Preview only the four imported rounds; retain the native finale and league.
 * Never pass this projection to funding, freezing or allocation approval.
 */
export function historicalMappingOnlyV3(input: RewardSourceMappingV2, catalogue: RewardSourceCatalogueV2) {
  const mapping = validateRewardSourceMappingV2(input, catalogue);
  mapping.rounds[4]!.roundId = null;
  return mapping;
}
