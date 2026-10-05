import { decodeNativeContinuityDecisionV3, decodeNativeFinaleContinuityV3 } from "@raceson/domain/rewards/native-finale-continuity-v3";
import { decodeNativeFinaleSourceV3 } from "@raceson/domain/rewards/native-finale-source-v3";
import { decodeStoredRewardSnapshot } from "@raceson/domain/rewards/published-preview-v2";
import { decodeSavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { decodeRewardMappingWorkspaceV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { decodeHistoricalSourceDecisionV3 } from "@raceson/domain/rewards/historical-source-v3";
import { programmeApprovalRequestIdV3 as uuid } from "@raceson/domain/rewards/programme-approval-v3";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
function check(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_finale_continuity"); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v));
  check(Object.keys(v).sort().join(",") === [...keys].sort().join(",")); return v as Record<string, unknown>;
}
const safe = new Set(["reward_account_session_required", "reward_planning_not_found", "reward_planning_revision_changed",
  "reward_historical_source_missing", "reward_continuity_conflict", "reward_continuity_not_ready", "invalid_reward_finale_continuity"]);
type Scope = { chainId: 31337 | 10143; draftId: string; requestId: string | null };
type Write = { expectedReviewId: string | null; contextText: string; guardHash: string; selection: unknown; decision: "held" | "confirmed" };
/** Private locked facts only. API calculators derive commitments; callers cannot
 * supply athlete source records, clocks, user IDs or money through HTTP. */
export async function nativeContinuityFactsV3(identity: RewardAccountIdentity, scope: Scope, write?: Write, rpc?: RewardLedgerRpc) {
  check([31337, 10143].includes(scope.chainId));
  const args = { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId), p_chain_id: scope.chainId,
    p_draft_id: uuid(scope.draftId), p_request_id: scope.requestId === null ? null : uuid(scope.requestId) };
  const extra = write ? { p_expected_review_id: write.expectedReviewId === null ? null : uuid(write.expectedReviewId),
    p_context_text: write.contextText, p_source_guard_hash: write.guardHash, p_selection: decodeNativeFinaleContinuityV3(write.selection), p_decision: write.decision } : {};
  let reply;
  try { reply = await (rpc ?? ((name, parameters) => createAdminSupabaseClient().rpc(name, parameters)))(
    write ? "service_review_reward_native_continuity_v3" : "service_read_reward_native_continuity_v3", { ...args, ...extra }); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (reply.error) { const message = (reply.error as { message?: unknown }).message;
    throw new RewardLedgerStoreError(typeof message === "string" && safe.has(message) ? message : "reward_ledger_unavailable"); }
  return decodeNativeContinuityFactsV3(reply.data, scope);
}
/** Reused by the enclosing policy transaction; no second unlocked RPC read. */
export function decodeNativeContinuityFactsV3(data: unknown, scope: Scope) {
  const v = object(data, ["historical", "native", "guardHash", "labels", "review", "recordedReview"]);
  const h = object(v.historical, ["record", "workspace", "snapshot", "sourceHash", "contextHash", "decisions", "observedAt", "recordedDecision"]);
  const record = decodeSavedRewardPlanningDraft(h.record), workspace = decodeRewardMappingWorkspaceV2(h.workspace),
    snapshot = decodeStoredRewardSnapshot(h.snapshot), native = decodeNativeFinaleSourceV3(v.native);
  check(record.draftId === scope.draftId && record.chainId === scope.chainId && workspace.draftId === scope.draftId
    && workspace.rulesRevision === record.revision && native.document.draftId === scope.draftId && native.document.chainId === scope.chainId
    && native.document.organizationId === record.organizationId && native.document.recordRevision === record.revision);
  check(typeof v.guardHash === "string" && /^[0-9a-f]{64}$/.test(v.guardHash) && typeof h.contextHash === "string"
    && /^[0-9a-f]{64}$/.test(h.contextHash) && Array.isArray(h.decisions) && h.decisions.length <= 4);
  const historicalDecisions = h.decisions.map(decodeHistoricalSourceDecisionV3), review = decodeNativeContinuityDecisionV3(v.review),
    recordedReview = decodeNativeContinuityDecisionV3(v.recordedReview);
  check(!recordedReview || recordedReview.id === scope.requestId);
  const labels = object(v.labels, ["athletes", "clubs"]);
  function named(value: unknown) { check(Array.isArray(value) && value.length <= 10000); return value.map(value => {
    const r = object(value, ["id", "name"]); check(typeof r.name === "string" && r.name.length > 0 && r.name.length <= 512);
    return { id: uuid(r.id), name: r.name }; }); }
  return { record, workspace, snapshot, native, historicalContextHash: h.contextHash, historicalDecisions, review, recordedReview,
    guardHash: v.guardHash, labels: { athletes: named(labels.athletes), clubs: named(labels.clubs) } };
}
