import { aggregateRewardEntitlements, parseRewardUnits, requireUnsigned, splitRewardProgramme,
  type RewardAllocationResult, type RewardSourceConfiguration, type RewardAdjudication,
  type RewardPodiumManifest, type RewardRecordDivision } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { decodeRewardConfiguration } from "./stored-documents.js";

export class RewardLedgerStoreError extends Error {
  constructor(readonly code: string) { super(code); this.name = "RewardLedgerStoreError"; }
}
type Json = null | boolean | string | number | Json[] | { [key: string]: Json };
type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
function demand(condition: unknown, code = "invalid_reward_ledger_input"): asserts condition {
  if (!condition) throw new RewardLedgerStoreError(code);
}
function uuid(value: unknown): string {
  demand(typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    && value !== "00000000-0000-0000-0000-000000000000"); return value;
}
function hash(value: unknown): string {
  demand(typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value) && value !== `0x${"0".repeat(64)}`); return value;
}
function address(value: unknown): string {
  demand(typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) && value !== `0x${"0".repeat(40)}`); return value.toLowerCase();
}
function idempotency(value: unknown): string { demand(typeof value === "string" && value.length >= 8 && value.length <= 128); return value; }
function amount(value: unknown): bigint {
  demand(typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value), "invalid_reward_ledger_response");
  try { return parseRewardUnits(value, 0); } catch { throw new RewardLedgerStoreError("invalid_reward_ledger_response"); }
}

/** Private transport copy, NOT the chain's canonical JSON/hash protocol. Reject
 * lossy serializers, getters and unsafe numbers instead of silently saving them. */
export function copyRewardLedgerDocument(input: unknown): Json {
  let nodes = 0; const ancestors = new Set<object>();
  function copy(value: unknown, depth: number): Json {
    demand(depth <= 32 && ++nodes <= 100_000, "reward_ledger_document_too_large");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "bigint") { requireUnsigned(value); return value.toString(); }
    if (typeof value === "number") { demand(Number.isSafeInteger(value) && !Object.is(value, -0)); return value; }
    demand(typeof value === "object" && value !== null && !ancestors.has(value));
    demand(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    demand(Object.getOwnPropertySymbols(value).length === 0);
    ancestors.add(value);
    const fields = Object.getOwnPropertyDescriptors(value);
    let result: Json;
    if (Array.isArray(value)) {
      demand(Object.keys(fields).length === value.length + 1);
      result = Array.from({ length: value.length }, (_, i) => { const field = fields[String(i)]; demand(field && "value" in field); return copy(field.value, depth + 1); });
    } else {
      const entries: [string, Json][] = [];
      for (const name of Object.keys(fields).sort()) { const field = fields[name]; demand(field.enumerable && "value" in field); entries.push([name, copy(field.value, depth + 1)]); }
      result = Object.fromEntries(entries);
    }
    ancestors.delete(value); return result;
  }
  const result = copy(input, 0);
  demand(new TextEncoder().encode(JSON.stringify(result)).length <= 8_388_608, "reward_ledger_document_too_large");
  return result;
}

