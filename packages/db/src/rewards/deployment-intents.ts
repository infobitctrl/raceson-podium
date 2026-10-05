import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentInteger as integer, rewardDocumentUuid as uuid, rewardDocumentObject as object } from "./stored-documents.js";

const safeErrors = new Set(["reward_operator_permission_required", "reward_deployment_intent_mismatch", "reward_deployment_already_planned",
  "invalid_reward_deployment_request", "reward_deployment_nonce_exhausted", "invalid_reward_deployment_attempt", "reward_ledger_idempotency_conflict",
  "reward_deployment_transaction_already_recorded", "reward_deployment_attempt_mismatch"]);
function demand(condition: unknown): asserts condition { if (!condition) throw new RewardLedgerStoreError("invalid_reward_deployment_document"); }
function hash(value: unknown): `0x${string}` { demand(typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value) !== 0n); return value as `0x${string}`; }
function address(value: unknown): `0x${string}` { demand(typeof value === "string" && /^0x[0-9a-f]{40}$/.test(value) && BigInt(value) !== 0n); return value as `0x${string}`; }
function timestamp(value: unknown): string { parseRewardSourceTimestamp(value); return value as string; }
function key(value: unknown): string { demand(typeof value === "string" && value.length >= 8 && value.length <= 128); return value; }
function nonce(value: unknown): bigint { const parsed = integer(value); demand(parsed <= BigInt(Number.MAX_SAFE_INTEGER)); return parsed; }
function refs(input: { campaignId: string; actorUserId: string; intentId?: string }) {
  return { campaignId: uuid(input.campaignId), actorUserId: uuid(input.actorUserId), intentId: input.intentId === undefined ? null : uuid(input.intentId) };
}
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, injected?: RewardLedgerRpc) {
  const rpc: RewardLedgerRpc = injected ?? ((method, parameters) => createAdminSupabaseClient().rpc(method, parameters));
  let result: { data: unknown; error: unknown };
  try { result = await rpc(name, args); } catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = typeof result.error === "object" ? (result.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof message === "string" && safeErrors.has(message) ? message : "reward_ledger_store_failed");
  }
  return result.data;
}

function decodeContext(value: unknown, scope: ReturnType<typeof refs>) {
  const raw = object(value, ["schemaVersion", "programmeId", "campaignId", "environment", "chainId", "operatorAddress", "treasuryAddress",
    "programmeOnChainId", "campaignOnChainId", "manifestHash", "pot", "budgetWei", "intent"]);
  demand(raw.schemaVersion === 1 && raw.campaignId === scope.campaignId && (raw.pot === "race" || raw.pot === "league"));
  demand((raw.environment === "local_simulation" && raw.chainId === 31337) || (raw.environment === "testnet_pilot" && raw.chainId === 10143));
  const environment: "local_simulation" | "testnet_pilot" = raw.environment;
  const chainId: 10143 | 31337 = raw.chainId;
  const pot: "race" | "league" = raw.pot;
  const budgetWei = integer(raw.budgetWei); demand(budgetWei > 0n);
  let intent = null;
  if (raw.intent !== null) {
    const row = object(raw.intent, ["id", "nonce", "buildId", "creationCodeHash", "createdByUserId", "createdAt", "idempotencyKey"]);
    demand(row.createdByUserId === scope.actorUserId && typeof row.buildId === "string" && row.buildId.length <= 100);
    intent = { id: uuid(row.id), nonce: nonce(row.nonce), buildId: row.buildId, creationCodeHash: hash(row.creationCodeHash),
      createdByUserId: scope.actorUserId, createdAt: timestamp(row.createdAt), idempotencyKey: key(row.idempotencyKey) };
  }
  demand(scope.intentId === null || intent?.id === scope.intentId);
  return { programmeId: uuid(raw.programmeId), campaignId: scope.campaignId, environment, chainId,
    operatorAddress: address(raw.operatorAddress), treasuryAddress: address(raw.treasuryAddress), programmeOnChainId: hash(raw.programmeOnChainId),
    campaignOnChainId: hash(raw.campaignOnChainId), manifestHash: hash(raw.manifestHash), pot, budgetWei, intent };
}
export type RewardDeploymentContext = ReturnType<typeof decodeContext>;
export { decodeContext as decodeRewardDeploymentContext };

export async function readRewardDeploymentContext(input: { campaignId: string; actorUserId: string; intentId?: string }, rpc?: RewardLedgerRpc) {
  const scope = refs(input);
  return decodeContext(await call("service_read_reward_deployment_context", { p_campaign_id: scope.campaignId, p_actor_user_id: scope.actorUserId,
    p_intent_id: scope.intentId }, rpc), scope);
}

/** The RPC atomically allocates max(observed pending nonce, prior reservation+1)
 * under a chain/signer-wide lock. A historical retry does not release a nonce. */
