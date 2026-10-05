import { decodeAthleteAllocationsV3, athleteAllocationCursorV3 } from "@raceson/domain/rewards/athlete-allocations-v3";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentUuid as uuid } from "./stored-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

export async function readOwnRewardAllocationsV3(identity: RewardAccountIdentity, chainId: 10143 | 31337,
  after: string | null = null, rpc?: RewardLedgerRpc) {
  const userId = uuid(identity.userId), sessionId = uuid(identity.sessionId);
  if ((chainId !== 10143 && chainId !== 31337) || (after !== null && !athleteAllocationCursorV3(after)))
    throw new RewardLedgerStoreError("invalid_reward_allocation_query");
  let result: { data: unknown; error: unknown };
  try { result = await (rpc ?? ((name, args) => createAdminSupabaseClient().rpc(name, args)))("service_read_own_reward_allocations_v3",
    { p_user_id: userId, p_session_id: sessionId, p_chain_id: chainId, p_after_id: after }); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = typeof result.error === "object" ? (result.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(message === "reward_account_session_required" ? message : "reward_ledger_store_failed");
  }
  return decodeAthleteAllocationsV3(result.data, chainId, after);
}
