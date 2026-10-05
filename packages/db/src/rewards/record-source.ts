import { parseRewardSourceTimestamp, type RewardRecordEvidenceSnapshot } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError } from "./programme-ledger.js";
import { rewardDocumentUuid as uuid } from "./stored-documents.js";

type RpcName = "service_read_reward_record_source" | "service_capture_reward_record_source";
export type RewardRecordSourceRpc = (name: RpcName, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
export type RewardRecordSourceScope = { campaignId: string; actorUserId: string; priorRaceId: string };
function demand(condition: unknown): asserts condition {
  if (!condition) throw new RewardLedgerStoreError("invalid_reward_record_source_response");
}
function object(value: unknown): Record<string, unknown> {
  demand(value !== null && typeof value === "object" && !Array.isArray(value)); return value as Record<string, unknown>;
}
function source(value: unknown, priorRaceId: string) {
  const row = object(value); demand(row.schemaVersion === 1 && object(row.race).id === priorRaceId);
  uuid(row.organizationId);
  for (const key of ["track", "publication", "run"]) object(row[key]);
  for (const key of ["rows", "adjudicationCases"]) demand(Array.isArray(row[key]) && row[key].length <= 20000 && row[key].every(object));
  // Keep raw numeric precision/provenance for the separate sporting verifier.
  return row;
}
const safeErrors = new Set(["reward_operator_permission_required", "reward_record_source_scope_mismatch", "reward_record_source_not_ready",
  "reward_source_too_large", "invalid_reward_record_capture", "reward_record_capture_idempotency_conflict"]);
async function call(name: RpcName, args: Record<string, unknown>, injected?: RewardRecordSourceRpc) {
  const rpc = injected ?? ((method, parameters) => createAdminSupabaseClient().rpc(method, parameters));
  let result: { data: unknown; error: unknown };
  try { result = await rpc(name, args); } catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = typeof result.error === "object" ? (result.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof message === "string" && safeErrors.has(message) ? message : "reward_ledger_store_failed");
  }
  return result.data;
}
function args(input: RewardRecordSourceScope) {
  return { p_campaign_id: uuid(input.campaignId), p_actor_user_id: uuid(input.actorUserId), p_prior_race_id: uuid(input.priorRaceId) };
}
/** Private current-source read. Not an approved baseline and not an HTTP route. */
export async function readRewardRecordSource(input: RewardRecordSourceScope, rpc?: RewardRecordSourceRpc) {
  const scope = args(input);
  return source(await call("service_read_reward_record_source", scope, rpc), scope.p_prior_race_id);
}
export async function captureRewardRecordSource(input: RewardRecordSourceScope & {
  targetSnapshotId: string; idempotencyKey: string;
}, rpc?: RewardRecordSourceRpc): Promise<RewardRecordEvidenceSnapshot & { capturedAt: string }> {
  const scope = args(input); const targetSnapshotId = uuid(input.targetSnapshotId); const idempotencyKey = input.idempotencyKey;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new RewardLedgerStoreError("invalid_reward_record_capture");
  }
  return decodeRewardRecordSnapshot(await call("service_capture_reward_record_source", { ...scope,
    p_source_snapshot_id: targetSnapshotId, p_idempotency_key: idempotencyKey }, rpc),
  { campaignId: scope.p_campaign_id, targetSnapshotId, priorRaceId: scope.p_prior_race_id });
}
export function decodeRewardRecordSnapshot(value: unknown, expected: {
  campaignId: string; targetSnapshotId?: string; priorRaceId?: string; snapshotId?: string;
}): RewardRecordEvidenceSnapshot & { capturedAt: string } {
  const result = object(value);
  demand(result.campaignId === expected.campaignId
    && (expected.targetSnapshotId === undefined || result.targetSnapshotId === expected.targetSnapshotId)
    && (expected.priorRaceId === undefined || result.priorRaceId === expected.priorRaceId)
    && (expected.snapshotId === undefined || result.snapshotId === expected.snapshotId)
    && typeof result.sourceFingerprintSha256 === "string" && /^[0-9a-f]{64}$/.test(result.sourceFingerprintSha256));
  parseRewardSourceTimestamp(result.capturedAt);
  return { snapshotId: uuid(result.snapshotId), campaignId: uuid(result.campaignId), targetSnapshotId: uuid(result.targetSnapshotId), priorRaceId: uuid(result.priorRaceId),
    capturedAt: result.capturedAt as string, sourceFingerprintSha256: result.sourceFingerprintSha256,
    source: source(result.source, result.priorRaceId as string) };
}
