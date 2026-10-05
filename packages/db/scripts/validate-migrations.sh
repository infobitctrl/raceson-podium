#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)"
REWARD_CHAIN_REHEARSAL="${RACESON_REWARD_CHAIN_REHEARSAL:-0}"
case "$REWARD_CHAIN_REHEARSAL" in 0|1) ;; *) printf 'Invalid reward chain rehearsal mode\n' >&2; exit 1 ;; esac
REWARD_DEMO_VALIDATION="${RACESON_REWARD_DEMO_VALIDATION:-$REWARD_CHAIN_REHEARSAL}"
case "$REWARD_DEMO_VALIDATION" in 0|1) ;; *) printf 'Invalid reward demo validation mode\n' >&2; exit 1 ;; esac
if [ "$REWARD_CHAIN_REHEARSAL" -eq 1 ] && [ "$REWARD_DEMO_VALIDATION" -ne 1 ]; then
  printf 'Reward chain rehearsal requires the isolated demo migration overlay\n' >&2
  exit 1
fi
REWARD_CHAIN_DB_CREATED=0
LOCAL_DB_CREATED=0
PG_BIN_DEFAULT="/opt/homebrew/opt/postgresql@16/bin"
PG_BIN="${PG_BIN:-$PG_BIN_DEFAULT}"
PGHOST="${PGHOST:-127.0.0.1}"
if [ "$REWARD_DEMO_VALIDATION" -eq 1 ]; then
  case "$PGHOST" in 127.0.0.1|::1) ;; *) printf 'Reward demo validation requires a loopback database\n' >&2; exit 1 ;; esac
  case "${PGPORT:-5432}" in 5432) ;; *) printf 'Reward demo validation requires local PostgreSQL port 5432\n' >&2; exit 1 ;; esac
  if [ -n "${PGHOSTADDR:-}" ] || [ -n "${PGSERVICE:-}" ] || [ -n "${PGSERVICEFILE:-}" ] || [ -n "${PGOPTIONS:-}" ]; then
    printf 'Reward demo validation refuses connection-routing overrides\n' >&2
    exit 1
  fi
  if [ -n "${IMPORT_REHEARSAL_FILE:-}" ]; then
    printf 'Reward demo validation refuses external import fixtures\n' >&2
    exit 1
  fi
fi
TMP_DIR="$(mktemp -d "/tmp/sitrail-pg.XXXXXX")"
DATA_DIR="$TMP_DIR/data"
LOG_FILE="$TMP_DIR/postgres.log"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"
COMBINED_MIGRATION_FILE="$TMP_DIR/all_migrations.sql"
MIGRATION_SOURCE_LIST="$TMP_DIR/migration-sources.txt"
IMPORT_REHEARSAL_FILE="${IMPORT_REHEARSAL_FILE:-}"
SEED_FILE="$ROOT_DIR/supabase/seed.sql"
CLEAN_BASELINE_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/clean-baseline-smoke.sql"
DEMO_FIXTURE_FILE="$ROOT_DIR/supabase/fixtures/demo.sql"
PHASE1_FINANCE_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/phase1-finance-smoke.sql"
PHASE1_BANK_TRANSFER_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/phase1-bank-transfer-smoke.sql"
PHASE2_PRE_RACE_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/phase2-pre-race-smoke.sql"
PHASE2_REGISTRATION_IMPORT_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/phase2-registration-import-smoke.sql"
PHASE2_COMMUNICATIONS_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/phase2-communications-smoke.sql"
PHASE3_START_STATUS_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/phase3-start-status-smoke.sql"
PHASE4_SAFETY_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/phase4-safety-smoke.sql"
PHASE4_WORKFORCE_LOGISTICS_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/phase4-workforce-logistics-smoke.sql"
PHASE4_TIMING_INTEGRATIONS_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/phase4-timing-integrations-smoke.sql"
PLATFORM_WORKFLOW_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/platform-workflow-smoke.sql"
RESULT_PUBLICATION_LEAGUE_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/result-publication-league-pipeline-smoke.sql"
REALTIME_INVALIDATION_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/realtime-invalidation-dispatch-smoke.sql"
WORKFLOW_RECOVERY_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/workflow-recovery-smoke.sql"
PLATFORM_SUPPORT_TICKET_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/platform-support-ticket-smoke.sql"
PLATFORM_CLUB_DELETION_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/platform-club-deletion-smoke.sql"
CLUB_CREATOR_MEMBERSHIP_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/club-creator-membership-smoke.sql"
CLUB_MEMBER_ACCESS_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/club-member-access-smoke.sql"
CLUB_MULTISPORT_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/club-multisport-smoke.sql"
ACCOUNT_USERNAME_MANAGEMENT_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/account-username-management-smoke.sql"
PUBLIC_AUTH_CLAIM_INTENT_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/public-auth-claim-intent-smoke.sql"
PUBLISHED_EVENT_TRACK_VERSION_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/published-event-track-version-smoke.sql"
REGISTRATION_DESK_PAYMENT_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/registration-desk-payment-smoke.sql"
RECREATIONAL_LEAGUE_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/recreational-league-smoke.sql"
ORGANIZER_CHECKPOINT_RECONCILIATION_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/organizer-checkpoint-reconciliation-smoke.sql"
ORGANIZATION_OWNERSHIP_TRANSFER_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/organization-ownership-transfer-smoke.sql"
PLATFORM_RECORD_OWNERSHIP_TRANSFER_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/platform-record-ownership-transfer-smoke.sql"
ATHLETE_ACCOUNT_OWNERSHIP_INVARIANT_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/athlete-account-ownership-invariant-smoke.sql"
PLATFORM_RECORD_DELETION_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/platform-record-deletion-smoke.sql"
PLATFORM_MANAGEMENT_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/platform-management-smoke.sql"
ORGANIZATION_OWNER_DELETION_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/organization-owner-deletion-smoke.sql"
ORGANIZER_UNUSED_RACE_DELETION_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/organizer-unused-race-deletion-smoke.sql"
ORGANIZER_TRACK_DELETION_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/organizer-track-deletion-smoke.sql"
EVENT_RECORD_LIFECYCLE_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/event-record-lifecycle-smoke.sql"
PUBLIC_EVENT_HISTORY_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/public-event-history-smoke.sql"
FINISHED_RACE_OPERATIONS_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/finished-race-operations-smoke.sql"
ONSITE_REGISTRATION_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/onsite-registration-and-terminal-completion-smoke.sql"
SECURITY_PRIVACY_SMOKE_FILE="$ROOT_DIR/packages/db/scripts/security-privacy-boundaries-smoke.sql"
LOCAL_DB_NAME="sitrail_validation_$$"
REWARD_CHAIN_DB_NAME="${LOCAL_DB_NAME}_chain"

