begin;

create table if not exists public.platform_administrators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.platform_administrators enable row level security;
revoke all on table public.platform_administrators from public, anon, authenticated;
grant all on table public.platform_administrators to service_role;

alter table public.user_profiles
  add column if not exists phone text,
  add column if not exists job_title text;

alter table public.organization_memberships
  add column if not exists membership_type text not null default 'permanent',
  add column if not exists permission_keys text[] not null default '{}'::text[],
  add column if not exists login_username citext,
  add column if not exists expires_at timestamptz,
  add column if not exists created_by_user_id uuid references auth.users (id) on delete set null;

alter table public.organization_memberships
  drop constraint if exists organization_memberships_membership_type_check,
  drop constraint if exists organization_memberships_permission_keys_check,
  drop constraint if exists organization_memberships_temporary_account_check,
  drop constraint if exists organization_memberships_owner_permanent_check;

alter table public.organization_memberships
  add constraint organization_memberships_membership_type_check
    check (membership_type in ('permanent', 'temporary')),
  add constraint organization_memberships_permission_keys_check
    check (
      permission_keys <@ array[
        'organization.manage',
        'team.manage',
        'events.manage',
        'entrants.manage',
        'race_day.manage',
        'results.manage',
        'communications.manage',
        'safety.manage',
        'logistics.manage',
        'finance.manage'
      ]::text[]
    ),
  add constraint organization_memberships_temporary_account_check
    check (
      membership_type <> 'temporary'
      or (
        login_username is not null
        and length(trim(login_username::text)) between 3 and 48
        and expires_at is not null
      )
    ),
  add constraint organization_memberships_owner_permanent_check
    check (role <> 'owner' or membership_type = 'permanent');

create unique index if not exists organization_memberships_login_username_unique_idx
  on public.organization_memberships (login_username)
  where login_username is not null
    and status <> 'removed';

create index if not exists organization_memberships_access_lookup_idx
  on public.organization_memberships (user_id, organization_id, status, membership_type, expires_at);

update public.organization_memberships
set permission_keys = case role
  when 'admin' then array[
    'organization.manage',
    'team.manage',
    'events.manage',
    'entrants.manage',
    'race_day.manage',
    'results.manage',
    'communications.manage',
    'safety.manage',
    'logistics.manage',
    'finance.manage'
  ]::text[]
  when 'staff' then array[
    'events.manage',
    'entrants.manage',
    'race_day.manage',
    'results.manage'
  ]::text[]
  when 'timer' then array['race_day.manage']::text[]
  else '{}'::text[]
end
where coalesce(cardinality(permission_keys), 0) = 0;

alter table public.event_staff_assignments
  add column if not exists permission_keys text[] not null default '{}'::text[];

alter table public.event_staff_assignments
  drop constraint if exists event_staff_assignments_permission_keys_check;

alter table public.event_staff_assignments
  add constraint event_staff_assignments_permission_keys_check
    check (
      permission_keys <@ array[
        'events.manage',
        'entrants.manage',
        'race_day.manage',
        'results.manage',
        'communications.manage',
        'safety.manage',
        'logistics.manage'
      ]::text[]
    );

update public.event_staff_assignments
set permission_keys = case access_scope
  when 'registration' then array['entrants.manage']::text[]
  when 'timing' then array['race_day.manage']::text[]
  when 'safety' then array['safety.manage', 'race_day.manage']::text[]
  when 'logistics' then array['logistics.manage', 'race_day.manage']::text[]
  when 'communications' then array['communications.manage']::text[]
  else array['race_day.manage']::text[]
end
where coalesce(cardinality(permission_keys), 0) = 0;

create index if not exists event_staff_assignments_user_access_idx
  on public.event_staff_assignments (staff_user_id, event_edition_id, assignment_state)
  where staff_user_id is not null;

create or replace function public.is_platform_administrator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_administrators administrator
    where administrator.user_id = public.request_user_id()
  )
$$;

