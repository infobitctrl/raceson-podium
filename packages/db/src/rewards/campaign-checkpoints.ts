import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentInteger as integer, rewardDocumentUuid as uuid, rewardDocumentObject as object, rewardDocumentArray as array } from "./stored-documents.js";

const safeErrors = new Set(["reward_operator_permission_required", "reward_deployment_intent_mismatch", "reward_deployment_attempt_mismatch",
  "invalid_reward_campaign_checkpoint", "invalid_reward_campaign_accounting", "reward_verified_deployment_conflict", "reward_ledger_idempotency_conflict",
  "reward_campaign_checkpoint_regressed", "reward_campaign_checkpoint_conflict"]);
function demand(condition: unknown): asserts condition { if (!condition) throw new RewardLedgerStoreError("invalid_reward_campaign_checkpoint"); }
const hash = (value: unknown, zero = false): `0x${string}` => {
  demand(typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value) && (zero || BigInt(value) !== 0n)); return value as `0x${string}`;
};
function key(value: unknown): string { demand(typeof value === "string" && value.length >= 8 && value.length <= 128); return value; }
type Scope = { campaignId: string; actorUserId: string; idempotencyKey?: string };
function scope(input: Scope) { return { campaignId: uuid(input.campaignId), actorUserId: uuid(input.actorUserId),
  idempotencyKey: input.idempotencyKey === undefined ? null : key(input.idempotencyKey) }; }

