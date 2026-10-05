import {canonicalParticipationValue,decodeParticipationReviewChange,decodeParticipationReviewWorkspace,type ParticipationReviewChange} from "@raceson/domain/rewards/participation-review";
import {programmeApprovalRequestIdV3} from "@raceson/domain/rewards/programme-approval-v3";
import {createAdminSupabaseClient} from "../supabase.js";
import {RewardLedgerStoreError,type RewardLedgerRpc} from "./programme-ledger.js";
import type {RewardAccountIdentity} from "./athlete-wallets.js";

const safe=new Set(["reward_account_session_required","reward_planning_not_found","reward_participation_review_conflict",
  "reward_participation_source_missing","reward_participation_source_changed","invalid_reward_participation_review"]);
export async function rewardParticipationReview(identity:RewardAccountIdentity,chainId:31337|10143,draftId:string,
  change?:ParticipationReviewChange,rpc?:RewardLedgerRpc) {
  const captured=change?decodeParticipationReviewChange(change):null;
  const args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:chainId,p_draft_id:programmeApprovalRequestIdV3(draftId)};
  let reply;
  try {reply=await (rpc??((method,parameters)=>createAdminSupabaseClient().rpc(method,parameters)))(
    captured?"service_save_reward_participation_review":"service_read_reward_participation_review",
    {...args,...(captured?{p_request_id:captured.requestId,p_expected_review_id:captured.expectedReviewId,p_review:captured.review,p_reason:captured.reason}:{})});}
  catch {throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(reply.error) {const message=(reply.error as {message?:unknown}).message;
    throw new RewardLedgerStoreError(typeof message==="string"&&safe.has(message)?message:"reward_ledger_unavailable");}
  try {
    const view=decodeParticipationReviewWorkspace(reply.data);
    if(view.record.draftId!==draftId||view.record.chainId!==chainId)throw Error();
    if(captured) {const r=view.recordedReview;
      if(!r||r.id!==captured.requestId||r.previousReviewId!==captured.expectedReviewId||r.reason!==captured.reason
        ||r.reviewedByUserId!==identity.userId||canonicalParticipationValue(r.review)!==canonicalParticipationValue(captured.review))throw Error();
    } else if(view.recordedReview!==null)throw Error();
    return view;
  } catch {throw new RewardLedgerStoreError("reward_ledger_unavailable");}
}
