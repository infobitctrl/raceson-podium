begin;

alter table public.organization_memberships
  drop constraint if exists organization_memberships_permission_keys_check,
  drop constraint if exists organization_memberships_account_template_key_check,
  drop constraint if exists organization_memberships_core_role_template_check;

alter table public.event_staff_assignments
  drop constraint if exists event_staff_assignments_permission_keys_check;

update public.organization_memberships membership
set
  account_template_key = case
    when membership.role = 'owner' then null
    when membership.role = 'admin' then 'organization-admin'
    when membership.membership_type = 'temporary'
      and membership.account_template_key = 'checkpoint-timer'
      then 'checkpoint-timer'
    else 'race-day-operator'
  end,
  role = case
    when membership.role = 'owner' then 'owner'::public.organization_membership_role
    when membership.role = 'admin' then 'admin'::public.organization_membership_role
    when membership.membership_type = 'temporary'
      then 'timer'::public.organization_membership_role
    else 'staff'::public.organization_membership_role
  end,
  permission_keys = case
    when membership.role = 'owner' then membership.permission_keys
    when membership.role = 'admin' then array[
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
    ]::text[]
    when membership.membership_type = 'temporary'
      and membership.account_template_key = 'checkpoint-timer'
      then array['checkpoint_timing.enter']::text[]
    else array[
      'entrants.manage',
      'race_day.manage',
      'results.manage',
      'safety.manage'
    ]::text[]
  end;

update public.event_staff_assignments assignment
set
  permission_keys = case membership.account_template_key
    when 'checkpoint-timer'
      then array['checkpoint_timing.enter']::text[]
    when 'race-day-operator'
      then array[
        'entrants.manage',
        'race_day.manage',
        'results.manage',
        'safety.manage'
      ]::text[]
    else assignment.permission_keys
  end,
  role_code = case membership.account_template_key
    when 'checkpoint-timer' then 'checkpoint_timer'
    when 'race-day-operator' then 'race_day_operator'
    else assignment.role_code
  end,
  role_title = case membership.account_template_key
    when 'checkpoint-timer' then 'Checkpoint Timer'
    when 'race-day-operator' then 'Race Day Operator'
    else assignment.role_title
  end,
  access_scope = case membership.account_template_key
    when 'checkpoint-timer' then 'timing'
    when 'race-day-operator' then 'operations'
    else assignment.access_scope
  end
from public.organization_memberships membership
where membership.user_id = assignment.staff_user_id
  and exists (
    select 1
    from public.event_editions edition
    join public.event_series series
      on series.id = edition.event_series_id
    where edition.id = assignment.event_edition_id
      and series.organization_id = membership.organization_id
  );

alter table public.organization_memberships
  add constraint organization_memberships_permission_keys_check
    check (
      permission_keys <@ array[
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
      ]::text[]
    ),
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
      )
      or (
        role = 'admin'
        and membership_type = 'permanent'
        and account_template_key = 'organization-admin'
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
        and permission_keys = array['checkpoint_timing.enter']::text[]
      )
    );

alter table public.event_staff_assignments
  add constraint event_staff_assignments_permission_keys_check
    check (
      permission_keys <@ array[
        'events.manage',
        'entrants.manage',
        'race_day.manage',
        'checkpoint_timing.enter',
        'results.manage',
        'communications.manage',
        'safety.manage',
        'logistics.manage'
      ]::text[]
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
          or (
            membership.role = 'admin'
            and coalesce(proposed_permissions, '{}'::text[])
              <@ membership.permission_keys
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
          membership.role = 'owner'
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

comment on column public.organization_memberships.account_template_key is
  'Core account template: organization-admin, race-day-operator, or checkpoint-timer. Organization owners are the only null template.';

comment on function public.organization_has_permission(uuid, text) is
  'Organization-wide access is reserved for platform administrators, owners, and organization admins.';

comment on function public.user_has_event_permission(uuid, text) is
  'Event operators and checkpoint timers receive event access only through active staff assignments.';

commit;
