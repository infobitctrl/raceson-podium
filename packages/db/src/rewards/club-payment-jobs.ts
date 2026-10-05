import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy,RewardLedgerStoreError,type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object,rewardDocumentUuid as uuid,rewardDocumentInteger as integer } from "./stored-documents.js";
import { decodeRewardCampaignDeployment,decodeRewardCampaignObservation } from "./campaign-checkpoints.js";
import { decodeRewardClubClaimWitness } from "./club-claims.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

const errors=new Set(["reward_account_session_required","reward_operator_permission_required","reward_claim_proof_scope_required","reward_payment_job_required",
  "invalid_reward_payment_job","reward_payment_attempt_required","reward_payment_job_already_queued","reward_payment_job_lease_lost","reward_payment_activation_required",
  "reward_payment_not_verified","invalid_reward_payment_confirmation","invalid_reward_payment_execution","reward_payment_nonce_conflict","reward_payment_gas_guard",
  "reward_ledger_idempotency_conflict","reward_claim_readiness_required","reward_claim_not_live","reward_claim_observation_stale","reward_claim_observation_regressed",
  "reward_claim_campaign_not_ready","invalid_reward_claim_witness","reward_payment_approvals_required","reward_review_source_changed","reward_review_superseded",
  "reward_record_source_changed","reward_record_source_not_ready","reward_record_approval_withdrawn","reward_record_approval_superseded",
  "reward_mapping_source_not_ready","reward_club_review_identity_changed","reward_club_execution_changed_since_review",
  "reward_campaign_checkpoint_conflict","reward_campaign_checkpoint_regressed","reward_verified_deployment_conflict","invalid_reward_campaign_checkpoint"]);
