import {decodeSponsorLaunchView} from "@raceson/domain/rewards/sponsor-launch";
import {setupId} from "@raceson/domain/rewards/distribution-setup";
import {apiRequest} from "@/lib/api";
import {publicEnv} from "@/lib/public-env";

export async function sponsorLaunch(id: string, change?: {requestId: string; expectedRevision: number}) {
  const demo = publicEnv.rewardDemo;
  if (!demo || !publicEnv.rewardPortalEnabled || !setupId(id)) throw Error("invalid_sponsor_launch");
  const value = await apiRequest({path: `/v1/rewards/distribution-setups/${id}/launch`, cache: "no-store",
    ...(change ? {method: "POST" as const, body: change} : {})});
  const view = decodeSponsorLaunchView(value, demo.chainId, id);
  if (change && view.launch?.setup.revision !== change.expectedRevision) throw Error("invalid_sponsor_launch");
  return view;
}
