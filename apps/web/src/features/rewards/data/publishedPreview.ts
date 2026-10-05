import { decodeStoredRewardSnapshot, previewPublishedRewardsV2 } from "@raceson/domain/rewards/published-preview-v2";
import { requireHistoricalCatalogueV3, historicalMappingOnlyV3 } from "@raceson/domain/rewards/historical-catalogue-v3";
import { decodeSavedRewardPlanningDraft, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { decodeRewardMappingWorkspaceV2, type RewardMappingWorkspaceV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => typeof v === "bigint" ? v.toString() : v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v);
}
export async function readPublishedPreview(record: SavedRewardPlanningDraft, current: RewardMappingWorkspaceV2) {
  const raw = await apiRequest<Record<string, unknown>>({ path: `/v1/organizer/rewards/drafts/${record.draftId}/published-preview`, cache: "no-store" });
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled && raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 5);
  const saved = decodeSavedRewardPlanningDraft(raw.record), workspace = decodeRewardMappingWorkspaceV2(raw.workspace);
  requirePortal(saved.draftId === record.draftId && saved.organizationId === record.organizationId && saved.seasonId === record.seasonId && saved.chainId === record.chainId
    && saved.revision === record.revision && canonical(saved.rules) === canonical(record.rules));
  requirePortal(workspace.draftId === saved.draftId && workspace.rulesRevision === saved.revision && canonical(workspace) === canonical(current));
  if (raw.snapshot === null) { requirePortal(raw.sourceHash === null && raw.preview === null); return null; }
  const snapshot = decodeStoredRewardSnapshot(raw.snapshot);
  requirePortal(typeof raw.sourceHash === "string" && /^[0-9a-f]{64}$/.test(raw.sourceHash));
  requireHistoricalCatalogueV3(snapshot, workspace.catalogue);
  const preview = previewPublishedRewardsV2(saved.rules, historicalMappingOnlyV3(workspace.mapping, workspace.catalogue), snapshot);
  requirePortal(canonical(preview) === canonical(raw.preview));
  return { snapshot, preview, sourceHash: raw.sourceHash };
}
