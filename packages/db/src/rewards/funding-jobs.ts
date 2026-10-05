import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentInteger as integer } from "./stored-documents.js";
import { decodeRewardCampaignDeployment, decodeRewardCampaignObservation } from "./campaign-checkpoints.js";

const safeErrors = new Set(["reward_operator_permission_required","reward_funding_intent_mismatch","reward_funding_attempt_mismatch",
  "invalid_reward_funding_job","reward_funding_job_already_queued","reward_funding_job_lease_lost","reward_funding_not_verified","invalid_reward_funding_confirmation","reward_ledger_idempotency_conflict",
  "reward_campaign_checkpoint_conflict","reward_campaign_checkpoint_regressed","reward_verified_deployment_conflict","invalid_reward_campaign_checkpoint"]);
function demand(value: unknown): asserts value { if (!value) throw new RewardLedgerStoreError("invalid_reward_funding_job"); }
function key(value: unknown): string { demand(typeof value === "string" && value.length >= 8 && value.length <= 128); return value; }
function timestamp(value: unknown): string { parseRewardSourceTimestamp(value); return value as string; }
const nullableUuid = (value: unknown) => value === null ? null : uuid(value);
function decode(value: unknown, actorUserId: string, jobId?: string) {
  const raw = object(value,["jobId","campaignId","intentId","attemptId","transactionHash","createdByUserId","createdAt","idempotencyKey",
    "state","mayHaveBroadcast","leaseOwner","leaseToken","leaseExpiresAt","leaseGeneration","confirmationObservationId"]);
  demand(raw.createdByUserId === actorUserId && (jobId === undefined || raw.jobId === jobId));
  demand(typeof raw.transactionHash === "string" && /^0x[0-9a-f]{64}$/.test(raw.transactionHash) && BigInt(raw.transactionHash) !== 0n);
  demand(typeof raw.state === "string" && ["queued","leased","broadcasting","submitted","confirmed"].includes(raw.state));
  demand(typeof raw.mayHaveBroadcast === "boolean" && typeof raw.leaseGeneration === "number" && Number.isSafeInteger(raw.leaseGeneration) && raw.leaseGeneration >= 0);
  const leaseOwner = nullableUuid(raw.leaseOwner); const leaseToken = nullableUuid(raw.leaseToken);
  const leaseExpiresAt = raw.leaseExpiresAt === null ? null : timestamp(raw.leaseExpiresAt);
  const confirmationObservationId = nullableUuid(raw.confirmationObservationId);
  demand((leaseOwner === null) === (leaseToken === null) && (leaseOwner === null) === (leaseExpiresAt === null)
    && (raw.state === "confirmed") === (confirmationObservationId !== null) && (raw.state !== "confirmed" || leaseOwner === null)
    && (!["broadcasting","submitted"].includes(raw.state) || raw.mayHaveBroadcast)
    && (raw.state!=="queued" || (leaseOwner===null && raw.leaseGeneration===0 && !raw.mayHaveBroadcast))
    && (!["leased","broadcasting","submitted"].includes(raw.state) || (leaseOwner!==null && raw.leaseGeneration>0)));
  return { jobId:uuid(raw.jobId),campaignId:uuid(raw.campaignId),intentId:uuid(raw.intentId),attemptId:uuid(raw.attemptId),
    transactionHash:raw.transactionHash as `0x${string}`,createdByUserId:actorUserId,createdAt:timestamp(raw.createdAt),idempotencyKey:key(raw.idempotencyKey),
    state:raw.state,mayHaveBroadcast:raw.mayHaveBroadcast,leaseOwner,leaseToken,leaseExpiresAt,leaseGeneration:raw.leaseGeneration,confirmationObservationId };
}
export type RewardFundingJob = ReturnType<typeof decode>;
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string,unknown>, rpc?: RewardLedgerRpc) {
  let result:{data:unknown;error:unknown};
  try { result = await (rpc ?? ((method,params) => createAdminSupabaseClient().rpc(method,params)))(name,args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = typeof result.error === "object" ? (result.error as Record<string,unknown>).message : null;
    throw new RewardLedgerStoreError(typeof message === "string" && safeErrors.has(message) ? message : "reward_ledger_store_failed");
  }
  return result.data;
}
/** Trusted service only, after exact signed-attempt validation. No bytes in jobs. */
export async function queueRewardFundingJob(input:{campaignId:string;actorUserId:string;intentId:string;attemptId:string;idempotencyKey:string},rpc?:RewardLedgerRpc) {
  const campaignId=uuid(input.campaignId); const actorUserId=uuid(input.actorUserId); const intentId=uuid(input.intentId); const attemptId=uuid(input.attemptId);
  const idempotencyKey=key(input.idempotencyKey);
  const result=decode(await call("service_queue_reward_funding_job",{p_campaign_id:campaignId,p_actor_user_id:actorUserId,p_intent_id:intentId,
    p_attempt_id:attemptId,p_idempotency_key:idempotencyKey},rpc),actorUserId);
  demand(result.campaignId===campaignId && result.intentId===intentId && result.attemptId===attemptId && result.idempotencyKey===idempotencyKey);
  return result;
}
export async function readRewardFundingJob(input:{jobId:string;actorUserId:string},rpc?:RewardLedgerRpc) {
  const jobId=uuid(input.jobId); const actorUserId=uuid(input.actorUserId);
  return decode(await call("service_read_reward_funding_job",{p_job_id:jobId,p_actor_user_id:actorUserId},rpc),actorUserId,jobId);
}
/** Lease tokens are private fencing capabilities; never expose them over HTTP. */
export async function stepRewardFundingJob(input:{jobId:string;actorUserId:string;workerId:string;leaseToken:string|null;
  action:"lease"|"arm"|"submitted"},rpc?:RewardLedgerRpc) {
  const jobId=uuid(input.jobId); const actorUserId=uuid(input.actorUserId); const workerId=uuid(input.workerId); const leaseToken=nullableUuid(input.leaseToken);
  const action=input.action; demand(["lease","arm","submitted"].includes(action) && (action!=="lease" || leaseToken===null));
  const raw=await call("service_step_reward_funding_job",{p_job_id:jobId,p_actor_user_id:actorUserId,p_worker_id:workerId,p_lease_token:leaseToken,p_action:action},rpc);
  if(raw===null){demand(action==="lease");return null;}
  const result=decode(raw,actorUserId,jobId);
  demand(result.state==="confirmed" || (result.leaseOwner===workerId && result.leaseToken!==null && (action==="lease" || result.leaseToken===leaseToken)));
  demand(result.state==="confirmed" || (action==="lease" ? ["leased","broadcasting","submitted"].includes(result.state)
    : result.state===(action==="arm"?"broadcasting":"submitted")));
  return result;
}

/** Structural receipt defence; signature/canonical-chain checks belong to the
 * trusted service. This RPC commits exact receipt + checkpoint + confirmation. */
export async function confirmRewardFundingJob(input:{jobId:string;actorUserId:string;workerId:string;leaseToken:string;
  funding:unknown;deployment:unknown;observation:unknown},rpc?:RewardLedgerRpc) {
  const jobId=uuid(input.jobId); const actorUserId=uuid(input.actorUserId); const workerId=uuid(input.workerId); const leaseToken=uuid(input.leaseToken);
  const funding=copy(input.funding); const deployment=copy(input.deployment); const observation=copy(input.observation);
  const d=decodeRewardCampaignDeployment(deployment); const o=decodeRewardCampaignObservation(observation);
  const f=object(funding,["schemaVersion","action","chainId","contractAddress","operatorAddress","transactionHash","nonce","blockNumber","blockHash",
    "fundingClosedLogIndex","depositedValue","expectedAccountedFunding","budget","enabledPot","runtimeCodeHash","finalizedBlock"]);
  const hash=(value:unknown)=>typeof value==="string" && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value)!==0n;
  demand(f.schemaVersion===1 && f.action==="complete_funding" && f.chainId===d.chainId && f.contractAddress===d.contractAddress
    && f.runtimeCodeHash===d.runtimeCodeHash && typeof f.operatorAddress==="string" && /^0x[0-9a-f]{40}$/.test(f.operatorAddress) && BigInt(f.operatorAddress)!==0n
    && hash(f.transactionHash) && hash(f.blockHash) && (f.enabledPot===0 || f.enabledPot===1)
    && typeof f.fundingClosedLogIndex==="number" && Number.isSafeInteger(f.fundingClosedLogIndex) && f.fundingClosedLogIndex>=0);
  const prior=integer(f.expectedAccountedFunding); const budget=integer(f.budget); const block=integer(f.blockNumber); const nonce=integer(f.nonce);
  demand(budget>0n && prior<=budget && integer(f.depositedValue)===budget-prior && nonce>d.deploymentNonce && nonce<=BigInt(Number.MAX_SAFE_INTEGER)
    && block>=d.deploymentBlockNumber && block<=o.finalizedBlock.number && (block!==o.finalizedBlock.number || f.blockHash===o.finalizedBlock.hash)
    && JSON.stringify(copy(f.finalizedBlock))===JSON.stringify(copy(o.finalizedBlock)) && o.accounting.state!==0
    && o.accounting.accountedFunding===budget && o.accounting.budgets[f.enabledPot]===budget);
  const result=decode(await call("service_confirm_reward_funding_job",{p_job_id:jobId,p_actor_user_id:actorUserId,p_worker_id:workerId,p_lease_token:leaseToken,
    p_funding:funding,p_deployment:deployment,p_observation:observation},rpc),actorUserId,jobId);
  demand(result.state==="confirmed" && result.transactionHash===f.transactionHash);
  return result;
}
