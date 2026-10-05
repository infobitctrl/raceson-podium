-- Restore anonymous access to the privacy-safe aggregate used by the public
-- results directory. The preceding function hardening migration intentionally
-- revoked anonymous execution broadly, but omitted this reviewed read model
-- from its explicit allowlist.

grant execute on function public.public_results_directory_category_states()
  to anon;

do $$
begin
  if not has_function_privilege(
    'anon',
    'public.public_results_directory_category_states()',
    'execute'
  ) then
    raise exception 'Anonymous public results directory RPC grant is missing';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) privilege
    where procedure.oid =
      'public.public_results_directory_category_states()'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Public role must not execute the public results directory RPC';
  end if;
end
$$;
