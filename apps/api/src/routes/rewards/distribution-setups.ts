import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { archiveRewardSetup, deleteRewardDraft, rewardDistributionSetups } from "@raceson/db/rewards";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";

const uuid=z.string().uuid().refine(v=>v===v.toLowerCase()&&v!=="00000000-0000-0000-0000-000000000000");
const write=z.object({requestId:uuid,expectedRevision:z.number().int().min(0).max(2147483644),configuration:z.unknown()}).strict();
const remove=z.object({expectedRevision:z.number().int().min(1).max(2147483645)}).strict();
const archive=remove.extend({archived:z.boolean()});
/** Account-owned planning drafts; a saved setup never grants sporting or payout authority. */
export async function dispatchDistributionSetups(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies){
  const path=/^\/api\/v1\/rewards\/distribution-setups(?:\/([^/]+)(\/archive)?)?$/.exec(url.pathname);
  if(!path)return false;deps.applyPrivateSessionHeaders(res);
  if(path[2]?req.method!=="POST":req.method!=="GET" && !(path[1]&&(req.method==="PATCH"||req.method==="DELETE"))){res.setHeader("Allow",path[2]?"POST":path[1]?"GET, PATCH, DELETE":"GET");deps.sendError(res,405,"method_not_allowed","Unsupported method.");return true;}
  try {
    const config=deps.config();if(!config)return false;
    const identity=await deps.requireIdentity(req);
    if([...url.searchParams].length)throw new Error("invalid_reward_setup");
    const id=path[1]?uuid.parse(path[1]):null;
    if(path[2]&&id){
      const change=archive.parse(await deps.readJsonBody(req));
      deps.sendSuccess(res,await archiveRewardSetup(identity,config.chainId,id,change.expectedRevision,change.archived,deps.rpc));
      return true;
    }
    if(req.method==="DELETE"&&id){
      const change=remove.parse(await deps.readJsonBody(req));
      deps.sendSuccess(res,await deleteRewardDraft(identity,config.chainId,id,change.expectedRevision,deps.rpc));
      return true;
    }
    const change=req.method==="PATCH"?write.parse(await deps.readJsonBody(req)):undefined;
    const result=await rewardDistributionSetups(identity,config.chainId,id,change?{...change,configuration:change.configuration}:undefined,deps.rpc);
    deps.sendSuccess(res,id?result:{items:result});
  }catch(error){
    const code=error&&typeof error==="object"&&"code" in error?String(error.code):error instanceof Error?error.message:"";
    if(["reward_account_session_required","Unauthorized","Missing bearer token"].includes(code))deps.sendError(res,401,"reward_auth_required","Sign in to the isolated demo.");
    else if(code==="Untrusted browser origin")deps.sendError(res,403,"forbidden","This browser request is not allowed.");
    else if(code==="reward_setup_not_found")deps.sendError(res,404,code,"Reward setup not found.");
    else if(code==="reward_setup_conflict")deps.sendError(res,409,code,"This setup changed. Reload before continuing.");
    else if(code==="reward_setup_not_deletable")deps.sendError(res,409,code,"Contract creation has started. Archive this campaign to remove it from the active list.");
    else if(code==="reward_setup_not_archivable")deps.sendError(res,409,code,"Funding has been verified. Reload this campaign before continuing.");
    else if(code==="reward_setup_limit")deps.sendError(res,409,code,"The saved setup limit has been reached.");
    else if(code==="invalid_reward_setup"||error instanceof z.ZodError)deps.sendError(res,400,"invalid_reward_setup","Check the setup settings.");
    else deps.sendError(res,503,"reward_setup_unavailable","The reward setup could not be saved or loaded.");
  }return true;
}
