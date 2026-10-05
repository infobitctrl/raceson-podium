import { decodeRewardLatestRecordApprovals, decodeRewardRecordCapture, decodeRewardRecordRacePage, parseRewardUnits, parseRewardSourceTimestamp,
  type RewardRecordSelection } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, copyRewardLedgerDocument, type RewardLedgerRpc } from "./programme-ledger.js";
import { copyRewardSourceDocument } from "./source-documents.js";
import { decodeRewardCalculationContext } from "./calculation-context.js";
import { decodeRewardRecordSnapshot } from "./record-source.js";
import { decodeRewardRecordApproval, rewardRecordApprovalRequest, type RewardRecordCandidate } from "./record-approvals.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentArray as array } from "./stored-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

const safe = new Set(["reward_account_session_required", "reward_operator_permission_required", "reward_source_permission_required",
  "reward_distribution_scope_required", "reward_preparation_scope_required", "reward_record_source_scope_mismatch", "reward_record_source_not_ready",
  "reward_record_source_changed", "reward_review_source_changed", "reward_record_revision_changed", "reward_campaign_allocation_already_reserved",
  "reward_record_capture_idempotency_conflict", "reward_ledger_idempotency_conflict", "reward_record_approval_required",
  "reward_record_approval_already_withdrawn", "invalid_reward_record_request", "invalid_reward_record_capture", "invalid_reward_record_withdrawal"]);
