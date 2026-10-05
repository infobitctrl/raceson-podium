/*
 * Keep the bank-transfer due date as payment guidance without using it to
 * expire a registration. Capacity remains held through the operational race
 * desk window, and a desk payment may restore a legacy registration that was
 * expired by the former 24-hour-before-start rule after rechecking capacity.
 */

create or replace function public.align_bank_transfer_capacity_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  operational_hold_expires_at timestamptz;
begin
  select greatest(
    coalesce(
      category.start_at,
      edition.start_date::timestamp at time zone edition.timezone
    ) + interval '1 day',
    coalesce(edition.registration_close_at, '-infinity'::timestamptz)
  )
  into operational_hold_expires_at
  from public.registrations registration
  join public.event_categories category
    on category.id = registration.event_category_id
  join public.event_editions edition
    on edition.id = category.event_edition_id
  where registration.id = new.registration_id
    and exists (
      select 1
      from public.registration_payment_requests request
      where request.registration_id = new.registration_id
        and request.quote_id is not distinct from new.quote_id
        and request.status in ('awaiting_payment', 'reported')
    );

  if operational_hold_expires_at is not null then
    new.expires_at := operational_hold_expires_at;
  end if;

  return new;
end;
$$;

revoke all on function public.align_bank_transfer_capacity_deadline()
from public, anon, authenticated;
grant execute on function public.align_bank_transfer_capacity_deadline()
to service_role;

drop trigger if exists capacity_reservations_align_bank_transfer_deadline
on public.capacity_reservations;

create trigger capacity_reservations_align_bank_transfer_deadline
before insert or update of expires_at on public.capacity_reservations
for each row execute function public.align_bank_transfer_capacity_deadline();

create or replace function public.align_bank_transfer_quote_hold_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  operational_hold_expires_at timestamptz;
begin
  select greatest(
    coalesce(
      category.start_at,
      edition.start_date::timestamp at time zone edition.timezone
    ) + interval '1 day',
    coalesce(edition.registration_close_at, '-infinity'::timestamptz)
  )
  into operational_hold_expires_at
  from public.registrations registration
  join public.event_categories category
    on category.id = registration.event_category_id
  join public.event_editions edition
    on edition.id = category.event_edition_id
  where registration.id = new.registration_id
    and exists (
      select 1
      from public.registration_payment_requests request
      where request.registration_id = new.registration_id
        and request.quote_id = new.id
        and request.status in ('awaiting_payment', 'reported')
    );

  if operational_hold_expires_at is not null then
    new.expires_at := operational_hold_expires_at;
  end if;

  return new;
end;
$$;

revoke all on function public.align_bank_transfer_quote_hold_expiry()
from public, anon, authenticated;
grant execute on function public.align_bank_transfer_quote_hold_expiry()
to service_role;

drop trigger if exists registration_quotes_align_bank_transfer_hold
on public.registration_quotes;

create trigger registration_quotes_align_bank_transfer_hold
before update of expires_at on public.registration_quotes
for each row execute function public.align_bank_transfer_quote_hold_expiry();

with operational_holds as (
  select
    request.registration_id,
    request.quote_id,
    greatest(
      coalesce(
        category.start_at,
        edition.start_date::timestamp at time zone edition.timezone
      ) + interval '1 day',
      coalesce(edition.registration_close_at, '-infinity'::timestamptz)
    ) as expires_at
  from public.registration_payment_requests request
  join public.registrations registration
    on registration.id = request.registration_id
  join public.event_categories category
    on category.id = registration.event_category_id
  join public.event_editions edition
    on edition.id = category.event_edition_id
  where request.status in ('awaiting_payment', 'reported')
)
update public.registration_quotes quote
set expires_at = hold.expires_at
from operational_holds hold
where quote.id = hold.quote_id
  and quote.state = 'active'
  and quote.expires_at is distinct from hold.expires_at;

with operational_holds as (
  select
    request.registration_id,
    request.quote_id,
    greatest(
      coalesce(
        category.start_at,
        edition.start_date::timestamp at time zone edition.timezone
      ) + interval '1 day',
      coalesce(edition.registration_close_at, '-infinity'::timestamptz)
    ) as expires_at
  from public.registration_payment_requests request
  join public.registrations registration
    on registration.id = request.registration_id
  join public.event_categories category
    on category.id = registration.event_category_id
  join public.event_editions edition
    on edition.id = category.event_edition_id
  where request.status in ('awaiting_payment', 'reported')
)
update public.capacity_reservations reservation
set expires_at = hold.expires_at
from operational_holds hold
where reservation.registration_id = hold.registration_id
  and reservation.quote_id = hold.quote_id
  and reservation.state = 'active'
  and reservation.expires_at is distinct from hold.expires_at;