create or replace function public.organization_has_permission(
  target_organization_id uuid,
  requested_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_platform_administrator()
    or exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = public.request_user_id()
        and membership.status = 'active'
        and membership.membership_type = 'permanent'
        and (membership.expires_at is null or membership.expires_at > now())
        and (
          membership.role = 'owner'
          or requested_permission = any(membership.permission_keys)
        )
    )
$$;

create or replace function public.organization_can_delegate_permissions(
  target_organization_id uuid,
  proposed_permissions text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_platform_administrator()
    or exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = public.request_user_id()
        and membership.status = 'active'
        and membership.membership_type = 'permanent'
        and (membership.expires_at is null or membership.expires_at > now())
        and (
          membership.role = 'owner'
          or coalesce(proposed_permissions, '{}'::text[]) <@ membership.permission_keys
        )
    )
$$;

create or replace function public.user_has_event_permission(
  target_event_edition_id uuid,
  requested_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_platform_administrator()
    or exists (
      select 1
      from public.event_editions edition
      join public.event_series series
        on series.id = edition.event_series_id
      join public.organization_memberships membership
        on membership.organization_id = series.organization_id
      where edition.id = target_event_edition_id
        and membership.user_id = public.request_user_id()
        and membership.status = 'active'
        and (membership.expires_at is null or membership.expires_at > now())
        and (
          membership.role = 'owner'
          or (
            membership.membership_type = 'permanent'
            and requested_permission = any(membership.permission_keys)
          )
          or (
            membership.membership_type = 'temporary'
            and exists (
              select 1
              from public.event_staff_assignments assignment
              where assignment.event_edition_id = edition.id
                and assignment.staff_user_id = membership.user_id
                and assignment.assignment_state in ('planned', 'confirmed', 'checked_in')
                and requested_permission = any(assignment.permission_keys)
            )
          )
        )
    )
$$;

create or replace function public.is_organization_member(
  target_organization_id uuid,
  allowed_roles organization_membership_role[] default array['owner', 'admin', 'staff', 'timer']::organization_membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_platform_administrator()
    or exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = public.request_user_id()
        and membership.status = 'active'
        and (membership.expires_at is null or membership.expires_at > now())
        and membership.role = any(allowed_roles)
    )
$$;

create or replace function public.can_manage_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.organization_has_permission(target_organization_id, 'events.manage')
$$;

create or replace function public.can_time_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.organization_has_permission(target_organization_id, 'race_day.manage')
$$;

drop policy if exists organizations_update_manage on public.organizations;
create policy organizations_update_manage
on public.organizations
for update
using (public.organization_has_permission(id, 'organization.manage'))
with check (public.organization_has_permission(id, 'organization.manage'));

drop policy if exists organization_memberships_select_self_or_manager on public.organization_memberships;
create policy organization_memberships_select_self_or_manager
on public.organization_memberships
for select
using (
  user_id = public.request_user_id()
  or public.organization_has_permission(organization_id, 'team.manage')
);

drop policy if exists organization_memberships_insert_manage on public.organization_memberships;
create policy organization_memberships_insert_manage
on public.organization_memberships
for insert
with check (
  public.organization_has_permission(organization_id, 'team.manage')
  and public.organization_can_delegate_permissions(organization_id, permission_keys)
  and (role <> 'owner' or public.is_platform_administrator())
);

drop policy if exists organization_memberships_update_manage on public.organization_memberships;
create policy organization_memberships_update_manage
on public.organization_memberships
for update
using (
  public.organization_has_permission(organization_id, 'team.manage')
  and public.organization_can_delegate_permissions(organization_id, permission_keys)
  and (role <> 'owner' or public.is_platform_administrator())
)
with check (
  public.organization_has_permission(organization_id, 'team.manage')
  and public.organization_can_delegate_permissions(organization_id, permission_keys)
  and (role <> 'owner' or public.is_platform_administrator())
);

drop policy if exists organization_memberships_delete_manage on public.organization_memberships;
create policy organization_memberships_delete_manage
on public.organization_memberships
for delete
using (
  public.organization_has_permission(organization_id, 'team.manage')
  and public.organization_can_delegate_permissions(organization_id, permission_keys)
  and (role <> 'owner' or public.is_platform_administrator())
);

commit;
