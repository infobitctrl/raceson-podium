import { randomUUID } from "node:crypto";
import type { RewardOperatorAccount } from "./operator-account.js";
import { requireReward } from "@raceson/domain/rewards";
import { readRewardLifecycleContext,reserveRewardLifecycleIntent,readRewardLifecycleAttempt,storeRewardLifecycleAttempt,checkRewardUploadEvidence,
  rewardDocumentUuid as uuid,type RewardLifecycleContext,type RewardLedgerRpc } from "@raceson/db/rewards";
import { canonicalRewardJson,normalizeRewardLifecyclePlan,requireRewardLifecyclePrestate,verifySignedRewardLifecycle,readRewardPendingNonce,rewardCampaignBuild,
  type RewardLifecyclePlan,type RewardCampaignReader,type RewardNonceReader } from "@raceson/rewards-chain";
import { observeVerifiedRewardCampaign } from "./campaign-checkpoint-service.js";

type Action=RewardLifecyclePlan["action"];
const key=(value:unknown)=>{requireReward(typeof value==="string" && value.length>=8 && value.length<=128,"invalid_reward_lifecycle_request");return value;};
function plan(context:RewardLifecycleContext,kind:Action,preview=false):RewardLifecyclePlan {
  const d=context.deploymentContext;const c=context.checkpoint;const i=context.intent;
  requireReward(c && d.intent && (preview||i) && d.intent.buildId===rewardCampaignBuild.id && d.intent.creationCodeHash===rewardCampaignBuild.creationCodeHash,
    "reward_lifecycle_deployment_not_verified");
  const batchStart=preview?Number(c.observation.accounting.entitlementCount):i?.batchStart;
  const batchSize=preview?Math.min(64,context.upload.body.awards.length-(batchStart??0)):i?.batchSize;
  requireReward(preview||i?.action===kind,"reward_lifecycle_intent_mismatch");
  const base={deployment:{context:{environment:d.environment==="local_simulation"?"local-simulation" as const:"monad-testnet" as const,
    chainId:d.chainId,verifyingContract:c.deployment.contractAddress},operatorAddress:d.operatorAddress,treasuryAddress:d.treasuryAddress,
    programmeId:d.programmeOnChainId,campaignId:d.campaignOnChainId,programmeManifestHash:d.manifestHash,enabledPot:d.pot==="race"?0 as const:1 as const,
    deploymentTransactionHash:c.deployment.deploymentTransactionHash,deploymentNonce:c.deployment.deploymentNonce},
    nonce:preview?d.intent.nonce+1n:i!.nonce,upload:context.upload.body};
  let result:RewardLifecyclePlan;
  if(kind==="upload_awards") {
    requireReward(typeof batchStart==="number" && typeof batchSize==="number","reward_lifecycle_intent_mismatch");
    result=normalizeRewardLifecyclePlan({...base,action:kind,batchStart,batchSize});
  }else result=normalizeRewardLifecyclePlan({...base,action:kind});
  // Original checkpoint sanity, NOT a fresh send permit on replay or signing.
  requireRewardLifecyclePrestate(result,c.observation.accounting,c.observation.finalizedBlock.timestamp);
  return result;
}

/** Private intent preparation only. No signer, wallet provider, send or HTTP.
 * Activation must pass fresh chain AND DB clocks before reserving a nonce.
 * A retry returns the original action/package/nonce, even after chain advances. */