cleanup() {
  if [ -x "$PG_BIN/psql" ]; then
    if [ "$REWARD_CHAIN_DB_CREATED" -eq 1 ]; then
      "$PG_BIN/psql" -X -h "$PGHOST" -d postgres -v ON_ERROR_STOP=1 -qc "drop database $REWARD_CHAIN_DB_NAME;" >/dev/null 2>&1 || true
    fi
    if [ "$LOCAL_DB_CREATED" -eq 1 ]; then
      "$PG_BIN/psql" -X -h "$PGHOST" -d postgres -v ON_ERROR_STOP=1 -qc "drop database $LOCAL_DB_NAME;" >/dev/null 2>&1 || true
    fi
  fi
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT INT TERM

run_phase1_concurrency_check() {
  first_output="$TMP_DIR/phase1-concurrency-first.log"
  second_output="$TMP_DIR/phase1-concurrency-second.log"

  "$PG_BIN/psql" -X -h "$PGHOST" -d "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 -qc "
    update public.event_categories
    set
      capacity = 1,
      registration_fee_cents = 1800,
      currency = 'EUR',
      start_at = now() + interval '30 days',
      status = 'published'
    where id = '20000000-0000-4000-8000-000000000012';
  "

  "$PG_BIN/psql" -X -h "$PGHOST" -d "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 -qc "
    select *
    from public.create_registration_atomically(
      '20000000-0000-4000-8000-000000000012',
      '10000000-0000-4000-8000-000000000001',
      null,
      '00000000-0000-4000-8000-000000000101',
      'direct',
      'phase1-concurrency-v1',
      now(),
      false,
      'phase1-concurrency-one',
      'phase1-concurrency-request-one'
    );
  " >"$first_output" 2>&1 &
  first_pid=$!

  "$PG_BIN/psql" -X -h "$PGHOST" -d "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 -qc "
    select *
    from public.create_registration_atomically(
      '20000000-0000-4000-8000-000000000012',
      '10000000-0000-4000-8000-000000000002',
      null,
      '00000000-0000-4000-8000-000000000101',
      'direct',
      'phase1-concurrency-v1',
      now(),
      false,
      'phase1-concurrency-two',
      'phase1-concurrency-request-two'
    );
  " >"$second_output" 2>&1 &
  second_pid=$!

  first_status=0
  second_status=0
  wait "$first_pid" || first_status=$?
  wait "$second_pid" || second_status=$?

  if [ "$first_status" -ne 0 ] || [ "$second_status" -ne 0 ]; then
    cat "$first_output" >&2
    cat "$second_output" >&2
    return 1
  fi

  "$PG_BIN/psql" -X -h "$PGHOST" -d "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 -qc "
    do \$\$
    declare
      pending_count integer;
      waitlisted_count integer;
      active_hold_count integer;
    begin
      select count(*)::integer
      into pending_count
      from public.registrations
      where event_category_id = '20000000-0000-4000-8000-000000000012'
        and status = 'pending';

      select count(*)::integer
      into waitlisted_count
      from public.registrations
      where event_category_id = '20000000-0000-4000-8000-000000000012'
        and status = 'waitlisted';

      select count(*)::integer
      into active_hold_count
      from public.capacity_reservations
      where event_category_id = '20000000-0000-4000-8000-000000000012'
        and state = 'active'
        and expires_at > now();

      if pending_count <> 1 or waitlisted_count <> 1 or active_hold_count <> 1 then
        raise exception
          'concurrent registration oversell check failed: pending %, waitlisted %, holds %',
          pending_count,
          waitlisted_count,
          active_hold_count;
      end if;
    end
    \$\$;
  "
}

run_workflow_recovery_concurrency_check() {
  first_output="$TMP_DIR/workflow-concurrency-first.log"
  second_output="$TMP_DIR/workflow-concurrency-second.log"

  "$PG_BIN/psql" -X -h "$PGHOST" -d "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 -qc "
    insert into public.domain_events (
      id,
      event_type,
      aggregate_type,
      aggregate_id,
      actor_user_id,
      correlation_id,
      idempotency_key
    ) values (
      '92000000-0000-4000-8000-000000000001',
      'race.category.completed',
      'event_category',
      '92000000-0000-4000-8000-000000000002',
      '92000000-0000-4000-8000-000000000003',
      '92000000-0000-4000-8000-000000000004',
      'workflow-recovery-concurrency-check'
    );

    insert into public.workflow_jobs (
      id,
      domain_event_id,
      handler_key,
      priority
    ) values (
      '92000000-0000-4000-8000-000000000005',
      '92000000-0000-4000-8000-000000000001',
      'result.run.compute',
      10
    );
  "

  "$PG_BIN/psql" -X -h "$PGHOST" -d "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 -Atqc "
    select public.service_claim_workflow_jobs(
      array['result.run.compute'],
      1,
      '92000000-0000-4000-8000-000000000011',
      600
    );
  " >"$first_output" 2>&1 &
  first_pid=$!

  "$PG_BIN/psql" -X -h "$PGHOST" -d "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 -Atqc "
    select public.service_claim_workflow_jobs(
      array['result.run.compute'],
      1,
      '92000000-0000-4000-8000-000000000012',
      600
    );
  " >"$second_output" 2>&1 &
  second_pid=$!

  first_status=0
  second_status=0
  wait "$first_pid" || first_status=$?
  wait "$second_pid" || second_status=$?

  if [ "$first_status" -ne 0 ] || [ "$second_status" -ne 0 ]; then
    cat "$first_output" >&2
    cat "$second_output" >&2
    return 1
  fi

  "$PG_BIN/psql" -X -h "$PGHOST" -d "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 -qc "
    do \$\$
    declare
      job_row public.workflow_jobs%rowtype;
    begin
      select job.*
      into job_row
      from public.workflow_jobs job
      where job.id = '92000000-0000-4000-8000-000000000005';

      if job_row.state <> 'running'
         or job_row.attempt_count <> 1
         or job_row.lease_owner not in (
           '92000000-0000-4000-8000-000000000011',
           '92000000-0000-4000-8000-000000000012'
         ) then
        raise exception 'concurrent workflow claim was not exclusive: %', to_jsonb(job_row);
      end if;
    end
    \$\$;
  "
}

run_strava_oauth_concurrency_check() {
  "$PG_BIN/psql" -X -h "$PGHOST" -d "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 -qc "
    insert into public.athlete_strava_oauth_intents (nonce_hash, user_id, athlete_profile_id, expires_at)
    values (repeat('c',64), '00000000-0000-4000-8000-000000000101',
      '10000000-0000-4000-8000-000000000001', now() + interval '10 minutes');
  "
  "$PG_BIN/psql" -X -h "$PGHOST" -d "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 -Atqc "
    select public.consume_strava_oauth_intent(repeat('c',64),
      '00000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000001');
  " > "$TMP_DIR/strava-first.log" &
  strava_first_pid=$!
  "$PG_BIN/psql" -X -h "$PGHOST" -d "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 -Atqc "
    select public.consume_strava_oauth_intent(repeat('c',64),
      '00000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000001');
  " > "$TMP_DIR/strava-second.log" &
  strava_second_pid=$!
  wait "$strava_first_pid" || return 1
  wait "$strava_second_pid" || return 1
  strava_results="$(cat "$TMP_DIR/strava-first.log")$(cat "$TMP_DIR/strava-second.log")"
  case "$strava_results" in
    tf|ft) return 0 ;;
    *) printf 'OAuth intent was not consumed exactly once: %s\n' "$strava_results"; return 1 ;;
  esac
}

