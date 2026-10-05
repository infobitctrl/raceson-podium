import {apiRequest} from "@/lib/api";
import {decodeSponsorSourceRequestV4,decodeSponsorSourceViewV4,type SponsorSourceRequestV4} from "@raceson/domain/rewards/sponsor-source";

/** Public event identity resolves a prepared source; this read never creates a
 * programme or accepts client-supplied result/category authority. */
export async function resolveSponsorSource(input:SponsorSourceRequestV4) {
 const request=decodeSponsorSourceRequestV4(input);
 const view=decodeSponsorSourceViewV4(await apiRequest<unknown>({path:"/v1/rewards/sponsor-sources/resolve",method:"POST",body:request,cache:"no-store"}));
 if("sourceLeagueId" in request&&(view.sourceLeagueId!==request.sourceLeagueId||view.sourceSeasonId!==request.sourceSeasonId||view.eventEditionId!==request.eventEditionId))throw Error("sponsor_source_changed");
 return view;
}
