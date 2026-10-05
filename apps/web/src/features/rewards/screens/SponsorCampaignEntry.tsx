import {publicEnv} from "@/lib/public-env";
import CopySponsorCampaign from "./CopySponsorCampaign";
import {Navigate,useSearchParams} from "react-router-dom";
import RewardSetup from "./RewardSetup";

const DEFAULT_GUEST_DRAFT_KEY="raceson.reward-setup.sign-in-draft.v1.sponsor.league";
function hasRetainedGuestDraft(){
  try{return sessionStorage.getItem(DEFAULT_GUEST_DRAFT_KEY)!==null;}
  catch{return true;} // Keep the editor reachable when stored work cannot be inspected.
}

/** New sponsors choose a source first; saved and guest drafts keep their editor. */
export default function SponsorCampaignEntry(){
  const [search]=useSearchParams();
  if(!search.toString()&&!hasRetainedGuestDraft())return <Navigate to="/rewards/events" replace/>;
  return publicEnv.hostedCopy?<CopySponsorCampaign/>:<RewardSetup campaign/>;
}
