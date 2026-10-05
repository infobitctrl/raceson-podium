-- Organization-defined roles use the existing immutable versioned role catalog.
begin;

insert into public.organization_permission_catalog (
  permission_code,
  area,
  title,
  description,
  sensitivity,
  staff_default,
  timer_default,
  is_active
)
values
  ('organization.manage', 'organization', 'Edit organization', 'Edit organization identity, contact details, and visibility.', 'restricted', false, false, true),
  ('team.manage', 'organization', 'Manage team', 'Invite members, define roles, and manage organization access.', 'restricted', false, false, true),
  ('events.manage', 'events', 'Manage events', 'Create, configure, publish, and archive events.', 'elevated', false, false, true),
  ('entrants.manage', 'operations', 'Manage entrants', 'Manage registrations, check-in, bibs, and start lists.', 'elevated', false, false, true),
  ('race_day.manage', 'operations', 'Manage race day', 'Operate starts, finishes, participant status, and race control.', 'elevated', false, false, true),
  ('checkpoint_timing.enter', 'operations', 'Enter checkpoint timing', 'Enter bib observations at assigned timing points.', 'standard', false, false, true),
  ('results.manage', 'operations', 'Manage results', 'Review, recompute, and publish results.', 'elevated', false, false, true),
  ('communications.manage', 'communications', 'Manage communications', 'Build audiences and send organizer communications.', 'elevated', false, false, true),
  ('safety.manage', 'operations', 'Manage safety', 'Operate safety plans, incidents, and field command.', 'restricted', false, false, true),
  ('logistics.manage', 'operations', 'Manage logistics', 'Manage operations tasks, staffing, and inventory.', 'elevated', false, false, true),
  ('finance.manage', 'finance', 'Manage finance', 'Operate payments, refunds, and reconciliation.', 'restricted', false, false, true)
on conflict (permission_code) do update
set
  area = excluded.area,
  title = excluded.title,
  description = excluded.description,
  sensitivity = excluded.sensitivity,
  is_active = true;

alter table public.organization_custom_roles
  add constraint organization_custom_roles_organization_id_id_key
  unique (organization_id, id);

alter table public.organization_memberships
  add column if not exists custom_role_id uuid;

alter table public.organization_memberships
  add constraint organization_memberships_custom_role_organization_fkey
  foreign key (organization_id, custom_role_id)
  references public.organization_custom_roles (organization_id, id)
  on delete restrict;

alter table public.organization_memberships
  drop constraint if exists organization_memberships_core_role_template_check;

alter table public.organization_memberships
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
      role = 'admin'
      and membership_type = 'temporary'
      and account_template_key = 'temporary-organization-admin'
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

comment on column public.organization_memberships.account_template_key is
  'Locked system role template. Null for owners and organization-defined custom roles.';

comment on column public.organization_memberships.custom_role_id is
  'Organization-defined role whose active version supplies the membership permission set.';

commit;
