import { allocationApprovalReasonsV3, decodeAllocationDocumentV3 } from "@raceson/domain/rewards/allocation-approval-v3";
import { canonicalRewardProposalV2 as canonical } from "@raceson/domain/rewards/frozen-proposal-v2";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";
import type { HistoricalReviewContextV3 } from "./historicalSourceV3";

export type AllocationApprovalRequestV3 = { requestId: string; expectedApprovalId: string | null; contextHash: string; documentHash: string };
const hash = (v: unknown): string => { requirePortal(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v as string; };
const uuid = (v: unknown): string => { requirePortal(typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v)
  && v !== "00000000-0000-0000-0000-000000000000"); return v as string; };
function object(v: unknown, keys: string[]) {
  requirePortal(v && typeof v === "object" && !Array.isArray(v)); const r = v as Record<string, unknown>;
  requirePortal(Object.keys(r).sort().join(",") === [...keys].sort().join(",")); return r;
}
async function documentHash(v: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(v)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function requestAllocationApprovalV3(context: HistoricalReviewContextV3, change?: AllocationApprovalRequestV3) {
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled && Number.isInteger(context.slot) && context.slot >= 1 && context.slot <= 4);
  const raw = object(await apiRequest<unknown>({ path: `/v1/organizer/rewards/drafts/${context.record.draftId}/allocation-approval/${context.slot}`,
    cache: "no-store", ...(change ? { method: "POST", body: change } : {}) }),
  ["schema", "contextHash", "documentHash", "document", "reasons", "approval", "recorded", "stageReady", "payableWei"]);
  requirePortal(raw.schema === "raceson-allocation-approval-v3" && raw.stageReady === false && raw.payableWei === "0");
  const contextHash = hash(raw.contextHash), digest = hash(raw.documentHash), document = decodeAllocationDocumentV3(raw.document);
  requirePortal(canonical(document.record) === canonical(context.record) && document.slot === context.slot
    && canonical(document.mapping) === canonical(context.workspace.mapping) && document.mappingRevision === context.workspace.revision
    && document.sourceHash === context.sourceHash && await documentHash(document) === digest);
  const reasons = raw.reasons;
  requirePortal(Array.isArray(reasons) && reasons.every(r => ["source_review_required", "unresolved_results", "funding_required", "funding_not_available", "historical_acknowledgement"].includes(r))
    && new Set(reasons).size === reasons.length && allocationApprovalReasonsV3(document).every(r => (reasons as string[]).includes(r)));
  async function approval(value: unknown) {
    if (value === null) return null;
    const a = object(value, ["id", "previousApprovalId", "contextHash", "documentHash", "document", "approvedAt", "approvedByUserId", "current"]);
    const d = decodeAllocationDocumentV3(a.document), approvedHash = hash(a.documentHash), approvedContext = hash(a.contextHash);
    requirePortal(d.record.draftId === context.record.draftId && d.record.chainId === context.record.chainId && d.slot === context.slot
      && await documentHash(d) === approvedHash && typeof a.approvedAt === "string" && Number.isFinite(Date.parse(a.approvedAt))
      && a.current === (approvedContext === contextHash));
    if (a.current) requirePortal(approvedHash === digest);
    return { id: uuid(a.id), previousApprovalId: a.previousApprovalId === null ? null : uuid(a.previousApprovalId),
      contextHash: approvedContext, documentHash: approvedHash, approvedAt: a.approvedAt as string,
      approvedByUserId: uuid(a.approvedByUserId), current: a.current as boolean, document: d };
  }
  const [approved, recorded] = await Promise.all([approval(raw.approval), approval(raw.recorded)]);
  if (change) requirePortal(recorded?.id === change.requestId && recorded.documentHash === change.documentHash
    && recorded.contextHash === change.contextHash && recorded.previousApprovalId === change.expectedApprovalId);
  else requirePortal(recorded === null);
  return { contextHash, documentHash: digest, document, reasons: reasons as string[], approval: approved, recorded };
}
