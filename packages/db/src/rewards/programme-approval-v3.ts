import { decodeProgrammeApprovalV3, decodeProgrammeFundingTermsV3, programmeApprovalRequestIdV3, programmeApprovalMissingSlotsV3 } from "@raceson/domain/rewards/programme-approval-v3";
import { createAdminSupabaseClient } from "../supabase.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
const safe=new Set(["reward_account_session_required","reward_planning_not_found","reward_planning_revision_changed",
  "invalid_reward_programme_approval","reward_programme_scope_incomplete","reward_programme_request_conflict"]);
export async function rewardProgrammeApprovalV3(identity:RewardAccountIdentity,chainId:31337|10143,draftId:string,
  change?:{requestId:string;expectedApprovalId:string|null;contextHash:string;terms:unknown},rpc?:RewardLedgerRpc) {
  const captured=change?{requestId:programmeApprovalRequestIdV3(change.requestId),expectedApprovalId:change.expectedApprovalId===null?null:programmeApprovalRequestIdV3(change.expectedApprovalId),contextHash:change.contextHash,terms:decodeProgrammeFundingTermsV3(change.terms)}:null;
  if(captured&&!/^[0-9a-f]{64}$/.test(captured.contextHash))throw new RewardLedgerStoreError("invalid_reward_programme_approval");
  const call=rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args));
  const args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:chainId,p_draft_id:programmeApprovalRequestIdV3(draftId)};
  async function invoke(method:Parameters<RewardLedgerRpc>[0],extra:Record<string,unknown>={}) {
    let response;try{response=await call(method,{...args,...extra})}catch{throw new RewardLedgerStoreError("reward_ledger_unavailable")}
    if(response.error){const message=(response.error as {message?:unknown}).message;throw new RewardLedgerStoreError(typeof message==="string"&&safe.has(message)?message:"reward_ledger_unavailable")}
    const view=decodeProgrammeApprovalV3(response.data);
    if(view.record.draftId!==draftId||view.record.chainId!==chainId)throw new RewardLedgerStoreError("invalid_reward_programme_approval");return view;
  }
  if(!captured)return invoke("service_read_reward_programme_approval_v3");
  const current=await invoke("service_read_reward_programme_approval_v3");
  // Reconstruct before entering the write RPC; SQL repeats scope/CAS/Auth checks.
  // Exact retries are permitted to recover the immutable earlier decision.
  if(current.approval?.id!==captured.requestId){
    if(current.contextHash!==captured.contextHash)throw new RewardLedgerStoreError("reward_planning_revision_changed");
    if(!current.workspace.revision||programmeApprovalMissingSlotsV3(current.workspace).length)throw new RewardLedgerStoreError("reward_programme_scope_incomplete");
  }
  const saved=await invoke("service_approve_reward_programme_v3",{p_request_id:captured.requestId,p_expected_approval_id:captured.expectedApprovalId,p_context_hash:captured.contextHash,p_terms:captured.terms});
  if(saved.approval?.id!==captured.requestId||saved.approval.contextHash!==captured.contextHash
    ||JSON.stringify(saved.approval.terms)!==JSON.stringify(captured.terms))throw new RewardLedgerStoreError("reward_programme_request_conflict");
  return saved;
}
