import { decodeRewardRecordComparison, parseRewardSourceTimestamp, type verifyRewardRecordCandidate } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentInteger as integer, rewardDocumentUuid as uuid } from "./stored-documents.js";
import { decodeRewardRecordSnapshot } from "./record-source.js";

export type RewardRecordCandidate = ReturnType<typeof verifyRewardRecordCandidate>;
export type RewardRecordApproval = {
  approvalId: string; campaignId: string; targetSnapshotId: string; priorSnapshotId: string;
  revision: number; approvedByUserId: string; approvedAt: string;
  body: ReturnType<typeof decodeBody>; priorSnapshot: ReturnType<typeof decodeRewardRecordSnapshot>;
};
const safeErrors = new Set(["reward_operator_permission_required", "reward_record_source_scope_mismatch", "reward_record_approval_required",
  "reward_record_source_changed", "reward_record_source_not_ready", "reward_review_source_changed", "reward_ledger_idempotency_conflict",
  "reward_campaign_allocation_already_reserved", "invalid_reward_record_approval", "invalid_reward_record_withdrawal",
  "reward_record_approval_already_withdrawn"]);
function demand(condition: unknown): asserts condition {
  if (!condition) throw new RewardLedgerStoreError("invalid_reward_record_approval_document");
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  demand(value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
  const descriptors = Object.getOwnPropertyDescriptors(value);
  demand(Object.getOwnPropertySymbols(value).length === 0 && Object.keys(descriptors).length === keys.length
    && keys.every((key) => descriptors[key]?.enumerable && "value" in descriptors[key]));
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): string { parseRewardSourceTimestamp(value); return value as string; }
function retryKey(value: unknown): string { demand(typeof value === "string" && value.length >= 8 && value.length <= 128); return value; }
export function rewardRecordComparisonWire(value: RewardRecordCandidate["comparison"]) {
  return { ...value, priorPrecisionMs: value.priorPrecisionMs.toString(), targetPrecisionMs: value.targetPrecisionMs.toString() };
}
/** Only the application-derived candidate is serialized here, never an HTTP body. */
export function rewardRecordApprovalRequest(candidate: RewardRecordCandidate) {
  return { schemaVersion: 1, targetRaceId: candidate.targetRaceId, gender: candidate.gender, baselineSourceId: candidate.baselineSourceId,
    comparison: rewardRecordComparisonWire(candidate.comparison), baseline: { publicationId: candidate.baseline.publicationId,
      establishedAtMs: candidate.baseline.establishedAtMs.toString(), finishTimeMs: candidate.baseline.finishTimeMs.toString(),
      courseComparisonKey: candidate.baseline.courseComparisonKey }, sourceReviewEndsAt: candidate.sourceReviewEndsAt.toString(),
    establishmentBasis: candidate.establishmentBasis, publicationSignature: candidate.publicationSignature };
}
function decodeBody(value: unknown) {
  const row = object(value, ["schemaVersion", "targetRaceId", "gender", "baselineSourceId", "comparison", "baseline",
    "sourceReviewEndsAt", "establishmentBasis", "publicationSignature"]);
  demand(row.schemaVersion === 1 && (row.gender === "M" || row.gender === "F") && row.publicationSignature === "unverified"
    && (row.establishmentBasis === "gun_finish" || row.establishmentBasis === "result_run_completed_upper_bound"));
  const raw = object(row.baseline, ["publicationId", "establishedAtMs", "finishTimeMs", "courseComparisonKey"]);
  const finishTimeMs = integer(raw.finishTimeMs); demand(finishTimeMs > 0n);
  demand(typeof raw.courseComparisonKey === "string" && raw.courseComparisonKey.length >= 1 && raw.courseComparisonKey.length <= 200);
  const gender: "M" | "F" = row.gender;
  const establishmentBasis: RewardRecordCandidate["establishmentBasis"] = row.establishmentBasis;
  return { targetRaceId: uuid(row.targetRaceId), gender, baselineSourceId: uuid(row.baselineSourceId),
    comparison: decodeRewardRecordComparison(row.comparison), baseline: { publicationId: uuid(raw.publicationId),
      establishedAtMs: integer(raw.establishedAtMs), finishTimeMs, courseComparisonKey: raw.courseComparisonKey },
    sourceReviewEndsAt: integer(row.sourceReviewEndsAt), establishmentBasis, publicationSignature: "unverified" as const };
}
export function decodeRewardRecordApproval(value: unknown, expected: { campaignId: string; actorUserId: string; approvalId?: string }): RewardRecordApproval {
  const row = object(value, ["approvalId", "campaignId", "targetSnapshotId", "priorSnapshotId", "revision", "approvedByUserId", "approvedAt", "body", "priorSnapshot"]);
  demand(row.campaignId === expected.campaignId && row.approvedByUserId === expected.actorUserId
    && (expected.approvalId === undefined || row.approvalId === expected.approvalId)
    && Number.isSafeInteger(row.revision) && (row.revision as number) > 0);
  const campaignId = uuid(row.campaignId); const targetSnapshotId = uuid(row.targetSnapshotId); const priorSnapshotId = uuid(row.priorSnapshotId);
  return { approvalId: uuid(row.approvalId), campaignId, targetSnapshotId, priorSnapshotId, revision: row.revision as number,
    approvedByUserId: uuid(row.approvedByUserId), approvedAt: timestamp(row.approvedAt), body: decodeBody(row.body),
    priorSnapshot: decodeRewardRecordSnapshot(row.priorSnapshot, { campaignId, targetSnapshotId, snapshotId: priorSnapshotId }) };
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
export async function readRewardRecordSnapshot(input: { campaignId: string; actorUserId: string; snapshotId: string }, rpc?: RewardLedgerRpc) {
  const campaignId = uuid(input.campaignId); const actorUserId = uuid(input.actorUserId); const snapshotId = uuid(input.snapshotId);
  return decodeRewardRecordSnapshot(await call("service_read_reward_record_snapshot", {
    p_campaign_id: campaignId, p_actor_user_id: actorUserId, p_snapshot_id: snapshotId }, rpc), { campaignId, snapshotId });
}
export async function readRewardRecordApproval(input: { campaignId: string; actorUserId: string; approvalId: string }, rpc?: RewardLedgerRpc) {
  const campaignId = uuid(input.campaignId); const actorUserId = uuid(input.actorUserId); const approvalId = uuid(input.approvalId);
  return decodeRewardRecordApproval(await call("service_read_reward_record_approval", {
    p_campaign_id: campaignId, p_actor_user_id: actorUserId, p_approval_id: approvalId }, rpc), { campaignId, actorUserId, approvalId });
}
export async function storeRewardRecordApproval(input: { campaignId: string; actorUserId: string; candidate: RewardRecordCandidate; idempotencyKey: string }, rpc?: RewardLedgerRpc) {
  const campaignId = uuid(input.campaignId); const actorUserId = uuid(input.actorUserId); const idempotencyKey = retryKey(input.idempotencyKey);
  const priorSnapshotId = uuid(input.candidate.priorSnapshotId); const targetSnapshotId = uuid(input.candidate.targetSnapshotId);
  const request = rewardRecordApprovalRequest(input.candidate); decodeBody(request);
  const result = decodeRewardRecordApproval(await call("service_approve_reward_record", {
    p_campaign_id: campaignId, p_actor_user_id: actorUserId, p_prior_snapshot_id: priorSnapshotId, p_idempotency_key: idempotencyKey, p_request: request,
  }, rpc), { campaignId, actorUserId });
  demand(result.priorSnapshotId === priorSnapshotId && result.targetSnapshotId === targetSnapshotId
    && JSON.stringify(rewardRecordApprovalRequest({ ...result.body, targetSnapshotId, priorSnapshotId })) === JSON.stringify(request));
  return result;
}
export async function withdrawRewardRecordApproval(input: { campaignId: string; actorUserId: string; approvalId: string; idempotencyKey: string; reason: string }, rpc?: RewardLedgerRpc) {
  const campaignId = uuid(input.campaignId); const actorUserId = uuid(input.actorUserId); const approvalId = uuid(input.approvalId);
  const idempotencyKey = retryKey(input.idempotencyKey);
  demand(typeof input.reason === "string" && input.reason.trim().length >= 8 && input.reason.length <= 4000);
  const reason = input.reason.trim();
  const row = object(await call("service_withdraw_reward_record", { p_campaign_id: campaignId, p_actor_user_id: actorUserId,
    p_approval_id: approvalId, p_idempotency_key: idempotencyKey, p_reason: reason }, rpc),
  ["withdrawalId", "approvalId", "campaignId", "withdrawnByUserId", "withdrawnAt", "reason"]);
  demand(row.approvalId === approvalId && row.campaignId === campaignId && row.withdrawnByUserId === actorUserId && row.reason === reason);
  return { withdrawalId: uuid(row.withdrawalId), approvalId, campaignId, withdrawnByUserId: actorUserId, withdrawnAt: timestamp(row.withdrawnAt), reason };
}
