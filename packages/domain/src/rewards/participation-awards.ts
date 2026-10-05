import { allocateRewardWeights, compareRewardKeys } from "./arithmetic.js";
import { previewPublishedPrizeSlots } from "./published-preview-v2.js";
import type { LeagueParticipationMetrics, ParticipationContribution, ParticipationMetric } from "./league-participation-metrics.js";

/** Proposed review decisions. The pure calculator does not authenticate a reviewer
 * or persist/approve these decisions. Server storage must bind their exact source. */
export type ParticipationReview = {
  version: 1; sourceHash: string;
  duplicates: Array<{ round: number; athleteId: string; resultIds: string[]; keepResultId: string | null; reason: string }>;
  confirmedUnaffiliatedResultIds: string[];
};
export type ParticipationRewardRule = {
  metric: ParticipationMetric; method: "proportional" | "ranked";
  minimumFinishes: number; prizeSharesBps: number[];
};
const invalid = () => { throw new Error("invalid_reward_participation_review"); };
const check = (value: unknown) => { if (!value) invalid(); };
const sorted = (ids: string[]) => [...ids].sort(compareRewardKeys);
const sameIds = (a: string[], b: string[]) => sorted(a).join() === sorted(b).join();

/** A transparent, source-bound estimate. Historical progress never becomes an
 * executable allocation through this function, even after every issue is reviewed.
 * Integer units and the existing occupied-slot tie rule are reused. */
