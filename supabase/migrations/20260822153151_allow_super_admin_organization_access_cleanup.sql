begin;

create or replace function public.prevent_access_control_evidence_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.platform_organization_delete', true) = 'enabled'
     and tg_table_schema = 'public'
     and tg_table_name in (
       'organization_custom_role_permissions',
       'organization_access_events'
     ) then
    return old;
  end if;

  raise exception using
    errcode = '55000',
    message = 'access_control_evidence_is_append_only';
end;
$$;

create or replace function public.protect_versioned_access_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('app.platform_organization_delete', true) = 'enabled'
       and tg_table_schema = 'public'
       and tg_table_name = 'organization_custom_role_versions' then
      return old;
    end if;

    raise exception using
      errcode = '55000',
      message = 'access_control_evidence_is_append_only';
  end if;

  if (to_jsonb(new) - 'version_state')
       is distinct from (to_jsonb(old) - 'version_state')
     or old.version_state <> 'active'
     or new.version_state not in ('superseded', 'archived') then
    raise exception using
      errcode = '55000',
      message = 'access_control_version_is_immutable';
  end if;

  return new;
end;
$$;

create or replace function public.service_delete_platform_organization(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_confirmation_name text,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_organization public.organizations%rowtype;
  reason_text text := nullif(btrim(p_reason), '');
  dependency record;
  has_dependency boolean;
  affected_rows integer;
  membership_count integer := 0;
  temporary_account_count integer := 0;
  custom_role_count integer := 0;
  access_event_count integer := 0;
  audit_entry_count integer := 0;
begin
  if not exists (
    select 1
    from public.platform_administrators administrator
    where administrator.user_id = p_actor_user_id
      and administrator.platform_role = 'super_admin'
      and administrator.is_active
  ) then
    raise exception using
      errcode = '42501',
      message = 'platform_super_admin_required';
  end if;

  select organization.*
  into target_organization
  from public.organizations organization
  where organization.id = p_organization_id
    and organization.kind = 'organizer'
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'organization_not_found';
  end if;

  if nullif(btrim(p_confirmation_name), '') is distinct from target_organization.name then
    raise exception using
      errcode = '22023',
      message = 'organization_deletion_confirmation_mismatch';
  end if;

  if reason_text is null or length(reason_text) not between 8 and 1000 then
    raise exception using
      errcode = '22023',
      message = 'platform_management_reason_invalid';
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
      and foreign_key.conrelid not in (
        'public.organization_memberships'::regclass,
        'public.organization_custom_roles'::regclass,
        'public.organization_member_role_assignments'::regclass,
        'public.organization_direct_permission_grants'::regclass,
        'public.organization_access_events'::regclass,
        'public.audit_log'::regclass
      )
      and foreign_key.confdeltype not in ('n', 'd')
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
        detail = format('%I.%I', dependency.schema_name, dependency.table_name);
    end if;
  end loop;

  select count(*)
  into membership_count
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id;

  select count(distinct membership.user_id)
  into temporary_account_count
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.membership_type = 'temporary';

  select count(*)
  into custom_role_count
  from public.organization_custom_roles custom_role
  where custom_role.organization_id = p_organization_id;

  select count(*)
  into access_event_count
  from public.organization_access_events access_event
  where access_event.organization_id = p_organization_id;

  select count(*)
  into audit_entry_count
  from public.audit_log audit_entry
  where audit_entry.organization_id = p_organization_id;

  insert into public.platform_management_actions (
    actor_user_id,
    target_kind,
    target_id,
    target_label,
    action,
    reason,
    detail_json
  ) values (
    p_actor_user_id,
    'organization',
    target_organization.id,
    target_organization.name,
    'organization_deleted',
    reason_text,
    jsonb_build_object(
      'slug', target_organization.slug,
      'status', target_organization.status,
      'cleanup', jsonb_build_object(
        'memberships', membership_count,
        'temporaryAccounts', temporary_account_count,
        'customRoles', custom_role_count,
        'accessEvents', access_event_count,
        'auditEntriesDetached', audit_entry_count
      )
    )
  );

  perform set_config('app.organization_owner_transfer', 'enabled', true);
  perform set_config('app.platform_organization_delete', 'enabled', true);

  update public.audit_log audit_entry
  set organization_id = null
  where audit_entry.organization_id = p_organization_id;

  delete from public.organization_access_events access_event
  where access_event.organization_id = p_organization_id;

  delete from public.organization_member_role_assignments assignment
  where assignment.organization_id = p_organization_id;

  delete from public.organization_direct_permission_grants permission_grant
  where permission_grant.organization_id = p_organization_id;

  delete from public.organization_memberships membership
  where membership.organization_id = p_organization_id;

  delete from public.organization_custom_role_permissions permission
  using public.organization_custom_role_versions role_version,
        public.organization_custom_roles custom_role
  where permission.organization_custom_role_version_id = role_version.id
    and role_version.organization_custom_role_id = custom_role.id
    and custom_role.organization_id = p_organization_id;

  delete from public.organization_custom_role_versions role_version
  using public.organization_custom_roles custom_role
  where role_version.organization_custom_role_id = custom_role.id
    and custom_role.organization_id = p_organization_id;

  delete from public.organization_custom_roles custom_role
  where custom_role.organization_id = p_organization_id;

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
    'deleted', true,
    'cleanup', jsonb_build_object(
      'memberships', membership_count,
      'temporaryAccounts', temporary_account_count,
      'customRoles', custom_role_count,
      'accessEvents', access_event_count,
      'auditEntriesDetached', audit_entry_count
    )
  );
end;
$$;

comment on function public.service_delete_platform_organization(uuid, uuid, text, text) is
  'Deletes a business-empty organizer workspace for a super administrator, including disposable memberships and organization-only access configuration, while preserving a platform audit summary.';

revoke all on function public.service_delete_platform_organization(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_delete_platform_organization(uuid, uuid, text, text)
  to service_role;

commit;
