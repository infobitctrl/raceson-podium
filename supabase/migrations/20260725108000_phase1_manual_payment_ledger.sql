/*
 * Manual payment evidence uses the same capacity, quote, ledger, and audit
 * invariants as provider payments. Once an evidence-based charge is posted,
 * rejecting that evidence requires an explicit refund/adjustment workflow.
 */

create unique index financial_ledger_manual_evidence_charge_uidx
  on public.financial_ledger_entries (external_reference)
  where entry_type = 'charge'
    and external_reference like 'payment-evidence:%';

create or replace function public.review_registration_payment_evidence_atomically(
  target_evidence_id uuid,
  target_reviewer_user_id uuid,
  target_review_status text,
  target_organizer_note text default null
)
returns table (
  evidence_id uuid,
  registration_id uuid,
  review_status text,
  payment_status public.payment_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  evidence_row public.registration_payment_evidence%rowtype;
  registration_row public.registrations%rowtype;
  category_row public.event_categories%rowtype;
  organization_id uuid;
  target_quote public.registration_quotes%rowtype;
  active_reservation public.capacity_reservations%rowtype;
  replacement_evidence_id uuid;
  resolved_payment_status public.payment_status;
  previous_registration_status public.registration_status;
  occupied_count bigint;
  fee_cents integer;
  quote_currency char(3);
  quote_id uuid;
  manual_reference text;
begin
  if target_review_status not in ('verified', 'rejected') then
    raise exception using errcode = '22023', message = 'invalid_payment_evidence_review_status';
  end if;

  select evidence.*
  into evidence_row
  from public.registration_payment_evidence evidence
  where evidence.id = target_evidence_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'payment_evidence_not_found';
  end if;

  select registration.*
  into registration_row
  from public.registrations registration
  where registration.id = evidence_row.registration_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'registration_not_found';
  end if;

  select category.*
  into category_row
  from public.event_categories category
  where category.id = registration_row.event_category_id
  for update;

  select series.organization_id
  into organization_id
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = category_row.event_edition_id;

  fee_cents := greatest(coalesce(category_row.registration_fee_cents, 0), 0);
  quote_currency := upper(coalesce(category_row.currency, 'EUR'))::char(3);
  manual_reference := 'payment-evidence:' || evidence_row.id::text;

  if target_review_status = 'rejected'
     and exists (
       select 1
       from public.financial_ledger_entries ledger
       where ledger.external_reference = manual_reference
         and ledger.entry_type = 'charge'
     ) then
    raise exception using errcode = 'P0001', message = 'manual_payment_already_posted';
  end if;

  update public.registration_payment_evidence evidence
  set
    review_status = target_review_status,
    reviewed_by_user_id = target_reviewer_user_id,
    organizer_note = nullif(trim(target_organizer_note), ''),
    reviewed_at = now()
  where evidence.id = target_evidence_id;

  if target_review_status = 'verified' then
    if fee_cents <= 0 then
      raise exception using errcode = '22023', message = 'payment_not_required';
    end if;

    if evidence_row.amount_cents is not null
       and evidence_row.amount_cents <> fee_cents then
      raise exception using errcode = '22023', message = 'manual_payment_amount_mismatch';
    end if;

    if evidence_row.currency is not null
       and upper(evidence_row.currency) <> trim(quote_currency) then
      raise exception using errcode = '22023', message = 'manual_payment_currency_mismatch';
    end if;

    if registration_row.current_quote_id is not null then
      select quote.*
      into target_quote
      from public.registration_quotes quote
      where quote.id = registration_row.current_quote_id
      for update;
    end if;

    if target_quote.id is null then
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
        registration_row.id,
        registration_row.event_category_id,
        organization_id,
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
          'manualPayment', true
        ),
        now() + interval '1 day',
        now()
      from public.registration_quotes existing
      where existing.registration_id = registration_row.id
      returning id into quote_id;

      update public.registrations registration
      set current_quote_id = quote_id
      where registration.id = registration_row.id;

      select quote.*
      into target_quote
      from public.registration_quotes quote
      where quote.id = quote_id;
    elsif target_quote.total_cents <> fee_cents
       or trim(target_quote.currency) <> trim(quote_currency) then
      raise exception using errcode = '22023', message = 'manual_payment_quote_mismatch';
    end if;

    if registration_row.status <> 'confirmed' then
      select reservation.*
      into active_reservation
      from public.capacity_reservations reservation
      where reservation.registration_id = registration_row.id
        and reservation.state = 'active'
        and reservation.expires_at > now()
      for update;

      if active_reservation.id is null then
        perform public.service_expire_registration_holds(registration_row.event_category_id);

        select
          (
            select count(*)
            from public.registrations registration
            where registration.event_category_id = registration_row.event_category_id
              and registration.status = 'confirmed'
          ) + (
            select count(*)
            from public.capacity_reservations reservation
            where reservation.event_category_id = registration_row.event_category_id
              and reservation.state = 'active'
              and reservation.expires_at > now()
          )
        into occupied_count;

        if category_row.capacity is not null
           and occupied_count >= category_row.capacity then
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
          registration_row.id,
          registration_row.event_category_id,
          target_quote.id,
          'active',
          'organizer',
          now() + interval '5 minutes'
        )
        returning * into active_reservation;
      end if;
    end if;

    previous_registration_status := registration_row.status;

    update public.registrations registration
    set
      verified_payment_evidence_id = target_evidence_id,
      status = 'confirmed',
      payment_status = 'paid',
      paid_at = coalesce(registration.paid_at, now()),
      confirmed_at = coalesce(registration.confirmed_at, now()),
      updated_at = now()
    where registration.id = registration_row.id
    returning registration.payment_status into resolved_payment_status;

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
    where entry.registration_id = registration_row.id
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
      organization_id,
      registration_row.id,
      'charge',
      fee_cents,
      quote_currency,
      manual_reference,
      'Registration payment verified from organizer evidence',
      jsonb_build_object(
        'source', 'payment_evidence',
        'evidenceId', evidence_row.id,
        'quoteId', target_quote.id,
        'reviewedByUserId', target_reviewer_user_id
      )
    )
    on conflict (external_reference)
      where entry_type = 'charge'
        and external_reference like 'payment-evidence:%'
      do nothing;

    if previous_registration_status <> 'confirmed' then
      insert into public.registration_status_history (
        registration_id,
        from_status,
        to_status,
        changed_by_user_id,
        reason
      )
      values (
        registration_row.id,
        previous_registration_status,
        'confirmed',
        target_reviewer_user_id,
        'manual_payment_verified'
      );
    end if;
  else
    select evidence.id
    into replacement_evidence_id
    from public.registration_payment_evidence evidence
    where evidence.registration_id = evidence_row.registration_id
      and evidence.id <> target_evidence_id
      and evidence.review_status = 'verified'
    order by evidence.reviewed_at desc nulls last, evidence.submitted_at desc
    limit 1;

    update public.registrations registration
    set
      verified_payment_evidence_id = replacement_evidence_id,
      payment_status = case
        when replacement_evidence_id is not null then 'paid'::public.payment_status
        when registration.verified_payment_evidence_id = target_evidence_id
          then 'unpaid'::public.payment_status
        else registration.payment_status
      end
    where registration.id = evidence_row.registration_id
    returning registration.payment_status into resolved_payment_status;
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
    organization_id,
    target_reviewer_user_id,
    'registration_payment_evidence',
    evidence_row.id,
    case
      when target_review_status = 'verified' then 'manual_payment.verified'
      else 'manual_payment.rejected'
    end,
    jsonb_build_object(
      'registrationId', registration_row.id,
      'reviewStatus', target_review_status,
      'paymentStatus', resolved_payment_status,
      'amountCents', evidence_row.amount_cents,
      'currency', evidence_row.currency
    )
  );

  return query
  select
    target_evidence_id,
    evidence_row.registration_id,
    target_review_status,
    resolved_payment_status;
end;
$$;

revoke all on function public.review_registration_payment_evidence_atomically(
  uuid, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.review_registration_payment_evidence_atomically(
  uuid, uuid, text, text
) to service_role;
