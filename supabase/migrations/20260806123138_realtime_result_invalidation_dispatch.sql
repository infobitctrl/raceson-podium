begin;

create or replace function public.build_platform_invalidation_payload(
  p_domain_event_id uuid,
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_payload_json jsonb,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  query_families jsonb;
begin
  query_families := case p_event_type
    when 'race.finish.completed' then
      '["event","league","organizer","homepage"]'::jsonb
    when 'race.category.completed' then
      '["event","results","organizer"]'::jsonb
    when 'event.edition.completed' then
      '["event","league","organizer","homepage"]'::jsonb
    when 'result.publication.committed' then
      '["event","results","athlete","club","track","league","rankings","organizer","homepage"]'::jsonb
    when 'league.round.source_changed' then
      '["league","rankings","athlete","club","organizer","homepage"]'::jsonb
    when 'league.standings.published' then
      '["league","rankings","athlete","club","organizer","homepage"]'::jsonb
    else null
  end;

  if query_families is null then
    return null;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'schemaVersion', 1,
    'domainEventId', p_domain_event_id,
    'eventType', p_event_type,
    'aggregateType', p_aggregate_type,
    'aggregateId', p_aggregate_id,
    'occurredAt', p_occurred_at,
    'eventEditionId', nullif(coalesce(p_payload_json, '{}'::jsonb)->>'eventEditionId', ''),
    'eventCategoryId', nullif(coalesce(p_payload_json, '{}'::jsonb)->>'eventCategoryId', ''),
    'leagueSeasonId', nullif(coalesce(p_payload_json, '{}'::jsonb)->>'leagueSeasonId', ''),
    'publicationState', nullif(coalesce(p_payload_json, '{}'::jsonb)->>'publicationState', ''),
    'queryFamilies', query_families
  ));
end;
$$;

create or replace function public.enqueue_platform_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  broadcast_payload jsonb;
begin
  broadcast_payload := public.build_platform_invalidation_payload(
    new.id,
    new.event_type,
    new.aggregate_type,
    new.aggregate_id,
    new.payload_json,
    new.occurred_at
  );

  if broadcast_payload is null then
    return new;
  end if;

  insert into public.workflow_jobs (
    domain_event_id,
    organization_id,
    handler_key,
    handler_version,
    state,
    priority,
    max_attempts,
    result_json
  )
  values (
    new.id,
    new.organization_id,
    'realtime.invalidation.broadcast',
    1,
    'queued',
    5,
    8,
    jsonb_build_object(
      'topic', 'platform:invalidate',
      'broadcastEvent', 'data_changed',
      'private', false,
      'broadcastPayload', broadcast_payload
    )
  )
  on conflict (domain_event_id, handler_key, handler_version) do nothing;

  return new;
end;
$$;

create trigger domain_events_enqueue_platform_invalidation
after insert on public.domain_events
for each row execute function public.enqueue_platform_invalidation();

