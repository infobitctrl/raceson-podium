import {createAdminSupabaseClient} from '../supabase.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
import type {RewardAccountIdentity} from './athlete-wallets.js';
export async function rewardWalletSettings(identity:RewardAccountIdentity,change?:{expectedRevision:number;settings:unknown;previousSettings:unknown;reason:string},rpc?:RewardLedgerRpc){
 const result=await(rpc??((n,a)=>createAdminSupabaseClient().rpc(n,a)))('service_reward_wallet_settings',{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_expected_revision:change?.expectedRevision??null,p_settings:change?.settings??null,p_reason:change?.reason??null,p_previous_settings:change?.previousSettings??null});
 if(result.error)throw Error(String((result.error as {message?:string}).message??'reward_wallet_settings_unavailable'));return result.data;
}
export async function rewardWalletRuntime(rpc?:RewardLedgerRpc){
 const result=await(rpc??((n,a)=>createAdminSupabaseClient().rpc(n,a)))('service_reward_wallet_runtime',{});
 if(result.error)throw Error('reward_wallet_settings_unavailable');return result.data;
}
