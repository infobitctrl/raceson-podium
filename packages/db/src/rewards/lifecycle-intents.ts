import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentArray as array, rewardDocumentUuid as uuid, rewardDocumentInteger as integer } from "./stored-documents.js";
import { decodeRewardDeploymentContext } from "./deployment-intents.js";
import { decodeRewardStoredCampaignCheckpoint } from "./campaign-checkpoints.js";

const safeErrors=new Set(["reward_operator_permission_required","invalid_reward_lifecycle_request","reward_lifecycle_intent_mismatch",
  "reward_lifecycle_deployment_not_verified","reward_lifecycle_checkpoint_changed","reward_lifecycle_prestate_mismatch","reward_lifecycle_upload_complete",
  "reward_lifecycle_review_not_finished","reward_lifecycle_package_conflict","reward_lifecycle_already_planned","reward_lifecycle_nonce_exhausted",
  "invalid_reward_lifecycle_attempt","reward_lifecycle_attempt_mismatch","reward_lifecycle_transaction_already_recorded","reward_ledger_idempotency_conflict",
  "reward_upload_reference_mismatch","reward_upload_evidence_changed","reward_review_superseded","reward_review_source_changed",
  "reward_round_has_unresolved_adjudication","reward_record_approval_mismatch","reward_record_approval_withdrawn","reward_record_approval_superseded",
  "reward_record_approval_omitted","reward_record_source_changed","reward_record_source_not_ready"]);
function demand(value:unknown):asserts value {if(!value)throw new RewardLedgerStoreError("invalid_reward_lifecycle_document");}
function key(value:unknown):string {demand(typeof value==="string" && value.length>=8 && value.length<=128);return value;}
function timestamp(value:unknown):string {parseRewardSourceTimestamp(value);return value as string;}
function hash(value:unknown,zero=false):`0x${string}` {demand(typeof value==="string" && /^0x[0-9a-f]{64}$/.test(value) && (zero||BigInt(value)!==0n));return value as `0x${string}`;}
function address(value:unknown):`0x${string}` {demand(typeof value==="string" && /^0x[0-9a-f]{40}$/.test(value) && BigInt(value)!==0n);return value as `0x${string}`;}
function nonce(value:unknown):bigint {const n=integer(value);demand(n<=BigInt(Number.MAX_SAFE_INTEGER));return n;}
function action(value:unknown):"upload_awards"|"stage_allocation"|"activate" {demand(value==="upload_awards"||value==="stage_allocation"||value==="activate");return value;}
function batch(kind:ReturnType<typeof action>,start:unknown,size:unknown) {
  if(kind!=="upload_awards"){demand(start===null && size===null);return{batchStart:null,batchSize:null};}
  demand(typeof start==="number" && Number.isSafeInteger(start) && start>=0 && typeof size==="number" && Number.isSafeInteger(size)
    && size>=1 && size<=64 && start+size<=20000);return{batchStart:start,batchSize:size};
}
function pair(value:unknown):[bigint,bigint] {const p=array(value,2,integer);demand(p.length===2);return[p[0],p[1]];}

/** Public-shaped immutable package, still a private service read. Cryptographic
 * recomputation belongs to rewards-chain in the service, not the DB package. */
