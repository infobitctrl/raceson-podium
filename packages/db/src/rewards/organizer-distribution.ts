import { decodeRewardCampaigns, decodeRewardAwardPage, decodeRewardAwardDetail, rewardDistributionUuid as uuid,
  type RewardDistributionScope, type RewardAllocationScope, type RewardAwardScope } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

const safeErrors = new Set(["reward_account_session_required", "reward_operator_permission_required",
  "reward_distribution_scope_required", "invalid_reward_distribution_request"]);
async function request(method: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let result: { data: unknown; error: unknown };
  try { result = await (rpc ?? ((name, input) => createAdminSupabaseClient().rpc(name, input)))(method, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const code = typeof result.error === "object" ? (result.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof code === "string" && safeErrors.has(code) ? code : "reward_ledger_store_failed");
  }
  return result.data;
}
function scope(input: RewardDistributionScope): RewardDistributionScope {
  if (input.chainId !== 10143 && input.chainId !== 31337) throw new RewardLedgerStoreError("invalid_reward_distribution_request");
  return { programmeId: uuid(input.programmeId), chainId: input.chainId };
}
function actor(identity: RewardAccountIdentity) { return { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId) }; }
const args = (input: RewardDistributionScope) => ({ p_programme_id: input.programmeId, p_chain_id: input.chainId });
const allocationArgs = (input: RewardAllocationScope) => ({ ...args(input), p_campaign_id: input.campaignId, p_allocation_id: input.allocationId });
export async function listRewardOperatorCampaigns(identity: RewardAccountIdentity, input: RewardDistributionScope, rpc?: RewardLedgerRpc) {
  const fixed = scope(input), parameters = { ...actor(identity), ...args(fixed) };
  return decodeRewardCampaigns(await request("service_list_reward_operator_campaigns", parameters, rpc), fixed);
}
export async function listRewardOperatorAwards(identity: RewardAccountIdentity, input: RewardAllocationScope & { afterId?: string | null }, rpc?: RewardLedgerRpc) {
  const fixed = { ...scope(input), campaignId: uuid(input.campaignId), allocationId: uuid(input.allocationId) }, after = input.afterId == null ? null : uuid(input.afterId);
  const parameters = { ...actor(identity), ...allocationArgs(fixed), p_after_id: after };
  return decodeRewardAwardPage(await request("service_list_reward_operator_awards", parameters, rpc), fixed, after);
}
export async function readRewardOperatorAward(identity: RewardAccountIdentity, input: RewardAwardScope & { afterId?: string | null }, rpc?: RewardLedgerRpc) {
  const fixed = { ...scope(input), campaignId: uuid(input.campaignId), allocationId: uuid(input.allocationId), entitlementId: uuid(input.entitlementId) },
    after = input.afterId == null ? null : uuid(input.afterId);
  const parameters = { ...actor(identity), ...allocationArgs(fixed), p_entitlement_id: fixed.entitlementId, p_after_id: after };
  return decodeRewardAwardDetail(await request("service_read_reward_operator_award", parameters, rpc), fixed, after);
}
