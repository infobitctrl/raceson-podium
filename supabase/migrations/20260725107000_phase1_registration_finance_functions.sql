/*
 * Transactional registration and finance commands.
 *
 * Every function is service-role only. The API authenticates the caller and
 * authorizes organization/registration access before invoking these commands.
 */

create or replace function public.service_expire_registration_holds(
  p_event_category_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer;
begin
  with expired_reservations as (
    update public.capacity_reservations reservation
    set
      state = 'expired',
      released_at = now()
    where reservation.event_category_id = p_event_category_id
      and reservation.state = 'active'
      and reservation.expires_at <= now()
    returning reservation.registration_id, reservation.quote_id
  ),
  expired_quotes as (
    update public.registration_quotes quote
    set
      state = 'expired',
      invalidated_at = now()
    where quote.id in (
      select expired.quote_id
      from expired_reservations expired
      where expired.quote_id is not null
    )
      and quote.state = 'active'
    returning quote.registration_id
  ),
  expired_waitlist as (
    update public.registration_waitlist_entries entry
    set
      state = 'expired',
      expired_at = now()
    where entry.registration_id in (
      select expired.registration_id
      from expired_reservations expired
    )
      and entry.state = 'offered'
    returning entry.registration_id
  ),
  expired_registrations as (
    update public.registrations registration
    set
      status = 'expired',
      payment_status = case
        when registration.payment_status = 'paid' then registration.payment_status
        else 'unpaid'::public.payment_status
      end,
      updated_at = now()
    where registration.id in (
      select expired.registration_id
      from expired_reservations expired
    )
      and registration.status in ('pending', 'offered')
    returning registration.id
  )
  select count(*)::integer
  into expired_count
  from expired_registrations;

  return coalesce(expired_count, 0);
end;
$$;

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
set search_path = ''
as $$
declare
  category_row public.event_categories%rowtype;
  edition_row public.event_editions%rowtype;
  resolved_organization_id uuid;
  existing_registration public.registrations%rowtype;
  created_registration public.registrations%rowtype;
  created_quote_id uuid;
  occupied_count bigint;
  queue_position bigint;
  has_capacity boolean;
  fee_cents integer;
  quote_currency char(3);
  initial_status public.registration_status;
  initial_payment_status public.payment_status;
  quote_expires_at timestamptz;
begin
  if target_source not in ('direct', 'guest', 'import') then
    raise exception using errcode = '22023', message = 'invalid_registration_source';
  end if;

  if target_terms_version is null
     or length(trim(target_terms_version)) = 0
     or target_terms_accepted_at is null then
    raise exception using errcode = '22023', message = 'terms_acceptance_required';
  end if;

  select category.*
  into category_row
  from public.event_categories category
  where category.id = target_event_category_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;

  select edition.*
  into edition_row
  from public.event_editions edition
  where edition.id = category_row.event_edition_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  select series.organization_id
  into resolved_organization_id
  from public.event_series series
  where series.id = edition_row.event_series_id;

  if category_row.status in ('closed', 'completed')
     or edition_row.status not in ('published', 'registration_open', 'registration_closed')
     or (edition_row.registration_open_at is not null and edition_row.registration_open_at > now())
     or (edition_row.registration_close_at is not null and edition_row.registration_close_at < now()) then
    raise exception using errcode = 'P0001', message = 'registration_closed';
  end if;

  if target_idempotency_key_hash is not null then
    select registration.*
    into existing_registration
    from public.registrations registration
    where registration.idempotency_key_hash = target_idempotency_key_hash;

    if found then
      if existing_registration.idempotency_request_hash is distinct from target_idempotency_request_hash then
        raise exception using errcode = '23505', message = 'idempotency_key_reused';
      end if;

      return query
      select
        existing_registration.id,
        existing_registration.status,
        existing_registration.payment_status;
      return;
    end if;
  end if;

  select registration.*
  into existing_registration
  from public.registrations registration
  where registration.event_category_id = target_event_category_id
    and registration.athlete_profile_id = target_athlete_profile_id
    and registration.status not in ('cancelled', 'expired', 'transferred', 'deferred')
  order by registration.created_at desc
  limit 1;

  if found then
    raise exception using errcode = '23505', message = 'already_registered';
  end if;

  perform public.service_expire_registration_holds(target_event_category_id);

  select
    (
      select count(*)
      from public.registrations registration
      where registration.event_category_id = target_event_category_id
        and registration.status = 'confirmed'
    ) + (
      select count(*)
      from public.capacity_reservations reservation
      where reservation.event_category_id = target_event_category_id
        and reservation.state = 'active'
        and reservation.expires_at > now()
    )
  into occupied_count;

  has_capacity :=
    category_row.capacity is null
    or occupied_count < category_row.capacity;
  fee_cents := greatest(coalesce(category_row.registration_fee_cents, 0), 0);
  quote_currency := upper(coalesce(category_row.currency, 'EUR'))::char(3);
  quote_expires_at := now() + interval '60 minutes';

  if not has_capacity then
    initial_status := 'waitlisted';
    initial_payment_status := case
      when fee_cents > 0 then 'unpaid'::public.payment_status
      else 'not_required'::public.payment_status
    end;
  elsif fee_cents > 0 then
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
  )
  values (
    target_event_category_id,
    target_athlete_profile_id,
    target_represented_club_id,
    initial_status,
    initial_payment_status,
    case when initial_status = 'confirmed' then now() else null end,
    target_source,
    trim(target_terms_version),
    target_terms_accepted_at,
    target_public_start_list_opt_in,
    target_idempotency_key_hash,
    target_idempotency_request_hash
  )
  returning * into created_registration;

  if not has_capacity then
    select coalesce(max(entry.queue_position), 0) + 1
    into queue_position
    from public.registration_waitlist_entries entry
    where entry.event_category_id = target_event_category_id;

    insert into public.registration_waitlist_entries (
      registration_id,
      event_category_id,
      queue_position,
      state
    )
    values (
      created_registration.id,
      target_event_category_id,
      queue_position,
      'queued'
    );
  else
    insert into public.registration_quotes (
      registration_id,
      event_category_id,
      organization_id,
      state,
      currency,
      subtotal_cents,
      total_cents,
      line_items_json,
      pricing_snapshot_json,
      expires_at,
      accepted_at
    )
    values (
      created_registration.id,
      target_event_category_id,
      resolved_organization_id,
      case when fee_cents = 0 then 'accepted' else 'active' end,
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
        'currency', quote_currency
      ),
      quote_expires_at,
      case when fee_cents = 0 then now() else null end
    )
    returning id into created_quote_id;

    update public.registrations registration
    set current_quote_id = created_quote_id
    where registration.id = created_registration.id;

    if fee_cents > 0 then
      insert into public.capacity_reservations (
        registration_id,
        event_category_id,
        quote_id,
        state,
        source,
        expires_at
      )
      values (
        created_registration.id,
        target_event_category_id,
        created_quote_id,
        'active',
        'registration',
        quote_expires_at
      );
    end if;
  end if;

  insert into public.registration_status_history (
    registration_id,
    from_status,
    to_status,
    changed_by_user_id,
    reason
  )
  values (
    created_registration.id,
    null,
    created_registration.status,
    target_changed_by_user_id,
    case
      when created_registration.status = 'waitlisted' then 'capacity_waitlisted'
      when target_source = 'guest' then 'guest_created'
      else 'created'
    end
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
    resolved_organization_id,
    target_changed_by_user_id,
    'registration',
    created_registration.id,
    case
      when created_registration.status = 'waitlisted' then 'registration.waitlisted'
      else 'registration.created'
    end,
    jsonb_build_object(
      'eventCategoryId', target_event_category_id,
      'source', target_source,
      'status', created_registration.status,
      'paymentStatus', created_registration.payment_status,
      'quoteId', created_quote_id
    )
  );

  return query
  select
    created_registration.id,
    created_registration.status,
    created_registration.payment_status;
