import {createAdminSupabaseClient} from "../supabase.js";
import {RewardLedgerStoreError, type RewardLedgerRpc} from "./programme-ledger.js";

/** Called only after independent Privy verification in the isolated demo API. */
export async function rewardControllerFacts(actor:{subject:string;wallet:string},
  scope:{setupId?:string;approvalId?:string}, write?:{requestId:string;receipt:unknown}, rpc?:RewardLedgerRpc) {
  const r = await (rpc ?? ((name,args) => createAdminSupabaseClient().rpc(name,args)))("service_reward_controller_v4", {
    p_operator:actor.wallet,p_subject:actor.subject,p_chain_id:10143,p_setup_id:scope.setupId??null,
    p_approval_id:scope.approvalId??null,p_request_id:write?.requestId??null,p_receipt:write?.receipt??null,
  });
  if(r.error) {
    const code = String((r.error as {message?:unknown}).message);
    throw new RewardLedgerStoreError(["controller_scope_required","controller_source_not_ready","controller_receipt_invalid","controller_receipt_conflict"].includes(code)?code:"controller_store_unavailable");
  }
  return r.data;
}

/** Called only after independently verified controller authentication. */
export async function rewardControllerResultDisplay(actor:{subject:string;wallet:string},scope:{setupId:string;approvalId:string},rpc?:RewardLedgerRpc) {
 const r=await (rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))('service_reward_controller_result_display',{
  p_operator:actor.wallet,p_subject:actor.subject,p_chain_id:10143,p_setup_id:scope.setupId,p_approval_id:scope.approvalId,
 });
 if(r.error)throw new RewardLedgerStoreError('controller_source_not_ready');
 const value=r.data as {documentHash?:unknown;snapshot?:unknown};
 if(!value||typeof value.documentHash!=='string'||!/^[0-9a-f]{64}$/.test(value.documentHash))throw new RewardLedgerStoreError('controller_source_not_ready');
 return value;
}
