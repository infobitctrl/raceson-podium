import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { decodeProgrammeSources,decodeCreateProgramme,type CreateRewardProgramme } from "@raceson/domain/rewards/programme-creation";
import { decodeSavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { requirePortal } from "../model/athleteRewards";
const path="/v1/organizer/rewards/programme-creation";
export async function programmeSources(){
 const raw=await apiRequest<{items:unknown}>({path,cache:"no-store"});
 requirePortal(raw&&Object.keys(raw).join()==="items");return decodeProgrammeSources(raw.items);
}
export async function createProgramme(input:CreateRewardProgramme){
 const change=decodeCreateProgramme(input);
 const raw=await apiRequest<{record:unknown}>({path,method:"POST",body:change,cache:"no-store"});
 requirePortal(raw&&Object.keys(raw).join()==="record");
 const record=decodeSavedRewardPlanningDraft(raw.record);
 requirePortal(record.draftId===change.draftId&&record.seasonId===change.seasonId&&record.chainId===(publicEnv.rewardDemo?.mode==="local"?31337:10143));return record;
}
