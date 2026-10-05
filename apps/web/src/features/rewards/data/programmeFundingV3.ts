import { decodeProgrammeFundingV3 } from "@raceson/domain/rewards/programme-funding-v3";
import { decodeSavedRewardPlanningDraft, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";

export async function readProgrammeFundingV3(input: SavedRewardPlanningDraft) {
  const record = decodeSavedRewardPlanningDraft(input);
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled);
  requirePortal(record.chainId === (publicEnv.rewardDemo?.mode === "local" ? 31337 : 10143));
  const raw = await apiRequest<unknown>({ path: `/v1/organizer/rewards/drafts/${record.draftId}/funding`, cache: "no-store" });
  return decodeProgrammeFundingV3(raw, record);
}