end;
$$;

create or replace function public.service_promote_waitlist_offer(
  p_event_category_id uuid,
  p_actor_user_id uuid,
  p_offer_minutes integer default 1440
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_row public.event_categories%rowtype;
  target_entry public.registration_waitlist_entries%rowtype;
  resolved_organization_id uuid;
  occupied_count bigint;
  fee_cents integer;
  quote_currency char(3);
  resolved_offer_expires_at timestamptz;
  quote_id uuid;
  previous_status public.registration_status;
  promoted_status public.registration_status;
begin
  if p_offer_minutes < 30 or p_offer_minutes > 10080 then
    raise exception using errcode = '22023', message = 'invalid_offer_duration';
  end if;

  select category.*
  into category_row
  from public.event_categories category
  where category.id = p_event_category_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;

  select series.organization_id
  into resolved_organization_id
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = category_row.event_edition_id;

  perform public.service_expire_registration_holds(p_event_category_id);

  select
    (
      select count(*)
      from public.registrations registration
      where registration.event_category_id = p_event_category_id
        and registration.status = 'confirmed'
    ) + (
      select count(*)
      from public.capacity_reservations reservation
      where reservation.event_category_id = p_event_category_id
        and reservation.state = 'active'
        and reservation.expires_at > now()
    )
  into occupied_count;

  if category_row.capacity is not null
     and occupied_count >= category_row.capacity then
    return null;
  end if;

  select entry.*
  into target_entry
  from public.registration_waitlist_entries entry
  where entry.event_category_id = p_event_category_id
    and entry.state = 'queued'
  order by entry.queue_position
  limit 1
  for update skip locked;

  if not found then
    return null;
  end if;

  fee_cents := greatest(coalesce(category_row.registration_fee_cents, 0), 0);
  quote_currency := upper(coalesce(category_row.currency, 'EUR'))::char(3);
  resolved_offer_expires_at := now() + make_interval(mins => p_offer_minutes);

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
    target_entry.registration_id,
    p_event_category_id,
    resolved_organization_id,
    coalesce(max(existing.version), 0) + 1,
    case when fee_cents = 0 then 'accepted' else 'active' end,
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
      'waitlistOffer', true
    ),
    resolved_offer_expires_at,
    case when fee_cents = 0 then now() else null end
  from public.registration_quotes existing
  where existing.registration_id = target_entry.registration_id
  returning id into quote_id;

  select registration.status
  into previous_status
  from public.registrations registration
  where registration.id = target_entry.registration_id
  for update;

  promoted_status := case
    when fee_cents = 0 then 'confirmed'::public.registration_status
    else 'offered'::public.registration_status
  end;

  update public.registrations registration
  set
    status = promoted_status,
    payment_status = case
      when fee_cents = 0 then 'not_required'::public.payment_status
      else 'unpaid'::public.payment_status
    end,
    current_quote_id = quote_id,
    confirmed_at = case when fee_cents = 0 then now() else null end,
    updated_at = now()
  where registration.id = target_entry.registration_id;

  if fee_cents = 0 then
    update public.registration_waitlist_entries entry
    set
      state = 'accepted',
      offered_at = now(),
      offer_expires_at = resolved_offer_expires_at,
      accepted_at = now()
    where entry.id = target_entry.id;
  else
    update public.registration_waitlist_entries entry
    set
      state = 'offered',
      offered_at = now(),
      offer_expires_at = resolved_offer_expires_at
    where entry.id = target_entry.id;

    insert into public.capacity_reservations (
      registration_id,
      event_category_id,
      quote_id,
      state,
      source,
      expires_at
    )
    values (
      target_entry.registration_id,
      p_event_category_id,
      quote_id,
      'active',
      'waitlist_offer',
      resolved_offer_expires_at
    );
  end if;

  insert into public.registration_status_history (
    registration_id,
    from_status,
    to_status,
    changed_by_user_id,
    reason
  )
  values (
    target_entry.registration_id,
    previous_status,
    promoted_status,
    p_actor_user_id,
    case when fee_cents = 0 then 'waitlist_auto_confirmed' else 'waitlist_offer_created' end
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
    resolved_organization_id,
    p_actor_user_id,
    'registration_waitlist_entry',
    target_entry.id,
    case when fee_cents = 0 then 'waitlist.confirmed' else 'waitlist.offered' end,
    jsonb_build_object(
      'registrationId', target_entry.registration_id,
      'eventCategoryId', p_event_category_id,
      'queuePosition', target_entry.queue_position,
      'quoteId', quote_id,
      'offerExpiresAt', resolved_offer_expires_at
    )
  );

  return jsonb_build_object(
    'registrationId', target_entry.registration_id,
    'waitlistEntryId', target_entry.id,
    'status', promoted_status,
    'queuePosition', target_entry.queue_position,
    'quoteId', quote_id,
    'offerExpiresAt', resolved_offer_expires_at
  );
