import { allocateRewardWeights, compareRewardKeys, requireReward, requireRewardKey, requireUnsigned, splitRaceRewardBudget } from "./arithmetic.js";
import { selectRewardFinishes, type RewardAdjudication, type RewardFinish } from "./eligibility.js";
import { allocateRewardPodium, rankRewardScores } from "./ranking.js";

export type RewardFamily = "podium" | "record" | "club_performance" | "athlete_metres" | "club_finishes";
export type RewardCalculationDetail =
  | { method: "podium"; divisionBudgetWei: bigint; rank: number; tieSize: number; sharedPrizeWei: bigint; prizeSlots: number[]; clubScore?: bigint }
  | { method: "record"; divisionBudgetWei: bigint; baselineTimeMs: bigint; finishTimeMs: bigint; tiedHolders: number }
  | { method: "proportional"; familyBudgetWei: bigint; weight: bigint; totalWeight: bigint };
export type RewardAward = {
  beneficiaryKind: "athlete" | "club";
  beneficiaryId: string;
  family: RewardFamily;
  scopeId: string;
  amountWei: bigint;
  sourceIds: string[];
  evidenceIds: string[];
  calculation: RewardCalculationDetail;
};
export type RewardAllocationResult = {
  programmeId: string;
  campaignScopeId: string;
  pot: "race" | "league";
  budgetWei: bigint;
  awards: RewardAward[];
  unallocatedWei: bigint;
  contributionKeys: string[];
  excludedSourceIds: string[];
  explanations: { family: RewardFamily; scopeId: string; reason: string; unallocatedWei: bigint }[];
};
export type RewardPodiumManifest = {
  classificationId: string;
  approvalId: string;
  entries: readonly { sourceId: string; rank: number }[];
};
export type RewardRecordDivision = {
  id: string;
  raceId: string;
  gender: "M" | "F";
  baseline: null | {
    approvalId: string;
    publicationId: string;
    establishedAtMs: bigint;
    finishTimeMs: bigint;
    courseComparisonKey: string;
  };
};

/** Stable programme/scope keys, not corrected result-row IDs or display names. */
export function rewardContributionKey(programmeId: string, family: RewardFamily, ...scope: string[]): string {
  for (const key of [programmeId, family, ...scope]) requireRewardKey(key);
  return JSON.stringify([programmeId, family, ...scope]);
}

function assertUnconsumed(keys: readonly string[], consumed?: ReadonlySet<string>): string[] {
  const unique = [...new Set(keys)].sort(compareRewardKeys);
  requireReward(!unique.some((key) => consumed?.has(key)), "reward_contribution_already_consumed");
  return unique;
}

function completeAllocation(result: RewardAllocationResult): RewardAllocationResult {
  requireUnsigned(result.budgetWei);
  result.awards.forEach((award) => requireUnsigned(award.amountWei));
  const awards = result.awards.filter(({ amountWei }) => amountWei > 0n).map((award) => ({
    ...award, sourceIds: [...award.sourceIds].sort(compareRewardKeys), evidenceIds: [...award.evidenceIds].sort(compareRewardKeys),
    calculation: award.calculation.method === "podium"
      ? { ...award.calculation, prizeSlots: [...award.calculation.prizeSlots] } : { ...award.calculation },
  })).sort((a, b) => compareRewardKeys(JSON.stringify([a.beneficiaryKind, a.beneficiaryId, a.family, a.scopeId]), JSON.stringify([b.beneficiaryKind, b.beneficiaryId, b.family, b.scopeId])));
  const explanations = result.explanations.map((item) => ({ ...item })).sort((a, b) =>
    compareRewardKeys(JSON.stringify([a.family, a.scopeId]), JSON.stringify([b.family, b.scopeId])));
  requireUnsigned(result.unallocatedWei);
  requireReward(awards.reduce((sum, award) => sum + award.amountWei, result.unallocatedWei) === result.budgetWei, "reward_budget_not_conserved");
  return { ...result, awards, explanations, contributionKeys: [...result.contributionKeys], excludedSourceIds: [...result.excludedSourceIds] };
}

