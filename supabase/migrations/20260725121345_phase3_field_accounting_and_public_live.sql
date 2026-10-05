alter table public.participant_statuses
  add column sequence_number integer;

with ranked_statuses as (
  select
    status_event.id,
    row_number() over (
      partition by status_event.registration_id
      order by status_event.effective_at, status_event.created_at, status_event.id
    )::integer as sequence_number
  from public.participant_statuses status_event
)
update public.participant_statuses status_event
set sequence_number = ranked_statuses.sequence_number
from ranked_statuses
where ranked_statuses.id = status_event.id;

alter table public.participant_statuses
  alter column sequence_number set not null;

create unique index participant_statuses_registration_sequence_uidx
  on public.participant_statuses (registration_id, sequence_number);

create or replace function public.assign_participant_status_sequence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.registration_id::text, 0));
  select coalesce(max(status_event.sequence_number), 0) + 1
  into new.sequence_number
  from public.participant_statuses status_event
  where status_event.registration_id = new.registration_id;
  new.created_at := clock_timestamp();
  return new;
end;
$$;

create trigger participant_statuses_assign_sequence
before insert on public.participant_statuses
for each row execute function public.assign_participant_status_sequence();

create table public.cutoff_actions (
  id uuid primary key default gen_random_uuid(),
  event_category_id uuid not null references public.event_categories (id) on delete cascade,
  checkpoint_id uuid not null references public.checkpoints (id) on delete restrict,
  registration_id uuid not null references public.registrations (id) on delete cascade,
  action_type text not null,
  effective_at timestamptz not null,
  grace_until timestamptz,
  reason_code text,
  note text,
  communicated_by_user_id uuid,
  participant_acknowledged boolean not null default false,
  transport_plan text,
  client_event_id uuid not null unique,
  supersedes_action_id uuid references public.cutoff_actions (id) on delete restrict,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  check (action_type in ('warning', 'grace', 'stopped', 'acknowledged', 'transport_arranged')),
  check (jsonb_typeof(jsonb_build_object('ok', true)) = 'object'),
  check (
    (action_type = 'grace' and grace_until is not null and grace_until > effective_at)
    or (action_type <> 'grace' and grace_until is null)
  ),
  check (
    action_type not in ('grace', 'stopped', 'transport_arranged')
    or nullif(trim(coalesce(note, '')), '') is not null
  )
);

create index cutoff_actions_checkpoint_time_idx
  on public.cutoff_actions (checkpoint_id, effective_at desc, created_at desc);
create index cutoff_actions_registration_time_idx
  on public.cutoff_actions (registration_id, effective_at desc, created_at desc);

create table public.checkpoint_operation_events (
  id uuid primary key default gen_random_uuid(),
  event_category_id uuid not null references public.event_categories (id) on delete cascade,
  checkpoint_id uuid not null references public.checkpoints (id) on delete cascade,
  operation_state text not null,
  effective_at timestamptz not null,
  sequence_number integer not null,
  reason text,
  unresolved_package_json jsonb not null default '{}'::jsonb,
  client_event_id uuid not null unique,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  unique (checkpoint_id, sequence_number),
  check (operation_state in ('open', 'ready', 'degraded', 'closing', 'closed', 'reconciled')),
  check (jsonb_typeof(unresolved_package_json) = 'object'),
  check (
    operation_state not in ('degraded', 'closed')
    or nullif(trim(coalesce(reason, '')), '') is not null
  )
);

create index checkpoint_operation_events_category_state_idx
  on public.checkpoint_operation_events (event_category_id, checkpoint_id, sequence_number desc);

