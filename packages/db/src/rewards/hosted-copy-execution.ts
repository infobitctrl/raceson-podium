import type {RewardAccountIdentity} from './athlete-wallets.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
import {setupId} from '@raceson/domain/rewards/distribution-setup';

/** Private transport for the copied sponsor only. The generic RPC grants remain
 * revoked. Caller identity and scope cannot be replaced by a downstream service. */
export function hostedCopySponsorExecutionRpc(identity:RewardAccountIdentity,id:string,rpc:RewardLedgerRpc,fingerprint?:string):RewardLedgerRpc {
 if(![identity.userId,identity.sessionId,id].every(setupId)||fingerprint!==undefined&&!/^[0-9a-f]{64}$/.test(fingerprint))throw Error('invalid_sponsor_execution');
 return async(name,args)=>{
  if(args.p_actor_user_id!==identity.userId||args.p_actor_session_id!==identity.sessionId||args.p_setup_id!==id
   ||args.p_chain_id!==undefined&&args.p_chain_id!==10143)throw Error('invalid_sponsor_execution');
  let operation:string,payload:Record<string,unknown>;
  switch(name){
   case 'service_reward_sponsor_launch':
    if(!fingerprint)throw Error('reward_launch_sources_required');
    operation='launch';payload={requestId:args.p_request_id,expectedRevision:args.p_expected_revision,sourceFingerprint:fingerprint};break;
   case 'service_reward_sponsor_execution':
    operation='execution';payload={plan:args.p_plan,deploymentHash:args.p_deployment_hash,fundingHash:args.p_funding_hash};break;
   case 'service_reward_sponsor_auto_deployment':
    operation='creation';payload={action:args.p_action,leaseId:args.p_lease_id,sender:args.p_sender,transaction:args.p_transaction,
     signedTransaction:args.p_signed_transaction,hash:args.p_transaction_hash,chainId:10143};break;
   case 'service_reward_sponsor_creation_available':
    operation='availability';payload={sender:args.p_sender};break;
   default:throw Error('invalid_sponsor_execution');
  }
  return rpc('service_reward_demo_copy_sponsor_operation',{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,
   p_setup_id:id,p_operation:operation,p_payload:payload});
 };
}
/** Narrow server transport; SQL retains current master/session checks. */
export function hostedCopyWalletRpc(rpc:RewardLedgerRpc):RewardLedgerRpc{
 return (name,args)=>{
  if(name==='service_reward_wallet_runtime'&&Object.keys(args).length===0)return rpc('service_reward_demo_copy_wallet_operation',{p_operation:'runtime',p_actor_user_id:null,p_actor_session_id:null,p_payload:{}});
  if(name!=='service_reward_wallet_settings')throw Error('invalid_reward_wallet_settings');
  return rpc('service_reward_demo_copy_wallet_operation',{p_operation:'settings',p_actor_user_id:args.p_actor_user_id,p_actor_session_id:args.p_actor_session_id,
   p_payload:{expectedRevision:args.p_expected_revision,settings:args.p_settings,reason:args.p_reason,previousSettings:args.p_previous_settings}});
 };
}
