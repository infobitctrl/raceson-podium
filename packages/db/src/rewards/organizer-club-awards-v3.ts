import { decodeOrganizerClubAwardsV3, organizerClubCursorV3 } from "@raceson/domain/rewards/organizer-club-awards-v3";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentUuid as uuid } from "./stored-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
export async function listOrganizerClubAwardsV3(identity: RewardAccountIdentity,
  input: { chainId: 31337 | 10143; uploadId: string; after?: string | null }, rpc?: RewardLedgerRpc) {
  const userId = uuid(identity.userId), sessionId = uuid(identity.sessionId), uploadId = uuid(input.uploadId);
  const after = input.after ?? null, chainId = input.chainId;
  if (![31337,10143].includes(chainId) || after !== null && !organizerClubCursorV3(after))
    throw new RewardLedgerStoreError("invalid_reward_organizer_club_query");
  let result: { data: unknown; error: unknown };
  try { result = await (rpc ?? ((name,args) => createAdminSupabaseClient().rpc(name,args)))("service_list_reward_organizer_club_awards_v3",
    { p_user_id: userId, p_session_id: sessionId, p_chain_id: chainId, p_upload_id: uploadId, p_after_id: after }); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = typeof result.error === "object" ? (result.error as Record<string,unknown>).message : null;
    throw new RewardLedgerStoreError(typeof message === "string" && ["reward_account_session_required","reward_club_readiness_scope_required"].includes(message)
      ? message : "reward_ledger_store_failed");
  }
  return decodeOrganizerClubAwardsV3(result.data,chainId,uploadId,after);
}
