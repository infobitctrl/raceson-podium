import type {RewardAccountIdentity} from './athlete-wallets.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
import {rewardDocumentUuid} from './stored-documents.js';
const operations={
 service_list_reward_owned_clubs:{action:'clubs',keys:['p_after_id']},
 service_list_reward_club_treasuries:{action:'history',keys:['p_after_id']},
 service_request_reward_club_treasury:{action:'nominate',keys:['p_club_id','p_candidate','p_idempotency_key']},
 service_read_reward_club_treasury:{action:'read',keys:['p_request_id']},
 service_withdraw_reward_club_treasury:{action:'withdraw',keys:['p_request_id']},
} as const;
/** Fixed demo session and five treasury operations. Proposed public owner
 * addresses never become key control, deployment proof or recipient consent. */
export function hostedCopyClubWalletRpc(identity:RewardAccountIdentity,rpc:RewardLedgerRpc):RewardLedgerRpc {
 const userId=rewardDocumentUuid(identity.userId),sessionId=rewardDocumentUuid(identity.sessionId);
 return (name,args)=>{
  if(!Object.hasOwn(operations,name)||args.p_user_id!==userId||args.p_session_id!==sessionId)throw Error('reward_account_session_required');
  const operation=operations[name as keyof typeof operations],keys:readonly string[]=operation.keys;
  if(args.p_chain_id!==10143||Object.keys(args).length!==3+keys.length||Object.keys(args).some(k=>!['p_user_id','p_session_id','p_chain_id',...keys].includes(k))
   ||keys.some(k=>!Object.hasOwn(args,k)))throw Error('invalid_reward_club_treasury_request');
  return rpc('service_reward_demo_copy_club_wallet',{p_user_id:userId,p_session_id:sessionId,p_action:operation.action,
   p_input:Object.fromEntries(keys.map(k=>[k,args[k]]))});
 };
}
