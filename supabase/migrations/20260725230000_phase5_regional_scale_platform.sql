/*
 * Phase 5 — regional scale platform.
 *
 * Adds governed historical identity resolution, partner API/webhook custody,
 * multi-organization networks, and versioned localization. Secrets are shown
 * once and stored only as SHA-256 digests. Historical source payloads and
 * localized content are immutable evidence.
 */

insert into public.organization_permission_catalog (
  permission_code,
  area,
  title,
  description,
  sensitivity,
  staff_default,
  timer_default
)
values
  (
    'imports.resolve',
    'imports',
    'Resolve historical imports',
    'Review imported identities, matches, claims, and merge decisions.',
    'restricted',
    false,
    false
  ),
  (
    'partners.manage',
    'partners',
    'Manage partner access',
    'Issue partner credentials and configure signed webhooks.',
    'restricted',
    false,
    false
  ),
  (
    'network.manage',
    'network',
    'Manage organization network',
    'Invite and administer organizations in a regional operating network.',
    'restricted',
    false,
    false
  ),
  (
    'localization.manage',
    'localization',
    'Manage localization',
    'Configure locale, timezone, units, and versioned translations.',
    'elevated',
    true,
    false
  )
on conflict (permission_code) do nothing;
create table public.historical_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  source_system text not null,
  source_reference text not null,
  batch_state text not null default 'open',
  mapping_version text not null,
  source_digest_sha256 text not null,
  record_count integer not null,
  matched_count integer not null default 0,
  unresolved_count integer not null default 0,
  rejected_count integer not null default 0,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  unique (organization_id, source_system, source_reference, source_digest_sha256),
  check (length(trim(source_system)) between 2 and 80),
  check (length(trim(source_reference)) between 2 and 240),
  check (batch_state in ('open', 'review', 'completed', 'rejected')),
  check (length(trim(mapping_version)) > 0),
  check (source_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (record_count >= 0 and matched_count >= 0 and unresolved_count >= 0 and rejected_count >= 0),
  check (jsonb_typeof(metadata_json) = 'object')
);
create table public.historical_import_records (
  id uuid primary key default gen_random_uuid(),
  historical_import_batch_id uuid not null
    references public.historical_import_batches (id) on delete restrict,
  source_record_key text not null,
  record_type text not null,
  source_payload_json jsonb not null,
  source_payload_digest_sha256 text not null,
  resolution_state text not null default 'unresolved',
  resolved_entity_type text,
  resolved_entity_id uuid,
  match_confidence numeric(5, 4),
  resolution_note text,
  created_at timestamptz not null default clock_timestamp(),
  unique (historical_import_batch_id, source_record_key),
  check (record_type in ('athlete', 'club', 'result', 'membership', 'league_standing')),
  check (jsonb_typeof(source_payload_json) = 'object'),
  check (source_payload_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (resolution_state in ('unresolved', 'candidate', 'matched', 'rejected', 'merged')),
  check (resolved_entity_type is null or resolved_entity_type in ('athlete', 'club', 'result')),
  check (match_confidence is null or match_confidence between 0 and 1),
  check (
    (resolution_state in ('matched', 'merged') and resolved_entity_id is not null)
    or resolution_state not in ('matched', 'merged')
  )
);
create table public.identity_resolution_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  historical_import_record_id uuid
    references public.historical_import_records (id) on delete restrict,
  subject_type text not null,
  source_entity_id uuid,
  candidate_entity_ids uuid[] not null default '{}',
  canonical_entity_id uuid,
  case_state text not null default 'pending',
  evidence_json jsonb not null default '{}'::jsonb,
  evidence_digest_sha256 text not null,
  decision_note text,
  submitted_by_user_id uuid not null,
  decided_by_user_id uuid,
  submitted_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  client_event_id uuid not null unique,
  check (subject_type in ('athlete', 'club')),
  check (case_state in ('pending', 'needs_information', 'matched', 'merged', 'rejected', 'cancelled')),
  check (jsonb_typeof(evidence_json) = 'object'),
  check (evidence_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (
    case_state in ('pending', 'cancelled')
    or (decided_by_user_id is not null and decided_at is not null and length(trim(decision_note)) > 0)
  ),
  check (
    case_state not in ('matched', 'merged')
    or canonical_entity_id is not null
  ),
  check (
    case_state <> 'merged'
    or source_entity_id is not null
  )
);
create table public.identity_resolution_events (
  id uuid primary key default gen_random_uuid(),
  identity_resolution_case_id uuid not null
    references public.identity_resolution_cases (id) on delete restrict,
  sequence_number integer not null,
  event_type text not null,
  note text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid not null,
  client_event_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (identity_resolution_case_id, sequence_number),
  check (event_type in ('submitted', 'evidence_added', 'information_requested', 'matched', 'merged', 'rejected', 'cancelled')),
  check (length(trim(note)) > 0),
  check (jsonb_typeof(metadata_json) = 'object')
);
create table public.partner_api_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  client_key text not null,
  display_name text not null,
  client_state text not null default 'active',
  scopes text[] not null,
  credential_prefix text not null,
  credential_digest_sha256 text not null,
  rate_limit_per_minute integer not null default 120,
  allowed_ip_cidrs text[] not null default '{}',
  expires_at timestamptz,
  last_used_at timestamptz,
  created_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  revoked_by_user_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  unique (organization_id, client_key),
  unique (credential_digest_sha256),
  check (client_key ~ '^[a-z][a-z0-9_-]{2,79}$'),
  check (length(trim(display_name)) between 2 and 160),
  check (client_state in ('active', 'suspended', 'revoked', 'expired')),
  check (cardinality(scopes) between 1 and 30),
  check (credential_prefix ~ '^stp_[a-z0-9]{8}$'),
  check (credential_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (rate_limit_per_minute between 1 and 10000),
  check (expires_at is null or expires_at > created_at),
  check (
    client_state <> 'revoked'
    or (
      revoked_by_user_id is not null
      and revoked_at is not null
      and length(trim(revocation_reason)) > 0
    )
  )
);
create table public.partner_webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  partner_api_client_id uuid not null references public.partner_api_clients (id) on delete restrict,
  subscription_state text not null default 'active',
  endpoint_url text not null,
  event_types text[] not null,
  signing_secret_prefix text not null,
  signing_secret_digest_sha256 text not null,
  max_attempts integer not null default 8,
  timeout_ms integer not null default 10000,
  created_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  disabled_at timestamptz,
  unique (partner_api_client_id, endpoint_url),
  unique (signing_secret_digest_sha256),
  check (subscription_state in ('active', 'paused', 'disabled')),
  check (endpoint_url ~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(/.*)?$'),
  check (cardinality(event_types) between 1 and 40),
  check (signing_secret_prefix ~ '^whsec_[a-z0-9]{8}$'),
  check (signing_secret_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (max_attempts between 1 and 20),
  check (timeout_ms between 1000 and 60000)
);
create table public.partner_outbox_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload_json jsonb not null,
  payload_digest_sha256 text not null,
  delivery_state text not null default 'queued',
  available_at timestamptz not null default clock_timestamp(),
  dispatched_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, event_type, aggregate_type, aggregate_id, payload_digest_sha256),
  check (event_type ~ '^[a-z][a-z0-9_.:-]{2,119}$'),
  check (aggregate_type ~ '^[a-z][a-z0-9_:-]{1,79}$'),
  check (jsonb_typeof(payload_json) = 'object'),
  check (payload_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (delivery_state in ('queued', 'dispatching', 'dispatched', 'failed'))
);
create table public.partner_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  partner_webhook_subscription_id uuid not null
    references public.partner_webhook_subscriptions (id) on delete restrict,
  outbox_event_id uuid references public.partner_outbox_events (id) on delete restrict,
  event_type text not null,
  event_id uuid not null,
  attempt_number integer not null,
  delivery_state text not null,
  payload_digest_sha256 text not null,
  response_status integer,
  response_digest_sha256 text,
  duration_ms integer,
  next_attempt_at timestamptz,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  unique (partner_webhook_subscription_id, event_id, attempt_number),
  check (attempt_number > 0),
  check (delivery_state in ('queued', 'delivered', 'retrying', 'failed', 'discarded')),
  check (payload_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (response_digest_sha256 is null or response_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (response_status is null or response_status between 100 and 599),
  check (duration_ms is null or duration_ms >= 0)
);
create table public.organization_networks (
  id uuid primary key default gen_random_uuid(),
  owner_organization_id uuid not null references public.organizations (id) on delete restrict,
  slug text not null unique,
  name text not null,
  network_type text not null default 'regional',
  network_state text not null default 'active',
  country_codes char(2)[] not null default '{}',
  default_locale text not null default 'hr-HR',
  default_timezone text not null default 'Europe/Zagreb',
  created_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  check (length(trim(name)) between 2 and 160),
  check (network_type in ('regional', 'league', 'federation', 'operator_group')),
  check (network_state in ('active', 'suspended', 'archived')),
  check (default_locale ~ '^[a-z]{2,3}(?:-[A-Z][A-Za-z0-9]{1,7})?$'),
  check (length(trim(default_timezone)) > 0)
);
create table public.organization_network_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_network_id uuid not null
    references public.organization_networks (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  membership_role text not null default 'member',
  membership_state text not null default 'invited',
  data_sharing_scopes text[] not null default '{}',
  invited_by_user_id uuid not null,
  invited_at timestamptz not null default clock_timestamp(),
  accepted_by_user_id uuid,
  accepted_at timestamptz,
  accepted_client_event_id uuid unique,
  revoked_by_user_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  client_event_id uuid not null unique,
  unique (organization_network_id, organization_id),
  check (membership_role in ('owner', 'administrator', 'member', 'results_provider', 'observer')),
  check (membership_state in ('invited', 'active', 'suspended', 'revoked', 'declined')),
  check (
    membership_state <> 'active'
    or (accepted_by_user_id is not null and accepted_at is not null)
  ),
  check (
    membership_state <> 'revoked'
    or (
      revoked_by_user_id is not null
      and revoked_at is not null
      and length(trim(revocation_reason)) > 0
    )
  )
);
create table public.organization_localization_profiles (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  primary_locale text not null default 'hr-HR',
  enabled_locales text[] not null default array['hr-HR'],
  timezone text not null default 'Europe/Zagreb',
  measurement_system text not null default 'metric',
  week_start_day smallint not null default 1,
  name_order text not null default 'given_family',
  default_currency char(3) not null default 'EUR',
  version_number integer not null default 1,
  last_client_event_id uuid not null unique,
  updated_by_user_id uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  check (primary_locale = any(enabled_locales)),
  check (primary_locale ~ '^[a-z]{2,3}(?:-[A-Z][A-Za-z0-9]{1,7})?$'),
  check (cardinality(enabled_locales) between 1 and 12),
  check (measurement_system in ('metric', 'imperial')),
  check (week_start_day between 0 and 6),
  check (name_order in ('given_family', 'family_given')),
  check (default_currency ~ '^[A-Z]{3}$'),
  check (version_number > 0)
);
create table public.localized_content_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  locale text not null,
  version_number integer not null,
  fields_json jsonb not null,
  content_digest_sha256 text not null,
  created_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, entity_type, entity_id, locale, version_number),
  check (entity_type in ('organization', 'event_series', 'event_edition', 'event_category', 'club', 'league', 'league_season')),
  check (locale ~ '^[a-z]{2,3}(?:-[A-Z][A-Za-z0-9]{1,7})?$'),
  check (version_number > 0),
  check (jsonb_typeof(fields_json) = 'object' and fields_json <> '{}'::jsonb),
  check (content_digest_sha256 ~ '^[0-9a-f]{64}$')
);
create index historical_import_records_resolution_idx
  on public.historical_import_records (historical_import_batch_id, resolution_state, record_type);
