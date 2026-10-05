import { decodeFinaleBindingChangeV3, decodeFinaleBindingViewV3, type FinaleBindingChangeV3 } from "@raceson/domain/rewards/finale-binding-v3";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";

export async function requestFinaleBindingV3(record: SavedRewardPlanningDraft, change?: FinaleBindingChangeV3) {
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled);
  const body = change && decodeFinaleBindingChangeV3(change);
  const value = decodeFinaleBindingViewV3(await apiRequest<unknown>({ path: `/v1/organizer/rewards/drafts/${record.draftId}/finale`,
    cache: "no-store", ...(body ? { method: "POST", body } : {}) }));
  requirePortal(value.draftId === record.draftId && value.chainId === record.chainId && value.recordRevision === record.revision
    && (body ? value.recordedId === body.requestId : value.recordedId === null));
  return value;
}