with candidate_holds as (
  select
    registration.id as registration_id,
    request.quote_id,
    reservation.id as reservation_id,
    category.id as event_category_id,
    greatest(
      coalesce(
        category.start_at,
        edition.start_date::timestamp at time zone edition.timezone
      ) + interval '1 day',
      coalesce(edition.registration_close_at, '-infinity'::timestamptz)
    ) as expires_at,
    category.capacity,
    row_number() over (
      partition by category.id
      order by registration.created_at, registration.id
    ) as candidate_position,
    (
      select count(*)
      from public.registrations confirmed_registration
      where confirmed_registration.event_category_id = category.id
        and confirmed_registration.status = 'confirmed'
    ) + (
      select count(*)
      from public.capacity_reservations active_reservation
      where active_reservation.event_category_id = category.id
        and active_reservation.state = 'active'
        and active_reservation.expires_at > now()
    ) as occupied_count
  from public.registrations registration
  join lateral (
    select payment_request.*
    from public.registration_payment_requests payment_request
    where payment_request.registration_id = registration.id
      and payment_request.status in ('awaiting_payment', 'reported')
    order by payment_request.created_at desc, payment_request.id
    limit 1
  ) request on true
  join public.registration_quotes quote
    on quote.id = request.quote_id
   and quote.registration_id = registration.id
   and quote.state = 'expired'
  join lateral (
    select expired_reservation.*
    from public.capacity_reservations expired_reservation
    where expired_reservation.registration_id = registration.id
      and expired_reservation.quote_id = request.quote_id
      and expired_reservation.state = 'expired'
    order by expired_reservation.created_at desc, expired_reservation.id
    limit 1
  ) reservation on true
  join public.event_categories category
    on category.id = registration.event_category_id
  join public.event_editions edition
    on edition.id = category.event_edition_id
  where registration.status = 'expired'
    and registration.payment_status::text in ('unpaid', 'pending', 'failed')
), selected_holds as (
  select candidate.*
  from candidate_holds candidate
  where candidate.capacity is null
     or candidate.candidate_position
        <= greatest(candidate.capacity - candidate.occupied_count, 0)
), reactivated_registrations as (
  update public.registrations registration
  set
    status = 'pending',
    updated_at = now()
  from selected_holds selected
  where registration.id = selected.registration_id
  returning registration.id
), reactivated_quotes as (
  update public.registration_quotes quote
  set
    state = 'active',
    expires_at = selected.expires_at,
    invalidated_at = null
  from selected_holds selected
  where quote.id = selected.quote_id
  returning quote.id
), reactivated_reservations as (
  update public.capacity_reservations reservation
  set
    state = 'active',
    expires_at = selected.expires_at,
    released_at = null
  from selected_holds selected
  where reservation.id = selected.reservation_id
  returning reservation.id
)
insert into public.registration_status_history (
  registration_id,
  from_status,
  to_status,
  changed_by_user_id,
  reason
)
select
  selected.registration_id,
  'expired',
  'pending',
  null,
  'bank_transfer_deadline_removed'
from selected_holds selected
join reactivated_registrations reactivated
  on reactivated.id = selected.registration_id;

do $$
begin
  if to_regprocedure(
    'public.service_record_registration_desk_payment_core(uuid,uuid,text)'
  ) is null then
    execute
      'alter function public.service_record_registration_desk_payment(uuid, uuid, text) '
      'rename to service_record_registration_desk_payment_core';
  end if;
end
$$;

revoke all on function public.service_record_registration_desk_payment_core(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.service_record_registration_desk_payment_core(uuid, uuid, text)
to service_role;

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
begin
  select registration.*
  into target_registration
  from public.registrations registration
  where registration.id = p_registration_id
  for update;

  if target_registration.status = 'expired'
     and target_registration.payment_status::text in ('unpaid', 'pending', 'failed') then
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
  'Confirms an onsite payment and may reactivate a legacy payment-expired registration after the core capacity check.';
