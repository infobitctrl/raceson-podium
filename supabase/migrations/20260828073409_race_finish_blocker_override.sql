begin;

create or replace function public.service_finish_race_categories_with_override(
  p_event_edition_id uuid,
  p_event_category_ids uuid[],
  p_actor_user_id uuid,
  p_client_event_id uuid,
  p_acknowledge_unfinished_as_dnf boolean,
  p_override_reason text
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
  closed_edition_session_count integer := 0;
  league_round_event_count integer := 0;
  legacy_league_round_count integer := 0;
  edition_completed boolean := false;
  edition_was_completed boolean := false;
  command_event public.domain_events%rowtype;
  category_event_id uuid;
  category_id uuid;
  result_jobs jsonb := '[]'::jsonb;
  command_payload jsonb;
  override_reason text := btrim(p_override_reason);
  unfinished_registration public.registrations%rowtype;
  unfinished_participant_count integer := 0;
  skipped_result_category_ids uuid[] := '{}'::uuid[];
  blocker_details jsonb;

begin
  if override_reason is null or length(override_reason) not between 3 and 2000 then
    raise exception using errcode = '22023', message = 'race_finish_override_reason_required';
  end if;
  if p_acknowledge_unfinished_as_dnf is null then
    raise exception using errcode = '22023', message = 'race_finish_acknowledgement_invalid';
  end if;

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
       or command_event.payload_json->'requestedCategoryIds' <> to_jsonb(requested_category_ids)
       or command_event.actor_user_id is distinct from p_actor_user_id
       or command_event.payload_json->>'overrideReason' is distinct from override_reason
       or (command_event.payload_json->>'acknowledgeUnfinishedAsDnf')::boolean
            is distinct from p_acknowledge_unfinished_as_dnf then
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

  if edition_row.status::text in ('completed', 'archived', 'cancelled')
     or edition_row.organizer_deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'race_live_operations_closed';
  end if;

  perform 1
  from public.event_categories category
  where category.id = any(requested_category_ids)
    and category.event_edition_id = p_event_edition_id
  order by category.id
  for update;

  select
    count(*)::integer,
    coalesce(array_agg(category.id order by category.id) filter (where category.status not in ('completed', 'closed')), '{}'::uuid[]),
    coalesce(array_agg(category.id order by category.id) filter (where category.status = 'completed'), '{}'::uuid[]),
    coalesce(
      array_agg(category.id order by category.id)
        filter (where category.status = 'closed' or category.organizer_deleted_at is not null or category.results_mode = 'informative_age'),
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

  -- Freeze participant state before checking and applying the DNF acknowledgement.
  perform 1 from public.registrations registration
  where registration.event_category_id = any(requested_category_ids)
  order by registration.id for update;

  select count(*)::integer into unfinished_participant_count
  from public.registrations registration
  where registration.event_category_id = any(active_category_ids)
    and registration.status = 'confirmed'
    and registration.participation_status in ('not_started', 'checked_in', 'started', 'missing');
  if unfinished_participant_count > 0 and not p_acknowledge_unfinished_as_dnf then
    raise exception using errcode = 'P0001',
      message = 'race_finish_unfinished_acknowledgement_required',
      detail = unfinished_participant_count::text;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'categoryId', category.id,
    'previousStatus', category.status,
    'hasRecordedStart', exists (
      select 1 from public.race_start_events start_event
      where start_event.event_category_id = category.id
        and start_event.event_type in ('actual_start', 'restart')
    ),
    'confirmedRegistrationCount', (
      select count(*) from public.registrations registration
      where registration.event_category_id = category.id and registration.status = 'confirmed'
    )
  ) order by category.id), '[]'::jsonb) into blocker_details
  from public.event_categories category where category.id = any(active_category_ids);

  for unfinished_registration in
    select registration.* from public.registrations registration
    where registration.event_category_id = any(active_category_ids)
      and registration.status = 'confirmed'
      and registration.participation_status in ('not_started', 'checked_in', 'started', 'missing')
    order by registration.id
  loop
    perform public.service_record_participant_status(
      unfinished_registration.id, p_actor_user_id, 'dnf', clock_timestamp(),
      override_reason, gen_random_uuid(), true,
      jsonb_build_object('source', 'race_finish_override',
        'eventEditionId', p_event_edition_id, 'clientEventId', p_client_event_id)
    );
  end loop;

  -- No synthetic start and no permanently failing result job for an unstarted race.
  select coalesce(array_agg(category.id order by category.id), '{}'::uuid[])
  into skipped_result_category_ids
  from public.event_categories category
  where category.id = any(active_category_ids)
    and not exists (
      select 1 from public.race_start_events start_event
      where start_event.event_category_id = category.id
        and start_event.event_type in ('actual_start', 'restart')
    );

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
    and category.organizer_deleted_at is null
    and category.status not in ('completed', 'closed');

  edition_completed := remaining_category_count = 0;
  edition_was_completed := edition_row.status = 'completed';
  if edition_completed and not edition_was_completed then
    update public.event_editions edition
    set status = 'completed'
    where edition.id = p_event_edition_id;
  end if;

  if edition_completed then
    update public.timing_sessions timing_session
    set status = 'closed', closed_at = coalesce(timing_session.closed_at, clock_timestamp())
    where timing_session.event_edition_id = p_event_edition_id
      and timing_session.event_category_id is null
      and timing_session.status <> 'closed';
    get diagnostics closed_edition_session_count = row_count;
    closed_session_count := closed_session_count + closed_edition_session_count;

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
    'legacyLeagueRoundCount', legacy_league_round_count,
    'overrideReason', override_reason,
    'overriddenBlockers', blocker_details,
    'acknowledgeUnfinishedAsDnf', p_acknowledge_unfinished_as_dnf,
    'unfinishedParticipantCount', unfinished_participant_count,
    'markedDnfCount', unfinished_participant_count,
    'skippedResultCategoryIds', to_jsonb(skipped_result_category_ids)
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
      'race.finish_blockers_overridden',
      jsonb_build_object(
        'eventEditionId', p_event_edition_id,
        'closedTimingSessionCount', closed_session_count,
        'domainEventId', command_event.id,
        'clientEventId', p_client_event_id,
        'reason', override_reason,
        'overriddenBlockers', blocker_details,
        'markedDnfCount', unfinished_participant_count
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

    if category_id = any(skipped_result_category_ids) then
      continue;
    end if;

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

comment on function public.service_finish_race_categories_with_override(uuid,uuid[],uuid,uuid,boolean,text) is
  'Server-only atomic completion with a required audited reason and separate DNF acknowledgement. Unstarted races close without fabricated starts or result snapshots; publication guards remain unchanged.';

revoke all on function public.service_finish_race_categories_with_override(uuid,uuid[],uuid,uuid,boolean,text)
  from public, anon, authenticated;
grant execute on function public.service_finish_race_categories_with_override(uuid,uuid[],uuid,uuid,boolean,text)
  to service_role;

commit;
