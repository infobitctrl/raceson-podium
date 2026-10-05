import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { decodeAllocationUploadV3, type AllocationUploadScopeV3 } from "./allocation-upload-v3.js";
import { decodeFinalAllocationUploadV3 } from "./final-allocation-v3.js";
import { decodeProgrammeRegistryV3 } from "./programme-jobs-v3.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentInteger as uint } from "./stored-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

export type ProgrammeLifecycleScopeV3 = AllocationUploadScopeV3 & { uploadId: string; intentId: string };
function check(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_programme_lifecycle"); }
const hash = (v: unknown) => { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v; };
const opaque = (v: unknown) => { check(typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) !== 0n); return v as `0x${string}`; };
const address = (v: unknown) => { check(typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v) && BigInt(v) !== 0n); return v as `0x${string}`; };
const timestamp = (v: unknown) => { parseRewardSourceTimestamp(v); return v as string; };
const optionalId = (v: unknown) => v === null ? null : uuid(v);
function scopeArgs(identity: RewardAccountIdentity, s: ProgrammeLifecycleScopeV3) {
  check(s.chainId === 31337 || s.chainId === 10143); check(Number.isInteger(s.slot) && s.slot >= 1 && s.slot <= 6);
  return { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId), p_chain_id: s.chainId,
    p_draft_id: uuid(s.draftId), p_slot: s.slot, p_approval_id: uuid(s.approvalId), p_upload_id: uuid(s.uploadId), p_intent_id: uuid(s.intentId) };
}
const safe = new Set(["reward_account_session_required", "reward_planning_not_found", "reward_planning_revision_changed", "reward_programme_not_verified",
  "reward_allocation_upload_not_found", "reward_allocation_not_ready", "invalid_reward_programme_lifecycle", "reward_programme_lifecycle_conflict",
  "reward_programme_lifecycle_predecessor_required", "reward_programme_lifecycle_required", "invalid_reward_programme_lifecycle_attempt",
  "reward_programme_lifecycle_attempt_conflict", "reward_deployment_nonce_exhausted", "reward_separate_relayer_required",
  "reward_round_publication_required", "reward_round_publication_conflict", "reward_final_publication_required"]);
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let r;
  try { r = await (rpc ?? ((fn, body) => createAdminSupabaseClient().rpc(fn, body)))(name, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (r.error) {
    const m = (r.error as { message?: unknown }).message;
    throw new RewardLedgerStoreError(typeof m === "string" && safe.has(m) ? m : "reward_ledger_unavailable");
  }
  return r.data;
}
export function decodeProgrammeLifecycleBodyV3(value: unknown) {
  const action = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "action")?.value : undefined;
  const published = action === "stage_allocation" || action === "activate";
  const r = object(value, ["action", "batchStart", "batchSize", "packageHash", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas", "maxGasCostWei",
    ...(published ? ["publication"] : [])]);
  check(r.action === "complete_funding" || r.action === "upload_awards" || published);
  const fees = { gasLimit: uint(r.gasLimit), maxFeePerGas: uint(r.maxFeePerGas), maxPriorityFeePerGas: uint(r.maxPriorityFeePerGas), maxGasCostWei: uint(r.maxGasCostWei) };
  check(fees.gasLimit > 0n && fees.gasLimit <= 30000000n && fees.maxFeePerGas > 0n && fees.maxGasCostWei > 0n
    && fees.maxPriorityFeePerGas <= fees.maxFeePerGas && fees.gasLimit * fees.maxFeePerGas <= fees.maxGasCostWei);
  const base = { fees, packageHash: hash(r.packageHash) };
  if (r.action === "complete_funding") { check(r.batchStart === null && r.batchSize === null); return { ...base, action: "complete_funding" as const }; }
  if (published) {
    check(r.batchStart === null && r.batchSize === null);
    const p = object(r.publication, ["reviewId", "publicationId", "reviewPeriod", "reviewStartedAt", "officialPublishedAt", "publicationEvidenceHash"]);
    const publication = { reviewId: uuid(p.reviewId), publicationId: uuid(p.publicationId), reviewPeriod: uint(p.reviewPeriod),
      reviewStartedAt: uint(p.reviewStartedAt), officialPublishedAt: uint(p.officialPublishedAt), publicationEvidenceHash: opaque(p.publicationEvidenceHash) };
    check(publication.reviewPeriod <= 2592000n && publication.reviewStartedAt > 0n && publication.officialPublishedAt < 1n << 64n
      && publication.officialPublishedAt >= publication.reviewStartedAt + publication.reviewPeriod);
    return { ...base, action: action as "stage_allocation" | "activate", publication };
  }
  check(typeof r.batchStart === "number" && Number.isInteger(r.batchStart) && r.batchStart >= 0 && r.batchStart <= 10000
    && typeof r.batchSize === "number" && Number.isInteger(r.batchSize) && r.batchSize >= 1 && r.batchSize <= 64);
  return { ...base, action: "upload_awards" as const, batchStart: r.batchStart, batchSize: r.batchSize };
}
function decodeAttempt(value: unknown) {
  const r = object(value, ["protocolVersion", "action", "chainId", "contractAddress", "operatorAddress", "nonce", "transactionHash", "calldataHash",
    "signedTransaction", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"]);
  check(r.protocolVersion === 3 && (r.chainId === 31337 || r.chainId === 10143)
    && (r.action === "complete_funding" || r.action === "upload_awards" || r.action === "stage_allocation" || r.action === "activate")
    && typeof r.signedTransaction === "string" && /^0x02(?:[0-9a-f]{2}){1,16384}$/.test(r.signedTransaction));
  return { protocolVersion: 3 as const, action: r.action, chainId: r.chainId, contractAddress: address(r.contractAddress),
    operatorAddress: address(r.operatorAddress), nonce: uint(r.nonce), transactionHash: opaque(r.transactionHash), calldataHash: opaque(r.calldataHash),
    signedTransaction: r.signedTransaction as `0x${string}`, gasLimit: uint(r.gasLimit), maxFeePerGas: uint(r.maxFeePerGas), maxPriorityFeePerGas: uint(r.maxPriorityFeePerGas) };
}
function decode(value: unknown, args: ReturnType<typeof scopeArgs>) {
  const scope = { chainId: args.p_chain_id, draftId: args.p_draft_id, slot: args.p_slot, approvalId: args.p_approval_id };
  const r = object(value, ["schema", "registry", "upload", "intent", "attempt"]);
  check(r.schema === "raceson-programme-lifecycle-private-v3");
  // Execution shares jobs/nonces, not source semantics. Each slot selects its
  // existing strict document decoder; historical upload APIs remain 1–4 only.
  const registry = decodeProgrammeRegistryV3(r.registry, scope), upload = scope.slot === 5 || scope.slot === 6
    ? decodeFinalAllocationUploadV3(r.upload, { ...scope, slot: scope.slot })
    : decodeAllocationUploadV3(r.upload, scope);
  check(registry.registry && registry.context.intent?.createdByUserId === args.p_actor_user_id && upload.prepared?.id === args.p_upload_id);
  let intent = null;
  if (r.intent !== null) {
    const i = object(r.intent, ["id", "programmeIntentId", "uploadId", "slot", "step", "predecessorId", "chainId", "operatorAddress", "nonce", "body", "createdByUserId", "createdAt"]);
    const body = decodeProgrammeLifecycleBodyV3(i.body), nonce = uint(i.nonce), predecessorId = optionalId(i.predecessorId);
    check(i.id === args.p_intent_id && i.programmeIntentId === registry.context.intent.id && i.uploadId === args.p_upload_id && i.slot === args.p_slot
      && i.chainId === args.p_chain_id && i.operatorAddress === registry.context.intent.terms.operatorAddress && i.createdByUserId === args.p_actor_user_id
      && nonce > registry.context.intent.nonce && nonce <= BigInt(Number.MAX_SAFE_INTEGER) && body.packageHash === upload.prepared.packageHash
      && typeof i.step === "number" && Number.isInteger(i.step) && i.step >= 0 && i.step <= 10000
      && (body.action === "complete_funding" ? i.step === 0 && predecessorId === null : i.step > 0 && predecessorId !== null));
    intent = { id: args.p_intent_id, programmeIntentId: registry.context.intent.id, uploadId: args.p_upload_id, slot: args.p_slot,
      step: i.step, predecessorId, chainId: args.p_chain_id, operatorAddress: address(i.operatorAddress), nonce, body,
      createdByUserId: args.p_actor_user_id, createdAt: timestamp(i.createdAt) };
  }
  let attempt = null;
  if (r.attempt !== null) {
    const a = object(r.attempt, ["id", "intentId", "body", "recordedByUserId", "recordedAt"]), body = decodeAttempt(a.body);
    check(intent && a.intentId === intent.id && a.recordedByUserId === args.p_actor_user_id && body.chainId === args.p_chain_id
      && body.operatorAddress === intent.operatorAddress && body.nonce === intent.nonce && body.action === intent.body.action);
    attempt = { id: uuid(a.id), intentId: intent.id, body, recordedByUserId: args.p_actor_user_id, recordedAt: timestamp(a.recordedAt) };
  }
  return { registry, upload, intent, attempt };
}
/** Private source/signature material: never expose this through HTTP or logs. */
export async function readProgrammeLifecycleV3(identity: RewardAccountIdentity, scope: ProgrammeLifecycleScopeV3, rpc?: RewardLedgerRpc) {
  const args = scopeArgs(identity, scope);
  return decode(await call("service_read_reward_programme_lifecycle_v3", args, rpc), args);
}
export async function reserveProgrammeLifecycleV3(identity: RewardAccountIdentity, scope: ProgrammeLifecycleScopeV3,
  change: { predecessorId: string | null; pendingNonce: bigint; body: unknown }, rpc?: RewardLedgerRpc) {
  const args = scopeArgs(identity, scope), body = copy(change.body), decoded = decodeProgrammeLifecycleBodyV3(body);
  // SQL selects the immutable publication binding for this exact source version.
  check(typeof change.pendingNonce === "bigint" && change.pendingNonce >= 0n && change.pendingNonce <= BigInt(Number.MAX_SAFE_INTEGER));
  const predecessorId = optionalId(change.predecessorId);
  const raw = await call(decoded.action === "stage_allocation" || decoded.action === "activate"
    ? "service_reserve_reward_programme_activation_v3" : "service_reserve_reward_programme_lifecycle_v3", { ...args, p_predecessor_id: predecessorId,
    p_pending_nonce: change.pendingNonce.toString(), p_body: body }, rpc);
  const r = decode(raw, args);
  check(r.intent && JSON.stringify(r.intent.body, (_, v) => typeof v === "bigint" ? v.toString() : v)
    === JSON.stringify(decodeProgrammeLifecycleBodyV3(body), (_, v) => typeof v === "bigint" ? v.toString() : v)
    && r.intent.predecessorId === predecessorId);
  return r;
}
export async function storeProgrammeLifecycleAttemptV3(identity: RewardAccountIdentity, scope: ProgrammeLifecycleScopeV3,
  change: { attemptId: string; body: unknown }, rpc?: RewardLedgerRpc) {
  const args = scopeArgs(identity, scope), body = copy(change.body), verified = decodeAttempt(body), attemptId = uuid(change.attemptId);
  const r = object(await call("service_record_reward_programme_lifecycle_attempt_v3", { ...args, p_attempt_id: attemptId, p_body: body }, rpc),
    ["attemptId", "intentId", "transactionHash", "recordedByUserId", "recordedAt"]);
  check(r.attemptId === attemptId && r.intentId === args.p_intent_id && r.transactionHash === verified.transactionHash && r.recordedByUserId === args.p_actor_user_id);
  return { attemptId, intentId: args.p_intent_id, transactionHash: verified.transactionHash, recordedByUserId: args.p_actor_user_id, recordedAt: timestamp(r.recordedAt) };
}
