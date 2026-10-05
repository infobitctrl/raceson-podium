import { decodeHistoricalSourceDecisionV3, historicalAllocationSourceV3 } from "@raceson/domain/rewards/historical-source-v3";
import { historicalAllocationSourceV4 } from "@raceson/domain/rewards/historical-source-v4";
import { decodeStoredRewardSnapshot } from "@raceson/domain/rewards/published-preview-v2";
import { requireHistoricalCatalogueV3 } from "@raceson/domain/rewards/historical-catalogue-v3";
import { decodeSavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { decodeRewardMappingWorkspaceV2, validateRewardSourceMappingV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { previewRewardAllocationV3 } from "@raceson/domain/rewards/allocation-preview-v3";
import { programmeApprovalRequestIdV3 } from "@raceson/domain/rewards/programme-approval-v3";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

export type HistoricalSourceChangeV3 = { slot: number; requestId: string; expectedReviewId: string | null;
  contextHash: string; decision: "confirmed_final" | "held" };
const safe = new Set(["reward_account_session_required", "reward_planning_not_found", "reward_planning_revision_changed",
  "reward_historical_source_missing", "invalid_reward_historical_source", "reward_historical_review_conflict"]);
function check(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_historical_source"); }

export async function rewardHistoricalSourceV3(identity: RewardAccountIdentity, chainId: 31337 | 10143, draftId: string,
  change?: HistoricalSourceChangeV3, rpc?: RewardLedgerRpc) {
  const captured = change ? { ...change, requestId: programmeApprovalRequestIdV3(change.requestId),
    expectedReviewId: change.expectedReviewId === null ? null : programmeApprovalRequestIdV3(change.expectedReviewId) } : null;
  if (captured) check(Number.isInteger(captured.slot) && captured.slot >= 1 && captured.slot <= 4 && /^[0-9a-f]{64}$/.test(captured.contextHash)
    && ["confirmed_final", "held"].includes(captured.decision));
  const args = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: chainId,
    p_draft_id: programmeApprovalRequestIdV3(draftId) };
  const invoke = async (name: Parameters<RewardLedgerRpc>[0], extra = {}) => {
    let reply;
    try { reply = await (rpc ?? ((method, parameters) => createAdminSupabaseClient().rpc(method, parameters)))(name, { ...args, ...extra }); }
    catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
    if (reply.error) { const message = (reply.error as { message?: unknown }).message;
      throw new RewardLedgerStoreError(typeof message === "string" && safe.has(message) ? message : "reward_ledger_unavailable"); }
    return decodeHistoricalSourceFactsV3(reply.data, chainId, draftId);
  };
  const current = await invoke("service_read_reward_historical_source_v3");
  if (!captured) return current;
  // SQL recovers old exact decisions even if they are superseded; never replace
  // the caller's expectation with current state. No client source/amount/time is sent.
  const saved = await invoke("service_review_reward_historical_source_v3", { p_slot: captured.slot, p_request_id: captured.requestId,
    p_expected_review_id: captured.expectedReviewId, p_context_hash: captured.contextHash, p_decision: captured.decision });
  check(saved.recordedDecision?.id === captured.requestId && saved.recordedDecision.slot === captured.slot
    && saved.recordedDecision.contextHash === captured.contextHash && saved.recordedDecision.decision === captured.decision);
  return saved;
}

/** Decode facts returned inside an authenticated, source-locked transaction. */
export function decodeHistoricalSourceFactsV3(value: unknown, chainId: 31337 | 10143, draftId: string) {
  check(value && typeof value === "object" && !Array.isArray(value)); const r = value as Record<string, unknown>;
  check(Object.keys(r).sort().join(",") === "contextHash,decisions,observedAt,record,recordedDecision,snapshot,sourceHash,workspace");
  const record = decodeSavedRewardPlanningDraft(r.record), workspace = decodeRewardMappingWorkspaceV2(r.workspace);
  check(record.draftId === draftId && record.chainId === chainId && workspace.draftId === draftId && workspace.rulesRevision === record.revision);
  const snapshot = decodeStoredRewardSnapshot(r.snapshot);
  requireHistoricalCatalogueV3(snapshot, workspace.catalogue);
  validateRewardSourceMappingV2(workspace.mapping, workspace.catalogue);
  check(typeof r.sourceHash === "string" && /^[0-9a-f]{64}$/.test(r.sourceHash) && typeof r.contextHash === "string" && /^[0-9a-f]{64}$/.test(r.contextHash)
    && Array.isArray(r.decisions) && r.decisions.length <= 4 && typeof r.observedAt === "string");
  const decisions = r.decisions.map(decodeHistoricalSourceDecisionV3);
  const source = historicalAllocationSourceV3(snapshot, workspace.mapping, r.contextHash, decisions, r.observedAt);
  const recordedDecision = r.recordedDecision === null ? null : decodeHistoricalSourceDecisionV3(r.recordedDecision);
  if (recordedDecision) check(recordedDecision.current === (recordedDecision.contextHash === r.contextHash));
  return { schema: "raceson-historical-source-v3" as const, record, workspace, sourceHash: r.sourceHash, contextHash: r.contextHash,
    decisions, recordedDecision, source, preview: previewRewardAllocationV3(record.rules, workspace.mapping, source) };
}

/** Same authenticated immutable facts, with version-specific V4 membership semantics. */
export function decodeHistoricalSourceFactsV4(value: unknown, chainId: 31337 | 10143, draftId: string) {
  const {preview: _preview, ...facts} = decodeHistoricalSourceFactsV3(value, chainId, draftId);
  const raw = value as {snapshot: unknown; observedAt: string};
  return {...facts, source: historicalAllocationSourceV4(decodeStoredRewardSnapshot(raw.snapshot), facts.workspace.mapping,
    facts.contextHash, facts.decisions, raw.observedAt)};
}
