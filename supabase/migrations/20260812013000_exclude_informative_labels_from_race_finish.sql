begin;

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
    and category.results_mode <> 'informative_age'
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

comment on function public.service_finish_race_categories(uuid,uuid[],uuid,uuid) is
  'Server-only idempotent race completion; informative labels do not block edition closeout.';

commit;
