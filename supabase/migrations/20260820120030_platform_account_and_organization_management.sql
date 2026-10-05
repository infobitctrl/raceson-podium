begin;

create table public.platform_management_actions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  target_kind text not null,
  target_id uuid not null,
  target_label text not null,
  action text not null,
  reason text not null,
  detail_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (target_kind in ('account', 'organization')),
  check (length(btrim(target_label)) between 1 and 320),
  check (length(btrim(action)) between 1 and 100),
  check (length(btrim(reason)) between 8 and 1000)
);

comment on table public.platform_management_actions is
  'Append-only audit ledger for super-administrator account and organization changes.';

create index platform_management_actions_target_created_idx
  on public.platform_management_actions (target_kind, target_id, created_at desc);

create index platform_management_actions_actor_created_idx
  on public.platform_management_actions (actor_user_id, created_at desc);

alter table public.platform_management_actions enable row level security;
revoke all on table public.platform_management_actions from public, anon, authenticated, service_role;
grant select, insert on table public.platform_management_actions to service_role;

create or replace function public.prevent_platform_management_action_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'platform_management_actions_are_immutable';
end;
$$;

revoke all on function public.prevent_platform_management_action_mutation()
  from public, anon, authenticated, service_role;

create trigger platform_management_actions_immutable
before update or delete on public.platform_management_actions
for each row execute function public.prevent_platform_management_action_mutation();