export function calculateRoundRewards(input: {
  programmeId: string;
  roundId: string;
  /** Prefer per-race evidence; a missing start must never be fabricated. */
  raceStartsAtMs: bigint | null;
  raceStartTimes?: ReadonlyMap<string, bigint | null>;
  budgetWei: bigint;
  finishes: readonly RewardFinish[];
  adjudications?: readonly RewardAdjudication[];
  podiums: readonly RewardPodiumManifest[];
  records: readonly RewardRecordDivision[];
  consumedKeys?: ReadonlySet<string>;
}): RewardAllocationResult {
  requireRewardKey(input.programmeId);
  requireRewardKey(input.roundId);
  if (input.raceStartsAtMs !== null) requireUnsigned(input.raceStartsAtMs, "invalid_race_timestamp");
  if (input.raceStartTimes) for (const [raceId, startsAt] of input.raceStartTimes) {
    requireRewardKey(raceId);
    if (startsAt !== null) requireUnsigned(startsAt, "invalid_race_timestamp");
  }
  requireReward(input.finishes.every((row) => row.roundId === input.roundId), "foreign_round_source");
  const { finishes, excludedSourceIds } = selectRewardFinishes(input.finishes, input.adjudications);
  const bySource = new Map(finishes.map((row) => [row.sourceId, row]));
  const familyBudgets = new Map(splitRaceRewardBudget(input.budgetWei).map(({ key, amount }) => [key, amount]));
  requireReward(input.podiums.length > 0, "official_classifications_required");
  requireReward(input.records.length === 4, "four_record_divisions_required");
  const recordGroups = new Set(input.records.map((division) => JSON.stringify([division.raceId, division.gender])));
  const recordRaces = new Set(input.records.map(({ raceId }) => raceId));
  requireReward(recordGroups.size === 4 && recordRaces.size === 2, "invalid_record_divisions");
  requireReward(finishes.every(({ raceId }) => recordRaces.has(raceId)), "unmapped_race_source");
  const keys = [
    ...input.podiums.map(({ classificationId }) => rewardContributionKey(input.programmeId, "podium", input.roundId, classificationId)),
    ...input.records.map(({ raceId, gender }) => rewardContributionKey(input.programmeId, "record", input.roundId, raceId, gender)),
    rewardContributionKey(input.programmeId, "club_performance", input.roundId),
  ];
  const result: RewardAllocationResult = {
    programmeId: input.programmeId, campaignScopeId: input.roundId, pot: "race",
    budgetWei: input.budgetWei, awards: [], unallocatedWei: 0n,
    contributionKeys: assertUnconsumed(keys, input.consumedKeys), excludedSourceIds, explanations: [],
  };
  const explain = (family: RewardFamily, scopeId: string, reason: string, unallocatedWei: bigint) => {
    result.unallocatedWei += unallocatedWei;
    result.explanations.push({ family, scopeId, reason, unallocatedWei });
  };
  const podiumBudgets = allocateRewardWeights(familyBudgets.get("podium")!, input.podiums.map(({ classificationId }) => ({ key: classificationId, weight: 1n })));
  const podiumById = new Map(input.podiums.map((manifest) => [manifest.classificationId, manifest]));
  for (const { key, amount } of podiumBudgets.allocations) {
    const manifest = podiumById.get(key)!;
    requireRewardKey(manifest.approvalId);
    const sources = manifest.entries.map((entry) => {
      const row = bySource.get(entry.sourceId);
      requireReward(row && row.classificationIds.includes(key), "podium_source_or_membership_invalid");
      return { row, rank: entry.rank };
    });
    const allocation = allocateRewardPodium(amount, sources.map(({ row, rank }) => ({ key: row.athleteId, rank })));
    for (const award of allocation.allocations) {
      result.awards.push({ beneficiaryKind: "athlete", beneficiaryId: award.key, family: "podium", scopeId: key, amountWei: award.amount,
        sourceIds: sources.filter(({ row }) => row.athleteId === award.key).map(({ row }) => row.sourceId), evidenceIds: [manifest.approvalId],
        calculation: { method: "podium", divisionBudgetWei: amount, rank: award.rank, tieSize: award.tieSize,
          sharedPrizeWei: award.sharedPrizeWei, prizeSlots: award.prizeSlots } });
    }
    explain("podium", key, allocation.unallocated > 0n ? "unfilled_prize_slots" : "allocated", allocation.unallocated);
  }
  const recordBudgets = allocateRewardWeights(familyBudgets.get("record")!, input.records.map(({ id }) => ({ key: id, weight: 1n })));
  const recordById = new Map(input.records.map((division) => [division.id, division]));
  for (const { key, amount } of recordBudgets.allocations) {
    const division = recordById.get(key)!;
    requireRewardKey(division.raceId);
    requireReward(["M", "F"].includes(division.gender), "invalid_record_gender");
    const baseline = division.baseline;
    if (!baseline) { explain("record", key, "no_verified_baseline", amount); continue; }
    for (const id of [baseline.approvalId, baseline.publicationId, baseline.courseComparisonKey]) requireRewardKey(id);
    requireUnsigned(baseline.establishedAtMs, "invalid_record_timestamp");
    requireUnsigned(baseline.finishTimeMs, "invalid_record_time");
    requireReward(baseline.finishTimeMs > 0n, "invalid_record_time");
    // An explicitly missing per-race timestamp does not fall back to another race.
    const startsAt = input.raceStartTimes ? input.raceStartTimes.get(division.raceId) : input.raceStartsAtMs;
    requireReward(startsAt !== null && startsAt !== undefined, "record_requires_verified_race_start");
    requireReward(baseline.establishedAtMs < startsAt, "record_baseline_must_precede_race");
    requireReward(!finishes.some((row) => row.raceId === division.raceId && row.gender === "U"), "record_gender_requires_review");
    const candidates = finishes.filter((row) => row.raceId === division.raceId && row.gender === division.gender);
    if (!candidates.length) { explain("record", key, "no_finishers", amount); continue; }
    if (candidates.some((row) => row.courseComparisonKey !== baseline.courseComparisonKey)) {
      explain("record", key, "course_not_comparable", amount); continue;
    }
    const fastest = candidates.reduce((time, row) => row.finishTimeMs! < time ? row.finishTimeMs! : time, baseline.finishTimeMs);
    if (fastest >= baseline.finishTimeMs) { explain("record", key, "record_not_broken", amount); continue; }
    const holders = candidates.filter((row) => row.finishTimeMs === fastest);
    for (const award of allocateRewardWeights(amount, holders.map(({ athleteId }) => ({ key: athleteId, weight: 1n }))).allocations) {
      result.awards.push({ beneficiaryKind: "athlete", beneficiaryId: award.key, family: "record", scopeId: key, amountWei: award.amount,
        sourceIds: holders.filter((row) => row.athleteId === award.key).map((row) => row.sourceId), evidenceIds: [baseline.approvalId, baseline.publicationId],
        calculation: { method: "record", divisionBudgetWei: amount, baselineTimeMs: baseline.finishTimeMs, finishTimeMs: fastest, tiedHolders: holders.length } });
    }
    explain("record", key, "record_broken", 0n);
  }
  const clubs = new Map<string, RewardFinish[]>();
  for (const row of finishes) {
    if (row.representedClubId === null) continue;
    requireReward(row.clubPoints !== null, "club_performance_points_missing");
    clubs.set(row.representedClubId, [...(clubs.get(row.representedClubId) ?? []), row]);
  }
  const scores = [...clubs].map(([key, rows]) => {
    const contributors = [...rows].sort((a, b) => a.clubPoints === b.clubPoints
      ? compareRewardKeys(a.sourceId, b.sourceId) : a.clubPoints! > b.clubPoints! ? -1 : 1).slice(0, 3);
    return { key, score: contributors.reduce((sum, row) => sum + row.clubPoints!, 0n), sourceIds: contributors.map((row) => row.sourceId) };
  });
  const clubAllocation = allocateRewardPodium(familyBudgets.get("club_performance")!, rankRewardScores(scores));
  for (const award of clubAllocation.allocations) {
    const score = scores.find((item) => item.key === award.key)!;
    result.awards.push({ beneficiaryKind: "club", beneficiaryId: award.key, family: "club_performance", scopeId: input.roundId, amountWei: award.amount,
      sourceIds: score.sourceIds, evidenceIds: [], calculation: { method: "podium", divisionBudgetWei: familyBudgets.get("club_performance")!,
        rank: award.rank, tieSize: award.tieSize, sharedPrizeWei: award.sharedPrizeWei, prizeSlots: award.prizeSlots, clubScore: score.score } });
  }
  explain("club_performance", input.roundId, clubAllocation.unallocated > 0n ? "unfilled_prize_slots" : "allocated", clubAllocation.unallocated);
  return completeAllocation(result);
}