export async function reserveRewardDeploymentIntent(input: { campaignId: string; actorUserId: string; idempotencyKey: string;
  observedChainId: number; pendingNonce: bigint }, rpc?: RewardLedgerRpc) {
  const scope = refs(input); const idempotencyKey = key(input.idempotencyKey);
  demand((input.observedChainId === 10143 || input.observedChainId === 31337) && typeof input.pendingNonce === "bigint");
  const pendingNonce = nonce(input.pendingNonce.toString()); const observedChainId = input.observedChainId;
  const context = decodeContext(await call("service_reserve_reward_deployment", { p_campaign_id: scope.campaignId, p_actor_user_id: scope.actorUserId,
    p_idempotency_key: idempotencyKey, p_observed_chain_id: observedChainId, p_pending_nonce: pendingNonce.toString() }, rpc), scope);
  demand(context.chainId === observedChainId && context.intent?.idempotencyKey === idempotencyKey);
  return context;
}

function decodeAttemptBody(value: unknown) {
  const raw = object(value, ["schemaVersion", "chainId", "operatorAddress", "nonce", "contractAddress", "transactionHash", "signedTransaction",
    "creationCodeHash", "calldataHash", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"]);
  demand(raw.schemaVersion === 1 && (raw.chainId === 10143 || raw.chainId === 31337));
  demand(typeof raw.signedTransaction === "string" && /^0x02(?:[0-9a-f]{2}){1,65535}$/.test(raw.signedTransaction));
  const gasLimit = integer(raw.gasLimit); const maxFeePerGas = integer(raw.maxFeePerGas); const maxPriorityFeePerGas = integer(raw.maxPriorityFeePerGas);
  demand(gasLimit > 0n && maxFeePerGas > 0n && maxPriorityFeePerGas <= maxFeePerGas);
  return { schemaVersion: 1 as const, chainId: raw.chainId, operatorAddress: address(raw.operatorAddress), nonce: nonce(raw.nonce),
    contractAddress: address(raw.contractAddress), transactionHash: hash(raw.transactionHash), signedTransaction: raw.signedTransaction as `0x02${string}`,
    creationCodeHash: hash(raw.creationCodeHash), calldataHash: hash(raw.calldataHash), gasLimit, maxFeePerGas, maxPriorityFeePerGas };
}

/** Trusted service only: call AFTER cryptographic validation, never with a raw
 * browser body. Re-validate signed bytes again when loading for chain work. */
export async function storeRewardDeploymentAttempt(input: { campaignId: string; actorUserId: string; intentId: string;
  idempotencyKey: string; attempt: unknown }, rpc?: RewardLedgerRpc) {
  const scope = refs(input); const idempotencyKey = key(input.idempotencyKey); const body = copy(input.attempt); const checked = decodeAttemptBody(body);
  const raw = object(await call("service_record_reward_deployment_attempt", { p_campaign_id: scope.campaignId, p_actor_user_id: scope.actorUserId,
    p_intent_id: scope.intentId, p_idempotency_key: idempotencyKey, p_attempt: body }, rpc),
  ["attemptId", "intentId", "campaignId", "recordedByUserId", "recordedAt", "transactionHash"]);
  demand(raw.intentId === scope.intentId && raw.campaignId === scope.campaignId && raw.recordedByUserId === scope.actorUserId && raw.transactionHash === checked.transactionHash);
  return { attemptId: uuid(raw.attemptId), intentId: uuid(raw.intentId), campaignId: scope.campaignId, recordedByUserId: scope.actorUserId,
    recordedAt: timestamp(raw.recordedAt), transactionHash: hash(raw.transactionHash) };
}

/** PRIVATE: includes signed transaction bytes. Do not return this from HTTP. */
export async function readRewardDeploymentAttempt(input: { campaignId: string; actorUserId: string; intentId: string; attemptId: string }, rpc?: RewardLedgerRpc) {
  const scope = refs(input); const attemptId = uuid(input.attemptId);
  const raw = object(await call("service_read_reward_deployment_attempt", { p_campaign_id: scope.campaignId, p_actor_user_id: scope.actorUserId,
    p_intent_id: scope.intentId, p_attempt_id: attemptId }, rpc), ["context", "attempt"]);
  const context = decodeContext(raw.context, scope);
  const row = object(raw.attempt, ["id", "intentId", "body", "recordedByUserId", "recordedAt", "idempotencyKey"]);
  demand(row.id === attemptId && row.intentId === scope.intentId && row.recordedByUserId === scope.actorUserId);
  const body = decodeAttemptBody(row.body);
  demand(context.intent && body.chainId === context.chainId && body.operatorAddress === context.operatorAddress && body.nonce === context.intent.nonce
    && body.creationCodeHash === context.intent.creationCodeHash);
  return { context, attempt: { id: attemptId, intentId: uuid(row.intentId), body, recordedByUserId: scope.actorUserId,
    recordedAt: timestamp(row.recordedAt), idempotencyKey: key(row.idempotencyKey) } };
}
