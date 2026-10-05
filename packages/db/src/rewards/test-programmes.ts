import { decodeSavedTestProgramme, decodeTestProgrammeConfiguration, testProgrammeId } from "@raceson/domain/rewards/test-programme";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

export async function rewardTestProgrammes(identity:RewardAccountIdentity,chainId:10143|31337,id:string|null,
  change?:{requestId:string;expectedRevision:number;configuration:unknown},rpc?:RewardLedgerRpc) {
  if(!testProgrammeId(identity.userId)||!testProgrammeId(identity.sessionId)||![10143,31337].includes(chainId)
    || id!==null&&!testProgrammeId(id) || change && (!id||!testProgrammeId(change.requestId)||!Number.isInteger(change.expectedRevision)||change.expectedRevision<0||change.expectedRevision>2147483644))
    throw new Error("invalid_test_programme");
  const configuration=change?decodeTestProgrammeConfiguration(change.configuration):null;
  let result;
  try { result=await (rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))("service_reward_test_programmes",{
    p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:chainId,p_programme_id:id,
    p_request_id:change?.requestId??null,p_expected_revision:change?.expectedRevision??null,p_configuration:configuration,
  }); } catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if(result.error){const code=(result.error as {message?:unknown}).message;
    throw new RewardLedgerStoreError(typeof code==="string"&&["reward_account_session_required","reward_test_not_found","reward_test_conflict","reward_test_limit","invalid_test_programme"].includes(code)?code:"reward_ledger_unavailable");}
  if(id)return decodeSavedTestProgramme(result.data,chainId,id);
  if(!Array.isArray(result.data)||result.data.length>100)throw new Error("invalid_test_programme");
  const items=result.data.map(r=>decodeSavedTestProgramme(r,chainId));
  if(new Set(items.map(r=>r.id)).size!==items.length)throw new Error("invalid_test_programme");
  return items;
}
