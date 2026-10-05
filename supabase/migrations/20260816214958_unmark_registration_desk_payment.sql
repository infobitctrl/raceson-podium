/*
 * Correct an accidental Race Day desk payment without deleting financial
 * history. The original charge remains immutable; this operation appends a
 * compensating adjustment plus payment and audit events.
 */

alter table public.registration_payment_events
  drop constraint if exists registration_payment_events_event_type_check;

alter table public.registration_payment_events
  add constraint registration_payment_events_event_type_check
  check (event_type in ('requested', 'reported', 'settled', 'reversed'));

create unique index financial_ledger_registration_desk_reversal_uidx
  on public.financial_ledger_entries (external_reference)
  where entry_type = 'adjustment'
    and external_reference like 'race-day-desk-reversal:%';

create or replace function public.service_unmark_registration_desk_payment(
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
  target_request public.registration_payment_requests%rowtype;
  original_charge public.financial_ledger_entries%rowtype;
  reversal_entry public.financial_ledger_entries%rowtype;
  reversal_reference text := 'race-day-desk-reversal:' || p_idempotency_key_hash;
begin
  if length(trim(coalesce(p_idempotency_key_hash, ''))) < 32 then
    raise exception using errcode = '22023', message = 'invalid_registration_desk_payment_reversal';
  end if;

  select ledger.*
  into reversal_entry
  from public.financial_ledger_entries ledger
  where ledger.external_reference = reversal_reference
    and ledger.entry_type = 'adjustment';

  if reversal_entry.id is not null then
    if reversal_entry.registration_id is distinct from p_registration_id then
      raise exception using errcode = '23505', message = 'registration_desk_payment_reversal_idempotency_conflict';
    end if;

    return jsonb_build_object(
      'registrationId', p_registration_id,
      'paymentStatus', 'unpaid',
      'ledgerEntryId', reversal_entry.id,
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
  if target_registration.payment_status <> 'paid' then
    raise exception using errcode = 'P0001', message = 'registration_payment_not_paid';
  end if;
  if target_registration.participation_status::text <> 'not_started'
     or exists (
       select 1
       from public.checkins checkin
       where checkin.registration_id = target_registration.id
     ) then
    raise exception using errcode = 'P0001', message = 'registration_payment_reversal_after_checkin';
  end if;

  select ledger.*
  into original_charge
  from public.financial_ledger_entries ledger
  where ledger.registration_id = target_registration.id
    and ledger.entry_type = 'charge'
    and ledger.external_reference like 'race-day-desk:%'
    and not exists (
      select 1
      from public.financial_ledger_entries adjustment
      where adjustment.entry_type = 'adjustment'
        and adjustment.metadata_json->>'reversesLedgerEntryId' = ledger.id::text
    )
  order by ledger.effective_at desc, ledger.created_at desc
  limit 1;

  if original_charge.id is null then
    raise exception using errcode = 'P0001', message = 'registration_desk_payment_not_recorded';
  end if;

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
    original_charge.organization_id,
    target_registration.id,
    'adjustment',
    -abs(original_charge.amount_cents),
    original_charge.currency,
    reversal_reference,
    'Race Day desk payment unmarked by organizer',
    jsonb_build_object(
      'source', 'race_day_desk',
      'reason', 'Payment unmarked at Race Day registration desk',
      'recordedByUserId', p_actor_user_id,
      'reversesLedgerEntryId', original_charge.id
    )
  )
  returning * into reversal_entry;

  update public.registrations registration
  set
    payment_status = 'unpaid',
    paid_at = null,
    updated_at = now()
  where registration.id = target_registration.id;

  select request.*
  into target_request
  from public.registration_payment_requests request
  where request.registration_id = target_registration.id
  for update;

  if target_request.id is not null then
    update public.registration_payment_requests request
    set
      status = case
        when request.payment_reported_at is not null then 'reported'
        else 'awaiting_payment'
      end,
      settled_at = null
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
      reason,
      metadata_json
    )
    values (
      target_request.id,
      target_request.organization_id,
      target_registration.id,
      reversal_entry.id,
      'reversed',
      'organizer',
      p_actor_user_id,
      abs(original_charge.amount_cents)::integer,
      original_charge.currency,
      'Payment unmarked at Race Day registration desk',
      jsonb_build_object(
        'ledgerEntryId', reversal_entry.id,
        'reversesLedgerEntryId', original_charge.id
      )
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
    original_charge.organization_id,
    p_actor_user_id,
    'registration',
    target_registration.id,
    'race_day_desk.payment_unmarked',
    jsonb_build_object(
      'ledgerEntryId', reversal_entry.id,
      'reversesLedgerEntryId', original_charge.id,
      'amountCents', abs(original_charge.amount_cents),
      'currency', original_charge.currency
    )
  );

  return jsonb_build_object(
    'registrationId', target_registration.id,
    'paymentStatus', 'unpaid',
    'ledgerEntryId', reversal_entry.id,
    'replayed', false
  );
end;
$$;

revoke all on function public.service_unmark_registration_desk_payment(
  uuid, uuid, text
) from public, anon, authenticated;

grant execute on function public.service_unmark_registration_desk_payment(
  uuid, uuid, text
) to service_role;
