import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_REWARD_UINT256, RewardCalculationError, aggregateRewardEntitlements,
  allocateRewardPodium, allocateRewardWeights, calculateLeagueRewards,
  calculateRoundRewards, parseRewardUnits, rankRewardScores, rewardPayoutHolds,
  selectRewardFinishes, splitRaceRewardBudget, splitRewardProgramme,
} from "../../../packages/domain/dist/rewards/index.js";

// Synthetic evidence only. No names, DOBs, emails, keys or fabricated live results.
const finish = (id, changes = {}) => ({
  sourceId: id, publicationId: "publication-1", roundId: "round-1", raceId: "short",
  athleteId: id, representedClubId: "club-a", gender: "M",
  classificationIds: ["short-adult-male"], courseComparisonKey: "short-course-v1",
  distanceMetres: 6000n, finishTimeMs: 1000n, clubPoints: 60n,
  participationStatus: "finished", resultStatus: "official", ...changes,
});
const long = { raceId: "long", courseComparisonKey: "long-course-v1", distanceMetres: 15000n };
const sources = () => [
  finish("a"),
  finish("b", { ...long, gender: "F", classificationIds: ["long-female"], finishTimeMs: 900n, clubPoints: 90n }),
  finish("c", { ...long, classificationIds: ["long-male"], finishTimeMs: 800n, clubPoints: 80n }),
  finish("d", { gender: "F", classificationIds: ["short-female"], finishTimeMs: 1200n, clubPoints: 70n }),
  finish("e", { representedClubId: "club-b", clubPoints: 100n }),
  finish("f", { representedClubId: "club-b", gender: "F", classificationIds: ["short-female"], finishTimeMs: 1150n, clubPoints: 90n }),
  finish("g", { representedClubId: "club-c", clubPoints: 110n }),
  finish("h", { ...long, representedClubId: null, gender: "F", classificationIds: ["long-female"], finishTimeMs: 750n }),
];
const recordDivisions = () => ["short", "long"].flatMap((raceId) => ["M", "F"].map((gender) => ({ id: `${raceId}-${gender}`, raceId, gender, baseline: null })));
const round = (changes = {}) => ({
  programmeId: "programme-1", roundId: "round-1", raceStartsAtMs: 2000n, budgetWei: 120000n,
  finishes: sources(), records: recordDivisions(), podiums: [
    { classificationId: "short-adult-male", approvalId: "review-short", entries: [{ sourceId: "a", rank: 1 }, { sourceId: "e", rank: 2 }, { sourceId: "g", rank: 3 }] },
    { classificationId: "long-female", approvalId: "review-long", entries: [{ sourceId: "h", rank: 1 }, { sourceId: "b", rank: 2 }] },
  ], ...changes,
});
const league = (changes = {}) => ({ programmeId: "programme-1", scopeId: "rounds-1-5", roundIds: ["round-1"], budgetWei: 40000n, finishes: sources(), ...changes });
const fails = (code, run) => assert.throws(run, (error) => error instanceof RewardCalculationError && error.code === code);
const sum = (rows, property) => rows.reduce((n, row) => n + row[property], 0n);

test("reward units parse exactly without float conversion or silent precision loss", () => {
  assert.equal(parseRewardUnits("5.98", 3), 5980n);
  assert.equal(parseRewardUnits("15.450000", 3), 15450n);
  assert.equal(parseRewardUnits("0.000000000000000001", 18), 1n);
  assert.equal(parseRewardUnits("42.00", 0), 42n);
  for (const value of ["-1", "1e3", "1,000", "01", " 1", "NaN", 1, "1."]) fails("invalid_decimal_amount", () => parseRewardUnits(value, 3));
  fails("unsupported_decimal_precision", () => parseRewardUnits("5.9801", 3));
  fails("invalid_unsigned_amount", () => parseRewardUnits((MAX_REWARD_UINT256 + 1n).toString(), 0));
});

