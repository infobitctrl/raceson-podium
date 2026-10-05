alter type public.participation_status add value if not exists 'withdrawn';
alter type public.participation_status add value if not exists 'stopped';
alter type public.participation_status add value if not exists 'evacuated';
alter type public.participation_status add value if not exists 'missing';

create table public.race_start_events (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  event_category_id uuid not null references public.event_categories (id) on delete cascade,
  event_type text not null,
  planned_at timestamptz,
  occurred_at timestamptz not null,
  start_method text,
  reason text,
  source text not null default 'operator',
  client_event_id uuid not null unique,
  sequence_number integer not null,
  supersedes_start_event_id uuid references public.race_start_events (id) on delete restrict,
  start_list_manifest_id uuid references public.start_list_manifests (id) on delete restrict,
  timing_plan_id uuid references public.timing_plan_versions (id) on delete restrict,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  unique (event_category_id, sequence_number),
  check (event_type in ('actual_start', 'restart', 'delay', 'cancelled', 'abandoned')),
  check (
    start_method is null
    or start_method in ('mass_gun', 'chip', 'rolling', 'individual_interval', 'manual_import', 'neutralized')
  ),
  check (
    event_type in ('actual_start', 'restart')
    or nullif(trim(reason), '') is not null
  ),
  check (
    event_type not in ('actual_start', 'restart')
    or start_method is not null
  )
);

create index race_start_events_category_time_idx
  on public.race_start_events (event_category_id, occurred_at desc, sequence_number desc);

alter table public.participant_statuses
  add column client_event_id uuid,
  add column supersedes_status_id uuid references public.participant_statuses (id) on delete restrict,
  add column source text not null default 'operator',
  add column metadata_json jsonb not null default '{}'::jsonb;

create unique index participant_statuses_client_event_uidx
  on public.participant_statuses (client_event_id)
  where client_event_id is not null;

