import { decodeClubAllocationsV3, clubAllocationCursorV3 } from "@raceson/domain/rewards/club-allocations-v3";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentUuid as uuid } from "./stored-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

/** Current club-owner financial history only. It never authorizes execution. */
export async function listRewardClubAllocationsV3(identity: RewardAccountIdentity,
  input: { chainId: 31337 | 10143; clubId: string; after?: string | null }, rpc?: RewardLedgerRpc) {
  const userId = uuid(identity.userId), sessionId = uuid(identity.sessionId), clubId = uuid(input.clubId);
  const after = input.after ?? null, chainId = input.chainId;
  if ((chainId !== 31337 && chainId !== 10143) || (after !== null && !clubAllocationCursorV3(after)))
    throw new RewardLedgerStoreError("invalid_reward_club_allocation_query");
  let result: { data: unknown; error: unknown };
  try { result = await (rpc ?? ((name, args) => createAdminSupabaseClient().rpc(name, args)))("service_list_reward_club_allocations_v3",
    { p_user_id: userId, p_session_id: sessionId, p_chain_id: chainId, p_club_id: clubId, p_after_id: after }); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const code = typeof result.error === "object" ? (result.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof code === "string" && ["reward_account_session_required", "reward_club_owner_required"].includes(code)
      ? code : "reward_ledger_store_failed");
  }
  return decodeClubAllocationsV3(result.data, chainId, clubId, after);
}