function demand(v:unknown):asserts v{if(!v)throw new RewardLedgerStoreError("invalid_reward_payment_job");}
const key=(v:unknown)=>{demand(typeof v==="string"&&v.length>=8&&v.length<=128);return v;};
const timestamp=(v:unknown)=>{parseRewardSourceTimestamp(v);return v as string;};
const nullableUuid=(v:unknown)=>v===null?null:uuid(v);
const actor=(i:RewardAccountIdentity)=>({p_actor_user_id:uuid(i.userId),p_actor_session_id:uuid(i.sessionId)});
const hash=(v:unknown):v is `0x${string}`=>typeof v==="string"&&/^0x[0-9a-f]{64}$/.test(v)&&BigInt(v)>0n;
function decode(value:unknown,userId:string){
  const j=object(value,["jobId","campaignId","uploadId","entitlementId","claimIntentId","paymentIntentId","attemptId","transactionHash","activationJobId",
    "createdByUserId","createdSessionId","createdAt","idempotencyKey","state","mayHaveBroadcast","leaseOwner","leaseToken","leaseExpiresAt","leaseGeneration","confirmationObservationId"]);
  demand(j.createdByUserId===userId&&hash(j.transactionHash)&&typeof j.state==="string"&&["queued","leased","broadcasting","submitted","confirmed"].includes(j.state)
    &&typeof j.mayHaveBroadcast==="boolean"&&typeof j.leaseGeneration==="number"&&Number.isSafeInteger(j.leaseGeneration)&&j.leaseGeneration>=0);
  const leaseOwner=nullableUuid(j.leaseOwner);const leaseToken=nullableUuid(j.leaseToken);const leaseExpiresAt=j.leaseExpiresAt===null?null:timestamp(j.leaseExpiresAt);
  const confirmationObservationId=nullableUuid(j.confirmationObservationId);
  demand((leaseOwner===null)===(leaseToken===null)&&(leaseOwner===null)===(leaseExpiresAt===null)
    &&(j.state==="confirmed")===(confirmationObservationId!==null)&&(j.state!=="confirmed"||leaseOwner===null)
    &&(!["broadcasting","submitted","confirmed"].includes(j.state)||j.mayHaveBroadcast)
    &&(j.state!=="queued"||(leaseOwner===null&&j.leaseGeneration===0&&!j.mayHaveBroadcast))
    &&(!["leased","broadcasting","submitted"].includes(j.state)||(leaseOwner!==null&&j.leaseGeneration>0)));
  return{jobId:uuid(j.jobId),campaignId:uuid(j.campaignId),uploadId:uuid(j.uploadId),entitlementId:uuid(j.entitlementId),claimIntentId:uuid(j.claimIntentId),
    paymentIntentId:uuid(j.paymentIntentId),attemptId:uuid(j.attemptId),transactionHash:j.transactionHash,activationJobId:uuid(j.activationJobId),
    createdByUserId:userId,createdSessionId:uuid(j.createdSessionId),createdAt:timestamp(j.createdAt),idempotencyKey:key(j.idempotencyKey),
    state:j.state,mayHaveBroadcast:j.mayHaveBroadcast,leaseOwner,leaseToken,leaseExpiresAt,leaseGeneration:j.leaseGeneration,confirmationObservationId};
}
export type RewardClubPaymentJob=ReturnType<typeof decode>;
async function call(name:Parameters<RewardLedgerRpc>[0],args:Record<string,unknown>,rpc?:RewardLedgerRpc){
  let r:{data:unknown;error:unknown};try{r=await(rpc??((n,a)=>createAdminSupabaseClient().rpc(n,a)))(name,args);}catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(r.error){const code=typeof r.error==="object"?(r.error as Record<string,unknown>).message:null;throw new RewardLedgerStoreError(typeof code==="string"&&errors.has(code)?code:"reward_ledger_store_failed");}return r.data;
}
export async function readRewardClubPaymentJob(identity:RewardAccountIdentity,input:{jobId?:string;paymentIntentId?:string},rpc?:RewardLedgerRpc){
  const a=actor(identity);const jobId=input.jobId===undefined?null:uuid(input.jobId);const paymentIntentId=input.paymentIntentId===undefined?null:uuid(input.paymentIntentId);
  demand((jobId===null)!==(paymentIntentId===null));
  const raw=await call("service_read_reward_club_payment_job",{...a,p_job_id:jobId,p_payment_intent_id:paymentIntentId},rpc);
  if(raw===null){demand(paymentIntentId!==null);return null;}const j=decode(raw,a.p_actor_user_id);
  demand((jobId===null||j.jobId===jobId)&&(paymentIntentId===null||j.paymentIntentId===paymentIntentId));return j;
}
export async function queueRewardClubPaymentJob(identity:RewardAccountIdentity,input:{claimIntentId:string;paymentIntentId:string;attemptId:string;
  idempotencyKey:string;witness:unknown;observedAt:string},rpc?:RewardLedgerRpc){
  const a=actor(identity);const claimIntentId=uuid(input.claimIntentId);const paymentIntentId=uuid(input.paymentIntentId);const attemptId=uuid(input.attemptId);
  const idempotencyKey=key(input.idempotencyKey);const witness=copy(input.witness);decodeRewardClubClaimWitness(witness);const observedAt=timestamp(input.observedAt);
  const j=decode(await call("service_queue_reward_club_payment_job",{...a,p_claim_intent_id:claimIntentId,p_payment_intent_id:paymentIntentId,p_attempt_id:attemptId,
    p_idempotency_key:idempotencyKey,p_witness:witness,p_observed_at:observedAt},rpc),a.p_actor_user_id);
  demand(j.claimIntentId===claimIntentId&&j.paymentIntentId===paymentIntentId&&j.attemptId===attemptId&&j.idempotencyKey===idempotencyKey);return j;
}
export async function stepRewardClubPaymentJob(identity:RewardAccountIdentity,input:{jobId:string;workerId:string;leaseToken:string|null;
  action:"lease"|"arm"|"submitted";execution?:unknown;observedAt?:string},rpc?:RewardLedgerRpc){
  const a=actor(identity);const jobId=uuid(input.jobId);const workerId=uuid(input.workerId);const leaseToken=nullableUuid(input.leaseToken);const action=input.action;
  demand(["lease","arm","submitted"].includes(action)&&(action!=="lease"||leaseToken===null));
  let execution=null;let observedAt=null;
  if(action==="arm"){
    execution=copy(input.execution);const x=object(execution,["schemaVersion","claimWitness","latestNonce","pendingNonce","relayerBalanceWei","estimatedGas","gasPolicy"]);
    demand(x.schemaVersion===1);decodeRewardClubClaimWitness(x.claimWitness);for(const f of ["latestNonce","pendingNonce","relayerBalanceWei","estimatedGas"])integer(x[f]);
    const p=object(x.gasPolicy,["maxGasLimit","maxFeePerGas","maxTotalFeeWei","minimumRemainingBalanceWei"]);Object.values(p).forEach(integer);observedAt=timestamp(input.observedAt);
  }else demand(input.execution===undefined&&input.observedAt===undefined);
  const raw=await call("service_step_reward_club_payment_job",{...a,p_job_id:jobId,p_worker_id:workerId,p_lease_token:leaseToken,p_action:action,p_execution:execution,p_observed_at:observedAt},rpc);
  if(raw===null){demand(action==="lease");return null;}const j=decode(raw,a.p_actor_user_id);demand(j.jobId===jobId);
  demand(j.state==="confirmed"||(j.leaseOwner===workerId&&j.leaseToken!==null&&(action==="lease"||j.leaseToken===leaseToken)));
  demand(j.state==="confirmed"||(action==="lease"?["leased","broadcasting","submitted"].includes(j.state):j.state===(action==="arm"?"broadcasting":"submitted")));return j;
}
/** Trusted verified chain proof only. SQL atomically saves receipt, paid mapping,
 * accounting and completion. This function never accepts browser evidence. */