export function decodeRewardLifecycleUpload(value:unknown) {
  const u=object(value,["schemaVersion","chainId","operatorAddress","treasuryAddress","sourceReviewEndsAt","programmeId","campaignId",
    "programmeManifestHash","snapshotDigest","latestPublicationAt","enabledPot","budgets","allocated","awards","uploadDigest","entitlementCount","allocationDigest","unallocated"]);
  demand(u.schemaVersion===1 && (u.chainId===10143||u.chainId===31337) && (u.enabledPot===0||u.enabledPot===1));
  const awards=array(u.awards,20000,value=>{
    const row=object(value,["entitlementId","beneficiaryId","pot","amount","explanationHash","beneficiaryKind"]);
    demand(row.pot===u.enabledPot && (row.beneficiaryKind===0||row.beneficiaryKind===1));const amount=integer(row.amount);demand(amount>0n);
    return{entitlementId:hash(row.entitlementId),beneficiaryId:hash(row.beneficiaryId),pot:row.pot as 0|1,amount,
      explanationHash:hash(row.explanationHash),beneficiaryKind:row.beneficiaryKind as 0|1};
  });
  const latestPublicationAt=integer(u.latestPublicationAt);const sourceReviewEndsAt=integer(u.sourceReviewEndsAt);const entitlementCount=integer(u.entitlementCount);
  const budgets=pair(u.budgets);const allocated=pair(u.allocated);const unallocated=integer(u.unallocated);
  demand(latestPublicationAt>0n && sourceReviewEndsAt===latestPublicationAt+259200n && entitlementCount===BigInt(awards.length)
    && budgets[u.enabledPot]>0n && budgets[1-u.enabledPot]===0n && allocated[1-u.enabledPot]===0n
    && allocated[u.enabledPot]+unallocated===budgets[u.enabledPot]);
  return{schemaVersion:1 as const,chainId:u.chainId,operatorAddress:address(u.operatorAddress),treasuryAddress:address(u.treasuryAddress),sourceReviewEndsAt,
    programmeId:hash(u.programmeId),campaignId:hash(u.campaignId),programmeManifestHash:hash(u.programmeManifestHash),snapshotDigest:hash(u.snapshotDigest),
    latestPublicationAt,enabledPot:u.enabledPot as 0|1,budgets,allocated,awards,uploadDigest:hash(u.uploadDigest,true),entitlementCount,allocationDigest:hash(u.allocationDigest),unallocated};
}
type Scope={campaignId:string;actorUserId:string;uploadId:string;intentId?:string;idempotencyKey?:string};
function refs(input:Scope){const scope={campaignId:uuid(input.campaignId),actorUserId:uuid(input.actorUserId),uploadId:uuid(input.uploadId),
  intentId:input.intentId===undefined?null:uuid(input.intentId),idempotencyKey:input.idempotencyKey===undefined?null:key(input.idempotencyKey)};
  demand(scope.intentId===null||scope.idempotencyKey===null);return scope;}