type LedgerRpcName = "service_reward_controller_result_display" | "service_resolve_reward_sponsor_source_v4" | "service_sponsor_claim_v4" | "service_list_sponsor_claims_v4" | "service_reward_controller_v4"
  | "service_delete_reward_draft"
  | "service_archive_reward_setup"
  | "service_reward_sponsor_lifecycle_v4" | "service_read_reward_sponsor_upload_v4" | "service_prepare_reward_sponsor_upload_v4" | "service_read_reward_sponsor_allocation_v4" | "service_review_reward_sponsor_allocation_v4" | "service_reward_sponsor_auto_deployment" | "service_reward_sponsor_creation_available" | "service_reward_campaign_branding" | "service_reward_public_directory" | "service_reward_public_awards_v4" | "service_reward_public_campaign" | "service_reward_sponsor_execution" | "service_reward_sponsor_launch" | "service_reward_setup_events" | "service_reward_distribution_setups" | "service_reward_programme_creation" | "service_reward_test_programmes" | "service_freeze_reward_proposal_v2" | "service_list_reward_proposals_v2" | "service_read_reward_published_preview_v2" | "service_read_reward_mapping_v2" | "service_save_reward_mapping_v2" | "service_list_reward_planning_drafts" | "service_read_reward_planning_draft" | "service_save_reward_planning_draft"
  | "service_reward_final_publication_v3"
  | "service_read_reward_final_allocation_v3" | "service_approve_reward_final_allocation_v3"
  | "service_read_reward_final_allocation_upload_v3" | "service_prepare_reward_final_allocation_upload_v3"
  | "service_create_reward_programme" | "service_record_reward_sporting_review" | "service_reserve_reward_allocation"
  | "service_read_reward_result_review_v3" | "service_save_reward_result_review_policy_v3"
  | "service_read_reward_programme_approval_v3" | "service_approve_reward_programme_v3"
  | "service_read_reward_historical_source_v3" | "service_review_reward_historical_source_v3"
  | "service_read_reward_participation_review" | "service_save_reward_participation_review"
  | "service_read_reward_finale_v3" | "service_bind_reward_finale_v3"
  | "service_read_reward_native_finale_v3"
  | "service_read_reward_native_continuity_v3" | "service_review_reward_native_continuity_v3"
  | "service_read_reward_league_policy_v3" | "service_review_reward_league_policy_v3"
  | "service_reward_league_publication_v3"
  | "service_read_reward_allocation_approval_v3" | "service_approve_reward_allocation_v3"
  | "service_read_reward_allocation_upload_v3" | "service_prepare_reward_allocation_upload_v3"
  | "service_reward_round_publication_v3"
  | "service_read_reward_programme_lifecycle_v3" | "service_reserve_reward_programme_lifecycle_v3"
  | "service_reserve_reward_programme_activation_v3"
  | "service_read_reward_programme_execution_status_v3"
  | "service_record_reward_programme_lifecycle_attempt_v3"
  | "service_read_reward_programme_lifecycle_job_v3" | "service_queue_reward_programme_lifecycle_job_v3"
  | "service_step_reward_programme_lifecycle_job_v3"
  | "service_read_reward_programme_deployment_v3" | "service_reserve_reward_programme_deployment_v3"
  | "service_read_reward_programme_attempt_v3" | "service_record_reward_programme_attempt_v3"
  | "service_read_reward_programme_job_v3" | "service_queue_reward_programme_job_v3" | "service_step_reward_programme_job_v3" | "service_read_reward_programme_registry_v3"
  | "service_create_reward_wallet_challenge" | "service_read_reward_wallet_challenge" | "service_confirm_reward_wallet_proof" | "service_read_own_reward_awards"
  | "service_read_own_reward_allocations_v3"
  | "service_list_reward_club_allocations_v3"
  | "service_list_reward_organizer_club_awards_v3"
  | "service_read_reward_readiness_v3" | "service_record_reward_readiness_v3" | "service_revoke_reward_readiness_v3"
  | "service_read_reward_club_readiness_v3" | "service_record_reward_club_readiness_v3" | "service_revoke_reward_club_readiness_v3"
  | "service_read_reward_claim_v3" | "service_prepare_reward_claim_v3" | "service_record_reward_claim_proof_v3"
  | "service_read_reward_club_claim_v3" | "service_prepare_reward_club_claim_v3" | "service_record_reward_club_claim_proof_v3"
  | "service_read_reward_athlete_payment_v3" | "service_change_reward_athlete_payment_v3"
  | "service_read_reward_club_payment_v3" | "service_change_reward_club_payment_v3" | "service_read_reward_club_payment_status_v3"
  | "service_read_reward_payment_status_v3"
  | "service_list_own_reward_claims_v3"
  | "service_request_reward_athlete_destination" | "service_read_reward_athlete_destination" | "service_withdraw_reward_athlete_destination"
  | "service_list_reward_athlete_destinations" | "service_list_reward_athlete_claims"
  | "service_request_reward_club_treasury" | "service_read_reward_club_treasury" | "service_list_reward_club_treasuries" | "service_withdraw_reward_club_treasury"
  | "service_list_reward_owned_clubs"
  | "service_read_reward_club_review_context" | "service_record_reward_club_review" | "service_revoke_reward_club_review"
  | "service_read_reward_club_claim_context" | "service_prepare_reward_club_claim"
  | "service_read_reward_club_claim_proofs" | "service_record_reward_club_claim_proof"
  | "service_read_reward_club_signing_context"
  | "service_read_reward_club_payment_context" | "service_reserve_reward_club_payment"
  | "service_record_reward_club_payment_attempt" | "service_read_reward_club_payment_attempt"
  | "service_read_reward_club_payment_job" | "service_queue_reward_club_payment_job"
  | "service_step_reward_club_payment_job" | "service_confirm_reward_club_payment_job"
  | "service_list_reward_operator_club_treasuries" | "service_read_reward_operator_club_treasury"
  | "service_list_reward_operator_programmes" | "service_list_reward_operator_destinations"
  | "service_list_reward_operator_campaigns" | "service_list_reward_operator_awards" | "service_read_reward_operator_award"
  | "service_read_reward_operator_preparation" | "service_check_reward_operator_preparation" | "service_reserve_reward_operator_allocation"
  | "service_read_reward_operator_sporting_context" | "service_capture_reward_operator_source" | "service_record_reward_operator_sporting_review"
  | "service_list_reward_operator_record_races" | "service_read_reward_operator_record_context" | "service_capture_reward_operator_record"
  | "service_approve_reward_operator_record" | "service_withdraw_reward_operator_record"
  | "service_read_reward_athlete_payment_status"
  | "service_read_reward_athlete_review_context" | "service_record_reward_athlete_review" | "service_revoke_reward_athlete_review"
  | "service_read_reward_athlete_claim_context" | "service_prepare_reward_athlete_claim"
  | "service_read_reward_athlete_claim_proofs" | "service_record_reward_athlete_claim_proof"
  | "service_read_reward_athlete_consent_context"
  | "service_read_reward_athlete_payment_context" | "service_reserve_reward_athlete_payment"
  | "service_record_reward_athlete_payment_attempt" | "service_read_reward_athlete_payment_attempt"
  | "service_read_reward_athlete_payment_job" | "service_queue_reward_athlete_payment_job"
  | "service_step_reward_athlete_payment_job" | "service_confirm_reward_athlete_payment_job"
  | "service_read_reward_calculation_context" | "service_read_reward_record_snapshot" | "service_read_reward_record_approval"
  | "service_approve_reward_record" | "service_withdraw_reward_record"
  | "service_read_reward_allocation_export" | "service_save_reward_upload" | "service_check_reward_upload_evidence"
  | "service_read_reward_deployment_context" | "service_reserve_reward_deployment"
  | "service_record_reward_deployment_attempt" | "service_read_reward_deployment_attempt"
  | "service_read_reward_campaign_checkpoint" | "service_record_reward_campaign_checkpoint"
  | "service_queue_reward_deployment_job" | "service_read_reward_deployment_job" | "service_step_reward_deployment_job"
  | "service_read_reward_funding_context" | "service_reserve_reward_funding"
  | "service_read_reward_lifecycle_context" | "service_reserve_reward_lifecycle"
  | "service_record_reward_lifecycle_attempt" | "service_read_reward_lifecycle_attempt"
  | "service_queue_reward_lifecycle_job" | "service_read_reward_lifecycle_job" | "service_step_reward_lifecycle_job" | "service_confirm_reward_lifecycle_job"
  | "service_record_reward_funding_attempt" | "service_read_reward_funding_attempt"
  | "service_queue_reward_funding_job" | "service_read_reward_funding_job" | "service_step_reward_funding_job" | "service_confirm_reward_funding_job";