export async function confirmRewardClubPaymentJob(identity:RewardAccountIdentity,input:{jobId:string;workerId:string;leaseToken:string;
  payment:unknown;deployment:unknown;observation:unknown},rpc?:RewardLedgerRpc){
  const a=actor(identity);const jobId=uuid(input.jobId);const workerId=uuid(input.workerId);const leaseToken=uuid(input.leaseToken);
  const payment=copy(input.payment);const deployment=copy(input.deployment);const observation=copy(input.observation);
  const d=decodeRewardCampaignDeployment(deployment);const o=decodeRewardCampaignObservation(observation);
  const p=object(payment,["schemaVersion","action","chainId","contractAddress","relayerAddress","transactionHash","nonce","blockNumber","blockHash","blockTimestamp","logIndex",
    "entitlementId","recipient","amount","pot","authorizationNonce","allocationDigest","gasLimit","gasUsed","effectiveGasPrice","monadGasLimitFee","runtimeCodeHash","finalizedBlock","safeReceivedLogIndex"]);
  demand(p.schemaVersion===1&&p.action==="pay_club"&&p.chainId===d.chainId&&p.contractAddress===d.contractAddress&&p.runtimeCodeHash===d.runtimeCodeHash
    &&hash(p.transactionHash)&&hash(p.blockHash)&&hash(p.entitlementId)&&hash(p.allocationDigest)&&(p.pot==="race"||p.pot==="league")
    &&typeof p.logIndex==="number"&&Number.isSafeInteger(p.logIndex)&&p.logIndex>=0
    &&typeof p.safeReceivedLogIndex==="number"&&Number.isSafeInteger(p.safeReceivedLogIndex)&&p.safeReceivedLogIndex===p.logIndex+1);
  for(const f of ["relayerAddress","recipient"])demand(typeof p[f]==="string"&&/^0x[0-9a-f]{40}$/.test(p[f])&&BigInt(p[f])>0n);
  const n=integer(p.nonce);const block=integer(p.blockNumber);const at=integer(p.blockTimestamp);const gas=integer(p.gasLimit);
  demand(n<=BigInt(Number.MAX_SAFE_INTEGER)&&block>=d.deploymentBlockNumber&&block<=o.finalizedBlock.number&&at>0n&&at<=o.finalizedBlock.timestamp
    &&(block!==o.finalizedBlock.number||(p.blockHash===o.finalizedBlock.hash&&at===o.finalizedBlock.timestamp))
    &&JSON.stringify(copy(p.finalizedBlock))===JSON.stringify(copy(o.finalizedBlock))&&integer(p.amount)>0n&&gas>0n&&gas<(1n<<64n)
    &&integer(p.gasUsed)<=gas&&integer(p.monadGasLimitFee)===gas*integer(p.effectiveGasPrice));integer(p.authorizationNonce);
  const j=decode(await call("service_confirm_reward_club_payment_job",{...a,p_job_id:jobId,p_worker_id:workerId,p_lease_token:leaseToken,
    p_payment:payment,p_deployment:deployment,p_observation:observation},rpc),a.p_actor_user_id);
  demand(j.jobId===jobId&&j.state==="confirmed"&&j.transactionHash===p.transactionHash);return j;
}
