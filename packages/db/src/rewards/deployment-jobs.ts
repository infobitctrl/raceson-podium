import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid } from "./stored-documents.js";

const safeErrors = new Set(["reward_operator_permission_required","reward_deployment_intent_mismatch","reward_deployment_attempt_mismatch",
  "invalid_reward_deployment_job","reward_deployment_job_already_queued","reward_deployment_job_lease_lost","reward_job_deployment_not_verified"]);
function demand(value: unknown): asserts value { if (!value) throw new RewardLedgerStoreError("invalid_reward_deployment_job"); }
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
export type RewardDeploymentJob = ReturnType<typeof decode>;
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
export async function queueRewardDeploymentJob(input:{campaignId:string;actorUserId:string;intentId:string;attemptId:string;idempotencyKey:string},rpc?:RewardLedgerRpc) {
  const campaignId=uuid(input.campaignId); const actorUserId=uuid(input.actorUserId); const intentId=uuid(input.intentId); const attemptId=uuid(input.attemptId);
  const idempotencyKey=key(input.idempotencyKey);
  const result=decode(await call("service_queue_reward_deployment_job",{p_campaign_id:campaignId,p_actor_user_id:actorUserId,p_intent_id:intentId,
    p_attempt_id:attemptId,p_idempotency_key:idempotencyKey},rpc),actorUserId);
  demand(result.campaignId===campaignId && result.intentId===intentId && result.attemptId===attemptId && result.idempotencyKey===idempotencyKey);
  return result;
}
export async function readRewardDeploymentJob(input:{jobId:string;actorUserId:string},rpc?:RewardLedgerRpc) {
  const jobId=uuid(input.jobId); const actorUserId=uuid(input.actorUserId);
  return decode(await call("service_read_reward_deployment_job",{p_job_id:jobId,p_actor_user_id:actorUserId},rpc),actorUserId,jobId);
}
/** Lease tokens are private fencing capabilities; never expose them over HTTP. */
export async function stepRewardDeploymentJob(input:{jobId:string;actorUserId:string;workerId:string;leaseToken:string|null;
  action:"lease"|"arm"|"submitted"|"confirm"},rpc?:RewardLedgerRpc) {
  const jobId=uuid(input.jobId); const actorUserId=uuid(input.actorUserId); const workerId=uuid(input.workerId); const leaseToken=nullableUuid(input.leaseToken);
  const action=input.action; demand(["lease","arm","submitted","confirm"].includes(action) && (action!=="lease" || leaseToken===null));
  const raw=await call("service_step_reward_deployment_job",{p_job_id:jobId,p_actor_user_id:actorUserId,p_worker_id:workerId,p_lease_token:leaseToken,p_action:action},rpc);
  if(raw===null){demand(action==="lease");return null;}
  const result=decode(raw,actorUserId,jobId);
  demand(result.state==="confirmed" || (result.leaseOwner===workerId && result.leaseToken!==null && (action==="lease" || result.leaseToken===leaseToken)));
  demand(result.state==="confirmed" || (action==="lease" ? ["leased","broadcasting","submitted"].includes(result.state)
    : result.state===(action==="arm"?"broadcasting":action==="submitted"?"submitted":"confirmed")));
  return result;
}