test("100-MON programme locks 48 historical, 12 Zlarin, 30 metres and 10 clubs", () => {
  const unit = 10n ** 18n;
  const result = splitRewardProgramme(100n * unit, ["r1", "r2", "r3", "r4", "r5"]);
  assert.equal(result.raceBudget, 60n * unit);
  assert.equal(result.leagueBudget, 40n * unit);
  assert.deepEqual(result.rounds.map((row) => row.amount), Array(5).fill(12n * unit));
  assert.deepEqual(result.leagueFamilies.map((row) => row.amount), [30n * unit, 10n * unit]);
  assert.deepEqual(splitRaceRewardBudget(12n * unit).map((row) => row.amount), [2n * unit, 8n * unit, 2n * unit]);
  fails("programme_requires_five_rounds", () => splitRewardProgramme(1n, ["r1"]));
  fails("duplicate_weight_key", () => splitRewardProgramme(100n, ["r1", "r1", "r3", "r4", "r5"]));
});

test("largest remainders are stable, conserve wei and never reward zero weights", () => {
  const input = [{ key: "c", weight: 1n }, { key: "b", weight: 1n }, { key: "a", weight: 1n }, { key: "zero", weight: 0n }];
  const result = allocateRewardWeights(2n, input);
  assert.deepEqual(result.allocations.map((row) => row.amount), [1n, 1n, 0n, 0n]);
  assert.deepEqual(result, allocateRewardWeights(2n, [...input].reverse()));
  assert.equal(allocateRewardWeights(9n, [{ key: "zero", weight: 0n }]).unallocated, 9n);
  fails("duplicate_weight_key", () => allocateRewardWeights(1n, [input[0], input[0]]));
  fails("invalid_reward_weight", () => allocateRewardWeights(1n, [{ key: "a", weight: -1n }]));
  fails("invalid_unsigned_amount", () => allocateRewardWeights(1, input));
});

test("deterministic property cases conserve every nested programme budget", () => {
  let seed = 173;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 500; i++) {
    const budget = i === 0 ? MAX_REWARD_UINT256 : BigInt(next()) * BigInt(next());
    const weights = Array.from({ length: next() % 20 + 1 }, (_, index) => ({ key: `key-${index}`, weight: BigInt(next() % 100) }));
    const allocation = allocateRewardWeights(budget, weights);
    assert.equal(sum(allocation.allocations, "amount") + allocation.unallocated, budget);
    assert.deepEqual(allocation, allocateRewardWeights(budget, [...weights].reverse()));
    const programme = splitRewardProgramme(budget, ["r1", "r2", "r3", "r4", "r5"]);
    assert.equal(sum(programme.rounds, "amount") + programme.leagueBudget, budget);
    for (const item of programme.rounds) assert.equal(sum(splitRaceRewardBudget(item.amount), "amount"), item.amount);
  }
});

test("podium ties combine occupied slots and missing places remain unallocated", () => {
  assert.deepEqual(allocateRewardPodium(100n, [{ key: "a", rank: 1 }, { key: "b", rank: 1 }, { key: "c", rank: 3 }]).allocations.map((row) => row.amount), [40n, 40n, 20n]);
  assert.deepEqual(allocateRewardPodium(100n, [{ key: "a", rank: 1 }, { key: "b", rank: 2 }, { key: "c", rank: 3 }, { key: "d", rank: 3 }]).allocations.map((row) => row.amount), [50n, 30n, 10n, 10n]);
  assert.equal(allocateRewardPodium(100n, [{ key: "a", rank: 1 }]).unallocated, 50n);
  assert.equal(allocateRewardPodium(100n, []).unallocated, 100n);
  assert.deepEqual(allocateRewardPodium(100n, ["d", "c", "b", "a"].map((key) => ({ key, rank: 1 }))).allocations.map((row) => row.amount), [25n, 25n, 25n, 25n]);
});

test("invalid/dense ranks and duplicate beneficiaries require explicit sporting review", () => {
  for (const ranks of [[1, 1, 2], [2], [1, 3], [0], [1.5]]) {
    assert.throws(() => allocateRewardPodium(100n, ranks.map((rank, i) => ({ key: `a${i}`, rank }))), RewardCalculationError);
  }
  fails("duplicate_podium_beneficiary", () => allocateRewardPodium(100n, [{ key: "a", rank: 1 }, { key: "a", rank: 2 }]));
  fails("invalid_ranking_score", () => rankRewardScores([{ key: "a", score: -1n }]));
});

