import { parseRewardUnits, splitRaceRewardBudget, allocateRewardWeights } from "./arithmetic.js";
import { parseRewardSourceTimestamp } from "./source-evidence.js";
import { rewardDistributionUuid as uuid, type RewardDistributionScope } from "./distribution-view.js";

export type RewardPreparationSelection = RewardDistributionScope & { campaignId: string };
export class RewardPreparationDocumentError extends Error {
  readonly code = "invalid_reward_preparation_document";
  constructor() { super("invalid_reward_preparation_document"); }
}
function demand(v: unknown): asserts v { if (!v) throw new RewardPreparationDocumentError(); }
function object(v: unknown, keys: readonly string[]) {
  demand(v !== null && typeof v === "object" && !Array.isArray(v) && [null, Object.prototype].includes(Object.getPrototypeOf(v)));
  const fields = Object.getOwnPropertyDescriptors(v);
  demand(!Object.getOwnPropertySymbols(v).length && Object.keys(fields).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]));
  return v as Record<string, unknown>;
}
function array<T>(v: unknown, max: number, decode: (v: unknown) => T): T[] {
  demand(Array.isArray(v) && v.length <= max); const fields = Object.getOwnPropertyDescriptors(v);
  demand(!Object.getOwnPropertySymbols(v).length && Object.keys(fields).length === v.length + 1);
  return Array.from({ length: v.length }, (_, i) => { demand(fields[i]?.enumerable && "value" in fields[i]); return decode(fields[i].value); });
}
function amount(v: unknown) { demand(typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v)); parseRewardUnits(v, 0); return v; }
function count(v: unknown, max = 20_000) { demand(typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max); return v; }
function timestamp(v: unknown) { parseRewardSourceTimestamp(v); return v as string; }
export function rewardPreviewCursor(v: unknown) {
  demand(typeof v === "string" && /^(athlete|club):/.test(v)); const [kind, id, extra] = v.split(":");
  demand(extra === undefined); uuid(id); return `${kind}:${id}`;
}
const scopeKeys = ["programmeId", "chainId", "campaignId"];
function scope(d: Record<string, unknown>, s: RewardPreparationSelection) {
  demand((s.chainId === 10143 || s.chainId === 31337) && d.chainId === s.chainId && d.programmeId === uuid(s.programmeId) && d.campaignId === uuid(s.campaignId));
}
export function rewardPreviewFamilies(pot: "race" | "league", budget: bigint) {
  return pot === "race" ? splitRaceRewardBudget(budget) : allocateRewardWeights(budget,
    [{ key: "athlete_metres", weight: 3n }, { key: "club_finishes", weight: 1n }]).allocations;
}
export function decodeRewardPreparation(v: unknown, expected: RewardPreparationSelection, after: string | null = null) {
  const d = object(v, [...scopeKeys, "budgetWei", "stage", "allocationId", "preview"]); scope(d, expected);
  const budgetWei = amount(d.budgetWei); demand(BigInt(budgetWei) > 0n);
  demand(d.stage === "awaiting_review" || d.stage === "reserved" || d.stage === "preview");
  const allocationId = d.allocationId === null ? null : uuid(d.allocationId);
  demand((d.stage === "reserved") === (allocationId !== null));
  if (d.stage !== "preview") {
    demand(d.preview === null && after === null);
    return { ...expected, budgetWei, stage: d.stage, allocationId, preview: null };
  }
  const p = object(d.preview, ["reviewId", "revision", "snapshotId", "reviewedAt", "capturedAt", "pot", "previewDigest", "allocatedWei", "unallocatedWei",
    "selectedFinishCount", "excludedFinishCount", "awardCount", "families", "items", "nextCursor"]);
  demand(p.pot === "race" || p.pot === "league");
  const allocatedWei = amount(p.allocatedWei), unallocatedWei = amount(p.unallocatedWei), awardCount = count(p.awardCount);
  demand(BigInt(allocatedWei) + BigInt(unallocatedWei) === BigInt(budgetWei) && (awardCount === 0) === (allocatedWei === "0"));
  const expectedFamilies = rewardPreviewFamilies(p.pot, BigInt(budgetWei));
  const families = array(p.families, 3, raw => {
    const f = object(raw, ["family", "budgetWei", "allocatedWei", "unallocatedWei"]);
    const expected = expectedFamilies.find(e => e.key === f.family); demand(expected);
    const budget = amount(f.budgetWei), allocated = amount(f.allocatedWei), unallocated = amount(f.unallocatedWei);
    demand(budget === expected.amount.toString() && BigInt(allocated) + BigInt(unallocated) === BigInt(budget));
    return { family: expected.key, budgetWei: budget, allocatedWei: allocated, unallocatedWei: unallocated };
  });
  demand(families.length === expectedFamilies.length && new Set(families.map(f => f.family)).size === families.length
    && families.reduce((s, f) => s + BigInt(f.allocatedWei), 0n) === BigInt(allocatedWei));
  const items = array(p.items, 25, raw => {
    const a = object(raw, ["key", "kind", "id", "name", "amountWei", "breakdown"]);
    demand(a.kind === "athlete" || a.kind === "club"); const id = uuid(a.id), key = rewardPreviewCursor(a.key);
    demand(key === `${a.kind}:${id}` && (a.name === null || (typeof a.name === "string" && a.name.length > 0 && a.name.trim() === a.name && [...a.name].length <= 256)));
    const awardAmount = amount(a.amountWei); demand(BigInt(awardAmount) > 0n);
    const breakdown = array(a.breakdown, 3, raw => {
      const b = object(raw, ["family", "amountWei"]); demand(families.some(f => f.family === b.family));
      demand((a.kind === "club") === ["club_performance", "club_finishes"].includes(b.family as string));
      return { family: b.family as string, amountWei: amount(b.amountWei) };
    });
    demand(new Set(breakdown.map(b => b.family)).size === breakdown.length && breakdown.length > 0
      && breakdown.reduce((s, b) => s + BigInt(b.amountWei), 0n) === BigInt(awardAmount));
    return { key, kind: a.kind, id, name: a.name as string | null, amountWei: awardAmount, breakdown };
  });
  let previous = after === null ? null : rewardPreviewCursor(after);
  for (const item of items) { demand(previous === null || item.key > previous); previous = item.key; }
  const nextCursor = p.nextCursor === null ? null : rewardPreviewCursor(p.nextCursor);
  demand(nextCursor === null || (items.length === 25 && nextCursor === previous));
  demand(items.length <= awardCount && (awardCount === 0 ? items.length === 0 && nextCursor === null : after !== null || items.length > 0));
  if (after === null && nextCursor === null) demand(items.length === awardCount && items.reduce((s, a) => s + BigInt(a.amountWei), 0n) === BigInt(allocatedWei));
  demand(typeof p.previewDigest === "string" && /^[0-9a-f]{64}$/.test(p.previewDigest));
  const revision = count(p.revision, 2147483647); demand(revision > 0);
  return { ...expected, budgetWei, stage: "preview" as const, allocationId: null, preview: { reviewId: uuid(p.reviewId), revision,
    snapshotId: uuid(p.snapshotId), reviewedAt: timestamp(p.reviewedAt), capturedAt: timestamp(p.capturedAt), pot: p.pot,
    previewDigest: p.previewDigest, allocatedWei, unallocatedWei, selectedFinishCount: count(p.selectedFinishCount),
    excludedFinishCount: count(p.excludedFinishCount), awardCount, families, items, nextCursor } };
}
export function decodeRewardReservation(v: unknown, expected: RewardPreparationSelection & { reviewId: string }) {
  const d = object(v, [...scopeKeys, "reviewId", "allocationId", "allocatedWei", "unallocatedWei", "entitlementCount", "reservedAt"]); scope(d, expected);
  demand(d.reviewId === uuid(expected.reviewId));
  return { ...expected, allocationId: uuid(d.allocationId), allocatedWei: amount(d.allocatedWei), unallocatedWei: amount(d.unallocatedWei),
    entitlementCount: count(d.entitlementCount), reservedAt: timestamp(d.reservedAt) };
}
export type RewardPreparationView = ReturnType<typeof decodeRewardPreparation>;
