create or replace function public.create_registration_atomically(
  target_event_category_id uuid,
  target_athlete_profile_id uuid,
  target_represented_club_id uuid default null,
  target_changed_by_user_id uuid default null,
  target_source text default 'direct',
  target_terms_version text default null,
  target_terms_accepted_at timestamptz default null,
  target_public_start_list_opt_in boolean default false,
  target_idempotency_key_hash text default null,
  target_idempotency_request_hash text default null
)
returns table (
  registration_id uuid,
  registration_status public.registration_status,
  payment_status public.payment_status
)
language plpgsql
security definer
set search_path = public
as $$
declare
  category_row public.event_categories%rowtype;
  edition_row public.event_editions%rowtype;
  existing_registration public.registrations%rowtype;
  created_registration public.registrations%rowtype;
  active_registration_count bigint;
  initial_status public.registration_status;
  initial_payment_status public.payment_status;
begin
  if target_source not in ('direct', 'guest') then
    raise exception using errcode = '22023', message = 'invalid_registration_source';
  end if;

  if target_terms_version is null or length(trim(target_terms_version)) = 0 or target_terms_accepted_at is null then
    raise exception using errcode = '22023', message = 'terms_acceptance_required';
  end if;

  select * into category_row
  from public.event_categories
  where id = target_event_category_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;

  select * into edition_row
  from public.event_editions
  where id = category_row.event_edition_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  if category_row.status in ('closed', 'completed')
     or edition_row.status not in ('published', 'registration_open', 'registration_closed')
     or (edition_row.registration_open_at is not null and edition_row.registration_open_at > now())
     or (edition_row.registration_close_at is not null and edition_row.registration_close_at < now()) then
    raise exception using errcode = 'P0001', message = 'registration_closed';
  end if;

  if target_idempotency_key_hash is not null then
    select * into existing_registration
    from public.registrations
    where idempotency_key_hash = target_idempotency_key_hash;

    if found then
      if existing_registration.idempotency_request_hash is distinct from target_idempotency_request_hash then
        raise exception using errcode = '23505', message = 'idempotency_key_reused';
      end if;

      return query
      select existing_registration.id, existing_registration.status, existing_registration.payment_status;
      return;
    end if;
  end if;

  select * into existing_registration
  from public.registrations
  where event_category_id = target_event_category_id
    and athlete_profile_id = target_athlete_profile_id
    and status <> 'cancelled'
  order by created_at desc
  limit 1;

  if found then
    raise exception using errcode = '23505', message = 'already_registered';
  end if;

  if category_row.capacity is not null and category_row.capacity > 0 then
    select count(*) into active_registration_count
    from public.registrations
    where event_category_id = target_event_category_id
      and status in ('pending', 'confirmed', 'waitlisted');

    if active_registration_count >= category_row.capacity then
      raise exception using errcode = 'P0001', message = 'category_full';
    end if;
  end if;

  if coalesce(category_row.registration_fee_cents, 0) > 0 then
    initial_status := 'pending';
    initial_payment_status := 'unpaid';
  else
    initial_status := 'confirmed';
    initial_payment_status := 'not_required';
  end if;

  insert into public.registrations (
    event_category_id,
    athlete_profile_id,
    represented_club_id,
    status,
    payment_status,
    confirmed_at,
    source,
    terms_version,
    terms_accepted_at,
    public_start_list_opt_in,
    idempotency_key_hash,
    idempotency_request_hash
  ) values (
    target_event_category_id,
    target_athlete_profile_id,
    target_represented_club_id,
    initial_status,
    initial_payment_status,
    null,
    target_source,
    trim(target_terms_version),
    target_terms_accepted_at,
    target_public_start_list_opt_in,
    target_idempotency_key_hash,
    target_idempotency_request_hash
  )
  returning * into created_registration;

  insert into public.registration_status_history (
    registration_id,
    from_status,
    to_status,
    changed_by_user_id,
    reason
  ) values (
    created_registration.id,
    null,
    created_registration.status,
    target_changed_by_user_id,
    case when target_source = 'guest' then 'guest_created' else 'created' end
  );

  return query
  select created_registration.id, created_registration.status, created_registration.payment_status;
end;
$$;
