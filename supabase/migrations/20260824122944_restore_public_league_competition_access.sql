-- Restore anonymous access to the publication-filtered competition definition
-- read model consumed by public league statistics. The anonymous function
-- hardening migration revoked this reviewed RPC but omitted it from the
-- explicit public-read allowlist, hiding Short/Long rank and club progression
-- even though the season, mappings, and standings were published.

grant execute on function public.public_league_competition_definitions(uuid)
  to anon;

do $$
begin
  if not has_function_privilege(
    'anon',
    'public.public_league_competition_definitions(uuid)',
    'execute'
  ) then
    raise exception 'Anonymous public league competition definitions RPC grant is missing';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) privilege
    where procedure.oid =
      'public.public_league_competition_definitions(uuid)'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Public role must not execute the public league competition definitions RPC';
  end if;
end
$$;
