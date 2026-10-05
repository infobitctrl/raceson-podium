import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultRewardProgrammeDraftV2, decodeRewardProgrammeDraftV2,
  previewRewardProgrammeDraftV2, previewRewardRankSlotsV2, REWARD_V2_REVIEW_SECONDS,
} from "../../../packages/domain/dist/rewards/programme-draft-v2.js";
import {
  MAX_REWARD_UINT256, RewardCalculationError, splitRewardProgramme,
} from "../../../packages/domain/dist/rewards/arithmetic.js";

const mon = 10n ** 18n;
const draft = createDefaultRewardProgrammeDraftV2;
const fails = (code, run) => assert.throws(run, (error) =>
  error instanceof RewardCalculationError && error.code === code);
const amounts = (rows) => Object.fromEntries(rows.map((row) => [row.key, row.amount]));

test("v2 plans 100000 test MON, 50000 league and five 10000 rounds without claiming funding", () => {
  const plan = previewRewardProgrammeDraftV2(draft());
  assert.equal(plan.kind, "planning_only");
  assert.equal(plan.network, "monad-testnet");
  assert.equal(plan.assetLabel, "test MON");
  assert.equal(plan.budgetWei, 100_000n * mon);
  assert.equal(plan.leagueBudgetWei, 50_000n * mon);
  assert.equal(plan.raceBudgetWei, 50_000n * mon);
  assert.deepEqual(plan.rounds.map((round) => [round.slot, round.amountWei]),
    [1, 2, 3, 4, 5].map((slot) => [slot, 10_000n * mon]));
  assert.equal(plan.rounds.slice(0, 4).reduce((sum, round) => sum + round.amountWei, 0n), 40_000n * mon);
  assert.equal(Object.hasOwn(plan, "fundedWei"), false);
  assert.equal(Object.hasOwn(plan, "awards"), false);
  assert.equal(Object.hasOwn(plan, "contractAddress"), false);
});

test("v2 proposed family presets reconcile independently under every campaign", () => {
  const plan = previewRewardProgrammeDraftV2(draft());
  for (const round of plan.rounds) assert.deepEqual(amounts(round.families),
    { athlete_standings: 8_000n * mon, club_standings: 2_000n * mon });
  assert.deepEqual(amounts(plan.leagueFamilies),
    { athlete_standings: 25_000n * mon, club_standings: 10_000n * mon, participation_metres: 15_000n * mon });
});

test("v2 accepts configurable complete splits without hardcoding the starting preset", () => {
  const input = draft();
  input.leagueShareBps = 4_000;
  input.roundSharesBps = [2_000, 1_000, 1_000, 1_000, 1_000];
  input.raceFamilySharesBps = { athleteStandings: 7_500, clubStandings: 2_500 };
  input.leagueFamilySharesBps = { athleteStandings: 0, clubStandings: 0, participationMetres: 10_000 };
  const plan = previewRewardProgrammeDraftV2(input);
  assert.equal(plan.leagueBudgetWei, 40_000n * mon);
  assert.equal(plan.rounds[0].amountWei, 20_000n * mon);
  assert.equal(amounts(plan.rounds[0].families).club_standings, 5_000n * mon);
  assert.equal(amounts(plan.leagueFamilies).participation_metres, 40_000n * mon);
});

test("v2 race curve gives 70 percent to top three and declines through ten slots", () => {
  const slots = previewRewardRankSlotsV2(10_000n, draft().raceRankWeights);
  assert.deepEqual(slots.map((slot) => slot.amountWei), [3500n, 2000n, 1500n, 800n, 600n, 500n, 400n, 300n, 250n, 150n]);
  assert.equal(slots.slice(0, 3).reduce((sum, slot) => sum + slot.amountWei, 0n), 7000n);
  assert.deepEqual(slots.map((slot) => slot.rank), Array.from({ length: 10 }, (_, index) => index + 1));
});