for tool in initdb postgres psql; do
  if [ ! -x "$PG_BIN/$tool" ]; then
    printf "Missing PostgreSQL tool: %s\n" "$PG_BIN/$tool" >&2
    exit 1
  fi
done

if [ "$REWARD_DEMO_VALIDATION" -eq 1 ]; then
  node "$ROOT_DIR/packages/db/scripts/reward-migration-sources.mjs" --demo > "$MIGRATION_SOURCE_LIST"
  printf 'Migration scope: isolated reward demo (portal base plus reward overlay)\n'
else
  node "$ROOT_DIR/packages/db/scripts/reward-migration-sources.mjs" > "$MIGRATION_SOURCE_LIST"
  printf 'Migration scope: production portal base only (no reward overlay)\n'
fi

found_migration=0
: > "$COMBINED_MIGRATION_FILE"

cat <<'SQL' >> "$COMBINED_MIGRATION_FILE"
-- Validation-only Supabase platform stubs.
do $$
begin
  create role postgres nologin;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create role anon nologin;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create role authenticated nologin;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create role service_role nologin;
exception
  when duplicate_object then null;
end
$$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists realtime;

create table if not exists realtime.validation_messages (
  id bigserial primary key,
  payload jsonb not null,
  event text not null,
  topic text not null,
  private boolean not null,
  created_at timestamptz not null default clock_timestamp()
);

create or replace function realtime.send(
  payload jsonb,
  event text,
  topic text,
  private boolean default true
)
returns void
language sql
as $$
  insert into realtime.validation_messages (payload, event, topic, private)
  values (payload, event, topic, private)
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  deleted_at timestamptz,
  confirmation_token text not null default '',
  recovery_token text not null default '',
  email_change_token_new text not null default '',
  email_change text not null default '',
  phone text,
  phone_change text not null default '',
  phone_change_token text not null default '',
  email_change_token_current text not null default '',
  reauthentication_token text not null default '',
  last_sign_in_at timestamptz,
  is_sso_user boolean not null default false,
  is_anonymous boolean not null default false,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz,
  updated_at timestamptz,
  not_after timestamptz
);

create table if not exists auth.identities (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_id text not null,
  identity_data jsonb not null default '{}'::jsonb,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text,
  unique (provider_id, provider)
);

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id) on delete cascade,
  name text not null,
  owner uuid,
  owner_id text
);

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[
    1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)
  ]
$$;

SQL

while IFS= read -r migration_file; do
  if [ ! -f "$migration_file" ]; then
    continue
  fi

  found_migration=1
  if [ "$(basename "$migration_file")" = "20260827121013_security_privacy_boundaries.sql" ]; then
    cat "$ROOT_DIR/packages/db/scripts/security-legacy-evidence-before.sql" >> "$COMBINED_MIGRATION_FILE"
    printf "\n" >> "$COMBINED_MIGRATION_FILE"
  fi
  printf -- "-- FILE: %s\n" "$migration_file" >> "$COMBINED_MIGRATION_FILE"
  cat "$migration_file" >> "$COMBINED_MIGRATION_FILE"
  # A standalone SQL file may end without a trailing statement terminator.
  # Keep replay boundaries explicit without rewriting applied migration bytes.
  printf "\n;\n" >> "$COMBINED_MIGRATION_FILE"
  if [ "$(basename "$migration_file")" = "20260827121013_security_privacy_boundaries.sql" ]; then
    cat "$ROOT_DIR/packages/db/scripts/security-legacy-evidence-after.sql" >> "$COMBINED_MIGRATION_FILE"
    printf "\n" >> "$COMBINED_MIGRATION_FILE"
  fi
done < "$MIGRATION_SOURCE_LIST"

if [ "$found_migration" -ne 1 ]; then
  printf "No migration files found in: %s\n" "$MIGRATIONS_DIR" >&2
  exit 1
fi

if [ "$REWARD_DEMO_VALIDATION" -eq 0 ]; then
  cat "$ROOT_DIR/packages/db/scripts/reward-production-isolation-smoke.sql" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -n "$IMPORT_REHEARSAL_FILE" ]; then
  if [ ! -f "$IMPORT_REHEARSAL_FILE" ]; then
    printf "Import rehearsal file not found: %s\n" "$IMPORT_REHEARSAL_FILE" >&2
    exit 1
  fi

  printf -- "-- PRIVATE IMPORT REHEARSAL: %s\n" "$IMPORT_REHEARSAL_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$IMPORT_REHEARSAL_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$SEED_FILE" ]; then
  printf -- "-- FILE: %s\n" "$SEED_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$SEED_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ ! -f "$CLEAN_BASELINE_SMOKE_FILE" ]; then
  printf "Clean baseline smoke file not found: %s\n" "$CLEAN_BASELINE_SMOKE_FILE" >&2
  exit 1
fi
printf -- "-- FILE: %s\n" "$CLEAN_BASELINE_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
cat "$CLEAN_BASELINE_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
printf "\n" >> "$COMBINED_MIGRATION_FILE"

if [ ! -f "$DEMO_FIXTURE_FILE" ]; then
  printf "Demo fixture file not found: %s\n" "$DEMO_FIXTURE_FILE" >&2
  exit 1
fi
printf -- "-- LOCAL DEMO FIXTURE: %s\n" "$DEMO_FIXTURE_FILE" >> "$COMBINED_MIGRATION_FILE"
cat "$DEMO_FIXTURE_FILE" >> "$COMBINED_MIGRATION_FILE"
printf "\n" >> "$COMBINED_MIGRATION_FILE"

