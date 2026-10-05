import { createHash } from "node:crypto";
import { decodeNativeFinaleSourceV3, inspectNativeFinaleSourceV3 } from "@raceson/domain/rewards/native-finale-source-v3";
import { programmeApprovalRequestIdV3 as uuid } from "@raceson/domain/rewards/programme-approval-v3";
import { canonicalRewardJson } from "@raceson/rewards-chain";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

export async function readNativeFinaleSourceV3(identity: RewardAccountIdentity, chainId: 31337 | 10143, draftId: string, rpc?: RewardLedgerRpc) {
  const args = { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId), p_chain_id: chainId, p_draft_id: uuid(draftId) };
  if (![31337, 10143].includes(chainId)) throw new RewardLedgerStoreError("invalid_reward_native_finale");
  let result;
  try { result = await (rpc ?? ((name, body) => createAdminSupabaseClient().rpc(name, body)))("service_read_reward_native_finale_v3", args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = (result.error as { message?: string }).message;
    throw new RewardLedgerStoreError(message && ["reward_planning_not_found", "reward_account_session_required", "reward_planning_revision_changed",
      "reward_native_finale_too_large"].includes(message) ? message : "reward_ledger_unavailable");
  }
  const source = decodeNativeFinaleSourceV3(result.data);
  if (source.document.draftId !== draftId || source.document.chainId !== chainId) throw new RewardLedgerStoreError("invalid_reward_native_finale");
  return { ...source, sourceHash: createHash("sha256").update(canonicalRewardJson(source.document)).digest("hex"), inspection: inspectNativeFinaleSourceV3(source) };
}
