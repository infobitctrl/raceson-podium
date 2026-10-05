import { decodeRewardResultReviewV3 } from "@raceson/domain/rewards/result-review-v3";
import { createAdminSupabaseClient } from "../supabase.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";

const safe = new Set(["reward_account_session_required", "reward_result_review_not_found", "reward_result_review_revision_changed",
  "reward_result_review_locked", "invalid_reward_result_review"]);
export async function rewardResultReviewV3(identity: RewardAccountIdentity, categoryId: string,
  change?: { expectedRevision: number; reviewSeconds: number }, rpc?: RewardLedgerRpc) {
  const captured = change ? { ...change } : undefined;
  const args = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_category_id: categoryId,
    ...(captured ? { p_expected_revision: captured.expectedRevision, p_review_seconds: captured.reviewSeconds } : {}) };
  let result;
  try { result = await (rpc ?? ((name, input) => createAdminSupabaseClient().rpc(name, input)))(captured
    ? "service_save_reward_result_review_policy_v3" : "service_read_reward_result_review_v3", args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = (result.error as { message?: unknown }).message;
    throw new RewardLedgerStoreError(typeof message === "string" && safe.has(message) ? message : "reward_ledger_unavailable");
  }
  const value = decodeRewardResultReviewV3(result.data);
  if (value.categoryId !== categoryId || (captured && (value.reviewSeconds !== captured.reviewSeconds
    || ![captured.expectedRevision, captured.expectedRevision + 1].includes(value.revision))))
    throw new RewardLedgerStoreError("invalid_reward_result_review_response");
  return value;
}
