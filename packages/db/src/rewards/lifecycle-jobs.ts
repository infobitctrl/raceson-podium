import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy,RewardLedgerStoreError,type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object,rewardDocumentUuid as uuid,rewardDocumentInteger as integer } from "./stored-documents.js";
import { decodeRewardCampaignDeployment,decodeRewardCampaignObservation } from "./campaign-checkpoints.js";

const safeErrors=new Set(["reward_operator_permission_required","reward_lifecycle_intent_mismatch","reward_lifecycle_attempt_mismatch","invalid_reward_lifecycle_job",
  "reward_lifecycle_job_already_queued","reward_lifecycle_job_lease_lost","reward_lifecycle_not_verified","invalid_reward_lifecycle_confirmation",
  "reward_lifecycle_predecessor_not_confirmed","reward_lifecycle_predecessor_mismatch","reward_lifecycle_review_not_finished","reward_ledger_idempotency_conflict",
  "reward_campaign_checkpoint_conflict","reward_campaign_checkpoint_regressed","reward_verified_deployment_conflict","invalid_reward_campaign_checkpoint",
  "reward_upload_reference_mismatch","reward_upload_evidence_changed","reward_review_superseded","reward_review_source_changed","reward_round_has_unresolved_adjudication",
  "reward_record_approval_mismatch","reward_record_approval_withdrawn","reward_record_approval_superseded","reward_record_approval_omitted","reward_record_source_changed","reward_record_source_not_ready"]);
