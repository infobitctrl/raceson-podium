import type {RewardAccountIdentity} from './athlete-wallets.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
/** A fixed transport for copied-source exact awards. No arbitrary RPC fallback. */
export function hostedCopyApprovalRpc(identity:RewardAccountIdentity,rpc:RewardLedgerRpc):RewardLedgerRpc {
 return async(name,args)=>{
  if(!['service_read_reward_sponsor_allocation_v4','service_review_reward_sponsor_allocation_v4'].includes(name)
   ||args.p_chain_id!==10143||args.p_actor_user_id!==identity.userId||args.p_actor_session_id!==identity.sessionId)throw Error('invalid_sponsor_allocation');
  const allowed=['p_actor_user_id','p_actor_session_id','p_chain_id','p_setup_id','p_slot','p_request_id',
   ...(name==='service_review_reward_sponsor_allocation_v4'?['p_expected_approval_id','p_context_hash','p_document_text','p_decision']:[])];
  if(Object.keys(args).some(k=>!allowed.includes(k)))throw Error('invalid_sponsor_allocation');
  const {p_chain_id:_,...bounded}=args;
  return rpc('service_reward_demo_copy_allocation',{...bounded,p_operation:name==='service_read_reward_sponsor_allocation_v4'?'read':'review'});
 };
}
