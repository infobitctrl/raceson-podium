import {decodeSponsorExecutionPlan, decodeSponsorExecutionRecord, sponsorTxHash, type SponsorExecutionPlan} from "@raceson/domain/rewards/sponsor-execution";
import {setupId} from "@raceson/domain/rewards/distribution-setup";
import {createAdminSupabaseClient} from "../supabase.js";
import {RewardLedgerStoreError, type RewardLedgerRpc} from "./programme-ledger.js";
import type {RewardAccountIdentity} from "./athlete-wallets.js";

export async function rewardSponsorExecution(identity: RewardAccountIdentity, chainId: 10143 | 31337, id: string,
  change?: {plan?: SponsorExecutionPlan; deploymentHash?: string; fundingHash?: string}, rpc?: RewardLedgerRpc) {
  if (!setupId(identity.userId) || !setupId(identity.sessionId) || !setupId(id) || ![10143, 31337].includes(chainId)
    || change?.deploymentHash && !sponsorTxHash(change.deploymentHash) || change?.fundingHash && !sponsorTxHash(change.fundingHash)) throw Error("invalid_sponsor_execution");
  const plan = change?.plan ? decodeSponsorExecutionPlan(change.plan) : null;
  if (plan && plan.chainId !== chainId) throw Error("invalid_sponsor_execution");
  const result = await (rpc ?? ((name, args) => createAdminSupabaseClient().rpc(name, args)))("service_reward_sponsor_execution", {
    p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: chainId, p_setup_id: id,
    p_plan: plan, p_deployment_hash: change?.deploymentHash ?? null, p_funding_hash: change?.fundingHash ?? null,
  });
  if (result.error) {
    const message = (result.error as {message?: unknown}).message;
    throw new RewardLedgerStoreError(typeof message === "string" && ["reward_account_session_required", "reward_setup_not_found", "reward_setup_conflict", "invalid_sponsor_execution"].includes(message) ? message : "reward_ledger_unavailable");
  }
  const record = decodeSponsorExecutionRecord(result.data);
  if (record && record.plan.chainId !== chainId || plan && JSON.stringify(record?.plan) !== JSON.stringify(plan)
    || change?.deploymentHash && record?.deploymentHash !== change.deploymentHash || change?.fundingHash && record?.fundingHash !== change.fundingHash) throw Error("invalid_sponsor_execution");
  return record;
}

/** Private fixed-transaction journal; signed bytes must never enter browser views. */
export async function rewardSponsorCreation(identity: RewardAccountIdentity, id: string,
 change: {action?: "read"|"reserve"|"signed"|"confirm"; leaseId?: string; sender?: string;
 transaction?: Record<string,string|number>; signedTransaction?: string; hash?: string} = {}, rpc?: RewardLedgerRpc): Promise<unknown> {
 if (![identity.userId,identity.sessionId,id].every(setupId)) throw Error("invalid_sponsor_creation");
 const result=await (rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))("service_reward_sponsor_auto_deployment",{
  p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_setup_id:id,p_action:change.action??"read",
  p_lease_id:change.leaseId??null,p_sender:change.sender??null,p_transaction:change.transaction??null,
  p_signed_transaction:change.signedTransaction??null,p_transaction_hash:change.hash??null,
 });
 if(result.error){const message=(result.error as {message?:string}).message;throw Error(message&&["reward_account_session_required","reward_setup_not_found","sponsor_creation_capacity","sponsor_creation_busy","sponsor_creation_lease","invalid_sponsor_creation"].includes(message)?message:"sponsor_creation_storage_unavailable");}
 return result.data;
}

/** Owner-checked availability only; never exposes or mutates controller jobs. */
export async function rewardSponsorCreationAvailable(identity:RewardAccountIdentity,id:string,sender:string,rpc?:RewardLedgerRpc):Promise<boolean>{
 if(![identity.userId,identity.sessionId,id].every(setupId)||!/^0x[0-9a-f]{40}$/.test(sender)||/^0x0{40}$/.test(sender))throw Error("invalid_sponsor_creation");
 const result=await(rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))("service_reward_sponsor_creation_available",{
  p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_setup_id:id,p_sender:sender,
 });
 if(result.error){const code=(result.error as {message?:string}).message;throw Error(code&&["reward_account_session_required","reward_setup_not_found","invalid_sponsor_creation"].includes(code)?code:"sponsor_creation_storage_unavailable");}
 if(typeof result.data!=="boolean")throw Error("sponsor_creation_storage_unavailable");
 return result.data;
}