end;
$$;

create or replace function public.service_cancel_registration_atomically(
  p_registration_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_registration public.registrations%rowtype;
  organization_id uuid;
begin
  select registration.*
  into target_registration
  from public.registrations registration
  where registration.id = p_registration_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'registration_not_found';
  end if;

  if target_registration.status in ('cancelled', 'expired', 'transferred', 'deferred') then
    return jsonb_build_object(
      'registrationId', target_registration.id,
      'status', target_registration.status,
      'replayed', true
    );
  end if;

  select series.organization_id
  into organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = target_registration.event_category_id;

  update public.capacity_reservations reservation
  set
    state = 'released',
    released_at = now()
  where reservation.registration_id = target_registration.id
    and reservation.state = 'active';

  update public.registration_quotes quote
  set
    state = 'cancelled',
    invalidated_at = now()
  where quote.registration_id = target_registration.id
    and quote.state = 'active';

  update public.registration_waitlist_entries entry
  set
    state = 'withdrawn',
    withdrawn_at = now()
  where entry.registration_id = target_registration.id
    and entry.state in ('queued', 'offered');

  update public.registrations registration
  set
    status = 'cancelled',
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
    target_registration.status,
    'cancelled',
    p_actor_user_id,
    nullif(trim(p_reason), '')
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
    organization_id,
    p_actor_user_id,
    'registration',
    target_registration.id,
    'registration.cancelled',
    jsonb_build_object(
      'previousStatus', target_registration.status,
      'paymentStatus', target_registration.payment_status,
      'reason', nullif(trim(p_reason), '')
    )
  );

  return jsonb_build_object(
    'registrationId', target_registration.id,
    'status', 'cancelled',
    'eventCategoryId', target_registration.event_category_id,
    'paymentStatus', target_registration.payment_status,
    'refundRequired', target_registration.payment_status in ('paid', 'partially_refunded')
  );
end;
$$;

