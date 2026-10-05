import type {RewardAccountIdentity} from './athlete-wallets.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
import {rewardDocumentUuid} from './stored-documents.js';

const operations = {
 service_create_reward_wallet_challenge: {action:'challenge',keys:['p_chain_id','p_address','p_origin','p_idempotency_key']},
 service_read_reward_wallet_challenge: {action:'readChallenge',keys:['p_challenge_id']},
 service_confirm_reward_wallet_proof: {action:'proof',keys:['p_challenge_id','p_message_hash','p_signature']},
 service_request_reward_athlete_destination: {action:'destination',keys:['p_athlete_profile_id','p_proof_id','p_idempotency_key']},
 service_read_reward_athlete_destination: {action:'readDestination',keys:['p_request_id']},
 service_list_reward_athlete_destinations: {action:'listDestinations',keys:['p_after_id']},
 service_withdraw_reward_athlete_destination: {action:'withdraw',keys:['p_request_id']},
} as const;

/** Ordinary verified Auth identity, fixed hosted origin/network and seven
 * bounded operations. This adapter cannot read sporting awards or sign claims. */
export function hostedCopyBeneficiaryWalletRpc(identity:RewardAccountIdentity,rpc:RewardLedgerRpc):RewardLedgerRpc {
 const userId=rewardDocumentUuid(identity.userId),sessionId=rewardDocumentUuid(identity.sessionId);
 return async(name,args)=>{
  if(!Object.hasOwn(operations,name)||args.p_user_id!==userId||args.p_session_id!==sessionId)
   throw Error('reward_account_session_required');
  const operation=operations[name as keyof typeof operations];
  const keys:readonly string[]=operation.keys;
  if(Object.keys(args).some(k=>!['p_user_id','p_session_id',...keys].includes(k))||keys.some(k=>!Object.hasOwn(args,k)))
   throw Error('invalid_reward_wallet_request');
  if(operation.action==='challenge'&&(args.p_chain_id!==10143||args.p_origin!=='https://podium.raceson.com'))
   throw Error('invalid_reward_wallet_request');
  const input=Object.fromEntries(keys.map(k=>[k,args[k]]));
  return rpc('service_reward_demo_copy_beneficiary_wallet',{p_user_id:userId,p_session_id:sessionId,p_action:operation.action,p_input:input});
 };
}