function demand(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_record_workspace_document"); }
function args(identity: RewardAccountIdentity, scope: RewardRecordSelection) {
  demand(scope.chainId === 10143 || scope.chainId === 31337);
  return { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId), p_programme_id: uuid(scope.programmeId),
    p_chain_id: scope.chainId, p_campaign_id: uuid(scope.campaignId), p_source_snapshot_id: uuid(scope.snapshotId) };
}
function key(v: unknown) { demand(typeof v === "string" && v.length >= 8 && v.length <= 128); return v; }
function revision(v: unknown) { demand(typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2147483646); return v; }
async function call(name: Parameters<RewardLedgerRpc>[0], input: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let r; try { r = await (rpc ?? ((n, p) => createAdminSupabaseClient().rpc(n, p)))(name, input); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (r.error) { const code = typeof r.error === "object" ? (r.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof code === "string" && safe.has(code) ? code : "reward_ledger_store_failed"); }
  return copyRewardSourceDocument(r.data);
}
export async function listRewardRecordRaces(identity: RewardAccountIdentity, scope: RewardRecordSelection, afterId: string | null, rpc?: RewardLedgerRpc) {
  const input = { ...args(identity, scope), p_after_id: afterId === null ? null : uuid(afterId) };
  const d = object(await call("service_list_reward_operator_record_races", input, rpc), ["programmeId", "chainId", "campaignId", "snapshotId", "items", "nextCursor"]);
  const items = array(d.items, 25, v => { const r = object(v, ["raceId", "raceName", "eventEditionId", "eventName", "startAt", "distanceMetres", "latestCaptureId"]);
    return { ...r, distanceMetres: r.distanceMetres === null ? null : parseRewardUnits(String(r.distanceMetres), 0).toString() }; });
  return decodeRewardRecordRacePage({ ...d, items }, scope, afterId);
}
/** Internal full packet; return only the service's whitelisted UI projection. */
export async function readRewardRecordWorkspace(identity: RewardAccountIdentity, scope: RewardRecordSelection, priorSnapshotId: string | null, rpc?: RewardLedgerRpc) {
  const input = { ...args(identity, scope), p_prior_snapshot_id: priorSnapshotId === null ? null : uuid(priorSnapshotId) };
  const d = object(await call("service_read_reward_operator_record_context", input, rpc), ["context", "priorSnapshot", "names", "latestApprovals", "allocationId"]);
  const context = decodeRewardCalculationContext(d.context, { campaignId: scope.campaignId, actorUserId: identity.userId, snapshotId: scope.snapshotId });
  demand(context.programme.id === scope.programmeId && context.programme.chainId === scope.chainId && context.campaign.pot === "race");
  const priorSnapshot = d.priorSnapshot === null ? null : decodeRewardRecordSnapshot(d.priorSnapshot,
    { campaignId: scope.campaignId, targetSnapshotId: scope.snapshotId, snapshotId: input.p_prior_snapshot_id! });
  demand((priorSnapshot === null) === (input.p_prior_snapshot_id === null));
  const names = array(d.names, 20000, v => { const r = object(v, ["id", "name"]);
    demand(r.name === null || (typeof r.name === "string" && r.name.trim() === r.name && r.name.length > 0 && [...r.name].length <= 256));
    return { id: uuid(r.id), name: r.name as string | null }; });
  demand(new Set(names.map(n => n.id)).size === names.length && (priorSnapshot !== null || names.length === 0));
  const latestApprovals = decodeRewardLatestRecordApprovals(d.latestApprovals);
  demand(latestApprovals.every(a => context.programme.configuration.rounds.find(r => r.id === context.campaign.scopeKey)!.races.some(r => r.id === a.raceId)));
  return { context, priorSnapshot, names, latestApprovals, allocationId: d.allocationId === null ? null : uuid(d.allocationId) };
}
export async function captureRewardOperatorRecord(identity: RewardAccountIdentity, scope: RewardRecordSelection,
  input: { priorRaceId: string; idempotencyKey: string }, rpc?: RewardLedgerRpc) {
  const parameters = { ...args(identity, scope), p_prior_race_id: uuid(input.priorRaceId), p_idempotency_key: key(input.idempotencyKey) };
  return decodeRewardRecordCapture(await call("service_capture_reward_operator_record", parameters, rpc), { ...scope, priorRaceId: parameters.p_prior_race_id });
}
export async function approveRewardOperatorRecord(identity: RewardAccountIdentity, scope: RewardRecordSelection,
  input: { candidate: RewardRecordCandidate; expectedRevision: number; idempotencyKey: string }, rpc?: RewardLedgerRpc) {
  const parameters = { ...args(identity, scope), p_prior_snapshot_id: uuid(input.candidate.priorSnapshotId), p_expected_revision: revision(input.expectedRevision),
    p_idempotency_key: key(input.idempotencyKey), p_request: copyRewardLedgerDocument(rewardRecordApprovalRequest(input.candidate)) };
  demand(input.candidate.targetSnapshotId === scope.snapshotId && parameters.p_expected_revision <= 2147483645);
  const saved = decodeRewardRecordApproval(await call("service_approve_reward_operator_record", parameters, rpc), { campaignId: scope.campaignId, actorUserId: identity.userId });
  demand(saved.targetSnapshotId === scope.snapshotId && saved.priorSnapshotId === parameters.p_prior_snapshot_id
    && JSON.stringify(copyRewardLedgerDocument(rewardRecordApprovalRequest({ ...saved.body, targetSnapshotId: saved.targetSnapshotId, priorSnapshotId: saved.priorSnapshotId }))) === JSON.stringify(parameters.p_request));
  return saved;
}
export async function withdrawRewardOperatorRecord(identity: RewardAccountIdentity, scope: RewardRecordSelection,
  input: { approvalId: string; expectedRevision: number; idempotencyKey: string; reason: string }, rpc?: RewardLedgerRpc) {
  demand(typeof input.reason === "string" && input.reason.trim().length >= 8 && input.reason.length <= 4000);
  const p = { ...args(identity, scope), p_approval_id: uuid(input.approvalId), p_expected_revision: revision(input.expectedRevision),
    p_idempotency_key: key(input.idempotencyKey), p_reason: input.reason.trim() };
  demand(p.p_expected_revision > 0);
  const d = object(await call("service_withdraw_reward_operator_record", p, rpc), ["withdrawalId", "approvalId", "campaignId", "withdrawnByUserId", "withdrawnAt", "reason"]);
  demand(d.approvalId === p.p_approval_id && d.campaignId === p.p_campaign_id && d.withdrawnByUserId === p.p_actor_user_id && d.reason === p.p_reason);
  parseRewardSourceTimestamp(d.withdrawnAt);
  return { ...scope, approvalId: p.p_approval_id, withdrawalId: uuid(d.withdrawalId), withdrawnAt: d.withdrawnAt as string };
}
