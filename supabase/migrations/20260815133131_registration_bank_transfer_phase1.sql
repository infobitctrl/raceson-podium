/*
 * Organizer-direct bank transfer payments.
 *
 * SiTrail never receives or holds registration funds. The organizer remains
 * the payee, while this schema snapshots payment instructions and records an
 * append-only audit trail for athlete reports and organizer reconciliation.
 */

create sequence public.registration_payment_reference_seq
  as bigint
  start with 100000000001;

create table public.organization_bank_transfer_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  account_holder_name text not null,
  iban text not null,
  bic text,
  account_holder_address text,
  account_holder_postal_code text,
  account_holder_city text,
  account_holder_country_code char(2) not null default 'HR',
  payment_model text not null default 'HR00',
  purpose_code char(4) not null default 'COST',
  is_active boolean not null default true,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(account_holder_name)) between 2 and 120),
  check (iban = upper(iban) and iban !~ '\s' and iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  check (bic is null or (bic = upper(bic) and bic ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$')),
  check (account_holder_country_code ~ '^[A-Z]{2}$'),
  check (payment_model ~ '^HR[0-9]{2}$'),
  check (purpose_code ~ '^[A-Z0-9]{4}$'),
  unique (organization_id)
);

create table public.registration_payment_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  registration_id uuid not null references public.registrations (id) on delete restrict,
  quote_id uuid not null references public.registration_quotes (id) on delete restrict,
  bank_transfer_profile_id uuid not null references public.organization_bank_transfer_profiles (id) on delete restrict,
  status text not null default 'awaiting_payment',
  amount_cents integer not null,
  currency char(3) not null,
  recipient_name text not null,
  recipient_iban text not null,
  recipient_bic text,
  recipient_address text,
  recipient_postal_code text,
  recipient_city text,
  recipient_country_code char(2) not null,
  payment_model text not null,
  reference_value text not null default lpad(nextval('public.registration_payment_reference_seq')::text, 12, '0'),
  purpose_code char(4) not null default 'COST',
  payment_description text not null,
  due_at timestamptz not null,
  payment_reported_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('awaiting_payment', 'reported', 'paid', 'cancelled')),
  check (amount_cents > 0),
  check (currency ~ '^[A-Z]{3}$'),
  check (recipient_iban = upper(recipient_iban) and recipient_iban !~ '\s'),
  check (payment_model ~ '^HR[0-9]{2}$'),
  check (reference_value ~ '^[0-9-]{1,22}$'),
  check (purpose_code ~ '^[A-Z0-9]{4}$'),
  check (length(payment_description) between 1 and 140),
  check (
    (status = 'paid' and settled_at is not null)
    or (status <> 'paid')
  ),
  unique (registration_id),
  unique (reference_value)
);

create index registration_payment_requests_organization_status_idx
  on public.registration_payment_requests (organization_id, status, due_at);

comment on column public.registration_payment_requests.due_at is
  'Payment deadline shown to the athlete. It does not expire or delete the bank-transfer instructions.';

create table public.registration_payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.registration_payment_requests (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  registration_id uuid not null references public.registrations (id) on delete restrict,
  ledger_entry_id uuid references public.financial_ledger_entries (id) on delete restrict,
  event_type text not null,
  source text not null,
  actor_user_id uuid,
  amount_cents integer,
  currency char(3),
  bank_reference text,
  reason text,
  metadata_json jsonb not null default '{}'::jsonb,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (event_type in ('requested', 'reported', 'settled')),
  check (source in ('system', 'athlete', 'organizer', 'payment_evidence', 'provider')),
  check (amount_cents is null or amount_cents > 0),
  check (currency is null or currency ~ '^[A-Z]{3}$'),
  check (jsonb_typeof(metadata_json) = 'object'),
  unique (ledger_entry_id)
);

create index registration_payment_events_request_effective_idx
  on public.registration_payment_events (payment_request_id, effective_at desc);

create trigger organization_bank_transfer_profiles_set_updated_at
before update on public.organization_bank_transfer_profiles
for each row execute function public.set_updated_at();

create trigger registration_payment_requests_set_updated_at
before update on public.registration_payment_requests
for each row execute function public.set_updated_at();

create or replace function public.prevent_registration_payment_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Registration payment events are append-only'
    using errcode = '55000';
end;
$$;

