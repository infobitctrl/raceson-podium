/*
 * Let each paid event offer organizer-direct bank transfer, onsite payment,
 * or both. Existing paid events retain onsite collection, while newly created
 * events must explicitly save at least one method before publication.
 */

alter table public.event_bank_transfer_settings
  add column onsite_payment_enabled boolean not null default true;

alter table public.event_bank_transfer_settings
  alter column bank_transfer_profile_id drop not null;

alter table public.event_bank_transfer_settings
  add constraint event_payment_method_required
  check (is_enabled or onsite_payment_enabled);

comment on table public.event_bank_transfer_settings is
  'Organizer-confirmed payment methods for a paid event; bank-transfer details remain organization-owned.';

comment on column public.event_bank_transfer_settings.is_enabled is
  'Whether new payable registrations receive organization bank-transfer instructions.';

comment on column public.event_bank_transfer_settings.onsite_payment_enabled is
  'Whether authorized race-day staff may record an onsite payment for the event.';

insert into public.event_bank_transfer_settings (
  event_edition_id,
  organization_id,
  bank_transfer_profile_id,
  is_enabled,
  onsite_payment_enabled,
  confirmed_by_user_id,
  confirmed_at
)
select
  edition.id,
  series.organization_id,
  null,
  false,
  true,
  null,
  now()
from public.event_editions edition
join public.event_series series
  on series.id = edition.event_series_id
where exists (
  select 1
  from public.event_categories category
  where category.event_edition_id = edition.id
    and category.status::text <> 'draft'
    and coalesce(category.registration_fee_cents, 0) > 0
)
and not exists (
  select 1
  from public.event_bank_transfer_settings setting
  where setting.event_edition_id = edition.id
)
on conflict (event_edition_id) do nothing;

create or replace function public.service_record_registration_desk_payment(
  p_registration_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_registration public.registrations%rowtype;
  onsite_payment_enabled boolean;
begin
  select registration.*
  into target_registration
  from public.registrations registration
  where registration.id = p_registration_id
  for update;

  if target_registration.id is not null
     and target_registration.payment_status::text in ('unpaid', 'pending', 'failed')
     and target_registration.status::text not in ('cancelled', 'expired', 'transferred', 'deferred') then
    select setting.onsite_payment_enabled
    into onsite_payment_enabled
    from public.event_categories category
    left join public.event_bank_transfer_settings setting
      on setting.event_edition_id = category.event_edition_id
    where category.id = target_registration.event_category_id;

    if not coalesce(onsite_payment_enabled, false) then
      raise exception using errcode = 'P0001', message = 'registration_onsite_payment_disabled';
    end if;
  end if;

  if target_registration.status = 'expired'
     and target_registration.payment_status::text in ('unpaid', 'pending', 'failed') then
    select setting.onsite_payment_enabled
    into onsite_payment_enabled
    from public.event_categories category
    left join public.event_bank_transfer_settings setting
      on setting.event_edition_id = category.event_edition_id
    where category.id = target_registration.event_category_id;

    if not coalesce(onsite_payment_enabled, false) then
      raise exception using errcode = 'P0001', message = 'registration_onsite_payment_disabled';
    end if;

    update public.registrations registration
    set
      status = 'pending',
      updated_at = now()
    where registration.id = target_registration.id;

    insert into public.registration_status_history (
      registration_id,
      from_status,
      to_status,
      changed_by_user_id,
      reason
    )
    values (
      target_registration.id,
      'expired',
      'pending',
      p_actor_user_id,
      'race_day_desk_payment_reactivated'
    );
  end if;

  return public.service_record_registration_desk_payment_core(
    p_registration_id,
    p_actor_user_id,
    p_idempotency_key_hash
  );
end;
$$;

revoke all on function public.service_record_registration_desk_payment(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.service_record_registration_desk_payment(uuid, uuid, text)
to service_role;

comment on function public.service_record_registration_desk_payment(uuid, uuid, text) is
  'Confirms an enabled onsite payment and may reactivate a legacy payment-expired registration after the core capacity check.';