test("v2 league curve keeps 30/20/10 percent podium and descending 40 percent tail", () => {
  const slots = previewRewardRankSlotsV2(2530n, draft().leagueRankWeights);
  assert.deepEqual(slots.slice(0, 3).map((slot) => slot.amountWei), [759n, 506n, 253n]);
  assert.deepEqual(slots.slice(3).map((slot) => slot.amountWei), Array.from({ length: 22 }, (_, index) => BigInt((22 - index) * 4)));
  assert.equal(slots.reduce((sum, slot) => sum + slot.amountWei, 0n), 2530n);
});

test("v2 budget inputs retain exact wei including uint256 limits and tiny rounding cases", () => {
  const inputs = ["0.000000000000000001", "0.000000000000000007", "123.123456789123456789",
    (MAX_REWARD_UINT256 / mon).toString() + "." + (MAX_REWARD_UINT256 % mon).toString().padStart(18, "0")];
  for (const budgetMon of inputs) {
    const plan = previewRewardProgrammeDraftV2({ ...draft(), budgetMon });
    assert.equal(plan.raceBudgetWei + plan.leagueBudgetWei, plan.budgetWei);
    for (const round of plan.rounds) {
      assert.equal(round.families.reduce((sum, row) => sum + row.amount, 0n), round.amountWei);
    }
    assert.equal(plan.leagueFamilies.reduce((sum, row) => sum + row.amount, 0n), plan.leagueBudgetWei);
  }
});

test("v2 preserves exact 24 hours and rejects every alternate review clock", () => {
  assert.equal(REWARD_V2_REVIEW_SECONDS, 86_400);
  for (const reviewSeconds of [0, 23 * 3600, 48 * 3600, 72 * 3600, "86400", 86400.5, null]) {
    fails("v2_requires_one_24h_review", () => decodeRewardProgrammeDraftV2({ ...draft(), reviewSeconds }));
  }
});

test("v2 rejects wrong versions, mainnet and unexpected approval/funding fields", () => {
  fails("unsupported_reward_draft_version", () => decodeRewardProgrammeDraftV2({ ...draft(), version: 1 }));
  for (const network of ["monad-mainnet", "ethereum", 10143, null]) {
    fails("v2_requires_monad_testnet", () => decodeRewardProgrammeDraftV2({ ...draft(), network }));
  }
  for (const field of ["approved", "fundedWei", "contractAddress", "athleteWallet", "sourceResultIds"]) {
    fails("invalid_v2_programme_draft", () => decodeRewardProgrammeDraftV2({ ...draft(), [field]: true }));
  }
  for (const input of [null, [], "draft", new Date(), { ...draft(), [Symbol("extra")]: true }]) {
    fails("invalid_v2_programme_draft", () => decodeRewardProgrammeDraftV2(input));
  }
});

test("v2 rejects missing fields and malformed nested families", () => {
  const missing = draft(); delete missing.reviewSeconds;
  fails("invalid_v2_programme_draft", () => decodeRewardProgrammeDraftV2(missing));
  fails("invalid_v2_race_families", () => decodeRewardProgrammeDraftV2({
    ...draft(), raceFamilySharesBps: { ...draft().raceFamilySharesBps, records: 0 },
  }));
  fails("invalid_v2_league_families", () => decodeRewardProgrammeDraftV2({
    ...draft(), leagueFamilySharesBps: null,
  }));
});

test("v2 refuses partial or excessive top-level and family percentage totals", () => {
  for (const offset of [-1, 1]) {
    fails("v2_shares_must_total_10000", () => decodeRewardProgrammeDraftV2({ ...draft(), leagueShareBps: 5000 + offset }));
    fails("v2_shares_must_total_10000", () => decodeRewardProgrammeDraftV2({
      ...draft(), raceFamilySharesBps: { athleteStandings: 8000 + offset, clubStandings: 2000 },
    }));
    fails("v2_shares_must_total_10000", () => decodeRewardProgrammeDraftV2({
      ...draft(), leagueFamilySharesBps: { athleteStandings: 5000, clubStandings: 2000, participationMetres: 3000 + offset },
    }));
  }
});