function demand(value:unknown):asserts value {if(!value)throw new RewardLedgerStoreError("invalid_reward_lifecycle_job");}
function key(value:unknown):string {demand(typeof value==="string" && value.length>=8 && value.length<=128);return value;}
function timestamp(value:unknown):string {parseRewardSourceTimestamp(value);return value as string;}
const nullableUuid=(value:unknown)=>value===null?null:uuid(value);
const hash=(value:unknown):value is `0x${string}`=>typeof value==="string" && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value)!==0n;
function decode(value:unknown,actorUserId:string,jobId?:string){
  const r=object(value,["jobId","campaignId","uploadId","intentId","attemptId","transactionHash","predecessorFundingJobId","predecessorLifecycleJobId",
    "createdByUserId","createdAt","idempotencyKey","state","mayHaveBroadcast","leaseOwner","leaseToken","leaseExpiresAt","leaseGeneration","confirmationObservationId"]);
  demand(r.createdByUserId===actorUserId && (jobId===undefined||r.jobId===jobId) && hash(r.transactionHash));
  demand(typeof r.state==="string" && ["queued","leased","broadcasting","submitted","confirmed"].includes(r.state)
    && typeof r.mayHaveBroadcast==="boolean" && typeof r.leaseGeneration==="number" && Number.isSafeInteger(r.leaseGeneration) && r.leaseGeneration>=0);
  const predecessorFundingJobId=nullableUuid(r.predecessorFundingJobId);const predecessorLifecycleJobId=nullableUuid(r.predecessorLifecycleJobId);
  const leaseOwner=nullableUuid(r.leaseOwner);const leaseToken=nullableUuid(r.leaseToken);const leaseExpiresAt=r.leaseExpiresAt===null?null:timestamp(r.leaseExpiresAt);
  const confirmationObservationId=nullableUuid(r.confirmationObservationId);
  demand((predecessorFundingJobId===null)!==(predecessorLifecycleJobId===null) && predecessorLifecycleJobId!==r.jobId
    && (leaseOwner===null)===(leaseToken===null) && (leaseOwner===null)===(leaseExpiresAt===null)
    && (r.state==="confirmed")===(confirmationObservationId!==null) && (r.state!=="confirmed"||leaseOwner===null)
    && (!["broadcasting","submitted","confirmed"].includes(r.state)||r.mayHaveBroadcast)
    && (r.state!=="queued"||(leaseOwner===null && r.leaseGeneration===0 && !r.mayHaveBroadcast))
    && (!["leased","broadcasting","submitted"].includes(r.state)||(leaseOwner!==null && r.leaseGeneration>0)));
  return{jobId:uuid(r.jobId),campaignId:uuid(r.campaignId),uploadId:uuid(r.uploadId),intentId:uuid(r.intentId),attemptId:uuid(r.attemptId),transactionHash:r.transactionHash,
    predecessorFundingJobId,predecessorLifecycleJobId,createdByUserId:actorUserId,createdAt:timestamp(r.createdAt),idempotencyKey:key(r.idempotencyKey),
    state:r.state,mayHaveBroadcast:r.mayHaveBroadcast,leaseOwner,leaseToken,leaseExpiresAt,leaseGeneration:r.leaseGeneration,confirmationObservationId};
}
export type RewardLifecycleJob=ReturnType<typeof decode>;
async function call(name:Parameters<RewardLedgerRpc>[0],args:Record<string,unknown>,rpc?:RewardLedgerRpc){
  let result:{data:unknown;error:unknown};try{result=await(rpc??((method,params)=>createAdminSupabaseClient().rpc(method,params)))(name,args);}
  catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(result.error){const message=typeof result.error==="object"?(result.error as Record<string,unknown>).message:null;
    throw new RewardLedgerStoreError(typeof message==="string" && safeErrors.has(message)?message:"reward_ledger_store_failed");}return result.data;
}
/** SQL derives the already-confirmed predecessor. Caller cannot choose one. */
export async function queueRewardLifecycleJob(input:{campaignId:string;actorUserId:string;uploadId:string;intentId:string;attemptId:string;idempotencyKey:string},rpc?:RewardLedgerRpc){
  const campaignId=uuid(input.campaignId);const actorUserId=uuid(input.actorUserId);const uploadId=uuid(input.uploadId);const intentId=uuid(input.intentId);
  const attemptId=uuid(input.attemptId);const idempotencyKey=key(input.idempotencyKey);
  const result=decode(await call("service_queue_reward_lifecycle_job",{p_campaign_id:campaignId,p_actor_user_id:actorUserId,p_upload_id:uploadId,
    p_intent_id:intentId,p_attempt_id:attemptId,p_idempotency_key:idempotencyKey},rpc),actorUserId);
  demand(result.campaignId===campaignId && result.uploadId===uploadId && result.intentId===intentId && result.attemptId===attemptId && result.idempotencyKey===idempotencyKey);
  return result;
}
export async function readRewardLifecycleJob(input:{jobId:string;actorUserId:string},rpc?:RewardLedgerRpc){
  const jobId=uuid(input.jobId);const actorUserId=uuid(input.actorUserId);
  return decode(await call("service_read_reward_lifecycle_job",{p_job_id:jobId,p_actor_user_id:actorUserId},rpc),actorUserId,jobId);
}
/** Private lease capability. Arm checks live source after locks; pending/mined
 * observations remain recordable after a source correction, never a new send. */
export async function stepRewardLifecycleJob(input:{jobId:string;actorUserId:string;workerId:string;leaseToken:string|null;action:"lease"|"arm"|"submitted"},rpc?:RewardLedgerRpc){
  const jobId=uuid(input.jobId);const actorUserId=uuid(input.actorUserId);const workerId=uuid(input.workerId);const leaseToken=nullableUuid(input.leaseToken);
  const action=input.action;demand(["lease","arm","submitted"].includes(action) && (action!=="lease"||leaseToken===null));
  const raw=await call("service_step_reward_lifecycle_job",{p_job_id:jobId,p_actor_user_id:actorUserId,p_worker_id:workerId,p_lease_token:leaseToken,p_action:action},rpc);
  if(raw===null){demand(action==="lease");return null;}
  const result=decode(raw,actorUserId,jobId);
  demand(result.state==="confirmed"||(result.leaseOwner===workerId && result.leaseToken!==null && (action==="lease"||result.leaseToken===leaseToken)));
  demand(result.state==="confirmed"||(action==="lease"?["leased","broadcasting","submitted"].includes(result.state):result.state===(action==="arm"?"broadcasting":"submitted")));
  return result;
}

/** Structural bounds/provenance only. SQL knows the exact package/predecessor;
 * the trusted service proves signatures, full events, canonical chain and code. */