export type RewardLedgerRpc = (name: "service_reward_demo_copy_claim_reviews" | "service_reward_demo_copy_native_claims" | "service_reward_demo_copy_claim" | "service_reward_demo_copy_native_claim" | "service_reward_demo_copy_athlete_awards" | LedgerRpcName | "service_reward_demo_copy_sponsor" | "service_reward_demo_copy_sponsor_operation" | "service_reward_demo_copy_wallet_operation" | "service_reward_demo_copy_review_sources" | "service_reward_demo_copy_allocation" | "service_reward_demo_copy_upload" | "service_reward_demo_copy_lifecycle" | "service_reward_demo_copy_controller" | "service_reward_demo_copy_controller_transaction" | "service_reward_demo_copy_frozen_setup" | "service_reward_demo_copy_support_settings" | "service_reward_support_settings" | "service_reward_review_issues" | "service_reward_wallet_settings" | "service_reward_wallet_runtime" | "service_sponsor_club_claim_v4" | "service_list_sponsor_club_claims_v4" | "service_reward_controller_transaction" | "service_next_reward_operator_job" | "service_reward_operator_session_call"
  | "service_reward_demo_copy_club_wallet"
  | "service_reward_demo_copy_club_claim" | "service_reward_demo_copy_native_club_claim"
  | "service_reward_demo_copy_club_awards" | "service_reward_demo_copy_club_claim_reviews" | "service_reward_demo_copy_native_club_claims" | "service_reward_demo_copy_public_directory" | "service_reward_demo_copy_public_awards" | "service_reward_demo_copy_public_campaign"
  | "service_reward_demo_copy_beneficiary_wallet" | "service_list_reward_club_awards" | "service_list_reward_club_claims" | "service_read_reward_club_payment_status", args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const safeErrors = new Set([
  "reward_operator_permission_required", "reward_programme_owner_required", "reward_ledger_idempotency_conflict",
  "invalid_reward_programme_request", "invalid_reward_programme_configuration", "reward_programme_round_scope_mismatch",
  "reward_programme_already_configured", "invalid_reward_sporting_review", "reward_review_source_scope_mismatch",
  "reward_review_source_changed", "reward_campaign_allocation_already_reserved", "reward_review_superseded",
  "invalid_reward_allocation", "reward_allocation_campaign_mismatch", "reward_round_has_unresolved_adjudication",
  "reward_allocation_source_coverage_invalid", "unresolved_reward_identity", "invalid_reward_entitlement", "reward_budget_not_conserved",
  "reward_record_approval_omitted", "reward_record_approval_mismatch", "reward_record_approval_withdrawn",
  "reward_record_approval_superseded", "reward_record_source_changed", "reward_record_source_not_ready",
]);
async function call(name: LedgerRpcName, args: Record<string, unknown>, injected?: RewardLedgerRpc): Promise<RecordValue> {
  const rpc: RewardLedgerRpc = injected ?? ((method, parameters) => createAdminSupabaseClient().rpc(method, parameters));
  let result: { data: unknown; error: unknown };
  try { result = await rpc(name, args); } catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = isRecord(result.error) ? result.error.message : null;
    throw new RewardLedgerStoreError(typeof message === "string" && safeErrors.has(message) ? message : "reward_ledger_store_failed");
  }
  demand(isRecord(result.data), "invalid_reward_ledger_response"); return result.data;
}