test("eligibility excludes ordinary DNS/DNF/DSQ and rejects contradictory or provisional finishes", () => {
  const rows = [finish("winner"), ...["dns", "dnf", "dsq"].map((status) => finish(status, { participationStatus: status, finishTimeMs: null }))];
  assert.deepEqual(selectRewardFinishes(rows).finishes.map((row) => row.sourceId), ["winner"]);
  assert.equal(selectRewardFinishes(rows).excludedSourceIds.length, 3);
  fails("contradictory_finish_state", () => selectRewardFinishes([finish("x", { participationStatus: "dnf" })]));
  fails("contradictory_finish_state", () => selectRewardFinishes([finish("x", { finishTimeMs: 0n })]));
  fails("finish_requires_official_publication", () => selectRewardFinishes([finish("x", { resultStatus: "provisional" })]));
  fails("finished_course_has_no_distance", () => selectRewardFinishes([finish("x", { distanceMetres: 0n })]));
});

test("duplicate athlete-round blocks until a current approved source selection exists", () => {
  const rows = [finish("short-row", { athleteId: "same-person" }), finish("long-row", { ...long, athleteId: "same-person" })];
  fails("duplicate_athlete_round_requires_review", () => selectRewardFinishes(rows));
  const decision = { roundId: "round-1", athleteId: "same-person", sourceIds: ["short-row", "long-row"], selectedSourceId: "short-row", approvalId: "review-1" };
  assert.deepEqual(selectRewardFinishes(rows, [decision]).finishes.map((row) => row.sourceId), ["short-row"]);
  assert.deepEqual(selectRewardFinishes(rows, [{ ...decision, selectedSourceId: null }]).finishes, []);
  fails("stale_adjudication_sources", () => selectRewardFinishes(rows, [{ ...decision, sourceIds: ["short-row"] }]));
  fails("invalid_adjudicated_source", () => selectRewardFinishes(rows, [{ ...decision, selectedSourceId: "missing-row" }]));
  fails("duplicate_result_source", () => selectRewardFinishes([rows[0], rows[0]]));
});

test("round calculation retains unused records/places and scores club best three across courses", () => {
  const result = calculateRoundRewards(round());
  assert.equal(result.unallocatedWei, 28000n);
  assert.equal(sum(result.awards, "amountWei"), 92000n);
  const clubs = result.awards.filter((row) => row.family === "club_performance");
  assert.deepEqual(clubs.map((row) => [row.beneficiaryId, row.amountWei]), [["club-a", 10000n], ["club-b", 6000n], ["club-c", 4000n]]);
  assert.deepEqual(clubs[0].sourceIds, ["b", "c", "d"]);
  assert.equal(result.explanations.filter((row) => row.reason === "no_verified_baseline").length, 4);
  const other = round();
  other.finishes.reverse(); other.podiums.reverse(); other.records.reverse();
  other.podiums.forEach((manifest) => manifest.entries.reverse());
  assert.deepEqual(calculateRoundRewards(other), result);
});

test("podium input requires classification membership and nonempty approval references", () => {
  // Resolving a reference to an actual authorized approval is a repository/service responsibility.
  const missing = round(); missing.podiums[0].approvalId = "";
  fails("invalid_reward_key", () => calculateRoundRewards(missing));
  const wrong = round(); wrong.podiums[0].entries[0].sourceId = "b";
  fails("podium_source_or_membership_invalid", () => calculateRoundRewards(wrong));
  fails("official_classifications_required", () => calculateRoundRewards(round({ podiums: [] })));
  fails("foreign_round_source", () => calculateRoundRewards(round({ finishes: [finish("x", { roundId: "other" })] })));
});

