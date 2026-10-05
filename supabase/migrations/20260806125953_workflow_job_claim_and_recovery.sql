begin;

create index workflow_jobs_handler_claim_idx
  on public.workflow_jobs (handler_key, state, available_at, priority, created_at)
  where handler_key in (
    'result.run.compute',
    'league.publication.propagate',
    'league.standings.compute'
  )
  and state in ('queued', 'retry_wait');

create index workflow_jobs_expired_lease_idx
  on public.workflow_jobs (locked_at, priority, created_at)
  where handler_key in (
    'result.run.compute',
    'league.publication.propagate',
    'league.standings.compute'
  )
  and state = 'running';

create index result_runs_workflow_reference_idx
  on public.result_runs (trigger_reference_id, started_at desc)
  where trigger_reference_id is not null;

create or replace function public.service_claim_workflow_jobs(
  p_handler_keys text[],
  p_limit integer,
  p_lease_owner uuid,
  p_lease_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_jobs jsonb;
begin
  if p_lease_owner is null
     or coalesce(cardinality(p_handler_keys), 0) not between 1 and 3
     or p_limit is null
     or p_limit not between 1 and 25
     or p_lease_seconds is null
     or p_lease_seconds not between 60 and 3600
     or array_position(p_handler_keys, null) is not null
     or exists (
       select 1
       from unnest(p_handler_keys) as requested(handler_key)
       where requested.handler_key not in (
         'result.run.compute',
         'league.publication.propagate',
         'league.standings.compute'
       )
     ) then
    raise exception using errcode = '22023', message = 'workflow_claim_input_invalid';
  end if;

  -- A worker that exhausted its attempts before releasing a lease cannot be
  -- reclaimed. Move it to the terminal state so it remains visible to health
  -- checks and can be explicitly replayed by an operator.
  update public.workflow_jobs job
  set
    state = 'dead_letter',
    last_error_code = 'workflow_lease_exhausted',
    locked_at = null,
    lease_owner = null,
    completed_at = clock_timestamp()
  where job.handler_key = any(p_handler_keys)
    and job.handler_key in (
      'result.run.compute',
      'league.publication.propagate',
      'league.standings.compute'
    )
    and job.state = 'running'
    and job.locked_at <= clock_timestamp() - make_interval(secs => p_lease_seconds)
    and job.attempt_count >= job.max_attempts;

  with candidates as (
    select job.id
    from public.workflow_jobs job
    where job.handler_key = any(p_handler_keys)
      and job.handler_key in (
        'result.run.compute',
        'league.publication.propagate',
        'league.standings.compute'
      )
      and job.attempt_count < job.max_attempts
      and (
        (
          job.state in ('queued', 'retry_wait')
          and job.available_at <= clock_timestamp()
        )
        or (
          job.state = 'running'
          and job.locked_at <= clock_timestamp() - make_interval(secs => p_lease_seconds)
        )
      )
    order by job.priority, job.available_at, job.created_at, job.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.workflow_jobs job
    set
      state = 'running',
      attempt_count = job.attempt_count + 1,
      locked_at = clock_timestamp(),
      lease_owner = p_lease_owner,
      completed_at = null
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'jobId', claimed.id,
        'handlerKey', claimed.handler_key,
        'handlerVersion', claimed.handler_version,
        'domainEventId', claimed.domain_event_id,
        'organizationId', claimed.organization_id,
        'eventType', event.event_type,
        'aggregateType', event.aggregate_type,
        'aggregateId', event.aggregate_id,
        'actorUserId', event.actor_user_id,
        'eventOccurredAt', event.occurred_at,
        'attemptCount', claimed.attempt_count,
        'maxAttempts', claimed.max_attempts,
        'result', claimed.result_json
      )
      order by claimed.priority, claimed.available_at, claimed.created_at, claimed.id
    ),
    '[]'::jsonb
  )
  into claimed_jobs
  from claimed
  join public.domain_events event on event.id = claimed.domain_event_id;

  return jsonb_build_object(
    'leaseOwner', p_lease_owner,
    'leaseSeconds', p_lease_seconds,
    'jobs', claimed_jobs
  );
end;
$$;

