begin;

alter table public.organization_memberships
  drop constraint if exists organization_memberships_account_template_key_check,
  drop constraint if exists organization_memberships_core_role_template_check;

alter table public.organization_memberships
  add constraint organization_memberships_account_template_key_check
    check (
      account_template_key is null
      or account_template_key in (
        'organization-admin',
        'temporary-organization-admin',
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
        role = 'admin'
        and membership_type = 'temporary'
        and account_template_key = 'temporary-organization-admin'
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
            membership.role = 'admin'
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
  'Core account template: organization-admin, temporary-organization-admin, race-day-operator, or checkpoint-timer. Organization owners are the only null template.';

comment on function public.organization_has_permission(uuid, text) is
  'Organization-wide access is granted to platform administrators, owners, and active organization admins until membership expiry.';

comment on function public.user_has_event_permission(uuid, text) is
  'Organization admins inherit event permissions until membership expiry; event operators and checkpoint timers require active staff assignments.';

commit;