export function calculateLeagueRewards(input: {
  programmeId: string;
  scopeId: string;
  roundIds: readonly string[];
  budgetWei: bigint;
  finishes: readonly RewardFinish[];
  adjudications?: readonly RewardAdjudication[];
  consumedKeys?: ReadonlySet<string>;
}): RewardAllocationResult {
  requireRewardKey(input.programmeId);
  requireRewardKey(input.scopeId);
  requireReward(input.roundIds.length > 0 && new Set(input.roundIds).size === input.roundIds.length, "invalid_league_round_scope");
  input.roundIds.forEach(requireRewardKey);
  requireReward(input.finishes.every((row) => input.roundIds.includes(row.roundId)), "foreign_round_source");
  const { finishes, excludedSourceIds } = selectRewardFinishes(input.finishes, input.adjudications);
  const budgets = allocateRewardWeights(input.budgetWei, [{ key: "athlete_metres", weight: 3n }, { key: "club_finishes", weight: 1n }]).allocations;
  const keys = finishes.flatMap((row) => [
    rewardContributionKey(input.programmeId, "athlete_metres", row.roundId, row.athleteId),
    ...(row.representedClubId ? [rewardContributionKey(input.programmeId, "club_finishes", row.roundId, row.athleteId)] : []),
  ]);
  const result: RewardAllocationResult = { programmeId: input.programmeId, campaignScopeId: input.scopeId, pot: "league",
    budgetWei: input.budgetWei, awards: [], unallocatedWei: 0n,
    contributionKeys: assertUnconsumed(keys, input.consumedKeys), excludedSourceIds, explanations: [] };
  for (const { key: family, amount: budget } of budgets) {
    const groups = new Map<string, { weight: bigint; sourceIds: string[] }>();
    for (const row of finishes) {
      const key = family === "athlete_metres" ? row.athleteId : row.representedClubId;
      if (!key) continue;
      const group = groups.get(key) ?? { weight: 0n, sourceIds: [] };
      group.weight += family === "athlete_metres" ? row.distanceMetres : 1n;
      group.sourceIds.push(row.sourceId);
      groups.set(key, group);
    }
    const allocation = allocateRewardWeights(budget, [...groups].map(([key, { weight }]) => ({ key, weight })));
    const totalWeight = [...groups.values()].reduce((sum, { weight }) => sum + weight, 0n);
    for (const award of allocation.allocations) {
      result.awards.push({ beneficiaryKind: family === "athlete_metres" ? "athlete" : "club", beneficiaryId: award.key,
        family: family as RewardFamily, scopeId: input.scopeId, amountWei: award.amount, sourceIds: groups.get(award.key)!.sourceIds, evidenceIds: [],
        calculation: { method: "proportional", familyBudgetWei: budget, weight: groups.get(award.key)!.weight, totalWeight } });
    }
    result.unallocatedWei += allocation.unallocated;
    result.explanations.push({ family: family as RewardFamily, scopeId: input.scopeId, reason: groups.size ? "allocated" : "no_eligible_contributions", unallocatedWei: allocation.unallocated });
  }
  return completeAllocation(result);
}