create index identity_resolution_cases_queue_idx
  on public.identity_resolution_cases (organization_id, case_state, submitted_at);
create index partner_api_clients_active_idx
  on public.partner_api_clients (organization_id, client_state, expires_at);
create index partner_webhook_deliveries_retry_idx
  on public.partner_webhook_deliveries (delivery_state, next_attempt_at);
create index partner_outbox_events_dispatch_idx
  on public.partner_outbox_events (delivery_state, available_at);
create index organization_network_memberships_org_idx
  on public.organization_network_memberships (organization_id, membership_state);
create index localized_content_lookup_idx
  on public.localized_content_versions (entity_type, entity_id, locale, version_number desc);
create or replace function public.guard_historical_import_record_resolution()
returns trigger
language plpgsql
set search_path = ''
as $guard$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'phase5_evidence_is_append_only';
  end if;
  if new.id <> old.id
     or new.historical_import_batch_id <> old.historical_import_batch_id
     or new.source_record_key <> old.source_record_key
     or new.record_type <> old.record_type
     or new.source_payload_json <> old.source_payload_json
     or new.source_payload_digest_sha256 <> old.source_payload_digest_sha256
     or new.created_at <> old.created_at
     or old.resolution_state in ('matched', 'rejected', 'merged')
     or new.resolution_state not in ('candidate', 'matched', 'rejected', 'merged') then
    raise exception using errcode = '55000', message = 'historical_import_source_is_immutable';
  end if;
  return new;