create trigger registration_payment_events_immutable
before update or delete on public.registration_payment_events
for each row execute function public.prevent_registration_payment_event_change();

create or replace function public.service_save_organization_bank_transfer_profile(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_account_holder_name text,
  p_iban text,
  p_bic text default null,
  p_account_holder_address text default null,
  p_account_holder_postal_code text default null,
  p_account_holder_city text default null,
  p_account_holder_country_code text default 'HR',
  p_payment_model text default 'HR00',
  p_purpose_code text default 'COST',
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_iban text := upper(regexp_replace(coalesce(p_iban, ''), '\s+', '', 'g'));
  normalized_bic text := nullif(upper(regexp_replace(coalesce(p_bic, ''), '\s+', '', 'g')), '');
  normalized_country text := upper(trim(coalesce(p_account_holder_country_code, 'HR')));
  normalized_model text := upper(trim(coalesce(p_payment_model, 'HR00')));
  normalized_purpose text := upper(trim(coalesce(p_purpose_code, 'COST')));
  previous_profile public.organization_bank_transfer_profiles%rowtype;
  saved_profile public.organization_bank_transfer_profiles%rowtype;
begin
  if length(trim(coalesce(p_account_holder_name, ''))) < 2
     or normalized_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'
     or (normalized_bic is not null and normalized_bic !~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$')
     or normalized_country !~ '^[A-Z]{2}$'
     or normalized_model !~ '^HR[0-9]{2}$'
     or normalized_purpose !~ '^[A-Z0-9]{4}$' then
    raise exception using errcode = '22023', message = 'invalid_bank_transfer_profile';
  end if;

  select profile.*
  into previous_profile
  from public.organization_bank_transfer_profiles profile
  where profile.organization_id = p_organization_id
  for update;

  insert into public.organization_bank_transfer_profiles (
    organization_id,
    account_holder_name,
    iban,
    bic,
    account_holder_address,
    account_holder_postal_code,
    account_holder_city,
    account_holder_country_code,
    payment_model,
    purpose_code,
    is_active,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    p_organization_id,
    trim(p_account_holder_name),
    normalized_iban,
    normalized_bic,
    nullif(trim(p_account_holder_address), ''),
    nullif(trim(p_account_holder_postal_code), ''),
    nullif(trim(p_account_holder_city), ''),
    normalized_country,
    normalized_model,
    normalized_purpose,
    p_is_active,
    p_actor_user_id,
    p_actor_user_id
  )
  on conflict (organization_id) do update
  set
    account_holder_name = excluded.account_holder_name,
    iban = excluded.iban,
    bic = excluded.bic,
    account_holder_address = excluded.account_holder_address,
    account_holder_postal_code = excluded.account_holder_postal_code,
    account_holder_city = excluded.account_holder_city,
    account_holder_country_code = excluded.account_holder_country_code,
    payment_model = excluded.payment_model,
    purpose_code = excluded.purpose_code,
    is_active = excluded.is_active,
    updated_by_user_id = excluded.updated_by_user_id
  returning * into saved_profile;

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
    'organization_bank_transfer_profile',
    saved_profile.id,
    case when previous_profile.id is null then 'bank_transfer_profile.created' else 'bank_transfer_profile.updated' end,
    jsonb_build_object(
      'previousIbanLast4', case when previous_profile.id is null then null else right(previous_profile.iban, 4) end,
      'ibanLast4', right(saved_profile.iban, 4),
      'countryCode', saved_profile.account_holder_country_code,
      'paymentModel', saved_profile.payment_model,
      'active', saved_profile.is_active
    )
  );

  return saved_profile.id;
end;
$$;

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
    category.name,
    coalesce(
      category.start_at,
      edition.start_date::timestamp at time zone edition.timezone
    )
  into target_organization_id, target_category_name, target_race_start_at
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = target_registration.event_category_id;

  target_payment_due_at := target_race_start_at - interval '24 hours';

  select profile.*
  into target_profile
  from public.organization_bank_transfer_profiles profile
  where profile.organization_id = target_organization_id
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
        'raceStartAt', target_race_start_at
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

  -- A direct bank transfer uses the race-relative payment deadline rather
  -- than the generic 60-minute online-checkout window. The request itself is
  -- never expired here; only the unpaid capacity hold can be released later.
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

create or replace function public.align_bank_transfer_capacity_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_deadline timestamptz;
begin
  select request.due_at
  into payment_deadline
  from public.registration_payment_requests request
  where request.registration_id = new.registration_id
    and request.quote_id = new.quote_id
    and request.status in ('awaiting_payment', 'reported');

  if payment_deadline is not null then
    new.expires_at := payment_deadline;
  end if;

  return new;
end;
$$;

create trigger capacity_reservations_align_bank_transfer_deadline
before insert on public.capacity_reservations
for each row execute function public.align_bank_transfer_capacity_deadline();

create or replace function public.initialize_registration_bank_transfer_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.total_cents > 0 then
    perform public.service_ensure_registration_bank_transfer_request(new.registration_id, null);
  end if;
  return new;
end;
$$;

create trigger registration_quotes_initialize_bank_transfer_request
after insert on public.registration_quotes
for each row execute function public.initialize_registration_bank_transfer_request();

create or replace function public.service_report_registration_bank_transfer(
  p_registration_id uuid,
  p_actor_user_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_request public.registration_payment_requests%rowtype;
begin
  select request.*
  into target_request
  from public.registration_payment_requests request
  where request.registration_id = p_registration_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'bank_transfer_request_not_found';
  end if;

  if target_request.status = 'paid' then
    return target_request.id;
  end if;

  if target_request.status = 'awaiting_payment' then
    update public.registration_payment_requests request
    set
      status = 'reported',
      payment_reported_at = now()
    where request.id = target_request.id;

    insert into public.registration_payment_events (
      payment_request_id,
      organization_id,
      registration_id,
      event_type,
      source,
      actor_user_id,
      amount_cents,
      currency,
      reason
    )
    values (
      target_request.id,
      target_request.organization_id,
      target_request.registration_id,
      'reported',
      'athlete',
      p_actor_user_id,
      target_request.amount_cents,
      target_request.currency,
      nullif(trim(p_note), '')
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
      target_request.organization_id,
      p_actor_user_id,
      'registration_payment_request',
      target_request.id,
      'bank_transfer.reported',
      jsonb_build_object('registrationId', target_request.registration_id)
    );
  end if;

  return target_request.id;
end;
$$;

create or replace function public.sync_registration_payment_request_from_ledger_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_request public.registration_payment_requests%rowtype;
  resolved_source text;
  resolved_actor uuid;
begin
  if new.entry_type <> 'charge' or new.registration_id is null then
    return new;
  end if;

  select request.*
  into target_request
  from public.registration_payment_requests request
  where request.registration_id = new.registration_id
  for update;

  if target_request.id is null then
    return new;
  end if;

  resolved_source := case
    when new.metadata_json->>'source' = 'payment_evidence' then 'payment_evidence'
    when new.metadata_json->>'provider' is not null then 'provider'
    else 'organizer'
  end;

  begin
    resolved_actor := nullif(
      coalesce(new.metadata_json->>'recordedByUserId', new.metadata_json->>'reviewedByUserId'),
      ''
    )::uuid;
  exception when invalid_text_representation then
    resolved_actor := null;
  end;

  update public.registration_payment_requests request
  set
    status = 'paid',
    settled_at = coalesce(request.settled_at, new.effective_at)
  where request.id = target_request.id;

  insert into public.registration_payment_events (
    payment_request_id,
    organization_id,
    registration_id,
    ledger_entry_id,
    event_type,
    source,
    actor_user_id,
    amount_cents,
    currency,
    bank_reference,
    reason,
    metadata_json,
    effective_at
  )
  values (
    target_request.id,
    target_request.organization_id,
    target_request.registration_id,
    new.id,
    'settled',
    resolved_source,
    resolved_actor,
    abs(new.amount_cents)::integer,
    new.currency,
    nullif(new.metadata_json->>'bankReference', ''),
    nullif(new.metadata_json->>'reason', ''),
    jsonb_build_object('ledgerEntryId', new.id, 'externalReference', new.external_reference),
    new.effective_at
  )
  on conflict (ledger_entry_id) do nothing;

  return new;
end;
$$;

create trigger financial_ledger_sync_registration_payment_request
after insert on public.financial_ledger_entries
for each row execute function public.sync_registration_payment_request_from_ledger_charge();

create unique index financial_ledger_manual_bank_charge_uidx
  on public.financial_ledger_entries (external_reference)
  where entry_type = 'charge'
    and external_reference like 'bank-transfer:%';

create or replace function public.service_record_registration_bank_payment(
  p_registration_id uuid,
  p_actor_user_id uuid,
  p_amount_cents integer,
  p_currency text,
  p_paid_at timestamptz,
  p_bank_reference text,
  p_reason text,
  p_idempotency_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_request public.registration_payment_requests%rowtype;
  target_registration public.registrations%rowtype;
  target_quote public.registration_quotes%rowtype;
  category_row public.event_categories%rowtype;
  active_reservation public.capacity_reservations%rowtype;
  previous_status public.registration_status;
  occupied_count bigint;
  ledger_reference text := 'bank-transfer:' || p_idempotency_key_hash;
  ledger_entry public.financial_ledger_entries%rowtype;
begin
  if p_amount_cents <= 0
     or upper(trim(coalesce(p_currency, ''))) !~ '^[A-Z]{3}$'
     or p_paid_at is null
     or length(trim(coalesce(p_reason, ''))) < 3
     or length(trim(coalesce(p_idempotency_key_hash, ''))) < 32 then
    raise exception using errcode = '22023', message = 'invalid_manual_bank_payment';
  end if;

  select ledger.*
  into ledger_entry
  from public.financial_ledger_entries ledger
  where ledger.external_reference = ledger_reference
    and ledger.entry_type = 'charge';

  if ledger_entry.id is not null then
    if ledger_entry.registration_id is distinct from p_registration_id then
      raise exception using errcode = '23505', message = 'bank_payment_idempotency_conflict';
    end if;

    return jsonb_build_object(
      'paymentRequestId', (
        select request.id
        from public.registration_payment_requests request
        where request.registration_id = p_registration_id
      ),
      'registrationId', p_registration_id,
      'ledgerEntryId', ledger_entry.id,
      'paymentStatus', 'paid',
      'replayed', true
    );
  end if;

  select request.*
  into target_request
  from public.registration_payment_requests request
  where request.registration_id = p_registration_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'bank_transfer_request_not_found';
  end if;

  if target_request.status = 'paid' then
    raise exception using errcode = 'P0001', message = 'registration_already_paid';
  end if;

  if p_amount_cents <> target_request.amount_cents
     or upper(trim(p_currency)) <> trim(target_request.currency) then
    raise exception using errcode = '22023', message = 'manual_bank_payment_amount_mismatch';
  end if;

  select registration.*
  into target_registration
  from public.registrations registration
  where registration.id = target_request.registration_id
  for update;

  select quote.*
  into target_quote
  from public.registration_quotes quote
  where quote.id = target_request.quote_id
  for update;

  select category.*
  into category_row
  from public.event_categories category
  where category.id = target_registration.event_category_id
  for update;

  if target_quote.id is null
     or target_quote.total_cents <> target_request.amount_cents
     or trim(target_quote.currency) <> trim(target_request.currency) then
    raise exception using errcode = '22023', message = 'manual_bank_payment_quote_mismatch';
  end if;

  if target_registration.status <> 'confirmed' then
    select reservation.*
    into active_reservation
    from public.capacity_reservations reservation
    where reservation.registration_id = target_registration.id
      and reservation.state = 'active'
      and reservation.expires_at > now()
    for update;

    if active_reservation.id is null then
      perform public.service_expire_registration_holds(target_registration.event_category_id);

      select
        (
          select count(*)
          from public.registrations registration
          where registration.event_category_id = target_registration.event_category_id
            and registration.status = 'confirmed'
        ) + (
          select count(*)
          from public.capacity_reservations reservation
          where reservation.event_category_id = target_registration.event_category_id
            and reservation.state = 'active'
            and reservation.expires_at > now()
        )
      into occupied_count;

      if category_row.capacity is not null and occupied_count >= category_row.capacity then
        raise exception using errcode = 'P0001', message = 'capacity_reservation_expired';
      end if;

      insert into public.capacity_reservations (
        registration_id,
        event_category_id,
        quote_id,
        state,
        source,
        expires_at
      )
      values (
        target_registration.id,
        target_registration.event_category_id,
        target_quote.id,
        'active',
        'organizer',
        now() + interval '5 minutes'
      )
      returning * into active_reservation;
    end if;
  end if;

  previous_status := target_registration.status;

  update public.registrations registration
  set
    status = 'confirmed',
    payment_status = 'paid',
    paid_at = coalesce(registration.paid_at, p_paid_at),
    confirmed_at = coalesce(registration.confirmed_at, now()),
    updated_at = now()
  where registration.id = target_registration.id;

  update public.registration_quotes quote
  set
    state = 'accepted',
    accepted_at = coalesce(quote.accepted_at, p_paid_at)
  where quote.id = target_quote.id;

  update public.capacity_reservations reservation
  set
    state = 'consumed',
    consumed_at = now()
  where reservation.id = active_reservation.id
    and reservation.state = 'active';

  update public.registration_waitlist_entries entry
  set
    state = 'accepted',
    accepted_at = now()
  where entry.registration_id = target_registration.id
    and entry.state = 'offered';

  insert into public.financial_ledger_entries (
    organization_id,
    registration_id,
    entry_type,
    amount_cents,
    currency,
    external_reference,
    description,
    metadata_json,
    effective_at
  )
  values (
    target_request.organization_id,
    target_registration.id,
    'charge',
    target_request.amount_cents,
    target_request.currency,
    ledger_reference,
    'Organizer confirmed direct bank transfer',
    jsonb_build_object(
      'source', 'organizer',
      'paymentRequestId', target_request.id,
      'quoteId', target_quote.id,
      'bankReference', nullif(trim(p_bank_reference), ''),
      'reason', trim(p_reason),
      'recordedByUserId', p_actor_user_id
    ),
    p_paid_at
  )
  returning * into ledger_entry;

  if previous_status <> 'confirmed' then
    insert into public.registration_status_history (
      registration_id,
      from_status,
      to_status,
      changed_by_user_id,
      reason
    )
    values (
      target_registration.id,
      previous_status,
      'confirmed',
      p_actor_user_id,
      'manual_bank_payment_recorded'
    );
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
    target_request.organization_id,
    p_actor_user_id,
    'registration_payment_request',
    target_request.id,
    'bank_transfer.settled',
    jsonb_build_object(
      'registrationId', target_registration.id,
      'ledgerEntryId', ledger_entry.id,
      'amountCents', target_request.amount_cents,
      'currency', target_request.currency,
      'bankReference', nullif(trim(p_bank_reference), ''),
      'paidAt', p_paid_at,
      'reason', trim(p_reason)
    )
  );

  return jsonb_build_object(
    'paymentRequestId', target_request.id,
    'registrationId', target_registration.id,
    'ledgerEntryId', ledger_entry.id,
    'paymentStatus', 'paid',
    'replayed', false
  );
end;
$$;

alter table public.organization_bank_transfer_profiles enable row level security;
alter table public.registration_payment_requests enable row level security;
alter table public.registration_payment_events enable row level security;

revoke all on sequence public.registration_payment_reference_seq
from public, anon, authenticated;

revoke all on table
  public.organization_bank_transfer_profiles,
  public.registration_payment_requests,
  public.registration_payment_events
from public, anon, authenticated;

grant usage, select on sequence public.registration_payment_reference_seq to service_role;

grant all on table
  public.organization_bank_transfer_profiles,
  public.registration_payment_requests,
  public.registration_payment_events
to service_role;

revoke all on function public.service_save_organization_bank_transfer_profile(
  uuid, uuid, text, text, text, text, text, text, text, text, text, boolean
) from public, anon, authenticated;
revoke all on function public.service_ensure_registration_bank_transfer_request(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.align_bank_transfer_capacity_deadline()
from public, anon, authenticated;
revoke all on function public.service_report_registration_bank_transfer(uuid, uuid, text)
from public, anon, authenticated;
revoke all on function public.service_record_registration_bank_payment(
  uuid, uuid, integer, text, timestamptz, text, text, text
) from public, anon, authenticated;

grant execute on function public.service_save_organization_bank_transfer_profile(
  uuid, uuid, text, text, text, text, text, text, text, text, text, boolean
) to service_role;
grant execute on function public.service_ensure_registration_bank_transfer_request(uuid, uuid)
to service_role;
grant execute on function public.service_report_registration_bank_transfer(uuid, uuid, text)
to service_role;
grant execute on function public.service_record_registration_bank_payment(
  uuid, uuid, integer, text, timestamptz, text, text, text
) to service_role;
