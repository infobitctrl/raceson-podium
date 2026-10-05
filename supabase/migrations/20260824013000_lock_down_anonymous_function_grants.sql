-- Fail closed for Data API function execution.
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default, and this
-- project historically also granted every new public-schema function directly
-- to anon.  Keep the anonymous RPC surface limited to the reviewed public read
-- models below; authenticated and service_role grants are intentionally left
-- unchanged.

do $$
declare
  application_function regprocedure;
begin
  for application_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
  loop
    execute format(
      'revoke execute on function %s from public, anon',
      application_function
    );
  end loop;
end
$$;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

-- RLS is evaluated with the caller's privileges. Grant only the helper
-- functions that are direct dependencies of policies on anonymously readable
-- tables/views. This keeps public reads working without exposing unrelated
-- command or administration functions.
do $$
declare
  policy_function regprocedure;
begin
  for policy_function in
    select distinct p.oid::regprocedure
    from pg_policy policy
    join pg_class relation
      on relation.oid = policy.polrelid
    join pg_namespace relation_namespace
      on relation_namespace.oid = relation.relnamespace
    join pg_depend dependency
      on dependency.classid = 'pg_policy'::regclass
     and dependency.objid = policy.oid
    join pg_proc p
      on dependency.refclassid = 'pg_proc'::regclass
     and dependency.refobjid = p.oid
    where relation_namespace.nspname = 'public'
      and has_table_privilege('anon', relation.oid, 'select')
  loop
    execute format('grant execute on function %s to anon', policy_function);
  end loop;
end
$$;

grant execute on function public.read_public_live_edition(uuid)
  to anon;

grant execute on function public.public_event_participants(uuid)
  to anon;

grant execute on function public.public_registration_counts(uuid[])
  to anon;

grant execute on function public.public_athlete_age_categories()
  to anon;

do $$
declare
  unexpected_function text;
begin
  select p.oid::regprocedure::text
    into unexpected_function
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'execute')
    and not exists (
      select 1
      from pg_depend d
      where d.classid = 'pg_proc'::regclass
        and d.objid = p.oid
        and d.deptype = 'e'
    )
    and p.oid <> all (
      array[
        'public.read_public_live_edition(uuid)'::regprocedure::oid,
        'public.public_event_participants(uuid)'::regprocedure::oid,
        'public.public_registration_counts(uuid[])'::regprocedure::oid,
        'public.public_athlete_age_categories()'::regprocedure::oid
      ]
    )
    and not exists (
      select 1
      from pg_policy policy
      join pg_class relation
        on relation.oid = policy.polrelid
      join pg_namespace relation_namespace
        on relation_namespace.oid = relation.relnamespace
      join pg_depend dependency
        on dependency.classid = 'pg_policy'::regclass
       and dependency.objid = policy.oid
      where relation_namespace.nspname = 'public'
        and has_table_privilege('anon', relation.oid, 'select')
        and dependency.refclassid = 'pg_proc'::regclass
        and dependency.refobjid = p.oid
    )
  order by p.oid::regprocedure::text
  limit 1;

  if unexpected_function is not null then
    raise exception
      'Unexpected anonymous function execution privilege remains: %',
      unexpected_function;
  end if;

  if not has_function_privilege(
    'anon',
    'public.read_public_live_edition(uuid)',
    'execute'
  ) or not has_function_privilege(
    'anon',
    'public.public_event_participants(uuid)',
    'execute'
  ) or not has_function_privilege(
    'anon',
    'public.public_registration_counts(uuid[])',
    'execute'
  ) or not has_function_privilege(
    'anon',
    'public.public_athlete_age_categories()',
    'execute'
  ) then
    raise exception 'Anonymous public read RPC allowlist is incomplete';
  end if;
end
$$;