test("v2 refuses non-integer percentages, malformed round lists and sparse arrays", () => {
  for (const leagueShareBps of [NaN, Infinity, -1, 10001, 5000.5, "5000"]) {
    fails("invalid_v2_share", () => decodeRewardProgrammeDraftV2({ ...draft(), leagueShareBps }));
  }
  for (const roundSharesBps of [[], [1000], Array(6).fill(1000), "five", null]) {
    fails("programme_requires_five_rounds", () => decodeRewardProgrammeDraftV2({ ...draft(), roundSharesBps }));
  }
  fails("invalid_v2_share", () => decodeRewardProgrammeDraftV2({ ...draft(), roundSharesBps: Array(5) }));
});

test("v2 rejects zero, malformed, overflowing and over-precise MON inputs", () => {
  fails("v2_budget_must_be_positive", () => decodeRewardProgrammeDraftV2({ ...draft(), budgetMon: "0" }));
  for (const budgetMon of ["-1", "100,000", "1e5", " 100000", "01", 100000, null]) {
    fails("invalid_decimal_amount", () => decodeRewardProgrammeDraftV2({ ...draft(), budgetMon }));
  }
  fails("unsupported_decimal_precision", () => decodeRewardProgrammeDraftV2({
    ...draft(), budgetMon: "0.0000000000000000001",
  }));
  fails("invalid_unsigned_amount", () => decodeRewardProgrammeDraftV2({
    ...draft(), budgetMon: (MAX_REWARD_UINT256 / mon + 1n).toString(),
  }));
});

test("v2 curves have exactly ten/twenty-five positive bounded declining weights", () => {
  for (const property of ["raceRankWeights", "leagueRankWeights"]) {
    const original = draft();
    fails("invalid_v2_rank_count", () => decodeRewardProgrammeDraftV2({ ...original, [property]: [1, 1, 1] }));
    for (const invalid of [0, -1, 1.5, NaN, Infinity, 1_000_001, "3500", undefined]) {
      const weights = [...original[property]]; weights[0] = invalid;
      fails("invalid_v2_rank_weight", () => decodeRewardProgrammeDraftV2({ ...original, [property]: weights }));
    }
    const rising = [...original[property]]; rising[1] = rising[0] + 1;
    fails("v2_rank_weights_must_decline", () => decodeRewardProgrammeDraftV2({ ...original, [property]: rising }));
    fails("invalid_v2_rank_weight", () => decodeRewardProgrammeDraftV2({ ...original, [property]: Array(original[property].length) }));
  }
});

test("v2 decoding copies nested inputs and defaults never share mutable state", () => {
  const original = draft();
  const decoded = decodeRewardProgrammeDraftV2(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(decoded, original);
  decoded.roundSharesBps[0] = 0;
  decoded.raceRankWeights[0] = 1;
  decoded.raceFamilySharesBps.athleteStandings = 0;
  assert.equal(original.roundSharesBps[0], 1000);
  assert.equal(draft().raceRankWeights[0], 3500);
  assert.equal(draft().raceFamilySharesBps.athleteStandings, 8000);
});

test("v2 prize-slot previews conserve tiny amounts, preserve zero slots and reject invalid budgets", () => {
  for (const weights of [draft().raceRankWeights, draft().leagueRankWeights]) {
    for (const amount of [0n, 1n, 7n, 1000n, MAX_REWARD_UINT256]) {
      const slots = previewRewardRankSlotsV2(amount, weights);
      assert.equal(slots.length, weights.length);
      assert.equal(slots.reduce((sum, slot) => sum + slot.amountWei, 0n), amount);
      assert.deepEqual(previewRewardRankSlotsV2(amount, weights), slots);
    }
    fails("invalid_unsigned_amount", () => previewRewardRankSlotsV2(-1n, weights));
  }
  fails("invalid_v2_rank_count", () => previewRewardRankSlotsV2(1n, [1, 1, 1]));
});

test("v2 does not reinterpret the historical v1 split or require wallets/source IDs to plan", () => {
  const old = splitRewardProgramme(100n, ["r1", "r2", "r3", "r4", "r5"]);
  assert.equal(old.raceBudget, 60n);
  assert.equal(old.leagueBudget, 40n);
  assert.equal(decodeRewardProgrammeDraftV2(draft()).version, 2);
});
