import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { literal } from "./reward-integration-fixture.mjs";

// Test-only transport. It can address only its parent validator's scratch DB.
export function openRewardTestDatabase([psql, host, database], { chainRehearsal = false } = {}) {
  assert.ok(psql?.startsWith("/") && psql.endsWith("/psql"), "explicit local psql binary required");
  assert.ok(["127.0.0.1", "::1"].includes(host), "reward integration requires loopback");
  assert.equal(database, `sitrail_validation_${process.ppid}${chainRehearsal === true ? '_chain' : ''}`, "only the parent validator's disposable database is permitted");
  const appName = `reward-test-${randomUUID()}`;
  const children = new Set();
  // Ignore connection/service/password/host-address environment overrides and
  // psqlrc. Never fall back to a linked Supabase URL or a public Postgres target.
  const env = { PATH: process.env.PATH, LANG: "C", PGAPPNAME: appName, PGCONNECT_TIMEOUT: "5" };
  function connection() {
    const child = spawn(psql, ["-X", "--no-password", "-h", host, "-p", "5432", "-d", database,
      "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1"], { env, stdio: ["pipe", "pipe", "pipe"] });
    children.add(child); child.once("close", () => children.delete(child)); return child;
  }
  async function query(sql) {
    const child = connection(); let output = ""; let error = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 30000);
    child.stdout.on("data", (data) => { output += data; if (output.length > 16 * 1024 * 1024) child.kill("SIGTERM"); });
    child.stderr.on("data", (data) => { error += data; });
    const done = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve(output.trim());
        else { const failure = new Error(error.trim() || `reward test connection terminated (exit=${code}, signal=${signal ?? "none"})`);
          failure.code = /ERROR:\s+([^\n]+)/.exec(error)?.[1] ?? "reward_test_sql_failed"; reject(failure); }
      });
    });
    child.stdin.end(`set timezone='UTC'; set statement_timeout='20s'; set lock_timeout='15s';\n${sql}\n`);
    return done;
  }
  const scalar = async (sql) => JSON.parse(await query(`select to_jsonb(value) from (${sql}) as row(value);`));
  const methods = {
    service_reward_review_issues:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_setup_id:"uuid",p_slot:"integer",p_change:"jsonb"},
    service_reward_demo_copy_review_issues:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_setup_id:"uuid",p_slot:"integer",p_change:"jsonb"},
    service_reward_support_settings:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_change:"jsonb"},
    service_resolve_reward_sponsor_source_v4:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_source_league_id:"uuid",p_source_season_id:"uuid",p_event_edition_id:"uuid",p_setup_id:"uuid"},
    service_reward_controller_transaction:{p_subject:"text",p_sender:"text",p_action:"text",p_id:"uuid",p_context:"jsonb",p_transaction:"jsonb",p_signed:"text",p_hash:"text"},
    service_reward_sponsor_auto_deployment:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_setup_id:"uuid",p_action:"text",p_lease_id:"uuid",p_sender:"text",p_transaction:"jsonb",p_signed_transaction:"text",p_transaction_hash:"text"},
    service_delete_reward_draft:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_setup_id:"uuid",p_expected_revision:"integer"},
    service_archive_reward_setup:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_setup_id:"uuid",p_expected_revision:"integer",p_archived:"boolean"},
    service_sponsor_club_claim_v4:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_claim_id:"uuid",p_role:"text",p_action:"text",p_body_text:"text"},
    service_list_sponsor_club_claims_v4:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_approval_id:"uuid"},
    service_sponsor_claim_v4:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_claim_id:"uuid",p_role:"text",p_action:"text",p_body_text:"text"},
    service_list_sponsor_claims_v4:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_approval_id:"uuid"},
    service_reward_sponsor_lifecycle_v4:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_setup_id:"uuid",p_slot:"integer",p_approval_id:"uuid",p_request_id:"uuid",p_kind:"text",p_body_text:"text"},
    service_read_reward_sponsor_allocation_v4:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_setup_id:"uuid",p_slot:"integer",p_request_id:"uuid"},
    service_review_reward_sponsor_allocation_v4:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_setup_id:"uuid",p_slot:"integer",p_request_id:"uuid",p_expected_approval_id:"uuid",p_context_hash:"text",p_document_text:"text",p_decision:"text"},
    service_read_reward_sponsor_upload_v4:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_setup_id:"uuid",p_slot:"integer",p_approval_id:"uuid"},
    service_prepare_reward_sponsor_upload_v4:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_setup_id:"uuid",p_slot:"integer",p_approval_id:"uuid",p_request_id:"uuid",p_context_hash:"text",p_document_hash:"text",p_package_text:"text",p_funding:"jsonb"},
    service_reward_sponsor_execution: {p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_setup_id:"uuid",p_plan:"jsonb",p_deployment_hash:"text",p_funding_hash:"text"},
  service_reward_sponsor_launch:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_setup_id:"uuid",p_request_id:"uuid",p_expected_revision:"integer"},
    service_read_reward_participation_review:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid"},
    service_save_reward_participation_review:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_request_id:"uuid",p_expected_review_id:"uuid",p_review:"jsonb",p_reason:"text"},
    service_reward_setup_events:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_edition_id:"uuid",p_race_id:"uuid"},
    service_reward_distribution_setups:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_programme_id:"uuid",p_request_id:"uuid",p_expected_revision:"integer",p_configuration:"jsonb"},
    service_list_reward_organizer_club_awards_v3:{p_user_id:"uuid",p_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_after_id:"text"},
    service_list_reward_club_allocations_v3:{p_user_id:"uuid",p_session_id:"uuid",p_chain_id:"integer",p_club_id:"uuid",p_after_id:"text"},
    service_read_reward_club_readiness_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_request_id:"uuid",p_role:"text",p_review_id:"uuid"},
    service_record_reward_club_readiness_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_request_id:"uuid",p_review_id:"uuid",p_previous_review_id:"uuid",p_source_guard_hash:"text",p_identity_fingerprint:"text",p_evidence:"jsonb"},
    service_revoke_reward_club_readiness_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_request_id:"uuid",p_review_id:"uuid",p_reason:"text"},
    service_reward_final_publication_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_approval_id:"uuid",p_upload_id:"uuid",p_request_id:"uuid",p_context_hash:"text",p_package_hash:"text",p_document_text:"text"},
    service_reward_league_publication_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_request_id:"uuid",p_decision:"text",p_previous_publication_id:"uuid",p_source_guard_hash:"text",p_document_text:"text"},
    service_reserve_reward_programme_activation_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_approval_id:"uuid",p_upload_id:"uuid",p_intent_id:"uuid",p_predecessor_id:"uuid",p_pending_nonce:"text",p_body:"jsonb"},
    service_reward_round_publication_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_approval_id:"uuid",p_upload_id:"uuid",p_action:"text",p_request_id:"uuid",p_review_id:"uuid",p_package_hash:"text"},
    service_read_reward_allocation_upload_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_approval_id:"uuid"},
    service_read_reward_final_allocation_upload_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_approval_id:"uuid"},
    service_prepare_reward_final_allocation_upload_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_approval_id:"uuid",p_request_id:"uuid",p_context_hash:"text",p_document_hash:"text",p_package_text:"text"},
    service_read_reward_final_allocation_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_request_id:"uuid"},
    service_approve_reward_final_allocation_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_request_id:"uuid",p_expected_approval_id:"uuid",p_context_hash:"text",p_document_text:"text",p_funding:"jsonb"},
    service_prepare_reward_allocation_upload_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_approval_id:"uuid",p_request_id:"uuid",p_context_hash:"text",p_document_hash:"text",p_package_text:"text"},
    service_read_reward_programme_execution_status_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_approval_id:"uuid",p_upload_id:"uuid"},
    service_read_reward_programme_lifecycle_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_approval_id:"uuid",p_upload_id:"uuid",p_intent_id:"uuid"},
    service_reserve_reward_programme_lifecycle_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_approval_id:"uuid",p_upload_id:"uuid",p_intent_id:"uuid",p_predecessor_id:"uuid",p_pending_nonce:"text",p_body:"jsonb"},
    service_record_reward_programme_lifecycle_attempt_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_approval_id:"uuid",p_upload_id:"uuid",p_intent_id:"uuid",p_attempt_id:"uuid",p_body:"jsonb"},
    service_read_reward_programme_lifecycle_job_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_approval_id:"uuid",p_upload_id:"uuid",p_intent_id:"uuid"},
    service_queue_reward_programme_lifecycle_job_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_approval_id:"uuid",p_upload_id:"uuid",p_intent_id:"uuid",p_attempt_id:"uuid",p_job_id:"uuid"},
    service_step_reward_programme_lifecycle_job_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_approval_id:"uuid",p_upload_id:"uuid",p_intent_id:"uuid",p_job_id:"uuid",p_worker_id:"uuid",p_lease_token:"uuid",p_action:"text",p_receipt:"jsonb"},
    service_read_reward_allocation_approval_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_request_id:"uuid"},
    service_approve_reward_allocation_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_request_id:"uuid",p_expected_approval_id:"uuid",p_context_hash:"text",p_document_text:"text",p_funding:"jsonb"},
    service_read_reward_planning_draft:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid"},
    service_read_reward_programme_approval_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid"},
    service_read_reward_programme_deployment_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid"},
    service_read_reward_programme_registry_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid"},
    service_read_reward_programme_job_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_intent_id:"uuid"},
    service_queue_reward_programme_job_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_intent_id:"uuid",p_attempt_id:"uuid",p_job_id:"uuid"},
    service_step_reward_programme_job_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_intent_id:"uuid",p_job_id:"uuid",p_worker_id:"uuid",p_lease_token:"uuid",p_action:"text",p_provenance:"jsonb"},
    service_read_reward_programme_attempt_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_intent_id:"uuid"},
    service_record_reward_programme_attempt_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_intent_id:"uuid",p_attempt_id:"uuid",p_body:"jsonb"},
    service_reserve_reward_programme_deployment_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_request_id:"uuid",p_approval_id:"uuid",p_context_hash:"text",p_pending_nonce:"text",p_maximum_gas_cost_wei:"text"},
    service_approve_reward_programme_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_request_id:"uuid",p_expected_approval_id:"uuid",p_context_hash:"text",p_terms:"jsonb"},
    service_read_reward_historical_source_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid"},
    service_read_reward_mapping_v2:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid"},
    service_save_reward_mapping_v2:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_expected_revision:"integer",p_expected_rules_revision:"integer",p_catalogue_hash:"text",p_mapping:"jsonb"},
    service_read_reward_published_preview_v2:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid"},
    service_read_reward_finale_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid"},
    service_read_reward_native_finale_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid"},
    service_read_reward_native_continuity_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_request_id:"uuid"},
    service_read_reward_league_policy_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_request_id:"uuid"},
    service_review_reward_league_policy_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_request_id:"uuid",p_expected_review_id:"uuid",p_context_text:"text",p_source_guard_hash:"text",p_policy:"jsonb",p_decision:"text"},
    service_review_reward_native_continuity_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_request_id:"uuid",p_expected_review_id:"uuid",p_context_text:"text",p_source_guard_hash:"text",p_selection:"jsonb",p_decision:"text"},
    service_bind_reward_finale_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_request_id:"uuid",p_expected_binding_id:"uuid",p_context_hash:"text",p_edition_id:"uuid",p_races:"jsonb"},
    service_review_reward_historical_source_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_draft_id:"uuid",p_slot:"integer",p_request_id:"uuid",p_expected_review_id:"uuid",p_context_hash:"text",p_decision:"text"},
    service_read_reward_result_review_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_category_id:"uuid"},
    service_save_reward_result_review_policy_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_category_id:"uuid",p_expected_revision:"integer",p_review_seconds:"integer"},
    service_read_reward_club_signing_context:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_intent_id:"uuid",p_role:"text"},
    service_list_reward_club_awards:{p_user_id:"uuid",p_session_id:"uuid",p_chain_id:"integer",p_club_id:"uuid",p_after_id:"uuid"},
    service_list_reward_club_claims:{p_user_id:"uuid",p_session_id:"uuid",p_chain_id:"integer",p_after_id:"uuid"},
    service_read_reward_club_payment_status:{p_user_id:"uuid",p_session_id:"uuid",p_chain_id:"integer",p_intent_id:"uuid"},
    service_read_reward_club_claim_context:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_review_id:"uuid",p_entitlement_id:"uuid",p_idempotency_key:"text"},
    service_read_reward_club_claim_proofs:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_intent_id:"uuid",p_role:"text"},
    service_read_reward_club_payment_context:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_claim_intent_id:"uuid"},
    service_read_reward_club_payment_job:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_job_id:"uuid",p_payment_intent_id:"uuid"},
    service_queue_reward_club_payment_job:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_claim_intent_id:"uuid",p_payment_intent_id:"uuid",p_attempt_id:"uuid",p_idempotency_key:"text",p_witness:"jsonb",p_observed_at:"timestamptz"},
    service_step_reward_club_payment_job:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_job_id:"uuid",p_worker_id:"uuid",p_lease_token:"uuid",p_action:"text",p_execution:"jsonb",p_observed_at:"timestamptz"},
    service_confirm_reward_club_payment_job:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_job_id:"uuid",p_worker_id:"uuid",p_lease_token:"uuid",p_payment:"jsonb",p_deployment:"jsonb",p_observation:"jsonb"},
    service_record_reward_club_payment_attempt:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_claim_intent_id:"uuid",p_payment_intent_id:"uuid",p_idempotency_key:"text",p_attempt:"jsonb",p_pending_nonce:"text",p_witness:"jsonb",p_observed_at:"timestamptz"},
    service_read_reward_club_payment_attempt:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_claim_intent_id:"uuid",p_payment_intent_id:"uuid",p_attempt_id:"uuid",p_idempotency_key:"text"},
    service_reserve_reward_club_payment:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_claim_intent_id:"uuid",p_relayer_address:"text",p_idempotency_key:"text",p_observed_chain_id:"integer",p_pending_nonce:"text",p_witness:"jsonb",p_observed_at:"timestamptz"},
    service_record_reward_club_claim_proof:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_intent_id:"uuid",p_role:"text",p_idempotency_key:"text",p_proof:"jsonb",p_witness:"jsonb",p_observed_at:"timestamptz"},
    service_prepare_reward_club_claim:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_review_id:"uuid",p_entitlement_id:"uuid",p_idempotency_key:"text",p_witness:"jsonb",p_observed_at:"timestamptz"},
    service_list_reward_operator_club_treasuries:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_after_id:"uuid"},
    service_read_reward_operator_club_treasury:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_request_id:"uuid"},
    service_read_reward_club_review_context:{p_programme_id:"uuid",p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_request_id:"uuid",p_idempotency_key:"text"},
    service_record_reward_club_review:{p_programme_id:"uuid",p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_request_id:"uuid",p_expected_identity_fingerprint:"text",p_expected_revision:"integer",p_evidence:"jsonb",p_idempotency_key:"text"},
    service_revoke_reward_club_review:{p_programme_id:"uuid",p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_review_id:"uuid",p_reason:"text"},
    service_request_reward_club_treasury:{p_user_id:"uuid",p_session_id:"uuid",p_club_id:"uuid",p_chain_id:"integer",p_candidate:"jsonb",p_idempotency_key:"text"},
    service_read_reward_club_treasury:{p_user_id:"uuid",p_session_id:"uuid",p_chain_id:"integer",p_request_id:"uuid"},
    service_list_reward_club_treasuries:{p_user_id:"uuid",p_session_id:"uuid",p_chain_id:"integer",p_after_id:"uuid"},
    service_list_reward_owned_clubs:{p_user_id:"uuid",p_session_id:"uuid",p_chain_id:"integer",p_after_id:"uuid"},
    service_withdraw_reward_club_treasury:{p_user_id:"uuid",p_session_id:"uuid",p_chain_id:"integer",p_request_id:"uuid"},
    service_list_reward_operator_record_races:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_campaign_id:"uuid",p_source_snapshot_id:"uuid",p_after_id:"uuid"},
    service_read_reward_operator_record_context:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_campaign_id:"uuid",p_source_snapshot_id:"uuid",p_prior_snapshot_id:"uuid"},
    service_capture_reward_operator_record:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_campaign_id:"uuid",p_source_snapshot_id:"uuid",p_prior_race_id:"uuid",p_idempotency_key:"text"},
    service_approve_reward_operator_record:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_campaign_id:"uuid",p_source_snapshot_id:"uuid",p_prior_snapshot_id:"uuid",p_expected_revision:"integer",p_idempotency_key:"text",p_request:"jsonb"},
    service_withdraw_reward_operator_record:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_campaign_id:"uuid",p_source_snapshot_id:"uuid",p_approval_id:"uuid",p_expected_revision:"integer",p_idempotency_key:"text",p_reason:"text"},
    service_read_reward_operator_sporting_context:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_campaign_id:"uuid",p_source_snapshot_id:"uuid",p_record_approval_ids:"uuid[]"},
    service_capture_reward_operator_source:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_campaign_id:"uuid",p_idempotency_key:"text"},
    service_record_reward_operator_sporting_review:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_campaign_id:"uuid",p_source_snapshot_id:"uuid",p_expected_revision:"integer",p_idempotency_key:"text",p_review:"jsonb"},
    service_read_reward_operator_preparation:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_campaign_id:"uuid",p_review_id:"uuid"},
    service_check_reward_operator_preparation:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_campaign_id:"uuid"},
    service_reserve_reward_operator_allocation:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_campaign_id:"uuid",p_review_id:"uuid",p_idempotency_key:"text",p_allocation:"jsonb"},
    service_reward_operator_session_call:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_method:"text",p_arguments:"jsonb"},
    service_next_reward_operator_job:{p_programme_id:"uuid",p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_excluded_signers:"text[]"},
    service_read_reward_athlete_payment_context:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_claim_intent_id:"uuid"},
    service_reserve_reward_athlete_payment:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_claim_intent_id:"uuid",p_relayer_address:"text",p_idempotency_key:"text",p_observed_chain_id:"integer",p_pending_nonce:"text",p_witness:"jsonb",p_observed_at:"timestamptz"},
    service_record_reward_athlete_payment_attempt:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_claim_intent_id:"uuid",p_payment_intent_id:"uuid",p_idempotency_key:"text",p_attempt:"jsonb",p_witness:"jsonb",p_observed_at:"timestamptz"},
    service_read_reward_athlete_payment_attempt:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_claim_intent_id:"uuid",p_payment_intent_id:"uuid",p_attempt_id:"uuid",p_idempotency_key:"text"},
    service_read_reward_athlete_payment_job:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_job_id:"uuid",p_payment_intent_id:"uuid"},
    service_queue_reward_athlete_payment_job:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_claim_intent_id:"uuid",p_payment_intent_id:"uuid",p_attempt_id:"uuid",p_idempotency_key:"text",p_witness:"jsonb",p_observed_at:"timestamptz"},
    service_step_reward_athlete_payment_job:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_job_id:"uuid",p_worker_id:"uuid",p_lease_token:"uuid",p_action:"text",p_execution:"jsonb",p_observed_at:"timestamptz"},
    service_confirm_reward_athlete_payment_job:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_job_id:"uuid",p_worker_id:"uuid",p_lease_token:"uuid",p_payment:"jsonb",p_deployment:"jsonb",p_observation:"jsonb"},
    service_read_reward_athlete_claim_context:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_review_id:"uuid",p_entitlement_id:"uuid",p_idempotency_key:"text"},
    service_prepare_reward_athlete_claim:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_review_id:"uuid",p_entitlement_id:"uuid",p_idempotency_key:"text",p_witness:"jsonb",p_observed_at:"timestamptz"},
    service_read_reward_athlete_claim_proofs:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_intent_id:"uuid",p_role:"text"},
    service_read_reward_athlete_consent_context:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_intent_id:"uuid"},
    service_record_reward_athlete_claim_proof:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_intent_id:"uuid",p_role:"text",p_idempotency_key:"text",p_proof:"jsonb",p_witness:"jsonb",p_observed_at:"timestamptz"},
    service_read_reward_athlete_review_context:{p_programme_id:"uuid",p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_request_id:"uuid"},
    service_record_reward_athlete_review:{p_programme_id:"uuid",p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_request_id:"uuid",p_expected_profile_fingerprint:"text",p_expected_revision:"integer",p_attestation:"jsonb",p_idempotency_key:"text"},
    service_revoke_reward_athlete_review:{p_programme_id:"uuid",p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_review_id:"uuid",p_reason:"text"},
    service_list_reward_athlete_destinations:{p_user_id:"uuid",p_session_id:"uuid",p_after_id:"uuid"},
    service_list_reward_athlete_claims:{p_user_id:"uuid",p_session_id:"uuid",p_chain_id:"integer",p_after_id:"uuid"},
    service_list_reward_operator_programmes:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_after_id:"uuid"},
    service_list_reward_operator_destinations:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_after_id:"uuid"},
    service_list_reward_operator_campaigns:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer"},
    service_list_reward_operator_awards:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_campaign_id:"uuid",p_allocation_id:"uuid",p_after_id:"uuid"},
    service_read_reward_operator_award:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_programme_id:"uuid",p_chain_id:"integer",p_campaign_id:"uuid",p_allocation_id:"uuid",p_entitlement_id:"uuid",p_after_id:"uuid"},
    service_read_reward_athlete_payment_status:{p_user_id:"uuid",p_session_id:"uuid",p_chain_id:"integer",p_intent_id:"uuid"},
    service_request_reward_athlete_destination:{p_user_id:"uuid",p_session_id:"uuid",p_athlete_profile_id:"uuid",p_proof_id:"uuid",p_idempotency_key:"text"},
    service_read_reward_athlete_destination:{p_user_id:"uuid",p_session_id:"uuid",p_request_id:"uuid"},
    service_withdraw_reward_athlete_destination:{p_user_id:"uuid",p_session_id:"uuid",p_request_id:"uuid"},
    service_create_reward_wallet_challenge:{p_user_id:"uuid",p_session_id:"uuid",p_chain_id:"integer",p_address:"text",p_origin:"text",p_idempotency_key:"text"},
    service_read_reward_wallet_challenge:{p_user_id:"uuid",p_session_id:"uuid",p_challenge_id:"uuid"},
    service_confirm_reward_wallet_proof:{p_user_id:"uuid",p_session_id:"uuid",p_challenge_id:"uuid",p_message_hash:"text",p_signature:"text"},
    service_read_own_reward_awards:{p_user_id:"uuid",p_session_id:"uuid",p_after_id:"uuid"},
    service_read_own_reward_allocations_v3:{p_user_id:"uuid",p_session_id:"uuid",p_chain_id:"integer",p_after_id:"text"},
    service_read_reward_readiness_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_destination_id:"uuid",p_role:"text"},
    service_read_reward_claim_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_destination_id:"uuid",p_entitlement_id:"text",p_claim_id:"uuid",p_role:"text"},
    service_read_reward_club_claim_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_request_id:"uuid",p_entitlement_id:"text",p_claim_id:"uuid",p_role:"text"},
    service_prepare_reward_club_claim_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_request_id:"uuid",p_entitlement_id:"text",p_claim_id:"uuid",p_review_id:"uuid",p_source_guard_hash:"text",p_identity_fingerprint:"text",p_witness:"jsonb",p_observed_at:"timestamptz"},
    service_record_reward_club_claim_proof_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_request_id:"uuid",p_entitlement_id:"text",p_claim_id:"uuid",p_role:"text",p_proof:"jsonb",p_witness:"jsonb",p_observed_at:"timestamptz"},
    service_read_reward_athlete_payment_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_destination_id:"uuid",p_entitlement_id:"text",p_claim_id:"uuid",p_payment_id:"uuid"},
    service_read_reward_club_payment_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_request_id:"uuid",p_entitlement_id:"text",p_claim_id:"uuid",p_payment_id:"uuid"},
    service_change_reward_club_payment_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_request_id:"uuid",p_entitlement_id:"text",p_claim_id:"uuid",p_payment_id:"uuid",p_action:"text",p_payload:"jsonb"},
    service_read_reward_club_payment_status_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_request_id:"uuid",p_entitlement_id:"text",p_claim_id:"uuid",p_role:"text"},
    service_change_reward_athlete_payment_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_destination_id:"uuid",p_entitlement_id:"text",p_claim_id:"uuid",p_payment_id:"uuid",p_action:"text",p_payload:"jsonb"},
    service_list_own_reward_claims_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_after_id:"uuid"},
    service_read_reward_payment_status_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_destination_id:"uuid",p_entitlement_id:"text",p_claim_id:"uuid",p_role:"text"},
    service_prepare_reward_claim_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_destination_id:"uuid",p_entitlement_id:"text",p_claim_id:"uuid",p_review_id:"uuid",p_source_guard_hash:"text",p_profile_fingerprint:"text",p_witness:"jsonb",p_observed_at:"timestamptz"},
    service_record_reward_claim_proof_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_destination_id:"uuid",p_entitlement_id:"text",p_claim_id:"uuid",p_role:"text",p_proof:"jsonb",p_witness:"jsonb",p_observed_at:"timestamptz"},
    service_record_reward_readiness_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_destination_id:"uuid",p_review_id:"uuid",p_previous_review_id:"uuid",p_source_guard_hash:"text",p_profile_fingerprint:"text",p_attestation:"jsonb"},
    service_revoke_reward_readiness_v3:{p_actor_user_id:"uuid",p_actor_session_id:"uuid",p_chain_id:"integer",p_upload_id:"uuid",p_destination_id:"uuid",p_review_id:"uuid",p_reason:"text"},
    service_create_reward_programme: { p_actor_user_id: "uuid", p_idempotency_key: "text", p_request: "jsonb" },
    service_capture_reward_source: { p_organization_id: "uuid", p_league_season_id: "uuid", p_round_ids: "uuid[]", p_actor_user_id: "uuid", p_idempotency_key: "text" },
    service_read_reward_calculation_context: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_source_snapshot_id: "uuid", p_review_id: "uuid" },
    service_record_reward_sporting_review: { p_campaign_id: "uuid", p_source_snapshot_id: "uuid", p_actor_user_id: "uuid", p_idempotency_key: "text", p_review: "jsonb" },
    service_reserve_reward_allocation: { p_review_id: "uuid", p_actor_user_id: "uuid", p_idempotency_key: "text", p_allocation: "jsonb" },
    service_read_reward_record_source: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_prior_race_id: "uuid" },
    service_capture_reward_record_source: { p_campaign_id: "uuid", p_source_snapshot_id: "uuid", p_actor_user_id: "uuid", p_prior_race_id: "uuid", p_idempotency_key: "text" },
    service_read_reward_record_snapshot: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_snapshot_id: "uuid" },
    service_read_reward_record_approval: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_approval_id: "uuid" },
    service_approve_reward_record: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_prior_snapshot_id: "uuid", p_idempotency_key: "text", p_request: "jsonb" },
    service_withdraw_reward_record: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_approval_id: "uuid", p_idempotency_key: "text", p_reason: "text" },
    service_read_reward_allocation_export: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_allocation_id: "uuid" },
    service_save_reward_upload: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_allocation_id: "uuid", p_idempotency_key: "text", p_upload: "jsonb", p_evidence: "jsonb" },
    service_check_reward_upload_evidence: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_upload_id: "uuid" },
    service_read_reward_deployment_context: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_intent_id: "uuid" },
    service_reserve_reward_deployment: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_idempotency_key: "text", p_observed_chain_id: "integer", p_pending_nonce: "text" },
    service_record_reward_deployment_attempt: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_intent_id: "uuid", p_idempotency_key: "text", p_attempt: "jsonb" },
    service_read_reward_deployment_attempt: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_intent_id: "uuid", p_attempt_id: "uuid" },
    service_read_reward_campaign_checkpoint: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_idempotency_key: "text" },
    service_record_reward_campaign_checkpoint: { p_campaign_id: "uuid", p_actor_user_id: "uuid", p_intent_id: "uuid", p_attempt_id: "uuid",
      p_idempotency_key: "text", p_deployment: "jsonb", p_observation: "jsonb" },
    service_queue_reward_deployment_job:{p_campaign_id:"uuid",p_actor_user_id:"uuid",p_intent_id:"uuid",p_attempt_id:"uuid",p_idempotency_key:"text"},
    service_read_reward_deployment_job:{p_job_id:"uuid",p_actor_user_id:"uuid"},
    service_step_reward_deployment_job:{p_job_id:"uuid",p_actor_user_id:"uuid",p_worker_id:"uuid",p_lease_token:"uuid",p_action:"text"},
    service_read_reward_lifecycle_context:{p_campaign_id:"uuid",p_actor_user_id:"uuid",p_upload_id:"uuid",p_intent_id:"uuid",p_idempotency_key:"text"},
    service_queue_reward_lifecycle_job:{p_campaign_id:"uuid",p_actor_user_id:"uuid",p_upload_id:"uuid",p_intent_id:"uuid",p_attempt_id:"uuid",p_idempotency_key:"text"},
    service_read_reward_lifecycle_job:{p_job_id:"uuid",p_actor_user_id:"uuid"},
    service_step_reward_lifecycle_job:{p_job_id:"uuid",p_actor_user_id:"uuid",p_worker_id:"uuid",p_lease_token:"uuid",p_action:"text"},
    service_confirm_reward_lifecycle_job:{p_job_id:"uuid",p_actor_user_id:"uuid",p_worker_id:"uuid",p_lease_token:"uuid",p_lifecycle:"jsonb",p_deployment:"jsonb",p_observation:"jsonb"},
    service_reserve_reward_lifecycle:{p_campaign_id:"uuid",p_actor_user_id:"uuid",p_upload_id:"uuid",p_action:"text",p_idempotency_key:"text",p_observation_id:"uuid",p_observed_chain_id:"integer",p_pending_nonce:"text"},
    service_record_reward_lifecycle_attempt:{p_campaign_id:"uuid",p_actor_user_id:"uuid",p_upload_id:"uuid",p_intent_id:"uuid",p_idempotency_key:"text",p_attempt:"jsonb"},
    service_read_reward_lifecycle_attempt:{p_campaign_id:"uuid",p_actor_user_id:"uuid",p_upload_id:"uuid",p_intent_id:"uuid",p_attempt_id:"uuid"},
    service_read_reward_funding_context:{p_campaign_id:"uuid",p_actor_user_id:"uuid",p_intent_id:"uuid"},
    service_reserve_reward_funding:{p_campaign_id:"uuid",p_actor_user_id:"uuid",p_idempotency_key:"text",p_observation_id:"uuid",p_observed_chain_id:"integer",p_pending_nonce:"text"},
    service_record_reward_funding_attempt:{p_campaign_id:"uuid",p_actor_user_id:"uuid",p_intent_id:"uuid",p_idempotency_key:"text",p_attempt:"jsonb"},
    service_read_reward_funding_attempt:{p_campaign_id:"uuid",p_actor_user_id:"uuid",p_intent_id:"uuid",p_attempt_id:"uuid"},
    service_queue_reward_funding_job:{p_campaign_id:"uuid",p_actor_user_id:"uuid",p_intent_id:"uuid",p_attempt_id:"uuid",p_idempotency_key:"text"},
    service_read_reward_funding_job:{p_job_id:"uuid",p_actor_user_id:"uuid"},
    service_step_reward_funding_job:{p_job_id:"uuid",p_actor_user_id:"uuid",p_worker_id:"uuid",p_lease_token:"uuid",p_action:"text"},
    service_confirm_reward_funding_job:{p_job_id:"uuid",p_actor_user_id:"uuid",p_worker_id:"uuid",p_lease_token:"uuid",p_funding:"jsonb",p_deployment:"jsonb",p_observation:"jsonb"},
  };
  const rpcSql = (name, args) => {
    const fields = methods[name]; assert.ok(fields, "unexpected RPC");
    assert.deepEqual(Object.keys(args).sort(), Object.keys(fields).sort());
    const parameters = Object.entries(fields).map(([key, type]) => `${key} => ${["uuid[]","text[]"].includes(type)
      ? `array[${args[key].map(literal).join(",")}]::${type}` : `${literal(type === "jsonb" && args[key] !== null ? JSON.stringify(args[key]) : args[key])}::${type}`}`);
    return `select public.${name}(${parameters.join(",")});`;
  };
  const rpc = async (name, args) => {
    try {
      const output=await query(rpcSql(name,args));
      // psql emits an empty field for SQL NULL; PostgREST represents that as null.
      // Only the checkpoint read and busy lease step are nullable.
      return { data: output === "" && ["service_step_reward_programme_lifecycle_job_v3","service_read_reward_programme_job_v3","service_step_reward_programme_job_v3","service_read_reward_campaign_checkpoint","service_step_reward_deployment_job","service_step_reward_funding_job","service_step_reward_lifecycle_job","service_read_reward_athlete_payment_attempt","service_read_reward_club_payment_attempt","service_read_reward_athlete_payment_job","service_step_reward_athlete_payment_job","service_read_reward_club_payment_job","service_step_reward_club_payment_job"].includes(name) ? null : JSON.parse(output), error: null };
    }
    catch (error) {
      // The application intentionally hides unexpected transport failures. Keep
      // a bounded first-line diagnostic in this scratch-only harness so a lost
      // local connection is distinguishable from a sporting-rule rejection.
      // Never log SQL arguments, result documents, or use this in the app RPC.
      if (!error.code || error.code === "reward_test_sql_failed" || !/^(reward_|invalid_reward_)/.test(error.code)) {
        console.error(`reward test RPC ${name}: ${String(error.message).split("\n")[0].slice(0, 240)}`);
      }
      return { data: null, error: { message: error.code } };
    }
  };

  /** Hold an actual transaction lock until release. Waiting tests verify blocked
   * backend PIDs through pg_stat_activity, not an arbitrary sleep or file flag. */
  async function lock(sql) {
    const child = connection(); let output = ""; let error = ""; let ready;
    const acquired = new Promise((resolve, reject) => { ready = resolve; child.once("error", reject); });
    child.stdout.on("data", (data) => { output += data; if (output.includes("REWARD_LOCK_READY")) ready(); });
    child.stderr.on("data", (data) => { error += data; });
    const done = new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", (code) => code === 0 ? resolve() : reject(new Error(error || "lock backend exited")));
    });
    // Observe failure immediately rather than leave an unhandled rejection while
    // another query is checking pg_stat_activity.
    done.catch(() => {});
    child.stdin.write(`begin; set local idle_in_transaction_session_timeout='15s'; set local lock_timeout='5s';\n${sql};\n\\echo REWARD_LOCK_READY\n`);
    let timeout;
    try { await Promise.race([acquired, done.then(() => { throw new Error("lock holder exited before ready"); }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("lock acquisition timed out")), 7000); })]); }
    catch (error) { child.kill("SIGTERM"); await done.catch(() => {}); throw error; }
    finally { clearTimeout(timeout); }
    return async () => { child.stdin.end("commit;\n"); await done; };
  }
  async function waiting(count) {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const actual = await scalar(`select count(*) from pg_stat_activity where datname=${literal(database)} and application_name=${literal(appName)}
        and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0`);
      if (actual >= count) return;
      await delay(30);
    }
    throw new Error(`Did not observe ${count} actually blocked reward backends`);
  }
  async function close() {
    await Promise.all([...children].map(child => new Promise(done => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.once("close", () => { clearTimeout(timer); done(); });
      child.kill("SIGTERM");
    })));
  }
  /** Test-only transaction: all fixture clock changes and execution rows roll
   * back, including on an assertion/SQL failure. Never exported to app code. */
  async function rollbackFixture(work) {
    const child = connection(); let buffer = "", errors = "", reader = null, tail = Promise.resolve();
    child.stdout.on("data", bytes => { buffer += bytes; reader?.(); });
    child.stderr.on("data", bytes => { errors += bytes; reader?.(); });
    const ended = new Promise(resolve => child.once("close", resolve));
    const serialQuery = sql => {
      const run = tail.then(() => new Promise((resolve, reject) => {
        const marker = `REWARD_FIXTURE_${randomUUID().replaceAll("-", "")}`;
        const timer = setTimeout(() => { child.kill("SIGTERM"); reject(Error("reward_fixture_timeout")); }, 25000);
        const failed = () => { clearTimeout(timer); reject(Error("reward_fixture_connection_closed")); };
        child.once("close", failed);
        reader = () => {
          // stdout/stderr are independent pipes: seeing the stdout marker
          // alone does not mean this statement's error has arrived yet.
          if (!buffer.includes(marker) || !errors.includes(marker)) return;
          clearTimeout(timer); child.removeListener("close", failed); reader = null;
          const output = buffer.slice(0, buffer.indexOf(marker)).trim(); buffer = "";
          const error = errors.slice(0, errors.indexOf(marker)); errors = "";
          if (/ERROR:/.test(error)) { const e = Error(error); e.code = /ERROR:\s+([^\n]+)/.exec(error)?.[1]; reject(e); }
          else resolve(output);
        };
        child.stdin.write(`${sql}\n\\echo ${marker}\n\\warn ${marker}\n`);
      }));
      tail = run.catch(() => {}); return run;
    };
    // Do not exit psql on an expected SQL error; the final rollback still runs.
    child.stdin.write("\\set ON_ERROR_STOP off\nbegin; set local timezone='UTC'; set local statement_timeout='20s';\n");
    const fixtureRpc = async (name, args) => {
      try { const output = await serialQuery(rpcSql(name, args)); return { data: output === "" ? null : JSON.parse(output), error: null }; }
      catch (error) { return { data: null, error: { message: error.code ?? "reward_fixture_failed" } }; }
    };
    try { return await work({ query: serialQuery, rpc: fixtureRpc }); }
    finally { await tail; child.stdin.end("rollback;\n"); await ended; }
  }
  return { database, query, scalar, rpcSql, rpc, lock, waiting, close, rollbackFixture };
}
