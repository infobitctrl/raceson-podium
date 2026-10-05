/** A deliberately non-executable recipient projection. No readiness, consent,
 * paid state, or current-chain claim is inferred from an allocation record. */
export type AthleteAllocationV3 = {
  entitlementId: string; approvalId: string; draftId: string; slot: 1 | 2 | 3 | 4 | 5 | 6;
  athleteProfileId: string; chainId: 10143 | 31337;
  sourceKind: "synthetic_rehearsal" | "minimized_source" | "native_finale" | "final_league";
  amountWei: string; campaignAddress: string; recordedAt: string;
  ageStatus: "minor" | "unknown" | "unverified_adult" | "synthetic_test";
  /** Optional only for older demo SQL. Never derive this from editable results. */
  breakdown?: AthleteAwardBreakdownV3;
  /** Non-executable labels from the approved record and exact source snapshot. */
  origin?: AthleteRewardOriginV3;
};
export type AthleteRewardOriginV3 = {
  schema: "raceson-reward-origin-v1";
  programmeName: string; hostName: string; potKind: "race" | "league";
  roundId: string | null; eventName: string | null; eventEditionId: string | null; eventDate: string | null;
  sourceKind: "synthetic_rehearsal" | "minimized_source";
};
export type AthleteAwardBreakdownV3 = {
  schema: "raceson-athlete-award-breakdown-v1";
  sourceKind: "synthetic_rehearsal" | "minimized_source";
  components: Array<{
    kind: "placing"; categoryId: string; sourceRowId: string; rank: number;
    poolWei: string; amountWei: string;
  } | {
    kind: "participation"; metres: string; totalMetres: string; finishes: number;
    resultIds: string[]; poolWei: string; amountWei: string;
  }>;
};
export type AthleteAllocationsPageV3 = {
  schema: "raceson-own-allocations-v3"; chainId: 10143 | 31337; items: AthleteAllocationV3[]; nextCursor: string | null;
};
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v)
  && BigInt(`0x${v.replaceAll("-", "")}`) !== 0n;