function decodeContext(value:unknown,scope:ReturnType<typeof refs>) {
  const raw=object(value,["deploymentContext","checkpoint","upload","intent"]);
  const d=decodeRewardDeploymentContext(raw.deploymentContext,{...scope,intentId:null});
  const c=raw.checkpoint===null?null:decodeRewardStoredCampaignCheckpoint(raw.checkpoint,{...scope,idempotencyKey:null});
  const u=object(raw.upload,["id","allocationId","preparedByUserId","preparedAt","body"]);const body=decodeRewardLifecycleUpload(u.body);
  demand(u.id===scope.uploadId && u.preparedByUserId===scope.actorUserId && body.chainId===d.chainId && body.operatorAddress===d.operatorAddress
    && body.treasuryAddress===d.treasuryAddress && body.programmeId===d.programmeOnChainId && body.campaignId===d.campaignOnChainId
    && body.programmeManifestHash===d.manifestHash && body.enabledPot===(d.pot==="race"?0:1) && body.budgets[body.enabledPot]===d.budgetWei);
  if(c)demand(d.intent && c.intentId===d.intent.id && c.deployment.chainId===d.chainId && c.deployment.deploymentNonce===d.intent.nonce
    && c.deployment.buildId===d.intent.buildId && c.deployment.creationCodeHash===d.intent.creationCodeHash);
  let intent=null;
  if(raw.intent!==null){
    const i=object(raw.intent,["id","observationId","nonce","action","batchStart","batchSize","createdByUserId","createdAt","idempotencyKey"]);
    const kind=action(i.action);const b=batch(kind,i.batchStart,i.batchSize);const n=nonce(i.nonce);
    demand(c && d.intent && i.observationId===c.observationId && i.createdByUserId===scope.actorUserId && n>d.intent.nonce
      && (b.batchStart===null||b.batchStart+b.batchSize<=body.awards.length));
    intent={id:uuid(i.id),observationId:uuid(i.observationId),nonce:n,action:kind,...b,createdByUserId:scope.actorUserId,
      createdAt:timestamp(i.createdAt),idempotencyKey:key(i.idempotencyKey)};
  }
  demand((scope.intentId===null||scope.intentId===intent?.id) && (!intent||scope.idempotencyKey===null||scope.idempotencyKey===intent.idempotencyKey));
  return{deploymentContext:d,checkpoint:c,upload:{id:scope.uploadId,allocationId:uuid(u.allocationId),preparedByUserId:scope.actorUserId,preparedAt:timestamp(u.preparedAt),body},intent};
}
export type RewardLifecycleContext=ReturnType<typeof decodeContext>;
export { decodeContext as decodeRewardLifecycleContext };
async function call(name:Parameters<RewardLedgerRpc>[0],args:Record<string,unknown>,rpc?:RewardLedgerRpc){
  let result:{data:unknown;error:unknown};try{result=await(rpc??((method,params)=>createAdminSupabaseClient().rpc(method,params)))(name,args);}
  catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(result.error){const message=typeof result.error==="object"?(result.error as Record<string,unknown>).message:null;
    throw new RewardLedgerStoreError(typeof message==="string"&&safeErrors.has(message)?message:"reward_ledger_store_failed");}return result.data;
}
export async function readRewardLifecycleContext(input:Scope,rpc?:RewardLedgerRpc){const scope=refs(input);
  return decodeContext(await call("service_read_reward_lifecycle_context",{p_campaign_id:scope.campaignId,p_actor_user_id:scope.actorUserId,
    p_upload_id:scope.uploadId,p_intent_id:scope.intentId,p_idempotency_key:scope.idempotencyKey},rpc),scope);}

