import type {IncomingMessage,ServerResponse} from "node:http";
import {resolveSponsorSourceV4} from "@raceson/db/rewards";
import {decodeSponsorSourceRequestV4} from "@raceson/domain/rewards/sponsor-source";
import type {OrganizerRewardRouteDependencies} from "./organizer.js";

export async function dispatchSponsorSourceV4(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies){
 if(url.pathname!=="/api/v1/rewards/sponsor-sources/resolve")return false;
 deps.applyPrivateSessionHeaders(res);
 if(req.method!=="POST"){res.setHeader("Allow","POST");deps.sendError(res,405,"method_not_allowed","Unsupported method.");return true;}
 try{
   const config=deps.config();if(!config)return false;
   const identity=await deps.requireIdentity(req);
   if([...url.searchParams].length)throw Error("invalid_reward_sponsor_source");
   const selection=decodeSponsorSourceRequestV4(await deps.readJsonBody(req));
   deps.sendSuccess(res,await resolveSponsorSourceV4(identity,config.chainId,selection,deps.rpc));
 }catch(error){
   const code=error&&typeof error==="object"&&"code" in error?String(error.code):error instanceof Error?error.message:"";
   if(["reward_account_session_required","Unauthorized","Missing bearer token"].includes(code))deps.sendError(res,401,"reward_auth_required","Sign in to choose this reward source.");
   else if(code==="Untrusted browser origin")deps.sendError(res,403,"forbidden","This browser request is not allowed.");
   else if(code==="reward_sponsor_source_not_found")deps.sendError(res,404,code,"This event is not available for sponsorship.");
   else if(code==="reward_sponsor_source_stale")deps.sendError(res,409,code,"The published source changed. Refresh before continuing.");
   else if(code==="invalid_reward_sponsor_source")deps.sendError(res,400,code,"Choose a published league or event.");
   else deps.sendError(res,503,"reward_sponsor_source_unavailable","The reward source could not be loaded.");
 }
 return true;
}
