begin;

create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete restrict,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload_version integer not null default 1,
  payload_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  correlation_id uuid not null,
  causation_event_id uuid references public.domain_events (id) on delete restrict,
  idempotency_key text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  unique (event_type, idempotency_key),
  check (nullif(trim(event_type), '') is not null),
  check (nullif(trim(aggregate_type), '') is not null),
  check (payload_version > 0),
  check (jsonb_typeof(payload_json) = 'object'),
  check (nullif(trim(idempotency_key), '') is not null)
);

create index domain_events_aggregate_idx
  on public.domain_events (aggregate_type, aggregate_id, occurred_at desc);
create index domain_events_correlation_idx
  on public.domain_events (correlation_id, occurred_at, id);
create index domain_events_organization_idx
  on public.domain_events (organization_id, occurred_at desc)
  where organization_id is not null;

create table public.workflow_jobs (
  id uuid primary key default gen_random_uuid(),
  domain_event_id uuid not null references public.domain_events (id) on delete restrict,
  organization_id uuid references public.organizations (id) on delete restrict,
  handler_key text not null,
  handler_version integer not null default 1,
  state text not null default 'queued',
  priority integer not null default 100,
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  available_at timestamptz not null default clock_timestamp(),
  locked_at timestamptz,
  lease_owner uuid,
  last_error_code text,
  result_json jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (domain_event_id, handler_key, handler_version),
  check (nullif(trim(handler_key), '') is not null),
  check (handler_version > 0),
  check (state in ('queued', 'running', 'retry_wait', 'succeeded', 'dead_letter', 'cancelled')),
  check (priority between 0 and 1000),
  check (attempt_count >= 0),
  check (max_attempts between 1 and 100),
  check (jsonb_typeof(result_json) = 'object')
);

create index workflow_jobs_claim_idx
  on public.workflow_jobs (state, available_at, priority, created_at)
  where state in ('queued', 'retry_wait');
create index workflow_jobs_event_idx
  on public.workflow_jobs (domain_event_id, handler_key);
create index workflow_jobs_organization_idx
  on public.workflow_jobs (organization_id, created_at desc)
  where organization_id is not null;

create trigger workflow_jobs_set_updated_at
before update on public.workflow_jobs
for each row execute function public.set_updated_at();

create or replace function public.protect_domain_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'domain_event_is_immutable';
end;
$$;

create trigger domain_events_immutable
before update or delete on public.domain_events
for each row execute function public.protect_domain_event();

