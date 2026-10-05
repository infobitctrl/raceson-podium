import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";

export type AllocationUploadContextV3 = { chainId: number; draftId: string; slot: number; approvalId: string;
  contextHash: string; documentHash: string; campaignAddress: string; budgetWei: string; allocatedWei: string;
  unallocatedWei: string; entitlementCount: string };
export type AllocationUploadRequestV3 = { requestId: string; contextHash: string; documentHash: string };
const hash = (v: unknown) => { requirePortal(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v as string; };
const uuid = (v: unknown) => { requirePortal(typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v)
  && v !== "00000000-0000-0000-0000-000000000000"); return v as string; };
const integer = (v: unknown) => { requirePortal(typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n); return v as string; };
function object(value: unknown, keys: string[]) {
  requirePortal(value && typeof value === "object" && !Array.isArray(value)); const r = value as Record<string, unknown>;
  requirePortal(Object.keys(r).sort().join(",") === [...keys].sort().join(",")); return r;
}
export async function requestAllocationUploadV3(input: AllocationUploadContextV3, change?: AllocationUploadRequestV3) {
  const c = { ...input }, fixed = change && { ...change };
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled && [31337, 10143].includes(c.chainId)
    && Number.isInteger(c.slot) && c.slot >= 1 && c.slot <= 4);
  const path = `/v1/organizer/rewards/drafts/${uuid(c.draftId)}/allocation-upload/${c.slot}/${uuid(c.approvalId)}`;
  if (fixed) { uuid(fixed.requestId); requirePortal(hash(fixed.contextHash) === c.contextHash && hash(fixed.documentHash) === c.documentHash); }
  const r = object(await apiRequest<unknown>({ path, cache: "no-store", ...(fixed ? { method: "POST", body: fixed } : {}) }),
    ["schema", "chainId", "draftId", "slot", "approvalId", "contextHash", "documentHash", "current", "campaignAddress",
      "budgetWei", "allocatedWei", "unallocatedWei", "entitlementCount", "prepared", "stageReady", "payableWei"]);
  requirePortal(r.schema === "raceson-allocation-upload-view-v3" && r.chainId === c.chainId && r.draftId === c.draftId
    && r.slot === c.slot && r.approvalId === c.approvalId && r.documentHash === c.documentHash && typeof r.current === "boolean"
    && r.campaignAddress === c.campaignAddress && r.stageReady === false && r.payableWei === "0");
  const contextHash = hash(r.contextHash); if (r.current) requirePortal(contextHash === c.contextHash);
  const budgetWei = integer(r.budgetWei), allocatedWei = integer(r.allocatedWei), unallocatedWei = integer(r.unallocatedWei), entitlementCount = integer(r.entitlementCount);
  requirePortal(budgetWei === c.budgetWei && allocatedWei === c.allocatedWei && unallocatedWei === c.unallocatedWei
    && entitlementCount === c.entitlementCount && BigInt(entitlementCount) <= 10000n
    && BigInt(budgetWei) === BigInt(allocatedWei) + BigInt(unallocatedWei));
  let prepared = null;
  if (r.prepared !== null) {
    const p = object(r.prepared, ["id", "packageHash", "preparedAt"]);
    requirePortal(typeof p.preparedAt === "string" && Number.isFinite(Date.parse(p.preparedAt)));
    prepared = { id: uuid(p.id), packageHash: hash(p.packageHash), preparedAt: p.preparedAt as string };
  }
  if (fixed) requirePortal(prepared?.id === fixed.requestId);
  return { current: r.current as boolean, contextHash, budgetWei, allocatedWei, unallocatedWei, entitlementCount, prepared };
}