if [ "$REWARD_DEMO_VALIDATION" -eq 1 ]; then
  for reward_smoke in source-snapshots ledger record-source upload deployment wallet destination readiness claim claim-proof payment-intent payment-job; do
    cat "$ROOT_DIR/packages/db/scripts/reward-$reward_smoke-smoke.sql" >> "$COMBINED_MIGRATION_FILE"
    printf "\n" >> "$COMBINED_MIGRATION_FILE"
  done
fi

# Reapply the idempotent incident migration to a synthetic pre-fix fixture.
cat "$ROOT_DIR/packages/db/scripts/onsite-hold-recovery-before.sql" >> "$COMBINED_MIGRATION_FILE"
cat "$ROOT_DIR/supabase/migrations/20260911100458_permanent_registrations_and_unpaid_dns.sql" >> "$COMBINED_MIGRATION_FILE"
cat "$ROOT_DIR/supabase/migrations/20260911100458_permanent_registrations_and_unpaid_dns.sql" >> "$COMBINED_MIGRATION_FILE"
cat "$ROOT_DIR/packages/db/scripts/onsite-hold-recovery-after.sql" >> "$COMBINED_MIGRATION_FILE"
printf "\n" >> "$COMBINED_MIGRATION_FILE"

cat "$ROOT_DIR/packages/db/scripts/race-fee-periods-smoke.sql" >> "$COMBINED_MIGRATION_FILE"
printf "\n" >> "$COMBINED_MIGRATION_FILE"

