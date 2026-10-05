import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentInteger as integer } from "./stored-documents.js";
import { decodeRewardDeploymentContext } from "./deployment-intents.js";
import { decodeRewardStoredCampaignCheckpoint } from "./campaign-checkpoints.js";

const safeErrors = new Set(["reward_operator_permission_required","invalid_reward_funding_request","reward_funding_intent_mismatch",
  "reward_funding_already_planned","reward_funding_deployment_not_verified","reward_funding_checkpoint_changed","reward_campaign_not_fundable",
  "reward_funding_nonce_exhausted","invalid_reward_funding_attempt","reward_ledger_idempotency_conflict",
  "reward_funding_transaction_already_recorded","reward_funding_attempt_mismatch"]);
function demand(value: unknown): asserts value { if (!value) throw new RewardLedgerStoreError("invalid_reward_funding_document"); }
function key(value: unknown): string { demand(typeof value === "string" && value.length >= 8 && value.length <= 128); return value; }
function timestamp(value: unknown): string { parseRewardSourceTimestamp(value); return value as string; }
function hash(value: unknown): `0x${string}` { demand(typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value) !== 0n); return value as `0x${string}`; }
function address(value: unknown): `0x${string}` { demand(typeof value === "string" && /^0x[0-9a-f]{40}$/.test(value) && BigInt(value) !== 0n); return value as `0x${string}`; }
function nonce(value: unknown): bigint { const parsed = integer(value); demand(parsed <= BigInt(Number.MAX_SAFE_INTEGER)); return parsed; }
type Scope = { campaignId: string; actorUserId: string; intentId?: string };
const refs = (input: Scope) => ({ campaignId: uuid(input.campaignId), actorUserId: uuid(input.actorUserId), intentId: input.intentId === undefined ? null : uuid(input.intentId) });

