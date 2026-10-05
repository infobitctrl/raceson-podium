/*
 * Premium results governance and verifiable credentials.
 *
 * This migration adds:
 * - configurable protest / appeal windows and publication approval policy;
 * - append-only adjudication cases and evidence timelines;
 * - proposal-bound publication approvals from distinct decision makers;
 * - immutable, digest-addressed publication manifests with detached signatures;
 * - versioned certificate templates and verifiable issuance / revocation lineage.
 *
 * Result decisions never edit ranking rows. A material decision marks the case as
 * requiring recomputation, and the publication guard rejects result runs created
 * before that decision.
 */

create table public.result_governance_settings (
  event_category_id uuid primary key
    references public.event_categories (id) on delete cascade,
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  protest_window_minutes integer not null default 120,
  appeal_window_minutes integer not null default 1440,
  decision_sla_minutes integer not null default 1440,
  required_official_approvals smallint not null default 2,
  required_corrected_approvals smallint not null default 2,
  require_signed_credentials boolean not null default true,
  updated_by_user_id uuid,
  version_number integer not null default 1,
  updated_at timestamptz not null default clock_timestamp(),
  check (protest_window_minutes between 0 and 10080),
  check (appeal_window_minutes between 0 and 43200),
  check (decision_sla_minutes between 15 and 43200),
  check (required_official_approvals between 0 and 5),
  check (required_corrected_approvals between 0 and 5)
);
create table public.result_adjudication_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  event_category_id uuid not null
    references public.event_categories (id) on delete cascade,
  registration_id uuid
    references public.registrations (id) on delete restrict,
  result_run_id uuid
    references public.result_runs (id) on delete restrict,
  appeal_of_case_id uuid
    references public.result_adjudication_cases (id) on delete restrict,
  case_number text not null unique,
  case_type text not null,
  submitted_by_source text not null,
  rule_reference text not null,
  claim_summary text not null,
  public_summary text not null,
  restricted_evidence_json jsonb not null default '{}'::jsonb,
  case_state text not null default 'submitted',
  response_deadline timestamptz not null,
  decision_outcome text,
  decision_summary text,
  result_impact_json jsonb not null default '{}'::jsonb,
  recompute_required boolean not null default false,
  decided_by_user_id uuid,
  decided_at timestamptz,
  closed_at timestamptz,
  created_by_user_id uuid,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  check (
    case_type in (
      'penalty', 'protest', 'appeal', 'eligibility', 'tie',
      'manual_evidence', 'course_deviation', 'timing_review'
    )
  ),
  check (submitted_by_source in ('athlete', 'team', 'organizer', 'official', 'system')),
  check (
    case_state in (
      'submitted', 'accepted', 'in_review', 'decision_pending',
      'decided', 'appealed', 'closed', 'withdrawn'
    )
  ),
  check (
    decision_outcome is null
    or decision_outcome in (
      'upheld', 'dismissed', 'penalty', 'status_change',
      'recompute_required', 'no_action'
    )
  ),
  check (length(trim(rule_reference)) > 0),
  check (length(trim(claim_summary)) > 0),
  check (length(trim(public_summary)) > 0),
  check (jsonb_typeof(restricted_evidence_json) = 'object'),
  check (jsonb_typeof(result_impact_json) = 'object'),
  check (
    case_type = 'appeal'
    or appeal_of_case_id is null
  ),
  check (
    decision_outcome is null
    or (decided_by_user_id is not null and decided_at is not null)
  )
);
create index result_adjudication_cases_category_state_idx
  on public.result_adjudication_cases (event_category_id, case_state, created_at desc);
create index result_adjudication_cases_registration_idx
  on public.result_adjudication_cases (registration_id, created_at desc)
  where registration_id is not null;
create table public.result_adjudication_events (
  id uuid primary key default gen_random_uuid(),
  result_adjudication_case_id uuid not null
    references public.result_adjudication_cases (id) on delete restrict,
  sequence_number integer not null,
  action_type text not null,
  note text not null,
  public_note text,
  decision_outcome text,
  evidence_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (result_adjudication_case_id, sequence_number),
  check (
    action_type in (
      'submitted', 'accepted', 'review_started', 'evidence_added',
      'decision_pending', 'decision_recorded', 'appealed',
      'withdrawn', 'closed', 'note'
    )
  ),
  check (length(trim(note)) > 0),
  check (
    decision_outcome is null
    or decision_outcome in (
      'upheld', 'dismissed', 'penalty', 'status_change',
      'recompute_required', 'no_action'
    )
  ),
  check (jsonb_typeof(evidence_json) = 'object')
);
create index result_adjudication_events_case_sequence_idx
  on public.result_adjudication_events
  (result_adjudication_case_id, sequence_number desc);
create table public.result_publication_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  event_category_id uuid not null
    references public.event_categories (id) on delete cascade,
  result_run_id uuid not null
    references public.result_runs (id) on delete restrict,
  publication_state public.publication_state not null,
  proposal_digest_sha256 text not null,
  decision text not null,
  decision_note text not null,
  actor_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (proposal_digest_sha256, actor_user_id),
  check (publication_state in ('official', 'corrected')),
  check (proposal_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (decision in ('approved', 'rejected')),
  check (length(trim(decision_note)) > 0)
);
create index result_publication_approvals_proposal_idx
  on public.result_publication_approvals
  (event_category_id, result_run_id, proposal_digest_sha256, created_at desc);