if [ -f "$PHASE1_FINANCE_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PHASE1_FINANCE_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PHASE1_FINANCE_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PHASE1_BANK_TRANSFER_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PHASE1_BANK_TRANSFER_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PHASE1_BANK_TRANSFER_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PHASE2_PRE_RACE_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PHASE2_PRE_RACE_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PHASE2_PRE_RACE_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PHASE2_REGISTRATION_IMPORT_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PHASE2_REGISTRATION_IMPORT_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PHASE2_REGISTRATION_IMPORT_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PHASE2_COMMUNICATIONS_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PHASE2_COMMUNICATIONS_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PHASE2_COMMUNICATIONS_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PHASE3_START_STATUS_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PHASE3_START_STATUS_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PHASE3_START_STATUS_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PHASE4_SAFETY_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PHASE4_SAFETY_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PHASE4_SAFETY_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PHASE4_WORKFORCE_LOGISTICS_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PHASE4_WORKFORCE_LOGISTICS_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PHASE4_WORKFORCE_LOGISTICS_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PHASE4_TIMING_INTEGRATIONS_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PHASE4_TIMING_INTEGRATIONS_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PHASE4_TIMING_INTEGRATIONS_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PLATFORM_WORKFLOW_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PLATFORM_WORKFLOW_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PLATFORM_WORKFLOW_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$RESULT_PUBLICATION_LEAGUE_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$RESULT_PUBLICATION_LEAGUE_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$RESULT_PUBLICATION_LEAGUE_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$REALTIME_INVALIDATION_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$REALTIME_INVALIDATION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$REALTIME_INVALIDATION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$WORKFLOW_RECOVERY_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$WORKFLOW_RECOVERY_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$WORKFLOW_RECOVERY_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PLATFORM_SUPPORT_TICKET_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PLATFORM_SUPPORT_TICKET_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PLATFORM_SUPPORT_TICKET_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PLATFORM_CLUB_DELETION_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PLATFORM_CLUB_DELETION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PLATFORM_CLUB_DELETION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$CLUB_CREATOR_MEMBERSHIP_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$CLUB_CREATOR_MEMBERSHIP_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$CLUB_CREATOR_MEMBERSHIP_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$CLUB_MEMBER_ACCESS_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$CLUB_MEMBER_ACCESS_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$CLUB_MEMBER_ACCESS_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$CLUB_MULTISPORT_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$CLUB_MULTISPORT_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$CLUB_MULTISPORT_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$ACCOUNT_USERNAME_MANAGEMENT_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$ACCOUNT_USERNAME_MANAGEMENT_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$ACCOUNT_USERNAME_MANAGEMENT_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PUBLIC_AUTH_CLAIM_INTENT_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PUBLIC_AUTH_CLAIM_INTENT_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PUBLIC_AUTH_CLAIM_INTENT_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PUBLISHED_EVENT_TRACK_VERSION_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PUBLISHED_EVENT_TRACK_VERSION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PUBLISHED_EVENT_TRACK_VERSION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$REGISTRATION_DESK_PAYMENT_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$REGISTRATION_DESK_PAYMENT_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$REGISTRATION_DESK_PAYMENT_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$RECREATIONAL_LEAGUE_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$RECREATIONAL_LEAGUE_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$RECREATIONAL_LEAGUE_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$ORGANIZER_CHECKPOINT_RECONCILIATION_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$ORGANIZER_CHECKPOINT_RECONCILIATION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$ORGANIZER_CHECKPOINT_RECONCILIATION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$ORGANIZATION_OWNERSHIP_TRANSFER_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$ORGANIZATION_OWNERSHIP_TRANSFER_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$ORGANIZATION_OWNERSHIP_TRANSFER_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PLATFORM_RECORD_OWNERSHIP_TRANSFER_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PLATFORM_RECORD_OWNERSHIP_TRANSFER_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PLATFORM_RECORD_OWNERSHIP_TRANSFER_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$ATHLETE_ACCOUNT_OWNERSHIP_INVARIANT_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$ATHLETE_ACCOUNT_OWNERSHIP_INVARIANT_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$ATHLETE_ACCOUNT_OWNERSHIP_INVARIANT_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PLATFORM_RECORD_DELETION_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PLATFORM_RECORD_DELETION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PLATFORM_RECORD_DELETION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PLATFORM_MANAGEMENT_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PLATFORM_MANAGEMENT_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PLATFORM_MANAGEMENT_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$ORGANIZATION_OWNER_DELETION_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$ORGANIZATION_OWNER_DELETION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$ORGANIZATION_OWNER_DELETION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$ORGANIZER_UNUSED_RACE_DELETION_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$ORGANIZER_UNUSED_RACE_DELETION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$ORGANIZER_UNUSED_RACE_DELETION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$ORGANIZER_TRACK_DELETION_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$ORGANIZER_TRACK_DELETION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$ORGANIZER_TRACK_DELETION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$EVENT_RECORD_LIFECYCLE_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$EVENT_RECORD_LIFECYCLE_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$EVENT_RECORD_LIFECYCLE_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$PUBLIC_EVENT_HISTORY_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$PUBLIC_EVENT_HISTORY_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$PUBLIC_EVENT_HISTORY_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$FINISHED_RACE_OPERATIONS_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$FINISHED_RACE_OPERATIONS_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$FINISHED_RACE_OPERATIONS_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

if [ -f "$ONSITE_REGISTRATION_SMOKE_FILE" ]; then
  printf -- "-- FILE: %s\n" "$ONSITE_REGISTRATION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  cat "$ONSITE_REGISTRATION_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
  printf "\n" >> "$COMBINED_MIGRATION_FILE"
fi

cat "$SECURITY_PRIVACY_SMOKE_FILE" >> "$COMBINED_MIGRATION_FILE"
cat "$ROOT_DIR/packages/db/scripts/event-photo-contributors-smoke.sql" >> "$COMBINED_MIGRATION_FILE"
cat "$ROOT_DIR/packages/db/scripts/notifications-smoke.sql" >> "$COMBINED_MIGRATION_FILE"
cat "$ROOT_DIR/packages/db/scripts/release-readiness-smoke.sql" >> "$COMBINED_MIGRATION_FILE"

cat <<'SQL' >> "$COMBINED_MIGRATION_FILE"
-- Validation-only security assertions for the application boundary.
do $$
declare
  function_signature text;
  payment_table_name text;
begin
  if not exists (
    select 1
    from pg_class relation
    where relation.oid = 'public.public_athlete_profiles'::regclass
      and relation.reloptions @> array['security_invoker=true']
  ) then
    raise exception 'public_athlete_profiles must use security_invoker';
  end if;

  if has_column_privilege('anon', 'public.athlete_profiles', 'primary_email', 'SELECT')
     or has_column_privilege('authenticated', 'public.athlete_profiles', 'date_of_birth', 'SELECT') then
    raise exception 'private athlete identity columns are browser-readable';
  end if;

  if has_table_privilege('anon', 'public.athlete_favorites', 'SELECT')
     or not has_table_privilege('authenticated', 'public.athlete_favorites', 'SELECT')
     or has_table_privilege('authenticated', 'public.athlete_favorites', 'INSERT')
     or has_table_privilege('authenticated', 'public.athlete_favorites', 'UPDATE')
     or has_table_privilege('authenticated', 'public.athlete_favorites', 'DELETE') then
    raise exception 'athlete favorite grants must allow only authenticated RLS-protected reads';
  end if;

  if not exists (
    select 1
    from pg_class relation
    where relation.oid = 'public.club_admin_role_requests'::regclass
      and relation.relrowsecurity
  ) then
    raise exception 'club_admin_role_requests must have row level security enabled';
  end if;

  if has_table_privilege('anon', 'public.club_admin_role_requests', 'SELECT')
     or has_table_privilege('authenticated', 'public.club_admin_role_requests', 'SELECT')
     or has_table_privilege('authenticated', 'public.club_admin_role_requests', 'INSERT') then
    raise exception 'club admin requests bypass the server review boundary';
  end if;

  if not exists (
    select 1
    from pg_class relation
    where relation.oid = 'public.platform_support_tickets'::regclass
      and relation.relrowsecurity
  ) or not exists (
    select 1
    from pg_class relation
    where relation.oid = 'public.platform_support_ticket_messages'::regclass
      and relation.relrowsecurity
  ) then
    raise exception 'platform support ticket tables must have row level security enabled';
  end if;

  if has_table_privilege('anon', 'public.platform_support_tickets', 'SELECT')
     or has_table_privilege('authenticated', 'public.platform_support_tickets', 'SELECT')
     or has_table_privilege('authenticated', 'public.platform_support_ticket_messages', 'INSERT') then
    raise exception 'platform support tickets bypass the application server boundary';
  end if;

  if not exists (
    select 1
    from pg_class relation
    where relation.oid = 'public.domain_events'::regclass
      and relation.relrowsecurity
  ) or not exists (
    select 1
    from pg_class relation
    where relation.oid = 'public.workflow_jobs'::regclass
      and relation.relrowsecurity
  ) then
    raise exception 'platform workflow tables must have row level security enabled';
  end if;

  if has_table_privilege('anon', 'public.domain_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.domain_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.workflow_jobs', 'UPDATE') then
    raise exception 'platform workflow state bypasses the application server boundary';
  end if;

  if not exists (
    select 1
    from pg_class relation
    where relation.oid = 'public.league_round_mapping_source_versions'::regclass
      and relation.relrowsecurity
  ) then
    raise exception 'mapped league source versions must have row level security enabled';
  end if;

  if has_table_privilege('anon', 'public.league_round_mapping_source_versions', 'SELECT')
     or has_table_privilege('authenticated', 'public.league_round_mapping_source_versions', 'SELECT')
     or has_table_privilege('authenticated', 'public.league_round_mapping_source_versions', 'INSERT') then
    raise exception 'mapped league sources bypass the application server boundary';
  end if;

  foreach payment_table_name in array array[
    'organization_bank_transfer_profiles',
    'registration_payment_requests',
    'registration_payment_events'
  ]
  loop
    if not exists (
      select 1
      from pg_class relation
      where relation.oid = format('public.%I', payment_table_name)::regclass
        and relation.relrowsecurity
    ) then
      raise exception '% must have row level security enabled', payment_table_name;
    end if;

    if has_table_privilege('anon', format('public.%I', payment_table_name), 'SELECT')
       or has_table_privilege('anon', format('public.%I', payment_table_name), 'INSERT')
       or has_table_privilege('authenticated', format('public.%I', payment_table_name), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', payment_table_name), 'UPDATE') then
      raise exception '% bypasses the application server boundary', payment_table_name;
    end if;

    if not has_table_privilege('service_role', format('public.%I', payment_table_name), 'SELECT')
       or not has_table_privilege('service_role', format('public.%I', payment_table_name), 'INSERT') then
      raise exception 'service_role cannot operate on %', payment_table_name;
    end if;
  end loop;

  foreach function_signature in array array[
    'public.service_request_account_context(uuid)',
    'public.service_request_auth_user(uuid,uuid)',
    'public.service_request_account_context(uuid,uuid)',
    'public.service_submit_track_condition_report(uuid,uuid,text,public.track_condition_report_status,text,text)',
    'public.service_upsert_track_review(uuid,uuid,text,smallint,text,text)',
    'public.service_remove_event_favorite(uuid,uuid,text)',
    'public.service_join_club(uuid,uuid,uuid)',
    'public.service_leave_club(uuid,uuid,uuid)',
    'public.service_submit_athlete_profile_claim(uuid,uuid,jsonb,text)',
    'public.service_submit_club_admin_role_request(uuid,uuid,uuid,text,text)',
    'public.service_decide_athlete_profile_claim(uuid,uuid,text,text)',
    'public.service_decide_club_admin_role_request(uuid,uuid,text,text)',
    'public.service_create_support_ticket(uuid,text,text,text)',
    'public.service_append_support_ticket_message(uuid,uuid,text,text)',
    'public.service_update_support_ticket_status(uuid,uuid,text)',
    'public.service_expire_registration_holds(uuid)',
    'public.service_promote_waitlist_offer(uuid,uuid,integer)',
    'public.service_cancel_registration_atomically(uuid,uuid,text)',
    'public.service_prepare_payment_attempt(uuid,uuid,text,text)',
    'public.service_attach_payment_checkout(uuid,uuid,text,text,timestamp with time zone)',
    'public.service_apply_payment_provider_event(text,text,text,boolean,boolean,jsonb,uuid,text,text,integer,text)',
    'public.service_prepare_payment_refund(uuid,uuid,integer,text,text,text)',
    'public.service_complete_payment_refund(uuid,uuid,text,boolean,text)',
    'public.service_run_payment_reconciliation(uuid,uuid)',
    'public.service_save_organization_payment_account(uuid,uuid,text,text,boolean,boolean,jsonb,jsonb)',
    'public.service_save_organization_bank_transfer_profile(uuid,uuid,text,text,text,text,text,text,text,text,text,boolean)',
    'public.service_ensure_registration_bank_transfer_request(uuid,uuid)',
    'public.service_report_registration_bank_transfer(uuid,uuid,text)',
    'public.service_record_registration_bank_payment(uuid,uuid,integer,text,timestamp with time zone,text,text,text)',
    'public.service_record_registration_desk_payment(uuid,uuid,text)',
    'public.service_issue_guest_registration_access(uuid,text,text)',
    'public.service_validate_guest_registration_access(uuid,text)',
    'public.service_claim_guest_registration(uuid,text,uuid,text)',
    'public.service_record_payment_refund_state(uuid,uuid,text,text,text)',
    'public.service_apply_refund_provider_event(text,text,text,boolean,boolean,jsonb,uuid,text,text,text)',
    'public.service_store_registration_submission(uuid,uuid,jsonb,uuid[],uuid,text)',
    'public.service_create_registration_submission(uuid,uuid,uuid,uuid,boolean,text,text,uuid,jsonb,uuid[])',
    'public.service_create_guest_registration_submission(uuid,text,text,text,text,text,date,text,text,text,text,text,text,text,boolean,text,text,uuid,jsonb,uuid[])',
    'public.service_publish_registration_configuration(uuid,uuid,text,text,text,jsonb,jsonb)',
    'public.service_allocate_category_bibs(uuid,uuid,integer,text,integer,text,text)',
    'public.service_freeze_start_list_manifest(uuid,uuid,text)',
    'public.service_reopen_start_list(uuid,uuid,text)',
    'public.service_save_timing_device(uuid,uuid,text,text,text,integer,integer,text,jsonb)',
    'public.service_publish_timing_plan(uuid,uuid,text,integer,jsonb)',
    'public.service_record_pre_race_rehearsal(uuid,uuid,boolean,jsonb,jsonb,text)',
    'public.service_create_registration_import_preview(uuid,uuid,text,text,text,jsonb,jsonb)',
    'public.service_commit_registration_import(uuid,uuid)',
    'public.service_save_communication_template(uuid,uuid,text,text,text,text)',
    'public.service_schedule_communication_campaign(uuid,uuid,uuid,text,text[],uuid[],timestamp with time zone)',
    'public.service_cancel_communication_campaign(uuid,uuid,text)',
    'public.service_record_race_start_event(uuid,uuid,text,timestamp with time zone,timestamp with time zone,text,text,uuid)',
    'public.service_finish_race_categories(uuid,uuid[],uuid,uuid)',
    'public.service_complete_workflow_job(uuid,text,jsonb)',
    'public.service_record_workflow_job_failure(uuid,text,text)',
    'public.service_publish_result_run_with_workflows(uuid,uuid,public.publication_state,uuid,text,uuid)',
    'public.service_process_result_publication_leagues(uuid,uuid)',
    'public.service_process_league_standings_job(uuid,uuid)',
    'public.service_dispatch_realtime_invalidation_jobs(integer)',
    'public.service_requeue_realtime_invalidation_job(uuid)',
    'public.service_realtime_invalidation_health()',
    'public.service_claim_workflow_jobs(text[],integer,uuid,integer)',
    'public.service_record_claimed_workflow_job_failure(uuid,uuid,text)',
    'public.service_requeue_workflow_job(uuid)',
    'public.service_workflow_queue_health()',
    'public.service_record_participant_status(uuid,uuid,text,timestamp with time zone,text,uuid,boolean,jsonb)',
    'public.service_revise_punch_event(uuid,uuid,text,text,uuid,timestamp with time zone,uuid)',
    'public.service_resolve_result_anomaly(uuid,uuid,text,text)',
    'public.service_publish_result_run_guarded(uuid,uuid,public.publication_state,uuid,text)',
    'public.service_record_cutoff_action(uuid,uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,text,text,boolean,text,uuid)',
    'public.service_record_checkpoint_operation(uuid,uuid,text,timestamp with time zone,text,jsonb,uuid)',
    'public.service_signoff_field_accounting(uuid,uuid,boolean,text,uuid)',
    'public.service_configure_public_live(uuid,uuid,boolean,integer,boolean,text,boolean)',
    'public.service_create_dns_review(uuid,uuid,text,uuid)',
    'public.service_commit_dns_review(uuid,uuid)',
    'public.service_create_safety_plan_version(uuid,uuid,jsonb,jsonb,boolean)',
    'public.service_create_safety_incident(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone,uuid,boolean,uuid)',
    'public.service_append_safety_incident_event(uuid,uuid,text,text,text,jsonb,uuid,boolean,boolean,boolean,uuid)',
    'public.service_log_safety_record_access(uuid,uuid,uuid,text,text)',
    'public.service_create_staff_assignment(uuid,uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,timestamp with time zone,uuid,boolean,text,uuid,uuid,uuid)',
    'public.service_append_staff_assignment_event(uuid,uuid,text,text,text,jsonb,uuid)',
    'public.service_create_operations_task(uuid,uuid,uuid,text,text,text,uuid,timestamp with time zone,boolean,uuid[],uuid,uuid)',
    'public.service_append_operations_task_event(uuid,uuid,text,text,text,jsonb,uuid)',
    'public.service_create_event_inventory_item(uuid,text,text,text,boolean,numeric,numeric,uuid,uuid)',
    'public.service_record_inventory_movement(uuid,uuid,text,numeric,uuid,text,text,uuid)',
    'public.service_reconcile_organizer_category_checkpoints(uuid,uuid,jsonb)',
    'public.service_delete_unused_event_category(uuid)',
    'public.service_delete_organizer_track(uuid,uuid,uuid)',
    'public.service_register_timing_fleet_device(uuid,uuid,text,text,text,text,text,text,integer,integer,text,text,text,timestamp with time zone,jsonb,uuid)',
    'public.service_create_timing_device_assignment(uuid,uuid,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,integer,uuid,uuid)',
    'public.service_update_timing_device_assignment(uuid,uuid,text,text,uuid)',
    'public.service_append_timing_device_event(uuid,uuid,text,text,jsonb,uuid)',
    'public.service_save_timing_provider_connection(uuid,uuid,text,text,text,text,jsonb,text,integer,text,text,uuid)',
    'public.service_stage_timing_ingestion_batch(uuid,uuid,text,text,text,integer,uuid,uuid)',
    'public.service_stage_external_timing_event(uuid,text,text,uuid,uuid,uuid,timestamp with time zone,text,text,jsonb,uuid)',
    'public.service_reconcile_timing_ingestion_batch(uuid,text,integer,integer,integer,jsonb)',
    'public.service_transfer_organization_ownership(uuid,uuid,uuid,uuid)',
    'public.service_transfer_platform_organization_record(text,uuid,uuid,uuid,uuid,text)',
    'public.service_transfer_club_ownership(uuid,uuid,uuid,uuid,text)',
    'public.service_reassign_athlete_profile_account(uuid,uuid,uuid,uuid,text)',
    'public.service_assert_platform_account_deletable(uuid,uuid)',
    'public.service_update_platform_account_profile(uuid,uuid,text,text,text,text)',
    'public.service_update_platform_organization(uuid,uuid,text,text,text,text,text,text,text,text)',
    'public.service_delete_platform_organization(uuid,uuid,text,text)',
    'public.service_set_club_sports(uuid,text[],text)',
    'public.service_delete_unused_organizer_workspace(uuid,uuid,text)',
    'public.service_create_organizer_onsite_registration(uuid,uuid,uuid,text,text,text,text,date,text,text,text,text,text,text,boolean,boolean,uuid,text,text)',
    'public.service_complete_terminal_race_edition(uuid,uuid,uuid)'
  ]
  loop
    if has_function_privilege('anon', function_signature, 'EXECUTE')
       or has_function_privilege('authenticated', function_signature, 'EXECUTE') then
      raise exception 'browser role can execute protected athlete command: %', function_signature;
    end if;

    if not has_function_privilege('service_role', function_signature, 'EXECUTE') then
      raise exception 'service role cannot execute protected athlete command: %', function_signature;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_class relation
    where relation.oid = 'public.platform_record_ownership_transfers'::regclass
      and relation.relrowsecurity
  ) then
    raise exception 'platform transfer ledger must have row level security enabled';
  end if;

  if has_table_privilege('anon', 'public.platform_record_ownership_transfers', 'SELECT')
     or has_table_privilege('authenticated', 'public.platform_record_ownership_transfers', 'SELECT')
     or has_table_privilege('authenticated', 'public.platform_record_ownership_transfers', 'INSERT') then
    raise exception 'platform transfer ledger bypasses the application server boundary';
  end if;

  if not has_table_privilege('service_role', 'public.platform_record_ownership_transfers', 'SELECT')
     or not has_table_privilege('service_role', 'public.platform_record_ownership_transfers', 'INSERT')
     or has_table_privilege('service_role', 'public.platform_record_ownership_transfers', 'UPDATE')
     or has_table_privilege('service_role', 'public.platform_record_ownership_transfers', 'DELETE') then
    raise exception 'platform transfer ledger grants are not immutable';
  end if;

  if not exists (
    select 1
    from pg_class relation
    where relation.oid = 'public.platform_management_actions'::regclass
      and relation.relrowsecurity
  ) then
    raise exception 'platform management ledger must have row level security enabled';
  end if;

  if has_table_privilege('anon', 'public.platform_management_actions', 'SELECT')
     or has_table_privilege('authenticated', 'public.platform_management_actions', 'SELECT')
     or has_table_privilege('authenticated', 'public.platform_management_actions', 'INSERT') then
    raise exception 'platform management ledger bypasses the application server boundary';
  end if;

  if not has_table_privilege('service_role', 'public.platform_management_actions', 'SELECT')
     or not has_table_privilege('service_role', 'public.platform_management_actions', 'INSERT')
     or has_table_privilege('service_role', 'public.platform_management_actions', 'UPDATE')
     or has_table_privilege('service_role', 'public.platform_management_actions', 'DELETE') then
    raise exception 'platform management ledger grants are not immutable';
  end if;

  if not exists (
    select 1
    from pg_class relation
    where relation.oid = 'public.club_sports'::regclass
      and relation.relrowsecurity
  ) then
    raise exception 'club sports must have row level security enabled';
  end if;

  if has_table_privilege('anon', 'public.club_sports', 'SELECT')
     or has_table_privilege('authenticated', 'public.club_sports', 'SELECT')
     or has_table_privilege('authenticated', 'public.club_sports', 'INSERT') then
    raise exception 'club sports bypasses the application server boundary';
  end if;

  if not has_table_privilege('service_role', 'public.club_sports', 'SELECT')
     or not has_table_privilege('service_role', 'public.club_sports', 'INSERT')
     or not has_table_privilege('service_role', 'public.club_sports', 'UPDATE')
     or not has_table_privilege('service_role', 'public.club_sports', 'DELETE') then
    raise exception 'service role cannot manage club sports';
  end if;

  insert into auth.users (
    id,
    aud,
    role,
    email,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data
  ) values (
    'f1000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'request-session-validation@example.test',
    now(),
    '{"provider":"email"}'::jsonb,
    '{"display_name":"Request Session Validation"}'::jsonb
  );

  insert into auth.sessions (id, user_id, not_after)
  values (
    'f1000000-0000-4000-8000-000000000002'::uuid,
    'f1000000-0000-4000-8000-000000000001'::uuid,
    now() + interval '1 hour'
  );

  if public.service_request_auth_user(
    'f1000000-0000-4000-8000-000000000001'::uuid,
    'f1000000-0000-4000-8000-000000000002'::uuid
  ) is null then
    raise exception 'active request session must resolve its current auth user';
  end if;

  if public.service_request_account_context(
    'f1000000-0000-4000-8000-000000000001'::uuid,
    'f1000000-0000-4000-8000-000000000002'::uuid
  ) -> 'auth_user' is null then
    raise exception 'active request session must resolve a compact account context';
  end if;

  update auth.sessions
  set not_after = now() - interval '1 second'
  where id = 'f1000000-0000-4000-8000-000000000002'::uuid;

  if public.service_request_auth_user(
    'f1000000-0000-4000-8000-000000000001'::uuid,
    'f1000000-0000-4000-8000-000000000002'::uuid
  ) is not null then
    raise exception 'expired request session must be rejected';
  end if;

  update auth.sessions
  set not_after = now() + interval '1 hour'
  where id = 'f1000000-0000-4000-8000-000000000002'::uuid;

  update auth.users
  set banned_until = now() + interval '1 hour'
  where id = 'f1000000-0000-4000-8000-000000000001'::uuid;

  if public.service_request_auth_user(
    'f1000000-0000-4000-8000-000000000001'::uuid,
    'f1000000-0000-4000-8000-000000000002'::uuid
  ) is not null then
    raise exception 'banned request user must be rejected';
  end if;

  update auth.users
  set banned_until = null,
      deleted_at = now()
  where id = 'f1000000-0000-4000-8000-000000000001'::uuid;

  if public.service_request_auth_user(
    'f1000000-0000-4000-8000-000000000001'::uuid,
    'f1000000-0000-4000-8000-000000000002'::uuid
  ) is not null then
    raise exception 'deleted request user must be rejected';
  end if;

  delete from auth.users
  where id = 'f1000000-0000-4000-8000-000000000001'::uuid;
end
$$;

SQL

if "$PG_BIN/psql" -X -h "$PGHOST" -d postgres -Atqc "select 1" >/dev/null 2>&1; then
  if [ "$REWARD_DEMO_VALIDATION" -eq 1 ]; then
    local_demo_target=$("$PG_BIN/psql" -X -h "$PGHOST" -d postgres -Atqc "select inet_server_addr() in ('127.0.0.1'::inet,'::1'::inet) and inet_server_port()=5432;")
    if [ "$local_demo_target" != 't' ]; then
      printf 'Reward demo validation rejected non-local server identity\n' >&2
      exit 1
    fi
  fi
  "$PG_BIN/psql" -X -h "$PGHOST" -d postgres -v ON_ERROR_STOP=1 -qc "create database $LOCAL_DB_NAME;" >/dev/null
  LOCAL_DB_CREATED=1
  printf 'Owned local migration database: %s\n' "$LOCAL_DB_NAME"

  if ! "$PG_BIN/psql" -X -h "$PGHOST" -v ON_ERROR_STOP=1 -d "$LOCAL_DB_NAME" -f "$COMBINED_MIGRATION_FILE" >"$LOG_FILE" 2>&1; then
    cat "$LOG_FILE" >&2
    exit 1
  fi

  if ! run_phase1_concurrency_check >>"$LOG_FILE" 2>&1; then
    cat "$LOG_FILE" >&2
    exit 1
  fi

  if ! run_workflow_recovery_concurrency_check >>"$LOG_FILE" 2>&1; then
    cat "$LOG_FILE" >&2
    exit 1
  fi

  if ! run_strava_oauth_concurrency_check >>"$LOG_FILE" 2>&1; then
    cat "$LOG_FILE" >&2
    exit 1
  fi

  if [ "$REWARD_DEMO_VALIDATION" -eq 1 ]; then
    # Explicit demo-only reward service -> repository -> SQL integration in
    # this owned scratch database. Rebuild to avoid stale dist verification.
    if ! npm --prefix "$ROOT_DIR" run api:check >>"$LOG_FILE" 2>&1; then
      cat "$LOG_FILE" >&2
      exit 1
    fi
    if ! node "$ROOT_DIR/packages/db/scripts/reward-db-integration.mjs" "$PG_BIN/psql" "$PGHOST" "$LOCAL_DB_NAME" >>"$LOG_FILE" 2>&1; then
      cat "$LOG_FILE" >&2
      exit 1
    fi
    grep '^Reward real-database integration passed:' "$LOG_FILE"
  fi

  if [ "$REWARD_CHAIN_REHEARSAL" -eq 1 ]; then
    # A separate parent-owned database keeps both full suites independent. Never
    # reset the ordinary local database or skip the standard concurrency suite.
    "$PG_BIN/psql" -X -h "$PGHOST" -d postgres -v ON_ERROR_STOP=1 -qc "create database $REWARD_CHAIN_DB_NAME;"
    REWARD_CHAIN_DB_CREATED=1
    if ! "$PG_BIN/psql" -X -h "$PGHOST" -v ON_ERROR_STOP=1 -d "$REWARD_CHAIN_DB_NAME" -f "$COMBINED_MIGRATION_FILE" >>"$LOG_FILE" 2>&1; then
      cat "$LOG_FILE" >&2
      exit 1
    fi
    if ! node "$ROOT_DIR/packages/db/scripts/reward-chain-rehearsal.mjs" "$PG_BIN/psql" "$PGHOST" "$REWARD_CHAIN_DB_NAME" >>"$LOG_FILE" 2>&1; then
      cat "$LOG_FILE" >&2
      exit 1
    fi
    grep '^Reward real-database/chain rehearsal passed:' "$LOG_FILE"
  fi

  if [ "$REWARD_DEMO_VALIDATION" -eq 1 ]; then
    printf 'Validated isolated reward demo migrations and services using local PostgreSQL (portal base plus demo overlay).\n'
  else
    printf "Validated production-only migrations using local PostgreSQL: %s\n" "$MIGRATIONS_DIR"
  fi
  exit 0
fi

"$PG_BIN/initdb" -D "$DATA_DIR" >/dev/null

if ! "$PG_BIN/postgres" --single -j -D "$DATA_DIR" postgres < "$COMBINED_MIGRATION_FILE" >"$LOG_FILE" 2>&1; then
  cat "$LOG_FILE" >&2
  exit 1
fi

# The single-user backend can exit zero after SQL errors. Never report those
# failed migrations/assertions as a successful security validation.
if grep -Eq '(ERROR|FATAL|PANIC):' "$LOG_FILE"; then
  cat "$LOG_FILE" >&2
  exit 1
fi

printf "Single-user migration SQL replay passed: %s\n" "$MIGRATIONS_DIR"
printf "Reward service/concurrency verification requires a loopback multi-connection PostgreSQL server; single-user replay is insufficient.\n" >&2
exit 1