create or replace function public.service_prepare_payment_attempt(
  p_registration_id uuid,
  p_actor_user_id uuid,
  p_provider text,
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
  target_reservation public.capacity_reservations%rowtype;
  target_account public.organization_payment_accounts%rowtype;
  resolved_organization_id uuid;
  existing_attempt public.payment_intents%rowtype;
  created_attempt public.payment_intents%rowtype;
begin
  if p_provider <> 'stripe' then
    raise exception using errcode = '22023', message = 'unsupported_payment_provider';
  end if;

  select registration.*
  into target_registration
  from public.registrations registration
  where registration.id = p_registration_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'registration_not_found';
  end if;

  if target_registration.status not in ('pending', 'offered') then
    raise exception using errcode = 'P0001', message = 'registration_not_payable';
  end if;

  select quote.*
  into target_quote
  from public.registration_quotes quote
  where quote.id = target_registration.current_quote_id
    and quote.state = 'active'
  for update;

  if not found or target_quote.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'registration_quote_expired';
  end if;

  select reservation.*
  into target_reservation
  from public.capacity_reservations reservation
  where reservation.registration_id = target_registration.id
    and reservation.quote_id = target_quote.id
    and reservation.state = 'active'
    and reservation.expires_at > now()
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'capacity_reservation_expired';
  end if;

  select series.organization_id
  into resolved_organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = target_registration.event_category_id;

  select account.*
  into target_account
  from public.organization_payment_accounts account
  where account.organization_id = resolved_organization_id
    and account.provider = p_provider;

  if not found
     or target_account.status <> 'active'
     or not target_account.charges_enabled
     or target_account.provider_account_id is null then
    raise exception using errcode = 'P0001', message = 'organization_payment_account_not_ready';
  end if;

  select attempt.*
  into existing_attempt
  from public.payment_intents attempt
  where attempt.provider = p_provider
    and attempt.idempotency_key_hash = p_idempotency_key_hash;

  if found then
    if existing_attempt.registration_id <> target_registration.id
       or existing_attempt.quote_id <> target_quote.id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;

    return jsonb_build_object(
      'paymentIntentId', existing_attempt.id,
      'registrationId', existing_attempt.registration_id,
      'quoteId', existing_attempt.quote_id,
      'amountCents', existing_attempt.amount_cents,
      'currency', existing_attempt.currency,
      'status', existing_attempt.status,
      'checkoutSessionId', existing_attempt.provider_checkout_session_id,
      'checkoutUrl', existing_attempt.checkout_url,
      'expiresAt', existing_attempt.expires_at,
      'providerAccountId', target_account.provider_account_id,
      'organizationId', resolved_organization_id,
      'replayed', true
    );
  end if;

  insert into public.payment_intents (
    organization_id,
    registration_id,
    quote_id,
    provider,
    status,
    amount_cents,
    currency,
    idempotency_key_hash,
    expires_at
  )
  values (
    resolved_organization_id,
    target_registration.id,
    target_quote.id,
    p_provider,
    'created',
    target_quote.total_cents,
    target_quote.currency,
    p_idempotency_key_hash,
    least(target_quote.expires_at, target_reservation.expires_at)
  )
  returning * into created_attempt;

  update public.registrations registration
  set payment_status = 'pending'
  where registration.id = target_registration.id
    and registration.payment_status <> 'paid';

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    resolved_organization_id,
    p_actor_user_id,
    'payment_intent',
    created_attempt.id,
    'payment.checkout_prepared',
    jsonb_build_object(
      'registrationId', target_registration.id,
      'quoteId', target_quote.id,
      'provider', p_provider,
      'amountCents', target_quote.total_cents,
      'currency', target_quote.currency
    )
  );

  return jsonb_build_object(
    'paymentIntentId', created_attempt.id,
    'registrationId', created_attempt.registration_id,
    'quoteId', created_attempt.quote_id,
    'amountCents', created_attempt.amount_cents,
    'currency', created_attempt.currency,
    'status', created_attempt.status,
    'expiresAt', created_attempt.expires_at,
    'providerAccountId', target_account.provider_account_id,
    'organizationId', resolved_organization_id,
    'replayed', false
  );
end;
$$;

create or replace function public.service_attach_payment_checkout(
  p_payment_intent_id uuid,
  p_actor_user_id uuid,
  p_provider_checkout_session_id text,
  p_checkout_url text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_attempt public.payment_intents%rowtype;
begin
  select attempt.*
  into target_attempt
  from public.payment_intents attempt
  where attempt.id = p_payment_intent_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'payment_intent_not_found';
  end if;

  if target_attempt.provider_checkout_session_id is not null then
    if target_attempt.provider_checkout_session_id <> p_provider_checkout_session_id then
      raise exception using errcode = '23505', message = 'checkout_session_already_attached';
    end if;

    return jsonb_build_object(
      'paymentIntentId', target_attempt.id,
      'checkoutSessionId', target_attempt.provider_checkout_session_id,
      'checkoutUrl', target_attempt.checkout_url,
      'status', target_attempt.status,
      'replayed', true
    );
  end if;

  update public.payment_intents attempt
  set
    provider_checkout_session_id = p_provider_checkout_session_id,
    checkout_url = p_checkout_url,
    expires_at = least(attempt.expires_at, p_expires_at),
    status = 'checkout_ready'
  where attempt.id = target_attempt.id
  returning * into target_attempt;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    target_attempt.organization_id,
    p_actor_user_id,
    'payment_intent',
    target_attempt.id,
    'payment.checkout_created',
    jsonb_build_object(
      'registrationId', target_attempt.registration_id,
      'providerCheckoutSessionId', p_provider_checkout_session_id,
      'expiresAt', target_attempt.expires_at
    )
  );

  return jsonb_build_object(
    'paymentIntentId', target_attempt.id,
    'checkoutSessionId', target_attempt.provider_checkout_session_id,
    'checkoutUrl', target_attempt.checkout_url,
    'status', target_attempt.status,
    'expiresAt', target_attempt.expires_at,
    'replayed', false
  );
end;
$$;

