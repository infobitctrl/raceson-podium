begin;

-- Build-time metadata only. This deliberately does not expose SQL statements,
-- application rows, credentials, or migration history to browser roles.
-- SECURITY DEFINER permits one fixed read of the private CLI-owned ledger;
-- only the server service role may execute it. No user identity is accepted.
create function public.service_release_readiness()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  versions jsonb;
begin
  select coalesce(jsonb_agg(version order by version), '[]'::jsonb)
    into versions
  from supabase_migrations.schema_migrations;
  return jsonb_build_object('contractVersion', 1, 'migrationVersions', versions);
end;
$$;

revoke all on function public.service_release_readiness() from public, anon, authenticated;
grant execute on function public.service_release_readiness() to service_role;
comment on function public.service_release_readiness() is
  'Server-only read-only deployment preflight; not authorization to migrate or bypass recovery checks.';

commit;
