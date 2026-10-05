/*
 * Persists Stripe Accounts v2 onboarding state after the API has authenticated
 * an organization administrator and retrieved the canonical provider account.
 */

create or replace function public.service_save_organization_payment_account(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_provider_account_id text,
  p_status text,
  p_transfers_enabled boolean,
  p_payouts_enabled boolean,
  p_onboarding_state_json jsonb,
  p_requirements_snapshot_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_account public.organization_payment_accounts%rowtype;
begin
  if p_status not in ('not_started', 'onboarding', 'restricted', 'active', 'disabled') then
    raise exception using errcode = '22023', message = 'invalid_payment_account_status';
  end if;

  if p_provider_account_id is null or length(trim(p_provider_account_id)) = 0 then
    raise exception using errcode = '22023', message = 'provider_account_id_required';
  end if;

  perform 1
  from public.organizations organization
  where organization.id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;

  insert into public.organization_payment_accounts (
    organization_id,
    provider,
    provider_account_id,
    status,
    charges_enabled,
    payouts_enabled,
    onboarding_state_json,
    requirements_snapshot_json,
    last_synced_at
  )
  values (
    p_organization_id,
    'stripe',
    trim(p_provider_account_id),
    p_status,
    p_transfers_enabled,
    p_payouts_enabled,
    coalesce(p_onboarding_state_json, '{}'::jsonb),
    coalesce(p_requirements_snapshot_json, '{}'::jsonb),
    now()
  )
  on conflict (organization_id, provider)
  do update set
    provider_account_id = excluded.provider_account_id,
    status = excluded.status,
    charges_enabled = excluded.charges_enabled,
    payouts_enabled = excluded.payouts_enabled,
    onboarding_state_json = excluded.onboarding_state_json,
    requirements_snapshot_json = excluded.requirements_snapshot_json,
    last_synced_at = excluded.last_synced_at
  returning * into saved_account;

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
    'organization_payment_account',
    saved_account.id,
    'payment_account.synced',
    jsonb_build_object(
      'provider', 'stripe',
      'providerAccountId', saved_account.provider_account_id,
      'status', saved_account.status,
      'transfersEnabled', saved_account.charges_enabled,
      'payoutsEnabled', saved_account.payouts_enabled
    )
  );

  return jsonb_build_object(
    'id', saved_account.id,
    'organizationId', saved_account.organization_id,
    'provider', saved_account.provider,
    'providerAccountId', saved_account.provider_account_id,
    'status', saved_account.status,
    'transfersEnabled', saved_account.charges_enabled,
    'payoutsEnabled', saved_account.payouts_enabled,
    'lastSyncedAt', saved_account.last_synced_at
  );
end;
$$;

revoke all on function public.service_save_organization_payment_account(
  uuid, uuid, text, text, boolean, boolean, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.service_save_organization_payment_account(
  uuid, uuid, text, text, boolean, boolean, jsonb, jsonb
) to service_role;
