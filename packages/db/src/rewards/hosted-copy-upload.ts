import type {RewardAccountIdentity} from './athlete-wallets.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
import {hostedCopyApprovalRpc} from './hosted-copy-approval.js';
/** Fixed copied-source package transport; never a general service proxy. */
export function hostedCopyUploadRpc(identity:RewardAccountIdentity,rpc:RewardLedgerRpc):RewardLedgerRpc {
 const approval=hostedCopyApprovalRpc(identity,rpc);
 return async(name,args)=>{
  if(['service_read_reward_sponsor_allocation_v4','service_review_reward_sponsor_allocation_v4'].includes(name))return approval(name,args);
  const prepare=name==='service_prepare_reward_sponsor_upload_v4';
  if(!prepare&&name!=='service_read_reward_sponsor_upload_v4'||args.p_chain_id!==10143||args.p_actor_user_id!==identity.userId||args.p_actor_session_id!==identity.sessionId)throw Error('invalid_sponsor_upload');
  const allowed=['p_actor_user_id','p_actor_session_id','p_chain_id','p_setup_id','p_slot','p_approval_id',
   ...(prepare?['p_request_id','p_context_hash','p_document_hash','p_package_text','p_funding']:[])];
  if(Object.keys(args).some(k=>!allowed.includes(k)))throw Error('invalid_sponsor_upload');
  const {p_chain_id:_,...bounded}=args;
  return rpc('service_reward_demo_copy_upload',{...bounded,p_operation:prepare?'prepare':'read'});
 };
}