create table public.field_accounting_signoffs (
  id uuid primary key default gen_random_uuid(),
  event_category_id uuid not null references public.event_categories (id) on delete cascade,
  signoff_state text not null,
  signed_at timestamptz not null,
  signed_by_user_id uuid,
  note text,
  sequence_number integer not null,
  snapshot_json jsonb not null,
  client_event_id uuid not null unique,
  supersedes_signoff_id uuid references public.field_accounting_signoffs (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (event_category_id, sequence_number),
  check (signoff_state in ('ready_for_results', 'closed_with_open_missing')),
  check (jsonb_typeof(snapshot_json) = 'object'),
  check (
    signoff_state <> 'closed_with_open_missing'
    or nullif(trim(coalesce(note, '')), '') is not null
  )
);

create index field_accounting_signoffs_category_time_idx
  on public.field_accounting_signoffs (event_category_id, signed_at desc, sequence_number desc);

create table public.public_live_settings (
  event_category_id uuid primary key references public.event_categories (id) on delete cascade,
  is_enabled boolean not null default false,
  delay_seconds integer not null default 60,
  is_suppressed boolean not null default false,
  suppression_message text,
  show_checkpoint_aggregates boolean not null default true,
  updated_by_user_id uuid,
  updated_at timestamptz not null default now(),
  check (delay_seconds between 0 and 3600),
  check (
    not is_suppressed
    or nullif(trim(coalesce(suppression_message, '')), '') is not null
  )
);

create or replace function public.service_record_cutoff_action(
  p_event_category_id uuid,
  p_checkpoint_id uuid,
  p_registration_id uuid,
  p_actor_user_id uuid,
  p_action_type text,
  p_effective_at timestamptz,
  p_grace_until timestamptz,
  p_reason_code text,
  p_note text,
  p_participant_acknowledged boolean,
  p_transport_plan text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  checkpoint_row public.checkpoints%rowtype;
  registration_row public.registrations%rowtype;
  existing_action public.cutoff_actions%rowtype;
  previous_action public.cutoff_actions%rowtype;
  created_action public.cutoff_actions%rowtype;
  previous_status public.participant_statuses%rowtype;
  created_status_id uuid;
  organization_id uuid;
begin
  if p_action_type not in ('warning', 'grace', 'stopped', 'acknowledged', 'transport_arranged')
     or p_effective_at is null
     or p_client_event_id is null
     or p_effective_at > now() + interval '10 minutes'
     or (
       p_action_type = 'grace'
       and (p_grace_until is null or p_grace_until <= p_effective_at or nullif(trim(p_note), '') is null)
     )
     or (
       p_action_type in ('stopped', 'transport_arranged')
       and nullif(trim(p_note), '') is null
     ) then
    raise exception using errcode = '22023', message = 'cutoff_action_input_invalid';
  end if;

  select action.*
  into existing_action
  from public.cutoff_actions action
  where action.client_event_id = p_client_event_id;
  if found then
    if existing_action.event_category_id <> p_event_category_id
       or existing_action.checkpoint_id <> p_checkpoint_id
       or existing_action.registration_id <> p_registration_id
       or existing_action.action_type <> p_action_type then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_action.id,
      'actionType', existing_action.action_type,
      'registrationId', existing_action.registration_id,
      'replayed', true
    );
  end if;

  select checkpoint.*
  into checkpoint_row
  from public.checkpoints checkpoint
  where checkpoint.id = p_checkpoint_id
    and checkpoint.event_category_id = p_event_category_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'cutoff_checkpoint_not_found';
  end if;
  if checkpoint_row.cutoff_at is null then
    raise exception using errcode = 'P0001', message = 'checkpoint_has_no_cutoff';
  end if;

  select registration.*
  into registration_row
  from public.registrations registration
  where registration.id = p_registration_id
    and registration.event_category_id = p_event_category_id
    and registration.status = 'confirmed'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'cutoff_registration_not_found';
  end if;

  if p_action_type = 'stopped'
     and registration_row.participation_status not in ('started', 'missing') then
    raise exception using
      errcode = 'P0001',
      message = 'cutoff_stop_status_invalid',
      detail = registration_row.participation_status::text;
  end if;

  select action.*
  into previous_action
  from public.cutoff_actions action
  where action.checkpoint_id = p_checkpoint_id
    and action.registration_id = p_registration_id
  order by action.effective_at desc, action.created_at desc
  limit 1;

  insert into public.cutoff_actions (
    event_category_id,
    checkpoint_id,
    registration_id,
    action_type,
    effective_at,
    grace_until,
    reason_code,
    note,
    communicated_by_user_id,
    participant_acknowledged,
    transport_plan,
    client_event_id,
    supersedes_action_id,
    created_by_user_id
  )
  values (
    p_event_category_id,
    p_checkpoint_id,
    p_registration_id,
    p_action_type,
    p_effective_at,
    case when p_action_type = 'grace' then p_grace_until else null end,
    nullif(trim(p_reason_code), ''),
    nullif(trim(p_note), ''),
    p_actor_user_id,
    coalesce(p_participant_acknowledged, false) or p_action_type = 'acknowledged',
    nullif(trim(p_transport_plan), ''),
    p_client_event_id,
    previous_action.id,
    p_actor_user_id
  )
  returning * into created_action;

  if p_action_type = 'stopped' then
    select status_event.*
    into previous_status
    from public.participant_statuses status_event
    where status_event.registration_id = p_registration_id
    order by status_event.effective_at desc, status_event.created_at desc
    limit 1;

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
      'stopped',
      p_effective_at,
      coalesce(nullif(trim(p_note), ''), 'stopped_by_cutoff'),
      p_actor_user_id,
      gen_random_uuid(),
      previous_status.id,
      'cutoff',
      jsonb_build_object(
        'cutoffActionId', created_action.id,
        'checkpointId', p_checkpoint_id,
        'reasonCode', nullif(trim(p_reason_code), ''),
        'transportPlan', nullif(trim(p_transport_plan), '')
      )
    )
    returning id into created_status_id;

    update public.registrations
    set participation_status = 'stopped'
    where id = p_registration_id;
  end if;

  select series.organization_id
  into organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = p_event_category_id;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    organization_id,
    p_actor_user_id,
    'cutoff_action',
    created_action.id,
    'race.cutoff_' || p_action_type,
    jsonb_build_object(
      'registrationId', p_registration_id,
      'checkpointId', p_checkpoint_id,
      'participantStatusId', created_status_id
    )
  );

  return jsonb_build_object(
    'id', created_action.id,
    'actionType', created_action.action_type,
    'registrationId', created_action.registration_id,
    'checkpointId', created_action.checkpoint_id,
    'effectiveAt', created_action.effective_at,
    'graceUntil', created_action.grace_until,
    'participantAcknowledged', created_action.participant_acknowledged,
    'participantStatusId', created_status_id,
    'replayed', false
  );
