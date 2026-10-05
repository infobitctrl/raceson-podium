alter table public.punch_events
  add column effective_recorded_at timestamptz,
  add column reconciliation_state text not null default 'unreviewed',
  add constraint punch_events_reconciliation_state_check
    check (reconciliation_state in ('unreviewed', 'accepted', 'corrected', 'voided', 'unresolved'));

update public.punch_events
set
  effective_recorded_at = recorded_at,
  reconciliation_state = case
    when registration_id is null then 'unresolved'
    else 'accepted'
  end;

alter table public.punch_events
  alter column effective_recorded_at set not null;

create or replace function public.initialize_punch_reconciliation_projection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.effective_recorded_at := coalesce(new.effective_recorded_at, new.recorded_at);
  if new.is_voided then
    new.reconciliation_state := 'voided';
  elsif new.registration_id is null then
    new.reconciliation_state := 'unresolved';
  elsif new.reconciliation_state = 'unreviewed' then
    new.reconciliation_state := 'accepted';
  end if;
  return new;
end;
$$;

create trigger punch_events_initialize_reconciliation
before insert on public.punch_events
for each row execute function public.initialize_punch_reconciliation_projection();

alter table public.punch_event_revisions
  add column client_event_id uuid,
  add column previous_json jsonb not null default '{}'::jsonb,
  add column effective_json jsonb not null default '{}'::jsonb;

create unique index punch_event_revisions_client_event_uidx
  on public.punch_event_revisions (client_event_id)
  where client_event_id is not null;

alter table public.result_runs
  add column engine_version text,
  add column input_digest text,
  add column start_event_id uuid references public.race_start_events (id) on delete restrict,
  add constraint result_runs_input_digest_check
    check (input_digest is null or input_digest ~ '^[a-f0-9]{64}$');

create table public.result_anomalies (
  id uuid primary key default gen_random_uuid(),
  result_run_id uuid not null references public.result_runs (id) on delete cascade,
  event_category_id uuid not null references public.event_categories (id) on delete cascade,
  registration_id uuid references public.registrations (id) on delete cascade,
  punch_event_id uuid references public.punch_events (id) on delete cascade,
  anomaly_code text not null,
  severity text not null,
  state text not null default 'open',
  message text not null,
  evidence_json jsonb not null default '{}'::jsonb,
  resolution_note text,
  resolved_by_user_id uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (severity in ('info', 'warning', 'error', 'critical')),
  check (state in ('open', 'resolved', 'waived')),
  check (jsonb_typeof(evidence_json) = 'object'),
  check (
    (state = 'open' and resolved_at is null)
    or (state in ('resolved', 'waived') and resolved_at is not null)
  )
);

create index result_anomalies_run_state_idx
  on public.result_anomalies (result_run_id, state, severity);
create index result_anomalies_registration_idx
  on public.result_anomalies (registration_id, created_at desc)
  where registration_id is not null;