export const athleteAllocationCursorV3 = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v);
function check(v: unknown): asserts v { if (!v) throw new Error("invalid_reward_athlete_allocations_v3"); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v)); const r = v as Record<string, unknown>;
  check(Object.keys(r).sort().join(",") === [...keys].sort().join(",")); return r;
}
export function decodeAthleteRewardOriginV3(value: unknown, slot: number): AthleteRewardOriginV3 {
  const o = object(value, ["schema", "programmeName", "hostName", "potKind", "roundId", "eventName", "eventEditionId", "eventDate", "sourceKind"]);
  const label = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 512 && !/[\u0000-\u001f\u007f]/.test(v);
  check(o.schema === "raceson-reward-origin-v1" && label(o.programmeName) && label(o.hostName)
    && o.potKind === (slot === 6 ? "league" : "race")
    && (slot === 6 ? o.roundId === null : uuid(o.roundId))
    && ["synthetic_rehearsal", "minimized_source"].includes(String(o.sourceKind)));
  if (o.eventName === null) check(o.eventEditionId === null && o.eventDate === null);
  else check(slot !== 6 && label(o.eventName) && uuid(o.eventEditionId) && typeof o.eventDate === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(o.eventDate) && Number.isFinite(Date.parse(o.eventDate))
    && new Date(o.eventDate).toISOString().slice(0,10) === o.eventDate);
  return { ...o } as AthleteRewardOriginV3;
}
export function decodeAthleteAwardBreakdownV3(value: unknown, amountWei: string, slot: number): AthleteAwardBreakdownV3 {
  const b = object(value, ["schema", "sourceKind", "components"]);
  check(b.schema === "raceson-athlete-award-breakdown-v1"
    && ["synthetic_rehearsal", "minimized_source"].includes(String(b.sourceKind))
    && Array.isArray(b.components) && b.components.length > 0 && b.components.length <= 65);
  const positive = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,77}$/.test(v) && BigInt(v) < 2n ** 256n;
  const keys = new Set<string>();
  const components = b.components.map(raw => {
    check(raw && typeof raw === "object");
    const placing = (raw as Record<string, unknown>).kind === "placing";
    const c = object(raw, placing ? ["kind", "categoryId", "sourceRowId", "rank", "poolWei", "amountWei"]
      : ["kind", "metres", "totalMetres", "finishes", "resultIds", "poolWei", "amountWei"]);
    check(positive(c.poolWei) && positive(c.amountWei) && BigInt(c.amountWei) <= BigInt(c.poolWei));
    if (placing) {
      check(uuid(c.categoryId) && uuid(c.sourceRowId) && Number.isInteger(c.rank) && Number(c.rank) >= 1 && Number(c.rank) <= (slot === 6 ? 25 : 10));
    } else {
      check(c.kind === "participation" && slot === 6 && positive(c.metres) && positive(c.totalMetres)
        && BigInt(c.metres) <= BigInt(c.totalMetres) && Number.isInteger(c.finishes) && Number(c.finishes) >= 1 && Number(c.finishes) <= 5
        && Array.isArray(c.resultIds) && c.resultIds.length === c.finishes && c.resultIds.every(uuid)
        && new Set(c.resultIds).size === c.resultIds.length);
    }
    const key = placing ? `placing:${c.categoryId}` : "participation";
    check(!keys.has(key)); keys.add(key);
    return { ...c } as AthleteAwardBreakdownV3["components"][number];
  });
  check(components.reduce((sum, c) => sum + BigInt(c.amountWei), 0n) === BigInt(amountWei));
  return { schema: "raceson-athlete-award-breakdown-v1", sourceKind: b.sourceKind as AthleteAwardBreakdownV3["sourceKind"], components };
}
export function decodeAthleteAllocationsV3(value: unknown, expectedChainId?: number, after: string | null = null): AthleteAllocationsPageV3 {
  const p = object(value, ["schema", "chainId", "items", "nextCursor"]), chainId = p.chainId;
  check((chainId === 10143 || chainId === 31337) && (expectedChainId === undefined || chainId === expectedChainId)
    && (after === null || athleteAllocationCursorV3(after)));
  check(p.schema === "raceson-own-allocations-v3" && Array.isArray(p.items) && p.items.length <= 50);
  let previous = after;
  const items = p.items.map(raw => {
    const hasBreakdown = raw !== null && typeof raw === "object" && Object.hasOwn(raw, "breakdown");
    const hasOrigin = raw !== null && typeof raw === "object" && Object.hasOwn(raw, "origin");
    const r = object(raw, ["entitlementId", "approvalId", "draftId", "slot", "athleteProfileId", "chainId", "sourceKind", "amountWei", "campaignAddress", "recordedAt", "ageStatus", ...(hasBreakdown ? ["breakdown"] : []), ...(hasOrigin ? ["origin"] : [])]);
    check(athleteAllocationCursorV3(r.entitlementId) && BigInt(r.entitlementId) > 0n && (previous === null || r.entitlementId > previous)
      && uuid(r.approvalId) && uuid(r.draftId) && uuid(r.athleteProfileId) && r.chainId === chainId
      && Number.isInteger(r.slot) && Number(r.slot) >= 1 && Number(r.slot) <= 6
      && (r.slot===5 ? r.sourceKind==="native_finale" : r.slot===6 ? r.sourceKind==="final_league"
        : ["synthetic_rehearsal", "minimized_source"].includes(String(r.sourceKind)))
      && typeof r.amountWei === "string" && /^[1-9][0-9]{0,77}$/.test(r.amountWei) && BigInt(r.amountWei) < 2n ** 256n
      && typeof r.campaignAddress === "string" && /^0x[0-9a-f]{40}$/.test(r.campaignAddress) && BigInt(r.campaignAddress) > 0n
      && typeof r.recordedAt === "string" && Number.isFinite(Date.parse(r.recordedAt))
      && ["minor", "unknown", "unverified_adult", "synthetic_test"].includes(String(r.ageStatus)));
    if (r.ageStatus === "synthetic_test") check(chainId === 10143
      && r.draftId === "9a000000-0000-4000-8000-000000000052"
      && ["9a000000-0000-4000-8000-000000001060", "9a000000-0000-4000-8000-000000001061"].includes(String(r.athleteProfileId)));
    previous = r.entitlementId;
    const breakdown = hasBreakdown ? decodeAthleteAwardBreakdownV3(r.breakdown, r.amountWei as string, Number(r.slot)) : undefined;
    if (breakdown && Number(r.slot) <= 4) check(breakdown.sourceKind === r.sourceKind);
    if (breakdown && r.ageStatus === "synthetic_test") check(breakdown.sourceKind === "synthetic_rehearsal");
    const origin = hasOrigin ? decodeAthleteRewardOriginV3(r.origin, Number(r.slot)) : undefined;
    if (origin) {
      if (Number(r.slot) <= 4) check(origin.sourceKind === r.sourceKind);
      if (breakdown) check(origin.sourceKind === breakdown.sourceKind);
      if (r.ageStatus === "synthetic_test") check(origin.sourceKind === "synthetic_rehearsal");
    }
    return { ...r, ...(breakdown ? { breakdown } : {}), ...(origin ? { origin } : {}) } as AthleteAllocationV3;
  });
  check(p.nextCursor === null || (items.length === 50 && p.nextCursor === previous));
  return { schema: "raceson-own-allocations-v3", chainId, items, nextCursor: p.nextCursor as string | null };
}