create or replace function public.service_finish_race_categories(
  p_event_edition_id uuid,
  p_event_category_ids uuid[],
  p_actor_user_id uuid,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  edition_row public.event_editions%rowtype;
  organization_id uuid;
  requested_category_ids uuid[];
  active_category_ids uuid[] := '{}'::uuid[];
  already_finished_category_ids uuid[] := '{}'::uuid[];
  finished_category_ids uuid[] := '{}'::uuid[];
  invalid_category_ids uuid[] := '{}'::uuid[];
  category_count integer := 0;
  remaining_category_count integer := 0;
  closed_session_count integer := 0;
  league_round_event_count integer := 0;
  legacy_league_round_count integer := 0;
  edition_completed boolean := false;
  edition_was_completed boolean := false;
  command_event public.domain_events%rowtype;
  category_event_id uuid;
  category_id uuid;
  result_jobs jsonb := '[]'::jsonb;
  command_payload jsonb;
begin
  if p_event_edition_id is null
     or p_actor_user_id is null
     or p_client_event_id is null
     or array_position(p_event_category_ids, null) is not null
     or coalesce(cardinality(p_event_category_ids), 0) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'race_finish_input_invalid';
  end if;

  select coalesce(array_agg(distinct category_id_value order by category_id_value), '{}'::uuid[])
  into requested_category_ids
  from unnest(p_event_category_ids) as requested(category_id_value);

  select edition.*
  into edition_row
  from public.event_editions edition
  where edition.id = p_event_edition_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  select series.organization_id
  into organization_id
  from public.event_series series
  where series.id = edition_row.event_series_id;

  select event.*
  into command_event
  from public.domain_events event
  where event.event_type = 'race.finish.completed'
    and event.idempotency_key = p_client_event_id::text;
  if found then
    if command_event.aggregate_id <> p_event_edition_id
       or command_event.payload_json->'requestedCategoryIds' <> to_jsonb(requested_category_ids) then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'jobId', job.id,
          'categoryId', event.aggregate_id,
          'state', job.state,
          'resultRunId', nullif(job.result_json->>'resultRunId', '')
        )
        order by event.aggregate_id
      ),
      '[]'::jsonb
    )
    into result_jobs
    from public.workflow_jobs job
    join public.domain_events event on event.id = job.domain_event_id
    where event.causation_event_id = command_event.id
      and job.handler_key = 'result.run.compute'
      and job.handler_version = 1;

    return command_event.payload_json || jsonb_build_object(
      'domainEventId', command_event.id,
      'resultJobs', result_jobs,
      'replayed', true
    );
  end if;

  perform 1
  from public.event_categories category
  where category.id = any(requested_category_ids)
    and category.event_edition_id = p_event_edition_id
  order by category.id
  for update;

  select
    count(*)::integer,
    coalesce(array_agg(category.id order by category.id) filter (where category.status = 'in_progress'), '{}'::uuid[]),
    coalesce(array_agg(category.id order by category.id) filter (where category.status = 'completed'), '{}'::uuid[]),
    coalesce(
      array_agg(category.id order by category.id)
        filter (where category.status not in ('in_progress', 'completed')),
      '{}'::uuid[]
    )
  into category_count, active_category_ids, already_finished_category_ids, invalid_category_ids
  from public.event_categories category
  where category.id = any(requested_category_ids)
    and category.event_edition_id = p_event_edition_id;

  if category_count <> cardinality(requested_category_ids) then
    raise exception using errcode = 'P0001', message = 'race_finish_category_mismatch';
  end if;
  if cardinality(invalid_category_ids) > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'race_finish_transition_invalid',
      detail = array_to_string(invalid_category_ids, ',');
  end if;

  finished_category_ids := (
    select coalesce(array_agg(distinct category_id_value order by category_id_value), '{}'::uuid[])
    from unnest(active_category_ids || already_finished_category_ids) as finished(category_id_value)
  );

  if cardinality(active_category_ids) > 0 then
    update public.timing_sessions timing_session
    set
      status = 'closed',
      closed_at = coalesce(timing_session.closed_at, clock_timestamp())
    where timing_session.event_edition_id = p_event_edition_id
      and timing_session.event_category_id = any(active_category_ids)
      and timing_session.status <> 'closed';
    get diagnostics closed_session_count = row_count;

    update public.event_categories category
    set status = 'completed'
    where category.id = any(active_category_ids);
  end if;

  select count(*)::integer
  into remaining_category_count
  from public.event_categories category
  where category.event_edition_id = p_event_edition_id
    and category.status not in ('completed', 'closed');

  edition_completed := remaining_category_count = 0;
  edition_was_completed := edition_row.status = 'completed';
  if edition_completed and not edition_was_completed then
    update public.event_editions edition
    set status = 'completed'
    where edition.id = p_event_edition_id;
  end if;

  if edition_completed then
    update public.league_round_events round_event
    set status = 'completed'
    where round_event.event_edition_id = p_event_edition_id
      and round_event.status not in ('completed', 'cancelled');
    get diagnostics league_round_event_count = row_count;

    update public.league_rounds round
    set status = 'completed'
    where round.event_edition_id = p_event_edition_id
      and round.status not in ('completed', 'cancelled');
    get diagnostics legacy_league_round_count = row_count;
  end if;

  command_payload := jsonb_build_object(
    'eventEditionId', p_event_edition_id,
    'requestedCategoryIds', to_jsonb(requested_category_ids),
    'finishedCategoryIds', to_jsonb(finished_category_ids),
    'newlyFinishedCategoryIds', to_jsonb(active_category_ids),
    'closedTimingSessionCount', closed_session_count,
    'editionCompleted', edition_completed,
    'leagueRoundEventCount', league_round_event_count,
    'legacyLeagueRoundCount', legacy_league_round_count
  );

  insert into public.domain_events (
    organization_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload_json,
    actor_user_id,
    correlation_id,
    idempotency_key
  )
  values (
    organization_id,
    'race.finish.completed',
    'event_edition',
    p_event_edition_id,
    command_payload,
    p_actor_user_id,
    p_client_event_id,
    p_client_event_id::text
  )
  returning * into command_event;

  foreach category_id in array active_category_ids loop
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
      'event_category',
      category_id,
      'race.finished',
      jsonb_build_object(
        'eventEditionId', p_event_edition_id,
        'closedTimingSessionCount', closed_session_count,
        'domainEventId', command_event.id,
        'clientEventId', p_client_event_id
      )
    );

    insert into public.domain_events (
      organization_id,
      event_type,
      aggregate_type,
      aggregate_id,
      payload_json,
      actor_user_id,
      correlation_id,
      causation_event_id,
      idempotency_key
    )
    values (
      organization_id,
      'race.category.completed',
      'event_category',
      category_id,
      jsonb_build_object(
        'eventEditionId', p_event_edition_id,
        'eventCategoryId', category_id,
        'completedAt', command_event.occurred_at
      ),
      p_actor_user_id,
      p_client_event_id,
      command_event.id,
      p_client_event_id::text || ':' || category_id::text
    )
    returning id into category_event_id;

    insert into public.workflow_jobs (
      domain_event_id,
      organization_id,
      handler_key,
      handler_version,
      state,
      priority,
      result_json
    )
    values (
      category_event_id,
      organization_id,
      'result.run.compute',
      1,
      'queued',
      10,
      jsonb_build_object('eventCategoryId', category_id)
    );
  end loop;

  if edition_completed and not edition_was_completed then
    insert into public.domain_events (
      organization_id,
      event_type,
      aggregate_type,
      aggregate_id,
      payload_json,
      actor_user_id,
      correlation_id,
      causation_event_id,
      idempotency_key
    )
    values (
      organization_id,
      'event.edition.completed',
      'event_edition',
      p_event_edition_id,
      jsonb_build_object(
        'eventEditionId', p_event_edition_id,
        'completedAt', command_event.occurred_at
      ),
      p_actor_user_id,
      p_client_event_id,
      command_event.id,
      p_client_event_id::text
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'jobId', job.id,
        'categoryId', event.aggregate_id,
        'state', job.state,
        'resultRunId', null
      )
      order by event.aggregate_id
    ),
    '[]'::jsonb
  )
  into result_jobs
  from public.workflow_jobs job
  join public.domain_events event on event.id = job.domain_event_id
  where event.causation_event_id = command_event.id
    and job.handler_key = 'result.run.compute'
    and job.handler_version = 1;

  return command_payload || jsonb_build_object(
    'domainEventId', command_event.id,
    'resultJobs', result_jobs,
    'replayed', false
  );
