import type { IncomingMessage,ServerResponse } from "node:http";
import { z } from "zod";
import type { RewardAccountIdentity,RewardLedgerRpc } from "@raceson/db/rewards";
import { getAthleteRewardAllocations,prepareAthleteWalletProof,verifyAthleteWalletProof } from "../../features/rewards/athlete-wallet-service.js";
import { getAthleteAllocationsV3 } from "../../features/rewards/athlete-allocations-v3-service.js";
import type { RewardPortalConfig } from "../../features/rewards/request-identity.js";
import { getAthleteRewardClaims } from "../../features/rewards/athlete-claim-history-service.js";
import { getAthleteRewardPaymentStatus } from "../../features/rewards/athlete-payment-status-service.js";
import { consentToAthleteRewardClaim, getAthleteRewardClaimConsent } from "../../features/rewards/athlete-claim-consent-service.js";
import { createRewardClaimReader } from "../../features/rewards/claim-chain-reader.js";
import type { RewardCampaignReader, RewardClubClaimReader } from "@raceson/rewards-chain";
import { submitAthleteRewardDestination,getAthleteRewardDestination,getAthleteRewardDestinations,withdrawAthleteRewardDestination } from "../../features/rewards/athlete-destination-service.js";

const challengeSchema=z.object({address:z.string().regex(/^0x[0-9a-fA-F]{40}$/),idempotencyKey:z.string().min(8).max(128)}).strict();
const proofSchema=z.object({challengeId:z.string().uuid(),signature:z.string().regex(/^0x[0-9a-fA-F]{130}$/)}).strict();
const destinationSchema=z.object({challengeId:z.string().uuid(),athleteProfileId:z.string().uuid(),idempotencyKey:z.string().min(8).max(128)}).strict();
const consentSchema=z.object({signature:z.string().regex(/^0x[0-9a-fA-F]{130}$/),idempotencyKey:z.string().min(8).max(128)}).strict();
type Json=Record<string,unknown>|unknown[]|string|number|boolean|null;
type Dependencies={
  config:()=>RewardPortalConfig|null;
  requireIdentity:(req:IncomingMessage)=>Promise<RewardAccountIdentity>;
  readJsonBody:(req:IncomingMessage)=>Promise<unknown>;
  sendSuccess:(res:ServerResponse,payload:Json,statusCode?:number)=>void;
  sendError:(res:ServerResponse,statusCode:number,code:string,message:string)=>void;
  applyPrivateSessionHeaders:(res:ServerResponse)=>void;
  rpc?:RewardLedgerRpc;
  claimReader?:RewardCampaignReader;
  clubClaimReader?:RewardClubClaimReader;
};
const invalid=new Set(["invalid_reward_wallet_signature","reward_wallet_signature_mismatch","invalid_reward_wallet_challenge","invalid_reward_wallet_origin",
  "invalid_reward_wallet_request","reward_wallet_challenge_expired","reward_wallet_context_mismatch","reward_ledger_idempotency_conflict"]);
invalid.add("invalid_reward_destination_request");
const claimConflicts=new Set(["reward_claim_readiness_required","reward_claim_not_live","reward_claim_campaign_unavailable","reward_claim_already_paid",
  "reward_review_source_changed","reward_review_superseded","reward_record_source_changed","reward_record_approval_withdrawn","reward_record_approval_superseded",
  "reward_claim_eoa_recipient_required","reward_claim_eoa_operator_required","reward_claim_observation_stale","reward_ledger_idempotency_conflict"]);

/** Thin demo-only adapter. Recipient consent does not grant operator approval
 * or queue/broadcast a payment. Feature remains disabled by default. */
