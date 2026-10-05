import { decodeClubPortalPage, decodeClubRewardAward, decodeClubRewardClaim } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentUuid as uuid } from "./stored-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

export async function rewardClubPortalRead(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let response; try { response = await (rpc ?? ((method, params) => createAdminSupabaseClient().rpc(method, params)))(name, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (response.error) {
    const code = typeof response.error === "object" ? (response.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof code === "string" && ["reward_account_session_required", "reward_club_owner_required",
      "reward_payment_status_not_found", "invalid_reward_club_portal_request", "invalid_reward_payment_status_document"].includes(code) ? code : "reward_ledger_store_failed");
  } return response.data;
}
export function rewardClubPortalScope(identity: RewardAccountIdentity, chainId: 31337 | 10143) {
  if (chainId !== 31337 && chainId !== 10143) throw new RewardLedgerStoreError("invalid_reward_club_portal_request");
  return { p_user_id: uuid(identity.userId), p_session_id: uuid(identity.sessionId), p_chain_id: chainId };
}
export async function listRewardClubAwards(identity: RewardAccountIdentity, input: { chainId: 31337 | 10143; clubId: string; afterId?: string | null }, rpc?: RewardLedgerRpc) {
  const args = rewardClubPortalScope(identity, input.chainId), clubId = uuid(input.clubId), after = input.afterId == null ? null : uuid(input.afterId);
  const raw = await rewardClubPortalRead("service_list_reward_club_awards", { ...args, p_club_id: clubId, p_after_id: after }, rpc);
  return decodeClubPortalPage(raw, after, v => { const r = decodeClubRewardAward(v, args.p_chain_id);
    if (r.clubId !== clubId) throw new RewardLedgerStoreError("invalid_reward_club_portal_document"); return r; }, r => r.entitlementId);
}
export async function listRewardClubClaims(identity: RewardAccountIdentity, input: { chainId: 31337 | 10143; afterId?: string | null }, rpc?: RewardLedgerRpc) {
  const args = rewardClubPortalScope(identity, input.chainId), after = input.afterId == null ? null : uuid(input.afterId);
  const raw = await rewardClubPortalRead("service_list_reward_club_claims", { ...args, p_after_id: after }, rpc);
  return decodeClubPortalPage(raw, after, v => decodeClubRewardClaim(v, args.p_chain_id), r => r.intentId);
}
