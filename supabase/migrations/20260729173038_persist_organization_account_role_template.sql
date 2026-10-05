begin;

alter table public.organization_memberships
  add column if not exists account_template_key text;

alter table public.organization_memberships
  drop constraint if exists organization_memberships_account_template_key_check;

alter table public.organization_memberships
  add constraint organization_memberships_account_template_key_check
  check (
    account_template_key is null
    or account_template_key in (
      'organization-admin',
      'event-manager',
      'registration-desk',
      'checkpoint-timer',
      'start-finish',
      'results-manager',
      'safety-officer'
    )
  );

update public.organization_memberships membership
set account_template_key = case
  when membership.role = 'owner' then null
  when membership.membership_type = 'permanent'
    and (
      membership.role = 'admin'
      or cardinality(membership.permission_keys) = 10
    )
    then 'organization-admin'
  when membership.membership_type = 'permanent'
    and cardinality(membership.permission_keys) = 2
    and 'race_day.manage' = any(membership.permission_keys)
    and 'results.manage' = any(membership.permission_keys)
    then 'results-manager'
  when membership.membership_type = 'permanent'
    and cardinality(membership.permission_keys) = 7
    and array[
      'events.manage',
      'entrants.manage',
      'race_day.manage',
      'results.manage',
      'communications.manage',
      'safety.manage',
      'logistics.manage'
    ]::text[] <@ membership.permission_keys
    then 'event-manager'
  when membership.membership_type = 'temporary'
    and cardinality(membership.permission_keys) = 1
    and 'entrants.manage' = any(membership.permission_keys)
    then 'registration-desk'
  when membership.membership_type = 'temporary'
    and cardinality(membership.permission_keys) = 2
    and 'safety.manage' = any(membership.permission_keys)
    and 'race_day.manage' = any(membership.permission_keys)
    then 'safety-officer'
  when membership.membership_type = 'temporary'
    and cardinality(membership.permission_keys) = 1
    and 'race_day.manage' = any(membership.permission_keys)
    and coalesce(profile.job_title, '') ilike 'start%'
    then 'start-finish'
  when membership.membership_type = 'temporary'
    and cardinality(membership.permission_keys) = 1
    and 'race_day.manage' = any(membership.permission_keys)
    then 'checkpoint-timer'
  else null
end
from public.user_profiles profile
where profile.user_id = membership.user_id
  and membership.account_template_key is null;

commit;
