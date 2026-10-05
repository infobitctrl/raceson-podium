import { decodeHistoricalSourceDecisionV3 } from "@raceson/domain/rewards/historical-source-v3";
import { decodeRewardAllocationSourceV3, previewRewardAllocationV3 } from "@raceson/domain/rewards/allocation-preview-v3";
import { decodeSavedRewardPlanningDraft, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { decodeRewardMappingWorkspaceV2, type RewardMappingWorkspaceV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";

export type HistoricalReviewContextV3 = { record: SavedRewardPlanningDraft; workspace: RewardMappingWorkspaceV2; sourceHash: string; slot: number };
export type HistoricalReviewRequestV3 = { slot: number; requestId: string; expectedReviewId: string | null; contextHash: string; decision: "confirmed_final" | "held" };
const canonical = (value: unknown): string => JSON.stringify(value, (_, v: unknown) => typeof v === "bigint" ? v.toString()
  : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v);
export async function requestHistoricalSourceV3(context: HistoricalReviewContextV3, change?: HistoricalReviewRequestV3) {
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled);
  const raw = await apiRequest<Record<string, unknown>>({ path: `/v1/organizer/rewards/drafts/${context.record.draftId}/historical-source`,
    cache: "no-store", ...(change ? { method: "POST", body: change } : {}) });
  return decodeHistoricalReview(raw, context, change);
}

/** Bootstrap only from the authenticated source endpoint; subsequent writes stay
 * pinned to this exact rules/mapping/source context. */
export async function loadHistoricalReviewContext(draftId: string, slot: number): Promise<HistoricalReviewContextV3> {
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled && /^[0-9a-f-]{36}$/.test(draftId)
    && Number.isInteger(slot) && slot >= 1 && slot <= 4);
  const raw = await apiRequest<Record<string, unknown>>({path: `/v1/organizer/rewards/drafts/${draftId}/historical-source`, cache: "no-store"});
  const record = decodeSavedRewardPlanningDraft(raw.record), workspace = decodeRewardMappingWorkspaceV2(raw.workspace);
  requirePortal(record.draftId === draftId && record.chainId === publicEnv.rewardDemo?.chainId && workspace.draftId === draftId && workspace.rulesRevision === record.revision
    && typeof raw.sourceHash === "string" && /^[0-9a-f]{64}$/.test(raw.sourceHash));
  const context = {record, workspace, sourceHash: raw.sourceHash as string, slot};
  decodeHistoricalReview(raw, context);
  return context;
}

function decodeHistoricalReview(raw: Record<string, unknown>, context: HistoricalReviewContextV3, change?: HistoricalReviewRequestV3) {
  requirePortal(raw && typeof raw === "object" && Object.keys(raw).sort().join(",") === "contextHash,decisions,preview,record,recordedDecision,schema,source,sourceHash,workspace"
    && raw.schema === "raceson-historical-source-v3");
  const record = decodeSavedRewardPlanningDraft(raw.record), workspace = decodeRewardMappingWorkspaceV2(raw.workspace);
  requirePortal(canonical(record) === canonical(context.record) && canonical(workspace) === canonical(context.workspace)
    && raw.sourceHash === context.sourceHash && typeof raw.contextHash === "string" && /^[0-9a-f]{64}$/.test(raw.contextHash));
  const source = decodeRewardAllocationSourceV3(raw.source);
  requirePortal(source.league === null && source.rounds[4].evidence === null
    && Array.isArray(raw.decisions) && raw.decisions.length <= 4);
  const decisions = raw.decisions.map(decodeHistoricalSourceDecisionV3);
  requirePortal(new Set(decisions.map(d => d.slot)).size === decisions.length);
  for (const d of decisions) requirePortal(d.current === (d.contextHash === raw.contextHash));
  for (const r of source.rounds) if (r.evidence) {
    const d = decisions.find(d => d.slot === r.slot);
    requirePortal(r.evidence.kind === (source.kind === "synthetic_rehearsal" ? "synthetic" : "historical_final") && r.evidence.digest === raw.contextHash
      && r.evidence.held === (!d?.current || d.decision !== "confirmed_final"));
  }
  const preview = previewRewardAllocationV3(record.rules, workspace.mapping, source);
  requirePortal(canonical(preview) === canonical(raw.preview));
  const recordedDecision = raw.recordedDecision === null ? null : decodeHistoricalSourceDecisionV3(raw.recordedDecision);
  if (change) requirePortal(recordedDecision?.id === change.requestId && recordedDecision.slot === change.slot
    && recordedDecision.contextHash === change.contextHash && recordedDecision.decision === change.decision);
  else requirePortal(recordedDecision === null);
  return { contextHash: raw.contextHash, decisions, source, preview, recordedDecision };
}
