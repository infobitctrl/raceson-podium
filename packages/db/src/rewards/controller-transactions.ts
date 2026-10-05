import {createAdminSupabaseClient} from "../supabase.js";
import type {RewardLedgerRpc} from "./programme-ledger.js";
export async function rewardControllerTransaction(actor:{subject:string;wallet:string},action:"read"|"reserve"|"signed"|"confirm",change:{id?:string;context?:unknown;transaction?:unknown;signed?:string;hash?:string}={},rpc?:RewardLedgerRpc){
 const result=await(rpc??((n,a)=>createAdminSupabaseClient().rpc(n,a)))("service_reward_controller_transaction",{p_subject:actor.subject,p_sender:actor.wallet,p_action:action,p_id:change.id??null,p_context:change.context??null,p_transaction:change.transaction??null,p_signed:change.signed??null,p_hash:change.hash??null});
 if(result.error){const code=String((result.error as {message?:string}).message);throw Error(["controller_transaction_invalid","controller_transaction_pending"].includes(code)?code:"controller_transaction_unavailable");}return result.data;
}