create or replace function public.service_dispatch_realtime_invalidation_jobs(
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_id uuid := gen_random_uuid();
  claimed_count integer := 0;
  succeeded_count integer := 0;
  failed_count integer := 0;
  dead_letter_count integer := 0;
  failure_code text;
  failure_message text;
  next_state text;
  retry_seconds integer;
  job_row record;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'realtime_invalidation_dispatch_limit_invalid';
  end if;

  for job_row in
    with candidates as (
      select job.id
      from public.workflow_jobs job
      where job.handler_key = 'realtime.invalidation.broadcast'
        and job.handler_version = 1
        and (
          (
            job.state in ('queued', 'retry_wait')
            and job.available_at <= clock_timestamp()
          )
          or (
            job.state = 'running'
            and job.locked_at < clock_timestamp() - interval '2 minutes'
          )
        )
      order by job.priority, job.available_at, job.created_at, job.id
      limit p_limit
      for update skip locked
    ), claimed as (
      update public.workflow_jobs job
      set
        state = 'running',
        attempt_count = job.attempt_count + 1,
        locked_at = clock_timestamp(),
        lease_owner = worker_id,
        last_error_code = null,
        completed_at = null
      from candidates
      where job.id = candidates.id
      returning job.*
    )
    select claimed.*
    from claimed
    order by claimed.priority, claimed.available_at, claimed.created_at, claimed.id
  loop
    claimed_count := claimed_count + 1;

    begin
      if job_row.result_json->>'topic' <> 'platform:invalidate'
         or job_row.result_json->>'broadcastEvent' <> 'data_changed'
         or jsonb_typeof(job_row.result_json->'broadcastPayload') <> 'object'
         or jsonb_typeof(job_row.result_json->'broadcastPayload'->'queryFamilies') <> 'array' then
        raise exception using errcode = '22023', message = 'realtime_invalidation_payload_invalid';
      end if;

      perform realtime.send(
        job_row.result_json->'broadcastPayload',
        job_row.result_json->>'broadcastEvent',
        job_row.result_json->>'topic',
        false
      );

      update public.workflow_jobs job
      set
        state = 'succeeded',
        result_json = job.result_json || jsonb_build_object(
          'dispatchedAt', clock_timestamp(),
          'dispatcherLeaseOwner', worker_id
        ),
        last_error_code = null,
        locked_at = null,
        lease_owner = null,
        completed_at = clock_timestamp()
      where job.id = job_row.id
        and job.state = 'running'
        and job.lease_owner = worker_id;

      succeeded_count := succeeded_count + 1;
    exception
      when others then
        get stacked diagnostics
          failure_code = returned_sqlstate,
          failure_message = message_text;
        next_state := case
          when job_row.attempt_count >= job_row.max_attempts then 'dead_letter'
          else 'retry_wait'
        end;
        retry_seconds := least(900, 5 * power(2, greatest(job_row.attempt_count - 1, 0))::integer);

        update public.workflow_jobs job
        set
          state = next_state,
          available_at = case
            when next_state = 'retry_wait'
              then clock_timestamp() + make_interval(secs => retry_seconds)
            else job.available_at
          end,
          last_error_code = left(failure_code || ':' || failure_message, 200),
          locked_at = null,
          lease_owner = null,
          completed_at = case
            when next_state = 'dead_letter' then clock_timestamp()
            else null
          end
        where job.id = job_row.id
          and job.state = 'running'
          and job.lease_owner = worker_id;

        failed_count := failed_count + 1;
        if next_state = 'dead_letter' then
          dead_letter_count := dead_letter_count + 1;
        end if;
    end;
  end loop;

  return jsonb_build_object(
    'workerId', worker_id,
    'claimed', claimed_count,
    'succeeded', succeeded_count,
    'failed', failed_count,
    'deadLettered', dead_letter_count
  );
end;
$$;

create or replace function public.service_requeue_realtime_invalidation_job(
  p_workflow_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.workflow_jobs%rowtype;
begin
  if p_workflow_job_id is null then
    raise exception using errcode = '22023', message = 'realtime_invalidation_job_id_required';
  end if;

  select job.*
  into job_row
  from public.workflow_jobs job
  where job.id = p_workflow_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workflow_job_not_found';
  end if;
  if job_row.handler_key <> 'realtime.invalidation.broadcast'
     or job_row.handler_version <> 1 then
    raise exception using errcode = 'P0001', message = 'realtime_invalidation_job_required';
  end if;
  if job_row.state = 'running' then
    raise exception using errcode = '55000', message = 'realtime_invalidation_job_running';
  end if;

  update public.workflow_jobs job
  set
    state = 'queued',
    attempt_count = 0,
    available_at = clock_timestamp(),
    locked_at = null,
    lease_owner = null,
    last_error_code = null,
    completed_at = null,
    result_json = (job.result_json - 'dispatchedAt') - 'dispatcherLeaseOwner'
  where job.id = job_row.id
  returning * into job_row;

  return jsonb_build_object(
    'jobId', job_row.id,
    'state', job_row.state,
    'availableAt', job_row.available_at
  );
end;
$$;

create or replace function public.service_realtime_invalidation_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'queued', count(*) filter (where job.state = 'queued'),
    'retryWait', count(*) filter (where job.state = 'retry_wait'),
    'running', count(*) filter (where job.state = 'running'),
    'succeeded', count(*) filter (where job.state = 'succeeded'),
    'deadLetter', count(*) filter (where job.state = 'dead_letter'),
    'oldestReadyAt', min(job.available_at) filter (
      where job.state in ('queued', 'retry_wait')
    ),
    'oldestDeadLetterAt', min(job.completed_at) filter (
      where job.state = 'dead_letter'
    )
  )
  from public.workflow_jobs job
  where job.handler_key = 'realtime.invalidation.broadcast'
    and job.handler_version = 1
$$;

revoke all on function public.build_platform_invalidation_payload(uuid,text,text,uuid,jsonb,timestamp with time zone)
  from public, anon, authenticated;
revoke all on function public.enqueue_platform_invalidation()
  from public, anon, authenticated;
revoke all on function public.service_dispatch_realtime_invalidation_jobs(integer)
  from public, anon, authenticated;
revoke all on function public.service_requeue_realtime_invalidation_job(uuid)
  from public, anon, authenticated;
revoke all on function public.service_realtime_invalidation_health()
  from public, anon, authenticated;

grant execute on function public.service_dispatch_realtime_invalidation_jobs(integer)
  to service_role;
grant execute on function public.service_requeue_realtime_invalidation_job(uuid)
  to service_role;
grant execute on function public.service_realtime_invalidation_health()
  to service_role;

comment on function public.service_dispatch_realtime_invalidation_jobs(integer) is
  'Claims due Realtime invalidation jobs with SKIP LOCKED, broadcasts safe cache hints, and records retry or dead-letter state.';
comment on function public.service_requeue_realtime_invalidation_job(uuid) is
  'Server-only replay control for a Realtime invalidation workflow job.';
comment on function public.service_realtime_invalidation_health() is
  'Server-only queue health summary for Realtime invalidation workflow jobs.';

-- Supabase projects expose pg_cron as an available extension. The conditional
-- keeps plain-Postgres migration validation portable while ensuring the linked
-- candidate project installs the scheduler as part of the schema release.
do $migration$
begin
  if exists (
    select 1
    from pg_available_extensions
    where name = 'pg_cron'
  ) then
    execute 'create extension if not exists pg_cron';
    execute format(
      'select cron.schedule(%L, %L, %L)',
      'sitrail-realtime-invalidation-dispatch',
      '10 seconds',
      'select public.service_dispatch_realtime_invalidation_jobs(50);'
    );
  end if;
end;
$migration$;

commit;
