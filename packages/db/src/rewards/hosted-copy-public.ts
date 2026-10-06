import {setupId} from '@raceson/domain/rewards/distribution-setup';
import type {RewardAccountIdentity} from './athlete-wallets.js';
import type {RewardLedgerRpc} from './programme-ledger.js';

/** The caller identity is captured from the authenticated route, never branding input. */
export function hostedCopyBrandingRpc(rpc:RewardLedgerRpc,identity?:RewardAccountIdentity):RewardLedgerRpc {
 if(identity&&(!setupId(identity.userId)||!setupId(identity.sessionId)))throw Error('invalid_campaign_branding');
 const userId=identity?.userId??null,sessionId=identity?.sessionId??null;
 return (name,args)=>{
  if(name!=='service_reward_campaign_branding'||args.p_chain_id!==10143||Object.keys(args).length!==5
   ||!['p_chain_id','p_actor_user_id','p_actor_session_id','p_setup_id','p_change'].every(k=>k in args)
   ||args.p_actor_user_id!==userId||args.p_actor_session_id!==sessionId
   ||args.p_setup_id!==null&&!setupId(args.p_setup_id)||args.p_change!==null&&(!userId||!setupId(args.p_setup_id)))throw Error('invalid_campaign_branding');
  return rpc('service_reward_demo_copy_campaign_branding',{p_actor_user_id:userId,p_actor_session_id:sessionId,p_setup_id:args.p_setup_id,p_change:args.p_change});
 };
}

/** Only fixed-copy public projections. A publishing closure captures the actual
 * sponsor session; public readers cannot manufacture an authenticated writer. */
export function hostedCopyPublicRpc(rpc:RewardLedgerRpc,identity?:RewardAccountIdentity,id?:string):RewardLedgerRpc {
 if(identity&&(!setupId(identity.userId)||!setupId(identity.sessionId)||!setupId(id)))throw Error('invalid_public_campaign');
 const userId=identity?.userId,sessionId=identity?.sessionId;
 return (name,args)=>{
  if(args.p_chain_id!==10143)throw Error('invalid_public_campaign');
  if(name==='service_reward_public_directory'&&Object.keys(args).length===1)
   return rpc('service_reward_demo_copy_public_directory',{});
  if(name==='service_reward_public_awards_v4'&&Object.keys(args).length===3&&setupId(args.p_setup_id)
   &&Number.isInteger(args.p_slot)&&Number(args.p_slot)>=0&&Number(args.p_slot)<=5)
   return rpc('service_reward_demo_copy_public_awards',{p_setup_id:args.p_setup_id,p_slot:args.p_slot});
  if(name!=='service_reward_public_campaign'||Object.keys(args).length!==5||!setupId(args.p_setup_id)
   ||!['p_chain_id','p_setup_id','p_actor_user_id','p_actor_session_id','p_campaign'].every(k=>k in args))throw Error('invalid_public_campaign');
  if(args.p_campaign!==null){
   if(!userId||args.p_setup_id!==id||args.p_actor_user_id!==userId||args.p_actor_session_id!==sessionId)throw Error('invalid_public_campaign');
  }else if(args.p_actor_user_id!==null||args.p_actor_session_id!==null)throw Error('invalid_public_campaign');
  return rpc('service_reward_demo_copy_public_campaign',{p_setup_id:args.p_setup_id,p_actor_user_id:args.p_actor_user_id,
   p_actor_session_id:args.p_actor_session_id,p_campaign:args.p_campaign});
 };
}
