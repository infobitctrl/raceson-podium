import {
  allocateRewardWeights,
  parseRewardUnits,
  requireReward,
  type WeightedAllocation,
} from "./arithmetic.js";

export const REWARD_V2_REVIEW_SECONDS = 86_400;
export const REWARD_V2_DEFAULT_BUDGET_MON = "100000";
const BASIS_POINTS = 10_000;
const MAX_RANK_WEIGHT = 1_000_000;

type RaceShares = { athleteStandings: number; clubStandings: number };
type LeagueShares = RaceShares & { participationMetres: number };

/** Planning input only. This is not a source-approved award or funding manifest. */
export type RewardProgrammeDraftV2 = {
  version: 2;
  network: "monad-testnet";
  budgetMon: string;
  reviewSeconds: typeof REWARD_V2_REVIEW_SECONDS;
  leagueShareBps: number;
  roundSharesBps: number[];
  raceFamilySharesBps: RaceShares;
  leagueFamilySharesBps: LeagueShares;
  raceRankWeights: number[];
  leagueRankWeights: number[];
};

export type RewardProgrammePreviewV2 = {
  version: 2;
  kind: "planning_only";
  network: "monad-testnet";
  assetLabel: "test MON";
  reviewSeconds: typeof REWARD_V2_REVIEW_SECONDS;
  budgetWei: bigint;
  raceBudgetWei: bigint;
  leagueBudgetWei: bigint;
  rounds: Array<{ slot: number; amountWei: bigint; families: WeightedAllocation[] }>;
  leagueFamilies: WeightedAllocation[];
};

function record(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  requireReward(value !== null && typeof value === "object" && !Array.isArray(value), code);
  const prototype = Object.getPrototypeOf(value);
  requireReward(prototype === Object.prototype || prototype === null, code);
  const input = value as Record<string, unknown>;
  requireReward(Reflect.ownKeys(input).length === keys.length
    && keys.every((key) => Object.hasOwn(input, key)), code);
  return input;
}

function share(value: unknown): number {
  requireReward(typeof value === "number" && Number.isSafeInteger(value)
    && value >= 0 && value <= BASIS_POINTS, "invalid_v2_share");
  return value;
}

function completeShares(values: readonly number[]): void {
  requireReward(values.reduce((sum, value) => sum + value, 0) === BASIS_POINTS,
    "v2_shares_must_total_10000");
}

function rankWeights(value: unknown, count: number): number[] {
  requireReward(Array.isArray(value) && value.length === count, "invalid_v2_rank_count");
  const weights = Array.from(value, (weight: unknown) => {
    requireReward(typeof weight === "number" && Number.isSafeInteger(weight)
      && weight > 0 && weight <= MAX_RANK_WEIGHT, "invalid_v2_rank_weight");
    return weight;
  });
  requireReward(weights.every((weight, index) => index === 0 || weight <= weights[index - 1]!),
    "v2_rank_weights_must_decline");
  return weights;
}

/** Strict JSON-shaped boundary; no amount, chain, review or extra-field coercion. */
export function decodeRewardProgrammeDraftV2(value: unknown): RewardProgrammeDraftV2 {
  const input = record(value, [
    "version", "network", "budgetMon", "reviewSeconds", "leagueShareBps", "roundSharesBps",
    "raceFamilySharesBps", "leagueFamilySharesBps", "raceRankWeights", "leagueRankWeights",
  ], "invalid_v2_programme_draft");
  requireReward(input.version === 2, "unsupported_reward_draft_version");
  requireReward(input.network === "monad-testnet", "v2_requires_monad_testnet");
  requireReward(input.reviewSeconds === REWARD_V2_REVIEW_SECONDS, "v2_requires_one_24h_review");
  requireReward(typeof input.budgetMon === "string", "invalid_decimal_amount");
  requireReward(parseRewardUnits(input.budgetMon, 18) > 0n, "v2_budget_must_be_positive");
  requireReward(Array.isArray(input.roundSharesBps) && input.roundSharesBps.length === 5,
    "programme_requires_five_rounds");
  const roundSharesBps = Array.from(input.roundSharesBps, share);
  const leagueShareBps = share(input.leagueShareBps);
  completeShares([leagueShareBps, ...roundSharesBps]);
  const race = record(input.raceFamilySharesBps, ["athleteStandings", "clubStandings"],
    "invalid_v2_race_families");
  const league = record(input.leagueFamilySharesBps,
    ["athleteStandings", "clubStandings", "participationMetres"], "invalid_v2_league_families");
  const raceFamilySharesBps = {
    athleteStandings: share(race.athleteStandings), clubStandings: share(race.clubStandings),
  };
  const leagueFamilySharesBps = {
    athleteStandings: share(league.athleteStandings), clubStandings: share(league.clubStandings),
    participationMetres: share(league.participationMetres),
  };
  completeShares(Object.values(raceFamilySharesBps));
  completeShares(Object.values(leagueFamilySharesBps));
  return {
    version: 2, network: "monad-testnet", budgetMon: input.budgetMon,
    reviewSeconds: REWARD_V2_REVIEW_SECONDS, leagueShareBps, roundSharesBps,
    raceFamilySharesBps, leagueFamilySharesBps,
    raceRankWeights: rankWeights(input.raceRankWeights, 10),
    leagueRankWeights: rankWeights(input.leagueRankWeights, 25),
  };
}

