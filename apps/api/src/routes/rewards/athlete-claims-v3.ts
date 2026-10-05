import type { IncomingMessage,ServerResponse } from "node:http";
import { z } from "zod";
import { listOwnClaimsV3,readPaymentStatusV3 } from "@raceson/db/rewards";
import type { dispatchAthleteRewardRoutes } from "./athlete.js";
import type { RewardClaimReaderV3 } from "@raceson/rewards-chain/claim-reader-v3";
import { prepareAthleteClaimV3,reviewAthleteClaimSigningV3,recordAthleteClaimProofV3 } from "../../features/rewards/athlete-claims-v3-service.js";
const prepare=z.object({reviewId:z.string().uuid(),sourceGuardHash:z.string().regex(/^[0-9a-f]{64}$/),profileFingerprint:z.string().regex(/^[0-9a-f]{64}$/)}).strict();
const proof=z.object({signature:z.string().regex(/^0x[0-9a-fA-F]{130}$/)}).strict();
export async function dispatchAthleteClaimsV3(req:IncomingMessage,res:ServerResponse,url:URL,
  deps:Parameters<typeof dispatchAthleteRewardRoutes>[3]&{claimV3Reader?:RewardClaimReaderV3}) {
  const m=/^\/api\/v1\/(athlete|organizer)\/rewards\/uploads\/([^/]+)\/destinations\/([^/]+)\/awards\/([^/]+)\/claims\/([^/]+)\/(prepare|signing|proof|payment)$/.exec(url.pathname);
  const listing=url.pathname==="/api/v1/athlete/rewards/claims-v3" && req.method==="GET";
  if(!listing && (!m || (["signing","payment"].includes(m[6])?req.method!=="GET":req.method!=="POST") || (m[6]==="prepare" && m[1]!=="organizer")))return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const config=deps.config();if(!config)return false;
    const identity=await deps.requireIdentity(req);
    if(listing){
      if([...url.searchParams.keys()].some(k=>k!=="after") || url.searchParams.getAll("after").length>1)throw Error("invalid_reward_claim_request");
      const after=url.searchParams.has("after")?z.string().uuid().parse(url.searchParams.get("after")):null;
      deps.sendSuccess(res,await listOwnClaimsV3(identity,config.chainId,after,deps.rpc));return true;
    }
    if(!m)throw Error("invalid_reward_claim_request");
    if([...url.searchParams].length)throw Error("invalid_reward_claim_request");
    const scope={uploadId:z.string().uuid().parse(m[2]),destinationId:z.string().uuid().parse(m[3]),
      entitlementId:z.string().regex(/^0x[0-9a-f]{64}$/).parse(m[4]),claimId:z.string().uuid().parse(m[5]),role:m[1]==="athlete"?"recipient" as const:"operator" as const};
    if(m[6]==="payment"){
      deps.sendSuccess(res,await readPaymentStatusV3(identity,{...scope,chainId:config.chainId},deps.rpc));return true;
    }
    const body=m[6]==="prepare"?prepare.parse(await deps.readJsonBody(req)):m[6]==="proof"?proof.parse(await deps.readJsonBody(req)):null;
    if(!deps.claimV3Reader)throw Error("reward_claim_reader_required");
    const options={...config,rpc:deps.rpc,reader:deps.claimV3Reader};
    const result=m[6]==="prepare"?await prepareAthleteClaimV3(identity,{...scope,...body as z.infer<typeof prepare>},options)
      :m[6]==="proof"?await recordAthleteClaimProofV3(identity,{...scope,signature:(body as z.infer<typeof proof>).signature as `0x${string}`},options)
        :await reviewAthleteClaimSigningV3(identity,scope,options);
    deps.sendSuccess(res,result);
  } catch(error) {
    const code=error && typeof error==="object" && "code" in error?String(error.code):error instanceof Error?error.message:"";
    if(["reward_account_session_required","Unauthorized","Missing bearer token"].includes(code))deps.sendError(res,401,"reward_auth_required","Sign in to the isolated rewards demo.");
    else if(code==="Untrusted browser origin")deps.sendError(res,403,"forbidden","This browser request is not allowed.");
    else if(["reward_claim_scope_required","reward_readiness_scope_required"].includes(code))deps.sendError(res,404,"reward_claim_not_found","Reward claim not found.");
    else if(["reward_claim_readiness_required","reward_claim_campaign_not_ready","reward_claim_campaign_unavailable","reward_claim_already_paid",
      "reward_claim_window_unavailable","reward_claim_already_prepared","reward_claim_observation_regressed","reward_claim_observation_stale",
      "reward_recipient_consent_required","reward_ledger_idempotency_conflict"].includes(code))deps.sendError(res,409,code,"Inspect the current claim and its holds before continuing.");
    else if(error instanceof z.ZodError || ["invalid_reward_claim_request","invalid_reward_claim_signature","reward_claim_signature_mismatch"].includes(code))
      deps.sendError(res,400,"invalid_reward_claim_request","Check the exact claim and signature.");
    else deps.sendError(res,503,"reward_claim_unavailable","The claim service is temporarily unavailable.");
  }
  return true;
}