create or replace function public.service_apply_payment_provider_event(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_signature_verified boolean,
  p_livemode boolean,
  p_payload_json jsonb,
  p_payment_intent_id uuid,
  p_provider_payment_intent_id text,
  p_outcome text,
  p_amount_cents integer,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_event public.payment_provider_events%rowtype;
  target_attempt public.payment_intents%rowtype;
  target_registration public.registrations%rowtype;
  target_quote public.registration_quotes%rowtype;
  active_reservation public.capacity_reservations%rowtype;
  previous_status public.registration_status;
begin
  if not p_signature_verified then
    raise exception using errcode = '28000', message = 'provider_signature_not_verified';
  end if;

  if p_outcome not in ('succeeded', 'failed', 'processing', 'cancelled') then
    raise exception using errcode = '22023', message = 'invalid_payment_outcome';
  end if;

  insert into public.payment_provider_events (
    provider,
    provider_event_id,
    event_type,
    signature_verified,
    livemode,
    payload_json,
    processing_status,
    process_attempts,
    payment_intent_id
  )
  values (
    p_provider,
    p_provider_event_id,
    p_event_type,
    true,
    p_livemode,
    p_payload_json,
    'received',
    1,
    p_payment_intent_id
  )
  on conflict (provider, provider_event_id) do nothing
  returning * into provider_event;

  if not found then
    select event.*
    into provider_event
    from public.payment_provider_events event
    where event.provider = p_provider
      and event.provider_event_id = p_provider_event_id;

    return jsonb_build_object(
      'providerEventId', provider_event.id,
      'processingStatus', provider_event.processing_status,
      'registrationId', provider_event.registration_id,
      'replayed', true
    );
  end if;

  select attempt.*
  into target_attempt
  from public.payment_intents attempt
  where attempt.id = p_payment_intent_id
  for update;

  if not found then
    update public.payment_provider_events event
    set
      processing_status = 'ignored',
      process_error = 'payment_intent_not_found',
      processed_at = now()
    where event.id = provider_event.id;

    return jsonb_build_object(
      'providerEventId', provider_event.id,
      'processingStatus', 'ignored',
      'reason', 'payment_intent_not_found',
      'replayed', false
    );
  end if;

  update public.payment_provider_events event
  set
    registration_id = target_attempt.registration_id,
    payment_intent_id = target_attempt.id
  where event.id = provider_event.id;

  if p_outcome = 'succeeded' then
    if target_attempt.status = 'succeeded' then
      update public.payment_provider_events event
      set
        processing_status = 'processed',
        process_error = null,
        processed_at = now()
      where event.id = provider_event.id;

      return jsonb_build_object(
        'providerEventId', provider_event.id,
        'processingStatus', 'processed',
        'registrationId', target_attempt.registration_id,
        'paymentIntentId', target_attempt.id,
        'outcome', p_outcome,
        'duplicateSettlement', true,
        'replayed', false
      );
    end if;

    select registration.*
    into target_registration
    from public.registrations registration
    where registration.id = target_attempt.registration_id
    for update;

    select quote.*
    into target_quote
    from public.registration_quotes quote
    where quote.id = target_attempt.quote_id;

    if p_amount_cents is distinct from target_attempt.amount_cents
       or upper(p_currency) is distinct from trim(target_attempt.currency)
       or target_quote.id is null then
      update public.payment_provider_events event
      set
        processing_status = 'failed',
        process_error = 'payment_amount_or_currency_mismatch',
        processed_at = now()
      where event.id = provider_event.id;

      update public.payment_intents attempt
      set
        status = 'failed',
        failure_code = 'amount_or_currency_mismatch',
        failure_message = 'Provider settlement did not match the locked quote'
      where attempt.id = target_attempt.id;

      return jsonb_build_object(
        'providerEventId', provider_event.id,
        'processingStatus', 'failed',
        'reason', 'payment_amount_or_currency_mismatch',
        'replayed', false
      );
    end if;

    select reservation.*
    into active_reservation
    from public.capacity_reservations reservation
    where reservation.registration_id = target_registration.id
      and reservation.quote_id = target_quote.id
      and reservation.state = 'active'
      and reservation.expires_at > now()
    for update;

    if not found and target_registration.status <> 'confirmed' then
      update public.payment_provider_events event
      set
        processing_status = 'failed',
        process_error = 'capacity_reservation_not_active',
        processed_at = now()
      where event.id = provider_event.id;

      update public.payment_intents attempt
      set
        status = 'failed',
        failure_code = 'capacity_reservation_not_active',
        failure_message = 'Payment arrived after the reserved place expired'
      where attempt.id = target_attempt.id;

      return jsonb_build_object(
        'providerEventId', provider_event.id,
        'processingStatus', 'failed',
        'reason', 'capacity_reservation_not_active',
        'replayed', false
      );
    end if;

    previous_status := target_registration.status;

    update public.payment_intents attempt
    set
      provider_payment_intent_id = coalesce(
        nullif(p_provider_payment_intent_id, ''),
        attempt.provider_payment_intent_id
      ),
      status = 'succeeded',
      completed_at = now(),
      failure_code = null,
      failure_message = null
    where attempt.id = target_attempt.id;

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
    where quote.id = target_quote.id
      and quote.state = 'active';

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
      payment_intent_id,
      provider_event_id,
      entry_type,
      amount_cents,
      currency,
      external_reference,
      description,
      metadata_json
    )
    values (
      target_attempt.organization_id,
      target_registration.id,
      target_attempt.id,
      provider_event.id,
      'charge',
      target_attempt.amount_cents,
      target_attempt.currency,
      coalesce(nullif(p_provider_payment_intent_id, ''), p_provider_event_id),
      'Registration payment settled',
      jsonb_build_object(
        'provider', p_provider,
        'providerEventId', p_provider_event_id,
        'quoteId', target_quote.id
      )
    )
    on conflict (provider_event_id, entry_type)
      where provider_event_id is not null
      do nothing;

    if previous_status <> 'confirmed' then
      insert into public.registration_status_history (
        registration_id,
        from_status,
        to_status,
        reason
      )
      values (
        target_registration.id,
        previous_status,
        'confirmed',
        'provider_payment_settled'
      );
    end if;

    insert into public.audit_log (
      organization_id,
      entity_type,
      entity_id,
      action,
      metadata_json
    )
    values (
      target_attempt.organization_id,
      'payment_intent',
      target_attempt.id,
      'payment.settled',
      jsonb_build_object(
        'registrationId', target_registration.id,
        'providerEventId', provider_event.id,
        'amountCents', target_attempt.amount_cents,
        'currency', target_attempt.currency
      )
    );
  elsif p_outcome = 'failed' then
    update public.payment_intents attempt
    set
      status = 'failed',
      failure_code = p_event_type,
      failure_message = 'Provider reported payment failure'
    where attempt.id = target_attempt.id
      and attempt.status <> 'succeeded';

    update public.registrations registration
    set payment_status = 'failed'
    where registration.id = target_attempt.registration_id
      and registration.payment_status <> 'paid';
  elsif p_outcome = 'cancelled' then
    update public.payment_intents attempt
    set status = 'cancelled'
    where attempt.id = target_attempt.id
      and attempt.status <> 'succeeded';

    update public.registrations registration
    set payment_status = 'unpaid'
    where registration.id = target_attempt.registration_id
      and registration.payment_status = 'pending';
  else
    update public.payment_intents attempt
    set status = 'processing'
    where attempt.id = target_attempt.id
      and attempt.status not in ('succeeded', 'failed', 'cancelled');
  end if;

  update public.payment_provider_events event
  set
    processing_status = 'processed',
    process_error = null,
    processed_at = now()
  where event.id = provider_event.id;

  return jsonb_build_object(
    'providerEventId', provider_event.id,
    'processingStatus', 'processed',
    'registrationId', target_attempt.registration_id,
    'paymentIntentId', target_attempt.id,
    'outcome', p_outcome,
    'replayed', false
  );
