begin;

-- Club administration and organizer administration are independent domains.
-- Direct Data API writes may maintain club fields, but only trusted server-side
-- functions may create or change the optional event-operations association.
create or replace function public.club_organization_association_is_unchanged(
  target_club_id uuid,
  candidate_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select club.organization_id is not distinct from candidate_organization_id
      from public.clubs club
      where club.id = target_club_id
    ),
    false
  );
$$;

revoke all on function public.club_organization_association_is_unchanged(uuid, uuid) from public;
grant execute on function public.club_organization_association_is_unchanged(uuid, uuid) to authenticated, service_role;

drop policy if exists clubs_insert_creator on public.clubs;

create policy clubs_insert_creator
on public.clubs
for insert
with check (
  created_by_athlete_profile_id is not null
  and public.user_can_access_athlete_profile(created_by_athlete_profile_id)
  and organization_id is null
);

drop policy if exists clubs_update_creator on public.clubs;

create policy clubs_update_creator
on public.clubs
for update
using (public.can_manage_club(id))
with check (
  created_by_athlete_profile_id is not null
  and public.can_manage_club(id)
  and public.club_organization_association_is_unchanged(id, organization_id)
);

comment on column public.clubs.organization_id is
  'Optional event-operations association. It does not grant, copy, or inherit club or organization membership and roles.';

-- Temporary organization-wide administration contradicted the event-scoped
-- temporary-account contract. Preserve the identities and assignments, but
-- narrow legacy accounts to the temporary Race Day Operator template.
alter table public.organization_memberships
  drop constraint if exists organization_memberships_account_template_key_check,
  drop constraint if exists organization_memberships_core_role_template_check;

update public.event_staff_assignments assignment
set
  permission_keys = coalesce(
    (
      select array_agg(permission_key order by permission_key)
      from unnest(assignment.permission_keys) permission_key
      where permission_key = any(array[
        'entrants.manage',
        'race_day.manage',
        'results.manage',
        'safety.manage'
      ]::text[])
    ),
    '{}'::text[]
  ),
  updated_at = now()
where exists (
  select 1
  from public.organization_memberships membership
  join public.event_editions edition
    on edition.id = assignment.event_edition_id
  join public.event_series series
    on series.id = edition.event_series_id
  where membership.account_template_key = 'temporary-organization-admin'
    and membership.organization_id = series.organization_id
    and membership.user_id = assignment.staff_user_id
);

update public.organization_memberships
set
  role = 'timer',
  membership_type = 'temporary',
  account_template_key = 'race-day-operator',
  custom_role_id = null,
  permission_keys = array[
    'entrants.manage',
    'race_day.manage',
    'results.manage',
    'safety.manage'
  ]::text[],
  updated_at = now()
where account_template_key = 'temporary-organization-admin';

alter table public.organization_memberships
  add constraint organization_memberships_account_template_key_check
    check (
      account_template_key is null
      or account_template_key in (
        'organization-admin',
        'race-day-operator',
        'checkpoint-timer'
      )
    ),
  add constraint organization_memberships_core_role_template_check
    check (
      (
        role = 'owner'
        and membership_type = 'permanent'
        and account_template_key is null
        and custom_role_id is null
      )
      or (
        role = 'admin'
        and membership_type = 'permanent'
        and account_template_key = 'organization-admin'
        and custom_role_id is null
        and cardinality(permission_keys) = 11
        and array[
          'organization.manage',
          'team.manage',
          'events.manage',
          'entrants.manage',
          'race_day.manage',
          'checkpoint_timing.enter',
          'results.manage',
          'communications.manage',
          'safety.manage',
          'logistics.manage',
          'finance.manage'
        ]::text[] <@ permission_keys
      )
      or (
        account_template_key = 'race-day-operator'
        and custom_role_id is null
        and (
          (membership_type = 'permanent' and role = 'staff')
          or (membership_type = 'temporary' and role = 'timer')
        )
        and cardinality(permission_keys) = 4
        and array[
          'entrants.manage',
          'race_day.manage',
          'results.manage',
          'safety.manage'
        ]::text[] <@ permission_keys
      )
      or (
        role = 'timer'
        and membership_type = 'temporary'
        and account_template_key = 'checkpoint-timer'
        and custom_role_id is null
        and permission_keys = array['checkpoint_timing.enter']::text[]
      )
      or (
        role = 'admin'
        and membership_type = 'permanent'
        and account_template_key is null
        and custom_role_id is not null
        and cardinality(permission_keys) between 1 and 11
      )
    );

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
          or (
            membership.role = 'admin'
            and requested_permission = any(membership.permission_keys)
          )
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
          (
            membership.membership_type = 'permanent'
            and membership.role = 'owner'
          )
          or (
            membership.membership_type = 'permanent'
            and membership.role = 'admin'
            and requested_permission = any(membership.permission_keys)
          )
          or exists (
            select 1
            from public.event_staff_assignments assignment
            where assignment.event_edition_id = edition.id
              and assignment.staff_user_id = membership.user_id
              and assignment.assignment_state in (
                'planned',
                'confirmed',
                'checked_in'
              )
              and requested_permission = any(assignment.permission_keys)
          )
        )
    )
$$;

comment on function public.organization_has_permission(uuid, text) is
  'Organization-wide access requires a permanent owner or administrator membership.';

comment on function public.user_has_event_permission(uuid, text) is
  'Permanent organization administrators inherit event access; operators and timers require an active event assignment.';

comment on column public.organization_memberships.account_template_key is
  'Locked role template. Organization administration is permanent; temporary templates are event-scoped.';

commit;
