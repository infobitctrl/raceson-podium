import {canonicalParticipationValue as canonical,decodeParticipationReviewChange,decodeParticipationReviewWorkspace,type ParticipationReviewChange} from "@raceson/domain/rewards/participation-review";
import {apiRequest} from "@/lib/api";
import {publicEnv} from "@/lib/public-env";
import {requirePortal} from "../model/athleteRewards";
import type {SetupEventSelection} from "../components/RewardSetupEvent";

export async function requestParticipationReview(selection:SetupEventSelection,sourceHash:string,change?:ParticipationReviewChange) {
  requirePortal(publicEnv.rewardDemo&&publicEnv.rewardPortalEnabled);
  const captured=change?decodeParticipationReviewChange(change):undefined;
  const raw=await apiRequest<unknown>({path:`/v1/organizer/rewards/drafts/${selection.record.draftId}/participation-review`,cache:"no-store",
    ...(captured?{method:"POST",body:captured}:{})});
  const view=decodeParticipationReviewWorkspace(raw,true);
  requirePortal(view.record.draftId===selection.record.draftId&&view.record.chainId===selection.record.chainId&&view.record.organizationId===selection.record.organizationId);
  // A committed old request must remain recoverable after another edit/source
  // change. Validate its exact acknowledgment separately from the latest view.
  if(!captured)requirePortal(canonical(view.record)===canonical(selection.record)&&canonical(view.workspace)===canonical(selection.workspace)&&view.sourceHash===sourceHash);
  if(captured) {const r=view.recordedReview;
    requirePortal(r?.id===captured.requestId&&r.previousReviewId===captured.expectedReviewId&&r.reason===captured.reason&&canonical(r.review)===canonical(captured.review));
  } else requirePortal(view.recordedReview===null);
  return view;
}
