import {decodeSponsorExecutionView} from "./sponsorExecutionCodec";
export {decodeSponsorExecutionView,type SponsorExecutionView} from "./sponsorExecutionCodec";
import {apiRequest} from "@/lib/api";
import {publicEnv} from "@/lib/public-env";
import {setupId} from "@raceson/domain/rewards/distribution-setup";

export type SponsorExecutionAction = {action:"launch"} | {action: "prepare"; launchId: string; funder: string} | {action: "deployment" | "funding"; hash: string};
export async function sponsorExecution(id: string, action?: SponsorExecutionAction) {
  const demo = publicEnv.rewardDemo;
  if (!setupId(id) || !demo || !publicEnv.rewardPortalEnabled) throw Error("invalid_sponsor_execution");
  const value = await apiRequest({path: `/v1/rewards/distribution-setups/${id}/execution`, cache: "no-store",
    ...(action ? {method: "POST" as const, body: action} : {})});
  return decodeSponsorExecutionView(value, demo.chainId);
}