/** Accept a single calculation result, never combine unrelated campaign/pot arrays. */
export function aggregateRewardEntitlements(result: RewardAllocationResult) {
  const completed = completeAllocation(result);
  const groups = new Map<string, { beneficiaryKind: "athlete" | "club"; beneficiaryId: string; amountWei: bigint; breakdown: RewardAward[] }>();
  const seen = new Set<string>();
  for (const award of completed.awards) {
    requireUnsigned(award.amountWei);
    requireRewardKey(award.beneficiaryId);
    requireReward((result.pot === "race" ? ["podium", "record", "club_performance"] : ["athlete_metres", "club_finishes"]).includes(award.family), "mixed_reward_pots");
    const awardKey = JSON.stringify([award.beneficiaryKind, award.beneficiaryId, award.family, award.scopeId]);
    requireReward(!seen.has(awardKey), "duplicate_award_breakdown");
    seen.add(awardKey);
    const key = JSON.stringify([award.beneficiaryKind, award.beneficiaryId]);
    const group = groups.get(key) ?? { beneficiaryKind: award.beneficiaryKind, beneficiaryId: award.beneficiaryId, amountWei: 0n, breakdown: [] };
    group.amountWei += award.amountWei;
    requireUnsigned(group.amountWei);
    group.breakdown.push(award);
    groups.set(key, group);
  }
  return [...groups].sort(([a], [b]) => compareRewardKeys(a, b)).map(([, group]) => ({
    programmeId: result.programmeId, campaignScopeId: result.campaignScopeId, pot: result.pot, ...group,
  }));
}
