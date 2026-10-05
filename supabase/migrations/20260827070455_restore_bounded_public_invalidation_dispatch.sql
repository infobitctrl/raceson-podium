begin;

-- The August 13 migrations retired the original unbounded-runtime schedule,
-- leaving publication hints queued indefinitely. Keep that job retired and
-- provide a bounded replacement, including indexes for its pending-only scan.
create index if not exists workflow_jobs_realtime_ready_idx
  on public.workflow_jobs (priority, available_at, created_at, id)
  where handler_key = 'realtime.invalidation.broadcast'
    and handler_version = 1
    and state in ('queued', 'retry_wait');

create index if not exists workflow_jobs_realtime_expired_idx
  on public.workflow_jobs (locked_at)
  where handler_key = 'realtime.invalidation.broadcast'
    and handler_version = 1
    and state = 'running';

create or replace function public.service_run_public_invalidation_dispatch()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A manual recovery call must not overlap the scheduled worker. The lock is
  -- released on commit, timeout, or connection loss without a separate cleanup.
  if not pg_catalog.pg_try_advisory_xact_lock(72616365, 20260827) then
    return jsonb_build_object('skipped', true, 'reason', 'dispatcher_busy');
  end if;

  return public.service_dispatch_realtime_invalidation_jobs(25);
end;
$$;

revoke all on function public.service_run_public_invalidation_dispatch()
  from public, anon, authenticated;
grant execute on function public.service_run_public_invalidation_dispatch()
  to service_role;

comment on function public.service_run_public_invalidation_dispatch() is
  'Non-overlapping, 25-job public invalidation worker. The cron caller enforces a 5-second statement and 1-second lock timeout. Monitor cron.job_run_details and service_realtime_invalidation_health().';

do $migration$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    -- pg_cron serializes each named job; timeout < interval prevents a backlog
    -- of long-running invocations on constrained staging compute.
    execute format(
      'select cron.schedule(%L, %L, %L)',
      'raceson-public-invalidation-dispatch',
      '15 seconds',
      'set statement_timeout = ''5s''; set lock_timeout = ''1s''; select public.service_run_public_invalidation_dispatch();'
    );
  end if;
end;
$migration$;

commit;
