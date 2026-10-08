import {decodeSupportSnapshot,decodeSupportSettings,decodeReviewIssues,decodeIssueChange} from '@raceson/domain/rewards/operations';
import {setupId} from '@raceson/domain/rewards/distribution-setup';
import {createAdminSupabaseClient} from '../supabase.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
import type {RewardAccountIdentity} from './athlete-wallets.js';

async function call(name:"service_reward_support_settings"|"service_reward_review_issues"|"service_reward_demo_copy_review_issues",args:Record<string,unknown>,rpc?:RewardLedgerRpc){
 const r=await(rpc??((fn,body)=>createAdminSupabaseClient().rpc(fn,body)))(name,args);
 if(r.error)throw Error((r.error as {message?:string}).message??'reward_operations_unavailable');
 return r.data;
}
export async function rewardSupportSettings(identity:RewardAccountIdentity,change?:{expectedRevision:number;settings:unknown;reason:string;requestId:string},rpc?:RewardLedgerRpc){
 if(change&&(!Number.isSafeInteger(change.expectedRevision)||change.expectedRevision<0||!setupId(change.requestId)||change.reason.trim().length<8||change.reason.trim().length>500))throw Error('invalid_reward_support_settings');
 return decodeSupportSnapshot(await call('service_reward_support_settings',{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_change:change?{...change,settings:decodeSupportSettings(change.settings),reason:change.reason.trim()}:null},rpc));
}
export async function rewardReviewIssues(identity:RewardAccountIdentity,scope:{chainId:number;setupId:string;slot:number},change?:unknown,rpc?:RewardLedgerRpc,hosted=false){
 if(![10143,31337].includes(scope.chainId)||!setupId(scope.setupId)||!Number.isInteger(scope.slot)||scope.slot<0||scope.slot>5)throw Error('invalid_reward_review_issue');
 if(hosted&&scope.chainId!==10143)throw Error('invalid_reward_review_issue');
 return decodeReviewIssues(await call(hosted?'service_reward_demo_copy_review_issues':'service_reward_review_issues',{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:scope.chainId,p_setup_id:scope.setupId,p_slot:scope.slot,p_change:change===undefined?null:decodeIssueChange(change)},rpc));
}
