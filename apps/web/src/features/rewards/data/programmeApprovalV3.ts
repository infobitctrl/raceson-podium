import { decodeProgrammeApprovalV3, decodeProgrammeFundingTermsV3 } from "@raceson/domain/rewards/programme-approval-v3";
import { decodeSavedRewardPlanningDraft, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";
export async function programmeApprovalV3(input:SavedRewardPlanningDraft,change?:{requestId:string;expectedApprovalId:string|null;contextHash:string;terms:unknown}) {
  const record=decodeSavedRewardPlanningDraft(input);
  requirePortal(publicEnv.rewardDemo&&publicEnv.rewardPortalEnabled&&record.chainId===(publicEnv.rewardDemo.mode==="local"?31337:10143));
  const body=change?{...change,terms:decodeProgrammeFundingTermsV3(change.terms)}:undefined;
  const raw=await apiRequest<unknown>({path:`/v1/organizer/rewards/drafts/${record.draftId}/funding-approval`,cache:"no-store",
    ...(body?{method:"POST",body}: {})});
  const view=decodeProgrammeApprovalV3(raw);
  requirePortal(view.record.draftId===record.draftId&&view.record.chainId===record.chainId&&view.record.revision===record.revision);
  if(body)requirePortal(view.approval?.id===body.requestId&&view.approval.contextHash===body.contextHash
    &&JSON.stringify(view.approval.terms)===JSON.stringify(body.terms));
  return view;
}
