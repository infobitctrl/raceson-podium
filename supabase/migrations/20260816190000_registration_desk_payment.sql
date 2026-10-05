/*
 * Race-day registration desks may confirm an in-person payment with one
 * action. Keep that shortcut inside the same quote, capacity, ledger, and
 * audit invariants as every other registration payment path.
 */

create unique index financial_ledger_registration_desk_charge_uidx
  on public.financial_ledger_entries (external_reference)
  where entry_type = 'charge'
    and external_reference like 'race-day-desk:%';

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
  target_quote public.registration_quotes%rowtype;
  category_row public.event_categories%rowtype;
  active_reservation public.capacity_reservations%rowtype;
  previous_status public.registration_status;
  target_organization_id uuid;
  occupied_count bigint;
  fee_cents integer;
  quote_currency char(3);
  quote_id uuid;
  ledger_reference text := 'race-day-desk:' || p_idempotency_key_hash;
  ledger_entry public.financial_ledger_entries%rowtype;
begin
  if length(trim(coalesce(p_idempotency_key_hash, ''))) < 32 then
    raise exception using errcode = '22023', message = 'invalid_registration_desk_payment';
  end if;

  select ledger.*
  into ledger_entry
  from public.financial_ledger_entries ledger
  where ledger.external_reference = ledger_reference
    and ledger.entry_type = 'charge';

  if ledger_entry.id is not null then
    if ledger_entry.registration_id is distinct from p_registration_id then
      raise exception using errcode = '23505', message = 'registration_desk_payment_idempotency_conflict';
    end if;

    return jsonb_build_object(
      'registrationId', p_registration_id,
      'paymentStatus', 'paid',
      'registrationStatus', 'confirmed',
      'ledgerEntryId', ledger_entry.id,
      'replayed', true
    );
  end if;

  select registration.*
  into target_registration
  from public.registrations registration
  where registration.id = p_registration_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'registration_not_found';
  end if;

  if target_registration.payment_status = 'paid' then
    return jsonb_build_object(
      'registrationId', target_registration.id,
      'paymentStatus', 'paid',
      'registrationStatus', target_registration.status,
      'ledgerEntryId', null,
      'replayed', true
    );
  end if;
  if target_registration.payment_status = 'not_required' then
    raise exception using errcode = 'P0001', message = 'registration_payment_not_required';
  end if;
  if target_registration.status::text in ('cancelled', 'expired', 'transferred', 'deferred') then
    raise exception using errcode = 'P0001', message = 'registration_payment_not_payable';
  end if;
  if target_registration.payment_status::text not in ('unpaid', 'pending', 'failed') then
    raise exception using errcode = 'P0001', message = 'registration_payment_not_payable';
  end if;

  select category.*
  into category_row
  from public.event_categories category
  where category.id = target_registration.event_category_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'registration_category_not_found';
  end if;

  select series.organization_id
  into target_organization_id
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = category_row.event_edition_id;

  if target_registration.current_quote_id is not null then
    select quote.*
    into target_quote
    from public.registration_quotes quote
    where quote.id = target_registration.current_quote_id
    for update;
  end if;

  if target_quote.id is null then
    fee_cents := greatest(coalesce(category_row.registration_fee_cents, 0), 0);
    quote_currency := upper(coalesce(category_row.currency, 'EUR'))::char(3);
    if fee_cents <= 0 then
      raise exception using errcode = '22023', message = 'registration_payment_not_required';
    end if;

    insert into public.registration_quotes (
      registration_id,
      event_category_id,
      organization_id,
      version,
      state,
      currency,
      subtotal_cents,
      total_cents,
      line_items_json,
      pricing_snapshot_json,
      expires_at,
      accepted_at
    )
    select
      target_registration.id,
      target_registration.event_category_id,
      target_organization_id,
      coalesce(max(existing.version), 0) + 1,
      'accepted',
      quote_currency,
      fee_cents,
      fee_cents,
      jsonb_build_array(
        jsonb_build_object(
          'type', 'registration_fee',
          'label', category_row.name,
          'quantity', 1,
          'unitAmountCents', fee_cents,
          'totalCents', fee_cents
        )
      ),
      jsonb_build_object(
        'eventCategoryId', category_row.id,
        'eventCategoryName', category_row.name,
        'registrationFeeCents', fee_cents,
        'currency', quote_currency,
        'manualPayment', true,
        'source', 'race_day_desk'
      ),
      now() + interval '1 day',
      now()
    from public.registration_quotes existing
    where existing.registration_id = target_registration.id
    returning id into quote_id;

    update public.registrations registration
    set current_quote_id = quote_id
    where registration.id = target_registration.id;

    select quote.*
    into target_quote
    from public.registration_quotes quote
    where quote.id = quote_id;
  end if;

  if target_quote.id is null
     or target_quote.total_cents <= 0
     or trim(target_quote.currency) !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'registration_payment_quote_invalid';
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
    paid_at = coalesce(registration.paid_at, now()),
    confirmed_at = coalesce(registration.confirmed_at, now()),
    updated_at = now()
  where registration.id = target_registration.id;

  update public.registration_quotes quote
  set
    state = 'accepted',
    accepted_at = coalesce(quote.accepted_at, now())
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
    metadata_json
  )
  values (
    target_organization_id,
    target_registration.id,
    'charge',
    target_quote.total_cents,
    target_quote.currency,
    ledger_reference,
    'Registration payment confirmed at Race Day desk',
    jsonb_build_object(
      'source', 'race_day_desk',
      'quoteId', target_quote.id,
      'reason', 'Payment confirmed at Race Day registration desk',
      'recordedByUserId', p_actor_user_id
    )
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
      'race_day_desk_payment_recorded'
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
    target_organization_id,
    p_actor_user_id,
    'registration',
    target_registration.id,
    'race_day_desk.payment_recorded',
    jsonb_build_object(
      'ledgerEntryId', ledger_entry.id,
      'quoteId', target_quote.id,
      'amountCents', target_quote.total_cents,
      'currency', target_quote.currency
    )
  );

  return jsonb_build_object(
    'registrationId', target_registration.id,
    'paymentStatus', 'paid',
    'registrationStatus', 'confirmed',
    'ledgerEntryId', ledger_entry.id,
    'replayed', false
  );
end;
$$;

revoke all on function public.service_record_registration_desk_payment(
  uuid, uuid, text
) from public, anon, authenticated;

grant execute on function public.service_record_registration_desk_payment(
  uuid, uuid, text
) to service_role;
