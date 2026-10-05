import { parseRewardUnits, type RewardAllocationResult, type RewardDistributionScope } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { rewardAllocationRequest, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { decodeRewardCalculationContext } from "./calculation-context.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid } from "./stored-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
import { copyRewardSourceDocument } from "./source-documents.js";

export type RewardPreparationScope = RewardDistributionScope & { campaignId: string };
const safe = new Set(["reward_account_session_required", "reward_operator_permission_required", "reward_distribution_scope_required",
  "reward_preparation_scope_required", "reward_calculation_reference_mismatch", "reward_campaign_allocation_already_reserved",
  "reward_review_superseded", "reward_review_source_changed", "reward_round_has_unresolved_adjudication", "reward_ledger_idempotency_conflict",
  "reward_record_approval_omitted", "reward_record_approval_withdrawn", "reward_record_approval_superseded", "reward_record_source_changed", "reward_record_source_not_ready"]);
function demand(value: unknown): asserts value { if (!value) throw new RewardLedgerStoreError("invalid_reward_preparation_document"); }
function args(identity: RewardAccountIdentity, scope: RewardPreparationScope) {
  demand(scope.chainId === 10143 || scope.chainId === 31337);
  return { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId),
    p_programme_id: uuid(scope.programmeId), p_chain_id: scope.chainId, p_campaign_id: uuid(scope.campaignId) };
}
async function call(name: Parameters<RewardLedgerRpc>[0], input: Record<string, unknown>, injected?: RewardLedgerRpc) {
  let result;
  try { result = await (injected ?? ((method, p) => createAdminSupabaseClient().rpc(method, p)))(name, input); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const code = typeof result.error === "object" ? (result.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof code === "string" && safe.has(code) ? code : "reward_ledger_store_failed");
  }
  return copyRewardSourceDocument(result.data);
}
export async function checkRewardPreparationAccess(identity: RewardAccountIdentity, scope: RewardPreparationScope, rpc?: RewardLedgerRpc) {
  const input = args(identity, scope);
  const d = object(await call("service_check_reward_operator_preparation", input, rpc), ["programmeId", "chainId", "campaignId"]);
  demand(d.programmeId === input.p_programme_id && d.chainId === input.p_chain_id && d.campaignId === input.p_campaign_id);
}
/** Private calculation bundle; NEVER an HTTP response. SQL captures bounded
 * record approvals with the selected review; the calculator re-verifies them. */
export async function readRewardOperatorPreparation(identity: RewardAccountIdentity, scope: RewardPreparationScope, reviewId: string | null, rpc?: RewardLedgerRpc) {
  const input = { ...args(identity, scope), p_review_id: reviewId === null ? null : uuid(reviewId) };
  const d = object(await call("service_read_reward_operator_preparation", input, rpc),
    ["programmeId", "chainId", "campaignId", "budgetWei", "latestReviewId", "allocationId", "context", "recordApprovals", "names"]);
  demand(d.programmeId === input.p_programme_id && d.chainId === input.p_chain_id && d.campaignId === input.p_campaign_id);
  demand(typeof d.budgetWei === "string" && /^[1-9][0-9]{0,77}$/.test(d.budgetWei)); parseRewardUnits(d.budgetWei, 0);
  const latestReviewId = d.latestReviewId === null ? null : uuid(d.latestReviewId), allocationId = d.allocationId === null ? null : uuid(d.allocationId);
  const selected = input.p_review_id ?? latestReviewId;
  demand((d.context === null) === (selected === null));
  const context = selected === null ? null : decodeRewardCalculationContext(d.context,
    { campaignId: input.p_campaign_id, actorUserId: input.p_actor_user_id, reviewId: selected });
  demand(!context || (context.programme.id === input.p_programme_id && context.programme.chainId === input.p_chain_id
    && context.campaign.budgetWei.toString() === d.budgetWei));
  demand(Array.isArray(d.recordApprovals) && d.recordApprovals.length <= 4 && Array.isArray(d.names) && d.names.length <= 40_000);
  const recordApprovals = d.recordApprovals as Record<string, unknown>[];
  demand(recordApprovals.every(a => a !== null && typeof a === "object" && typeof a.approvalId === "string")
    && new Set(recordApprovals.map(a => uuid(a.approvalId))).size === recordApprovals.length);
  const names = d.names.map(raw => {
    const n = object(raw, ["kind", "id", "name"]); demand(n.kind === "athlete" || n.kind === "club");
    demand(n.name === null || (typeof n.name === "string" && n.name.trim() === n.name && n.name.length > 0 && [...n.name].length <= 256));
    return { kind: n.kind, id: uuid(n.id), name: n.name as string | null };
  });
  demand(new Set(names.map(n => `${n.kind}:${n.id}`)).size === names.length);
  if (!context) demand(recordApprovals.length === 0 && names.length === 0 && allocationId === null);
  return { budgetWei: d.budgetWei, latestReviewId, allocationId, context, recordApprovals, names };
}
export async function reserveOperatorRewardAllocation(identity: RewardAccountIdentity, scope: RewardPreparationScope,
  input: { reviewId: string; idempotencyKey: string; result: RewardAllocationResult; selectedSourceIds: readonly string[] }, rpc?: RewardLedgerRpc) {
  const parameters = args(identity, scope), reviewId = uuid(input.reviewId), idempotencyKey = input.idempotencyKey;
  demand(typeof idempotencyKey === "string" && idempotencyKey.length >= 8 && idempotencyKey.length <= 128);
  const allocation = rewardAllocationRequest(input) as Record<string, unknown>;
  demand(allocation.programmeId === parameters.p_programme_id);
  const d = object(await call("service_reserve_reward_operator_allocation", { ...parameters, p_review_id: reviewId,
    p_idempotency_key: idempotencyKey, p_allocation: allocation }, rpc),
    ["allocationId", "campaignId", "reviewId", "allocatedWei", "unallocatedWei", "entitlementCount", "reservedAt"]);
  demand(d.campaignId === parameters.p_campaign_id && d.reviewId === reviewId
    && d.allocatedWei === (BigInt(allocation.budgetWei as string) - BigInt(allocation.unallocatedWei as string)).toString()
    && d.unallocatedWei === allocation.unallocatedWei && d.entitlementCount === (allocation.entitlements as unknown[]).length);
  return d;
}