export type StoredRewardProgramme = {
  programmeId: string; onChainId: string; budgetWei: bigint;
  campaigns: { id: string; scopeKey: string; pot: "race" | "league"; roundIds: string[]; budgetWei: bigint; onChainId: string }[];
};
/** Owner-authorized server operation. Configured budgets are NOT funded balances;
 * public signer addresses/manifest must be independently approved before use. */
export async function createRewardProgramme(input: {
  actorUserId: string; idempotencyKey: string; operatorUserId: string;
  environment: "local_simulation" | "testnet_pilot"; budgetWei: bigint;
  operatorAddress: string; treasuryAddress: string; manifestHash: string;
  configuration: RewardSourceConfiguration;
}, rpc?: RewardLedgerRpc): Promise<StoredRewardProgramme> {
  const actor = uuid(input.actorUserId); const operator = uuid(input.operatorUserId); const requestKey = idempotency(input.idempotencyKey);
  demand(input.environment === "local_simulation" || input.environment === "testnet_pilot");
  requireUnsigned(input.budgetWei); demand(input.budgetWei >= 9n);
  const configuration = copyRewardLedgerDocument(input.configuration);
  try { decodeRewardConfiguration(configuration); }
  catch { throw new RewardLedgerStoreError("invalid_reward_programme_configuration"); }
  demand(isRecord(configuration) && Array.isArray(configuration.rounds));
  const roundIds = configuration.rounds.map((round) => { demand(isRecord(round)); return uuid(round.id); }).sort();
  const expected = splitRewardProgramme(input.budgetWei, roundIds); const expectedBudget = input.budgetWei;
  const request = { organizationId: uuid(configuration.organizationId), seasonId: uuid(configuration.seasonId), operatorUserId: operator,
    environment: input.environment, chainId: input.environment === "local_simulation" ? 31337 : 10143,
    roundIds, budgetWei: expectedBudget.toString(), operatorAddress: address(input.operatorAddress), treasuryAddress: address(input.treasuryAddress),
    manifestHash: hash(input.manifestHash), configuration };
  const response = await call("service_create_reward_programme", { p_actor_user_id: actor, p_idempotency_key: requestKey, p_request: request }, rpc);
  const programmeId = uuid(response.programmeId); const onChainId = hash(response.onChainId);
  demand(amount(response.budgetWei) === expectedBudget && Array.isArray(response.campaigns) && response.campaigns.length === 6, "invalid_reward_ledger_response");
  const ids = new Set([programmeId]); const hashes = new Set([onChainId]); const scopes = new Set<string>();
  const campaigns = response.campaigns.map((raw) => {
    demand(isRecord(raw), "invalid_reward_ledger_response");
    const id = uuid(raw.id); const chainId = hash(raw.onChainId);
    demand(!ids.has(id) && !hashes.has(chainId), "invalid_reward_ledger_response"); ids.add(id); hashes.add(chainId);
    demand(typeof raw.scopeKey === "string" && !scopes.has(raw.scopeKey) && Array.isArray(raw.roundIds), "invalid_reward_ledger_response"); scopes.add(raw.scopeKey);
    const expectedRound = expected.rounds.find((round) => round.key === raw.scopeKey);
    const pot: "race" | "league" = expectedRound ? "race" : "league";
    demand(raw.pot === pot && (expectedRound || raw.scopeKey === "rounds-1-5"), "invalid_reward_ledger_response");
    const campaignRounds = raw.roundIds.map(uuid);
    demand(JSON.stringify(campaignRounds) === JSON.stringify(expectedRound ? [expectedRound.key] : roundIds)
      && amount(raw.budgetWei) === (expectedRound?.amount ?? expected.leagueBudget), "invalid_reward_ledger_response");
    return { id, scopeKey: raw.scopeKey, pot, roundIds: campaignRounds, budgetWei: amount(raw.budgetWei), onChainId: chainId };
  });
  return { programmeId, onChainId, budgetWei: expectedBudget, campaigns };
}

