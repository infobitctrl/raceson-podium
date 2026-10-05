-- Isolated rewards demo only. The base command's combined UPDATE can violate
-- organization_memberships_active_owner_idx depending on physical row order.
-- Preserve service-only invoker access, validation, locks, guards and auditing.
-- Production needs its own separately approved forward migration.
begin;

create or replace function public.service_transfer_organization_ownership(
  p_organization_id uuid,
  p_current_owner_membership_id uuid,
  p_new_owner_membership_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_owner public.organization_memberships%rowtype;
  new_owner public.organization_memberships%rowtype;
  affected_rows integer;
begin
  if p_current_owner_membership_id = p_new_owner_membership_id then
    raise exception using
      errcode = '22023',
      message = 'organization_owner_transfer_requires_different_members';
  end if;

  perform 1
  from public.organizations organization
  where organization.id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'organization_not_found';
  end if;

  select membership.*
  into current_owner
  from public.organization_memberships membership
  where membership.id = p_current_owner_membership_id
    and membership.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'organization_owner_not_found';
  end if;

  if
    current_owner.role <> 'owner'
    or current_owner.status <> 'active'
    or current_owner.membership_type <> 'permanent'
  then
    raise exception using
      errcode = '23514',
      message = 'organization_current_owner_is_not_active';
  end if;

  select membership.*
  into new_owner
  from public.organization_memberships membership
  where membership.id = p_new_owner_membership_id
    and membership.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'organization_new_owner_not_found';
  end if;

  if
    new_owner.role <> 'admin'
    or new_owner.status <> 'active'
    or new_owner.membership_type <> 'permanent'
    or new_owner.account_template_key <> 'organization-admin'
    or new_owner.custom_role_id is not null
  then
    raise exception using
      errcode = '23514',
      message = 'organization_new_owner_must_be_an_active_permanent_admin';
  end if;

  perform set_config('app.organization_owner_transfer', 'enabled', true);

  -- The partial unique index is immediate. Retire first, then promote;
  -- both writes remain under the existing organization/member locks and the
  -- caller's transaction. Any failure rolls back the entire command.
  update public.organization_memberships
  set status = 'removed', updated_at = now()
  where organization_id = p_organization_id
    and id = p_current_owner_membership_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using errcode = '40001', message = 'organization_owner_transfer_conflict';
  end if;

  update public.organization_memberships
  set role = 'owner', membership_type = 'permanent',
    account_template_key = null, custom_role_id = null, expires_at = null,
    permission_keys = array[
      'organization.manage', 'team.manage', 'events.manage', 'entrants.manage',
      'race_day.manage', 'checkpoint_timing.enter', 'results.manage',
      'communications.manage', 'safety.manage', 'logistics.manage', 'finance.manage'
    ]::text[], updated_at = now()
  where organization_id = p_organization_id
    and id = p_new_owner_membership_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using errcode = '40001', message = 'organization_owner_transfer_conflict';
  end if;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'organization_membership',
    p_new_owner_membership_id,
    'organization.ownership_transferred',
    jsonb_build_object(
      'previousOwnerMembershipId', current_owner.id,
      'previousOwnerUserId', current_owner.user_id,
      'previousOwnerStatus', 'removed',
      'newOwnerMembershipId', new_owner.id,
      'newOwnerUserId', new_owner.user_id
    )
  );

  return jsonb_build_object(
    'organizationId', p_organization_id,
    'previousOwnerMembershipId', current_owner.id,
    'newOwnerMembershipId', new_owner.id,
    'previousOwnerRetired', true
  );
end;
$$;

comment on function public.service_transfer_organization_ownership(uuid, uuid, uuid, uuid) is
  'Atomically promotes an active permanent Organization Admin to owner and retires the previous owner.';


revoke all on function public.service_transfer_organization_ownership(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_transfer_organization_ownership(uuid, uuid, uuid, uuid)
  to service_role;

commit;
