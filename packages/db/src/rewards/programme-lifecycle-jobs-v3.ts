import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { decodeRewardOperatorJobV3 } from "./programme-jobs-v3.js";
import { decodeRewardCampaignObservation } from "./campaign-checkpoints.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentInteger as uint } from "./stored-documents.js";
import type { ProgrammeLifecycleScopeV3 } from "./programme-lifecycle-v3.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

function check(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_programme_lifecycle_job"); }
const address = (v: unknown) => { check(typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v) && BigInt(v) !== 0n); return v as `0x${string}`; };
const hash = (v: unknown, zero = false) => { check(typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && (zero || BigInt(v) !== 0n)); return v as `0x${string}`; };
const optionalId = (v: unknown) => v === null ? null : uuid(v);
const timestamp = (v: unknown) => { parseRewardSourceTimestamp(v); return v as string; };
const safe = new Set(["reward_account_session_required", "reward_planning_not_found", "reward_planning_revision_changed", "reward_programme_not_verified",
  "reward_allocation_upload_not_found", "reward_allocation_not_ready", "reward_programme_lifecycle_required", "reward_programme_lifecycle_conflict",
  "reward_programme_lifecycle_predecessor_required", "invalid_reward_programme_lifecycle_job", "reward_programme_lifecycle_job_conflict",
  "reward_programme_lifecycle_job_required", "reward_programme_lifecycle_lease_lost", "invalid_reward_programme_lifecycle_receipt", "invalid_reward_campaign_accounting"]);