end;
$$;

create or replace function public.service_record_checkpoint_operation(
  p_checkpoint_id uuid,
  p_actor_user_id uuid,
  p_operation_state text,
  p_effective_at timestamptz,
  p_reason text,
  p_unresolved_package_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  checkpoint_row public.checkpoints%rowtype;
  existing_event public.checkpoint_operation_events%rowtype;
  created_event public.checkpoint_operation_events%rowtype;
  next_sequence integer;
  organization_id uuid;
begin
  if p_operation_state not in ('open', 'ready', 'degraded', 'closing', 'closed', 'reconciled')
     or p_effective_at is null
     or p_client_event_id is null
     or coalesce(jsonb_typeof(p_unresolved_package_json), 'object') <> 'object'
     or (
       p_operation_state in ('degraded', 'closed')
       and nullif(trim(p_reason), '') is null
     ) then
    raise exception using errcode = '22023', message = 'checkpoint_operation_input_invalid';
  end if;

  select operation_event.*
  into existing_event
  from public.checkpoint_operation_events operation_event
  where operation_event.client_event_id = p_client_event_id;
  if found then
    if existing_event.checkpoint_id <> p_checkpoint_id
       or existing_event.operation_state <> p_operation_state then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_event.id,
      'operationState', existing_event.operation_state,
      'sequenceNumber', existing_event.sequence_number,
      'replayed', true
    );
  end if;

  select checkpoint.*
  into checkpoint_row
  from public.checkpoints checkpoint
  where checkpoint.id = p_checkpoint_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'checkpoint_not_found';
  end if;

  if p_operation_state in ('closed', 'reconciled') and exists (
    select 1
    from public.timing_sessions timing_session
    where timing_session.checkpoint_id = checkpoint_row.id
      and timing_session.status <> 'closed'
  ) then
    raise exception using errcode = 'P0001', message = 'checkpoint_timing_sessions_open';
  end if;
  if p_operation_state in ('closed', 'reconciled') and exists (
    select 1
    from public.punch_events punch
    where punch.checkpoint_id = checkpoint_row.id
      and not punch.is_voided
      and punch.registration_id is null
  ) then
    raise exception using errcode = 'P0001', message = 'checkpoint_unresolved_punches_open';
  end if;

  select coalesce(max(operation_event.sequence_number), 0) + 1
  into next_sequence
  from public.checkpoint_operation_events operation_event
  where operation_event.checkpoint_id = checkpoint_row.id;

  insert into public.checkpoint_operation_events (
    event_category_id,
    checkpoint_id,
    operation_state,
    effective_at,
    sequence_number,
    reason,
    unresolved_package_json,
    client_event_id,
    created_by_user_id
  )
  values (
    checkpoint_row.event_category_id,
    checkpoint_row.id,
    p_operation_state,
    p_effective_at,
    next_sequence,
    nullif(trim(p_reason), ''),
    coalesce(p_unresolved_package_json, '{}'::jsonb),
    p_client_event_id,
    p_actor_user_id
  )
  returning * into created_event;

  select series.organization_id
  into organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = checkpoint_row.event_category_id;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    organization_id,
    p_actor_user_id,
    'checkpoint_operation_event',
    created_event.id,
    'race.checkpoint_' || p_operation_state,
    jsonb_build_object('checkpointId', checkpoint_row.id, 'sequenceNumber', next_sequence)
  );

  return jsonb_build_object(
    'id', created_event.id,
    'checkpointId', created_event.checkpoint_id,
    'operationState', created_event.operation_state,
    'effectiveAt', created_event.effective_at,
    'sequenceNumber', created_event.sequence_number,
    'replayed', false
  );
