import type {IncomingMessage,ServerResponse} from "node:http";
import {z} from "zod";
import type {dispatchFinalAllocationV3} from "./final-allocation-v3.js";
import {finalAllocationApprovalV3,finalAllocationUploadV3,finalAllocationApprovalRequestV3,finalAllocationUploadRequestV3} from "../../features/rewards/final-allocation-actions-v3-service.js";
export async function dispatchFinalAllocationActionsV3(req:IncomingMessage,res:ServerResponse,url:URL,deps:Parameters<typeof dispatchFinalAllocationV3>[3]){
  const a=/^\/api\/v1\/organizer\/rewards\/drafts\/([^/]+)\/final-allocation-approval\/([56])$/.exec(url.pathname);
  const u=/^\/api\/v1\/organizer\/rewards\/drafts\/([^/]+)\/final-allocation-upload\/([56])\/([^/]+)$/.exec(url.pathname);
  const m=a??u;if(!m||!["GET","POST"].includes(req.method??""))return false;
  deps.applyPrivateSessionHeaders(res);
  try{
    const config=deps.config();if(!config)return false;const identity=await deps.requireIdentity(req);
    if([...url.searchParams].length)throw Error("invalid_reward_final_allocation_request");
    const scope={chainId:config.chainId,draftId:z.string().uuid().parse(m[1]),slot:Number(m[2]) as 5|6};
    const result=a?await finalAllocationApprovalV3(identity,scope,req.method==="POST"?finalAllocationApprovalRequestV3.parse(await deps.readJsonBody(req)):undefined,
      {rpc:deps.rpc,reader:deps.programmeFundingReader})
      :await finalAllocationUploadV3(identity,{...scope,approvalId:z.string().uuid().parse(u![3])},
        req.method==="POST"?finalAllocationUploadRequestV3.parse(await deps.readJsonBody(req)):undefined,deps.rpc);
    deps.sendSuccess(res,result);
  }catch(e){
    const code=e&&typeof e==="object"&&"code" in e?String(e.code):e instanceof Error?e.message:"";
    if(["Unauthorized","Missing bearer token","reward_account_session_required"].includes(code))deps.sendError(res,401,"reward_auth_required","Sign in to the isolated demo.");
    else if(code==="Untrusted browser origin")deps.sendError(res,403,"forbidden","This browser request is not allowed.");
    else if(["reward_planning_not_found","reward_allocation_upload_not_found"].includes(code))deps.sendError(res,404,code,"Allocation not found or no longer accessible.");
    else if(["reward_planning_revision_changed","reward_allocation_approval_conflict","reward_allocation_upload_conflict","reward_allocation_not_ready",
      "reward_final_allocation_source_not_ready","reward_league_publication_not_ready","reward_historical_source_missing",
      "reward_programme_approval_required","reward_programme_binding_mismatch"].includes(code))
      deps.sendError(res,409,code,"Reload the original request, current official source and exact allocation before continuing.");
    else if(e instanceof z.ZodError||code==="invalid_reward_final_allocation_request")deps.sendError(res,400,"invalid_reward_final_allocation_request","Use exact allocation expectations only.");
    else deps.sendError(res,503,"reward_final_allocation_unavailable","Final allocation is temporarily unavailable. Inspect the original request before retrying.");
  }return true;
}
