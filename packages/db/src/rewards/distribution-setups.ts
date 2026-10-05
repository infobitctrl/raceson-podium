import { decodeSavedRewardSetup, decodeRewardSetup, setupId } from "@raceson/domain/rewards/distribution-setup";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

export async function archiveRewardSetup(identity:RewardAccountIdentity,chainId:10143|31337,id:string,expectedRevision:number,archived:boolean,rpc?:RewardLedgerRpc) {
 if(!setupId(identity.userId)||!setupId(identity.sessionId)||![10143,31337].includes(chainId)||!setupId(id)
  ||!Number.isInteger(expectedRevision)||expectedRevision<1||expectedRevision>2147483645||typeof archived!=="boolean")throw new Error("invalid_reward_setup");
 let result;
 try{result=await (rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))("service_archive_reward_setup",{
  p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:chainId,p_setup_id:id,p_expected_revision:expectedRevision,p_archived:archived,
 });}catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
 if(result.error){const code=(result.error as {message?:unknown}).message;
  throw new RewardLedgerStoreError(typeof code==="string"&&["reward_account_session_required","reward_setup_not_found","reward_setup_conflict","reward_setup_not_archivable","invalid_reward_setup"].includes(code)?code:"reward_ledger_unavailable");}
 const record=decodeSavedRewardSetup(result.data,chainId,id);
 if(record.revision!==expectedRevision||record.lifecycle?.archived!==archived)throw new Error("invalid_reward_setup");
 return record;
}

export async function deleteRewardDraft(identity:RewardAccountIdentity,chainId:10143|31337,id:string,expectedRevision:number,rpc?:RewardLedgerRpc) {
 if(!setupId(identity.userId)||!setupId(identity.sessionId)||![10143,31337].includes(chainId)||!setupId(id)
  ||!Number.isInteger(expectedRevision)||expectedRevision<1||expectedRevision>2147483645)throw new Error("invalid_reward_setup");
 let result;
 try{result=await (rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))("service_delete_reward_draft",{
  p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:chainId,p_setup_id:id,p_expected_revision:expectedRevision,
 });}catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
 if(result.error){const code=(result.error as {message?:unknown}).message;
  throw new RewardLedgerStoreError(typeof code==="string"&&["reward_account_session_required","reward_setup_not_found","reward_setup_conflict","reward_setup_not_deletable","invalid_reward_setup"].includes(code)?code:"reward_ledger_unavailable");}
 const data=result.data as {id?:unknown;deleted?:unknown}|null;
 if(!data||typeof data!=="object"||Object.keys(data).length!==2||data.id!==id||data.deleted!==true)throw new Error("invalid_reward_setup");
 return {id,deleted:true as const};
}

export async function rewardDistributionSetups(identity:RewardAccountIdentity,chainId:10143|31337,id:string|null,
  change?:{requestId:string;expectedRevision:number;configuration:unknown},rpc?:RewardLedgerRpc) {
  if(!setupId(identity.userId)||!setupId(identity.sessionId)||![10143,31337].includes(chainId)
    || id!==null&&!setupId(id) || change && (!id||!setupId(change.requestId)||!Number.isInteger(change.expectedRevision)||change.expectedRevision<0||change.expectedRevision>2147483644))
    throw new Error("invalid_reward_setup");
  const configuration=change?decodeRewardSetup(change.configuration):null;
  let result;
  try { result=await (rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))("service_reward_distribution_setups",{
    p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:chainId,p_programme_id:id,
    p_request_id:change?.requestId??null,p_expected_revision:change?.expectedRevision??null,p_configuration:configuration,
  }); } catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if(result.error){const code=(result.error as {message?:unknown}).message;
    throw new RewardLedgerStoreError(typeof code==="string"&&["reward_account_session_required","reward_setup_not_found","reward_setup_conflict","reward_setup_limit","invalid_reward_setup"].includes(code)?code:"reward_ledger_unavailable");}
  if(id)return decodeSavedRewardSetup(result.data,chainId,id);
  if(!Array.isArray(result.data)||result.data.length>100)throw new Error("invalid_reward_setup");
  const items=result.data.map(r=>decodeSavedRewardSetup(r,chainId));
  if(new Set(items.map(r=>r.id)).size!==items.length)throw new Error("invalid_reward_setup");
  return items;
}
