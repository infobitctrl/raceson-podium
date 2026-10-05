begin;

-- Club access belongs to athlete memberships. Organizer workspaces remain a
-- separate authorization domain and do not grant club-management access.
create table public.club_roles (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  role_key text not null,
  name text not null,
  description text,
  permission_keys text[] not null default '{}'::text[],
  sort_order integer not null default 50,
  is_system boolean not null default false,
  is_owner boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (club_id, role_key),
  unique (club_id, id),
  check (role_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  check (length(trim(name)) between 2 and 80),
  check (description is null or length(trim(description)) <= 500),
  check (status in ('active', 'archived')),
  check (
    permission_keys <@ array[
      'club.profile.manage',
      'club.settings.manage',
      'club.members.view',
      'club.members.manage',
      'club.roles.manage',
      'club.activities.manage',
      'club.content.manage',
      'club.analytics.view',
      'club.audit.view'
    ]::text[]
  ),
  check (role_key = 'member' or cardinality(permission_keys) > 0),
  check (
    not ('club.members.manage' = any(permission_keys))
    or 'club.members.view' = any(permission_keys)
  ),
  check (
    not ('club.roles.manage' = any(permission_keys))
    or 'club.members.view' = any(permission_keys)
  ),
  check (
    not ('club.content.manage' = any(permission_keys))
    or 'club.profile.manage' = any(permission_keys)
  ),
  check (not is_owner or (is_system and role_key = 'owner'))
);

create unique index club_roles_owner_idx
  on public.club_roles (club_id)
  where is_owner and status = 'active';

create index club_roles_active_idx
  on public.club_roles (club_id, sort_order, name)
  where status = 'active';

create trigger club_roles_set_updated_at
before update on public.club_roles
for each row execute function public.set_updated_at();

create or replace function public.seed_club_roles(target_club_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.club_roles (
    club_id,
    role_key,
    name,
    description,
    permission_keys,
    sort_order,
    is_system,
    is_owner
  )
  values
    (
      target_club_id,
      'owner',
      'Owner',
      'The club owner. Ownership transfer and club deletion are owner-only actions.',
      array[
        'club.profile.manage', 'club.settings.manage', 'club.members.view',
        'club.members.manage', 'club.roles.manage', 'club.activities.manage',
        'club.content.manage', 'club.analytics.view', 'club.audit.view'
      ]::text[],
      0,
      true,
      true
    ),
    (
      target_club_id,
      'administrator',
      'Administrator',
      'Full day-to-day club administration without ownership transfer or club deletion.',
      array[
        'club.profile.manage', 'club.settings.manage', 'club.members.view',
        'club.members.manage', 'club.roles.manage', 'club.activities.manage',
        'club.content.manage', 'club.analytics.view', 'club.audit.view'
      ]::text[],
      10,
      true,
      false
    ),
    (
      target_club_id,
      'membership-manager',
      'Membership manager',
      'Reviews applications and maintains the club roster.',
      array[
        'club.members.view', 'club.members.manage', 'club.analytics.view'
      ]::text[],
      20,
      true,
      false
    ),
    (
      target_club_id,
      'activities-manager',
      'Activities manager',
      'Creates and maintains club training sessions, meetups, and activities.',
      array[
        'club.members.view', 'club.activities.manage'
      ]::text[],
      30,
      true,
      false
    ),
    (
      target_club_id,
      'content-manager',
      'Content manager',
      'Maintains the public club profile and club content.',
      array[
        'club.profile.manage', 'club.content.manage'
      ]::text[],
      40,
      true,
      false
    ),
    (
      target_club_id,
      'member',
      'Member',
      'Standard club membership without management permissions.',
      '{}'::text[],
      100,
      true,
      false
    )
  on conflict (club_id, role_key) do nothing;
end;
$$;

create or replace function public.seed_new_club_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_club_roles(new.id);
  return new;
end;
$$;

create trigger clubs_10_seed_roles
after insert on public.clubs
for each row execute function public.seed_new_club_roles();

select public.seed_club_roles(club.id)
from public.clubs club;

alter table public.club_memberships
  add column club_role_id uuid;

alter table public.club_memberships
  add constraint club_memberships_club_role_fk
  foreign key (club_id, club_role_id)
  references public.club_roles (club_id, id)
  on delete no action
  deferrable initially deferred;

-- A creator is the owner. Legacy/imported clubs with no creator remain
-- intentionally ownerless until the platform recovery workflow approves one.
update public.club_memberships membership
set club_role_id = role.id
from public.clubs club, public.club_roles role
where club.id = membership.club_id
  and club.created_by_athlete_profile_id = membership.athlete_profile_id
  and role.club_id = membership.club_id
  and role.role_key = 'owner';

update public.club_memberships membership
set club_role_id = role.id
from public.club_roles role
where membership.club_role_id is null
  and role.club_id = membership.club_id
  and role.role_key = membership.membership_role
  and role.role_key in (
    'administrator', 'membership-manager', 'activities-manager', 'content-manager'
  );

update public.club_memberships membership
set club_role_id = role.id
from public.club_roles role
where membership.club_role_id is null
  and role.club_id = membership.club_id
  and role.role_key = 'member';

do $$
declare
  missing_rows jsonb;
begin
  select jsonb_agg(to_jsonb(sample))
  into missing_rows
  from (
    select membership.id, membership.club_id, membership.membership_role
    from public.club_memberships membership
    where membership.club_role_id is null
    order by membership.created_at
    limit 10
  ) sample;

  if missing_rows is not null then
    raise exception using
      errcode = '23502',
      message = 'club_membership_role_backfill_failed',
      detail = missing_rows::text;
  end if;
end;
$$;

set constraints club_memberships_club_role_fk immediate;

alter table public.club_memberships
  alter column club_role_id set not null;

-- Preserve already-approved recovery decisions in the new club access domain.
-- The first approved claimant becomes owner only when the club has no owner.
with approved_requests as (
  select
    request_item.club_id,
    request_item.athlete_profile_id,
    row_number() over (
      partition by request_item.club_id
      order by request_item.reviewed_at nulls last, request_item.created_at, request_item.id
    ) as approval_rank
  from public.club_admin_role_requests request_item
  where request_item.status = 'approved'
), resolved_roles as (
  select
    approved.club_id,
    approved.athlete_profile_id,
    case
      when approved.approval_rank = 1
       and not exists (
         select 1
         from public.club_memberships owner_membership
         join public.club_roles owner_role
           on owner_role.id = owner_membership.club_role_id
          and owner_role.club_id = owner_membership.club_id
         where owner_membership.club_id = approved.club_id
           and owner_membership.status = 'active'
           and owner_role.is_owner
       ) then 'owner'
      else 'administrator'
    end as role_key
  from approved_requests approved
)
update public.club_memberships membership
set
  club_role_id = role.id,
  membership_role = role.role_key,
  updated_at = clock_timestamp()
from resolved_roles resolved
join public.club_roles role
  on role.club_id = resolved.club_id
 and role.role_key = resolved.role_key
where membership.club_id = resolved.club_id
  and membership.athlete_profile_id = resolved.athlete_profile_id
  and membership.status = 'active';

create or replace function public.enforce_club_creator_membership()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  owner_role_id uuid;
begin
  if exists (
    select 1
    from public.clubs club
    where club.id = new.club_id
      and club.created_by_athlete_profile_id = new.athlete_profile_id
  ) then
    select role.id
    into owner_role_id
    from public.club_roles role
    where role.club_id = new.club_id
      and role.is_owner
      and role.status = 'active';

    new.club_role_id := owner_role_id;
    new.membership_role := 'owner';
    new.status := 'active'::public.club_membership_status;
    new.joined_at := coalesce(new.joined_at, clock_timestamp());

    if not exists (
      select 1
      from public.club_memberships membership
      where membership.athlete_profile_id = new.athlete_profile_id
        and membership.status = 'active'
        and membership.is_primary
        and membership.id <> new.id
    ) then
      new.is_primary := true;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.sync_club_membership_role()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  resolved_role public.club_roles%rowtype;
begin
  if new.club_role_id is null then
    select role.*
    into resolved_role
    from public.club_roles role
    where role.club_id = new.club_id
      and role.role_key = 'member'
      and role.status = 'active';
    new.club_role_id := resolved_role.id;
  else
    select role.*
    into resolved_role
    from public.club_roles role
    where role.id = new.club_role_id
      and role.club_id = new.club_id
      and role.status = 'active';
  end if;

  if resolved_role.id is null then
    raise exception using errcode = '23514', message = 'club_role_invalid';
  end if;

  new.membership_role := resolved_role.role_key;
  return new;
end;
$$;

create trigger club_memberships_10_sync_role
before insert or update of club_id, club_role_id, membership_role
on public.club_memberships
for each row execute function public.sync_club_membership_role();

update public.club_memberships membership
set
  membership_role = role.role_key,
  updated_at = clock_timestamp()
from public.club_roles role
where role.id = membership.club_role_id
  and role.club_id = membership.club_id
  and membership.membership_role <> role.role_key;

create unique index club_memberships_active_owner_idx
  on public.club_memberships (club_id)
  where status = 'active' and membership_role = 'owner';

create or replace function public.protect_active_club_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'active' and old.membership_role = 'owner' then
      if pg_trigger_depth() = 1 then
        raise exception using errcode = '23514', message = 'club_owner_transfer_required';
      end if;
    end if;
    return old;
  end if;

  if old.status = 'active' and old.membership_role = 'owner' then
    if new.status <> 'active' or new.membership_role <> 'owner' then
      raise exception using errcode = '23514', message = 'club_owner_transfer_required';
    end if;
  end if;

  return new;
end;
$$;

create trigger club_memberships_90_protect_owner
before update or delete
on public.club_memberships
for each row execute function public.protect_active_club_owner();

create or replace function public.club_member_has_permission(
  target_club_id uuid,
  required_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_memberships membership
    join public.club_roles role
      on role.id = membership.club_role_id
     and role.club_id = membership.club_id
    where membership.club_id = target_club_id
      and membership.status = 'active'
      and role.status = 'active'
      and public.user_can_access_athlete_profile(membership.athlete_profile_id)
      and required_permission = any(role.permission_keys)
  )
$$;

create or replace function public.current_user_is_club_member(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_memberships membership
    where membership.club_id = target_club_id
      and membership.status = 'active'
      and public.user_can_access_athlete_profile(membership.athlete_profile_id)
  )
$$;

create or replace function public.can_manage_club(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_active_platform_administrator(auth.uid())
    or public.club_member_has_permission(target_club_id, 'club.profile.manage')
$$;

create table public.club_activities (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  activity_type text not null default 'training',
  title text not null,
  description text,
  location_label text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  visibility text not null default 'members',
  status text not null default 'published',
  created_by_athlete_profile_id uuid not null references public.athlete_profiles (id) on delete restrict,
  updated_by_athlete_profile_id uuid not null references public.athlete_profiles (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (activity_type in ('training', 'meetup', 'social', 'volunteer', 'other')),
  check (length(trim(title)) between 2 and 160),
  check (description is null or length(trim(description)) <= 4000),
  check (location_label is null or length(trim(location_label)) <= 240),
  check (ends_at is null or ends_at >= starts_at),
  check (visibility in ('public', 'members')),
  check (status in ('draft', 'published', 'cancelled'))
);

create index club_activities_schedule_idx
  on public.club_activities (club_id, starts_at)
  where status <> 'cancelled';

create trigger club_activities_set_updated_at
before update on public.club_activities
for each row execute function public.set_updated_at();

alter table public.club_roles enable row level security;
alter table public.club_activities enable row level security;

revoke all on table public.club_roles, public.club_activities
from public, anon, authenticated;
grant select, insert, update, delete on table public.club_roles, public.club_activities
to service_role;
grant select on table public.club_roles to authenticated;
grant select on table public.club_activities to anon, authenticated;

create policy club_roles_select_manager
on public.club_roles
for select
using (
  public.is_active_platform_administrator(auth.uid())
  or public.club_member_has_permission(club_id, 'club.roles.manage')
);

create policy club_activities_select_public
on public.club_activities
for select
to anon, authenticated
using (
  status = 'published'
  and visibility = 'public'
  and public.is_club_public(club_id)
);

create policy club_activities_select_member
on public.club_activities
for select
to authenticated
using (public.current_user_is_club_member(club_id));

drop policy if exists club_memberships_insert_self_or_manager
  on public.club_memberships;
drop policy if exists club_memberships_update_self_or_manager
  on public.club_memberships;
drop policy if exists club_memberships_delete_self_or_manager
  on public.club_memberships;

revoke insert, update, delete on table public.club_memberships
from anon, authenticated;

create policy club_memberships_insert_manager
on public.club_memberships
for insert
with check (public.club_member_has_permission(club_id, 'club.members.manage'));

create policy club_memberships_update_manager
on public.club_memberships
for update
using (public.club_member_has_permission(club_id, 'club.members.manage'))
with check (public.club_member_has_permission(club_id, 'club.members.manage'));

create policy club_memberships_delete_manager
on public.club_memberships
for delete
using (public.club_member_has_permission(club_id, 'club.members.manage'));

-- Platform review is retained for ownerless imported clubs and recovery. An
-- approval grants club access directly; it no longer creates organizer access.
create or replace function public.service_decide_club_admin_role_request(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.club_admin_role_requests%rowtype;
  target_role public.club_roles%rowtype;
  assigned_role_key text;
begin
  if not public.is_active_platform_administrator(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'platform_administrator_required';
  end if;
  if p_decision not in ('approved', 'rejected') or nullif(trim(p_note), '') is null then
    raise exception using errcode = '22023', message = 'club_admin_decision_invalid';
  end if;

  select request_item.*
  into request_row
  from public.club_admin_role_requests request_item
  where request_item.id = p_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'club_admin_request_not_found';
  end if;
  if request_row.status <> 'pending' then
    raise exception using errcode = '55000', message = 'club_admin_request_closed';
  end if;

  if p_decision = 'approved' then
    if not exists (
      select 1
      from public.club_memberships membership
      where membership.club_id = request_row.club_id
        and membership.athlete_profile_id = request_row.athlete_profile_id
        and membership.status = 'active'
    ) then
      raise exception using errcode = '42501', message = 'active_club_membership_required';
    end if;

    assigned_role_key := case
      when exists (
        select 1
        from public.club_memberships owner_membership
        where owner_membership.club_id = request_row.club_id
          and owner_membership.status = 'active'
          and owner_membership.membership_role = 'owner'
      ) then 'administrator'
      else 'owner'
    end;

    select role.*
    into target_role
    from public.club_roles role
    where role.club_id = request_row.club_id
      and role.role_key = assigned_role_key
      and role.status = 'active';

    update public.club_memberships membership
    set
      club_role_id = target_role.id,
      membership_role = target_role.role_key,
      updated_at = clock_timestamp()
    where membership.club_id = request_row.club_id
      and membership.athlete_profile_id = request_row.athlete_profile_id
      and membership.status = 'active';

    insert into public.audit_log (
      actor_user_id, entity_type, entity_id, action, metadata_json
    ) values (
      p_actor_user_id,
      'club_membership',
      request_row.id,
      'club.admin_recovery.approved',
      jsonb_build_object(
        'club_id', request_row.club_id,
        'athlete_profile_id', request_row.athlete_profile_id,
        'club_role', assigned_role_key
      )
    );
  end if;

  update public.club_admin_role_requests request_item
  set
    status = p_decision,
    reviewed_at = clock_timestamp(),
    reviewed_by_user_id = p_actor_user_id,
    decision_note = trim(p_note),
    updated_at = clock_timestamp()
  where request_item.id = request_row.id;

  return jsonb_build_object(
    'requestId', request_row.id,
    'status', p_decision,
    'clubId', request_row.club_id,
    'clubRole', assigned_role_key
  );
end;
$$;

revoke all on function public.seed_club_roles(uuid)
  from public, anon, authenticated;
revoke all on function public.seed_new_club_roles()
  from public, anon, authenticated;
revoke all on function public.club_member_has_permission(uuid, text)
  from public, anon, authenticated;
revoke all on function public.current_user_is_club_member(uuid)
  from public, anon, authenticated;
grant execute on function public.club_member_has_permission(uuid, text)
  to authenticated, service_role;
grant execute on function public.current_user_is_club_member(uuid)
  to authenticated, service_role;
grant execute on function public.seed_club_roles(uuid)
  to service_role;

comment on table public.club_roles is
  'Club-scoped access roles assigned to athlete memberships. Organizer roles do not inherit into this domain.';
comment on column public.club_memberships.club_role_id is
  'The club-scoped access role for this athlete membership.';
comment on table public.club_activities is
  'Member-managed club trainings, meetups, and other informal activities; separate from organizer race events.';
comment on function public.service_decide_club_admin_role_request(uuid, uuid, text, text) is
  'Platform recovery decision for ownerless or abandoned clubs. Grants a club role, never organizer access.';

commit;