end;
$$;

create or replace function public.service_signoff_field_accounting(
  p_event_category_id uuid,
  p_actor_user_id uuid,
  p_allow_open_missing boolean,
  p_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_row public.event_categories%rowtype;
  existing_signoff public.field_accounting_signoffs%rowtype;
  previous_signoff public.field_accounting_signoffs%rowtype;
  created_signoff public.field_accounting_signoffs%rowtype;
  unresolved_count integer;
  missing_count integer;
  confirmed_count integer;
  next_sequence integer;
  snapshot jsonb;
  organization_id uuid;
begin
  if p_client_event_id is null then
    raise exception using errcode = '22023', message = 'field_signoff_input_invalid';
  end if;

  select signoff.*
  into existing_signoff
  from public.field_accounting_signoffs signoff
  where signoff.client_event_id = p_client_event_id;
  if found then
    if existing_signoff.event_category_id <> p_event_category_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_signoff.id,
      'signoffState', existing_signoff.signoff_state,
      'snapshot', existing_signoff.snapshot_json,
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

  if not exists (
    select 1
    from public.race_start_events start_event
    where start_event.event_category_id = p_event_category_id
      and start_event.event_type in ('actual_start', 'restart')
  ) then
    raise exception using errcode = 'P0001', message = 'field_signoff_start_required';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where registration.participation_status in ('not_started', 'checked_in', 'started')
    )::integer,
    count(*) filter (where registration.participation_status = 'missing')::integer
  into confirmed_count, unresolved_count, missing_count
  from public.registrations registration
  where registration.event_category_id = p_event_category_id
    and registration.status = 'confirmed';

  if unresolved_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'field_accounting_unresolved_participants',
      detail = unresolved_count::text;
  end if;
  if missing_count > 0 and (
    not coalesce(p_allow_open_missing, false)
    or nullif(trim(p_note), '') is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'field_accounting_missing_requires_acknowledgement',
      detail = missing_count::text;
  end if;
  if exists (
    select 1
    from public.timing_sessions timing_session
    where timing_session.event_category_id = p_event_category_id
      and timing_session.status <> 'closed'
  ) then
    raise exception using errcode = 'P0001', message = 'field_accounting_timing_sessions_open';
  end if;
  if exists (
    select 1
    from public.punch_events punch
    where punch.event_category_id = p_event_category_id
      and not punch.is_voided
      and punch.registration_id is null
  ) then
    raise exception using errcode = 'P0001', message = 'field_accounting_unresolved_punches';
  end if;
  if exists (
    select 1
    from (
      select distinct timing_session.checkpoint_id
      from public.timing_sessions timing_session
      where timing_session.event_category_id = p_event_category_id
        and timing_session.checkpoint_id is not null
    ) used_checkpoint
    where not exists (
      select 1
      from public.checkpoint_operation_events operation_event
      where operation_event.checkpoint_id = used_checkpoint.checkpoint_id
        and operation_event.operation_state = 'reconciled'
        and operation_event.sequence_number = (
          select max(latest_event.sequence_number)
          from public.checkpoint_operation_events latest_event
          where latest_event.checkpoint_id = used_checkpoint.checkpoint_id
        )
    )
  ) then
    raise exception using errcode = 'P0001', message = 'field_accounting_checkpoints_not_reconciled';
  end if;

  snapshot := jsonb_build_object(
    'capturedAt', now(),
    'confirmed', confirmed_count,
    'missing', missing_count,
    'participation', (
      select coalesce(jsonb_object_agg(status_group.status, status_group.total), '{}'::jsonb)
      from (
        select registration.participation_status::text as status, count(*)::integer as total
        from public.registrations registration
        where registration.event_category_id = p_event_category_id
          and registration.status = 'confirmed'
        group by registration.participation_status
      ) status_group
    ),
    'timingEventCount', (
      select count(*)::integer
      from public.punch_events punch
      where punch.event_category_id = p_event_category_id
        and not punch.is_voided
    ),
    'reconciledCheckpointCount', (
      select count(*)::integer
      from public.checkpoint_operation_events operation_event
      where operation_event.event_category_id = p_event_category_id
        and operation_event.operation_state = 'reconciled'
        and operation_event.sequence_number = (
          select max(latest_event.sequence_number)
          from public.checkpoint_operation_events latest_event
          where latest_event.checkpoint_id = operation_event.checkpoint_id
        )
    )
  );

  select signoff.*
  into previous_signoff
  from public.field_accounting_signoffs signoff
  where signoff.event_category_id = p_event_category_id
  order by signoff.sequence_number desc
  limit 1;

  select coalesce(max(signoff.sequence_number), 0) + 1
  into next_sequence
  from public.field_accounting_signoffs signoff
  where signoff.event_category_id = p_event_category_id;

  insert into public.field_accounting_signoffs (
    event_category_id,
    signoff_state,
    signed_at,
    signed_by_user_id,
    note,
    sequence_number,
    snapshot_json,
    client_event_id,
    supersedes_signoff_id
  )
  values (
    p_event_category_id,
    case when missing_count > 0 then 'closed_with_open_missing' else 'ready_for_results' end,
    now(),
    p_actor_user_id,
    nullif(trim(p_note), ''),
    next_sequence,
    snapshot,
    p_client_event_id,
    previous_signoff.id
  )
  returning * into created_signoff;

  select series.organization_id
  into organization_id
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = category_row.event_edition_id;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    organization_id,
    p_actor_user_id,
    'field_accounting_signoff',
    created_signoff.id,
    'race.field_accounting_signed',
    jsonb_build_object(
      'state', created_signoff.signoff_state,
      'sequenceNumber', next_sequence,
      'missingCount', missing_count
    )
  );

  return jsonb_build_object(
    'id', created_signoff.id,
    'signoffState', created_signoff.signoff_state,
    'signedAt', created_signoff.signed_at,
    'snapshot', created_signoff.snapshot_json,
    'replayed', false
  );