create or replace function public.service_assert_platform_account_deletable(
  p_target_user_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
  target_role text;
  blocking_organizations text;
  storage_object_count bigint;
begin
  if p_target_user_id is null or p_actor_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'account_and_actor_are_required';
  end if;

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

  if p_target_user_id = p_actor_user_id then
    raise exception using
      errcode = '42501',
      message = 'super_admin_self_deletion_forbidden';
  end if;

  select auth_user.email
  into target_email
  from auth.users auth_user
  where auth_user.id = p_target_user_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'platform_account_not_found';
  end if;

  select administrator.platform_role
  into target_role
  from public.platform_administrators administrator
  where administrator.user_id = p_target_user_id
    and administrator.is_active;

  if target_role = 'super_admin' then
    raise exception using
      errcode = '42501',
      message = 'super_admin_account_deletion_forbidden';
  end if;

  if target_role = 'site_admin' then
    raise exception using
      errcode = '55000',
      message = 'deactivate_site_admin_before_account_deletion';
  end if;

  select string_agg(organization.name, ', ' order by organization.name)
  into blocking_organizations
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
  where membership.user_id = p_target_user_id
    and membership.role in ('owner', 'admin')
    and membership.status <> 'removed';

  if blocking_organizations is not null then
    raise exception using
      errcode = '55000',
      message = 'account_has_privileged_organization_access',
      detail = blocking_organizations;
  end if;

  select count(*)
  into storage_object_count
  from storage.objects object
  where object.owner = p_target_user_id
     or object.owner_id = p_target_user_id::text;

  if storage_object_count > 0 then
    raise exception using
      errcode = '55000',
      message = 'account_owns_storage_objects',
      detail = storage_object_count::text;
  end if;

  return jsonb_build_object(
    'userId', p_target_user_id,
    'email', target_email,
    'deletable', true
  );
end;
$$;

comment on function public.service_assert_platform_account_deletable(uuid, uuid) is
  'Server-only preflight for irreversible platform account deletion.';

revoke all on function public.service_assert_platform_account_deletable(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.service_assert_platform_account_deletable(uuid, uuid)
  to service_role;

create or replace function public.service_update_platform_account_profile(
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_display_name text,
  p_email text,
  p_credential_mode text,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_display_name text := nullif(btrim(p_display_name), '');
  next_email text := lower(nullif(btrim(p_email), ''));
  reason_text text := nullif(btrim(p_reason), '');
  previous_profile public.user_profiles%rowtype;
  previous_identifier public.account_login_identifiers%rowtype;
  target_label text;
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

  if next_display_name is null or length(next_display_name) not between 2 and 200 then
    raise exception using errcode = '22023', message = 'account_display_name_invalid';
  end if;
  if p_credential_mode not in ('email', 'username') then
    raise exception using errcode = '22023', message = 'account_credential_mode_invalid';
  end if;
  if p_credential_mode = 'email' and next_email is null then
    raise exception using errcode = '22023', message = 'email_account_requires_email';
  end if;
  if next_email is not null and next_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'account_email_invalid';
  end if;
  if reason_text is null or length(reason_text) not between 8 and 1000 then
    raise exception using errcode = '22023', message = 'platform_management_reason_invalid';
  end if;

  select profile.*
  into previous_profile
  from public.user_profiles profile
  where profile.user_id = p_target_user_id
  for update;

  select identifier.*
  into previous_identifier
  from public.account_login_identifiers identifier
  where identifier.user_id = p_target_user_id
  for update;

  if p_credential_mode = 'username' and previous_identifier.user_id is null then
    raise exception using errcode = '55000', message = 'username_account_identifier_missing';
  end if;

  begin
    insert into public.user_profiles (user_id, email, display_name)
    values (p_target_user_id, next_email, next_display_name)
    on conflict (user_id) do update
    set
      email = excluded.email,
      display_name = excluded.display_name,
      updated_at = now();

    if previous_identifier.user_id is not null then
      update public.account_login_identifiers identifier
      set email = next_email
      where identifier.user_id = p_target_user_id;
    end if;
  exception
    when unique_violation then
      raise exception using errcode = '23505', message = 'account_email_conflict';
  end;

  target_label := coalesce(next_email, previous_identifier.username::text, next_display_name);
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
    'account',
    p_target_user_id,
    target_label,
    'account_updated',
    reason_text,
    jsonb_build_object(
      'before', jsonb_build_object(
        'displayName', previous_profile.display_name,
        'email', case
          when p_credential_mode = 'username' then previous_identifier.email
          else previous_profile.email
        end
      ),
      'after', jsonb_build_object('displayName', next_display_name, 'email', next_email),
      'credentialMode', p_credential_mode
    )
  );

  return jsonb_build_object(
    'userId', p_target_user_id,
    'displayName', next_display_name,
    'email', next_email,
    'updated', true
  );
end;
$$;

comment on function public.service_update_platform_account_profile(uuid, uuid, text, text, text, text) is
  'Atomically updates service-owned account profile mappings and records the super-administrator reason.';

revoke all on function public.service_update_platform_account_profile(uuid, uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_update_platform_account_profile(uuid, uuid, text, text, text, text)
  to service_role;

create or replace function public.service_update_platform_organization(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_expected_slug text,
  p_name text,
  p_slug text,
  p_status text,
  p_contact_email text,
  p_country_code text,
  p_city text,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_organization public.organizations%rowtype;
  next_name text := nullif(btrim(p_name), '');
  next_slug text := lower(nullif(btrim(p_slug), ''));
  next_status text := lower(nullif(btrim(p_status), ''));
  next_contact_email text := lower(nullif(btrim(p_contact_email), ''));
  next_country_code text := upper(nullif(btrim(p_country_code), ''));
  next_city text := nullif(btrim(p_city), '');
  reason_text text := nullif(btrim(p_reason), '');
  affected_rows integer;
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

  if next_name is null or length(next_name) not between 2 and 200 then
    raise exception using errcode = '22023', message = 'organization_name_invalid';
  end if;
  if next_slug is null or next_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or length(next_slug) > 160 then
    raise exception using errcode = '22023', message = 'organization_slug_invalid';
  end if;
  if next_status not in ('active', 'inactive') then
    raise exception using errcode = '22023', message = 'organization_status_invalid';
  end if;
  if next_contact_email is not null and next_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'organization_contact_email_invalid';
  end if;
  if next_country_code is not null and next_country_code !~ '^[A-Z]{2}$' then
    raise exception using errcode = '22023', message = 'organization_country_code_invalid';
  end if;
  if reason_text is null or length(reason_text) not between 8 and 1000 then
    raise exception using errcode = '22023', message = 'platform_management_reason_invalid';
  end if;

  select organization.*
  into target_organization
  from public.organizations organization
  where organization.id = p_organization_id
    and organization.kind = 'organizer'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;

  if target_organization.slug is distinct from lower(nullif(btrim(p_expected_slug), '')) then
    raise exception using errcode = '40001', message = 'organization_update_conflict';
  end if;

  begin
    update public.organizations organization
    set
      name = next_name,
      slug = next_slug,
      status = next_status,
      contact_email = next_contact_email,
      country_code = next_country_code,
      city = next_city,
      updated_at = now()
    where organization.id = p_organization_id
      and organization.slug = target_organization.slug;
  exception
    when unique_violation then
      raise exception using errcode = '23505', message = 'organization_slug_conflict';
  end;

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using errcode = '40001', message = 'organization_update_conflict';
  end if;

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
    next_name,
    'organization_updated',
    reason_text,
    jsonb_build_object(
      'before', jsonb_build_object(
        'name', target_organization.name,
        'slug', target_organization.slug,
        'status', target_organization.status,
        'contactEmail', target_organization.contact_email,
        'countryCode', target_organization.country_code,
        'city', target_organization.city
      ),
      'after', jsonb_build_object(
        'name', next_name,
        'slug', next_slug,
        'status', next_status,
        'contactEmail', next_contact_email,
        'countryCode', next_country_code,
        'city', next_city
      )
    )
  );

  return jsonb_build_object(
    'organizationId', target_organization.id,
    'name', next_name,
    'slug', next_slug,
    'status', next_status,
    'updated', true
  );
end;
$$;

comment on function public.service_update_platform_organization(uuid, uuid, text, text, text, text, text, text, text, text) is
  'Atomically updates an organizer workspace and records the super-administrator reason.';

revoke all on function public.service_update_platform_organization(uuid, uuid, text, text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_update_platform_organization(uuid, uuid, text, text, text, text, text, text, text, text)
  to service_role;

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
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;

  if nullif(btrim(p_confirmation_name), '') is distinct from target_organization.name then
    raise exception using
      errcode = '22023',
      message = 'organization_deletion_confirmation_mismatch';
  end if;

  if reason_text is null or length(reason_text) not between 8 and 1000 then
    raise exception using errcode = '22023', message = 'platform_management_reason_invalid';
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
        detail = format('%I.%I', dependency.schema_name, dependency.table_name);
    end if;
  end loop;

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
      'status', target_organization.status
    )
  );

  perform set_config('app.organization_owner_transfer', 'enabled', true);

  delete from public.organizations organization
  where organization.id = p_organization_id;

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using errcode = '40001', message = 'organization_deletion_conflict';
  end if;

  return jsonb_build_object(
    'organizationId', target_organization.id,
    'organizationName', target_organization.name,
    'deleted', true
  );
end;
$$;

comment on function public.service_delete_platform_organization(uuid, uuid, text, text) is
  'Deletes an empty organizer workspace after super-administrator confirmation and audit logging.';

revoke all on function public.service_delete_platform_organization(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_delete_platform_organization(uuid, uuid, text, text)
  to service_role;

commit;
