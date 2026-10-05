import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { rewardProgrammeApprovalV3 } from "@raceson/db/rewards";
import { decodeProgrammeFundingTermsV3 } from "@raceson/domain/rewards/programme-approval-v3";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";
const request=z.object({requestId:z.string().uuid(),expectedApprovalId:z.string().uuid().nullable(),contextHash:z.string().regex(/^[0-9a-f]{64}$/),terms:z.unknown()}).strict();
export async function dispatchProgrammeApprovalV3(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies) {
  const path=/^\/api\/v1\/organizer\/rewards\/drafts\/([^/]+)\/funding-approval$/.exec(url.pathname);
  if(!path||!["GET","POST"].includes(req.method??""))return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const config=deps.config();if(!config)return false;
    const identity=await deps.requireIdentity(req);if([...url.searchParams].length)throw new Error("invalid_reward_programme_approval");
    const draftId=z.string().uuid().parse(path[1]);
    const input=req.method==="POST"?request.parse(await deps.readJsonBody(req)):undefined;
    const change=input?{...input,terms:decodeProgrammeFundingTermsV3(input.terms)}:undefined;
    deps.sendSuccess(res,await rewardProgrammeApprovalV3(identity,config.chainId,draftId,change,deps.rpc));
  } catch(error) {
    const code=error&&typeof error==="object"&&"code" in error?String(error.code):error instanceof Error?error.message:"";
    if(["reward_account_session_required","Unauthorized","Missing bearer token"].includes(code))deps.sendError(res,401,"reward_auth_required","Sign in to the isolated demo.");
    else if(code==="Untrusted browser origin")deps.sendError(res,403,"forbidden","This browser request is not allowed.");
    else if(code==="reward_planning_not_found")deps.sendError(res,404,code,"Draft is unavailable.");
    else if(["reward_planning_revision_changed","reward_programme_request_conflict","reward_programme_scope_incomplete"].includes(code))deps.sendError(res,409,code,"Reload and review the current funding scope.");
    else if(error instanceof z.ZodError||code==="invalid_reward_programme_approval")deps.sendError(res,400,"invalid_reward_programme_approval","Invalid funding approval request.");
    else deps.sendError(res,503,"reward_programme_approval_unavailable","Funding approval is unavailable.");
  }
  return true;
}