end
$guard$;
create trigger historical_import_records_resolution_guard
before update or delete on public.historical_import_records
for each row execute function public.guard_historical_import_record_resolution();
create trigger identity_resolution_events_immutable
before update or delete on public.identity_resolution_events
for each row execute function public.reject_phase5_immutable_mutation();
create trigger partner_webhook_deliveries_immutable
before update or delete on public.partner_webhook_deliveries
for each row execute function public.reject_phase5_immutable_mutation();
create trigger localized_content_versions_immutable
before update or delete on public.localized_content_versions
for each row execute function public.reject_phase5_immutable_mutation();
create or replace function public.service_register_historical_import_batch(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_system text,
  p_source_reference text,
  p_mapping_version text,
  p_source_digest_sha256 text,
  p_record_count integer,
  p_metadata_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $batch$
declare
  existing_batch public.historical_import_batches%rowtype;
  created_batch public.historical_import_batches%rowtype;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'imports.resolve', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'historical_import_permission_required';
  end if;
  if nullif(trim(p_source_system), '') is null
     or nullif(trim(p_source_reference), '') is null
     or nullif(trim(p_mapping_version), '') is null
     or p_source_digest_sha256 !~ '^[0-9a-f]{64}$'
     or coalesce(p_record_count, -1) < 0
     or jsonb_typeof(coalesce(p_metadata_json, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'historical_import_batch_invalid';
  end if;

  select batch.*
  into existing_batch
  from public.historical_import_batches batch
  where batch.client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'batchId', existing_batch.id,
      'batchState', existing_batch.batch_state,
      'replayed', true
    );
  end if;

  insert into public.historical_import_batches (
    organization_id,
    source_system,
    source_reference,
    mapping_version,
    source_digest_sha256,
    record_count,
    unresolved_count,
    metadata_json,
    created_by_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    trim(p_source_system),
    trim(p_source_reference),
    trim(p_mapping_version),
    p_source_digest_sha256,
    p_record_count,
    p_record_count,
    coalesce(p_metadata_json, '{}'::jsonb),
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_batch;

  return jsonb_build_object(
    'batchId', created_batch.id,
    'batchState', created_batch.batch_state,
    'recordCount', created_batch.record_count,
    'sourceDigestSha256', created_batch.source_digest_sha256,
    'replayed', false
  );
end
$batch$;
create or replace function public.service_append_historical_import_record(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_batch_id uuid,
  p_source_record_key text,
  p_record_type text,
  p_source_payload_json jsonb,
  p_candidate_entity_type text,
  p_candidate_entity_id uuid,
  p_match_confidence numeric,
  p_resolution_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $record$
declare
  existing_record public.historical_import_records%rowtype;
  created_record public.historical_import_records%rowtype;
  payload_digest text;
  resolved_state text;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'imports.resolve', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'historical_import_permission_required';
  end if;
  if nullif(trim(p_source_record_key), '') is null
     or p_record_type not in ('athlete', 'club', 'result', 'membership', 'league_standing')
     or jsonb_typeof(coalesce(p_source_payload_json, 'null'::jsonb)) <> 'object'
     or (p_match_confidence is not null and p_match_confidence not between 0 and 1)
     or (
       p_candidate_entity_id is not null
       and p_candidate_entity_type not in ('athlete', 'club', 'result')
     ) then
    raise exception using errcode = '22023', message = 'historical_import_record_invalid';
  end if;

  perform 1
  from public.historical_import_batches batch
  where batch.id = p_batch_id
    and batch.organization_id = p_organization_id
    and batch.batch_state in ('open', 'review')
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'open_historical_import_batch_not_found';
  end if;

  payload_digest := encode(
    public.digest(convert_to(p_source_payload_json::text, 'utf8'), 'sha256'),
    'hex'
  );
  select imported.*
  into existing_record
  from public.historical_import_records imported
  where imported.historical_import_batch_id = p_batch_id
    and imported.source_record_key = p_source_record_key;
  if found then
    if existing_record.source_payload_digest_sha256 <> payload_digest then
      raise exception using errcode = '23505', message = 'historical_source_record_key_reused';
    end if;
    return jsonb_build_object(
      'recordId', existing_record.id,
      'resolutionState', existing_record.resolution_state,
      'sourcePayloadDigestSha256', existing_record.source_payload_digest_sha256,
      'replayed', true
    );
  end if;

  resolved_state := case when p_candidate_entity_id is null then 'unresolved' else 'candidate' end;
  insert into public.historical_import_records (
    historical_import_batch_id,
    source_record_key,
    record_type,
    source_payload_json,
    source_payload_digest_sha256,
    resolution_state,
    resolved_entity_type,
    resolved_entity_id,
    match_confidence,
    resolution_note
  )
  values (
    p_batch_id,
    trim(p_source_record_key),
    p_record_type,
    p_source_payload_json,
    payload_digest,
    resolved_state,
    p_candidate_entity_type,
    p_candidate_entity_id,
    p_match_confidence,
    nullif(trim(p_resolution_note), '')
  )
  returning * into created_record;

  update public.historical_import_batches batch
  set
    matched_count = (
      select count(*)::integer
      from public.historical_import_records imported
      where imported.historical_import_batch_id = batch.id
        and imported.resolution_state in ('matched', 'merged')
    ),
    unresolved_count = greatest(
      batch.record_count - (
        select count(*)::integer
        from public.historical_import_records imported
        where imported.historical_import_batch_id = batch.id
          and imported.resolution_state in ('matched', 'merged', 'rejected')
      ),
      0
    ),
    batch_state = 'review'
  where batch.id = p_batch_id;

  return jsonb_build_object(
    'recordId', created_record.id,
    'resolutionState', created_record.resolution_state,
    'sourcePayloadDigestSha256', created_record.source_payload_digest_sha256,
    'replayed', false
  );
end
$record$;
create or replace function public.service_submit_identity_resolution_case(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_historical_import_record_id uuid,
  p_subject_type text,
  p_source_entity_id uuid,
  p_candidate_entity_ids uuid[],
  p_evidence_json jsonb,
  p_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $identity_submit$
declare
  created_case public.identity_resolution_cases%rowtype;
  existing_case public.identity_resolution_cases%rowtype;
  evidence_digest text;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'imports.resolve', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'identity_resolution_permission_required';
  end if;
  if p_subject_type not in ('athlete', 'club')
     or jsonb_typeof(coalesce(p_evidence_json, 'null'::jsonb)) <> 'object'
     or nullif(trim(p_note), '') is null then
    raise exception using errcode = '22023', message = 'identity_resolution_case_invalid';
  end if;
  if p_historical_import_record_id is not null and not exists (
    select 1
    from public.historical_import_records imported
    join public.historical_import_batches batch
      on batch.id = imported.historical_import_batch_id
    where imported.id = p_historical_import_record_id
      and batch.organization_id = p_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'historical_import_record_not_found';
  end if;

  select resolution.*
  into existing_case
  from public.identity_resolution_cases resolution
  where resolution.client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object('caseId', existing_case.id, 'caseState', existing_case.case_state, 'replayed', true);
  end if;

  evidence_digest := encode(
    public.digest(convert_to(p_evidence_json::text, 'utf8'), 'sha256'),
    'hex'
  );
  insert into public.identity_resolution_cases (
    organization_id,
    historical_import_record_id,
    subject_type,
    source_entity_id,
    candidate_entity_ids,
    evidence_json,
    evidence_digest_sha256,
    submitted_by_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    p_historical_import_record_id,
    p_subject_type,
    p_source_entity_id,
    coalesce(p_candidate_entity_ids, '{}'),
    p_evidence_json,
    evidence_digest,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_case;

  insert into public.identity_resolution_events (
    identity_resolution_case_id,
    sequence_number,
    event_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    created_case.id,
    1,
    'submitted',
    trim(p_note),
    jsonb_build_object('candidateEntityIds', created_case.candidate_entity_ids),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'caseId', created_case.id,
    'caseState', created_case.case_state,
    'evidenceDigestSha256', evidence_digest,
    'replayed', false
  );
end
$identity_submit$;
create or replace function public.service_decide_identity_resolution_case(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_case_id uuid,
  p_decision text,
  p_canonical_entity_id uuid,
  p_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $identity_decide$
declare
  case_row public.identity_resolution_cases%rowtype;
  next_sequence integer;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'identity.resolve', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'identity_resolution_decision_permission_required';
  end if;
  if p_decision not in ('needs_information', 'matched', 'merged', 'rejected')
     or nullif(trim(p_note), '') is null
     or (p_decision in ('matched', 'merged') and p_canonical_entity_id is null) then
    raise exception using errcode = '22023', message = 'identity_resolution_decision_invalid';
  end if;
  if exists (
    select 1 from public.identity_resolution_events event
    where event.client_event_id = p_client_event_id
  ) then
    select resolution.*
    into case_row
    from public.identity_resolution_cases resolution
    where resolution.id = p_case_id;
    return jsonb_build_object('caseId', case_row.id, 'caseState', case_row.case_state, 'replayed', true);
  end if;

  select resolution.*
  into case_row
  from public.identity_resolution_cases resolution
  where resolution.id = p_case_id
    and resolution.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'identity_resolution_case_not_found';
  end if;
  if case_row.case_state not in ('pending', 'needs_information') then
    raise exception using errcode = '55000', message = 'identity_resolution_case_closed';
  end if;
  if p_decision = 'merged' and case_row.source_entity_id is null then
    raise exception using errcode = '22023', message = 'identity_merge_source_required';
  end if;

  if p_decision in ('matched', 'merged') then
    if case_row.subject_type = 'athlete'
       and not exists (select 1 from public.athlete_profiles athlete where athlete.id = p_canonical_entity_id) then
      raise exception using errcode = 'P0002', message = 'canonical_athlete_not_found';
    elsif case_row.subject_type = 'club'
       and not exists (select 1 from public.clubs club where club.id = p_canonical_entity_id) then
      raise exception using errcode = 'P0002', message = 'canonical_club_not_found';
    end if;
  end if;

  update public.identity_resolution_cases resolution
  set
    case_state = p_decision,
    canonical_entity_id = p_canonical_entity_id,
    decision_note = trim(p_note),
    decided_by_user_id = p_actor_user_id,
    decided_at = clock_timestamp()
  where resolution.id = p_case_id
  returning * into case_row;

  if p_decision = 'merged' and case_row.subject_type = 'athlete' then
    update public.athlete_profiles athlete
    set
      status = 'merged',
      merged_into_athlete_profile_id = p_canonical_entity_id,
      updated_at = clock_timestamp()
    where athlete.id = case_row.source_entity_id
      and athlete.id <> p_canonical_entity_id;
  elsif p_decision = 'merged' and case_row.subject_type = 'club' then
    update public.clubs club
    set verification_status = 'merged', status = 'merged', updated_at = clock_timestamp()
    where club.id = case_row.source_entity_id
      and club.id <> p_canonical_entity_id;
    insert into public.club_identity_merges (
      source_club_id,
      canonical_club_id,
      merge_state,
      reason,
      evidence_json,
      proposed_by_user_id,
      decided_by_user_id,
      decided_at,
      client_event_id
    )
    values (
      case_row.source_entity_id,
      p_canonical_entity_id,
      'approved',
      trim(p_note),
      case_row.evidence_json,
      case_row.submitted_by_user_id,
      p_actor_user_id,
      clock_timestamp(),
      p_client_event_id
    );
  end if;

  if case_row.historical_import_record_id is not null
     and p_decision in ('matched', 'merged', 'rejected') then
    update public.historical_import_records record
    set
      resolution_state = case when p_decision = 'merged' then 'merged' else p_decision end,
      resolved_entity_type = case_row.subject_type,
      resolved_entity_id = p_canonical_entity_id,
      resolution_note = trim(p_note)
    where record.id = case_row.historical_import_record_id;

    update public.historical_import_batches batch
    set
      matched_count = (
        select count(*)::integer
        from public.historical_import_records imported
        where imported.historical_import_batch_id = batch.id
          and imported.resolution_state in ('matched', 'merged')
      ),
      unresolved_count = greatest(
        batch.record_count - (
          select count(*)::integer
          from public.historical_import_records imported
          where imported.historical_import_batch_id = batch.id
            and imported.resolution_state in ('matched', 'merged', 'rejected')
        ),
        0
      ),
      batch_state = case
        when (
          select count(*)::integer
          from public.historical_import_records imported
          where imported.historical_import_batch_id = batch.id
            and imported.resolution_state in ('matched', 'merged', 'rejected')
        ) >= batch.record_count then 'completed'
        else 'review'
      end
    where batch.id = (
      select imported.historical_import_batch_id
      from public.historical_import_records imported
      where imported.id = case_row.historical_import_record_id
    );
  end if;

  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.identity_resolution_events event
  where event.identity_resolution_case_id = p_case_id;

  insert into public.identity_resolution_events (
    identity_resolution_case_id,
    sequence_number,
    event_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    p_case_id,
    next_sequence,
    case when p_decision = 'needs_information' then 'information_requested' else p_decision end,
    trim(p_note),
    jsonb_build_object('canonicalEntityId', p_canonical_entity_id),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'caseId', case_row.id,
    'caseState', case_row.case_state,
    'canonicalEntityId', case_row.canonical_entity_id,
    'replayed', false
  );
end
$identity_decide$;
create or replace function public.service_create_partner_api_client(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_client_key text,
  p_display_name text,
  p_scopes text[],
  p_rate_limit_per_minute integer,
  p_expires_at timestamptz,
  p_allowed_ip_cidrs text[],
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $partner_client$
declare
  existing_client public.partner_api_clients%rowtype;
  created_client public.partner_api_clients%rowtype;
  raw_credential text;
  credential_prefix text;
  credential_digest text;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'partners.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'partner_manage_permission_required';
  end if;
  if p_client_key !~ '^[a-z][a-z0-9_-]{2,79}$'
     or nullif(trim(p_display_name), '') is null
     or coalesce(cardinality(p_scopes), 0) = 0
     or coalesce(p_rate_limit_per_minute, 0) not between 1 and 10000
     or (p_expires_at is not null and p_expires_at <= clock_timestamp()) then
    raise exception using errcode = '22023', message = 'partner_api_client_invalid';
  end if;
  begin
    perform allowed.cidr_text::cidr
    from unnest(coalesce(p_allowed_ip_cidrs, '{}')) allowed(cidr_text);
  exception
    when invalid_text_representation then
      raise exception using errcode = '22023', message = 'partner_api_client_cidr_invalid';
  end;

  select client.*
  into existing_client
  from public.partner_api_clients client
  where client.client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'clientId', existing_client.id,
      'clientKey', existing_client.client_key,
      'credentialPrefix', existing_client.credential_prefix,
      'credential', null,
      'replayed', true
    );
  end if;

  raw_credential := 'stp_live_' || encode(public.gen_random_bytes(32), 'hex');
  credential_prefix := 'stp_' || substring(encode(public.digest(raw_credential, 'sha256'), 'hex') from 1 for 8);
  credential_digest := encode(public.digest(raw_credential, 'sha256'), 'hex');

  insert into public.partner_api_clients (
    organization_id,
    client_key,
    display_name,
    scopes,
    credential_prefix,
    credential_digest_sha256,
    rate_limit_per_minute,
    allowed_ip_cidrs,
    expires_at,
    created_by_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    p_client_key,
    trim(p_display_name),
    p_scopes,
    credential_prefix,
    credential_digest,
    p_rate_limit_per_minute,
    coalesce(p_allowed_ip_cidrs, '{}'),
    p_expires_at,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_client;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'partner_api_client',
    created_client.id,
    'partner.client_created',
    jsonb_build_object(
      'clientKey', created_client.client_key,
      'credentialPrefix', created_client.credential_prefix,
      'scopes', created_client.scopes
    )
  );

  return jsonb_build_object(
    'clientId', created_client.id,
    'clientKey', created_client.client_key,
    'credentialPrefix', created_client.credential_prefix,
    'credential', raw_credential,
    'scopes', to_jsonb(created_client.scopes),
    'replayed', false
  );
end
$partner_client$;
create or replace function public.service_authenticate_partner_api_key(
  p_raw_credential text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $partner_auth$
declare
  credential_digest text;
  client_row public.partner_api_clients%rowtype;
begin
  if p_raw_credential !~ '^stp_live_[0-9a-f]{64}$' then
    return null;
  end if;
  credential_digest := encode(public.digest(p_raw_credential, 'sha256'), 'hex');
  select client.*
  into client_row
  from public.partner_api_clients client
  where client.credential_digest_sha256 = credential_digest
    and client.client_state = 'active'
    and (client.expires_at is null or client.expires_at > clock_timestamp());
  if not found then
    return null;
  end if;

  update public.partner_api_clients client
  set last_used_at = clock_timestamp()
  where client.id = client_row.id;

  return jsonb_build_object(
    'clientId', client_row.id,
    'organizationId', client_row.organization_id,
    'clientKey', client_row.client_key,
    'scopes', to_jsonb(client_row.scopes),
    'rateLimitPerMinute', client_row.rate_limit_per_minute,
    'allowedIpCidrs', to_jsonb(client_row.allowed_ip_cidrs)
  );
end
$partner_auth$;
create or replace function public.service_revoke_partner_api_client(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_partner_api_client_id uuid,
  p_reason text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $partner_revoke$
declare
  client_row public.partner_api_clients%rowtype;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'partners.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'partner_manage_permission_required';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'partner_revocation_reason_required';
  end if;

  select client.*
  into client_row
  from public.partner_api_clients client
  where client.id = p_partner_api_client_id
    and client.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'partner_api_client_not_found';
  end if;
  if client_row.client_state = 'revoked' then
    return jsonb_build_object('clientId', client_row.id, 'clientState', client_row.client_state, 'replayed', true);
  end if;

  update public.partner_api_clients client
  set
    client_state = 'revoked',
    revoked_by_user_id = p_actor_user_id,
    revoked_at = clock_timestamp(),
    revocation_reason = trim(p_reason)
  where client.id = p_partner_api_client_id
  returning * into client_row;

  update public.partner_webhook_subscriptions subscription
  set subscription_state = 'disabled', disabled_at = clock_timestamp()
  where subscription.partner_api_client_id = client_row.id
    and subscription.subscription_state <> 'disabled';

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'partner_api_client',
    client_row.id,
    'partner.client_revoked',
    jsonb_build_object('reason', trim(p_reason), 'clientEventId', p_client_event_id)
  );

  return jsonb_build_object(
    'clientId', client_row.id,
    'clientState', client_row.client_state,
    'replayed', false
  );
end
$partner_revoke$;
create or replace function public.service_create_partner_webhook_subscription(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_partner_api_client_id uuid,
  p_endpoint_url text,
  p_event_types text[],
  p_max_attempts integer,
  p_timeout_ms integer,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $webhook$
declare
  existing_subscription public.partner_webhook_subscriptions%rowtype;
  created_subscription public.partner_webhook_subscriptions%rowtype;
  raw_secret text;
  secret_prefix text;
  secret_digest text;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'partners.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'partner_manage_permission_required';
  end if;
  if p_endpoint_url !~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(/.*)?$'
     or coalesce(cardinality(p_event_types), 0) = 0
     or coalesce(p_max_attempts, 0) not between 1 and 20
     or coalesce(p_timeout_ms, 0) not between 1000 and 60000 then
    raise exception using errcode = '22023', message = 'partner_webhook_subscription_invalid';
  end if;

  select subscription.*
  into existing_subscription
  from public.partner_webhook_subscriptions subscription
  where subscription.client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'subscriptionId', existing_subscription.id,
      'signingSecretPrefix', existing_subscription.signing_secret_prefix,
      'signingSecret', null,
      'replayed', true
    );
  end if;

  perform 1
  from public.partner_api_clients client
  where client.id = p_partner_api_client_id
    and client.organization_id = p_organization_id
    and client.client_state = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'active_partner_api_client_not_found';
  end if;

  raw_secret := 'whsec_' || encode(public.gen_random_bytes(32), 'hex');
  secret_prefix := 'whsec_' || substring(encode(public.digest(raw_secret, 'sha256'), 'hex') from 1 for 8);
  secret_digest := encode(public.digest(raw_secret, 'sha256'), 'hex');

  insert into public.partner_webhook_subscriptions (
    organization_id,
    partner_api_client_id,
    endpoint_url,
    event_types,
    signing_secret_prefix,
    signing_secret_digest_sha256,
    max_attempts,
    timeout_ms,
    created_by_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    p_partner_api_client_id,
    trim(p_endpoint_url),
    p_event_types,
    secret_prefix,
    secret_digest,
    p_max_attempts,
    p_timeout_ms,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_subscription;

  return jsonb_build_object(
    'subscriptionId', created_subscription.id,
    'endpointUrl', created_subscription.endpoint_url,
    'eventTypes', to_jsonb(created_subscription.event_types),
    'signingSecretPrefix', created_subscription.signing_secret_prefix,
    'signingSecret', raw_secret,
    'replayed', false
  );
end
$webhook$;
create or replace function public.service_create_organization_network(
  p_owner_organization_id uuid,
  p_actor_user_id uuid,
  p_slug text,
  p_name text,
  p_network_type text,
  p_country_codes char(2)[],
  p_default_locale text,
  p_default_timezone text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $network$
declare
  created_network public.organization_networks%rowtype;
begin
  if not public.service_user_has_organization_permission(
    p_owner_organization_id, p_actor_user_id, 'network.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'network_manage_permission_required';
  end if;
  if p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or nullif(trim(p_name), '') is null
     or p_network_type not in ('regional', 'league', 'federation', 'operator_group')
     or p_default_locale !~ '^[a-z]{2,3}(?:-[A-Z][A-Za-z0-9]{1,7})?$'
     or nullif(trim(p_default_timezone), '') is null then
    raise exception using errcode = '22023', message = 'organization_network_invalid';
  end if;

  select network.*
  into created_network
  from public.organization_networks network
  where network.client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object('networkId', created_network.id, 'slug', created_network.slug, 'replayed', true);
  end if;

  insert into public.organization_networks (
    owner_organization_id,
    slug,
    name,
    network_type,
    country_codes,
    default_locale,
    default_timezone,
    created_by_user_id,
    client_event_id
  )
  values (
    p_owner_organization_id,
    p_slug,
    trim(p_name),
    p_network_type,
    coalesce(p_country_codes, '{}'),
    p_default_locale,
    trim(p_default_timezone),
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_network;

  insert into public.organization_network_memberships (
    organization_network_id,
    organization_id,
    membership_role,
    membership_state,
    data_sharing_scopes,
    invited_by_user_id,
    accepted_by_user_id,
    accepted_at,
    accepted_client_event_id,
    client_event_id
  )
  values (
    created_network.id,
    p_owner_organization_id,
    'owner',
    'active',
    array['events', 'official_results', 'league_standings'],
    p_actor_user_id,
    p_actor_user_id,
    clock_timestamp(),
    p_client_event_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'networkId', created_network.id,
    'slug', created_network.slug,
    'name', created_network.name,
    'networkType', created_network.network_type,
    'replayed', false
  );
end
$network$;
create or replace function public.service_invite_network_organization(
  p_owner_organization_id uuid,
  p_actor_user_id uuid,
  p_network_id uuid,
  p_invited_organization_id uuid,
  p_membership_role text,
  p_data_sharing_scopes text[],
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $network_invite$
declare
  membership_row public.organization_network_memberships%rowtype;
begin
  if not public.service_user_has_organization_permission(
    p_owner_organization_id, p_actor_user_id, 'network.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'network_manage_permission_required';
  end if;
  if p_membership_role not in ('administrator', 'member', 'results_provider', 'observer')
     or p_invited_organization_id = p_owner_organization_id then
    raise exception using errcode = '22023', message = 'network_invitation_invalid';
  end if;

  perform 1
  from public.organization_networks network
  where network.id = p_network_id
    and network.owner_organization_id = p_owner_organization_id
    and network.network_state = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'organization_network_not_found';
  end if;
  if not exists (
    select 1 from public.organizations organization
    where organization.id = p_invited_organization_id
      and organization.status = 'active'
  ) then
    raise exception using errcode = 'P0002', message = 'invited_organization_not_found';
  end if;

  insert into public.organization_network_memberships (
    organization_network_id,
    organization_id,
    membership_role,
    membership_state,
    data_sharing_scopes,
    invited_by_user_id,
    client_event_id
  )
  values (
    p_network_id,
    p_invited_organization_id,
    p_membership_role,
    'invited',
    coalesce(p_data_sharing_scopes, '{}'),
    p_actor_user_id,
    p_client_event_id
  )
  returning * into membership_row;

  return jsonb_build_object(
    'membershipId', membership_row.id,
    'networkId', p_network_id,
    'organizationId', p_invited_organization_id,
    'membershipState', membership_row.membership_state,
    'replayed', false
  );
exception
  when unique_violation then
    select membership.*
    into membership_row
    from public.organization_network_memberships membership
    where membership.client_event_id = p_client_event_id;
    if found then
      return jsonb_build_object(
        'membershipId', membership_row.id,
        'networkId', membership_row.organization_network_id,
        'organizationId', membership_row.organization_id,
        'membershipState', membership_row.membership_state,
        'replayed', true
      );
    end if;
    raise;
end
$network_invite$;
create or replace function public.service_accept_network_invitation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $network_accept$
declare
  membership_row public.organization_network_memberships%rowtype;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'network.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'network_manage_permission_required';
  end if;

  select membership.*
  into membership_row
  from public.organization_network_memberships membership
  where membership.id = p_membership_id
    and membership.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'network_invitation_not_found';
  end if;
  if membership_row.membership_state = 'active' then
    if membership_row.accepted_client_event_id is distinct from p_client_event_id then
      raise exception using errcode = '55000', message = 'network_invitation_already_accepted';
    end if;
    return jsonb_build_object(
      'membershipId', membership_row.id,
      'membershipState', membership_row.membership_state,
      'replayed', true
    );
  end if;
  if membership_row.membership_state <> 'invited' then
    raise exception using errcode = '55000', message = 'network_invitation_not_open';
  end if;

  update public.organization_network_memberships membership
  set
    membership_state = 'active',
    accepted_by_user_id = p_actor_user_id,
    accepted_at = clock_timestamp(),
    accepted_client_event_id = p_client_event_id
  where membership.id = p_membership_id
  returning * into membership_row;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'organization_network_membership',
    membership_row.id,
    'network.invitation_accepted',
    jsonb_build_object('networkId', membership_row.organization_network_id)
  );

  return jsonb_build_object(
    'membershipId', membership_row.id,
    'membershipState', membership_row.membership_state,
    'networkId', membership_row.organization_network_id,
    'replayed', false
  );
end
$network_accept$;
create or replace function public.service_save_localization_profile(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_primary_locale text,
  p_enabled_locales text[],
  p_timezone text,
  p_measurement_system text,
  p_week_start_day smallint,
  p_name_order text,
  p_default_currency char(3),
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $localization$
declare
  profile_row public.organization_localization_profiles%rowtype;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'localization.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'localization_manage_permission_required';
  end if;
  if p_primary_locale !~ '^[a-z]{2,3}(?:-[A-Z][A-Za-z0-9]{1,7})?$'
     or not p_primary_locale = any(p_enabled_locales)
     or coalesce(cardinality(p_enabled_locales), 0) not between 1 and 12
     or nullif(trim(p_timezone), '') is null
     or p_measurement_system not in ('metric', 'imperial')
     or p_week_start_day not between 0 and 6
     or p_name_order not in ('given_family', 'family_given')
     or p_default_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'localization_profile_invalid';
  end if;

  select profile.*
  into profile_row
  from public.organization_localization_profiles profile
  where profile.last_client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'organizationId', profile_row.organization_id,
      'versionNumber', profile_row.version_number,
      'primaryLocale', profile_row.primary_locale,
      'enabledLocales', to_jsonb(profile_row.enabled_locales),
      'replayed', true
    );
  end if;

  insert into public.organization_localization_profiles (
    organization_id,
    primary_locale,
    enabled_locales,
    timezone,
    measurement_system,
    week_start_day,
    name_order,
    default_currency,
    last_client_event_id,
    updated_by_user_id
  )
  values (
    p_organization_id,
    p_primary_locale,
    p_enabled_locales,
    trim(p_timezone),
    p_measurement_system,
    p_week_start_day,
    p_name_order,
    upper(p_default_currency),
    p_client_event_id,
    p_actor_user_id
  )
  on conflict (organization_id)
  do update set
    primary_locale = excluded.primary_locale,
    enabled_locales = excluded.enabled_locales,
    timezone = excluded.timezone,
    measurement_system = excluded.measurement_system,
    week_start_day = excluded.week_start_day,
    name_order = excluded.name_order,
    default_currency = excluded.default_currency,
    last_client_event_id = excluded.last_client_event_id,
    version_number = public.organization_localization_profiles.version_number + 1,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = clock_timestamp()
  returning * into profile_row;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'organization_localization_profile',
    p_organization_id,
    'localization.profile_saved',
    jsonb_build_object(
      'versionNumber', profile_row.version_number,
      'primaryLocale', profile_row.primary_locale,
      'enabledLocales', profile_row.enabled_locales,
      'clientEventId', p_client_event_id
    )
  );

  return jsonb_build_object(
    'organizationId', profile_row.organization_id,
    'versionNumber', profile_row.version_number,
    'primaryLocale', profile_row.primary_locale,
    'enabledLocales', to_jsonb(profile_row.enabled_locales),
    'replayed', false
  );
end
$localization$;
create or replace function public.service_save_localized_content_version(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_locale text,
  p_fields_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $localized_content$
declare
  existing_version public.localized_content_versions%rowtype;
  created_version public.localized_content_versions%rowtype;
  next_version integer;
  content_digest text;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'localization.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'localization_manage_permission_required';
  end if;
  if p_entity_type not in ('organization', 'event_series', 'event_edition', 'event_category', 'club', 'league', 'league_season')
     or p_locale !~ '^[a-z]{2,3}(?:-[A-Z][A-Za-z0-9]{1,7})?$'
     or jsonb_typeof(coalesce(p_fields_json, 'null'::jsonb)) <> 'object'
     or p_fields_json = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'localized_content_invalid';
  end if;
  if not exists (
    select 1
    from public.organization_localization_profiles profile
    where profile.organization_id = p_organization_id
      and p_locale = any(profile.enabled_locales)
  ) then
    raise exception using errcode = '22023', message = 'localized_content_locale_not_enabled';
  end if;

  select content.*
  into existing_version
  from public.localized_content_versions content
  where content.client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'localizedContentVersionId', existing_version.id,
      'versionNumber', existing_version.version_number,
      'contentDigestSha256', existing_version.content_digest_sha256,
      'replayed', true
    );
  end if;

  content_digest := encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'entityType', p_entity_type,
          'entityId', p_entity_id,
          'locale', p_locale,
          'fields', p_fields_json
        )::text,
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );
  if exists (
    select 1
    from public.localized_content_versions content
    where content.organization_id = p_organization_id
      and content.entity_type = p_entity_type
      and content.entity_id = p_entity_id
      and content.locale = p_locale
      and content.content_digest_sha256 = content_digest
  ) then
    raise exception using errcode = '23505', message = 'localized_content_unchanged';
  end if;

  select coalesce(max(content.version_number), 0) + 1
  into next_version
  from public.localized_content_versions content
  where content.organization_id = p_organization_id
    and content.entity_type = p_entity_type
    and content.entity_id = p_entity_id
    and content.locale = p_locale;

  insert into public.localized_content_versions (
    organization_id,
    entity_type,
    entity_id,
    locale,
    version_number,
    fields_json,
    content_digest_sha256,
    created_by_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    p_entity_type,
    p_entity_id,
    p_locale,
    next_version,
    p_fields_json,
    content_digest,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_version;

  return jsonb_build_object(
    'localizedContentVersionId', created_version.id,
    'versionNumber', created_version.version_number,
    'contentDigestSha256', created_version.content_digest_sha256,
    'replayed', false
  );
end
$localized_content$;
create or replace function public.service_get_regional_scale_workspace(
  p_organization_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $regional_workspace$
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'events.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'organizer_access_required';
  end if;

  return jsonb_build_object(
    'organizationId', p_organization_id,
    'localization', (
      select jsonb_build_object(
        'primaryLocale', profile.primary_locale,
        'enabledLocales', profile.enabled_locales,
        'timezone', profile.timezone,
        'measurementSystem', profile.measurement_system,
        'weekStartDay', profile.week_start_day,
        'nameOrder', profile.name_order,
        'defaultCurrency', trim(profile.default_currency),
        'versionNumber', profile.version_number
      )
      from public.organization_localization_profiles profile
      where profile.organization_id = p_organization_id
    ),
    'historicalImports', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', batch.id,
          'sourceSystem', batch.source_system,
          'sourceReference', batch.source_reference,
          'state', batch.batch_state,
          'recordCount', batch.record_count,
          'matchedCount', batch.matched_count,
          'unresolvedCount', batch.unresolved_count,
          'sourceDigestSha256', batch.source_digest_sha256,
          'createdAt', batch.created_at
        )
        order by batch.created_at desc
      )
      from public.historical_import_batches batch
      where batch.organization_id = p_organization_id
    ), '[]'::jsonb),
    'identityQueue', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', resolution.id,
          'subjectType', resolution.subject_type,
          'state', resolution.case_state,
          'candidateEntityIds', resolution.candidate_entity_ids,
          'canonicalEntityId', resolution.canonical_entity_id,
          'evidenceDigestSha256', resolution.evidence_digest_sha256,
          'submittedAt', resolution.submitted_at
        )
        order by resolution.submitted_at desc
      )
      from public.identity_resolution_cases resolution
      where resolution.organization_id = p_organization_id
    ), '[]'::jsonb),
    'partnerClients', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', client.id,
          'clientKey', client.client_key,
          'displayName', client.display_name,
          'state', client.client_state,
          'scopes', client.scopes,
          'credentialPrefix', client.credential_prefix,
          'rateLimitPerMinute', client.rate_limit_per_minute,
          'expiresAt', client.expires_at,
          'lastUsedAt', client.last_used_at,
          'webhookCount', (
            select count(*)
            from public.partner_webhook_subscriptions subscription
            where subscription.partner_api_client_id = client.id
              and subscription.subscription_state = 'active'
          )
        )
        order by client.display_name
      )
      from public.partner_api_clients client
      where client.organization_id = p_organization_id
    ), '[]'::jsonb),
    'networks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', network.id,
          'membershipId', membership.id,
          'slug', network.slug,
          'name', network.name,
          'networkType', network.network_type,
          'state', network.network_state,
          'membershipRole', membership.membership_role,
          'membershipState', membership.membership_state,
          'memberCount', (
            select count(*)
            from public.organization_network_memberships network_member
            where network_member.organization_network_id = network.id
              and network_member.membership_state = 'active'
          )
        )
        order by network.name
      )
      from public.organization_network_memberships membership
      join public.organization_networks network
        on network.id = membership.organization_network_id
      where membership.organization_id = p_organization_id
    ), '[]'::jsonb),
    'localizedContent', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'entityType', latest.entity_type,
          'entityId', latest.entity_id,
          'locale', latest.locale,
          'versionNumber', latest.version_number,
          'fields', latest.fields_json,
          'contentDigestSha256', latest.content_digest_sha256,
          'createdAt', latest.created_at
        )
        order by latest.entity_type, latest.locale
      )
      from (
        select distinct on (content.entity_type, content.entity_id, content.locale)
          content.*
        from public.localized_content_versions content
        where content.organization_id = p_organization_id
        order by content.entity_type, content.entity_id, content.locale, content.version_number desc
      ) latest
    ), '[]'::jsonb)
  );
