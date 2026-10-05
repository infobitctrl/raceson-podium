begin;

create or replace function public.service_delete_unused_organizer_workspace(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_confirmation_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_organization public.organizations%rowtype;
  owner_membership public.organization_memberships%rowtype;
  dependency record;
  has_dependency boolean;
  affected_rows integer;
begin
  if p_actor_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'organization_owner_required';
  end if;

  select organization.*
  into target_organization
  from public.organizations organization
  where organization.id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'organization_not_found';
  end if;

  if target_organization.kind <> 'organizer' then
    raise exception using
      errcode = '23514',
      message = 'organizer_workspace_required';
  end if;

  if nullif(btrim(p_confirmation_name), '') is distinct from target_organization.name then
    raise exception using
      errcode = '22023',
      message = 'organization_deletion_confirmation_mismatch';
  end if;

  select membership.*
  into owner_membership
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_actor_user_id
    and membership.role = 'owner'
    and membership.status = 'active'
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'organization_owner_required';
  end if;

  if exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.id <> owner_membership.id
      and membership.status <> 'removed'
  ) then
    raise exception using
      errcode = '55000',
      message = 'organization_has_other_team_accounts';
  end if;

  for dependency in
    select
      namespace.nspname as schema_name,
      relation.relname as table_name,
      attribute.attname as column_name
    from pg_catalog.pg_constraint foreign_key
    join pg_catalog.pg_class relation
      on relation.oid = foreign_key.conrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join unnest(foreign_key.conkey) with ordinality as key_column(attnum, ordinal_position)
      on true
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = foreign_key.conrelid
     and attribute.attnum = key_column.attnum
    where foreign_key.contype = 'f'
      and foreign_key.confrelid = 'public.organizations'::regclass
      and foreign_key.conrelid <> 'public.organization_memberships'::regclass
      and cardinality(foreign_key.conkey) = 1
      and cardinality(foreign_key.confkey) = 1
  loop
    execute format(
      'select exists (select 1 from %I.%I where %I = $1)',
      dependency.schema_name,
      dependency.table_name,
      dependency.column_name
    )
    into has_dependency
    using p_organization_id;

    if has_dependency then
      raise exception using
        errcode = '55000',
        message = 'organization_not_empty',
        detail = format(
          'Organization data still exists in %I.%I.',
          dependency.schema_name,
          dependency.table_name
        );
    end if;
  end loop;

  perform set_config('app.organization_owner_transfer', 'enabled', true);

  delete from public.organizations organization
  where organization.id = p_organization_id;

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using
      errcode = '40001',
      message = 'organization_deletion_conflict';
  end if;

  return jsonb_build_object(
    'organizationId', target_organization.id,
    'organizationName', target_organization.name,
    'deleted', true
  );
end;
$$;

comment on function public.service_delete_unused_organizer_workspace(uuid, uuid, text) is
  'Deletes an unused organizer workspace after verifying the active owner and exact display-name confirmation.';

revoke all on function public.service_delete_unused_organizer_workspace(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_delete_unused_organizer_workspace(uuid, uuid, text)
  to service_role;

commit;