create or replace function public.service_record_race_start_event(
  p_event_category_id uuid,
  p_actor_user_id uuid,
  p_event_type text,
  p_occurred_at timestamptz,
  p_planned_at timestamptz,
  p_start_method text,
  p_reason text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_row public.event_categories%rowtype;
  control_row public.edition_operational_controls%rowtype;
  previous_start public.race_start_events%rowtype;
  existing_event public.race_start_events%rowtype;
  created_event public.race_start_events%rowtype;
  next_sequence integer;
  started_count integer := 0;
begin
  if p_event_type not in ('actual_start', 'restart', 'delay', 'cancelled', 'abandoned')
     or p_occurred_at is null
     or p_client_event_id is null
     or (
       p_event_type in ('actual_start', 'restart')
       and p_start_method not in ('mass_gun', 'chip', 'rolling', 'individual_interval', 'manual_import', 'neutralized')
     )
     or (
       p_event_type in ('restart', 'delay', 'cancelled', 'abandoned')
       and nullif(trim(p_reason), '') is null
     ) then
    raise exception using errcode = '22023', message = 'race_start_event_input_invalid';
  end if;
  if p_occurred_at > now() + interval '10 minutes' then
    raise exception using errcode = '22023', message = 'race_start_event_future_time_invalid';
  end if;

  select event.*
  into existing_event
  from public.race_start_events event
  where event.client_event_id = p_client_event_id;
  if found then
    if existing_event.event_category_id <> p_event_category_id
       or existing_event.event_type <> p_event_type
       or existing_event.occurred_at <> p_occurred_at then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_event.id,
      'eventCategoryId', existing_event.event_category_id,
      'eventType', existing_event.event_type,
      'occurredAt', existing_event.occurred_at,
      'startMethod', existing_event.start_method,
      'sequenceNumber', existing_event.sequence_number,
      'startedParticipantCount', 0,
      'replayed', true
    );
  end if;

  select category.*
  into category_row
  from public.event_categories category
  where category.id = p_event_category_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;

  select control.*
  into control_row
  from public.edition_operational_controls control
  where control.event_edition_id = category_row.event_edition_id
  for update;

  select event.*
  into previous_start
  from public.race_start_events event
  where event.event_category_id = p_event_category_id
    and event.event_type in ('actual_start', 'restart')
  order by event.sequence_number desc
  limit 1;

  if p_event_type in ('actual_start', 'restart') then
    if control_row.start_list_state <> 'frozen'
       or control_row.current_manifest_id is null
       or control_row.timing_readiness_state <> 'ready'
       or control_row.current_timing_plan_id is null then
      raise exception using errcode = 'P0001', message = 'race_start_readiness_blocked';
    end if;
    if p_event_type = 'actual_start' and previous_start.id is not null then
      raise exception using errcode = 'P0001', message = 'race_already_started';
    end if;
    if p_event_type = 'restart' and previous_start.id is null then
      raise exception using errcode = 'P0001', message = 'race_restart_requires_start';
    end if;
  elsif p_event_type = 'cancelled' and previous_start.id is not null then
    raise exception using errcode = 'P0001', message = 'started_race_cannot_cancel';
  elsif p_event_type = 'abandoned' and previous_start.id is null then
    raise exception using errcode = 'P0001', message = 'race_abandon_requires_start';
  end if;

  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.race_start_events event
  where event.event_category_id = p_event_category_id;

  insert into public.race_start_events (
    event_edition_id,
    event_category_id,
    event_type,
    planned_at,
    occurred_at,
    start_method,
    reason,
    client_event_id,
    sequence_number,
    supersedes_start_event_id,
    start_list_manifest_id,
    timing_plan_id,
    created_by_user_id
  )
  values (
    category_row.event_edition_id,
    category_row.id,
    p_event_type,
    p_planned_at,
    p_occurred_at,
    p_start_method,
    nullif(trim(p_reason), ''),
    p_client_event_id,
    next_sequence,
    case when p_event_type = 'restart' then previous_start.id else null end,
    control_row.current_manifest_id,
    control_row.current_timing_plan_id,
    p_actor_user_id
  )
  returning * into created_event;

  if p_event_type = 'delay' and p_planned_at is not null then
    update public.event_categories
    set start_at = p_planned_at
    where id = category_row.id;
  elsif p_event_type in ('actual_start', 'restart') then
    if p_event_type = 'actual_start' then
      with starters as (
        select registration.id
        from public.start_list_manifest_entries manifest_entry
        join public.registrations registration on registration.id = manifest_entry.registration_id
        where manifest_entry.manifest_id = control_row.current_manifest_id
          and manifest_entry.event_category_id = category_row.id
          and registration.status = 'confirmed'
          and registration.participation_status = 'checked_in'
      ),
      inserted_statuses as (
        insert into public.participant_statuses (
          registration_id,
          status,
          effective_at,
          reason,
          created_by_user_id,
          client_event_id,
          source,
          metadata_json
        )
        select
          starter.id,
          'started',
          p_occurred_at,
          'race_actual_start',
          p_actor_user_id,
          gen_random_uuid(),
          'race_start',
          jsonb_build_object('raceStartEventId', created_event.id)
        from starters starter
        returning registration_id
      )
      update public.registrations registration
      set participation_status = 'started'
      where registration.id in (select inserted_statuses.registration_id from inserted_statuses);
      get diagnostics started_count = row_count;
    end if;

    update public.event_categories
    set status = 'in_progress'
    where id = category_row.id;
    update public.event_editions
    set status = 'in_progress'
    where id = category_row.event_edition_id
      and status <> 'in_progress';
  elsif p_event_type = 'cancelled' then
    update public.event_categories set status = 'closed' where id = category_row.id;
  elsif p_event_type = 'abandoned' then
    update public.event_categories set status = 'closed' where id = category_row.id;
  end if;

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
    'race_start_event',
    created_event.id,
    'race.' || p_event_type,
    jsonb_build_object(
      'eventCategoryId', category_row.id,
      'occurredAt', p_occurred_at,
      'startedParticipantCount', started_count,
      'reason', nullif(trim(p_reason), '')
    )
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = category_row.event_edition_id;

  return jsonb_build_object(
    'id', created_event.id,
    'eventCategoryId', created_event.event_category_id,
    'eventType', created_event.event_type,
    'occurredAt', created_event.occurred_at,
    'plannedAt', created_event.planned_at,
    'startMethod', created_event.start_method,
    'reason', created_event.reason,
    'sequenceNumber', created_event.sequence_number,
    'startedParticipantCount', started_count,
    'replayed', false
  );
end;
$$;