function args(identity: RewardAccountIdentity, scope: ProgrammeLifecycleScopeV3) {
  check(scope.chainId === 31337 || scope.chainId === 10143); check(Number.isInteger(scope.slot) && scope.slot >= 1 && scope.slot <= 6);
  return { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId), p_chain_id: scope.chainId, p_draft_id: uuid(scope.draftId),
    p_slot: scope.slot, p_approval_id: uuid(scope.approvalId), p_upload_id: uuid(scope.uploadId), p_intent_id: uuid(scope.intentId) };
}
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let r;
  try { r = await (rpc ?? ((fn, body) => createAdminSupabaseClient().rpc(fn, body)))(name, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (r.error) { const m = (r.error as { message?: unknown }).message;
    throw new RewardLedgerStoreError(typeof m === "string" && safe.has(m) ? m : "reward_ledger_unavailable"); }
  return r.data;
}
/** Strict receipt transport; the service still verifies chain, logs and all
 * historical accounting against the immutable plan before SQL confirmation. */
export function decodeProgrammeLifecycleReceiptV3(value: unknown) {
  const r = object(value, ["protocolVersion", "provenance", "action", "campaignAddress", "transactionHash", "nonce", "blockNumber", "blockHash", "blockTimestamp",
    "gasUsed", "effectiveGasPrice", "feeWei", "finalizedBlock", "accountingAtReceiptBlock", "publicationAtReceiptBlock"]);
  check(r.protocolVersion === 3 && (r.action === "complete_funding" || r.action === "upload_awards" || r.action === "stage_allocation" || r.action === "activate"));
  const p = object(r.provenance, ["kind", "programmeAddress", "deploymentTransactionHash", "slot"]);
  check(p.kind === "programme-child" && typeof p.slot === "number" && Number.isInteger(p.slot) && p.slot >= 0 && p.slot <= 5);
  const f = object(r.finalizedBlock, ["number", "hash", "timestamp"]), publication = object(r.publicationAtReceiptBlock,
    ["reviewPeriod", "reviewStartedAt", "officialPublishedAt", "publicationEvidenceHash"]);
  const blockNumber = uint(r.blockNumber), blockHash = hash(r.blockHash), blockTimestamp = uint(r.blockTimestamp), nonce = uint(r.nonce);
  const finalizedBlock = { number: uint(f.number), hash: hash(f.hash), timestamp: uint(f.timestamp) };
  const observation = decodeRewardCampaignObservation({ schemaVersion: 1,
    finalizedBlock: { number: r.blockNumber, hash: r.blockHash, timestamp: r.blockTimestamp }, accounting: r.accountingAtReceiptBlock });
  const inactive = p.slot === 5 ? 0 : 1;
  check(observation.accounting.budgets[inactive] === 0n && observation.accounting.allocated[inactive] === 0n
    && observation.accounting.paid[inactive] === 0n);
  const gasUsed = uint(r.gasUsed), effectiveGasPrice = uint(r.effectiveGasPrice), feeWei = uint(r.feeWei);
  check(nonce <= BigInt(Number.MAX_SAFE_INTEGER) && gasUsed > 0n && effectiveGasPrice > 0n && feeWei === gasUsed * effectiveGasPrice
    && blockNumber > 0n && blockTimestamp > 0n && finalizedBlock.number >= blockNumber && finalizedBlock.timestamp >= blockTimestamp
    && (finalizedBlock.number !== blockNumber || finalizedBlock.hash === blockHash && finalizedBlock.timestamp === blockTimestamp));
  const publicationAtReceiptBlock = { reviewPeriod: uint(publication.reviewPeriod), reviewStartedAt: uint(publication.reviewStartedAt),
    officialPublishedAt: uint(publication.officialPublishedAt), publicationEvidenceHash: hash(publication.publicationEvidenceHash, true) };
  check([publicationAtReceiptBlock.reviewPeriod, publicationAtReceiptBlock.reviewStartedAt, publicationAtReceiptBlock.officialPublishedAt].every(v => v < 1n << 64n));
  if (r.action === "stage_allocation" || r.action === "activate") {
    const p = publicationAtReceiptBlock, a = observation.accounting;
    check(p.reviewPeriod <= 2592000n && p.reviewStartedAt > 0n && p.officialPublishedAt >= p.reviewStartedAt + p.reviewPeriod
      && p.officialPublishedAt <= blockTimestamp && BigInt(p.publicationEvidenceHash) !== 0n
      && BigInt(a.snapshotDigest) !== 0n && BigInt(a.allocationDigest) !== 0n
      && a.activationNotBefore >= p.officialPublishedAt && a.activationNotBefore <= blockTimestamp);
    check(r.action === "stage_allocation" ? a.state >= 2 && a.activationNotBefore === blockTimestamp
      : a.state >= 3 && a.claimDeadline >= blockTimestamp + 31536000n);
  }
  return { protocolVersion: 3 as const, provenance: { kind: "programme-child" as const, programmeAddress: address(p.programmeAddress),
    deploymentTransactionHash: hash(p.deploymentTransactionHash), slot: p.slot }, action: r.action, campaignAddress: address(r.campaignAddress),
    transactionHash: hash(r.transactionHash), nonce, blockNumber, blockHash, blockTimestamp, gasUsed, effectiveGasPrice, feeWei,
    finalizedBlock, accountingAtReceiptBlock: observation.accounting, publicationAtReceiptBlock };
}
export async function readProgrammeLifecycleJobV3(identity: RewardAccountIdentity, scope: ProgrammeLifecycleScopeV3, rpc?: RewardLedgerRpc) {
  const s = args(identity, scope), raw = object(await call("service_read_reward_programme_lifecycle_job_v3", s, rpc), ["schema", "job", "receipt"]);
  check(raw.schema === "raceson-programme-lifecycle-job-v3");
  const job = raw.job === null ? null : decodeRewardOperatorJobV3(raw.job, s.p_actor_user_id, s.p_intent_id);
  let receipt = null;
  if (raw.receipt !== null) {
    const r = object(raw.receipt, ["body", "recordedAt", "recordedByUserId"]), body = decodeProgrammeLifecycleReceiptV3(r.body);
    check(job?.state === "confirmed" && body.transactionHash === job.transactionHash && body.provenance.slot === s.p_slot - 1 && r.recordedByUserId === s.p_actor_user_id);
    receipt = { body, recordedAt: timestamp(r.recordedAt), recordedByUserId: s.p_actor_user_id };
  }
  check((job?.state === "confirmed") === (receipt !== null));
  return { job, receipt };
}
export async function queueProgrammeLifecycleJobV3(identity: RewardAccountIdentity, scope: ProgrammeLifecycleScopeV3 & { jobId: string; attemptId: string }, rpc?: RewardLedgerRpc) {
  const s = { ...args(identity, scope), p_job_id: uuid(scope.jobId), p_attempt_id: uuid(scope.attemptId) };
  const job = decodeRewardOperatorJobV3(await call("service_queue_reward_programme_lifecycle_job_v3", s, rpc), s.p_actor_user_id, s.p_intent_id);
  check(job.jobId === s.p_job_id && job.attemptId === s.p_attempt_id); return job;
}
export async function stepProgrammeLifecycleJobV3(identity: RewardAccountIdentity, scope: ProgrammeLifecycleScopeV3 & { jobId: string; workerId: string;
  leaseToken: string | null; action: "lease" | "arm" | "submitted" | "confirm"; receipt?: unknown }, rpc?: RewardLedgerRpc) {
  const s = { ...args(identity, scope), p_job_id: uuid(scope.jobId), p_worker_id: uuid(scope.workerId), p_lease_token: optionalId(scope.leaseToken),
    p_action: scope.action, p_receipt: scope.receipt === undefined ? null : copy(scope.receipt) };
  check(["lease", "arm", "submitted", "confirm"].includes(s.p_action) && (s.p_action !== "lease" || s.p_lease_token === null)
    && (s.p_action === "confirm") === (s.p_receipt !== null));
  if (s.p_receipt !== null) check(decodeProgrammeLifecycleReceiptV3(s.p_receipt).provenance.slot === s.p_slot - 1);
  const raw = await call("service_step_reward_programme_lifecycle_job_v3", s, rpc);
  if (raw === null) { check(s.p_action === "lease"); return null; }
  const job = decodeRewardOperatorJobV3(raw, s.p_actor_user_id, s.p_intent_id);
  check(job.jobId === s.p_job_id && (job.state === "confirmed" || job.leaseOwner === s.p_worker_id && job.leaseToken !== null
    && (s.p_action === "lease" || job.leaseToken === s.p_lease_token)));
  check(job.state === "confirmed" || (s.p_action === "lease" ? ["leased", "broadcasting", "submitted"].includes(job.state)
    : job.state === (s.p_action === "arm" ? "broadcasting" : s.p_action === "submitted" ? "submitted" : "confirmed")));
  return job;
}