end;
$$;

create or replace function public.service_prepare_payment_refund(
  p_registration_id uuid,
  p_actor_user_id uuid,
  p_amount_cents integer,
  p_reason text,
  p_organizer_note text,
  p_idempotency_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_registration public.registrations%rowtype;
  target_attempt public.payment_intents%rowtype;
  existing_refund public.payment_refunds%rowtype;
  created_refund public.payment_refunds%rowtype;
  charged_cents bigint;
  refunded_cents bigint;
begin
  if p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'invalid_refund_amount';
  end if;

  select registration.*
  into target_registration
  from public.registrations registration
  where registration.id = p_registration_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'registration_not_found';
  end if;

  select attempt.*
  into target_attempt
  from public.payment_intents attempt
  where attempt.registration_id = target_registration.id
    and attempt.status = 'succeeded'
  order by attempt.completed_at desc nulls last
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'settled_payment_not_found';
  end if;

  select refund.*
  into existing_refund
  from public.payment_refunds refund
  where refund.provider = target_attempt.provider
    and refund.idempotency_key_hash = p_idempotency_key_hash;

  if found then
    if existing_refund.registration_id <> target_registration.id
       or existing_refund.amount_cents <> p_amount_cents then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;

    return jsonb_build_object(
      'refundId', existing_refund.id,
      'registrationId', existing_refund.registration_id,
      'paymentIntentId', existing_refund.payment_intent_id,
      'providerPaymentIntentId', target_attempt.provider_payment_intent_id,
      'amountCents', existing_refund.amount_cents,
      'currency', existing_refund.currency,
      'status', existing_refund.status,
      'providerRefundId', existing_refund.provider_refund_id,
      'replayed', true
    );
  end if;

  select coalesce(sum(entry.amount_cents), 0)
  into charged_cents
  from public.financial_ledger_entries entry
  where entry.registration_id = target_registration.id
    and entry.entry_type = 'charge';

  select coalesce(-sum(entry.amount_cents), 0)
  into refunded_cents
  from public.financial_ledger_entries entry
  where entry.registration_id = target_registration.id
    and entry.entry_type = 'refund';

  if p_amount_cents > charged_cents - refunded_cents then
    raise exception using errcode = '22023', message = 'refund_exceeds_settled_amount';
  end if;

  insert into public.payment_refunds (
    organization_id,
    registration_id,
    payment_intent_id,
    provider,
    status,
    amount_cents,
    currency,
    reason,
    organizer_note,
    requested_by_user_id,
    idempotency_key_hash
  )
  values (
    target_attempt.organization_id,
    target_registration.id,
    target_attempt.id,
    target_attempt.provider,
    'pending',
    p_amount_cents,
    target_attempt.currency,
    trim(p_reason),
    nullif(trim(p_organizer_note), ''),
    p_actor_user_id,
    p_idempotency_key_hash
  )
  returning * into created_refund;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    target_attempt.organization_id,
    p_actor_user_id,
    'payment_refund',
    created_refund.id,
    'refund.requested',
    jsonb_build_object(
      'registrationId', target_registration.id,
      'paymentIntentId', target_attempt.id,
      'amountCents', created_refund.amount_cents,
      'currency', created_refund.currency,
      'reason', created_refund.reason
    )
  );

  return jsonb_build_object(
    'refundId', created_refund.id,
    'registrationId', created_refund.registration_id,
    'paymentIntentId', created_refund.payment_intent_id,
    'providerPaymentIntentId', target_attempt.provider_payment_intent_id,
    'amountCents', created_refund.amount_cents,
    'currency', created_refund.currency,
    'status', created_refund.status,
    'replayed', false
  );