/** SQL derives the next slice (up to 64); callers cannot pick rows or amounts. */
export async function reserveRewardLifecycleIntent(input:Omit<Scope,"intentId">&{idempotencyKey:string;action:ReturnType<typeof action>;
  observationId:string;observedChainId:number;pendingNonce:bigint},rpc?:RewardLedgerRpc){
  const scope=refs(input);const kind=action(input.action);const observationId=uuid(input.observationId);const chainId=input.observedChainId;
  demand((chainId===10143||chainId===31337)&&typeof input.pendingNonce==="bigint");const pendingNonce=nonce(input.pendingNonce.toString());
  const c=decodeContext(await call("service_reserve_reward_lifecycle",{p_campaign_id:scope.campaignId,p_actor_user_id:scope.actorUserId,
    p_upload_id:scope.uploadId,p_action:kind,p_idempotency_key:scope.idempotencyKey,p_observation_id:observationId,p_observed_chain_id:chainId,p_pending_nonce:pendingNonce.toString()},rpc),scope);
  demand(c.deploymentContext.chainId===chainId && c.intent?.action===kind && c.intent.idempotencyKey===scope.idempotencyKey);return c;
}
function decodeAttempt(value:unknown){
  const a=object(value,["schemaVersion","action","chainId","operatorAddress","nonce","contractAddress","transactionHash","signedTransaction","buildId",
    "calldataHash","allocationDigest","batchStart","batchSize","value","gasLimit","maxFeePerGas","maxPriorityFeePerGas"]);
  demand(a.schemaVersion===1 && (a.chainId===10143||a.chainId===31337) && typeof a.buildId==="string" && a.buildId.length>0 && a.buildId.length<=100
    && typeof a.signedTransaction==="string" && /^0x02(?:[0-9a-f]{2}){1,16384}$/.test(a.signedTransaction));
  const kind=action(a.action);const valueWei=integer(a.value);const gasLimit=integer(a.gasLimit);const maxFeePerGas=integer(a.maxFeePerGas);
  const maxPriorityFeePerGas=integer(a.maxPriorityFeePerGas);demand(valueWei===0n && gasLimit>0n && maxFeePerGas>0n && maxPriorityFeePerGas<=maxFeePerGas);
  return{schemaVersion:1 as const,action:kind,chainId:a.chainId,operatorAddress:address(a.operatorAddress),nonce:nonce(a.nonce),contractAddress:address(a.contractAddress),
    transactionHash:hash(a.transactionHash),signedTransaction:a.signedTransaction as `0x02${string}`,buildId:a.buildId,calldataHash:hash(a.calldataHash),
    allocationDigest:hash(a.allocationDigest),...batch(kind,a.batchStart,a.batchSize),value:valueWei,gasLimit,maxFeePerGas,maxPriorityFeePerGas};
}
export async function storeRewardLifecycleAttempt(input:Omit<Scope,"idempotencyKey">&{intentId:string;idempotencyKey:string;attempt:unknown},rpc?:RewardLedgerRpc){
  const scope=refs({...input,idempotencyKey:undefined});const idempotencyKey=key(input.idempotencyKey);const body=copy(input.attempt);const checked=decodeAttempt(body);
  const a=object(await call("service_record_reward_lifecycle_attempt",{p_campaign_id:scope.campaignId,p_actor_user_id:scope.actorUserId,p_upload_id:scope.uploadId,
    p_intent_id:scope.intentId,p_idempotency_key:idempotencyKey,p_attempt:body},rpc),["attemptId","intentId","campaignId","recordedByUserId","recordedAt","transactionHash"]);
  demand(a.intentId===scope.intentId && a.campaignId===scope.campaignId && a.recordedByUserId===scope.actorUserId && a.transactionHash===checked.transactionHash);
  return{attemptId:uuid(a.attemptId),intentId:uuid(a.intentId),campaignId:scope.campaignId,recordedByUserId:scope.actorUserId,
    recordedAt:timestamp(a.recordedAt),transactionHash:hash(a.transactionHash)};
}
/** PRIVATE broadcast bytes, not keys. Service must revalidate crypto on load. */
export async function readRewardLifecycleAttempt(input:Omit<Scope,"idempotencyKey">&{intentId:string;attemptId:string},rpc?:RewardLedgerRpc){
  const scope=refs(input);const attemptId=uuid(input.attemptId);
  const raw=object(await call("service_read_reward_lifecycle_attempt",{p_campaign_id:scope.campaignId,p_actor_user_id:scope.actorUserId,p_upload_id:scope.uploadId,
    p_intent_id:scope.intentId,p_attempt_id:attemptId},rpc),["context","attempt"]);
  const context=decodeContext(raw.context,scope);const a=object(raw.attempt,["id","intentId","body","recordedByUserId","recordedAt","idempotencyKey"]);
  demand(a.id===attemptId && a.intentId===scope.intentId && a.recordedByUserId===scope.actorUserId);
  const body=decodeAttempt(a.body);const i=context.intent;const d=context.deploymentContext;
  demand(i && context.checkpoint && body.chainId===d.chainId && body.operatorAddress===d.operatorAddress && body.nonce===i.nonce
    && body.contractAddress===context.checkpoint.deployment.contractAddress && body.buildId===context.checkpoint.deployment.buildId
    && body.action===i.action && body.batchStart===i.batchStart && body.batchSize===i.batchSize && body.allocationDigest===context.upload.body.allocationDigest);
  return{context,attempt:{id:attemptId,intentId:uuid(a.intentId),body,recordedByUserId:scope.actorUserId,recordedAt:timestamp(a.recordedAt),idempotencyKey:key(a.idempotencyKey)}};
}