alter table public.result_publications
  add column manifest_json jsonb,
  add column manifest_digest_sha256 text,
  add column signature_state text not null default 'legacy_unsigned',
  add column signature_algorithm text,
  add column signature_key_reference text,
  add column detached_signature text,
  add column signed_digest_sha256 text,
  add column signed_by_user_id uuid,
  add column signed_at timestamptz,
  add constraint result_publications_manifest_digest_check check (
    manifest_digest_sha256 is null
    or manifest_digest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  add constraint result_publications_signature_state_check check (
    signature_state in ('legacy_unsigned', 'not_required', 'pending', 'signed')
  ),
  add constraint result_publications_signed_digest_check check (
    signed_digest_sha256 is null
    or signed_digest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  add constraint result_publications_signature_complete_check check (
    signature_state <> 'signed'
    or (
      signature_algorithm is not null
      and signature_key_reference is not null
      and detached_signature is not null
      and signed_digest_sha256 = manifest_digest_sha256
      and signed_by_user_id is not null
      and signed_at is not null
    )
  );
create table public.result_publication_signature_events (
  id uuid primary key default gen_random_uuid(),
  result_publication_id uuid not null
    references public.result_publications (id) on delete restrict,
  manifest_digest_sha256 text not null,
  signature_algorithm text not null,
  signature_key_reference text not null,
  detached_signature text not null,
  actor_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (result_publication_id),
  check (manifest_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (
    signature_algorithm in (
      'hmac-sha256', 'ed25519', 'ecdsa-p256-sha256'
    )
  ),
  check (length(trim(signature_key_reference)) > 0),
  check (length(trim(detached_signature)) >= 32)
);
create table public.result_credential_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  name text not null,
  credential_type text not null,
  locale text not null default 'en',
  version_number integer not null,
  status text not null default 'active',
  title_template text not null,
  body_template text not null,
  design_tokens_json jsonb not null default '{}'::jsonb,
  eligibility_json jsonb not null default '{}'::jsonb,
  content_digest_sha256 text not null,
  created_by_user_id uuid,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  check (credential_type in ('finisher_certificate', 'award_certificate', 'badge', 'qualification')),
  check (locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
  check (version_number > 0),
  check (status in ('active', 'superseded', 'archived')),
  check (length(trim(name)) > 0),
  check (length(trim(title_template)) > 0),
  check (length(trim(body_template)) > 0),
  check (jsonb_typeof(design_tokens_json) = 'object'),
  check (jsonb_typeof(eligibility_json) = 'object'),
  check (content_digest_sha256 ~ '^[0-9a-f]{64}$'),
  unique (organization_id, name, credential_type, locale, version_number)
);
create unique index result_credential_templates_active_idx
  on public.result_credential_templates
  (organization_id, lower(name), credential_type, lower(locale))
  where status = 'active';
create table public.result_credential_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  result_publication_id uuid not null
    references public.result_publications (id) on delete restrict,
  result_credential_template_id uuid not null
    references public.result_credential_templates (id) on delete restrict,
  requested_by_user_id uuid not null,
  issued_count integer not null default 0,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check (issued_count >= 0),
  unique (result_publication_id, result_credential_template_id, client_event_id)
);
create table public.result_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  result_publication_id uuid not null
    references public.result_publications (id) on delete restrict,
  result_row_id uuid not null
    references public.result_rows (id) on delete restrict,
  result_credential_template_id uuid not null
    references public.result_credential_templates (id) on delete restrict,
  athlete_profile_id uuid not null
    references public.athlete_profiles (id) on delete restrict,
  credential_type text not null,
  credential_state text not null default 'active',
  verification_code text not null unique,
  manifest_json jsonb not null,
  credential_digest_sha256 text not null,
  issued_by_user_id uuid not null,
  issued_at timestamptz not null default clock_timestamp(),
  revoked_by_user_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  supersedes_credential_id uuid
    references public.result_credentials (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check (credential_type in ('finisher_certificate', 'award_certificate', 'badge', 'qualification')),
  check (credential_state in ('active', 'revoked', 'superseded')),
  check (verification_code ~ '^[A-Z0-9]{20}$'),
  check (jsonb_typeof(manifest_json) = 'object'),
  check (credential_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (
    credential_state = 'active'
    or (
      revoked_by_user_id is not null
      and revoked_at is not null
      and length(trim(revocation_reason)) > 0
    )
  )
);
create unique index result_credentials_one_active_idx
  on public.result_credentials
  (result_publication_id, result_row_id, result_credential_template_id)
  where credential_state = 'active';
create index result_credentials_athlete_issued_idx
  on public.result_credentials (athlete_profile_id, issued_at desc);
create table public.result_credential_events (
  id uuid primary key default gen_random_uuid(),
  result_credential_id uuid not null
    references public.result_credentials (id) on delete restrict,
  sequence_number integer not null,
  action_type text not null,
  note text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  client_event_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (result_credential_id, sequence_number),
  check (action_type in ('issued', 'revoked', 'superseded', 'verified')),
  check (length(trim(note)) > 0),
  check (jsonb_typeof(metadata_json) = 'object')
);
create or replace function public.prevent_result_governance_evidence_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'result_governance_evidence_is_append_only';
end;
$$;
create trigger result_adjudication_events_immutable
before update or delete on public.result_adjudication_events
for each row execute function public.prevent_result_governance_evidence_change();
create trigger result_publication_approvals_immutable
before update or delete on public.result_publication_approvals
for each row execute function public.prevent_result_governance_evidence_change();
create trigger result_publication_signature_events_immutable
before update or delete on public.result_publication_signature_events
for each row execute function public.prevent_result_governance_evidence_change();
create trigger result_credential_events_immutable
before update or delete on public.result_credential_events
for each row execute function public.prevent_result_governance_evidence_change();
create or replace function public.protect_result_publication_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_category_id is distinct from old.event_category_id
     or new.result_run_id is distinct from old.result_run_id
     or new.publication_state is distinct from old.publication_state
     or new.published_by_user_id is distinct from old.published_by_user_id
     or new.published_at is distinct from old.published_at
     or new.supersedes_publication_id is distinct from old.supersedes_publication_id
     or new.change_note is distinct from old.change_note
     or new.created_at is distinct from old.created_at
     or new.manifest_json is distinct from old.manifest_json
     or new.manifest_digest_sha256 is distinct from old.manifest_digest_sha256 then
    raise exception using errcode = '55000', message = 'result_publication_snapshot_is_immutable';
  end if;

  if old.signature_state = 'signed'
     and (
       new.signature_state is distinct from old.signature_state
       or new.signature_algorithm is distinct from old.signature_algorithm
       or new.signature_key_reference is distinct from old.signature_key_reference
       or new.detached_signature is distinct from old.detached_signature
       or new.signed_digest_sha256 is distinct from old.signed_digest_sha256
       or new.signed_by_user_id is distinct from old.signed_by_user_id
       or new.signed_at is distinct from old.signed_at
     ) then
    raise exception using errcode = '55000', message = 'result_publication_signature_is_immutable';
  end if;
  return new;
end;
$$;
create trigger result_publications_evidence_protected
before update on public.result_publications
for each row execute function public.protect_result_publication_evidence();
create or replace function public.protect_result_credential_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.result_publication_id is distinct from old.result_publication_id
     or new.result_row_id is distinct from old.result_row_id
     or new.result_credential_template_id is distinct from old.result_credential_template_id
     or new.athlete_profile_id is distinct from old.athlete_profile_id
     or new.credential_type is distinct from old.credential_type
     or new.verification_code is distinct from old.verification_code
     or new.manifest_json is distinct from old.manifest_json
     or new.credential_digest_sha256 is distinct from old.credential_digest_sha256
     or new.issued_by_user_id is distinct from old.issued_by_user_id
     or new.issued_at is distinct from old.issued_at
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'result_credential_evidence_is_immutable';
  end if;
  if old.credential_state <> 'active' then
    raise exception using errcode = '55000', message = 'result_credential_terminal_state_is_immutable';
  end if;
  return new;
end;
$$;
create trigger result_credentials_evidence_protected
before update on public.result_credentials
for each row execute function public.protect_result_credential_evidence();
create or replace function public.result_publication_proposal_digest(
  p_event_category_id uuid,
  p_result_run_id uuid,
  p_publication_state public.publication_state,
  p_change_note text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'eventCategoryId', p_event_category_id,
          'resultRunId', p_result_run_id,
          'publicationState', p_publication_state,
          'changeNote', nullif(trim(coalesce(p_change_note, '')), '')
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;
create or replace function public.service_save_result_governance_settings(
  p_event_category_id uuid,
  p_actor_user_id uuid,
  p_protest_window_minutes integer,
  p_appeal_window_minutes integer,
  p_decision_sla_minutes integer,
  p_required_official_approvals smallint,
  p_required_corrected_approvals smallint,
  p_require_signed_credentials boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_id uuid;
  settings_row public.result_governance_settings%rowtype;
begin
  select series.organization_id
  into organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = p_event_category_id;

  if organization_id is null
     or p_actor_user_id is null
     or p_protest_window_minutes not between 0 and 10080
     or p_appeal_window_minutes not between 0 and 43200
     or p_decision_sla_minutes not between 15 and 43200
     or p_required_official_approvals not between 0 and 5
     or p_required_corrected_approvals not between 0 and 5 then
    raise exception using errcode = '22023', message = 'result_governance_settings_input_invalid';
  end if;

  insert into public.result_governance_settings (
    event_category_id,
    organization_id,
    protest_window_minutes,
    appeal_window_minutes,
    decision_sla_minutes,
    required_official_approvals,
    required_corrected_approvals,
    require_signed_credentials,
    updated_by_user_id
  )
  values (
    p_event_category_id,
    organization_id,
    p_protest_window_minutes,
    p_appeal_window_minutes,
    p_decision_sla_minutes,
    p_required_official_approvals,
    p_required_corrected_approvals,
    coalesce(p_require_signed_credentials, true),
    p_actor_user_id
  )
  on conflict (event_category_id) do update
  set protest_window_minutes = excluded.protest_window_minutes,
      appeal_window_minutes = excluded.appeal_window_minutes,
      decision_sla_minutes = excluded.decision_sla_minutes,
      required_official_approvals = excluded.required_official_approvals,
      required_corrected_approvals = excluded.required_corrected_approvals,
      require_signed_credentials = excluded.require_signed_credentials,
      updated_by_user_id = excluded.updated_by_user_id,
      version_number = public.result_governance_settings.version_number + 1,
      updated_at = clock_timestamp()
  returning * into settings_row;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    organization_id,
    p_actor_user_id,
    'event_category',
    p_event_category_id,
    'results.governance_settings_saved',
    jsonb_build_object(
      'versionNumber', settings_row.version_number,
      'requiredOfficialApprovals', settings_row.required_official_approvals,
      'requiredCorrectedApprovals', settings_row.required_corrected_approvals
    )
  );

  return jsonb_build_object(
    'eventCategoryId', settings_row.event_category_id,
    'protestWindowMinutes', settings_row.protest_window_minutes,
    'appealWindowMinutes', settings_row.appeal_window_minutes,
    'decisionSlaMinutes', settings_row.decision_sla_minutes,
    'requiredOfficialApprovals', settings_row.required_official_approvals,
    'requiredCorrectedApprovals', settings_row.required_corrected_approvals,
    'requireSignedCredentials', settings_row.require_signed_credentials,
    'versionNumber', settings_row.version_number,
    'updatedAt', settings_row.updated_at
  );
end;
$$;
create or replace function public.service_create_result_adjudication_case(
  p_event_category_id uuid,
  p_registration_id uuid,
  p_result_run_id uuid,
  p_appeal_of_case_id uuid,
  p_actor_user_id uuid,
  p_case_type text,
  p_submitted_by_source text,
  p_rule_reference text,
  p_claim_summary text,
  p_public_summary text,
  p_restricted_evidence_json jsonb,
  p_response_deadline timestamptz,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_id uuid;
  case_row public.result_adjudication_cases%rowtype;
  replayed_case public.result_adjudication_cases%rowtype;
  settings_row public.result_governance_settings%rowtype;
  latest_publication_at timestamptz;
  parent_case public.result_adjudication_cases%rowtype;
  next_case_number integer;
  effective_deadline timestamptz;
begin
  select *
  into replayed_case
  from public.result_adjudication_cases
  where client_event_id = p_client_event_id;
  if found then
    if replayed_case.event_category_id is distinct from p_event_category_id
       or replayed_case.registration_id is distinct from p_registration_id
       or replayed_case.case_type is distinct from p_case_type then
      raise exception using errcode = 'P0001', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', replayed_case.id,
      'caseNumber', replayed_case.case_number,
      'caseState', replayed_case.case_state,
      'replayed', true
    );
  end if;

  select series.organization_id
  into organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = p_event_category_id
  for update of category;

  if organization_id is null
     or p_actor_user_id is null
     or p_case_type not in (
       'penalty', 'protest', 'appeal', 'eligibility', 'tie',
       'manual_evidence', 'course_deviation', 'timing_review'
     )
     or p_submitted_by_source not in ('athlete', 'team', 'organizer', 'official', 'system')
     or nullif(trim(p_rule_reference), '') is null
     or nullif(trim(p_claim_summary), '') is null
     or nullif(trim(p_public_summary), '') is null
     or jsonb_typeof(coalesce(p_restricted_evidence_json, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'result_adjudication_case_input_invalid';
  end if;

  if p_registration_id is not null and not exists (
    select 1
    from public.registrations registration
    where registration.id = p_registration_id
      and registration.event_category_id = p_event_category_id
  ) then
    raise exception using errcode = '22023', message = 'result_adjudication_scope_invalid';
  end if;

  if p_result_run_id is not null and not exists (
    select 1
    from public.result_runs result_run
    where result_run.id = p_result_run_id
      and result_run.event_category_id = p_event_category_id
  ) then
    raise exception using errcode = '22023', message = 'result_adjudication_scope_invalid';
  end if;

  select *
  into settings_row
  from public.result_governance_settings
  where event_category_id = p_event_category_id;

  select publication.published_at
  into latest_publication_at
  from public.result_publications publication
  where publication.event_category_id = p_event_category_id
    and publication.publication_state in ('official', 'corrected')
  order by publication.published_at desc, publication.id desc
  limit 1;

  if p_case_type = 'protest'
     and latest_publication_at is not null
     and clock_timestamp() > latest_publication_at
       + make_interval(mins => coalesce(settings_row.protest_window_minutes, 120)) then
    raise exception using errcode = 'P0001', message = 'result_protest_window_closed';
  end if;

  if p_case_type = 'appeal' then
    if p_appeal_of_case_id is null then
      raise exception using errcode = '22023', message = 'result_appeal_parent_required';
    end if;
    select *
    into parent_case
    from public.result_adjudication_cases
    where id = p_appeal_of_case_id
      and event_category_id = p_event_category_id
    for update;
    if not found or parent_case.decided_at is null then
      raise exception using errcode = '22023', message = 'result_appeal_parent_invalid';
    end if;
    if clock_timestamp() > parent_case.decided_at
       + make_interval(mins => coalesce(settings_row.appeal_window_minutes, 1440)) then
      raise exception using errcode = 'P0001', message = 'result_appeal_window_closed';
    end if;
  elsif p_appeal_of_case_id is not null then
    raise exception using errcode = '22023', message = 'result_appeal_parent_invalid';
  end if;

  select count(*)::integer + 1
  into next_case_number
  from public.result_adjudication_cases
  where event_category_id = p_event_category_id;

  effective_deadline := coalesce(
    p_response_deadline,
    clock_timestamp()
      + make_interval(mins => coalesce(settings_row.decision_sla_minutes, 1440))
  );
  if effective_deadline <= clock_timestamp() then
    raise exception using errcode = '22023', message = 'result_adjudication_deadline_invalid';
  end if;

  insert into public.result_adjudication_cases (
    organization_id,
    event_category_id,
    registration_id,
    result_run_id,
    appeal_of_case_id,
    case_number,
    case_type,
    submitted_by_source,
    rule_reference,
    claim_summary,
    public_summary,
    restricted_evidence_json,
    response_deadline,
    created_by_user_id,
    client_event_id
  )
  values (
    organization_id,
    p_event_category_id,
    p_registration_id,
    p_result_run_id,
    p_appeal_of_case_id,
    upper(substr(replace(p_event_category_id::text, '-', ''), 1, 8))
      || '-' || lpad(next_case_number::text, 4, '0'),
    p_case_type,
    p_submitted_by_source,
    trim(p_rule_reference),
    trim(p_claim_summary),
    trim(p_public_summary),
    coalesce(p_restricted_evidence_json, '{}'::jsonb),
    effective_deadline,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into case_row;

  insert into public.result_adjudication_events (
    result_adjudication_case_id,
    sequence_number,
    action_type,
    note,
    public_note,
    evidence_json,
    actor_user_id,
    client_event_id
  )
  values (
    case_row.id,
    1,
    'submitted',
    case_row.claim_summary,
    case_row.public_summary,
    case_row.restricted_evidence_json,
    p_actor_user_id,
    p_client_event_id
  );

  if p_case_type = 'appeal' then
    update public.result_adjudication_cases
    set case_state = 'appealed'
    where id = p_appeal_of_case_id;
    insert into public.result_adjudication_events (
      result_adjudication_case_id,
      sequence_number,
      action_type,
      note,
      public_note,
      evidence_json,
      actor_user_id,
      client_event_id
    )
    values (
      p_appeal_of_case_id,
      (
        select coalesce(max(event.sequence_number), 0) + 1
        from public.result_adjudication_events event
        where event.result_adjudication_case_id = p_appeal_of_case_id
      ),
      'appealed',
      'Appeal case ' || case_row.case_number || ' was submitted.',
      'Decision appealed.',
      jsonb_build_object('appealCaseId', case_row.id),
      p_actor_user_id,
      gen_random_uuid()
    );
  end if;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    organization_id,
    p_actor_user_id,
    'result_adjudication_case',
    case_row.id,
    'results.adjudication_case_created',
    jsonb_build_object(
      'caseNumber', case_row.case_number,
      'caseType', case_row.case_type,
      'eventCategoryId', case_row.event_category_id
    )
  );

  return jsonb_build_object(
    'id', case_row.id,
    'caseNumber', case_row.case_number,
    'caseType', case_row.case_type,
    'caseState', case_row.case_state,
    'responseDeadline', case_row.response_deadline,
    'replayed', false
  );
end;
$$;
create or replace function public.service_append_result_adjudication_event(
  p_result_adjudication_case_id uuid,
  p_actor_user_id uuid,
  p_action_type text,
  p_note text,
  p_public_note text,
  p_decision_outcome text,
  p_result_impact_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.result_adjudication_cases%rowtype;
  replayed_event public.result_adjudication_events%rowtype;
  event_row public.result_adjudication_events%rowtype;
  next_sequence integer;
  next_state text;
  material_decision boolean;
begin
  select *
  into replayed_event
  from public.result_adjudication_events
  where client_event_id = p_client_event_id;
  if found then
    if replayed_event.result_adjudication_case_id
         is distinct from p_result_adjudication_case_id
       or replayed_event.action_type is distinct from p_action_type then
      raise exception using errcode = 'P0001', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', replayed_event.id,
      'caseId', replayed_event.result_adjudication_case_id,
      'sequenceNumber', replayed_event.sequence_number,
      'actionType', replayed_event.action_type,
      'replayed', true
    );
  end if;

  select *
  into case_row
  from public.result_adjudication_cases
  where id = p_result_adjudication_case_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'result_adjudication_case_not_found';
  end if;

  if p_actor_user_id is null
     or p_action_type not in (
       'accepted', 'review_started', 'evidence_added', 'decision_pending',
       'decision_recorded', 'withdrawn', 'closed', 'note'
     )
     or nullif(trim(p_note), '') is null
     or jsonb_typeof(coalesce(p_result_impact_json, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'result_adjudication_event_input_invalid';
  end if;

  if case_row.case_state in ('closed', 'withdrawn') then
    raise exception using errcode = 'P0001', message = 'result_adjudication_case_terminal';
  end if;

  next_state := case p_action_type
    when 'accepted' then 'accepted'
    when 'review_started' then 'in_review'
    when 'decision_pending' then 'decision_pending'
    when 'decision_recorded' then 'decided'
    when 'withdrawn' then 'withdrawn'
    when 'closed' then 'closed'
    else case_row.case_state
  end;

  if p_action_type = 'decision_recorded'
     and p_decision_outcome not in (
       'upheld', 'dismissed', 'penalty', 'status_change',
       'recompute_required', 'no_action'
     ) then
    raise exception using errcode = '22023', message = 'result_adjudication_decision_invalid';
  elsif p_action_type <> 'decision_recorded'
        and p_decision_outcome is not null then
    raise exception using errcode = '22023', message = 'result_adjudication_decision_invalid';
  end if;

  material_decision := p_action_type = 'decision_recorded'
    and p_decision_outcome in ('penalty', 'status_change', 'recompute_required');

  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.result_adjudication_events event
  where event.result_adjudication_case_id = case_row.id;

  insert into public.result_adjudication_events (
    result_adjudication_case_id,
    sequence_number,
    action_type,
    note,
    public_note,
    decision_outcome,
    evidence_json,
    actor_user_id,
    client_event_id
  )
  values (
    case_row.id,
    next_sequence,
    p_action_type,
    trim(p_note),
    nullif(trim(coalesce(p_public_note, '')), ''),
    p_decision_outcome,
    coalesce(p_result_impact_json, '{}'::jsonb),
    p_actor_user_id,
    p_client_event_id
  )
  returning * into event_row;

  update public.result_adjudication_cases
  set case_state = next_state,
      public_summary = case
        when nullif(trim(coalesce(p_public_note, '')), '') is not null
          then trim(p_public_note)
        else public_summary
      end,
      decision_outcome = case
        when p_action_type = 'decision_recorded' then p_decision_outcome
        else decision_outcome
      end,
      decision_summary = case
        when p_action_type = 'decision_recorded' then trim(p_note)
        else decision_summary
      end,
      result_impact_json = case
        when p_action_type = 'decision_recorded'
          then coalesce(p_result_impact_json, '{}'::jsonb)
        else result_impact_json
      end,
      recompute_required = case
        when p_action_type = 'decision_recorded' then material_decision
        else recompute_required
      end,
      decided_by_user_id = case
        when p_action_type = 'decision_recorded' then p_actor_user_id
        else decided_by_user_id
      end,
      decided_at = case
        when p_action_type = 'decision_recorded' then event_row.created_at
        else decided_at
      end,
      closed_at = case
        when p_action_type in ('closed', 'withdrawn') then event_row.created_at
        else closed_at
      end
  where id = case_row.id;

  if case_row.case_type = 'appeal'
     and p_action_type = 'decision_recorded'
     and case_row.appeal_of_case_id is not null then
    update public.result_adjudication_cases
    set case_state = 'closed',
        closed_at = event_row.created_at
    where id = case_row.appeal_of_case_id;

    insert into public.result_adjudication_events (
      result_adjudication_case_id,
      sequence_number,
      action_type,
      note,
      public_note,
      evidence_json,
      actor_user_id,
      client_event_id
    )
    values (
      case_row.appeal_of_case_id,
      (
        select coalesce(max(parent_event.sequence_number), 0) + 1
        from public.result_adjudication_events parent_event
        where parent_event.result_adjudication_case_id = case_row.appeal_of_case_id
      ),
      'closed',
      'Appeal ' || case_row.case_number || ' was decided.',
      'Appeal process completed.',
      jsonb_build_object(
        'appealCaseId', case_row.id,
        'appealOutcome', p_decision_outcome
      ),
      p_actor_user_id,
      gen_random_uuid()
    );
  end if;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    case_row.organization_id,
    p_actor_user_id,
    'result_adjudication_case',
    case_row.id,
    'results.adjudication_event_recorded',
    jsonb_build_object(
      'sequenceNumber', event_row.sequence_number,
      'actionType', event_row.action_type,
      'decisionOutcome', event_row.decision_outcome,
      'recomputeRequired', material_decision
    )
  );

  return jsonb_build_object(
    'id', event_row.id,
    'caseId', case_row.id,
    'sequenceNumber', event_row.sequence_number,
    'actionType', event_row.action_type,
    'caseState', next_state,
    'decisionOutcome', event_row.decision_outcome,
    'recomputeRequired', material_decision,
    'createdAt', event_row.created_at,
    'replayed', false
  );
end;
$$;
create or replace function public.service_record_result_publication_approval(
  p_event_category_id uuid,
  p_result_run_id uuid,
  p_publication_state public.publication_state,
  p_change_note text,
  p_actor_user_id uuid,
  p_decision text,
  p_decision_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_id uuid;
  proposal_digest text;
  approval_row public.result_publication_approvals%rowtype;
  replayed_approval public.result_publication_approvals%rowtype;
  approval_count integer;
  rejection_count integer;
  required_count integer;
begin
  select *
  into replayed_approval
  from public.result_publication_approvals
  where client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'id', replayed_approval.id,
      'proposalDigestSha256', replayed_approval.proposal_digest_sha256,
      'decision', replayed_approval.decision,
      'replayed', true
    );
  end if;

  select series.organization_id
  into organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = p_event_category_id;

  if organization_id is null
     or p_actor_user_id is null
     or p_publication_state not in ('official', 'corrected')
     or p_decision not in ('approved', 'rejected')
     or nullif(trim(p_decision_note), '') is null
     or not exists (
       select 1
       from public.result_runs result_run
       where result_run.id = p_result_run_id
         and result_run.event_category_id = p_event_category_id
         and result_run.status = 'succeeded'
     ) then
    raise exception using errcode = '22023', message = 'result_publication_approval_input_invalid';
  end if;

  proposal_digest := public.result_publication_proposal_digest(
    p_event_category_id,
    p_result_run_id,
    p_publication_state,
    p_change_note
  );

  begin
    insert into public.result_publication_approvals (
      organization_id,
      event_category_id,
      result_run_id,
      publication_state,
      proposal_digest_sha256,
      decision,
      decision_note,
      actor_user_id,
      client_event_id
    )
    values (
      organization_id,
      p_event_category_id,
      p_result_run_id,
      p_publication_state,
      proposal_digest,
      p_decision,
      trim(p_decision_note),
      p_actor_user_id,
      p_client_event_id
    )
    returning * into approval_row;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'result_publication_actor_already_decided';
  end;

  select
    count(*) filter (where approval.decision = 'approved')::integer,
    count(*) filter (where approval.decision = 'rejected')::integer
  into approval_count, rejection_count
  from public.result_publication_approvals approval
  where approval.proposal_digest_sha256 = proposal_digest;

  select case p_publication_state
    when 'corrected' then settings.required_corrected_approvals
    else settings.required_official_approvals
  end
  into required_count
  from public.result_governance_settings settings
  where settings.event_category_id = p_event_category_id;
  required_count := coalesce(required_count, 0);

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    organization_id,
    p_actor_user_id,
    'result_run',
    p_result_run_id,
    'results.publication_approval_recorded',
    jsonb_build_object(
      'proposalDigestSha256', proposal_digest,
      'decision', p_decision,
      'approvedCount', approval_count,
      'requiredCount', required_count
    )
  );

  return jsonb_build_object(
    'id', approval_row.id,
    'proposalDigestSha256', proposal_digest,
    'decision', approval_row.decision,
    'approvedCount', approval_count,
    'rejectedCount', rejection_count,
    'requiredCount', required_count,
    'ready', rejection_count = 0 and approval_count >= required_count,
    'replayed', false
  );
end;
$$;
create or replace function public.service_attest_result_publication(
  p_result_publication_id uuid,
  p_actor_user_id uuid,
  p_signature_key_reference text,
  p_signature_algorithm text,
  p_detached_signature text,
  p_signed_digest_sha256 text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  publication_row public.result_publications%rowtype;
  replayed_event public.result_publication_signature_events%rowtype;
begin
  select *
  into replayed_event
  from public.result_publication_signature_events
  where client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'publicationId', replayed_event.result_publication_id,
      'signatureState', 'signed',
      'manifestDigestSha256', replayed_event.manifest_digest_sha256,
      'replayed', true
    );
  end if;

  select *
  into publication_row
  from public.result_publications
  where id = p_result_publication_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'result_publication_not_found';
  end if;

  if publication_row.publication_state not in ('official', 'corrected')
     or publication_row.manifest_digest_sha256 is null
     or publication_row.signature_state not in ('pending', 'signed')
     or p_actor_user_id is null
     or p_signature_algorithm not in ('hmac-sha256', 'ed25519', 'ecdsa-p256-sha256')
     or nullif(trim(p_signature_key_reference), '') is null
     or length(trim(coalesce(p_detached_signature, ''))) < 32
     or p_signed_digest_sha256 is distinct from publication_row.manifest_digest_sha256 then
    raise exception using errcode = '22023', message = 'result_publication_signature_input_invalid';
  end if;

  if publication_row.signature_state = 'signed' then
    raise exception using errcode = 'P0001', message = 'result_publication_already_signed';
  end if;

  insert into public.result_publication_signature_events (
    result_publication_id,
    manifest_digest_sha256,
    signature_algorithm,
    signature_key_reference,
    detached_signature,
    actor_user_id,
    client_event_id
  )
  values (
    publication_row.id,
    publication_row.manifest_digest_sha256,
    p_signature_algorithm,
    trim(p_signature_key_reference),
    trim(p_detached_signature),
    p_actor_user_id,
    p_client_event_id
  );

  update public.result_publications
  set signature_state = 'signed',
      signature_algorithm = p_signature_algorithm,
      signature_key_reference = trim(p_signature_key_reference),
      detached_signature = trim(p_detached_signature),
      signed_digest_sha256 = publication_row.manifest_digest_sha256,
      signed_by_user_id = p_actor_user_id,
      signed_at = clock_timestamp()
  where id = publication_row.id;

  return jsonb_build_object(
    'publicationId', publication_row.id,
    'signatureState', 'signed',
    'signatureAlgorithm', p_signature_algorithm,
    'signatureKeyReference', trim(p_signature_key_reference),
    'manifestDigestSha256', publication_row.manifest_digest_sha256,
    'replayed', false
  );
end;
$$;
create or replace function public.service_save_result_credential_template(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_credential_type text,
  p_locale text,
  p_title_template text,
  p_body_template text,
  p_design_tokens_json jsonb,
  p_eligibility_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_row public.result_credential_templates%rowtype;
  replayed_template public.result_credential_templates%rowtype;
  next_version integer;
  content_digest text;
begin
  select *
  into replayed_template
  from public.result_credential_templates
  where client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'id', replayed_template.id,
      'versionNumber', replayed_template.version_number,
      'contentDigestSha256', replayed_template.content_digest_sha256,
      'replayed', true
    );
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id)
     or p_actor_user_id is null
     or nullif(trim(p_name), '') is null
     or p_credential_type not in (
       'finisher_certificate', 'award_certificate', 'badge', 'qualification'
     )
     or coalesce(p_locale, '') !~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'
     or nullif(trim(p_title_template), '') is null
     or nullif(trim(p_body_template), '') is null
     or jsonb_typeof(coalesce(p_design_tokens_json, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_eligibility_json, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'result_credential_template_input_invalid';
  end if;

  select coalesce(max(template.version_number), 0) + 1
  into next_version
  from public.result_credential_templates template
  where template.organization_id = p_organization_id
    and lower(template.name) = lower(trim(p_name))
    and template.credential_type = p_credential_type
    and lower(template.locale) = lower(p_locale);

  content_digest := encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'name', trim(p_name),
          'credentialType', p_credential_type,
          'locale', lower(p_locale),
          'titleTemplate', trim(p_title_template),
          'bodyTemplate', trim(p_body_template),
          'designTokens', coalesce(p_design_tokens_json, '{}'::jsonb),
          'eligibility', coalesce(p_eligibility_json, '{}'::jsonb),
          'versionNumber', next_version
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  update public.result_credential_templates
  set status = 'superseded'
  where organization_id = p_organization_id
    and lower(name) = lower(trim(p_name))
    and credential_type = p_credential_type
    and lower(locale) = lower(p_locale)
    and status = 'active';

  insert into public.result_credential_templates (
    organization_id,
    name,
    credential_type,
    locale,
    version_number,
    title_template,
    body_template,
    design_tokens_json,
    eligibility_json,
    content_digest_sha256,
    created_by_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    trim(p_name),
    p_credential_type,
    lower(p_locale),
    next_version,
    trim(p_title_template),
    trim(p_body_template),
    coalesce(p_design_tokens_json, '{}'::jsonb),
    coalesce(p_eligibility_json, '{}'::jsonb),
    content_digest,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into template_row;

  return jsonb_build_object(
    'id', template_row.id,
    'name', template_row.name,
    'credentialType', template_row.credential_type,
    'locale', template_row.locale,
    'versionNumber', template_row.version_number,
    'contentDigestSha256', template_row.content_digest_sha256,
    'replayed', false
  );
end;
$$;
create or replace function public.service_issue_result_credentials(
  p_result_publication_id uuid,
  p_result_credential_template_id uuid,
  p_actor_user_id uuid,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  publication_row public.result_publications%rowtype;
  template_row public.result_credential_templates%rowtype;
  target_organization_id uuid;
  batch_row public.result_credential_batches%rowtype;
  replayed_batch public.result_credential_batches%rowtype;
  source_row record;
  credential_id uuid;
  verification_code text;
  issued_at timestamptz;
  manifest jsonb;
  credential_digest text;
  issued_total integer := 0;
  require_signature boolean;
begin
  select *
  into replayed_batch
  from public.result_credential_batches
  where client_event_id = p_client_event_id;
  if found then
    if replayed_batch.result_publication_id is distinct from p_result_publication_id
       or replayed_batch.result_credential_template_id
         is distinct from p_result_credential_template_id then
      raise exception using errcode = 'P0001', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', replayed_batch.id,
      'issuedCount', replayed_batch.issued_count,
      'replayed', true
    );
  end if;

  select *
  into publication_row
  from public.result_publications
  where id = p_result_publication_id
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'result_publication_not_found';
  end if;

  select series.organization_id
  into target_organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = publication_row.event_category_id;

  select *
  into template_row
  from public.result_credential_templates template
  where template.id = p_result_credential_template_id
    and template.organization_id = target_organization_id
    and template.status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'result_credential_template_not_found';
  end if;

  select coalesce(settings.require_signed_credentials, true)
  into require_signature
  from public.result_governance_settings settings
  where settings.event_category_id = publication_row.event_category_id;
  require_signature := coalesce(require_signature, true);

  if p_actor_user_id is null
     or publication_row.publication_state not in ('official', 'corrected')
     or publication_row.manifest_digest_sha256 is null
     or (require_signature and publication_row.signature_state <> 'signed') then
    raise exception using errcode = 'P0001', message = 'signed_official_publication_required';
  end if;

  insert into public.result_credential_batches (
    organization_id,
    result_publication_id,
    result_credential_template_id,
    requested_by_user_id,
    client_event_id
  )
  values (
    target_organization_id,
    publication_row.id,
    template_row.id,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into batch_row;

  for source_row in
    select
      result_row.id as result_row_id,
      result_row.athlete_profile_id,
      athlete.display_name as athlete_name,
      result_row.result_status,
      result_row.finish_time_ms,
      result_row.rank_overall,
      result_row.rank_gender,
      result_row.rank_age_category,
      registration.id as registration_id,
      bib.bib_number,
      category.id as category_id,
      category.name as category_name,
      edition.id as event_edition_id,
      edition.name as event_name,
      edition.start_date,
      edition.timezone
    from public.result_rows result_row
    join public.athlete_profiles athlete
      on athlete.id = result_row.athlete_profile_id
    join public.registrations registration
      on registration.id = result_row.registration_id
    join public.event_categories category
      on category.id = result_row.event_category_id
    join public.event_editions edition
      on edition.id = category.event_edition_id
    left join lateral (
      select assignment.bib_number
      from public.bib_assignments assignment
      where assignment.registration_id = result_row.registration_id
        and assignment.revoked_at is null
      order by assignment.assigned_at desc
      limit 1
    ) bib on true
    where result_row.result_run_id = publication_row.result_run_id
      and (
        template_row.credential_type <> 'finisher_certificate'
        or result_row.finish_time_ms is not null
      )
    order by result_row.rank_overall nulls last, result_row.id
  loop
    if exists (
      select 1
      from public.result_credentials credential
      where credential.result_publication_id = publication_row.id
        and credential.result_row_id = source_row.result_row_id
        and credential.result_credential_template_id = template_row.id
        and credential.credential_state = 'active'
    ) then
      continue;
    end if;

    credential_id := gen_random_uuid();
    verification_code := upper(substr(
      encode(public.digest(credential_id::text || gen_random_uuid()::text, 'sha256'), 'hex'),
      1,
      20
    ));
    issued_at := clock_timestamp();
    manifest := jsonb_build_object(
      'schema', 'sitrail.result-credential.v1',
      'credentialId', credential_id,
      'credentialType', template_row.credential_type,
      'verificationCode', verification_code,
      'publication', jsonb_build_object(
        'id', publication_row.id,
        'state', publication_row.publication_state,
        'manifestDigestSha256', publication_row.manifest_digest_sha256,
        'signatureAlgorithm', publication_row.signature_algorithm,
        'signatureKeyReference', publication_row.signature_key_reference,
        'signedDigestSha256', publication_row.signed_digest_sha256
      ),
      'template', jsonb_build_object(
        'id', template_row.id,
        'name', template_row.name,
        'versionNumber', template_row.version_number,
        'locale', template_row.locale,
        'titleTemplate', template_row.title_template,
        'bodyTemplate', template_row.body_template,
        'designTokens', template_row.design_tokens_json,
        'contentDigestSha256', template_row.content_digest_sha256
      ),
      'athlete', jsonb_build_object(
        'athleteProfileId', source_row.athlete_profile_id,
        'displayName', source_row.athlete_name,
        'registrationId', source_row.registration_id,
        'bibNumber', source_row.bib_number
      ),
      'event', jsonb_build_object(
        'eventEditionId', source_row.event_edition_id,
        'eventName', source_row.event_name,
        'categoryId', source_row.category_id,
        'categoryName', source_row.category_name,
        'startDate', source_row.start_date,
        'timezone', source_row.timezone
      ),
      'result', jsonb_build_object(
        'resultRowId', source_row.result_row_id,
        'resultStatus', source_row.result_status,
        'finishTimeMs', source_row.finish_time_ms,
        'rankOverall', source_row.rank_overall,
        'rankGender', source_row.rank_gender,
        'rankAgeCategory', source_row.rank_age_category
      ),
      'issuedAt', issued_at
    );
    credential_digest := encode(
      public.digest(convert_to(manifest::text, 'UTF8'), 'sha256'),
      'hex'
    );

    insert into public.result_credentials (
      id,
      organization_id,
      result_publication_id,
      result_row_id,
      result_credential_template_id,
      athlete_profile_id,
      credential_type,
      verification_code,
      manifest_json,
      credential_digest_sha256,
      issued_by_user_id,
      issued_at
    )
    values (
      credential_id,
      target_organization_id,
      publication_row.id,
      source_row.result_row_id,
      template_row.id,
      source_row.athlete_profile_id,
      template_row.credential_type,
      verification_code,
      manifest,
      credential_digest,
      p_actor_user_id,
      issued_at
    );

    insert into public.result_credential_events (
      result_credential_id,
      sequence_number,
      action_type,
      note,
      metadata_json,
      actor_user_id
    )
    values (
      credential_id,
      1,
      'issued',
      'Credential issued from signed publication '
        || publication_row.id::text || '.',
      jsonb_build_object(
        'publicationDigestSha256', publication_row.manifest_digest_sha256,
        'templateVersion', template_row.version_number,
        'batchId', batch_row.id
      ),
      p_actor_user_id
    );
    issued_total := issued_total + 1;
  end loop;

  update public.result_credential_batches
  set issued_count = issued_total,
      completed_at = clock_timestamp()
  where id = batch_row.id;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    target_organization_id,
    p_actor_user_id,
    'result_publication',
    publication_row.id,
    'results.credentials_issued',
    jsonb_build_object(
      'batchId', batch_row.id,
      'templateId', template_row.id,
      'issuedCount', issued_total
    )
  );

  return jsonb_build_object(
    'id', batch_row.id,
    'publicationId', publication_row.id,
    'templateId', template_row.id,
    'issuedCount', issued_total,
    'completedAt', clock_timestamp(),
    'replayed', false
  );
end;
$$;
create or replace function public.service_revoke_result_credential(
  p_result_credential_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  credential_row public.result_credentials%rowtype;
  replayed_event public.result_credential_events%rowtype;
  next_sequence integer;
begin
  select *
  into replayed_event
  from public.result_credential_events
  where client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'id', replayed_event.result_credential_id,
      'credentialState', 'revoked',
      'replayed', true
    );
  end if;

  select *
  into credential_row
  from public.result_credentials
  where id = p_result_credential_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'result_credential_not_found';
  end if;

  if p_actor_user_id is null or nullif(trim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'result_credential_revocation_input_invalid';
  end if;
  if credential_row.credential_state <> 'active' then
    raise exception using errcode = 'P0001', message = 'result_credential_not_active';
  end if;

  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.result_credential_events event
  where event.result_credential_id = credential_row.id;

  update public.result_credentials
  set credential_state = 'revoked',
      revoked_by_user_id = p_actor_user_id,
      revoked_at = clock_timestamp(),
      revocation_reason = trim(p_reason)
  where id = credential_row.id;

  insert into public.result_credential_events (
    result_credential_id,
    sequence_number,
    action_type,
    note,
    actor_user_id,
    client_event_id
  )
  values (
    credential_row.id,
    next_sequence,
    'revoked',
    trim(p_reason),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'id', credential_row.id,
    'credentialState', 'revoked',
    'revocationReason', trim(p_reason),
    'replayed', false
  );
end;
$$;
create or replace function public.service_reissue_result_credential(
  p_result_credential_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_credential public.result_credentials%rowtype;
  replayed_credential public.result_credentials%rowtype;
  new_credential_id uuid;
  verification_code text;
  issued_at timestamptz;
  manifest jsonb;
  credential_digest text;
  old_next_sequence integer;
begin
  select credential.*
  into replayed_credential
  from public.result_credentials credential
  join public.result_credential_events event
    on event.result_credential_id = credential.id
  where event.client_event_id = p_client_event_id
    and event.action_type = 'issued';
  if found then
    return jsonb_build_object(
      'id', replayed_credential.id,
      'credentialState', replayed_credential.credential_state,
      'supersedesCredentialId', replayed_credential.supersedes_credential_id,
      'verificationCode', replayed_credential.verification_code,
      'replayed', true
    );
  end if;

  select *
  into old_credential
  from public.result_credentials
  where id = p_result_credential_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'result_credential_not_found';
  end if;

  if p_actor_user_id is null
     or nullif(trim(p_reason), '') is null
     or old_credential.credential_state <> 'revoked' then
    raise exception using errcode = 'P0001', message = 'revoked_result_credential_required';
  end if;

  if old_credential.result_publication_id is distinct from (
    select publication.id
    from public.result_publications publication
    where publication.event_category_id = (
      select result_row.event_category_id
      from public.result_rows result_row
      where result_row.id = old_credential.result_row_id
    )
    order by publication.published_at desc, publication.created_at desc, publication.id desc
    limit 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'superseded_result_publication_credential_cannot_reissue';
  end if;

  new_credential_id := gen_random_uuid();
  verification_code := upper(substr(
    encode(public.digest(new_credential_id::text || gen_random_uuid()::text, 'sha256'), 'hex'),
    1,
    20
  ));
  issued_at := clock_timestamp();
  manifest := old_credential.manifest_json
    || jsonb_build_object(
      'credentialId', new_credential_id,
      'verificationCode', verification_code,
      'issuedAt', issued_at,
      'reissue', jsonb_build_object(
        'supersedesCredentialId', old_credential.id,
        'reason', trim(p_reason)
      )
    );
  credential_digest := encode(
    public.digest(convert_to(manifest::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.result_credentials (
    id,
    organization_id,
    result_publication_id,
    result_row_id,
    result_credential_template_id,
    athlete_profile_id,
    credential_type,
    verification_code,
    manifest_json,
    credential_digest_sha256,
    issued_by_user_id,
    issued_at,
    supersedes_credential_id
  )
  values (
    new_credential_id,
    old_credential.organization_id,
    old_credential.result_publication_id,
    old_credential.result_row_id,
    old_credential.result_credential_template_id,
    old_credential.athlete_profile_id,
    old_credential.credential_type,
    verification_code,
    manifest,
    credential_digest,
    p_actor_user_id,
    issued_at,
    old_credential.id
  );

  select coalesce(max(event.sequence_number), 0) + 1
  into old_next_sequence
  from public.result_credential_events event
  where event.result_credential_id = old_credential.id;

  insert into public.result_credential_events (
    result_credential_id,
    sequence_number,
    action_type,
    note,
    metadata_json,
    actor_user_id
  )
  values (
    old_credential.id,
    old_next_sequence,
    'superseded',
    trim(p_reason),
    jsonb_build_object('replacementCredentialId', new_credential_id),
    p_actor_user_id
  );

  insert into public.result_credential_events (
    result_credential_id,
    sequence_number,
    action_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    new_credential_id,
    1,
    'issued',
    'Credential reissued: ' || trim(p_reason),
    jsonb_build_object('supersedesCredentialId', old_credential.id),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'id', new_credential_id,
    'credentialState', 'active',
    'supersedesCredentialId', old_credential.id,
    'verificationCode', verification_code,
    'credentialDigestSha256', credential_digest,
    'replayed', false
  );
end;
$$;
create or replace function public.service_verify_result_credential(
  p_verification_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  credential_row public.result_credentials%rowtype;
  publication_row public.result_publications%rowtype;
  recomputed_digest text;
  recomputed_publication_digest text;
begin
  select *
  into credential_row
  from public.result_credentials
  where verification_code = upper(trim(p_verification_code));
  if not found then
    raise exception using errcode = 'P0002', message = 'result_credential_not_found';
  end if;

  select *
  into publication_row
  from public.result_publications
  where id = credential_row.result_publication_id;

  recomputed_digest := encode(
    public.digest(convert_to(credential_row.manifest_json::text, 'UTF8'), 'sha256'),
    'hex'
  );
  recomputed_publication_digest := case
    when publication_row.manifest_json is null then null
    else encode(
      public.digest(convert_to(publication_row.manifest_json::text, 'UTF8'), 'sha256'),
      'hex'
    )
  end;

  return jsonb_build_object(
    'id', credential_row.id,
    'credentialType', credential_row.credential_type,
    'credentialState', credential_row.credential_state,
    'verificationCode', credential_row.verification_code,
    'credentialDigestSha256', credential_row.credential_digest_sha256,
    'integrityValid', recomputed_digest = credential_row.credential_digest_sha256,
    'publication', jsonb_build_object(
      'id', publication_row.id,
      'state', publication_row.publication_state,
      'signatureState', publication_row.signature_state,
      'manifestDigestSha256', publication_row.manifest_digest_sha256,
      'signatureAlgorithm', publication_row.signature_algorithm,
      'signatureKeyReference', publication_row.signature_key_reference,
      'detachedSignature', publication_row.detached_signature,
      'publicationIntegrityValid',
        recomputed_publication_digest = publication_row.manifest_digest_sha256
        and publication_row.signed_digest_sha256 = publication_row.manifest_digest_sha256,
      'signedAt', publication_row.signed_at
    ),
    'manifest', credential_row.manifest_json,
    'issuedAt', credential_row.issued_at,
    'revokedAt', credential_row.revoked_at,
    'revocationReason', credential_row.revocation_reason,
    'supersedesCredentialId', credential_row.supersedes_credential_id
  );
end;
$$;
create or replace function public.publish_result_run_atomically(
  target_event_category_id uuid,
  target_result_run_id uuid,
  target_publication_state public.publication_state,
  target_published_by_user_id uuid,
  target_change_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest_publication_id uuid;
  created_publication_id uuid := gen_random_uuid();
  publication_at timestamptz := clock_timestamp();
  result_run_row public.result_runs%rowtype;
  result_rows_manifest jsonb;
  publication_manifest jsonb;
  manifest_digest text;
  revoked_credential record;
  next_event_sequence integer;
begin
  perform 1
  from public.event_categories
  where id = target_event_category_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;

  select *
  into result_run_row
  from public.result_runs
  where id = target_result_run_id
    and event_category_id = target_event_category_id
    and status = 'succeeded';
  if not found then
    raise exception using errcode = 'P0001', message = 'successful_result_run_required';
  end if;

  select id
  into latest_publication_id
  from public.result_publications
  where event_category_id = target_event_category_id
  order by published_at desc, created_at desc, id desc
  limit 1;

  if target_publication_state = 'corrected' and latest_publication_id is null then
    raise exception using errcode = 'P0001', message = 'correction_requires_previous_publication';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'resultRowId', result_row.id,
        'registrationId', result_row.registration_id,
        'athleteProfileId', result_row.athlete_profile_id,
        'resultStatus', result_row.result_status,
        'finishTimeMs', result_row.finish_time_ms,
        'gapMs', result_row.gap_ms,
        'rankOverall', result_row.rank_overall,
        'rankGender', result_row.rank_gender,
        'rankAgeCategory', result_row.rank_age_category,
        'clubPoints', result_row.club_points,
        'representedClubId', result_row.represented_club_id
      )
      order by
        result_row.rank_overall nulls last,
        result_row.finish_time_ms nulls last,
        result_row.id
    ),
    '[]'::jsonb
  )
  into result_rows_manifest
  from public.result_rows result_row
  where result_row.result_run_id = target_result_run_id;

  publication_manifest := jsonb_build_object(
    'schema', 'sitrail.result-publication.v1',
    'publicationId', created_publication_id,
    'eventCategoryId', target_event_category_id,
    'resultRunId', target_result_run_id,
    'publicationState', target_publication_state,
    'publishedAt', publication_at,
    'publishedByUserId', target_published_by_user_id,
    'supersedesPublicationId', latest_publication_id,
    'changeNote', nullif(trim(coalesce(target_change_note, '')), ''),
    'engineVersion', result_run_row.engine_version,
    'inputDigestSha256', result_run_row.input_digest,
    'startEventId', result_run_row.start_event_id,
    'resultRows', result_rows_manifest
  );
  manifest_digest := encode(
    public.digest(convert_to(publication_manifest::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.result_publications (
    id,
    event_category_id,
    result_run_id,
    publication_state,
    published_by_user_id,
    published_at,
    supersedes_publication_id,
    change_note,
    created_at,
    manifest_json,
    manifest_digest_sha256,
    signature_state
  )
  values (
    created_publication_id,
    target_event_category_id,
    target_result_run_id,
    target_publication_state,
    target_published_by_user_id,
    publication_at,
    latest_publication_id,
    nullif(trim(coalesce(target_change_note, '')), ''),
    publication_at,
    publication_manifest,
    manifest_digest,
    case
      when target_publication_state in ('official', 'corrected') then 'pending'
      else 'not_required'
    end
  );

  update public.result_rows
  set result_status = case
    when target_publication_state = 'corrected' then 'corrected'::public.result_status
    when target_publication_state = 'official' then 'official'::public.result_status
    else 'provisional'::public.result_status
  end
  where result_run_id = target_result_run_id;

  if target_publication_state = 'corrected'
     and latest_publication_id is not null then
    for revoked_credential in
      update public.result_credentials credential
      set credential_state = 'revoked',
          revoked_by_user_id = target_published_by_user_id,
          revoked_at = publication_at,
          revocation_reason = 'Superseded by corrected publication '
            || created_publication_id::text || '.'
      where credential.result_publication_id = latest_publication_id
        and credential.credential_state = 'active'
      returning credential.id
    loop
      select coalesce(max(event.sequence_number), 0) + 1
      into next_event_sequence
      from public.result_credential_events event
      where event.result_credential_id = revoked_credential.id;

      insert into public.result_credential_events (
        result_credential_id,
        sequence_number,
        action_type,
        note,
        metadata_json,
        actor_user_id
      )
      values (
        revoked_credential.id,
        next_event_sequence,
        'revoked',
        'Credential automatically revoked by corrected result publication.',
        jsonb_build_object(
          'correctedPublicationId', created_publication_id,
          'supersededPublicationId', latest_publication_id
        ),
        target_published_by_user_id
      );
    end loop;
  end if;

  return created_publication_id;
end;
$$;
create or replace function public.service_publish_result_run_guarded(
  p_event_category_id uuid,
  p_result_run_id uuid,
  p_publication_state public.publication_state,
  p_published_by_user_id uuid,
  p_change_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  publication_id uuid;
  result_run_row public.result_runs%rowtype;
  latest_start_id uuid;
  proposal_digest text;
  required_approvals integer := 0;
  recorded_approvals integer := 0;
begin
  select result_run.*
  into result_run_row
  from public.result_runs result_run
  where result_run.id = p_result_run_id
    and result_run.event_category_id = p_event_category_id
    and result_run.status = 'succeeded';
  if not found then
    raise exception using errcode = 'P0001', message = 'successful_result_run_required';
  end if;

  if p_publication_state = 'corrected'
     and nullif(trim(coalesce(p_change_note, '')), '') is null then
    raise exception using errcode = '22023', message = 'result_correction_change_note_required';
  end if;

  select start_event.id
  into latest_start_id
  from public.race_start_events start_event
  where start_event.event_category_id = p_event_category_id
    and start_event.event_type in ('actual_start', 'restart')
  order by start_event.sequence_number desc
  limit 1;
  if latest_start_id is null
     or result_run_row.start_event_id is distinct from latest_start_id then
    raise exception using errcode = 'P0001', message = 'result_run_start_lineage_stale';
  end if;

  if exists (
    select 1
    from public.result_anomalies anomaly
    where anomaly.result_run_id = p_result_run_id
      and anomaly.state = 'open'
      and anomaly.severity in ('error', 'critical')
  ) then
    raise exception using errcode = 'P0001', message = 'blocking_result_anomalies_open';
  end if;

  if exists (
    select 1
    from public.punch_events punch
    where punch.event_category_id = p_event_category_id
      and not punch.is_voided
      and punch.registration_id is null
  ) then
    raise exception using errcode = 'P0001', message = 'unresolved_timing_events_open';
  end if;

  if p_publication_state in ('official', 'corrected') and exists (
    select 1
    from public.result_adjudication_cases adjudication_case
    where adjudication_case.event_category_id = p_event_category_id
      and adjudication_case.case_state in (
        'submitted', 'accepted', 'in_review', 'decision_pending', 'appealed'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'unresolved_result_adjudications_open';
  end if;

  if p_publication_state in ('official', 'corrected') and exists (
    select 1
    from public.result_adjudication_cases adjudication_case
    where adjudication_case.event_category_id = p_event_category_id
      and adjudication_case.recompute_required
      and adjudication_case.decided_at is not null
      and result_run_row.started_at <= adjudication_case.decided_at
  ) then
    raise exception using errcode = 'P0001', message = 'result_recompute_after_decision_required';
  end if;

  if p_publication_state in ('official', 'corrected') and not exists (
    select 1
    from public.field_accounting_signoffs signoff
    where signoff.event_category_id = p_event_category_id
      and signoff.sequence_number = (
        select max(latest_signoff.sequence_number)
        from public.field_accounting_signoffs latest_signoff
        where latest_signoff.event_category_id = p_event_category_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'field_accounting_signoff_required';
  end if;

  if p_publication_state in ('official', 'corrected') and exists (
    select 1
    from public.registrations registration
    where registration.event_category_id = p_event_category_id
      and registration.status = 'confirmed'
      and registration.participation_status in (
        'not_started', 'checked_in', 'started', 'missing'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'field_accounting_incomplete';
  end if;

  if p_publication_state in ('official', 'corrected') then
    select case p_publication_state
      when 'corrected' then settings.required_corrected_approvals
      else settings.required_official_approvals
    end
    into required_approvals
    from public.result_governance_settings settings
    where settings.event_category_id = p_event_category_id;
    required_approvals := coalesce(required_approvals, 0);

    proposal_digest := public.result_publication_proposal_digest(
      p_event_category_id,
      p_result_run_id,
      p_publication_state,
      p_change_note
    );

    if exists (
      select 1
      from public.result_publication_approvals approval
      where approval.proposal_digest_sha256 = proposal_digest
        and approval.decision = 'rejected'
    ) then
      raise exception using errcode = 'P0001', message = 'result_publication_proposal_rejected';
    end if;

    select count(distinct approval.actor_user_id)::integer
    into recorded_approvals
    from public.result_publication_approvals approval
    where approval.proposal_digest_sha256 = proposal_digest
      and approval.decision = 'approved';

    if recorded_approvals < required_approvals then
      raise exception using
        errcode = 'P0001',
        message = 'result_publication_approvals_required',
        detail = jsonb_build_object(
          'required', required_approvals,
          'recorded', recorded_approvals,
          'proposalDigestSha256', proposal_digest
        )::text;
    end if;
  end if;

  publication_id := public.publish_result_run_atomically(
    p_event_category_id,
    p_result_run_id,
    p_publication_state,
    p_published_by_user_id,
    p_change_note
  );
  return publication_id;
end;
$$;
alter table public.result_governance_settings enable row level security;
alter table public.result_adjudication_cases enable row level security;
alter table public.result_adjudication_events enable row level security;
alter table public.result_publication_approvals enable row level security;
alter table public.result_publication_signature_events enable row level security;
alter table public.result_credential_templates enable row level security;
alter table public.result_credential_batches enable row level security;
alter table public.result_credentials enable row level security;
alter table public.result_credential_events enable row level security;
revoke all on table public.result_governance_settings from public, anon, authenticated;
revoke all on table public.result_adjudication_cases from public, anon, authenticated;
revoke all on table public.result_adjudication_events from public, anon, authenticated;
revoke all on table public.result_publication_approvals from public, anon, authenticated;
revoke all on table public.result_publication_signature_events from public, anon, authenticated;
revoke all on table public.result_credential_templates from public, anon, authenticated;
revoke all on table public.result_credential_batches from public, anon, authenticated;
revoke all on table public.result_credentials from public, anon, authenticated;
revoke all on table public.result_credential_events from public, anon, authenticated;
grant all on table public.result_governance_settings to service_role;
grant all on table public.result_adjudication_cases to service_role;
grant all on table public.result_adjudication_events to service_role;
grant all on table public.result_publication_approvals to service_role;
grant all on table public.result_publication_signature_events to service_role;
grant all on table public.result_credential_templates to service_role;
grant all on table public.result_credential_batches to service_role;
grant all on table public.result_credentials to service_role;
grant all on table public.result_credential_events to service_role;
revoke all on function public.result_publication_proposal_digest(
  uuid, uuid, public.publication_state, text
) from public, anon, authenticated;
revoke all on function public.service_save_result_governance_settings(
  uuid, uuid, integer, integer, integer, smallint, smallint, boolean
) from public, anon, authenticated;
revoke all on function public.service_create_result_adjudication_case(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb,
  timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.service_append_result_adjudication_event(
  uuid, uuid, text, text, text, text, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.service_record_result_publication_approval(
  uuid, uuid, public.publication_state, text, uuid, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_attest_result_publication(
  uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_save_result_credential_template(
  uuid, uuid, text, text, text, text, text, jsonb, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.service_issue_result_credentials(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.service_revoke_result_credential(
  uuid, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_reissue_result_credential(
  uuid, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_verify_result_credential(text)
  from public, anon, authenticated;
grant execute on function public.result_publication_proposal_digest(
  uuid, uuid, public.publication_state, text
) to service_role;
grant execute on function public.service_save_result_governance_settings(
  uuid, uuid, integer, integer, integer, smallint, smallint, boolean
) to service_role;
grant execute on function public.service_create_result_adjudication_case(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb,
  timestamptz, uuid
) to service_role;
grant execute on function public.service_append_result_adjudication_event(
  uuid, uuid, text, text, text, text, jsonb, uuid
) to service_role;
grant execute on function public.service_record_result_publication_approval(
  uuid, uuid, public.publication_state, text, uuid, text, text, uuid
) to service_role;
grant execute on function public.service_attest_result_publication(
  uuid, uuid, text, text, text, text, uuid
) to service_role;
grant execute on function public.service_save_result_credential_template(
  uuid, uuid, text, text, text, text, text, jsonb, jsonb, uuid
) to service_role;
grant execute on function public.service_issue_result_credentials(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.service_revoke_result_credential(
  uuid, uuid, text, uuid
) to service_role;
grant execute on function public.service_reissue_result_credential(
  uuid, uuid, text, uuid
) to service_role;
grant execute on function public.service_verify_result_credential(text)
  to service_role;