export async function confirmRewardLifecycleJob(input:{jobId:string;actorUserId:string;workerId:string;leaseToken:string;lifecycle:unknown;deployment:unknown;observation:unknown},rpc?:RewardLedgerRpc){
  const jobId=uuid(input.jobId);const actorUserId=uuid(input.actorUserId);const workerId=uuid(input.workerId);const leaseToken=uuid(input.leaseToken);
  const lifecycle=copy(input.lifecycle);const deployment=copy(input.deployment);const observation=copy(input.observation);
  const d=decodeRewardCampaignDeployment(deployment);const o=decodeRewardCampaignObservation(observation);
  const f=object(lifecycle,["schemaVersion","action","chainId","contractAddress","operatorAddress","transactionHash","nonce","blockNumber","blockHash","blockTimestamp",
    "firstLogIndex","lastLogIndex","batchStart","batchSize","allocationDigest","activationNotBefore","claimDeadline","runtimeCodeHash","finalizedBlock"]);
  demand(f.schemaVersion===1 && ["upload_awards","stage_allocation","activate"].includes(f.action as string) && f.chainId===d.chainId && f.contractAddress===d.contractAddress
    && f.runtimeCodeHash===d.runtimeCodeHash && typeof f.operatorAddress==="string" && /^0x[0-9a-f]{40}$/.test(f.operatorAddress) && BigInt(f.operatorAddress)!==0n
    && hash(f.transactionHash) && hash(f.blockHash) && hash(f.allocationDigest) && typeof f.firstLogIndex==="number" && Number.isSafeInteger(f.firstLogIndex) && f.firstLogIndex>=0
    && typeof f.lastLogIndex==="number" && Number.isSafeInteger(f.lastLogIndex) && f.lastLogIndex>=f.firstLogIndex);
  const block=integer(f.blockNumber);const at=integer(f.blockTimestamp);const nonce=integer(f.nonce);
  demand(nonce>d.deploymentNonce && nonce<=BigInt(Number.MAX_SAFE_INTEGER) && block>=d.deploymentBlockNumber && block<=o.finalizedBlock.number
    && at<=o.finalizedBlock.timestamp && (block!==o.finalizedBlock.number||(f.blockHash===o.finalizedBlock.hash && at===o.finalizedBlock.timestamp))
    && JSON.stringify(copy(f.finalizedBlock))===JSON.stringify(copy(o.finalizedBlock)) && o.accounting.state!==0);
  if(f.action==="upload_awards"){
    demand(typeof f.batchStart==="number" && Number.isSafeInteger(f.batchStart) && f.batchStart>=0 && typeof f.batchSize==="number" && Number.isSafeInteger(f.batchSize)
      && f.batchSize>=1 && f.batchSize<=64 && f.batchStart+f.batchSize<=20000 && f.lastLogIndex-f.firstLogIndex+1===f.batchSize
      && f.activationNotBefore===null && f.claimDeadline===null && o.accounting.entitlementCount>=BigInt(f.batchStart+f.batchSize));
  }else{
    demand(f.batchStart===null && f.batchSize===null && f.firstLogIndex===f.lastLogIndex && f.allocationDigest===o.accounting.allocationDigest);
    if(f.action==="stage_allocation"){
      const activation=integer(f.activationNotBefore);
      demand(f.claimDeadline===null && activation>=at+86400n && o.accounting.activationNotBefore===activation && [2,3,4,5].includes(o.accounting.state));
    }else demand(f.activationNotBefore===null && integer(f.claimDeadline)===at+31536000n && at>=o.accounting.activationNotBefore
      && o.accounting.claimDeadline>=integer(f.claimDeadline) && [3,4].includes(o.accounting.state));
  }
  const result=decode(await call("service_confirm_reward_lifecycle_job",{p_job_id:jobId,p_actor_user_id:actorUserId,p_worker_id:workerId,p_lease_token:leaseToken,
    p_lifecycle:lifecycle,p_deployment:deployment,p_observation:observation},rpc),actorUserId,jobId);
  demand(result.state==="confirmed" && result.transactionHash===f.transactionHash);return result;
}