create or replace function public.service_revise_punch_event(
  p_punch_event_id uuid,
  p_actor_user_id uuid,
  p_revision_type text,
  p_reason text,
  p_registration_id uuid,
  p_effective_recorded_at timestamptz,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  punch_row public.punch_events%rowtype;
  registration_row public.registrations%rowtype;
  operational_control public.edition_operational_controls%rowtype;
  existing_revision public.punch_event_revisions%rowtype;
  created_revision public.punch_event_revisions%rowtype;
  edition_id uuid;
  resolved_bib text;
begin
  if p_revision_type not in ('resolve_registration', 'correct_time', 'void', 'restore')
     or nullif(trim(p_reason), '') is null
     or p_client_event_id is null
     or (p_revision_type = 'resolve_registration' and p_registration_id is null)
     or (p_revision_type = 'correct_time' and p_effective_recorded_at is null) then
    raise exception using errcode = '22023', message = 'punch_revision_input_invalid';
  end if;

  select revision.*
  into existing_revision
  from public.punch_event_revisions revision
  where revision.client_event_id = p_client_event_id;
  if found then
    if existing_revision.punch_event_id <> p_punch_event_id
       or existing_revision.revision_type <> p_revision_type then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'revisionId', existing_revision.id,
      'punchEventId', existing_revision.punch_event_id,
      'revisionType', existing_revision.revision_type,
      'replayed', true
    );
  end if;

  select punch.*
  into punch_row
  from public.punch_events punch
  where punch.id = p_punch_event_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'punch_event_not_found';
  end if;

  select category.event_edition_id
  into edition_id
  from public.event_categories category
  where category.id = punch_row.event_category_id;

  if p_revision_type = 'resolve_registration' then
    select registration.*
    into registration_row
    from public.registrations registration
    where registration.id = p_registration_id
      and registration.event_category_id = punch_row.event_category_id
      and registration.status = 'confirmed';
    if not found then
      raise exception using errcode = 'P0001', message = 'punch_registration_invalid';
    end if;

    select control.*
    into operational_control
    from public.edition_operational_controls control
    where control.event_edition_id = edition_id;
    if operational_control.current_manifest_id is null
       or not exists (
         select 1
         from public.start_list_manifest_entries manifest_entry
         where manifest_entry.manifest_id = operational_control.current_manifest_id
           and manifest_entry.registration_id = registration_row.id
       ) then
      raise exception using errcode = 'P0001', message = 'punch_registration_not_in_manifest';
    end if;

    select assignment.bib_number
    into resolved_bib
    from public.bib_assignments assignment
    where assignment.registration_id = registration_row.id
      and assignment.revoked_at is null
    order by assignment.assigned_at desc
    limit 1;
  end if;

  insert into public.punch_event_revisions (
    punch_event_id,
    revision_type,
    reason,
    created_by_user_id,
    client_event_id,
    payload_json,
    previous_json,
    effective_json
  )
  values (
    punch_row.id,
    p_revision_type,
    trim(p_reason),
    p_actor_user_id,
    p_client_event_id,
    jsonb_build_object(
      'registrationId', p_registration_id,
      'effectiveRecordedAt', p_effective_recorded_at
    ),
    jsonb_build_object(
      'registrationId', punch_row.registration_id,
      'athleteProfileId', punch_row.athlete_profile_id,
      'bibNumber', punch_row.bib_number,
      'effectiveRecordedAt', punch_row.effective_recorded_at,
      'isVoided', punch_row.is_voided,
      'reconciliationState', punch_row.reconciliation_state
    ),
    case
      when p_revision_type = 'resolve_registration' then jsonb_build_object(
        'registrationId', registration_row.id,
        'athleteProfileId', registration_row.athlete_profile_id,
        'bibNumber', resolved_bib,
        'effectiveRecordedAt', punch_row.effective_recorded_at,
        'isVoided', punch_row.is_voided,
        'reconciliationState', 'corrected'
      )
      when p_revision_type = 'correct_time' then jsonb_build_object(
        'registrationId', punch_row.registration_id,
        'athleteProfileId', punch_row.athlete_profile_id,
        'bibNumber', punch_row.bib_number,
        'effectiveRecordedAt', p_effective_recorded_at,
        'isVoided', punch_row.is_voided,
        'reconciliationState', 'corrected'
      )
      when p_revision_type = 'void' then jsonb_build_object(
        'registrationId', punch_row.registration_id,
        'effectiveRecordedAt', punch_row.effective_recorded_at,
        'isVoided', true,
        'reconciliationState', 'voided'
      )
      else jsonb_build_object(
        'registrationId', punch_row.registration_id,
        'effectiveRecordedAt', punch_row.effective_recorded_at,
        'isVoided', false,
        'reconciliationState', case when punch_row.registration_id is null then 'unresolved' else 'corrected' end
      )
    end
  )
  returning * into created_revision;

  update public.punch_events
  set
    registration_id = case
      when p_revision_type = 'resolve_registration' then registration_row.id
      else registration_id
    end,
    athlete_profile_id = case
      when p_revision_type = 'resolve_registration' then registration_row.athlete_profile_id
      else athlete_profile_id
    end,
    bib_number = case
      when p_revision_type = 'resolve_registration' then coalesce(resolved_bib, bib_number)
      else bib_number
    end,
    effective_recorded_at = case
      when p_revision_type = 'correct_time' then p_effective_recorded_at
      else effective_recorded_at
    end,
    is_voided = case
      when p_revision_type = 'void' then true
      when p_revision_type = 'restore' then false
      else is_voided
    end,
    reconciliation_state = case
      when p_revision_type = 'void' then 'voided'
      when p_revision_type = 'restore' and registration_id is null then 'unresolved'
      else 'corrected'
    end
  where id = punch_row.id
  returning * into punch_row;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  select
    series.organization_id,
    p_actor_user_id,
    'punch_event_revision',
    created_revision.id,
    'timing.punch_' || p_revision_type,
    jsonb_build_object('punchEventId', punch_row.id, 'reason', trim(p_reason))
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = edition_id;

  return jsonb_build_object(
    'revisionId', created_revision.id,
    'punchEventId', punch_row.id,
    'revisionType', created_revision.revision_type,
    'registrationId', punch_row.registration_id,
    'bibNumber', punch_row.bib_number,
    'effectiveRecordedAt', punch_row.effective_recorded_at,
    'isVoided', punch_row.is_voided,
    'reconciliationState', punch_row.reconciliation_state,
    'replayed', false
  );