export async function prepareRewardLifecycle(session:RewardOperatorAccount,input:{campaignId:string;uploadId:string;action:Action;idempotencyKey:string},
  dependencies:{rpc?:RewardLedgerRpc;reader:RewardCampaignReader & RewardNonceReader;creationCode:`0x${string}`}) {
  const actorUserId=uuid(session.account.userId);const campaignId=uuid(input.campaignId);const uploadId=uuid(input.uploadId);
  const idempotencyKey=key(input.idempotencyKey);const kind=input.action;
  requireReward(kind==="upload_awards"||kind==="stage_allocation"||kind==="activate","invalid_reward_lifecycle_request");
  const {rpc,reader,creationCode}=dependencies;const scope={campaignId,actorUserId,uploadId,idempotencyKey};
  const fixedSession={...session,account:{...session.account,userId:actorUserId}};
  let context=await readRewardLifecycleContext(scope,rpc);let reused=context.intent!==null;
  if(context.intent) requireReward(context.intent.action===kind,"reward_ledger_idempotency_conflict");
  else {
    requireReward(context.checkpoint && context.deploymentContext.intent,"reward_lifecycle_deployment_not_verified");
    const fresh=await observeVerifiedRewardCampaign(fixedSession,{campaignId,intentId:context.checkpoint.intentId,attemptId:context.checkpoint.attemptId,
      idempotencyKey:`lifecycle-prepare:${randomUUID()}`},{rpc,reader,creationCode});
    // Use precisely this observation. SQL rejects it if another writer advances it.
    context={...context,checkpoint:fresh.checkpoint};plan(context,kind,true);
    const evidence=await checkRewardUploadEvidence({campaignId,actorUserId,uploadId},rpc);
    requireReward(evidence.allocationId===context.upload.allocationId && evidence.sourceReviewEndsAt===context.upload.body.sourceReviewEndsAt,
      "reward_upload_evidence_changed");
    if(kind==="activate") requireReward(BigInt(Math.floor(Date.parse(evidence.checkedAt)/1000))>=evidence.sourceReviewEndsAt,"reward_lifecycle_review_not_finished");
    const d=context.deploymentContext;
    const pendingNonce=await readRewardPendingNonce(reader,{environment:d.environment==="local_simulation"?"local-simulation":"monad-testnet",chainId:d.chainId},d.operatorAddress);
    context=await reserveRewardLifecycleIntent({...scope,action:kind,observationId:fresh.checkpoint.observationId,observedChainId:d.chainId,pendingNonce},rpc);
    reused=context.intent?.observationId!==fresh.checkpoint.observationId;
  }
  requireReward(context.intent,"reward_lifecycle_intent_mismatch");
  return{campaignId,uploadId,intentId:context.intent.id,observationId:context.intent.observationId,plan:plan(context,kind),reused};
}

export async function recordSignedRewardLifecycle(session:RewardOperatorAccount,input:{campaignId:string;uploadId:string;intentId:string;idempotencyKey:string;signedTransaction:`0x${string}`},rpc?:RewardLedgerRpc){
  const actorUserId=uuid(session.account.userId);const campaignId=uuid(input.campaignId);const uploadId=uuid(input.uploadId);const intentId=uuid(input.intentId);
  const idempotencyKey=key(input.idempotencyKey);const signedTransaction=input.signedTransaction;
  const scope={campaignId,actorUserId,uploadId,intentId};const context=await readRewardLifecycleContext(scope,rpc);
  requireReward(context.intent,"reward_lifecycle_intent_mismatch");
  const verified=await verifySignedRewardLifecycle(plan(context,context.intent.action),signedTransaction);
  return storeRewardLifecycleAttempt({...scope,idempotencyKey,attempt:verified},rpc);
}

/** Private signed payloads are revalidated, never trusted from SQL alone.
 * This does NOT acquire a lease, check current evidence or authorize execution. */
export async function loadVerifiedRewardLifecycleAttempt(session:RewardOperatorAccount,input:{campaignId:string;uploadId:string;intentId:string;attemptId:string},rpc?:RewardLedgerRpc){
  const actorUserId=uuid(session.account.userId);const campaignId=uuid(input.campaignId);const uploadId=uuid(input.uploadId);
  const intentId=uuid(input.intentId);const attemptId=uuid(input.attemptId);
  const loaded=await readRewardLifecycleAttempt({campaignId,actorUserId,uploadId,intentId,attemptId},rpc);
  requireReward(loaded.context.intent,"reward_lifecycle_intent_mismatch");const checkedPlan=plan(loaded.context,loaded.context.intent.action);
  const verified=await verifySignedRewardLifecycle(checkedPlan,loaded.attempt.body.signedTransaction);
  requireReward(canonicalRewardJson(verified)===canonicalRewardJson(loaded.attempt.body),"reward_stored_lifecycle_attempt_mismatch");
  return{campaignId,uploadId,intentId,attemptId,plan:checkedPlan,verified};
}