export function previewParticipationReward(
  source: Pick<LeagueParticipationMetrics, "version" | "state" | "sourceHash" | "availableRounds" | "plannedRounds" | "contributions" | "issues"> & {summary: Pick<LeagueParticipationMetrics["summary"], "resultRows">}, review: ParticipationReview,
  rule: ParticipationRewardRule, budgetWei: bigint,
) {
  check(source.version === 1 && source.state === "historical_progress" && review.version === 1 &&
    /^[0-9a-f]{64}$/.test(review.sourceHash) && review.sourceHash === source.sourceHash);
  check(["athlete_finishes", "athlete_metres", "club_metres"].includes(rule.metric));
  check(rule.method === "proportional" || rule.method === "ranked");
  check(Number.isInteger(rule.minimumFinishes) && rule.minimumFinishes >= 1 && rule.minimumFinishes <= 5);
  check(typeof budgetWei === "bigint" && budgetWei >= 0n && budgetWei <= 1000000n * 10n ** 18n);
  check(Array.isArray(rule.prizeSharesBps));
  check(rule.method === "proportional" ? rule.prizeSharesBps.length === 0 :
    rule.prizeSharesBps.length > 0 && rule.prizeSharesBps.length <= 100 &&
    rule.prizeSharesBps.every(n => Number.isInteger(n) && n >= 0 && n <= 10000) &&
    rule.prizeSharesBps.reduce((n, share) => n + share, 0) === 10000);
  check(Array.isArray(review.duplicates) && review.duplicates.length <= source.summary.resultRows);
  check(Array.isArray(review.confirmedUnaffiliatedResultIds) &&
    new Set(review.confirmedUnaffiliatedResultIds).size === review.confirmedUnaffiliatedResultIds.length);
  const duplicateIssues = source.issues.filter(i => i.code === "duplicate_athlete_round");
  const decisions = new Map<string, ParticipationReview["duplicates"][number]>();
  const discardedIds = new Set<string>();
  for (const decision of review.duplicates) {
    const key = `${decision.round}:${decision.athleteId}`;
    const issue = duplicateIssues.find(i => i.round === decision.round && i.athleteId === decision.athleteId);
    check(issue && !decisions.has(key) && typeof decision.reason === "string" &&
      decision.reason.trim().length > 0 && decision.reason.length <= 500 && !/[\u0000-\u001f\u007f]/.test(decision.reason));
    check(Array.isArray(decision.resultIds) && new Set(decision.resultIds).size === decision.resultIds.length &&
      sameIds(decision.resultIds, issue!.resultIds));
    check(decision.keepResultId === null || decision.resultIds.includes(decision.keepResultId));
    decisions.set(key, decision);
    decision.resultIds.filter(id => id !== decision.keepResultId).forEach(id => discardedIds.add(id));
  }
  const unaffiliated = new Set(review.confirmedUnaffiliatedResultIds);
  for (const resultId of unaffiliated) check(source.contributions.some(c => c.resultId === resultId && c.clubId === null));
  const unresolved = source.issues.filter(issue => {
    if (!issue.affects.includes(rule.metric)) return false;
    if (issue.code === "duplicate_athlete_round") return !decisions.has(`${issue.round}:${issue.athleteId}`);
    if (issue.resultIds.every(id => discardedIds.has(id))) return false;
    if (issue.code === "unattributed_club") return !issue.resultIds.every(id => unaffiliated.has(id));
    return true;
  });
  const included = source.contributions.filter(row => !discardedIds.has(row.resultId));
  // The minimum is athlete participation eligibility, including for club
  // contributors. It never becomes a minimum number of club members.
  const finishedRounds = new Map<string, Set<number>>();
  for (const row of included) {
    const rounds = finishedRounds.get(row.athleteId) ?? new Set<number>();
    rounds.add(row.round); finishedRounds.set(row.athleteId, rounds);
  }
  const eligible = included.filter(row => finishedRounds.get(row.athleteId)!.size >= rule.minimumFinishes);
  const groups = new Map<string, ParticipationContribution[]>();
  for (const row of eligible) {
    const id = rule.metric === "club_metres" ? row.clubId : row.athleteId;
    if (id === null) continue;
    const items = groups.get(id) ?? []; items.push(row); groups.set(id, items);
  }
  const candidates = [...groups].map(([beneficiaryId, rows]) => ({
    beneficiaryId, name: rule.metric === "club_metres" ? rows[0]!.clubName : rows[0]!.athleteName,
    value: rule.metric === "athlete_finishes" ? BigInt(new Set(rows.map(r => r.round)).size) :
      rows.reduce((n, r) => n + BigInt(r.metres ?? "0"), 0n),
    resultIds: sorted(rows.map(r => r.resultId)),
  })).filter(c => c.value > 0n).sort((a, b) => a.value === b.value ? compareRewardKeys(a.beneficiaryId, b.beneficiaryId) : a.value > b.value ? -1 : 1);
  const awards: Array<{ beneficiaryId: string; name: string | null; value: bigint; place: number | null; amountWei: bigint; resultIds: string[] }> = [];
  if (!unresolved.length) {
    if (rule.method === "proportional") {
      const split = allocateRewardWeights(budgetWei, candidates.map(c => ({ key: c.beneficiaryId, weight: c.value }))).allocations;
      const amounts = new Map(split.map(a => [a.key, a.amount]));
      for (const candidate of candidates) awards.push({ ...candidate, place: null, amountWei: amounts.get(candidate.beneficiaryId) ?? 0n });
    } else {
      const slots = allocateRewardWeights(budgetWei, rule.prizeSharesBps.map((weight, i) => ({ key: String(i).padStart(3, "0"), weight: BigInt(weight) }))).allocations;
      const candidateById = new Map(candidates.map(c => [c.beneficiaryId, c]));
      let rank = 0;
      const ranked = candidates.map((c, i) => {
        if (i === 0 || c.value !== candidates[i - 1]!.value) rank = i + 1;
        return { beneficiaryId: c.beneficiaryId, name: c.name, order: rank, evidenceIds: c.resultIds, evidenceValue: rank };
      });
      const result = previewPublishedPrizeSlots(slots.map((slot, i) => ({ rank: i + 1, amountWei: slot.amount })), ranked);
      for (const award of result.awards) if (award.amountWei > 0n) {
        awards.push({ ...candidateById.get(award.beneficiaryId)!, place: award.place, amountWei: award.amountWei });
      }
    }
  }
  const proposedWei = awards.reduce((n, a) => n + a.amountWei, 0n);
  return { version: 1 as const, state: "unapproved_progress_estimate" as const, payableWei: 0n,
    sourceHash: source.sourceHash, metric: rule.metric, method: rule.method,
    availableRounds: source.availableRounds, plannedRounds: source.plannedRounds,
    budgetWei, proposedWei, retainedWei: budgetWei - proposedWei,
    // With unresolved evidence, even a known subtotal must not be presented as
    // the final distribution denominator or used to pay unaffected-looking rows.
    totalWeight: unresolved.length ? null : candidates.reduce((n, c) => n + c.value, 0n),
    unresolved, excludedResultIds: sorted([...discardedIds]), awards };
}