end;
$$;

create or replace function public.service_configure_public_live(
  p_event_category_id uuid,
  p_actor_user_id uuid,
  p_is_enabled boolean,
  p_delay_seconds integer,
  p_is_suppressed boolean,
  p_suppression_message text,
  p_show_checkpoint_aggregates boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  configured public.public_live_settings%rowtype;
  organization_id uuid;
begin
  if p_delay_seconds < 0
     or p_delay_seconds > 3600
     or (
       coalesce(p_is_suppressed, false)
       and nullif(trim(p_suppression_message), '') is null
     ) then
    raise exception using errcode = '22023', message = 'public_live_settings_invalid';
  end if;
  if not exists (
    select 1
    from public.event_categories category
    where category.id = p_event_category_id
  ) then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;

  insert into public.public_live_settings (
    event_category_id,
    is_enabled,
    delay_seconds,
    is_suppressed,
    suppression_message,
    show_checkpoint_aggregates,
    updated_by_user_id,
    updated_at
  )
  values (
    p_event_category_id,
    coalesce(p_is_enabled, false),
    p_delay_seconds,
    coalesce(p_is_suppressed, false),
    case when coalesce(p_is_suppressed, false) then trim(p_suppression_message) else null end,
    coalesce(p_show_checkpoint_aggregates, true),
    p_actor_user_id,
    now()
  )
  on conflict (event_category_id) do update
  set
    is_enabled = excluded.is_enabled,
    delay_seconds = excluded.delay_seconds,
    is_suppressed = excluded.is_suppressed,
    suppression_message = excluded.suppression_message,
    show_checkpoint_aggregates = excluded.show_checkpoint_aggregates,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = excluded.updated_at
  returning * into configured;

  select series.organization_id
  into organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = p_event_category_id;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    organization_id,
    p_actor_user_id,
    'public_live_settings',
    p_event_category_id,
    'race.public_live_configured',
    jsonb_build_object(
      'enabled', configured.is_enabled,
      'delaySeconds', configured.delay_seconds,
      'suppressed', configured.is_suppressed
    )
  );

  return jsonb_build_object(
    'eventCategoryId', configured.event_category_id,
    'isEnabled', configured.is_enabled,
    'delaySeconds', configured.delay_seconds,
    'isSuppressed', configured.is_suppressed,
    'suppressionMessage', configured.suppression_message,
    'showCheckpointAggregates', configured.show_checkpoint_aggregates,
    'updatedAt', configured.updated_at
  );
