/*
 * SiTrail V2 platform administration boundary.
 *
 * Platform administrators are intentionally separate from organization
 * memberships. The browser never decides this role; account context is built
 * by the API with the service-role client and every authorization helper checks
 * the server-owned table.
 */

create table public.platform_administrators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  platform_role text not null default 'master_admin',
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (platform_role in ('master_admin'))
);
alter table public.platform_administrators enable row level security;
revoke all on table public.platform_administrators from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_administrators to service_role;
create or replace function public.is_active_platform_administrator(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_administrators administrator
    where administrator.user_id = p_user_id
      and administrator.is_active
      and administrator.platform_role = 'master_admin'
  )
$$;
revoke all on function public.is_active_platform_administrator(uuid) from public, anon, authenticated;
grant execute on function public.is_active_platform_administrator(uuid) to service_role;
create or replace function public.is_organization_member(
  target_organization_id uuid,
  allowed_roles public.organization_membership_role[]
    default array['owner', 'admin', 'staff', 'timer']::public.organization_membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_platform_administrator(public.request_user_id())
    or exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = public.request_user_id()
        and membership.status = 'active'
        and membership.role = any (allowed_roles)
    )
$$;
create or replace function public.can_manage_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_platform_administrator(public.request_user_id())
    or public.is_organization_member(
      target_organization_id,
      array['owner', 'admin', 'staff']::public.organization_membership_role[]
    )
$$;
create or replace function public.can_time_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_platform_administrator(public.request_user_id())
    or public.is_organization_member(
      target_organization_id,
      array['owner', 'admin', 'staff', 'timer']::public.organization_membership_role[]
    )
$$;
create or replace function public.service_user_has_organization_permission(
  p_organization_id uuid,
  p_user_id uuid,
  p_permission_code text,
  p_scope_type text default 'organization',
  p_scope_id uuid default null,
  p_effective_at timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  membership_role public.organization_membership_role;
  catalog_row public.organization_permission_catalog%rowtype;
begin
  if p_organization_id is null
     or p_user_id is null
     or p_permission_code is null
     or p_scope_type not in ('organization', 'event_edition', 'event_category') then
    return false;
  end if;

  if public.is_active_platform_administrator(p_user_id) then
    return true;
  end if;

  select membership.role
  into membership_role
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_user_id
    and membership.status = 'active';
  if not found then
    return false;
  end if;

  if membership_role in ('owner', 'admin') then
    return true;
  end if;

  select *
  into catalog_row
  from public.organization_permission_catalog permission
  where permission.permission_code = p_permission_code
    and permission.is_active;
  if not found then
    return false;
  end if;

  if membership_role = 'staff' and catalog_row.staff_default then
    return true;
  end if;
  if membership_role = 'timer' and catalog_row.timer_default then
    return true;
  end if;

  if exists (
    select 1
    from public.organization_member_role_assignments assignment
    join public.organization_custom_roles custom_role
      on custom_role.id = assignment.organization_custom_role_id
    join public.organization_custom_role_versions role_version
      on role_version.organization_custom_role_id = custom_role.id
     and role_version.version_state = 'active'
    join public.organization_custom_role_permissions role_permission
      on role_permission.organization_custom_role_version_id = role_version.id
    where assignment.organization_id = p_organization_id
      and assignment.user_id = p_user_id
      and assignment.assignment_state = 'active'
      and assignment.starts_at <= p_effective_at
      and (assignment.ends_at is null or assignment.ends_at > p_effective_at)
      and custom_role.role_state = 'active'
      and role_permission.permission_code = p_permission_code
      and (
        assignment.scope_type = 'organization'
        or (
          assignment.scope_type = p_scope_type
          and assignment.scope_id = p_scope_id
        )
      )
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.organization_direct_permission_grants direct_grant
    where direct_grant.organization_id = p_organization_id
      and direct_grant.user_id = p_user_id
      and direct_grant.permission_code = p_permission_code
      and direct_grant.grant_state = 'active'
      and direct_grant.starts_at <= p_effective_at
      and direct_grant.ends_at > p_effective_at
      and (
        direct_grant.scope_type = 'organization'
        or (
          direct_grant.scope_type = p_scope_type
          and direct_grant.scope_id = p_scope_id
        )
      )
  );
end;
$$;
revoke all on function public.service_user_has_organization_permission(
  uuid,
  uuid,
  text,
  text,
  uuid,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.service_user_has_organization_permission(
  uuid,
  uuid,
  text,
  text,
  uuid,
  timestamptz
) to service_role;
comment on table public.platform_administrators is
  'Server-owned global SiTrail administrators. Never infer this role from browser metadata.';
