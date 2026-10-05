begin;

-- Plain PostgreSQL validation installations may not provide Supabase's pg_net.
-- Production activation explicitly requires this extension before scheduling.
do $migration$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
    -- Only the database operator's cron job needs outbound HTTP. This is not
    -- a browser RPC or a grant to ordinary application users.
    revoke usage on schema net from public, anon, authenticated;
    revoke execute on all functions in schema net from public, anon, authenticated;
  end if;
end;
$migration$;

commit;
