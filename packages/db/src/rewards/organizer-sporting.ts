import { parseRewardSourceTimestamp, type RewardPreparationSelection } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument, RewardLedgerStoreError, type RewardLedgerRpc, type RewardSportingReviewBody } from "./programme-ledger.js";
import { decodeRewardCalculationContext } from "./calculation-context.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentArray as array } from "./stored-documents.js";
import { copyRewardSourceDocument } from "./source-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

const safe = new Set(["reward_account_session_required", "reward_operator_permission_required", "reward_distribution_scope_required",
  "reward_preparation_scope_required", "reward_calculation_reference_mismatch", "reward_campaign_allocation_already_reserved",
  "reward_sporting_revision_changed", "reward_review_source_changed", "reward_round_has_unresolved_adjudication", "reward_ledger_idempotency_conflict",
  "reward_record_approval_omitted", "reward_record_approval_withdrawn", "reward_record_approval_superseded", "reward_record_source_changed",
  "reward_record_source_not_ready", "reward_record_approval_required", "reward_record_approval_target_mismatch", "reward_source_permission_required",
  "reward_round_not_ready", "reward_mapping_source_not_ready", "reward_round_scope_mismatch", "reward_competition_not_active",
  "reward_capture_idempotency_conflict", "invalid_reward_sporting_request", "invalid_reward_capture_key"]);
function demand(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_sporting_document"); }
function timestamp(v: unknown) { parseRewardSourceTimestamp(v); return v as string; }
function revision(v: unknown) { demand(typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2147483646); return v; }
function key(v: unknown) { demand(typeof v === "string" && v.length >= 8 && v.length <= 128); return v; }
function label(v: unknown) { demand(v === null || (typeof v === "string" && v.trim() === v && v.length > 0 && [...v].length <= 256)); return v as string | null; }
function args(identity: RewardAccountIdentity, scope: RewardPreparationSelection) {
  demand(scope.chainId === 10143 || scope.chainId === 31337);
  return { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId), p_programme_id: uuid(scope.programmeId),
    p_chain_id: scope.chainId, p_campaign_id: uuid(scope.campaignId) };
}
function checkScope(d: Record<string, unknown>, a: ReturnType<typeof args>) {
  demand(d.programmeId === a.p_programme_id && d.chainId === a.p_chain_id && d.campaignId === a.p_campaign_id);
  return { programmeId: a.p_programme_id, chainId: a.p_chain_id, campaignId: a.p_campaign_id };
}
async function call(name: Parameters<RewardLedgerRpc>[0], input: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let r;
  try { r = await (rpc ?? ((n, p) => createAdminSupabaseClient().rpc(n, p)))(name, input); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (r.error) { const code = typeof r.error === "object" ? (r.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof code === "string" && safe.has(code) ? code : "reward_ledger_store_failed"); }
  return copyRewardSourceDocument(r.data);
}

/** Private bundle: never return context, raw source or record packets over HTTP. */
export async function readRewardOperatorSportingContext(identity: RewardAccountIdentity, scope: RewardPreparationSelection,
  reference: { snapshotId: string | null; recordApprovalIds?: readonly string[] }, rpc?: RewardLedgerRpc) {
  const input = { ...args(identity, scope), p_source_snapshot_id: reference.snapshotId === null ? null : uuid(reference.snapshotId),
    p_record_approval_ids: (reference.recordApprovalIds ?? []).map(uuid).sort() };
  demand(input.p_record_approval_ids.length <= 4 && new Set(input.p_record_approval_ids).size === input.p_record_approval_ids.length);
  const d = object(await call("service_read_reward_operator_sporting_context", input, rpc),
    ["programmeId", "chainId", "campaignId", "latestReviewId", "latestRevision", "allocationId", "context", "names", "recordApprovals"]);
  checkScope(d, input);
  const latestRevision = revision(d.latestRevision), latestReviewId = d.latestReviewId === null ? null : uuid(d.latestReviewId);
  demand((latestRevision === 0) === (latestReviewId === null));
  const allocationId = d.allocationId === null ? null : uuid(d.allocationId);
  let context = null;
  if (d.context !== null) {
    const raw = d.context as { snapshot?: { snapshotId?: unknown } };
    const selected = input.p_source_snapshot_id ?? uuid(raw.snapshot?.snapshotId);
    context = decodeRewardCalculationContext(d.context, { campaignId: input.p_campaign_id, actorUserId: input.p_actor_user_id, snapshotId: selected });
    demand(context.programme.id === input.p_programme_id && context.programme.chainId === input.p_chain_id);
  } else demand(input.p_source_snapshot_id === null && latestRevision === 0 && allocationId === null);
  const names = array(d.names, 40_000, raw => { const n = object(raw, ["kind", "id", "name"]); demand(n.kind === "athlete" || n.kind === "club");
    return { kind: n.kind, id: uuid(n.id), name: label(n.name) }; });
  demand(new Set(names.map(n => `${n.kind}:${n.id}`)).size === names.length);
  const recordApprovals = array(d.recordApprovals, 4, raw => { demand(raw !== null && typeof raw === "object" && !Array.isArray(raw));
    const r = raw as Record<string, unknown>; uuid(r.approvalId); return r; });
  demand(JSON.stringify(recordApprovals.map(r => r.approvalId).sort()) === JSON.stringify(input.p_record_approval_ids));
  if (!context) demand(names.length === 0 && recordApprovals.length === 0);
  return { context, names, recordApprovals, latestRevision, latestReviewId, allocationId };
}
export async function captureRewardOperatorSource(identity: RewardAccountIdentity, scope: RewardPreparationSelection, idempotencyKey: string, rpc?: RewardLedgerRpc) {
  const input = { ...args(identity, scope), p_idempotency_key: key(idempotencyKey) };
  const d = object(await call("service_capture_reward_operator_source", input, rpc), ["programmeId", "chainId", "campaignId", "snapshotId", "capturedAt"]);
  return { ...checkScope(d, input), snapshotId: uuid(d.snapshotId), capturedAt: timestamp(d.capturedAt) };
}
/** review has already passed the domain calculation; SQL rechecks current facts. */
export async function saveRewardOperatorSportingReview(identity: RewardAccountIdentity, scope: RewardPreparationSelection, input: {
  snapshotId: string; expectedRevision: number; idempotencyKey: string; review: RewardSportingReviewBody;
}, rpc?: RewardLedgerRpc) {
  const parameters = { ...args(identity, scope), p_source_snapshot_id: uuid(input.snapshotId), p_expected_revision: revision(input.expectedRevision),
    p_idempotency_key: key(input.idempotencyKey), p_review: copyRewardLedgerDocument(input.review) };
  demand(parameters.p_expected_revision <= 2147483645);
  const d = object(await call("service_record_reward_operator_sporting_review", parameters, rpc),
    ["programmeId", "chainId", "campaignId", "snapshotId", "reviewId", "revision", "reviewedAt"]);
  demand(d.snapshotId === parameters.p_source_snapshot_id && revision(d.revision) > 0);
  return { ...checkScope(d, parameters), snapshotId: uuid(d.snapshotId), reviewId: uuid(d.reviewId), revision: revision(d.revision), reviewedAt: timestamp(d.reviewedAt) };
}