/** Owner-confirmed headline budget, with explicitly proposed editable internal presets. */
export function createDefaultRewardProgrammeDraftV2(): RewardProgrammeDraftV2 {
  return decodeRewardProgrammeDraftV2({
    version: 2, network: "monad-testnet", budgetMon: REWARD_V2_DEFAULT_BUDGET_MON,
    reviewSeconds: REWARD_V2_REVIEW_SECONDS, leagueShareBps: 5_000,
    roundSharesBps: [1_000, 1_000, 1_000, 1_000, 1_000],
    raceFamilySharesBps: { athleteStandings: 8_000, clubStandings: 2_000 },
    leagueFamilySharesBps: { athleteStandings: 5_000, clubStandings: 2_000, participationMetres: 3_000 },
    raceRankWeights: [3_500, 2_000, 1_500, 800, 600, 500, 400, 300, 250, 150],
    // Total 2530: podium 30/20/10%; tail 40% in descending weights 22..1.
    leagueRankWeights: [759, 506, 253, ...Array.from({ length: 22 }, (_, index) => (22 - index) * 4)],
  });
}

function amountFor(rows: readonly WeightedAllocation[], key: string): bigint {
  const row = rows.find((candidate) => candidate.key === key);
  requireReward(row, "missing_v2_planning_allocation");
  return row.amount;
}

/** Shared chart/editor math. Does not read results, create entitlements or assert funding. */
export function previewRewardProgrammeDraftV2(value: unknown): RewardProgrammePreviewV2 {
  const draft = decodeRewardProgrammeDraftV2(value);
  const budgetWei = parseRewardUnits(draft.budgetMon, 18);
  const split = allocateRewardWeights(budgetWei, [
    { key: "league", weight: BigInt(draft.leagueShareBps) },
    ...draft.roundSharesBps.map((weight, index) => ({ key: "round-" + (index + 1), weight: BigInt(weight) })),
  ]).allocations;
  const leagueBudgetWei = amountFor(split, "league");
  const rounds = draft.roundSharesBps.map((_, index) => {
    const amountWei = amountFor(split, "round-" + (index + 1));
    return {
      slot: index + 1, amountWei,
      families: allocateRewardWeights(amountWei, [
        { key: "athlete_standings", weight: BigInt(draft.raceFamilySharesBps.athleteStandings) },
        { key: "club_standings", weight: BigInt(draft.raceFamilySharesBps.clubStandings) },
      ]).allocations,
    };
  });
  return {
    version: 2, kind: "planning_only", network: "monad-testnet", assetLabel: "test MON",
    reviewSeconds: REWARD_V2_REVIEW_SECONDS, budgetWei, leagueBudgetWei,
    raceBudgetWei: rounds.reduce((sum, round) => sum + round.amountWei, 0n),
    rounds,
    leagueFamilies: allocateRewardWeights(leagueBudgetWei, [
      { key: "athlete_standings", weight: BigInt(draft.leagueFamilySharesBps.athleteStandings) },
      { key: "club_standings", weight: BigInt(draft.leagueFamilySharesBps.clubStandings) },
      { key: "participation_metres", weight: BigInt(draft.leagueFamilySharesBps.participationMetres) },
    ]).allocations,
  };
}

/** Prize-slot chart, not recipient awards. Missing finishers must not renormalize these slots. */
export function previewRewardRankSlotsV2(budgetWei: bigint, weights: readonly number[]) {
  requireReward(Array.isArray(weights) && (weights.length === 10 || weights.length === 25),
    "invalid_v2_rank_count");
  const checked = rankWeights(weights, weights.length);
  return allocateRewardWeights(budgetWei, checked.map((weight, index) => ({
    key: "rank-" + String(index + 1).padStart(2, "0"), weight: BigInt(weight),
  }))).allocations.map((row, index) => ({ rank: index + 1, amountWei: row.amount }));
}

export type SavedRewardPlanningDraft = {
  draftId: string; organizationId: string; seasonId: string; chainId: 31337 | 10143;
  organizationName: string; seasonName: string; revision: number; updatedAt: string;
  rules: RewardProgrammeDraftV2;
};
export function decodeSavedRewardPlanningDraft(value: unknown): SavedRewardPlanningDraft {
  const d = record(value, ["draftId", "organizationId", "seasonId", "chainId", "organizationName", "seasonName", "revision", "updatedAt", "rules"], "invalid_saved_reward_draft");
  function id(value: unknown): string {
    requireReward(typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
      && value !== "00000000-0000-0000-0000-000000000000", "invalid_saved_reward_draft"); return value;
  }
  function label(value: unknown): string {
    requireReward(typeof value === "string" && value.trim().length > 0 && value.length <= 512, "invalid_saved_reward_draft"); return value;
  }
  requireReward(d.chainId === 31337 || d.chainId === 10143, "invalid_saved_reward_draft");
  requireReward(typeof d.revision === "number" && Number.isInteger(d.revision) && d.revision > 0 && d.revision < 2147483647, "invalid_saved_reward_draft");
  requireReward(typeof d.updatedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(d.updatedAt) && Number.isFinite(Date.parse(d.updatedAt)), "invalid_saved_reward_draft");
  return { draftId: id(d.draftId), organizationId: id(d.organizationId), seasonId: id(d.seasonId),
    chainId: d.chainId, organizationName: label(d.organizationName), seasonName: label(d.seasonName),
    revision: d.revision, updatedAt: d.updatedAt, rules: decodeRewardProgrammeDraftV2(d.rules) };
}