function decodeContext(value: unknown, scope: ReturnType<typeof refs>) {
  const raw = object(value,["deploymentContext","checkpoint","intent"]);
  const deploymentContext = decodeRewardDeploymentContext(raw.deploymentContext,{...scope,intentId:null});
  const checkpoint = raw.checkpoint === null ? null : decodeRewardStoredCampaignCheckpoint(raw.checkpoint,{...scope,idempotencyKey:null});
  if (checkpoint) {
    demand(deploymentContext.intent && checkpoint.intentId === deploymentContext.intent.id && checkpoint.deployment.chainId === deploymentContext.chainId
      && checkpoint.deployment.deploymentNonce === deploymentContext.intent.nonce && checkpoint.deployment.buildId === deploymentContext.intent.buildId
      && checkpoint.deployment.creationCodeHash === deploymentContext.intent.creationCodeHash);
  }
  let intent = null;
  if (raw.intent !== null) {
    const row = object(raw.intent,["id","observationId","nonce","expectedAccountedFunding","expectedBudget","createdByUserId","createdAt","idempotencyKey"]);
    const expectedAccountedFunding = integer(row.expectedAccountedFunding); const expectedBudget = integer(row.expectedBudget); const checkedNonce = nonce(row.nonce);
    demand(row.createdByUserId === scope.actorUserId && expectedBudget > 0n && expectedAccountedFunding <= expectedBudget
      && expectedBudget === deploymentContext.budgetWei && checkpoint && deploymentContext.intent
      && checkedNonce > deploymentContext.intent.nonce && row.observationId === checkpoint.observationId
      && checkpoint.observation.accounting.state === 0 && checkpoint.observation.accounting.accountedFunding === expectedAccountedFunding);
    intent = { id: uuid(row.id), observationId: uuid(row.observationId), nonce: checkedNonce, expectedAccountedFunding, expectedBudget,
      createdByUserId: scope.actorUserId, createdAt: timestamp(row.createdAt), idempotencyKey: key(row.idempotencyKey) };
  }
  demand(scope.intentId === null || intent?.id === scope.intentId);
  return { deploymentContext, checkpoint, intent };
}
export type RewardFundingContext = ReturnType<typeof decodeContext>;
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string,unknown>, rpc?: RewardLedgerRpc) {
  let result: { data:unknown; error:unknown };
  try { result = await (rpc ?? ((method,parameters)=>createAdminSupabaseClient().rpc(method,parameters)))(name,args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if(result.error) {
    const message = typeof result.error === "object" ? (result.error as Record<string,unknown>).message : null;
    throw new RewardLedgerStoreError(typeof message === "string" && safeErrors.has(message) ? message : "reward_ledger_store_failed");
  }
  return result.data;
}

/** With an intent, its original checkpoint is returned: history, not freshness. */
export async function readRewardFundingContext(input: Scope, rpc?: RewardLedgerRpc) {
  const scope = refs(input);
  return decodeContext(await call("service_read_reward_funding_context",{p_campaign_id:scope.campaignId,p_actor_user_id:scope.actorUserId,p_intent_id:scope.intentId},rpc),scope);
}
/** The shared nonce book covers every programme and both deployment/funding.
 * Budget and explicit pre-state come from SQL, never request-supplied amounts. */
export async function reserveRewardFundingIntent(input: Scope & { idempotencyKey:string; observationId:string; observedChainId:number; pendingNonce:bigint },rpc?:RewardLedgerRpc) {
  const scope = refs(input); const idempotencyKey = key(input.idempotencyKey); const observationId = uuid(input.observationId);
  const observedChainId = input.observedChainId; demand((observedChainId === 10143 || observedChainId === 31337) && typeof input.pendingNonce === "bigint");
  const pendingNonce = nonce(input.pendingNonce.toString());
  const context = decodeContext(await call("service_reserve_reward_funding",{p_campaign_id:scope.campaignId,p_actor_user_id:scope.actorUserId,
    p_idempotency_key:idempotencyKey,p_observation_id:observationId,p_observed_chain_id:observedChainId,p_pending_nonce:pendingNonce.toString()},rpc),scope);
  demand(context.deploymentContext.chainId === observedChainId && context.intent?.idempotencyKey === idempotencyKey);
  return context;
}

function decodeAttempt(value: unknown) {
  const raw = object(value,["schemaVersion","action","chainId","operatorAddress","nonce","contractAddress","transactionHash","signedTransaction","buildId",
    "calldataHash","expectedAccountedFunding","expectedBudget","value","gasLimit","maxFeePerGas","maxPriorityFeePerGas"]);
  demand(raw.schemaVersion === 1 && raw.action === "complete_funding" && (raw.chainId === 10143 || raw.chainId === 31337)
    && typeof raw.buildId === "string" && raw.buildId.length > 0 && raw.buildId.length <= 100
    && typeof raw.signedTransaction === "string" && /^0x02(?:[0-9a-f]{2}){1,1024}$/.test(raw.signedTransaction));
  const expectedAccountedFunding = integer(raw.expectedAccountedFunding); const expectedBudget = integer(raw.expectedBudget); const valueWei = integer(raw.value);
  const gasLimit = integer(raw.gasLimit); const maxFeePerGas = integer(raw.maxFeePerGas); const maxPriorityFeePerGas = integer(raw.maxPriorityFeePerGas);
  demand(expectedBudget > 0n && expectedAccountedFunding <= expectedBudget && valueWei === expectedBudget - expectedAccountedFunding
    && gasLimit > 0n && maxFeePerGas > 0n && maxPriorityFeePerGas <= maxFeePerGas);
  return { schemaVersion:1 as const, action:"complete_funding" as const, chainId:raw.chainId, operatorAddress:address(raw.operatorAddress),
    nonce:nonce(raw.nonce),contractAddress:address(raw.contractAddress),transactionHash:hash(raw.transactionHash),signedTransaction:raw.signedTransaction as `0x02${string}`,
    buildId:raw.buildId,calldataHash:hash(raw.calldataHash),expectedAccountedFunding,expectedBudget,value:valueWei,gasLimit,maxFeePerGas,maxPriorityFeePerGas };
}
export async function storeRewardFundingAttempt(input: Scope & { intentId:string; idempotencyKey:string; attempt:unknown },rpc?:RewardLedgerRpc) {
  const scope = refs(input); const idempotencyKey = key(input.idempotencyKey); const body = copy(input.attempt); const checked = decodeAttempt(body);
  const raw = object(await call("service_record_reward_funding_attempt",{p_campaign_id:scope.campaignId,p_actor_user_id:scope.actorUserId,
    p_intent_id:scope.intentId,p_idempotency_key:idempotencyKey,p_attempt:body},rpc),["attemptId","intentId","campaignId","recordedByUserId","recordedAt","transactionHash"]);
  demand(raw.intentId === scope.intentId && raw.campaignId === scope.campaignId && raw.recordedByUserId === scope.actorUserId && raw.transactionHash === checked.transactionHash);
  return {attemptId:uuid(raw.attemptId),intentId:uuid(raw.intentId),campaignId:scope.campaignId,recordedByUserId:scope.actorUserId,
    recordedAt:timestamp(raw.recordedAt),transactionHash:hash(raw.transactionHash)};
}
/** PRIVATE signed bytes: no HTTP/public projection. The service rechecks crypto. */
export async function readRewardFundingAttempt(input: Scope & { intentId:string; attemptId:string },rpc?:RewardLedgerRpc) {
  const scope = refs(input); const attemptId = uuid(input.attemptId);
  const raw = object(await call("service_read_reward_funding_attempt",{p_campaign_id:scope.campaignId,p_actor_user_id:scope.actorUserId,
    p_intent_id:scope.intentId,p_attempt_id:attemptId},rpc),["context","attempt"]);
  const context = decodeContext(raw.context,scope); const row = object(raw.attempt,["id","intentId","body","recordedByUserId","recordedAt","idempotencyKey"]);
  demand(row.id === attemptId && row.intentId === scope.intentId && row.recordedByUserId === scope.actorUserId);
  const body = decodeAttempt(row.body); const i = context.intent; const d = context.deploymentContext;
  demand(i && context.checkpoint && body.chainId === d.chainId && body.operatorAddress === d.operatorAddress && body.nonce === i.nonce
    && body.contractAddress === context.checkpoint.deployment.contractAddress && body.buildId === context.checkpoint.deployment.buildId
    && body.expectedAccountedFunding === i.expectedAccountedFunding && body.expectedBudget === i.expectedBudget);
  return {context,attempt:{id:attemptId,intentId:uuid(row.intentId),body,recordedByUserId:scope.actorUserId,
    recordedAt:timestamp(row.recordedAt),idempotencyKey:key(row.idempotencyKey)}};
}
