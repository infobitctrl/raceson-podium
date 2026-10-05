import type { IncomingMessage, ServerResponse } from "node:http";
import { rewardProgrammeCreation } from "@raceson/db/rewards";
import { decodeCreateProgramme } from "@raceson/domain/rewards/programme-creation";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";
export async function dispatchProgrammeCreation(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies){
 if(url.pathname!=="/api/v1/organizer/rewards/programme-creation")return false;
 deps.applyPrivateSessionHeaders(res);
 if(!["GET","POST"].includes(req.method??"")){res.setHeader("Allow","GET, POST");deps.sendError(res,405,"method_not_allowed","Unsupported method.");return true;}
 try{
  const config=deps.config();if(!config)return false;
  const identity=await deps.requireIdentity(req);
  if([...url.searchParams].length)throw new Error("invalid_reward_planning_request");
  const change=req.method==="POST"?decodeCreateProgramme(await deps.readJsonBody(req)):undefined;
  const result=await rewardProgrammeCreation(identity,config.chainId,change,deps.rpc);
  deps.sendSuccess(res,change?{record:result}:{items:result});
 }catch(error){
  const code=error&&typeof error==="object"&&"code" in error?String(error.code):error instanceof Error?error.message:"";
  if(["reward_account_session_required","Unauthorized","Missing bearer token"].includes(code))deps.sendError(res,401,"reward_auth_required","Sign in to the isolated demo.");
  else if(code==="Untrusted browser origin")deps.sendError(res,403,"forbidden","This browser request is not allowed.");
  else if(code==="reward_planning_not_found")deps.sendError(res,404,code,"League unavailable for this organizer.");
  else if(code==="reward_programme_exists")deps.sendError(res,409,code,"A programme already exists. Refresh the league list.");
  else if(code==="invalid_reward_planning_request")deps.sendError(res,400,code,"Check the programme settings.");
  else deps.sendError(res,503,"reward_programme_unavailable","Programme could not be created or loaded.");
 }return true;
}