end
$regional_workspace$;
alter table public.historical_import_batches enable row level security;
alter table public.historical_import_records enable row level security;
alter table public.identity_resolution_cases enable row level security;
alter table public.identity_resolution_events enable row level security;
alter table public.partner_api_clients enable row level security;
alter table public.partner_webhook_subscriptions enable row level security;
alter table public.partner_outbox_events enable row level security;
alter table public.partner_webhook_deliveries enable row level security;
alter table public.organization_networks enable row level security;
alter table public.organization_network_memberships enable row level security;
alter table public.organization_localization_profiles enable row level security;
alter table public.localized_content_versions enable row level security;
revoke all on table
  public.historical_import_batches,
  public.historical_import_records,
  public.identity_resolution_cases,
  public.identity_resolution_events,
  public.partner_api_clients,
  public.partner_webhook_subscriptions,
  public.partner_outbox_events,
  public.partner_webhook_deliveries,
  public.organization_networks,
  public.organization_network_memberships,
  public.organization_localization_profiles,
  public.localized_content_versions
from public, anon, authenticated;
revoke all on function public.service_register_historical_import_batch(uuid,uuid,text,text,text,text,integer,jsonb,uuid)
  from public, anon, authenticated;
revoke all on function public.service_append_historical_import_record(uuid,uuid,uuid,text,text,jsonb,text,uuid,numeric,text)
  from public, anon, authenticated;
