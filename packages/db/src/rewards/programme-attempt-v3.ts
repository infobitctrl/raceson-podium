import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
import { copyRewardLedgerDocument, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { decodeProgrammeDeploymentV3 } from "./programme-deployment-v3.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentInteger as integer } from "./stored-documents.js";

function check(value: unknown): asserts value { if (!value) throw new RewardLedgerStoreError("invalid_reward_programme_attempt"); }
function hash(value: unknown): `0x${string}` { check(typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value) !== 0n); return value as `0x${string}`; }
function address(value: unknown): `0x${string}` { check(typeof value === "string" && /^0x[0-9a-f]{40}$/.test(value) && BigInt(value) !== 0n); return value as `0x${string}`; }
function timestamp(value: unknown) { parseRewardSourceTimestamp(value); return value as string; }
const safe = new Set(["reward_account_session_required", "reward_planning_not_found", "reward_programme_deployment_required",
  "reward_programme_approval_required", "invalid_reward_programme_attempt", "reward_programme_attempt_conflict"]);
export type ProgrammeAttemptScopeV3 = { chainId: 31337 | 10143; draftId: string; intentId: string };
function scope(identity: RewardAccountIdentity, input: ProgrammeAttemptScopeV3) {
  check(input.chainId === 31337 || input.chainId === 10143);
  return { actor: uuid(identity.userId), session: uuid(identity.sessionId), chainId: input.chainId, draftId: uuid(input.draftId), intentId: uuid(input.intentId) };
}
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let result;
  try { result = await (rpc ?? ((fn, body) => createAdminSupabaseClient().rpc(fn, body)))(name, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = (result.error as { message?: unknown }).message;
    throw new RewardLedgerStoreError(typeof message === "string" && safe.has(message) ? message : "reward_ledger_unavailable");
  }
  return result.data;
}
function args(s: ReturnType<typeof scope>) {
  return { p_actor_user_id: s.actor, p_actor_session_id: s.session, p_chain_id: s.chainId, p_draft_id: s.draftId, p_intent_id: s.intentId };
}
/** Strict transport validation, not a cryptographic signature verdict. */
export function decodeProgrammeAttemptBodyV3(value: unknown) {
  const b = object(value, ["schemaVersion", "chainId", "operatorAddress", "nonce", "contractAddress", "transactionHash", "signedTransaction",
    "creationCodeHash", "calldataHash", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas", "maximumGasCostWei"]);
  check(b.schemaVersion === 3 && (b.chainId === 31337 || b.chainId === 10143));
  check(typeof b.signedTransaction === "string" && /^0x02(?:[0-9a-f]{2}){1,65535}$/.test(b.signedTransaction));
  const nonce = integer(b.nonce), gasLimit = integer(b.gasLimit), maxFeePerGas = integer(b.maxFeePerGas),
    maxPriorityFeePerGas = integer(b.maxPriorityFeePerGas), maximumGasCostWei = integer(b.maximumGasCostWei);
  check(nonce <= BigInt(Number.MAX_SAFE_INTEGER) && gasLimit > 0n && gasLimit <= 30_000_000n && maxFeePerGas > 0n
    && maxPriorityFeePerGas <= maxFeePerGas && gasLimit * maxFeePerGas <= maximumGasCostWei
    && b.creationCodeHash === "0x224d0de436541933a7cd8c4967702e3ccde77bc3f01af5eb9f62f12269b066e4");
  return { schemaVersion: 3 as const, chainId: b.chainId, operatorAddress: address(b.operatorAddress), nonce,
    contractAddress: address(b.contractAddress), transactionHash: hash(b.transactionHash), signedTransaction: b.signedTransaction as `0x02${string}`,
    creationCodeHash: hash(b.creationCodeHash), calldataHash: hash(b.calldataHash), gasLimit, maxFeePerGas, maxPriorityFeePerGas, maximumGasCostWei };
}

/** Trusted service only; verify signatures before storage and after reload. */
export async function storeProgrammeAttemptV3(identity: RewardAccountIdentity, input: ProgrammeAttemptScopeV3 & { attemptId: string; body: unknown }, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input), attemptId = uuid(input.attemptId), body = copyRewardLedgerDocument(input.body), verified = decodeProgrammeAttemptBodyV3(body);
  check(verified.chainId === s.chainId);
  const r = object(await call("service_record_reward_programme_attempt_v3", { ...args(s), p_attempt_id: attemptId, p_body: body }, rpc),
    ["attemptId", "intentId", "transactionHash", "recordedByUserId", "recordedAt"]);
  check(r.attemptId === attemptId && r.intentId === s.intentId && r.transactionHash === verified.transactionHash && r.recordedByUserId === s.actor);
  return { attemptId, intentId: s.intentId, transactionHash: hash(r.transactionHash), recordedByUserId: s.actor, recordedAt: timestamp(r.recordedAt) };
}

/** PRIVATE: includes signed transaction bytes. Never expose through HTTP/logs. */
export async function readProgrammeAttemptV3(identity: RewardAccountIdentity, input: ProgrammeAttemptScopeV3, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input);
  const r = object(await call("service_read_reward_programme_attempt_v3", args(s), rpc), ["schema", "context", "attempt"]);
  check(r.schema === "raceson-programme-attempt-v3");
  const context = decodeProgrammeDeploymentV3(r.context), i = context.intent;
  check(context.approvalView.record.chainId === s.chainId && context.approvalView.record.draftId === s.draftId
    && i?.id === s.intentId && i.createdByUserId === s.actor);
  if (r.attempt === null) return { context, attempt: null };
  const a = object(r.attempt, ["id", "intentId", "body", "recordedByUserId", "recordedAt"]), body = decodeProgrammeAttemptBodyV3(a.body);
  check(a.intentId === s.intentId && a.recordedByUserId === s.actor && body.chainId === s.chainId && body.operatorAddress === i.terms.operatorAddress
    && body.nonce === i.nonce && body.maximumGasCostWei === i.maximumGasCostWei && body.creationCodeHash === i.creationCodeHash);
  return { context, attempt: { id: uuid(a.id), intentId: s.intentId, body, recordedByUserId: s.actor, recordedAt: timestamp(a.recordedAt) } };
}