test("records reward only the fastest strict improvement against a prior comparable baseline", () => {
  const input = round();
  input.records.find((row) => row.id === "long-F").baseline = {
    approvalId: "record-review", publicationId: "older-publication", establishedAtMs: 1000n,
    finishTimeMs: 1000n, courseComparisonKey: "long-course-v1",
  };
  let result = calculateRoundRewards(input);
  assert.deepEqual(result.awards.filter((row) => row.family === "record").map((row) => [row.beneficiaryId, row.amountWei]), [["h", 5000n]]);
  input.finishes.find((row) => row.sourceId === "b").finishTimeMs = 750n;
  result = calculateRoundRewards(input);
  assert.deepEqual(result.awards.filter((row) => row.family === "record").map((row) => row.amountWei), [2500n, 2500n]);
  input.records.find((row) => row.id === "long-F").baseline.finishTimeMs = 750n;
  assert.equal(calculateRoundRewards(input).awards.filter((row) => row.family === "record").length, 0);
  input.records.find((row) => row.id === "long-F").baseline.courseComparisonKey = "different-course";
  assert.equal(calculateRoundRewards(input).explanations.find((row) => row.scopeId === "long-F").reason, "course_not_comparable");
  input.records.find((row) => row.id === "long-F").baseline.establishedAtMs = 2000n;
  fails("record_baseline_must_precede_race", () => calculateRoundRewards(input));
});

test("club performance needs published points and preserves ties without excluding small clubs", () => {
  const input = round(); input.finishes.find((row) => row.sourceId === "a").clubPoints = null;
  fails("club_performance_points_missing", () => calculateRoundRewards(input));
  input.finishes = sources();
  input.finishes.find((row) => row.sourceId === "g").clubPoints = 240n;
  const clubs = calculateRoundRewards(input).awards.filter((row) => row.family === "club_performance");
  assert.deepEqual(clubs.map((row) => [row.beneficiaryId, row.amountWei]), [["club-a", 8000n], ["club-b", 4000n], ["club-c", 8000n]]);
});

test("league awards use official metres and all represented finishes, not top-three scorers", () => {
  const result = calculateLeagueRewards(league());
  assert.equal(sum(result.awards.filter((row) => row.family === "athlete_metres"), "amountWei"), 30000n);
  assert.equal(result.awards.find((row) => row.beneficiaryId === "a").amountWei, 2400n);
  assert.equal(result.awards.find((row) => row.beneficiaryId === "h").amountWei, 6000n);
  const club = result.awards.find((row) => row.beneficiaryId === "club-a");
  assert.equal(club.amountWei, 5714n);
  assert.deepEqual(club.sourceIds, ["a", "b", "c", "d"]);
  assert.deepEqual(club.calculation, { method: "proportional", familyBudgetWei: 10000n, weight: 4n, totalWeight: 7n });
  assert.equal(result.unallocatedWei, 0n);
  assert.deepEqual(result, calculateLeagueRewards(league({ finishes: sources().reverse() })));
});

test("readiness is a payout hold only; no wallets/accounts are required by the allocation engine", () => {
  assert.deepEqual(rewardPayoutHolds({ kind: "athlete", ownershipVerified: false, walletVerified: false, ageStatus: "minor" }), ["profile_claim_required", "wallet_required", "minor_payout_hold"]);
  assert.deepEqual(rewardPayoutHolds({ kind: "club", ownershipVerified: false, walletVerified: false }), ["club_owner_required", "club_treasury_required"]);
  assert.deepEqual(rewardPayoutHolds({ kind: "athlete", ownershipVerified: true, walletVerified: true }), ["age_verification_required"]);
  assert.deepEqual(rewardPayoutHolds({ kind: "athlete", ownershipVerified: true, walletVerified: true, ageStatus: "adult_verified" }), []);
  assert.equal(calculateLeagueRewards(league()).awards.filter((row) => row.beneficiaryKind === "athlete").length, 8);
});

test("unaffiliated or empty populations retain the appropriate unallocated budget", () => {
  const result = calculateLeagueRewards(league({ finishes: sources().map((row) => ({ ...row, representedClubId: null })) }));
  assert.equal(result.unallocatedWei, 10000n);
  assert.equal(sum(result.awards, "amountWei"), 30000n);
  assert.equal(calculateLeagueRewards(league({ finishes: [] })).unallocatedWei, 40000n);
  assert.deepEqual(calculateLeagueRewards(league({ budgetWei: 0n })).awards, []);
});