revoke all on function public.service_submit_identity_resolution_case(uuid,uuid,uuid,text,uuid,uuid[],jsonb,text,uuid)
  from public, anon, authenticated;
revoke all on function public.service_decide_identity_resolution_case(uuid,uuid,uuid,text,uuid,text,uuid)
  from public, anon, authenticated;
revoke all on function public.service_create_partner_api_client(uuid,uuid,text,text,text[],integer,timestamptz,text[],uuid)
  from public, anon, authenticated;
revoke all on function public.service_authenticate_partner_api_key(text)
  from public, anon, authenticated;
revoke all on function public.service_revoke_partner_api_client(uuid,uuid,uuid,text,uuid)
  from public, anon, authenticated;
revoke all on function public.service_create_partner_webhook_subscription(uuid,uuid,uuid,text,text[],integer,integer,uuid)
  from public, anon, authenticated;
revoke all on function public.service_create_organization_network(uuid,uuid,text,text,text,char(2)[],text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.service_invite_network_organization(uuid,uuid,uuid,uuid,text,text[],uuid)
  from public, anon, authenticated;
revoke all on function public.service_accept_network_invitation(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.service_save_localization_profile(uuid,uuid,text,text[],text,text,smallint,text,char(3),uuid)
  from public, anon, authenticated;
revoke all on function public.service_save_localized_content_version(uuid,uuid,text,uuid,text,jsonb,uuid)
  from public, anon, authenticated;
revoke all on function public.service_get_regional_scale_workspace(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.service_register_historical_import_batch(uuid,uuid,text,text,text,text,integer,jsonb,uuid)
  to service_role;
grant execute on function public.service_append_historical_import_record(uuid,uuid,uuid,text,text,jsonb,text,uuid,numeric,text)
  to service_role;
grant execute on function public.service_submit_identity_resolution_case(uuid,uuid,uuid,text,uuid,uuid[],jsonb,text,uuid)
  to service_role;
grant execute on function public.service_decide_identity_resolution_case(uuid,uuid,uuid,text,uuid,text,uuid)
  to service_role;
grant execute on function public.service_create_partner_api_client(uuid,uuid,text,text,text[],integer,timestamptz,text[],uuid)
  to service_role;
grant execute on function public.service_authenticate_partner_api_key(text)
  to service_role;
grant execute on function public.service_revoke_partner_api_client(uuid,uuid,uuid,text,uuid)
  to service_role;
grant execute on function public.service_create_partner_webhook_subscription(uuid,uuid,uuid,text,text[],integer,integer,uuid)
  to service_role;
grant execute on function public.service_create_organization_network(uuid,uuid,text,text,text,char(2)[],text,text,uuid)
  to service_role;
grant execute on function public.service_invite_network_organization(uuid,uuid,uuid,uuid,text,text[],uuid)
  to service_role;
grant execute on function public.service_accept_network_invitation(uuid,uuid,uuid,uuid)
  to service_role;
grant execute on function public.service_save_localization_profile(uuid,uuid,text,text[],text,text,smallint,text,char(3),uuid)
  to service_role;
grant execute on function public.service_save_localized_content_version(uuid,uuid,text,uuid,text,jsonb,uuid)
  to service_role;
grant execute on function public.service_get_regional_scale_workspace(uuid,uuid)
  to service_role;
