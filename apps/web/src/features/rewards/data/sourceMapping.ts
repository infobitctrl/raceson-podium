import { decodeRewardMappingWorkspaceV2, previewRewardSourceMappingV2, type RewardMappingWorkspaceV2, type RewardSourceMappingV2 } from "@raceson/domain/rewards/source-mapping-v2";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => typeof v === "bigint" ? v.toString() : v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
}
function reply(raw: unknown, record: SavedRewardPlanningDraft) {
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled && raw && typeof raw === "object" && !Array.isArray(raw));
  const body = raw as Record<string, unknown>;
  requirePortal(Object.keys(body).length === 2 && Object.hasOwn(body, "workspace") && Object.hasOwn(body, "preview"));
  const workspace = decodeRewardMappingWorkspaceV2(body.workspace);
  requirePortal(workspace.draftId === record.draftId && workspace.rulesRevision === record.revision);
  let expected = null;
  try { expected = previewRewardSourceMappingV2(record.rules, workspace.mapping, workspace.catalogue); } catch { /* Stale map remains visible for repair. */ }
  requirePortal(canonical(expected) === canonical(body.preview));
  return workspace;
}
export async function readSourceMapping(record: SavedRewardPlanningDraft) {
  return reply(await apiRequest<unknown>({ path: `/v1/organizer/rewards/drafts/${record.draftId}/mapping`, cache: "no-store" }), record);
}
export async function saveSourceMapping(record: SavedRewardPlanningDraft, workspace: RewardMappingWorkspaceV2, mapping: RewardSourceMappingV2) {
  requirePortal(record.draftId === workspace.draftId && record.revision === workspace.rulesRevision);
  return reply(await apiRequest<unknown>({ path: `/v1/organizer/rewards/drafts/${record.draftId}/mapping`, method: "PATCH", cache: "no-store",
    body: { expectedRevision: workspace.revision, expectedRulesRevision: record.revision, catalogueHash: workspace.catalogueHash, mapping } }), record);
}
