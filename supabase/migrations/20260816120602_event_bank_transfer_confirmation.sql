/*
 * Require each paid event to confirm the organizer-direct bank-transfer
 * method before registration payment instructions are issued.
 */

create table public.event_bank_transfer_settings (
  event_edition_id uuid primary key references public.event_editions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  bank_transfer_profile_id uuid not null references public.organization_bank_transfer_profiles (id) on delete restrict,
  is_enabled boolean not null default true,
  confirmed_by_user_id uuid,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_edition_id, organization_id)
);

create index event_bank_transfer_settings_organization_idx
  on public.event_bank_transfer_settings (organization_id, is_enabled);

create trigger event_bank_transfer_settings_set_updated_at
before update on public.event_bank_transfer_settings
for each row execute function public.set_updated_at();

alter table public.event_bank_transfer_settings enable row level security;

revoke all on table public.event_bank_transfer_settings
from public, anon, authenticated;
grant select, insert, update, delete on table public.event_bank_transfer_settings
to service_role;

comment on table public.event_bank_transfer_settings is
  'Organizer confirmation that a paid event uses the active organization bank-transfer profile.';

-- Preserve the behavior of existing paid events that already have an active
-- bank-transfer profile. New paid events require an explicit confirmation.
insert into public.event_bank_transfer_settings (
  event_edition_id,
  organization_id,
  bank_transfer_profile_id,
  is_enabled,
  confirmed_by_user_id,
  confirmed_at
)
select distinct
  edition.id,
  series.organization_id,
  profile.id,
  true,
  null::uuid,
  now()
from public.event_editions edition
join public.event_series series on series.id = edition.event_series_id
join public.organization_bank_transfer_profiles profile
  on profile.organization_id = series.organization_id
 and profile.is_active
where exists (
  select 1
  from public.event_categories category
  where category.event_edition_id = edition.id
    and category.status::text <> 'draft'
    and coalesce(category.registration_fee_cents, 0) > 0
)
on conflict (event_edition_id) do nothing;

create or replace function public.service_ensure_registration_bank_transfer_request(
  p_registration_id uuid,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_registration public.registrations%rowtype;
  target_quote public.registration_quotes%rowtype;
  target_profile public.organization_bank_transfer_profiles%rowtype;
  target_organization_id uuid;
  target_event_edition_id uuid;
  target_category_name text;
  target_race_start_at timestamptz;
  target_payment_due_at timestamptz;
  existing_request public.registration_payment_requests%rowtype;
  created_request public.registration_payment_requests%rowtype;
begin
  select request.*
  into existing_request
  from public.registration_payment_requests request
  where request.registration_id = p_registration_id;

  if existing_request.id is not null then
    return existing_request.id;
  end if;

  select registration.*
  into target_registration
  from public.registrations registration
  where registration.id = p_registration_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'registration_not_found';
  end if;

  if target_registration.status::text = 'waitlisted'
     or target_registration.payment_status::text = 'not_required' then
    return null;
  end if;

  select quote.*
  into target_quote
  from public.registration_quotes quote
  where quote.registration_id = target_registration.id
    and quote.total_cents > 0
  order by
    (quote.id = target_registration.current_quote_id) desc,
    quote.version desc
  limit 1;

  if target_quote.id is null then
    return null;
  end if;

  select
    series.organization_id,
    category.event_edition_id,
    category.name,
    coalesce(
      category.start_at,
      edition.start_date::timestamp at time zone edition.timezone
    )
  into
    target_organization_id,
    target_event_edition_id,
    target_category_name,
    target_race_start_at
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = target_registration.event_category_id;

  target_payment_due_at := target_race_start_at - interval '24 hours';

  select profile.*
  into target_profile
  from public.event_bank_transfer_settings setting
  join public.organization_bank_transfer_profiles profile
    on profile.id = setting.bank_transfer_profile_id
   and profile.organization_id = setting.organization_id
  where setting.event_edition_id = target_event_edition_id
    and setting.organization_id = target_organization_id
    and setting.is_enabled
    and setting.confirmed_at >= profile.updated_at
    and profile.is_active;

  if target_profile.id is null then
    return null;
  end if;

  insert into public.registration_payment_requests (
    organization_id,
    registration_id,
    quote_id,
    bank_transfer_profile_id,
    amount_cents,
    currency,
    recipient_name,
    recipient_iban,
    recipient_bic,
    recipient_address,
    recipient_postal_code,
    recipient_city,
    recipient_country_code,
    payment_model,
    purpose_code,
    payment_description,
    due_at
  )
  values (
    target_organization_id,
    target_registration.id,
    target_quote.id,
    target_profile.id,
    target_quote.total_cents,
    target_quote.currency,
    target_profile.account_holder_name,
    target_profile.iban,
    target_profile.bic,
    target_profile.account_holder_address,
    target_profile.account_holder_postal_code,
    target_profile.account_holder_city,
    target_profile.account_holder_country_code,
    target_profile.payment_model,
    target_profile.purpose_code,
    left('Startnina ' || target_category_name, 140),
    target_payment_due_at
  )
  on conflict (registration_id) do nothing
  returning * into created_request;

  if created_request.id is null then
    select request.*
    into created_request
    from public.registration_payment_requests request
    where request.registration_id = p_registration_id;
  else
    insert into public.registration_payment_events (
      payment_request_id,
      organization_id,
      registration_id,
      event_type,
      source,
      actor_user_id,
      amount_cents,
      currency,
      metadata_json
    )
    values (
      created_request.id,
      created_request.organization_id,
      created_request.registration_id,
      'requested',
      'system',
      p_actor_user_id,
      created_request.amount_cents,
      created_request.currency,
      jsonb_build_object(
        'quoteId', created_request.quote_id,
        'paymentDeadline', created_request.due_at,
        'raceStartAt', target_race_start_at,
        'eventPaymentConfirmed', true
      )
    );

    insert into public.audit_log (
      organization_id,
      actor_user_id,
      entity_type,
      entity_id,
      action,
      metadata_json
    )
    values (
      created_request.organization_id,
      p_actor_user_id,
      'registration_payment_request',
      created_request.id,
      'bank_transfer_request.created',
      jsonb_build_object(
        'registrationId', created_request.registration_id,
        'quoteId', created_request.quote_id,
        'amountCents', created_request.amount_cents,
        'currency', created_request.currency,
        'reference', created_request.reference_value,
        'paymentDeadline', created_request.due_at,
        'recipientIbanLast4', right(created_request.recipient_iban, 4)
      )
    );
  end if;

  update public.registration_quotes quote
  set expires_at = created_request.due_at
  where quote.id = created_request.quote_id
    and quote.state = 'active';

  update public.capacity_reservations reservation
  set expires_at = created_request.due_at
  where reservation.registration_id = created_request.registration_id
    and reservation.quote_id = created_request.quote_id
    and reservation.state = 'active';

  return created_request.id;
end;
$$;