export type RewardSportingReviewBody = {
  schemaVersion: 1;
  adjudications: readonly RewardAdjudication[];
  roundReviews: readonly { roundId: string; podiums: readonly RewardPodiumManifest[]; records: readonly RewardRecordDivision[];
    memberships: readonly { sourceId: string; classificationIds: readonly string[]; evidenceId: string }[] }[];
};
/** Caller validates sporting content with the domain adapter before recording.
 * SQL checks the designated operator and fresh exact source/campaign scope. */
export async function recordRewardSportingReview(input: {
  campaignId: string; snapshotId: string; actorUserId: string; idempotencyKey: string; review: RewardSportingReviewBody;
}, rpc?: RewardLedgerRpc) {
  const campaignId = uuid(input.campaignId); const snapshotId = uuid(input.snapshotId);
  demand(input.review.schemaVersion === 1 && Array.isArray(input.review.adjudications) && Array.isArray(input.review.roundReviews));
  const response = await call("service_record_reward_sporting_review", { p_campaign_id: campaignId, p_source_snapshot_id: snapshotId,
    p_actor_user_id: uuid(input.actorUserId), p_idempotency_key: idempotency(input.idempotencyKey), p_review: copyRewardLedgerDocument(input.review) }, rpc);
  demand(response.campaignId === campaignId && response.snapshotId === snapshotId && Number.isSafeInteger(response.revision)
    && (response.revision as number) > 0 && typeof response.reviewedAt === "string" && Number.isFinite(Date.parse(response.reviewedAt)), "invalid_reward_ledger_response");
  return { reviewId: uuid(response.reviewId), campaignId, snapshotId, revision: response.revision as number, reviewedAt: response.reviewedAt };
}