create or replace function public.service_record_participant_status(
  p_registration_id uuid,
  p_actor_user_id uuid,
  p_status text,
  p_effective_at timestamptz,
  p_reason text,
  p_client_event_id uuid,
  p_is_correction boolean,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  registration_row public.registrations%rowtype;
  existing_status public.participant_statuses%rowtype;
  previous_status public.participant_statuses%rowtype;
  created_status public.participant_statuses%rowtype;
  allowed_transition boolean := false;
begin
  if p_status not in (
    'not_started', 'checked_in', 'dns', 'started', 'finished', 'dnf', 'dsq',
    'withdrawn', 'stopped', 'evacuated', 'missing'
  )
     or p_effective_at is null
     or p_client_event_id is null
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
     or (
       (p_status in ('dns', 'dnf', 'dsq', 'withdrawn', 'stopped', 'evacuated', 'missing') or p_is_correction)
       and nullif(trim(p_reason), '') is null
     ) then
    raise exception using errcode = '22023', message = 'participant_status_input_invalid';
  end if;
  if p_effective_at > now() + interval '10 minutes' then
    raise exception using errcode = '22023', message = 'participant_status_future_time_invalid';
  end if;

  select status_event.*
  into existing_status
  from public.participant_statuses status_event
  where status_event.client_event_id = p_client_event_id;
  if found then
    if existing_status.registration_id <> p_registration_id
       or existing_status.status::text <> p_status
       or existing_status.effective_at <> p_effective_at then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_status.id,
      'registrationId', existing_status.registration_id,
      'status', existing_status.status,
      'effectiveAt', existing_status.effective_at,
      'replayed', true
    );
  end if;

  select registration.*
  into registration_row
  from public.registrations registration
  where registration.id = p_registration_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'registration_not_found';
  end if;
  if registration_row.status <> 'confirmed' then
    raise exception using errcode = 'P0001', message = 'participant_registration_not_confirmed';
  end if;

  select status_event.*
  into previous_status
  from public.participant_statuses status_event
  where status_event.registration_id = p_registration_id
  order by status_event.effective_at desc, status_event.created_at desc
  limit 1;

  allowed_transition := p_is_correction
    or registration_row.participation_status::text = p_status
    or (
      registration_row.participation_status = 'not_started'
      and p_status in ('checked_in', 'dns', 'withdrawn')
    )
    or (
      registration_row.participation_status = 'checked_in'
      and p_status in ('started', 'dns', 'withdrawn')
    )
    or (
      registration_row.participation_status = 'started'
      and p_status in ('finished', 'dnf', 'dsq', 'stopped', 'evacuated', 'missing')
    )
    or (
      registration_row.participation_status = 'missing'
      and p_status in ('started', 'finished', 'dnf', 'evacuated')
    )
    or (
      registration_row.participation_status = 'stopped'
      and p_status in ('dnf', 'evacuated', 'started')
    )
    or (
      registration_row.participation_status = 'finished'
      and p_status = 'dsq'
    );

  if not allowed_transition then
    raise exception using
      errcode = 'P0001',
      message = 'participant_status_transition_invalid',
      detail = registration_row.participation_status::text || ' -> ' || p_status;
  end if;

  insert into public.participant_statuses (
    registration_id,
    status,
    effective_at,
    reason,
    created_by_user_id,
    client_event_id,
    supersedes_status_id,
    source,
    metadata_json
  )
  values (
    p_registration_id,
    p_status::public.participation_status,
    p_effective_at,
    nullif(trim(p_reason), ''),
    p_actor_user_id,
    p_client_event_id,
    case when p_is_correction then previous_status.id else null end,
    case when p_is_correction then 'operator_correction' else 'operator' end,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into created_status;

  update public.registrations
  set participation_status = p_status::public.participation_status
  where id = p_registration_id;

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
    'participant_status',
    created_status.id,
    case when p_is_correction then 'participant.status_corrected' else 'participant.status_changed' end,
    jsonb_build_object(
      'registrationId', p_registration_id,
      'fromStatus', registration_row.participation_status,
      'toStatus', p_status,
      'effectiveAt', p_effective_at,
      'reason', nullif(trim(p_reason), '')
    )
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = registration_row.event_category_id;

  return jsonb_build_object(
    'id', created_status.id,
    'registrationId', created_status.registration_id,
    'status', created_status.status,
    'effectiveAt', created_status.effective_at,
    'reason', created_status.reason,
    'isCorrection', p_is_correction,
    'replayed', false
  );
end;
$$;

create or replace function public.project_resolved_punch_participant_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  checkpoint_kind text;
  current_status public.participation_status;
  projected_status public.participation_status;
begin
  if new.registration_id is null or new.is_voided then
    return new;
  end if;

  select checkpoint.checkpoint_type::text
  into checkpoint_kind
  from public.checkpoints checkpoint
  where checkpoint.id = new.checkpoint_id;

  select registration.participation_status
  into current_status
  from public.registrations registration
  where registration.id = new.registration_id
  for update;

  if checkpoint_kind = 'start' and current_status in ('not_started', 'checked_in') then
    projected_status := 'started';
  elsif checkpoint_kind = 'finish' and current_status in ('started', 'missing', 'stopped') then
    projected_status := 'finished';
  else
    return new;
  end if;

  insert into public.participant_statuses (
    registration_id,
    status,
    effective_at,
    reason,
    created_by_user_id,
    client_event_id,
    source,
    metadata_json
  )
  values (
    new.registration_id,
    projected_status,
    new.recorded_at,
    'timing_punch',
    new.entered_by_user_id,
    gen_random_uuid(),
    'timing',
    jsonb_build_object('punchEventId', new.id, 'checkpointId', new.checkpoint_id)
  );

  update public.registrations
  set participation_status = projected_status
  where id = new.registration_id;

  return new;
end;
$$;

create trigger punch_events_project_participant_status
after insert on public.punch_events
for each row execute function public.project_resolved_punch_participant_status();

alter table public.race_start_events enable row level security;

revoke all on table public.race_start_events from public, anon, authenticated;
grant all on table public.race_start_events to service_role;

revoke all on function public.service_record_race_start_event(
  uuid, uuid, text, timestamptz, timestamptz, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_record_participant_status(
  uuid, uuid, text, timestamptz, text, uuid, boolean, jsonb
) from public, anon, authenticated;

grant execute on function public.service_record_race_start_event(
  uuid, uuid, text, timestamptz, timestamptz, text, text, uuid
) to service_role;
grant execute on function public.service_record_participant_status(
  uuid, uuid, text, timestamptz, text, uuid, boolean, jsonb
) to service_role;
