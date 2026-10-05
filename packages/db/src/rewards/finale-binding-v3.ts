import { decodeFinaleBindingChangeV3, decodeFinaleBindingViewV3, type FinaleBindingChangeV3 } from "@raceson/domain/rewards/finale-binding-v3";
import { programmeApprovalRequestIdV3 } from "@raceson/domain/rewards/programme-approval-v3";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

export async function rewardFinaleBindingV3(identity: RewardAccountIdentity, chainId: 31337 | 10143, draftId: string,
  change?: FinaleBindingChangeV3, rpc?: RewardLedgerRpc) {
  const args = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: chainId,
    p_draft_id: programmeApprovalRequestIdV3(draftId) };
  const c = change && decodeFinaleBindingChangeV3(change);
  let result;
  try { result = await (rpc ?? ((name, body) => createAdminSupabaseClient().rpc(name, body)))(
    c ? "service_bind_reward_finale_v3" : "service_read_reward_finale_v3", { ...args, ...(c ? {
      p_request_id: c.requestId, p_expected_binding_id: c.expectedBindingId, p_context_hash: c.contextHash,
      p_edition_id: c.editionId, p_races: c.races } : {}) }); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = (result.error as { message?: string }).message;
    throw new RewardLedgerStoreError(message && ["reward_account_session_required", "reward_planning_not_found", "reward_planning_revision_changed",
      "reward_historical_source_missing", "invalid_reward_finale", "reward_finale_conflict", "reward_finale_locked"].includes(message)
      ? message : "reward_ledger_unavailable");
  }
  const view = decodeFinaleBindingViewV3({ ...(result.data as object), ...(!c ? { recordedId: null } : {}) });
  if (view.chainId !== chainId || view.draftId !== draftId || (c && view.recordedId !== c.requestId)) throw new RewardLedgerStoreError("invalid_reward_finale");
  return view;
}