end;
$$;

create or replace function public.service_complete_workflow_job(
  p_workflow_job_id uuid,
  p_handler_key text,
  p_result_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.workflow_jobs%rowtype;
begin
  if p_workflow_job_id is null
     or nullif(trim(p_handler_key), '') is null
     or jsonb_typeof(coalesce(p_result_json, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'workflow_job_completion_invalid';
  end if;

  select job.*
  into job_row
  from public.workflow_jobs job
  where job.id = p_workflow_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workflow_job_not_found';
  end if;
  if job_row.handler_key <> p_handler_key then
    raise exception using errcode = 'P0001', message = 'workflow_job_handler_mismatch';
  end if;
  if job_row.state = 'succeeded' then
    return jsonb_build_object(
      'jobId', job_row.id,
      'state', job_row.state,
      'result', job_row.result_json,
      'replayed', true
    );
  end if;
  if job_row.state in ('dead_letter', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'workflow_job_not_completable';
  end if;

  update public.workflow_jobs job
  set
    state = 'succeeded',
    attempt_count = greatest(job.attempt_count, 1),
    result_json = coalesce(job.result_json, '{}'::jsonb) || coalesce(p_result_json, '{}'::jsonb),
    last_error_code = null,
    locked_at = null,
    lease_owner = null,
    completed_at = clock_timestamp()
  where job.id = job_row.id
  returning * into job_row;

  return jsonb_build_object(
    'jobId', job_row.id,
    'state', job_row.state,
    'result', job_row.result_json,
    'replayed', false
  );
end;
$$;

create or replace function public.service_record_workflow_job_failure(
  p_workflow_job_id uuid,
  p_handler_key text,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.workflow_jobs%rowtype;
  next_attempt_count integer;
  next_state text;
begin
  if p_workflow_job_id is null
     or nullif(trim(p_handler_key), '') is null
     or nullif(trim(p_error_code), '') is null then
    raise exception using errcode = '22023', message = 'workflow_job_failure_invalid';
  end if;

  select job.*
  into job_row
  from public.workflow_jobs job
  where job.id = p_workflow_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workflow_job_not_found';
  end if;
  if job_row.handler_key <> p_handler_key then
    raise exception using errcode = 'P0001', message = 'workflow_job_handler_mismatch';
  end if;
  if job_row.state in ('succeeded', 'dead_letter', 'cancelled') then
    return jsonb_build_object(
      'jobId', job_row.id,
      'state', job_row.state,
      'replayed', true
    );
  end if;

  next_attempt_count := job_row.attempt_count + 1;
  next_state := case
    when next_attempt_count >= job_row.max_attempts then 'dead_letter'
    else 'retry_wait'
  end;

  update public.workflow_jobs job
  set
    state = next_state,
    attempt_count = next_attempt_count,
    available_at = case
      when next_state = 'retry_wait' then clock_timestamp() + interval '30 seconds'
      else job.available_at
    end,
    last_error_code = left(trim(p_error_code), 200),
    locked_at = null,
    lease_owner = null,
    completed_at = case when next_state = 'dead_letter' then clock_timestamp() else null end
  where job.id = job_row.id
  returning * into job_row;

  return jsonb_build_object(
    'jobId', job_row.id,
    'state', job_row.state,
    'attemptCount', job_row.attempt_count,
    'availableAt', job_row.available_at,
    'replayed', false
  );
end;
$$;

alter table public.domain_events enable row level security;
alter table public.workflow_jobs enable row level security;

revoke all on table public.domain_events from public, anon, authenticated;
revoke all on table public.workflow_jobs from public, anon, authenticated;
grant select, insert on table public.domain_events to service_role;
grant select, insert, update on table public.workflow_jobs to service_role;

revoke all on function public.protect_domain_event() from public, anon, authenticated;
revoke all on function public.service_finish_race_categories(uuid,uuid[],uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.service_complete_workflow_job(uuid,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.service_record_workflow_job_failure(uuid,text,text)
  from public, anon, authenticated;

grant execute on function public.service_finish_race_categories(uuid,uuid[],uuid,uuid)
  to service_role;
grant execute on function public.service_complete_workflow_job(uuid,text,jsonb)
  to service_role;
grant execute on function public.service_record_workflow_job_failure(uuid,text,text)
  to service_role;

comment on table public.domain_events is
  'Append-only internal domain events committed in the same transaction as authoritative state changes.';
comment on table public.workflow_jobs is
  'Idempotent internal workflow handlers with retry and terminal-failure state.';
comment on function public.service_finish_race_categories(uuid,uuid[],uuid,uuid) is
  'Server-only idempotent transaction for race completion, lifecycle projection, audit evidence, and result-computation jobs.';

commit;