end;
$$;

create or replace function public.service_complete_payment_refund(
  p_refund_id uuid,
  p_actor_user_id uuid,
  p_provider_refund_id text,
  p_succeeded boolean,
  p_failure_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_refund public.payment_refunds%rowtype;
  charged_cents bigint;
  refunded_cents bigint;
  resolved_payment_status public.payment_status;
begin
  select refund.*
  into target_refund
  from public.payment_refunds refund
  where refund.id = p_refund_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'refund_not_found';
  end if;

  if target_refund.status in ('succeeded', 'failed', 'cancelled') then
    return jsonb_build_object(
      'refundId', target_refund.id,
      'registrationId', target_refund.registration_id,
      'status', target_refund.status,
      'providerRefundId', target_refund.provider_refund_id,
      'replayed', true
    );
  end if;

  if not p_succeeded then
    update public.payment_refunds refund
    set
      status = 'failed',
      failure_message = nullif(trim(p_failure_message), ''),
      provider_refund_id = nullif(trim(p_provider_refund_id), ''),
      completed_at = now()
    where refund.id = target_refund.id;

    return jsonb_build_object(
      'refundId', target_refund.id,
      'registrationId', target_refund.registration_id,
      'status', 'failed',
      'replayed', false
    );
  end if;

  update public.payment_refunds refund
  set
    status = 'succeeded',
    provider_refund_id = nullif(trim(p_provider_refund_id), ''),
    failure_message = null,
    completed_at = now()
  where refund.id = target_refund.id;

  insert into public.financial_ledger_entries (
    organization_id,
    registration_id,
    payment_intent_id,
    entry_type,
    amount_cents,
    currency,
    external_reference,
    description,
    metadata_json
  )
  values (
    target_refund.organization_id,
    target_refund.registration_id,
    target_refund.payment_intent_id,
    'refund',
    -target_refund.amount_cents,
    target_refund.currency,
    nullif(trim(p_provider_refund_id), ''),
    'Registration payment refunded',
    jsonb_build_object(
      'refundId', target_refund.id,
      'reason', target_refund.reason
    )
  );

  select coalesce(sum(entry.amount_cents), 0)
  into charged_cents
  from public.financial_ledger_entries entry
  where entry.registration_id = target_refund.registration_id
    and entry.entry_type = 'charge';

  select coalesce(-sum(entry.amount_cents), 0)
  into refunded_cents
  from public.financial_ledger_entries entry
  where entry.registration_id = target_refund.registration_id
    and entry.entry_type = 'refund';

  resolved_payment_status := case
    when refunded_cents >= charged_cents then 'refunded'::public.payment_status
    else 'partially_refunded'::public.payment_status
  end;

  update public.registrations registration
  set
    payment_status = resolved_payment_status,
    refunded_at = case
      when resolved_payment_status = 'refunded' then now()
      else registration.refunded_at
    end,
    updated_at = now()
  where registration.id = target_refund.registration_id;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    target_refund.organization_id,
    p_actor_user_id,
    'payment_refund',
    target_refund.id,
    'refund.succeeded',
    jsonb_build_object(
      'registrationId', target_refund.registration_id,
      'amountCents', target_refund.amount_cents,
      'currency', target_refund.currency,
      'paymentStatus', resolved_payment_status,
      'providerRefundId', nullif(trim(p_provider_refund_id), '')
    )
  );

  return jsonb_build_object(
    'refundId', target_refund.id,
    'registrationId', target_refund.registration_id,
    'status', 'succeeded',
    'paymentStatus', resolved_payment_status,
    'providerRefundId', nullif(trim(p_provider_refund_id), ''),
    'replayed', false
  );
end;
$$;

