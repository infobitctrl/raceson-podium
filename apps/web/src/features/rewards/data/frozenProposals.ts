import { decodeFrozenRewardProposalV2, type FrozenRewardProposalV2 } from "@raceson/domain/rewards/frozen-proposal-v2";
import type { PublishedRewardSnapshotV2 } from "@raceson/domain/rewards/published-preview-v2";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import type { RewardMappingWorkspaceV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";

export type FrozenProposalContext = { record: SavedRewardPlanningDraft; workspace: RewardMappingWorkspaceV2; snapshot: PublishedRewardSnapshotV2; sourceHash: string; slot: number };
export async function requestFrozenProposals(context: FrozenProposalContext, freeze = false): Promise<FrozenRewardProposalV2[]> {
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled);
  const { record, workspace, sourceHash, slot } = context;
  const raw = await apiRequest<Record<string, unknown>>({ path: `/v1/organizer/rewards/drafts/${record.draftId}/proposals/${slot}`,
    method: freeze ? "POST" : "GET", cache: "no-store", ...(freeze ? { body: { rulesRevision: record.revision,
      mappingRevision: workspace.revision, catalogueHash: workspace.catalogueHash, sourceHash } } : {}) });
  requirePortal(raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 1 && Array.isArray(raw.items) && raw.items.length <= 10);
  const items = (raw.items as unknown[]).map(value => decodeFrozenRewardProposalV2(value, context.snapshot, { ...record, sourceHash, slot }));
  requirePortal(items.every((r, i) => i === 0 || r.revision < items[i - 1].revision));
  if (freeze) requirePortal(items.length === 1 && items[0].document.record.revision === record.revision && items[0].document.workspace.revision === workspace.revision);
  return items;
}