end;
$$;

create or replace function public.read_public_live_edition(p_event_edition_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with edition_scope as (
    select
      edition.id,
      edition.name,
      edition.slug,
      edition.timezone,
      edition.status::text as status
    from public.event_editions edition
    where edition.id = p_event_edition_id
      and edition.published_at is not null
      and edition.status in ('published', 'registration_open', 'registration_closed', 'in_progress', 'completed')
  ),
  category_scope as (
    select
      category.id,
      category.name,
      category.slug,
      category.start_at,
      category.status::text as status,
      settings.delay_seconds,
      settings.is_suppressed,
      settings.suppression_message,
      settings.show_checkpoint_aggregates,
      clock_timestamp() - make_interval(secs => settings.delay_seconds) as visible_through
    from public.event_categories category
    join edition_scope edition on edition.id = category.event_edition_id
    join public.public_live_settings settings on settings.event_category_id = category.id
    where settings.is_enabled
  ),
  delayed_statuses as (
    select distinct on (status_event.registration_id)
      status_event.registration_id,
      registration.event_category_id,
      status_event.status::text as status,
      status_event.effective_at,
      status_event.created_at,
      status_event.sequence_number
    from public.participant_statuses status_event
    join public.registrations registration on registration.id = status_event.registration_id
    join category_scope category on category.id = registration.event_category_id
    where status_event.created_at <= category.visible_through
      and not exists (
        select 1
        from public.participant_statuses superseding_event
        where superseding_event.supersedes_status_id = status_event.id
          and superseding_event.created_at <= category.visible_through
      )
    order by
      status_event.registration_id,
      status_event.sequence_number desc
  ),
  category_payloads as (
    select
      category.id,
      category.start_at,
      jsonb_build_object(
        'id', category.id,
        'name', category.name,
        'slug', category.slug,
        'status', category.status,
        'plannedStartAt', category.start_at,
        'effectiveStartAt', (
          select start_event.occurred_at
          from public.race_start_events start_event
          where start_event.event_category_id = category.id
            and start_event.event_type in ('actual_start', 'restart')
            and start_event.created_at <= category.visible_through
          order by start_event.sequence_number desc
          limit 1
        ),
        'visibleThrough', category.visible_through,
        'delaySeconds', category.delay_seconds,
        'isSuppressed', category.is_suppressed,
        'suppressionMessage', category.suppression_message,
        'participantCounts', case
          when category.is_suppressed then null
          else jsonb_build_object(
            'started', (
              select count(*)::integer
              from delayed_statuses status_snapshot
              where status_snapshot.event_category_id = category.id
                and status_snapshot.status in ('started', 'missing', 'stopped', 'finished', 'dnf', 'dsq', 'evacuated')
            ),
            'onCourse', (
              select count(*)::integer
              from delayed_statuses status_snapshot
              where status_snapshot.event_category_id = category.id
                and status_snapshot.status in ('started', 'missing')
            ),
            'finished', (
              select count(*)::integer
              from delayed_statuses status_snapshot
              where status_snapshot.event_category_id = category.id
                and status_snapshot.status = 'finished'
            ),
            'withdrawn', (
              select count(*)::integer
              from delayed_statuses status_snapshot
              where status_snapshot.event_category_id = category.id
                and status_snapshot.status in ('dnf', 'stopped', 'withdrawn', 'evacuated')
            )
          )
        end,
        'checkpointProgress', case
          when category.is_suppressed or not category.show_checkpoint_aggregates then '[]'::jsonb
          else coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', checkpoint.id,
                'name', checkpoint.name,
                'code', checkpoint.code,
                'type', checkpoint.checkpoint_type,
                'sequenceNumber', checkpoint.sequence_number,
                'observedCount', (
                  select count(distinct punch.registration_id)::integer
                  from public.punch_events punch
                  where punch.checkpoint_id = checkpoint.id
                    and punch.registration_id is not null
                    and not punch.is_voided
                    and punch.ingested_at <= category.visible_through
                ),
                'lastObservationAt', (
                  select max(punch.effective_recorded_at)
                  from public.punch_events punch
                  where punch.checkpoint_id = checkpoint.id
                    and punch.registration_id is not null
                    and not punch.is_voided
                    and punch.ingested_at <= category.visible_through
                )
              )
              order by checkpoint.sequence_number
            )
            from public.checkpoints checkpoint
            where checkpoint.event_category_id = category.id
          ), '[]'::jsonb)
        end,
        'lastObservationAt', case
          when category.is_suppressed then null
          else (
            select max(punch.effective_recorded_at)
            from public.punch_events punch
            where punch.event_category_id = category.id
              and punch.registration_id is not null
              and not punch.is_voided
              and punch.ingested_at <= category.visible_through
          )
        end
      ) as payload
    from category_scope category
  )
  select case
    when edition.id is null then null
    else jsonb_build_object(
      'eventEditionId', edition.id,
      'eventName', edition.name,
      'eventSlug', edition.slug,
      'timezone', edition.timezone,
      'status', edition.status,
      'generatedAt', clock_timestamp(),
      'categories', coalesce(
        jsonb_agg(category_payloads.payload order by category_payloads.start_at nulls last)
          filter (where category_payloads.id is not null),
        '[]'::jsonb
      )
    )
  end
  from edition_scope edition
  left join category_payloads on true
  group by edition.id, edition.name, edition.slug, edition.timezone, edition.status;
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

