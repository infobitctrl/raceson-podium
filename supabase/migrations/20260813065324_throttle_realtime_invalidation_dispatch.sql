begin;

-- Cache invalidation broadcasts are advisory: clients also refresh on normal
-- query lifecycles. A scheduled dispatcher can overlap on constrained compute
-- and starve user-facing requests, so keep the durable outbox but let the
-- application or an explicitly monitored worker drain it.
do $migration$
begin
  if exists (
    select 1
    from pg_available_extensions
    where name = 'pg_cron'
  ) then
    execute
      'select cron.unschedule(jobid) from cron.job where jobname = $1'
      using 'sitrail-realtime-invalidation-dispatch';

  end if;
end;
$migration$;

commit;
