import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { rewardTestProgrammes } from "@raceson/db/rewards";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";

const uuid=z.string().uuid().refine(v=>v===v.toLowerCase()&&v!=="00000000-0000-0000-0000-000000000000");
const write=z.object({requestId:uuid,expectedRevision:z.number().int().min(0).max(2147483644),configuration:z.unknown()}).strict();
/** Account-owned simulations; having a test never grants organizer authority. */
export async function dispatchTestProgrammes(req:IncomingMessage,res:ServerResponse,url:URL,deps:OrganizerRewardRouteDependencies){
  const path=/^\/api\/v1\/rewards\/test-programmes(?:\/([^/]+))?$/.exec(url.pathname);
  if(!path)return false;deps.applyPrivateSessionHeaders(res);
  if(req.method!=="GET" && !(path[1]&&req.method==="PATCH")){res.setHeader("Allow",path[1]?"GET, PATCH":"GET");deps.sendError(res,405,"method_not_allowed","Unsupported method.");return true;}
  try {
    const config=deps.config();if(!config)return false;
    const identity=await deps.requireIdentity(req);
    if([...url.searchParams].length)throw new Error("invalid_test_programme");
    const id=path[1]?uuid.parse(path[1]):null;
    const change=req.method==="PATCH"?write.parse(await deps.readJsonBody(req)):undefined;
    const result=await rewardTestProgrammes(identity,config.chainId,id,change?{...change,configuration:change.configuration}:undefined,deps.rpc);
    deps.sendSuccess(res,id?result:{items:result});
  }catch(error){
    const code=error&&typeof error==="object"&&"code" in error?String(error.code):error instanceof Error?error.message:"";
    if(["reward_account_session_required","Unauthorized","Missing bearer token"].includes(code))deps.sendError(res,401,"reward_auth_required","Sign in to the isolated demo.");
    else if(code==="Untrusted browser origin")deps.sendError(res,403,"forbidden","This browser request is not allowed.");
    else if(code==="reward_test_not_found")deps.sendError(res,404,code,"Test programme not found.");
    else if(code==="reward_test_conflict")deps.sendError(res,409,code,"This test changed. Reload before saving.");
    else if(code==="reward_test_limit")deps.sendError(res,409,code,"The saved test limit has been reached.");
    else if(code==="invalid_test_programme"||error instanceof z.ZodError)deps.sendError(res,400,"invalid_test_programme","Check the test settings.");
    else deps.sendError(res,503,"reward_test_unavailable","The test programme could not be saved or loaded.");
  }return true;
}