alter table public.cutoff_actions enable row level security;
alter table public.checkpoint_operation_events enable row level security;
alter table public.field_accounting_signoffs enable row level security;
alter table public.public_live_settings enable row level security;

revoke all on table public.cutoff_actions from public, anon, authenticated;
revoke all on table public.checkpoint_operation_events from public, anon, authenticated;
revoke all on table public.field_accounting_signoffs from public, anon, authenticated;
revoke all on table public.public_live_settings from public, anon, authenticated;
grant all on table public.cutoff_actions to service_role;
grant all on table public.checkpoint_operation_events to service_role;
grant all on table public.field_accounting_signoffs to service_role;
grant all on table public.public_live_settings to service_role;

revoke all on function public.service_record_cutoff_action(
  uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, text, text, boolean, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_record_checkpoint_operation(
  uuid, uuid, text, timestamptz, text, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.service_signoff_field_accounting(
  uuid, uuid, boolean, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_configure_public_live(
  uuid, uuid, boolean, integer, boolean, text, boolean
) from public, anon, authenticated;
revoke all on function public.read_public_live_edition(uuid) from public;

grant execute on function public.service_record_cutoff_action(
  uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, text, text, boolean, text, uuid
) to service_role;
grant execute on function public.service_record_checkpoint_operation(
  uuid, uuid, text, timestamptz, text, jsonb, uuid
) to service_role;
grant execute on function public.service_signoff_field_accounting(
  uuid, uuid, boolean, text, uuid
) to service_role;
grant execute on function public.service_configure_public_live(
  uuid, uuid, boolean, integer, boolean, text, boolean
) to service_role;
grant execute on function public.read_public_live_edition(uuid) to anon, authenticated, service_role;
