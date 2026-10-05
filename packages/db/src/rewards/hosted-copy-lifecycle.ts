import type {RewardAccountIdentity} from './athlete-wallets.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
import {hostedCopyUploadRpc} from './hosted-copy-upload.js';
/** Copy-only lifecycle transport. Public browser commands contain no clock/body. */
export function hostedCopyLifecycleRpc(identity:RewardAccountIdentity,rpc:RewardLedgerRpc):RewardLedgerRpc {
 const upload=hostedCopyUploadRpc(identity,rpc);
 return async(name,args)=>{
  if(name!=='service_reward_sponsor_lifecycle_v4')return upload(name,args);
  if(args.p_chain_id!==10143||args.p_actor_user_id!==identity.userId||args.p_actor_session_id!==identity.sessionId)throw Error('invalid_sponsor_lifecycle');
  const allowed=['p_actor_user_id','p_actor_session_id','p_chain_id','p_setup_id','p_slot','p_approval_id','p_request_id','p_kind','p_body_text'];
  if(Object.keys(args).some(k=>!allowed.includes(k)))throw Error('invalid_sponsor_lifecycle');
  const {p_chain_id:_,...bounded}=args;return rpc('service_reward_demo_copy_lifecycle',bounded);
 };
}