create or replace function public.service_run_payment_reconciliation(
  p_organization_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_run_id uuid;
  resolved_checked_count integer;
  resolved_discrepancy_count integer;
begin
  insert into public.payment_reconciliation_runs (
    organization_id,
    provider,
    status,
    requested_by_user_id
  )
  values (
    p_organization_id,
    'all',
    'running',
    p_actor_user_id
  )
  returning id into resolved_run_id;

  select count(*)::integer
  into resolved_checked_count
  from public.payment_intents attempt
  where attempt.organization_id = p_organization_id;

  insert into public.payment_reconciliation_items (
    reconciliation_run_id,
    registration_id,
    payment_intent_id,
    discrepancy_type,
    severity,
    expected_json,
    actual_json
  )
  select
    resolved_run_id,
    attempt.registration_id,
    attempt.id,
    'settled_intent_registration_mismatch',
    'critical',
    jsonb_build_object(
      'paymentStatus', 'paid',
      'ledgerChargeCents', attempt.amount_cents
    ),
    jsonb_build_object(
      'paymentStatus', registration.payment_status,
      'ledgerChargeCents', coalesce(ledger.charge_cents, 0)
    )
  from public.payment_intents attempt
  join public.registrations registration on registration.id = attempt.registration_id
  left join lateral (
    select sum(entry.amount_cents) as charge_cents
    from public.financial_ledger_entries entry
    where entry.payment_intent_id = attempt.id
      and entry.entry_type = 'charge'
  ) ledger on true
  where attempt.organization_id = p_organization_id
    and attempt.status = 'succeeded'
    and (
      registration.payment_status not in ('paid', 'partially_refunded', 'refunded')
      or coalesce(ledger.charge_cents, 0) <> attempt.amount_cents
    );

  insert into public.payment_reconciliation_items (
    reconciliation_run_id,
    registration_id,
    payment_intent_id,
    discrepancy_type,
    severity,
    expected_json,
    actual_json
  )
  select
    resolved_run_id,
    registration.id,
    null,
    'paid_registration_missing_settled_intent',
    'error',
    jsonb_build_object('settledPaymentIntent', true),
    jsonb_build_object('settledPaymentIntent', false)
  from public.registrations registration
  join public.event_categories category on category.id = registration.event_category_id
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where series.organization_id = p_organization_id
    and registration.payment_status in ('paid', 'partially_refunded', 'refunded')
    and registration.verified_payment_evidence_id is null
    and not exists (
      select 1
      from public.payment_intents attempt
      where attempt.registration_id = registration.id
        and attempt.status = 'succeeded'
    );

  select count(*)::integer
  into resolved_discrepancy_count
  from public.payment_reconciliation_items item
  where item.reconciliation_run_id = resolved_run_id;

  update public.payment_reconciliation_runs run
  set
    status = 'completed',
    checked_intent_count = resolved_checked_count,
    discrepancy_count = resolved_discrepancy_count,
    summary_json = jsonb_build_object(
      'checkedPaymentIntents', resolved_checked_count,
      'discrepancies', resolved_discrepancy_count
    ),
    completed_at = now()
  where run.id = resolved_run_id;

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
    'payment_reconciliation_run',
    resolved_run_id,
    'payment.reconciliation_completed',
    jsonb_build_object(
      'checkedPaymentIntents', resolved_checked_count,
      'discrepancies', resolved_discrepancy_count
    )
  );

  return jsonb_build_object(
    'runId', resolved_run_id,
    'status', 'completed',
    'checkedPaymentIntents', resolved_checked_count,
    'discrepancies', resolved_discrepancy_count
  );
end;
$$;

revoke all on function public.service_expire_registration_holds(uuid)
  from public, anon, authenticated;
revoke all on function public.create_registration_atomically(
  uuid, uuid, uuid, uuid, text, text, timestamptz, boolean, text, text
) from public, anon, authenticated;
revoke all on function public.service_promote_waitlist_offer(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.service_cancel_registration_atomically(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.service_prepare_payment_attempt(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.service_attach_payment_checkout(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.service_apply_payment_provider_event(
  text, text, text, boolean, boolean, jsonb, uuid, text, text, integer, text
) from public, anon, authenticated;
revoke all on function public.service_prepare_payment_refund(
  uuid, uuid, integer, text, text, text
) from public, anon, authenticated;
revoke all on function public.service_complete_payment_refund(
  uuid, uuid, text, boolean, text
) from public, anon, authenticated;
revoke all on function public.service_run_payment_reconciliation(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.service_expire_registration_holds(uuid)
  to service_role;
grant execute on function public.create_registration_atomically(
  uuid, uuid, uuid, uuid, text, text, timestamptz, boolean, text, text
) to service_role;
grant execute on function public.service_promote_waitlist_offer(uuid, uuid, integer)
  to service_role;
grant execute on function public.service_cancel_registration_atomically(uuid, uuid, text)
  to service_role;
grant execute on function public.service_prepare_payment_attempt(uuid, uuid, text, text)
  to service_role;
grant execute on function public.service_attach_payment_checkout(uuid, uuid, text, text, timestamptz)
  to service_role;
grant execute on function public.service_apply_payment_provider_event(
  text, text, text, boolean, boolean, jsonb, uuid, text, text, integer, text
) to service_role;
grant execute on function public.service_prepare_payment_refund(
  uuid, uuid, integer, text, text, text
) to service_role;
grant execute on function public.service_complete_payment_refund(
  uuid, uuid, text, boolean, text
) to service_role;
grant execute on function public.service_run_payment_reconciliation(uuid, uuid)
  to service_role;
