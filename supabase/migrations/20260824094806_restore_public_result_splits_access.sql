-- Restore anonymous access to the privacy-filtered checkpoint split read model
-- consumed by the public results table. The anonymous function hardening
-- migration revoked this reviewed RPC but omitted it from the explicit public
-- read allowlist, causing the entire expanded results query to fall back to an
-- empty shell when checkpoint splits could not be loaded.

grant execute on function public.public_event_result_splits(uuid)
  to anon;

do $$
begin
  if not has_function_privilege(
    'anon',
    'public.public_event_result_splits(uuid)',
    'execute'
  ) then
    raise exception 'Anonymous public event result splits RPC grant is missing';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) privilege
    where procedure.oid =
      'public.public_event_result_splits(uuid)'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Public role must not execute the public event result splits RPC';
  end if;
end
$$;
