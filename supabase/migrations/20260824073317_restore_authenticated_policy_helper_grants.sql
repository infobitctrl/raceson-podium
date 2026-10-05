-- The anonymous-function hardening migration revoked EXECUTE from PUBLIC.
-- Authenticated users had inherited that privilege, so the revocation also
-- made policy helper functions unavailable while evaluating authenticated
-- RLS policies. Grant only the public-schema functions that policies applying
-- to authenticated users directly depend on, including Storage policies.

begin;

do $$
declare
  policy_function regprocedure;
begin
  for policy_function in
    select distinct procedure.oid::regprocedure
    from pg_policy policy
    join pg_depend dependency
      on dependency.classid = 'pg_policy'::regclass
     and dependency.objid = policy.oid
    join pg_proc procedure
      on dependency.refclassid = 'pg_proc'::regclass
     and dependency.refobjid = procedure.oid
    join pg_namespace function_namespace
      on function_namespace.oid = procedure.pronamespace
    where function_namespace.nspname = 'public'
      and (
        0 = any(policy.polroles)
        or 'authenticated'::regrole::oid = any(policy.polroles)
      )
  loop
    execute format(
      'grant execute on function %s to authenticated',
      policy_function
    );
  end loop;
end
$$;

do $$
declare
  missing_function text;
begin
  select procedure.oid::regprocedure::text
    into missing_function
  from pg_policy policy
  join pg_depend dependency
    on dependency.classid = 'pg_policy'::regclass
   and dependency.objid = policy.oid
  join pg_proc procedure
    on dependency.refclassid = 'pg_proc'::regclass
   and dependency.refobjid = procedure.oid
  join pg_namespace function_namespace
    on function_namespace.oid = procedure.pronamespace
  where function_namespace.nspname = 'public'
    and (
      0 = any(policy.polroles)
      or 'authenticated'::regrole::oid = any(policy.polroles)
    )
    and not has_function_privilege(
      'authenticated',
      procedure.oid,
      'EXECUTE'
    )
  order by procedure.oid::regprocedure::text
  limit 1;

  if missing_function is not null then
    raise exception
      'Authenticated RLS policy helper lacks EXECUTE: %',
      missing_function;
  end if;
end
$$;

commit;
