import type {IncomingMessage,ServerResponse} from "node:http";
import {z} from "zod";
import type {dispatchAthleteRewardRoutes} from "./athlete.js";
import {leaguePublicationV3,leaguePublicationRequestV3} from "../../features/rewards/league-publication-v3-service.js";
export async function dispatchLeaguePublicationV3(req:IncomingMessage,res:ServerResponse,url:URL,deps:Parameters<typeof dispatchAthleteRewardRoutes>[3]){
  const m=/^\/api\/v1\/organizer\/rewards\/drafts\/([^/]+)\/league-publication$/.exec(url.pathname);
  if(!m||!["GET","POST"].includes(req.method??""))return false;
  deps.applyPrivateSessionHeaders(res);
  try{
    const config=deps.config();if(!config)return false;const identity=await deps.requireIdentity(req);
    if([...url.searchParams].length)throw Error("invalid_reward_league_publication_request");
    const scope={chainId:config.chainId,draftId:z.string().uuid().parse(m[1])};
    const change=req.method==="POST"?leaguePublicationRequestV3.parse(await deps.readJsonBody(req)):undefined;
    deps.sendSuccess(res,await leaguePublicationV3(identity,scope,change,deps.rpc));
  }catch(e){
    const code=e&&typeof e==="object"&&"code" in e?String(e.code):e instanceof Error?e.message:"";
    if(["Unauthorized","Missing bearer token","reward_account_session_required"].includes(code))deps.sendError(res,401,"reward_auth_required","Sign in to the isolated demo.");
    else if(code==="Untrusted browser origin")deps.sendError(res,403,"forbidden","This browser request is not allowed.");
    else if(code==="reward_planning_not_found")deps.sendError(res,404,code,"Draft not found or no longer accessible.");
    else if(["reward_planning_revision_changed","reward_league_publication_conflict","reward_league_publication_not_ready","reward_historical_source_missing"].includes(code))
      deps.sendError(res,409,code,"Reload the five official sources, policy and original publication request before continuing.");
    else if(e instanceof z.ZodError||code==="invalid_reward_league_publication_request")deps.sendError(res,400,"invalid_reward_league_publication_request","Check the exact publication selection.");
    else deps.sendError(res,503,"reward_league_publication_unavailable","League publication is temporarily unavailable. Inspect the original request before retrying.");
  }return true;
}
