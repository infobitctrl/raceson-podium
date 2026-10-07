import type {RewardAccountIdentity} from './athlete-wallets.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
import type {SponsorUploadScopeV4} from './sponsor-upload-v4.js';
/** Reuse receipt/nonce verification without impersonating a native Privy user.
 * The database separately validates the ordinary reviewer and exact scope. */
export function reviewPublicationRpc(identity:RewardAccountIdentity,scope:SponsorUploadScopeV4,operator:string,rpc:RewardLedgerRpc):RewardLedgerRpc{
 return async(name,args)=>{
  if(name==='service_reward_controller_v4'){
   if(args.p_operator!==operator||args.p_subject!=='service:review-publication'||args.p_chain_id!==10143||args.p_setup_id!==scope.setupId||args.p_approval_id!==scope.approvalId)throw Error('controller_scope_required');
   if(args.p_receipt!==null){
    return rpc('service_reward_demo_copy_review_publication_receipt',{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_setup_id:scope.setupId,p_slot:scope.slot,p_approval_id:scope.approvalId,p_operator:operator,p_id:args.p_request_id,p_receipt:args.p_receipt});
   }
   return rpc('service_reward_demo_copy_lifecycle',{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_setup_id:scope.setupId,p_slot:scope.slot,p_approval_id:scope.approvalId,p_request_id:null,p_kind:null,p_body_text:null});
  }
  if(name==='service_reward_controller_transaction'){
   if(args.p_subject!=='service:review-publication'||args.p_sender!==operator)throw Error('controller_scope_required');
   const {p_subject:_,p_sender:__,...command}=args;
   return rpc('service_reward_demo_copy_review_publication_transaction',{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_setup_id:scope.setupId,p_slot:scope.slot,p_approval_id:scope.approvalId,p_operator:operator,...command});
  }
  throw Error('controller_scope_required');
 };
}