export async function dispatchAthleteRewardRoutes(req:IncomingMessage,res:ServerResponse,url:URL,deps:Dependencies){
  const destinationPath=/^\/api\/v1\/athlete\/rewards\/destination-requests\/([^/]+)(\/withdraw)?$/.exec(url.pathname);
  const claimPath=/^\/api\/v1\/athlete\/rewards\/claims\/([^/]+)(\/consent|\/payment)?$/.exec(url.pathname);
  const action=req.method==="GET" && url.pathname==="/api/v1/athlete/rewards/allocations"?"allocations":
    req.method==="GET" && url.pathname==="/api/v1/athlete/rewards/programme-allocations-v3"?"allocationsV3":
    req.method==="GET" && url.pathname==="/api/v1/athlete/rewards/claims"?"claims":
    req.method==="GET" && claimPath && !claimPath[2]?"claimRead":
    req.method==="GET" && claimPath?.[2]==="/payment"?"claimPayment":
    req.method==="POST" && claimPath?.[2]==="/consent"?"claimConsent":
    req.method==="POST" && url.pathname==="/api/v1/athlete/rewards/wallet-challenges"?"challenge":
      req.method==="POST" && url.pathname==="/api/v1/athlete/rewards/wallet-proofs"?"proof":
        req.method==="POST" && url.pathname==="/api/v1/athlete/rewards/destination-requests"?"destination":
          req.method==="GET" && url.pathname==="/api/v1/athlete/rewards/destination-requests"?"destinationList":
          req.method==="GET" && destinationPath && !destinationPath[2]?"destinationRead":
            req.method==="POST" && destinationPath?.[2]==="/withdraw"?"destinationWithdraw":null;
  if(!action)return false;
  deps.applyPrivateSessionHeaders(res);
  try{
    const config=deps.config();if(!config)return false;
    const identity=await deps.requireIdentity(req);
    const keys=[...url.searchParams.keys()];
    const paginated=action==="allocations"||action==="allocationsV3"||action==="destinationList"||action==="claims";
    if((!paginated && keys.length) || (paginated && (keys.length>1||keys.some(key=>key!=="after"))))throw new Error("invalid_reward_query");
    if(action==="allocationsV3"){
      const after=url.searchParams.has("after")?z.string().regex(/^0x[0-9a-f]{64}$/).parse(url.searchParams.get("after")):null;
      deps.sendSuccess(res,await getAthleteAllocationsV3(identity,after,{...config,rpc:deps.rpc}));
    }else if(action==="allocations"){
      const after=url.searchParams.has("after")?z.string().uuid().parse(url.searchParams.get("after")):null;
      const result=await getAthleteRewardAllocations(identity,after,deps.rpc);
      deps.sendSuccess(res,{items:result.items.map(a=>({...a,amountWei:a.amountWei.toString()})),nextCursor:result.nextCursor});
    }else if(action==="claims"){
      const after=url.searchParams.has("after")?z.string().uuid().parse(url.searchParams.get("after")):null;
      deps.sendSuccess(res,await getAthleteRewardClaims(identity,after,{...config,rpc:deps.rpc}));
    }else if(action==="claimPayment"){
      const intentId=z.string().uuid().parse(claimPath?.[1]);
      deps.sendSuccess(res,await getAthleteRewardPaymentStatus(identity,intentId,{...config,rpc:deps.rpc}));
    }else if(action==="claimRead"||action==="claimConsent"){
      const intentId=z.string().uuid().parse(claimPath?.[1]);
      const input=action==="claimConsent"?consentSchema.parse(await deps.readJsonBody(req)):null;
      const reader=deps.claimReader??createRewardClaimReader(config);
      const options={...config,rpc:deps.rpc,reader};
      if(input)deps.sendSuccess(res,await consentToAthleteRewardClaim(identity,{intentId,signature:input.signature as `0x${string}`,idempotencyKey:input.idempotencyKey},options));
      else deps.sendSuccess(res,await getAthleteRewardClaimConsent(identity,intentId,options));
    }else if(action==="destinationList"){
      const after=url.searchParams.has("after")?z.string().uuid().parse(url.searchParams.get("after")):null;
      deps.sendSuccess(res,await getAthleteRewardDestinations(identity,after,deps.rpc));
    }else if(action==="challenge"){
      const input=challengeSchema.parse(await deps.readJsonBody(req));
      deps.sendSuccess(res,await prepareAthleteWalletProof(identity,input,{...config,rpc:deps.rpc}));
    }else if(action==="proof"){
      const input=proofSchema.parse(await deps.readJsonBody(req));
      deps.sendSuccess(res,await verifyAthleteWalletProof(identity,{...input,signature:input.signature as `0x${string}`},{...config,rpc:deps.rpc}));
    }else if(action==="destination"){
      const input=destinationSchema.parse(await deps.readJsonBody(req));
      deps.sendSuccess(res,await submitAthleteRewardDestination(identity,input,{...config,rpc:deps.rpc}));
    }else{
      const requestId=z.string().uuid().parse(destinationPath?.[1]);
      if(action==="destinationWithdraw"){
        z.object({}).strict().parse(await deps.readJsonBody(req));
        deps.sendSuccess(res,await withdrawAthleteRewardDestination(identity,requestId,deps.rpc));
      }else deps.sendSuccess(res,await getAthleteRewardDestination(identity,requestId,deps.rpc));
    }
  }catch(error){
    const code=error!==null && typeof error==="object" && "code" in error && typeof error.code==="string"?error.code:null;
    const message=error instanceof Error?error.message:null;
    if(code==="reward_account_session_required" || message==="Unauthorized" || message==="Missing bearer token")
      deps.sendError(res,401,"reward_auth_required","Sign in to view your rewards.");
    else if(message==="Untrusted browser origin")deps.sendError(res,403,"forbidden","This browser request is not allowed.");
    else if(code==="reward_claim_proof_scope_required"||code==="reward_payment_status_not_found")deps.sendError(res,404,"reward_claim_not_found","Prepared reward claim not found.");
    else if(code && (action==="claimRead"||action==="claimConsent") && claimConflicts.has(code))
      deps.sendError(res,409,code,"This claim needs a fresh review or has already changed. Reload your rewards before signing again.");
    else if(code==="invalid_reward_claim_signature"||code==="reward_claim_signature_mismatch")
      deps.sendError(res,400,"invalid_reward_claim_signature","Use the selected destination wallet to sign this exact reward claim.");
    else if(code==="reward_wallet_challenge_not_found")deps.sendError(res,404,code,"Wallet verification request not found.");
    else if(code==="reward_destination_not_found")deps.sendError(res,404,code,"Destination request not found.");
    else if(code==="reward_destination_profile_required" || code==="reward_destination_proof_required")
      deps.sendError(res,403,code,"Verify your profile and wallet before selecting a reward destination.");
    else if(code==="reward_destination_withdraw_first")
      deps.sendError(res,409,code,"Withdraw your previous destination request before selecting another.");
    else if(code==="reward_wallet_rate_limited"){
      res.setHeader("Retry-After","60");deps.sendError(res,429,code,"Too many wallet verification requests. Try again shortly.");
    }else if(error instanceof z.ZodError || message==="invalid_reward_query" || (code && invalid.has(code)))
      deps.sendError(res,400,code??"invalid_reward_request","Unable to verify this request. Check the details or request a new wallet verification.");
    else deps.sendError(res,503,"reward_service_unavailable","Rewards are temporarily unavailable. Please try again later.");
  }
  return true;
}