/** A calculated result, never browser-provided amounts. selectedSourceIds comes
 * from selectRewardFinishes, not award breakdowns (non-winners still count). */
export function rewardAllocationRequest(input: {
  result: RewardAllocationResult; selectedSourceIds: readonly string[];
}) {
  const selectedSourceIds = input.selectedSourceIds.map(uuid).sort();
  demand(selectedSourceIds.length <= 20_000 && new Set(selectedSourceIds).size === selectedSourceIds.length);
  const result = input.result; const aggregates = aggregateRewardEntitlements(result);
  demand(selectedSourceIds.every((id) => !result.excludedSourceIds.includes(id))
    && aggregates.every((row) => row.breakdown.every((award) => award.sourceIds.every((id) => selectedSourceIds.includes(id)))));
  return copyRewardLedgerDocument({ programmeId: uuid(result.programmeId), campaignScopeId: result.campaignScopeId,
    pot: result.pot, budgetWei: result.budgetWei, unallocatedWei: result.unallocatedWei, selectedSourceIds,
    calculation: result, entitlements: aggregates.map((row) => ({ kind: row.beneficiaryKind, entityId: uuid(row.beneficiaryId),
      amountWei: row.amountWei, explanation: row })) });
}

export async function reserveRewardAllocation(input: {
  reviewId: string; actorUserId: string; idempotencyKey: string;
  result: RewardAllocationResult; selectedSourceIds: readonly string[];
}, rpc?: RewardLedgerRpc) {
  const reviewId = uuid(input.reviewId); const payload = rewardAllocationRequest(input);
  const aggregates = aggregateRewardEntitlements(input.result);
  const allocated = aggregates.reduce((sum, row) => sum + row.amountWei, 0n); const unallocated = input.result.unallocatedWei;
  const response = await call("service_reserve_reward_allocation", { p_review_id: reviewId, p_actor_user_id: uuid(input.actorUserId),
    p_idempotency_key: idempotency(input.idempotencyKey), p_allocation: payload }, rpc);
  demand(response.reviewId === reviewId && amount(response.allocatedWei) === allocated && amount(response.unallocatedWei) === unallocated
    && response.entitlementCount === aggregates.length && typeof response.reservedAt === "string"
    && Number.isFinite(Date.parse(response.reservedAt)), "invalid_reward_ledger_response");
  return { allocationId: uuid(response.allocationId), campaignId: uuid(response.campaignId), reviewId, allocatedWei: allocated,
    unallocatedWei: unallocated, entitlementCount: aggregates.length, reservedAt: response.reservedAt };
}
