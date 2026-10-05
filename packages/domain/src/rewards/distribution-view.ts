import { parseRewardUnits } from "./arithmetic.js";
import { parseRewardSourceTimestamp } from "./source-evidence.js";

/** Shared server/browser whitelist for organizer-only sporting history. This is
 * not a public export or a funding, readiness, freshness or payment verdict. */
export class RewardDistributionDocumentError extends Error {
  readonly code = "invalid_reward_distribution_document";
  constructor() { super("invalid_reward_distribution_document"); }
}
function demand(value: unknown): asserts value { if (!value) throw new RewardDistributionDocumentError(); }
function object(value: unknown, keys: readonly string[]) {
  demand(value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const fields = Object.getOwnPropertyDescriptors(value);
  demand(!Object.getOwnPropertySymbols(value).length && Object.keys(fields).length === keys.length
    && keys.every(k => fields[k]?.enumerable && "value" in fields[k]));
  return value as Record<string, unknown>;
}
function array<T>(value: unknown, max: number, decode: (raw: unknown) => T): T[] {
  demand(Array.isArray(value) && value.length <= max);
  const fields = Object.getOwnPropertyDescriptors(value);
  demand(!Object.getOwnPropertySymbols(value).length && Object.keys(fields).length === value.length + 1);
  return Array.from({ length: value.length }, (_, i) => { demand(fields[i]?.enumerable && "value" in fields[i]); return decode(fields[i].value); });
}
export function rewardDistributionUuid(value: unknown): string {
  demand(typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    && value !== "00000000-0000-0000-0000-000000000000"); return value;
}
const uuid = rewardDistributionUuid;
function key(value: unknown): string { demand(typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value); return value; }
function label(value: unknown): string | null {
  if (value === null) return null;
  demand(typeof value === "string" && value.length > 0 && value.trim() === value && [...value].length <= 256); return value;
}
function count(value: unknown, min = 0, max = 20_000): number {
  demand(typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max); return value;
}
function amount(value: unknown, positive = false): string {
  demand(typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value));
  const n = parseRewardUnits(value, 0); demand(!positive || n > 0n); return value;
}
function timestamp(value: unknown): string { parseRewardSourceTimestamp(value); return value as string; }
export type RewardDistributionScope = { programmeId: string; chainId: 10143 | 31337 };
export type RewardAllocationScope = RewardDistributionScope & { campaignId: string; allocationId: string };
export type RewardAwardScope = RewardAllocationScope & { entitlementId: string };
function scope(body: Record<string, unknown>, expected: RewardDistributionScope | RewardAllocationScope | RewardAwardScope) {
  demand(expected.chainId === 10143 || expected.chainId === 31337);
  demand(body.chainId === expected.chainId && body.programmeId === uuid(expected.programmeId));
  if ("campaignId" in expected) demand(body.campaignId === uuid(expected.campaignId) && body.allocationId === uuid(expected.allocationId));
  if ("entitlementId" in expected) demand(body.entitlementId === uuid(expected.entitlementId));
}
function page<T>(items: T[], cursor: unknown, after: string | null, max: number, id: (item: T) => string) {
  let previous = after === null ? null : uuid(after);
  for (const item of items) { const next = id(item); demand(previous === null || next > previous); previous = next; }
  const nextCursor = cursor === null ? null : uuid(cursor);
  demand(nextCursor === null || (items.length === max && nextCursor === previous)); return nextCursor;
}
function beneficiary(body: Record<string, unknown>) {
  demand(body.beneficiaryKind === "athlete" || body.beneficiaryKind === "club");
  return { beneficiaryKind: body.beneficiaryKind, beneficiaryId: uuid(body.beneficiaryId),
    beneficiaryName: label(body.beneficiaryName), amountWei: amount(body.amountWei, true) };
}
const scopeKeys = ["programmeId", "chainId", "campaignId", "allocationId"];
const awardKeys = ["entitlementId", "beneficiaryKind", "beneficiaryId", "beneficiaryName", "amountWei"];
export function decodeRewardCampaigns(value: unknown, expected: RewardDistributionScope) {
  const d = object(value, ["programmeId", "chainId", "budgetWei", "items"]); scope(d, expected);
  const budgetWei = amount(d.budgetWei, true);
  const items = array(d.items, 6, raw => {
    const c = object(raw, ["campaignId", "pot", "scopeKey", "roundNumber", "raceName", "budgetWei", "allocation"]);
    demand(c.pot === "race" || c.pot === "league");
    const roundNumber = c.pot === "race" ? count(c.roundNumber, 1, 5) : null;
    if (c.pot === "league") demand(c.roundNumber === null && c.raceName === null && c.scopeKey === "rounds-1-5");
    const scopeKey = c.pot === "race" ? uuid(c.scopeKey) : "rounds-1-5", campaignBudget = amount(c.budgetWei, true);
    let allocation = null;
    if (c.allocation !== null) {
      const a = object(c.allocation, ["allocationId", "reservedAt", "allocatedWei", "unallocatedWei", "awardCount"]);
      const allocatedWei = amount(a.allocatedWei), unallocatedWei = amount(a.unallocatedWei), awardCount = count(a.awardCount, 0, 40_000);
      demand(BigInt(allocatedWei) + BigInt(unallocatedWei) === BigInt(campaignBudget) && (awardCount === 0) === (allocatedWei === "0"));
      allocation = { allocationId: uuid(a.allocationId), reservedAt: timestamp(a.reservedAt), allocatedWei, unallocatedWei, awardCount };
    }
    return { campaignId: uuid(c.campaignId), pot: c.pot, scopeKey, roundNumber, raceName: label(c.raceName), budgetWei: campaignBudget, allocation };
  });
  demand(items.length === 6 && items.every((c, i) => c.roundNumber === (i < 5 ? i + 1 : null))
    && new Set(items.map(c => c.campaignId)).size === 6 && new Set(items.map(c => c.scopeKey)).size === 6
    && items.reduce((sum, c) => sum + BigInt(c.budgetWei), 0n) === BigInt(budgetWei));
  return { programmeId: expected.programmeId, chainId: expected.chainId, budgetWei, items };
}
export function decodeRewardAwardPage(value: unknown, expected: RewardAllocationScope, after: string | null = null) {
  const d = object(value, [...scopeKeys, "items", "nextCursor"]); scope(d, expected);
  const items = array(d.items, 25, raw => { const a = object(raw, awardKeys); return { entitlementId: uuid(a.entitlementId), ...beneficiary(a) }; });
  return { ...expected, items, nextCursor: page(items, d.nextCursor, after, 25, item => item.entitlementId) };
}
const families = ["podium", "record", "club_performance", "athlete_metres", "club_finishes"] as const;
type Family = typeof families[number];
function family(value: unknown): Family { demand(families.some(f => f === value)); return value as Family; }
function calculation(raw: unknown, f: Family) {
  const method = Object.getOwnPropertyDescriptor(raw ?? {}, "method"); demand(method && "value" in method);
  if (method.value === "podium") {
    demand(f === "podium" || f === "club_performance");
    const d = object(raw, ["method", "divisionBudgetWei", "rank", "tieSize", "sharedPrizeWei", "prizeSlots", "clubScore"]);
    const prizeSlots = array(d.prizeSlots, 3, n => count(n, 1, 3));
    demand(prizeSlots.length > 0 && prizeSlots.every((n, i) => i === 0 || n > prizeSlots[i - 1]));
    const divisionBudgetWei = amount(d.divisionBudgetWei, true), sharedPrizeWei = amount(d.sharedPrizeWei, true);
    demand(BigInt(sharedPrizeWei) <= BigInt(divisionBudgetWei));
    const clubScore = d.clubScore === null ? null : amount(d.clubScore);
    demand((f === "podium") === (clubScore === null));
    return { method: "podium" as const, divisionBudgetWei, rank: count(d.rank, 1, 3), tieSize: count(d.tieSize, 1), sharedPrizeWei, prizeSlots, clubScore };
  }
  if (method.value === "record") {
    demand(f === "record"); const d = object(raw, ["method", "divisionBudgetWei", "baselineTimeMs", "finishTimeMs", "tiedHolders"]);
    const baselineTimeMs = amount(d.baselineTimeMs, true), finishTimeMs = amount(d.finishTimeMs, true);
    demand(BigInt(finishTimeMs) < BigInt(baselineTimeMs));
    return { method: "record" as const, divisionBudgetWei: amount(d.divisionBudgetWei, true), baselineTimeMs, finishTimeMs, tiedHolders: count(d.tiedHolders, 1) };
  }
  demand(method.value === "proportional" && (f === "athlete_metres" || f === "club_finishes"));
  const d = object(raw, ["method", "familyBudgetWei", "weight", "totalWeight"]);
  const weight = amount(d.weight, true), totalWeight = amount(d.totalWeight, true); demand(BigInt(weight) <= BigInt(totalWeight));
  return { method: "proportional" as const, familyBudgetWei: amount(d.familyBudgetWei, true), weight, totalWeight };
}
export function decodeRewardAwardDetail(value: unknown, expected: RewardAwardScope, after: string | null = null) {
  const d = object(value, [...scopeKeys, ...awardKeys, "reservedAt", "sourceSnapshotId", "breakdown", "sourceCount", "sources", "nextCursor"]); scope(d, expected);
  const earned = beneficiary(d), sourceCount = count(d.sourceCount, 1);
  const breakdown = array(d.breakdown, 32, raw => {
    const b = object(raw, ["family", "scopeId", "amountWei", "sourceCount", "scopeName", "calculation"]), f = family(b.family);
    demand((earned.beneficiaryKind === "club") === ["club_performance", "club_finishes"].includes(f));
    const calc = calculation(b.calculation, f), amountWei = amount(b.amountWei, true);
    demand(BigInt(amountWei) <= BigInt(calc.method === "podium" ? calc.sharedPrizeWei : calc.method === "record" ? calc.divisionBudgetWei : calc.familyBudgetWei));
    return { family: f, scopeId: key(b.scopeId), scopeName: label(b.scopeName), amountWei, sourceCount: count(b.sourceCount, 1, sourceCount), calculation: calc };
  });
  const breakdownKeys = breakdown.map(b => JSON.stringify([b.family, b.scopeId]));
  demand(breakdown.length > 0 && new Set(breakdownKeys).size === breakdown.length
    && breakdown.reduce((sum, b) => sum + BigInt(b.amountWei), 0n) === BigInt(earned.amountWei));
  const sources = array(d.sources, 50, raw => {
    const r = object(raw, ["sourceId", "roundId", "roundNumber", "raceId", "publicationId", "athleteId", "athleteName", "representedClubId",
      "finishTimeMs", "distanceMetres", "clubPointsHundredths", "contributions"]);
    const athleteId = uuid(r.athleteId), representedClubId = r.representedClubId === null ? null : uuid(r.representedClubId);
    demand((earned.beneficiaryKind === "athlete" ? athleteId : representedClubId) === earned.beneficiaryId);
    const contributions = array(r.contributions, 32, raw => {
      const c = object(raw, ["family", "scopeId"]), f = family(c.family), scopeId = key(c.scopeId);
      demand(breakdownKeys.includes(JSON.stringify([f, scopeId]))); return { family: f, scopeId };
    });
    demand(contributions.length > 0 && new Set(contributions.map(c => JSON.stringify(c))).size === contributions.length);
    return { sourceId: uuid(r.sourceId), roundId: uuid(r.roundId), roundNumber: count(r.roundNumber, 1, 5), raceId: uuid(r.raceId),
      publicationId: uuid(r.publicationId), athleteId, athleteName: label(r.athleteName), representedClubId,
      finishTimeMs: amount(r.finishTimeMs, true), distanceMetres: amount(r.distanceMetres, true),
      clubPointsHundredths: r.clubPointsHundredths === null ? null : amount(r.clubPointsHundredths), contributions };
  });
  demand(sources.length <= sourceCount && (after !== null || sources.length === Math.min(50, sourceCount)));
  const nextCursor = page(sources, d.nextCursor, after, 50, row => row.sourceId);
  demand(nextCursor === null || sourceCount > sources.length);
  if (after === null) demand((sourceCount > 50) === (nextCursor !== null));
  return { ...expected, ...earned, reservedAt: timestamp(d.reservedAt), sourceSnapshotId: uuid(d.sourceSnapshotId), breakdown, sourceCount, sources, nextCursor };
}
export type RewardDistributionCampaign = ReturnType<typeof decodeRewardCampaigns>["items"][number];
export type RewardDistributionAward = ReturnType<typeof decodeRewardAwardPage>["items"][number];
export type RewardDistributionDetail = ReturnType<typeof decodeRewardAwardDetail>;