test("consumption survives corrected row IDs and blocks repeated round/league settlement", () => {
  const raceResult = calculateRoundRewards(round());
  fails("reward_contribution_already_consumed", () => calculateRoundRewards(round({ consumedKeys: new Set(raceResult.contributionKeys) })));
  const result = calculateLeagueRewards(league());
  const corrected = sources().map((row) => ({ ...row, sourceId: `${row.sourceId}-corrected`, publicationId: "corrected-publication", resultStatus: "corrected" }));
  fails("reward_contribution_already_consumed", () => calculateLeagueRewards(league({ finishes: corrected, consumedKeys: new Set(result.contributionKeys) })));
  // Race prizes and league participation intentionally reward different rule families.
  assert.deepEqual(calculateLeagueRewards(league({ consumedKeys: new Set(raceResult.contributionKeys) })), result);
  fails("foreign_round_source", () => calculateLeagueRewards(league({ roundIds: ["round-2"] })));
});

test("entitlement aggregation preserves campaign/pot boundaries and per-rule explanations", () => {
  const result = calculateRoundRewards(round());
  const entitlements = aggregateRewardEntitlements(result);
  assert.equal(sum(entitlements, "amountWei") + result.unallocatedWei, result.budgetWei);
  assert(entitlements.every((row) => row.pot === "race" && row.campaignScopeId === "round-1"));
  const bad = structuredClone(result);
  bad.awards[0].family = "athlete_metres";
  fails("mixed_reward_pots", () => aggregateRewardEntitlements(bad));
  const duplicated = structuredClone(result);
  duplicated.budgetWei += duplicated.awards[0].amountWei;
  duplicated.awards.push(structuredClone(duplicated.awards[0]));
  fails("duplicate_award_breakdown", () => aggregateRewardEntitlements(duplicated));
});

test("calculator and aggregation leave frozen input evidence unchanged and return independent breakdowns", () => {
  const freeze = (value) => {
    if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  const input = freeze(round());
  const result = freeze(calculateRoundRewards(input));
  const before = structuredClone(result);
  const entitlements = aggregateRewardEntitlements(result);
  const podium = entitlements.flatMap((row) => row.breakdown).find((row) => row.family === "podium");
  podium.sourceIds.push("external-mutation");
  podium.calculation.prizeSlots.push(99);
  assert.deepEqual(result, before);
  const invalid = structuredClone(result);
  invalid.awards.push({ ...structuredClone(invalid.awards[0]), amountWei: -1n });
  fails("invalid_unsigned_amount", () => aggregateRewardEntitlements(invalid));
});

test("five-round epoch combines returning athletes and preserves historical campaign independence", () => {
  const roundIds = ["round-1", "round-2", "round-3", "round-4", "round-5"];
  const finishes = roundIds.flatMap((roundId, index) => [
    finish(`a-${index}`, { roundId, athleteId: "a", representedClubId: "club-a" }),
    ...(index < 4 ? [finish(`b-${index}`, { roundId, athleteId: "b", representedClubId: "club-b", distanceMetres: 9000n })] : []),
  ]);
  const result = calculateLeagueRewards(league({ roundIds, finishes }));
  assert.deepEqual(result.awards.map((row) => [row.beneficiaryId, row.amountWei]), [["a", 13636n], ["b", 16364n], ["club-a", 5556n], ["club-b", 4444n]]);
  assert.equal(result.contributionKeys.length, 18);
  assert.deepEqual(result.awards[0].calculation, { method: "proportional", familyBudgetWei: 30000n, weight: 30000n, totalWeight: 66000n });
  assert.deepEqual(result, calculateLeagueRewards(league({ roundIds: [...roundIds].reverse(), finishes: [...finishes].reverse() })));
  const historical = roundIds.slice(0, 4).map((roundId) => calculateRoundRewards(round({
    roundId, finishes: finishes.filter((row) => row.roundId === roundId), podiums: [{
      classificationId: "short-adult-male", approvalId: `review-${roundId}`,
      entries: finishes.filter((row) => row.roundId === roundId).map((row, index) => ({ sourceId: row.sourceId, rank: index + 1 })),
    }],
  })));
  const raceKeys = new Set(historical.flatMap((row) => row.contributionKeys));
  assert.deepEqual(result, calculateLeagueRewards(league({ roundIds, finishes, consumedKeys: raceKeys })));
  assert.equal(new Set(historical.map((row) => row.campaignScopeId)).size, 4);
  assert.equal(historical.reduce((total, row) => total + row.budgetWei, 0n), 480000n);
});
