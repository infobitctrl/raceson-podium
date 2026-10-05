import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { dispatchAthleteRewardRoutes } from "./athlete.js";
import { getClubReadinessV3, reviewClubReadinessV3, revokeClubTreasuryReadinessV3, observeClubReadinessV3,
  type ClubReadinessDependenciesV3 } from "../../features/rewards/club-readiness-v3-service.js";

const address=z.string().regex(/^0x[0-9a-f]{40}$/),hash=z.string().regex(/^0x[0-9a-f]{64}$/);
const block=z.object({number:z.string().regex(/^(0|[1-9][0-9]{0,77})$/),hash,timestamp:z.string().regex(/^(0|[1-9][0-9]{0,77})$/)}).strict();
const evidence=z.object({schemaVersion:z.literal(1),policy:z.literal("operator-reviewed-original-safe-v1"),chainId:z.union([z.literal(31337),z.literal(10143)]),
  candidate:z.object({safeAddress:address,singletonAddress:address,fallbackHandlerAddress:address,owners:z.array(address).length(3)}).strict(),
  factoryAddress:address,deploymentTransactionHash:hash,deploymentBlock:block,reviewedBlock:block,initializerHash:hash,
  authorityEvidenceRef:z.string().uuid(),controlEvidenceRef:z.string().uuid(),recoveryEvidenceRef:z.string().uuid(),executionHistoryEvidenceRef:z.string().uuid()}).strict();
const review=z.object({reviewId:z.string().uuid(),previousReviewId:z.string().uuid().nullable(),sourceGuardHash:z.string().regex(/^[0-9a-f]{64}$/),
  identityFingerprint:z.string().regex(/^[0-9a-f]{64}$/),evidence}).strict();
const revocation=z.object({reviewId:z.string().uuid(),reason:z.enum(["authority_uncertain","key_control_changed","wallet_history_uncertain","operator_correction"])}).strict();
const observation=z.object({previousReviewId:z.string().uuid().nullable(),sourceGuardHash:z.string().regex(/^[0-9a-f]{64}$/),
  identityFingerprint:z.string().regex(/^[0-9a-f]{64}$/),factoryAddress:address.transform(v=>v as `0x${string}`),deploymentTransactionHash:hash.transform(v=>v as `0x${string}`)}).strict();
export async function dispatchClubReadinessV3(req:IncomingMessage,res:ServerResponse,url:URL,
  deps:Parameters<typeof dispatchAthleteRewardRoutes>[3]&{clubReaderV3?:ClubReadinessDependenciesV3["reader"]}){
  const match=/^\/api\/v1\/(club|organizer)\/rewards\/uploads\/([^/]+)\/club-treasuries\/([^/]+)\/readiness-v3(\/revoke|\/observe)?$/.exec(url.pathname);
  if(!match||!["GET","POST"].includes(req.method??"")||(req.method==="GET"&&match[4])||(req.method==="POST"&&match[1]!=="organizer"))return false;
  deps.applyPrivateSessionHeaders(res);
  try{
    const config=deps.config();if(!config)return false;
    const identity=await deps.requireIdentity(req);
    if([...url.searchParams].length)throw new Error("invalid_reward_query");
    const scope={uploadId:z.string().uuid().parse(match[2]),requestId:z.string().uuid().parse(match[3])};
    const dependencies={chainId:config.chainId,rpc:deps.rpc,reader:deps.clubReaderV3};
    const result=req.method==="GET"?await getClubReadinessV3(identity,{...scope,role:match[1]==="club"?"recipient":"operator"},dependencies)
      :match[4]==="/observe"?await observeClubReadinessV3(identity,{...scope,...observation.parse(await deps.readJsonBody(req))},dependencies)
      :match[4]?await revokeClubTreasuryReadinessV3(identity,{...scope,...revocation.parse(await deps.readJsonBody(req))},dependencies)
        :await reviewClubReadinessV3(identity,{...scope,...review.parse(await deps.readJsonBody(req))},dependencies);
    deps.sendSuccess(res,result);
  }catch(error){
    const code=error&&typeof error==="object"&&"code" in error?String(error.code):error instanceof Error?error.message:"";
    if(["reward_account_session_required","Unauthorized","Missing bearer token"].includes(code))deps.sendError(res,401,"reward_auth_required","Sign in to access club rewards.");
    else if(code==="Untrusted browser origin")deps.sendError(res,403,"forbidden","This browser request is not allowed.");
    else if(code==="reward_club_readiness_scope_required")deps.sendError(res,404,code,"Club treasury review not found.");
    else if(["reward_club_readiness_revision_changed","reward_club_readiness_identity_changed","reward_planning_revision_changed","reward_club_readiness_hold","reward_ledger_idempotency_conflict"].includes(code))
      deps.sendError(res,409,code,"The source, club or review changed. Inspect it before approving.");
    else if(error instanceof z.ZodError||["invalid_reward_query","invalid_reward_club_readiness","invalid_reward_club_readiness_v3","invalid_reward_club_review_document","reward_club_review_candidate_mismatch"].includes(code))
      deps.sendError(res,400,"invalid_reward_request","Check the submitted club treasury review.");
    else deps.sendError(res,503,"reward_service_unavailable","Club treasury review is temporarily unavailable.");
  }
  return true;
}
