import type { IncomingMessage,ServerResponse } from "node:http";
import { z } from "zod";
import type { dispatchAthleteRewardRoutes } from "./athlete.js";
import { paymentActionsV3,paymentActionRequestV3 } from "../../features/rewards/athlete-payment-actions-v3.js";
import type { PaymentReaderV3 } from "../../features/rewards/athlete-payment-v3-service.js";
export async function dispatchPaymentActionsV3(req:IncomingMessage,res:ServerResponse,url:URL,
  deps:Parameters<typeof dispatchAthleteRewardRoutes>[3]&{paymentReaderV3?:PaymentReaderV3}){
  const m=/^\/api\/v1\/organizer\/rewards\/uploads\/([^/]+)\/destinations\/([^/]+)\/awards\/([^/]+)\/claims\/([^/]+)\/payment-actions\/([^/]+)$/.exec(url.pathname);
  if(!m||!["GET","POST"].includes(req.method??""))return false;
  deps.applyPrivateSessionHeaders(res);
  try{
    const config=deps.config();if(!config)return false;const actor=await deps.requireIdentity(req);
    if([...url.searchParams].length)throw Error("invalid_reward_payment_request");
    const scope={chainId:config.chainId,uploadId:z.string().uuid().parse(m[1]),destinationId:z.string().uuid().parse(m[2]),
      entitlementId:z.string().regex(/^0x[0-9a-f]{64}$/).parse(m[3]),claimId:z.string().uuid().parse(m[4]),paymentId:z.string().uuid().parse(m[5])};
    const change=req.method==="POST"?paymentActionRequestV3.parse(await deps.readJsonBody(req)):undefined;
    deps.sendSuccess(res,await paymentActionsV3(actor,scope,change,{...config,rpc:deps.rpc,reader:deps.paymentReaderV3}));
  }catch(error){
    const code=error&&typeof error==="object"&&"code" in error?String(error.code):error instanceof Error?error.message:"";
    if(["Unauthorized","Missing bearer token","reward_account_session_required"].includes(code))deps.sendError(res,401,"reward_auth_required","Sign in to the isolated demo.");
    else if(code==="Untrusted browser origin")deps.sendError(res,403,"forbidden","This browser request is not allowed.");
    else if(["reward_readiness_scope_required","reward_claim_scope_required","reward_payment_scope_required"].includes(code))deps.sendError(res,404,"reward_payment_not_found","Reward payment not found.");
    else if(["reward_payment_conflict","reward_payment_approvals_required","reward_payment_attempt_required","reward_claim_readiness_required",
      "reward_claim_window_unavailable","reward_claim_already_paid","reward_claim_observation_stale","reward_claim_observation_regressed",
      "reward_payment_execution_unavailable","reward_payment_eoa_required","reward_separate_relayer_required"].includes(code))
      deps.sendError(res,409,code,"Inspect the original payment and its current holds before continuing.");
    else if(error instanceof z.ZodError||["invalid_reward_payment_request","invalid_reward_payment_v3"].includes(code))
      deps.sendError(res,400,"invalid_reward_payment_request","Check the selected payment and exact gas limits.");
    else deps.sendError(res,503,"reward_payment_unavailable","Payment preparation is temporarily unavailable. Reconcile the original request before retrying.");
  }
  return true;
}
