import type { IncomingMessage,ServerResponse } from "node:http";
import { z } from "zod";
import { readClubPaymentStatusV3 } from "@raceson/db/rewards";
import type { dispatchAthleteRewardRoutes } from "./athlete.js";
import type { RewardProgrammeClubClaimReaderV3 } from "@raceson/rewards-chain";
import { prepareClubClaimV3,reviewClubClaimSigningV3,recordClubClaimProofV3 } from "../../features/rewards/club-claims-v3-service.js";
const prepare=z.object({reviewId:z.string().uuid(),sourceGuardHash:z.string().regex(/^[0-9a-f]{64}$/),identityFingerprint:z.string().regex(/^[0-9a-f]{64}$/)}).strict();
const proof=z.object({signature:z.string().regex(/^0x([0-9a-fA-F]{2}){1,8192}$/)}).strict();
export async function dispatchClubClaimsV3(req:IncomingMessage,res:ServerResponse,url:URL,
  deps:Parameters<typeof dispatchAthleteRewardRoutes>[3]&{clubClaimV3Reader?:RewardProgrammeClubClaimReaderV3}) {
  const m=/^\/api\/v1\/(club|organizer)\/rewards\/uploads\/([^/]+)\/club-treasuries\/([^/]+)\/awards\/([^/]+)\/claims\/([^/]+)\/(prepare|signing|proof|payment)$/.exec(url.pathname);
  if(!m || (["signing","payment"].includes(m[6])?req.method!=="GET":req.method!=="POST") || (m[6]==="prepare" && m[1]!=="organizer"))return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const config=deps.config();if(!config)return false;
    const identity=await deps.requireIdentity(req);
    if(!m)throw Error("invalid_reward_claim_request");
    if([...url.searchParams].length)throw Error("invalid_reward_claim_request");
    const scope={uploadId:z.string().uuid().parse(m[2]),requestId:z.string().uuid().parse(m[3]),
      entitlementId:z.string().regex(/^0x[0-9a-f]{64}$/).parse(m[4]),claimId:z.string().uuid().parse(m[5]),role:m[1]==="club"?"recipient" as const:"operator" as const};
    if(m[6]==="payment"){
      deps.sendSuccess(res,await readClubPaymentStatusV3(identity,{...scope,chainId:config.chainId},deps.rpc));return true;
    }
    const body=m[6]==="prepare"?prepare.parse(await deps.readJsonBody(req)):m[6]==="proof"?proof.parse(await deps.readJsonBody(req)):null;
    if(m[6]==="proof" && scope.role==="operator" && !/^0x[0-9a-fA-F]{130}$/.test((body as z.infer<typeof proof>).signature))throw Error("invalid_reward_claim_request");
    if(!deps.clubClaimV3Reader)throw Error("reward_claim_reader_required");
    const options={...config,rpc:deps.rpc,reader:deps.clubClaimV3Reader};
    const result=m[6]==="prepare"?await prepareClubClaimV3(identity,{...scope,...body as z.infer<typeof prepare>},options)
      :m[6]==="proof"?await recordClubClaimProofV3(identity,{...scope,signature:(body as z.infer<typeof proof>).signature as `0x${string}`},options)
        :await reviewClubClaimSigningV3(identity,scope,options);
    deps.sendSuccess(res,result);
  } catch(error) {
    const code=error && typeof error==="object" && "code" in error?String(error.code):error instanceof Error?error.message:"";
    if(["reward_account_session_required","Unauthorized","Missing bearer token"].includes(code))deps.sendError(res,401,"reward_auth_required","Sign in to the isolated rewards demo.");
    else if(code==="Untrusted browser origin")deps.sendError(res,403,"forbidden","This browser request is not allowed.");
    else if(["reward_claim_scope_required","reward_club_readiness_scope_required"].includes(code))deps.sendError(res,404,"reward_claim_not_found","Reward claim not found.");
    else if(["reward_claim_readiness_required","reward_claim_campaign_not_ready","reward_claim_campaign_unavailable","reward_claim_already_paid",
      "reward_claim_window_unavailable","reward_claim_already_prepared","reward_claim_observation_regressed","reward_claim_observation_stale",
      "reward_recipient_consent_required","reward_ledger_idempotency_conflict"].includes(code))deps.sendError(res,409,code,"Inspect the current claim and its holds before continuing.");
    else if(error instanceof z.ZodError || ["invalid_reward_claim_request","invalid_reward_claim_signature","reward_claim_signature_mismatch"].includes(code))
      deps.sendError(res,400,"invalid_reward_claim_request","Check the exact claim and signature.");
    else deps.sendError(res,503,"reward_claim_unavailable","The claim service is temporarily unavailable.");
  }
  return true;
}
