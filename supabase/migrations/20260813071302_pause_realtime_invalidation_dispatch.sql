begin;

-- Cache invalidation broadcasts are advisory: normal query lifecycles still
-- refresh clients. The scheduled dispatcher can overlap on constrained
-- staging compute and starve user-facing requests, so keep the durable outbox
-- but require an explicitly monitored worker to drain it.
do $migration$
begin
  if exists (
    select 1
    from pg_available_extensions
    where name = 'pg_cron'
  ) then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'sitrail-realtime-invalidation-dispatch';
  end if;
end;
$migration$;

commit;