end;
$$;

create or replace function public.service_resolve_result_anomaly(
  p_anomaly_id uuid,
  p_actor_user_id uuid,
  p_resolution_state text,
  p_resolution_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  anomaly_row public.result_anomalies%rowtype;
begin
  if p_resolution_state not in ('resolved', 'waived')
     or nullif(trim(p_resolution_note), '') is null then
    raise exception using errcode = '22023', message = 'result_anomaly_resolution_invalid';
  end if;

  update public.result_anomalies
  set
    state = p_resolution_state,
    resolution_note = trim(p_resolution_note),
    resolved_by_user_id = p_actor_user_id,
    resolved_at = now()
  where id = p_anomaly_id
    and state = 'open'
  returning * into anomaly_row;

  if not found then
    select anomaly.*
    into anomaly_row
    from public.result_anomalies anomaly
    where anomaly.id = p_anomaly_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'result_anomaly_not_found';
    end if;
  end if;

  return jsonb_build_object(
    'id', anomaly_row.id,
    'state', anomaly_row.state,
    'resolutionNote', anomaly_row.resolution_note,
    'resolvedAt', anomaly_row.resolved_at
  );
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
begin
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
    from public.registrations registration
    where registration.event_category_id = p_event_category_id
      and registration.status = 'confirmed'
      and registration.participation_status in (
        'not_started', 'checked_in', 'started', 'stopped', 'missing'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'field_accounting_incomplete';
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

alter table public.result_anomalies enable row level security;

revoke all on table public.result_anomalies from public, anon, authenticated;
grant all on table public.result_anomalies to service_role;

revoke all on function public.service_revise_punch_event(
  uuid, uuid, text, text, uuid, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.service_resolve_result_anomaly(
  uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.service_publish_result_run_guarded(
  uuid, uuid, public.publication_state, uuid, text
) from public, anon, authenticated;

grant execute on function public.service_revise_punch_event(
  uuid, uuid, text, text, uuid, timestamptz, uuid
) to service_role;
grant execute on function public.service_resolve_result_anomaly(
  uuid, uuid, text, text
) to service_role;
grant execute on function public.service_publish_result_run_guarded(
  uuid, uuid, public.publication_state, uuid, text
) to service_role;