export function decodeRewardCampaignDeployment(value: unknown) {
  const raw = object(value, ["schemaVersion","chainId","contractAddress","buildId","creationCodeHash","runtimeCodeHash",
    "deploymentTransactionHash","deploymentNonce","deploymentBlockNumber","deploymentBlockHash"]);
  demand(raw.schemaVersion === 1 && (raw.chainId === 10143 || raw.chainId === 31337));
  demand(typeof raw.contractAddress === "string" && /^0x[0-9a-f]{40}$/.test(raw.contractAddress) && BigInt(raw.contractAddress) !== 0n);
  demand(typeof raw.buildId === "string" && raw.buildId.length > 0 && raw.buildId.length <= 100);
  const deploymentNonce = integer(raw.deploymentNonce); demand(deploymentNonce <= BigInt(Number.MAX_SAFE_INTEGER));
  return { schemaVersion: 1 as const, chainId: raw.chainId, contractAddress: raw.contractAddress as `0x${string}`, buildId: raw.buildId,
    creationCodeHash: hash(raw.creationCodeHash), runtimeCodeHash: hash(raw.runtimeCodeHash), deploymentTransactionHash: hash(raw.deploymentTransactionHash),
    deploymentNonce, deploymentBlockNumber: integer(raw.deploymentBlockNumber), deploymentBlockHash: hash(raw.deploymentBlockHash) };
}
export function decodeRewardCampaignObservation(value: unknown) {
  const raw = object(value,["schemaVersion","finalizedBlock","accounting"]); demand(raw.schemaVersion === 1);
  const f = object(raw.finalizedBlock,["number","hash","timestamp"]);
  const a = object(raw.accounting,["state","paused","accountedFunding","treasuryReturned","budgets","allocated","paid","nativeBalance","entitlementCount",
    "uploadDigest","snapshotDigest","allocationDigest","activationNotBefore","claimDeadline","pausedAt"]);
  demand(typeof a.state === "number" && Number.isInteger(a.state) && a.state >= 0 && a.state <= 5 && typeof a.paused === "boolean");
  const pair = (value: unknown): [bigint,bigint] => { const p = array(value,2,integer); demand(p.length === 2); return [p[0],p[1]]; };
  return { schemaVersion: 1 as const, finalizedBlock: { number: integer(f.number), hash: hash(f.hash), timestamp: integer(f.timestamp) },
    accounting: { state: a.state, paused: a.paused, accountedFunding: integer(a.accountedFunding), treasuryReturned: integer(a.treasuryReturned),
      budgets: pair(a.budgets), allocated: pair(a.allocated), paid: pair(a.paid), nativeBalance: integer(a.nativeBalance), entitlementCount: integer(a.entitlementCount),
      uploadDigest: hash(a.uploadDigest,true), snapshotDigest: hash(a.snapshotDigest,true), allocationDigest: hash(a.allocationDigest,true),
      activationNotBefore: integer(a.activationNotBefore), claimDeadline: integer(a.claimDeadline), pausedAt: integer(a.pausedAt) } };
}
function decode(value: unknown, expected: ReturnType<typeof scope>) {
  const raw = object(value,["campaignId","intentId","attemptId","deployment","observationId","observation","observedByUserId","observedAt","idempotencyKey"]);
  demand(raw.campaignId === expected.campaignId && raw.observedByUserId === expected.actorUserId
    && (expected.idempotencyKey === null || raw.idempotencyKey === expected.idempotencyKey));
  parseRewardSourceTimestamp(raw.observedAt);
  const deployment = decodeRewardCampaignDeployment(raw.deployment); const observation = decodeRewardCampaignObservation(raw.observation);
  demand(deployment.deploymentBlockNumber <= observation.finalizedBlock.number
    && (deployment.deploymentBlockNumber !== observation.finalizedBlock.number || deployment.deploymentBlockHash === observation.finalizedBlock.hash));
  return { campaignId: expected.campaignId, intentId: uuid(raw.intentId), attemptId: uuid(raw.attemptId), deployment, observation,
    observationId: uuid(raw.observationId), observedByUserId: expected.actorUserId, observedAt: raw.observedAt as string, idempotencyKey: key(raw.idempotencyKey) };
}
export type RewardStoredCampaignCheckpoint = ReturnType<typeof decode>;
export { decode as decodeRewardStoredCampaignCheckpoint };
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string,unknown>, rpc?: RewardLedgerRpc) {
  const transport: RewardLedgerRpc = rpc ?? ((method,params) => createAdminSupabaseClient().rpc(method,params));
  let result: { data: unknown; error: unknown };
  try { result = await transport(name,args); } catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = typeof result.error === "object" ? (result.error as Record<string,unknown>).message : null;
    throw new RewardLedgerStoreError(typeof message === "string" && safeErrors.has(message) ? message : "reward_ledger_store_failed");
  }
  return result.data;
}
/** A private historical read, never an authorization lease or fresh RPC observation. */
export async function readRewardCampaignCheckpoint(input: Scope, rpc?: RewardLedgerRpc) {
  const checked = scope(input);
  const result = await call("service_read_reward_campaign_checkpoint", { p_campaign_id: checked.campaignId, p_actor_user_id: checked.actorUserId,
    p_idempotency_key: checked.idempotencyKey },rpc);
  return result === null ? null : decode(result,checked);
}
/** Trusted worker only, AFTER exact signed-attempt and chain/code/accounting checks. */
export async function storeRewardCampaignCheckpoint(input: Scope & { intentId: string; attemptId: string; idempotencyKey: string;
  deployment: unknown; observation: unknown }, rpc?: RewardLedgerRpc) {
  const checked = scope(input); const intentId = uuid(input.intentId); const attemptId = uuid(input.attemptId);
  demand(checked.idempotencyKey !== null);
  const deployment = copy(input.deployment); const observation = copy(input.observation);
  decodeRewardCampaignDeployment(deployment); decodeRewardCampaignObservation(observation);
  const result = decode(await call("service_record_reward_campaign_checkpoint", { p_campaign_id: checked.campaignId,p_actor_user_id: checked.actorUserId,
    p_intent_id: intentId,p_attempt_id: attemptId,p_idempotency_key: checked.idempotencyKey,p_deployment: deployment,p_observation: observation },rpc),checked);
  demand(result.intentId === intentId && result.attemptId === attemptId
    && JSON.stringify(copy(result.deployment)) === JSON.stringify(copy(decodeRewardCampaignDeployment(deployment)))
    && JSON.stringify(copy(result.observation)) === JSON.stringify(copy(decodeRewardCampaignObservation(observation))));
  return result;
}