create or replace function public.service_record_claimed_workflow_job_failure(
  p_workflow_job_id uuid,
  p_lease_owner uuid,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.workflow_jobs%rowtype;
  next_state text;
  retry_delay_seconds integer;
begin
  if p_workflow_job_id is null
     or p_lease_owner is null
     or nullif(trim(p_error_code), '') is null then
    raise exception using errcode = '22023', message = 'claimed_workflow_failure_input_invalid';
  end if;

  select job.*
  into job_row
  from public.workflow_jobs job
  where job.id = p_workflow_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workflow_job_not_found';
  end if;
  if job_row.handler_key not in (
    'result.run.compute',
    'league.publication.propagate',
    'league.standings.compute'
  ) then
    raise exception using errcode = 'P0001', message = 'workflow_job_handler_not_recoverable';
  end if;
  if job_row.state <> 'running' then
    return jsonb_build_object(
      'jobId', job_row.id,
      'state', job_row.state,
      'attemptCount', job_row.attempt_count,
      'replayed', true
    );
  end if;
  if job_row.lease_owner is distinct from p_lease_owner then
    raise exception using errcode = '55000', message = 'workflow_job_lease_mismatch';
  end if;

  next_state := case
    when job_row.attempt_count >= job_row.max_attempts then 'dead_letter'
    else 'retry_wait'
  end;
  retry_delay_seconds := least(
    900,
    (
      30 * power(
        2,
        least(greatest(job_row.attempt_count - 1, 0), 5)
      )
    )::integer
  );

  update public.workflow_jobs job
  set
    state = next_state,
    available_at = case
      when next_state = 'retry_wait'
        then clock_timestamp() + make_interval(secs => retry_delay_seconds)
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

create or replace function public.service_requeue_workflow_job(
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
    raise exception using errcode = '22023', message = 'workflow_requeue_input_invalid';
  end if;

  select job.*
  into job_row
  from public.workflow_jobs job
  where job.id = p_workflow_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workflow_job_not_found';
  end if;
  if job_row.handler_key not in (
    'result.run.compute',
    'league.publication.propagate',
    'league.standings.compute'
  ) then
    raise exception using errcode = 'P0001', message = 'workflow_job_handler_not_recoverable';
  end if;
  if job_row.state = 'succeeded' then
    return jsonb_build_object(
      'jobId', job_row.id,
      'state', job_row.state,
      'replayed', true
    );
  end if;
  if job_row.state not in ('dead_letter', 'retry_wait') then
    raise exception using errcode = '55000', message = 'workflow_job_not_requeueable';
  end if;

  update public.workflow_jobs job
  set
    state = 'queued',
    attempt_count = 0,
    available_at = clock_timestamp(),
    last_error_code = null,
    locked_at = null,
    lease_owner = null,
    completed_at = null
  where job.id = job_row.id
  returning * into job_row;

  return jsonb_build_object(
    'jobId', job_row.id,
    'state', job_row.state,
    'attemptCount', job_row.attempt_count,
    'replayed', false
  );
end;
$$;

create or replace function public.service_workflow_queue_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with filtered_jobs as (
    select job.*
    from public.workflow_jobs job
    where job.handler_key in (
      'result.run.compute',
      'league.publication.propagate',
      'league.standings.compute'
    )
  ), handler_counts as (
    select grouped.handler_key, grouped.state, count(*) as state_count
    from filtered_jobs grouped
    group by grouped.handler_key, grouped.state
  ), handler_summary as (
    select
      counted.handler_key,
      jsonb_object_agg(counted.state, counted.state_count) as counts
    from handler_counts counted
    group by counted.handler_key
  )
  select jsonb_build_object(
    'ready', count(*) filter (
      where job.state in ('queued', 'retry_wait')
        and job.available_at <= now()
    ),
    'scheduledRetry', count(*) filter (
      where job.state = 'retry_wait'
        and job.available_at > now()
    ),
    'running', count(*) filter (where job.state = 'running'),
    'expiredLease', count(*) filter (
      where job.state = 'running'
        and job.locked_at <= now() - interval '10 minutes'
    ),
    'deadLetter', count(*) filter (where job.state = 'dead_letter'),
    'oldestReadyAt', min(job.available_at) filter (
      where job.state in ('queued', 'retry_wait')
        and job.available_at <= now()
    ),
    'byHandler', (
      select coalesce(
        jsonb_object_agg(summary.handler_key, summary.counts),
        '{}'::jsonb
      )
      from handler_summary summary
    )
  )
  from filtered_jobs job;
$$;

revoke all on function public.service_claim_workflow_jobs(text[],integer,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.service_record_claimed_workflow_job_failure(uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.service_requeue_workflow_job(uuid)
  from public, anon, authenticated;
revoke all on function public.service_workflow_queue_health()
  from public, anon, authenticated;

grant execute on function public.service_claim_workflow_jobs(text[],integer,uuid,integer)
  to service_role;
grant execute on function public.service_record_claimed_workflow_job_failure(uuid,uuid,text)
  to service_role;
grant execute on function public.service_requeue_workflow_job(uuid)
  to service_role;
grant execute on function public.service_workflow_queue_health()
  to service_role;

comment on function public.service_claim_workflow_jobs(text[],integer,uuid,integer) is
  'Claims due result and league workflow jobs with skip-locked leases for an external recovery worker.';
comment on function public.service_record_claimed_workflow_job_failure(uuid,uuid,text) is
  'Releases a claimed workflow job into exponential retry or dead-letter state after validating lease ownership.';
comment on function public.service_requeue_workflow_job(uuid) is
  'Explicitly replays a recoverable retry or dead-letter workflow job.';
comment on function public.service_workflow_queue_health() is
  'Returns aggregate health for recoverable result and league workflows without exposing domain payloads.';

commit;
