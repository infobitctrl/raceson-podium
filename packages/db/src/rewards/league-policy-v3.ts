import { decodeLeaguePolicyDecisionV3, decodeLeagueScoringPolicyV3 } from "@raceson/domain/rewards/league-standings-v3";
import { programmeApprovalRequestIdV3 as uuid } from "@raceson/domain/rewards/programme-approval-v3";
import { createAdminSupabaseClient } from "../supabase.js";
import { decodeNativeContinuityFactsV3 } from "./native-continuity-v3.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
const safe = new Set(["reward_account_session_required", "reward_planning_not_found", "reward_planning_revision_changed",
  "reward_historical_source_missing", "reward_league_policy_conflict", "invalid_reward_league_policy"]);
export async function leaguePolicyFactsV3(identity: RewardAccountIdentity, scope: { chainId: 31337 | 10143; draftId: string; requestId: string | null },
  write?: { expectedReviewId: string | null; contextText: string; guardHash: string; policy: unknown; decision: "selected" | "held" }, rpc?: RewardLedgerRpc) {
  if (![31337, 10143].includes(scope.chainId)) throw new RewardLedgerStoreError("invalid_reward_league_policy");
  const args = { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId), p_chain_id: scope.chainId,
    p_draft_id: uuid(scope.draftId), p_request_id: scope.requestId === null ? null : uuid(scope.requestId),
    ...(write ? { p_expected_review_id: write.expectedReviewId === null ? null : uuid(write.expectedReviewId), p_context_text: write.contextText,
      p_source_guard_hash: write.guardHash, p_policy: decodeLeagueScoringPolicyV3(write.policy), p_decision: write.decision } : {}) };
  let result;
  try { result = await (rpc ?? ((name, params) => createAdminSupabaseClient().rpc(name, params)))(
    write ? "service_review_reward_league_policy_v3" : "service_read_reward_league_policy_v3", args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) { const message = (result.error as { message?: unknown }).message;
    throw new RewardLedgerStoreError(typeof message === "string" && safe.has(message) ? message : "reward_ledger_unavailable"); }
  return decodeLeaguePolicyFactsV3(result.data, scope);
}
export function decodeLeaguePolicyFactsV3(value: unknown, scope: {chainId:31337|10143;draftId:string;requestId:string|null}) {
  const v = value as Record<string, unknown>;
  if (!v || typeof v !== "object" || Object.keys(v).sort().join(",") !== "facts,guardHash,recordedReview,review"
    || typeof v.guardHash !== "string" || !/^[0-9a-f]{64}$/.test(v.guardHash)) throw new RewardLedgerStoreError("reward_ledger_unavailable");
  const facts = decodeNativeContinuityFactsV3(v.facts, { ...scope, requestId: null });
  const review = decodeLeaguePolicyDecisionV3(v.review), recordedReview = decodeLeaguePolicyDecisionV3(v.recordedReview);
  if (recordedReview && recordedReview.id !== scope.requestId) throw new RewardLedgerStoreError("reward_ledger_unavailable");
  return { facts, review, recordedReview, guardHash: v.guardHash };
}
