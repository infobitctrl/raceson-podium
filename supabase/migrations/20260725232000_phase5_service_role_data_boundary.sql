-- SiTrail V2 Phase 5: explicit server data boundary.
--
-- A clean Supabase schema grants service_role function execution but does not
-- guarantee direct DML privileges on tables created by migrations. The API
-- uses a server-only service-role client to compose governed read models and
-- must be able to read/write those tables while browser roles remain governed
-- by their existing RLS policies and per-object grants.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
do $service_boundary$
begin
  if not has_table_privilege('service_role', 'public.user_profiles', 'SELECT')
     or not has_table_privilege('service_role', 'public.organization_memberships', 'SELECT')
     or not has_table_privilege('service_role', 'public.partner_api_clients', 'UPDATE') then
    raise exception 'service_role_data_boundary_incomplete';
  end if;

  if has_table_privilege('anon', 'public.partner_api_clients', 'SELECT')
     or has_table_privilege('authenticated', 'public.partner_api_clients', 'SELECT')
     or has_table_privilege('anon', 'public.historical_import_records', 'SELECT')
     or has_table_privilege('authenticated', 'public.historical_import_records', 'SELECT') then
    raise exception 'private_phase5_table_exposed_to_browser_role';
  end if;
end
$service_boundary$;
