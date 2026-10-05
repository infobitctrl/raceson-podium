import { createHash } from "node:crypto";
import { decodeAllocationDocumentV3 } from "@raceson/domain/rewards/allocation-approval-v3";
import { decodeHistoricalSourceDecisionV3 } from "@raceson/domain/rewards/historical-source-v3";
import { canonicalRewardProposalV2 } from "@raceson/domain/rewards/frozen-proposal-v2";
import { createAdminSupabaseClient } from "../supabase.js";
import { decodeProgrammeDeploymentV3 } from "./programme-deployment-v3.js";
import { decodeProgrammeProvenanceV3 } from "./programme-jobs-v3.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid } from "./stored-documents.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

function check(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_allocation_approval"); }
const hash = (v: unknown) => { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v; };
export const allocationDocumentHashV3 = (v: unknown) => createHash("sha256").update(canonicalRewardProposalV2(v)).digest("hex");
export type AllocationApprovalScopeV3 = { chainId: 31337 | 10143; draftId: string; slot: number; requestId?: string };
export type AllocationApprovalChangeV3 = { requestId: string; expectedApprovalId: string | null; contextHash: string; documentHash: string };
const safe = new Set(["reward_account_session_required", "reward_planning_not_found", "reward_historical_source_missing",
  "invalid_reward_allocation_approval", "reward_allocation_approval_conflict", "reward_allocation_not_ready", "reward_planning_revision_changed"]);
function decodeApproval(value: unknown, scope: AllocationApprovalScopeV3, contextHash: string) {
  if (value === null) return null;
  const r = object(value, ["id", "previousApprovalId", "contextHash", "documentHash", "document", "approvedAt", "approvedByUserId", "current"]);
  const document = decodeAllocationDocumentV3(r.document);
  check(document.record.draftId === scope.draftId && document.record.chainId === scope.chainId && document.slot === scope.slot
    && r.current === (r.contextHash === contextHash) && typeof r.approvedAt === "string" && Number.isFinite(Date.parse(r.approvedAt))
    && allocationDocumentHashV3(document) === r.documentHash);
  return { id: uuid(r.id), previousApprovalId: r.previousApprovalId === null ? null : uuid(r.previousApprovalId),
    contextHash: hash(r.contextHash), documentHash: hash(r.documentHash), document, approvedAt: r.approvedAt,
    approvedByUserId: uuid(r.approvedByUserId), current: r.current as boolean };
}
async function invoke(identity: RewardAccountIdentity, scope: AllocationApprovalScopeV3,
  change?: { expectedApprovalId: string | null; contextHash: string; document: unknown; funding: unknown }, rpc?: RewardLedgerRpc) {
  check(scope.chainId === 31337 || scope.chainId === 10143); check(Number.isInteger(scope.slot) && scope.slot >= 1 && scope.slot <= 4);
  const args = { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId), p_chain_id: scope.chainId,
    p_draft_id: uuid(scope.draftId), p_slot: scope.slot, p_request_id: scope.requestId ? uuid(scope.requestId) : null };
  if (change) check(args.p_request_id !== null);
  if (change) decodeAllocationDocumentV3(change.document);
  let result;
  try { result = await (rpc ?? ((fn, body) => createAdminSupabaseClient().rpc(fn, body)))(change ? "service_approve_reward_allocation_v3" : "service_read_reward_allocation_approval_v3", {
    ...args, ...(change ? { p_expected_approval_id: change.expectedApprovalId === null ? null : uuid(change.expectedApprovalId),
      p_context_hash: hash(change.contextHash), p_document_text: canonicalRewardProposalV2(copy(change.document)), p_funding: copy(change.funding) } : {}) }); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) { const m = (result.error as { message?: unknown }).message; throw new RewardLedgerStoreError(typeof m === "string" && safe.has(m) ? m : "reward_ledger_unavailable"); }
  const r = object(result.data, ["contextHash", "sourceContextHash", "decision", "registry", "approval", "recorded"]);
  const contextHash = hash(r.contextHash), sourceContextHash = hash(r.sourceContextHash);
  const raw = object(r.registry, ["schema", "context", "registry"]); check(raw.schema === "raceson-programme-registry-v3");
  const context = decodeProgrammeDeploymentV3(raw.context); check(context.approvalView.record.draftId === scope.draftId && context.approvalView.record.chainId === scope.chainId);
  const registry = raw.registry === null ? null : object(raw.registry, ["jobId", "intentId", "attemptId", "provenance", "recordedAt"]);
  const provenance = registry ? decodeProgrammeProvenanceV3(registry.provenance) : null;
  if (registry) check(registry.intentId === context.intent?.id && provenance?.chainId === scope.chainId);
  const decision = r.decision === null ? null : decodeHistoricalSourceDecisionV3(r.decision);
  if (decision) check(decision.slot === scope.slot && decision.current === (decision.contextHash === sourceContextHash));
  const approval = decodeApproval(r.approval, scope, contextHash), recorded = decodeApproval(r.recorded, scope, contextHash);
  if (recorded) check(recorded.id === args.p_request_id && recorded.approvedByUserId === args.p_actor_user_id);
  return { contextHash, sourceContextHash, decision, context, provenance, approval, recorded };
}
export const readAllocationApprovalV3 = (identity: RewardAccountIdentity, scope: AllocationApprovalScopeV3, rpc?: RewardLedgerRpc) => invoke(identity, scope, undefined, rpc);
export const storeAllocationApprovalV3 = (identity: RewardAccountIdentity, scope: AllocationApprovalScopeV3,
  change: { expectedApprovalId: string | null; contextHash: string; document: unknown; funding: unknown }, rpc?: RewardLedgerRpc) => invoke(identity, scope, change, rpc);
