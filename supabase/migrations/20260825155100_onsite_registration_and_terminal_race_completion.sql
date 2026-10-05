begin;

create or replace function public.service_create_organizer_onsite_registration(
  p_event_edition_id uuid,
  p_event_category_id uuid,
  p_existing_athlete_profile_id uuid,
  p_athlete_slug_base text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_date_of_birth date,
  p_gender text,
  p_city text,
  p_country_code text,
  p_phone text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_public_start_list_opt_in boolean,
  p_organizer_attested boolean,
  p_actor_user_id uuid,
  p_idempotency_key_hash text,
  p_idempotency_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_row public.event_categories%rowtype;
  edition_row public.event_editions%rowtype;
  existing_registration public.registrations%rowtype;
  created_registration public.registrations%rowtype;
  athlete_row public.athlete_profiles%rowtype;
  organization_id uuid;
  represented_club_id uuid;
  normalized_email text := nullif(lower(trim(p_email)), '');
  slug_base text;
  slug_candidate text;
  slug_suffix integer := 1;
  profile_created boolean := false;
  occupied_count bigint := 0;
  queue_position bigint := 0;
  has_capacity boolean := true;
  fee_cents integer := 0;
  quote_currency char(3);
  initial_status public.registration_status;
  initial_payment_status public.payment_status;
  created_quote_id uuid;
  quote_expires_at timestamptz := now() + interval '60 minutes';
begin
  if p_event_edition_id is null
     or p_event_category_id is null
     or p_actor_user_id is null
     or p_organizer_attested is not true
     or p_idempotency_key_hash !~ '^[a-f0-9]{64}$'
     or p_idempotency_request_hash !~ '^[a-f0-9]{64}$'
     or (p_existing_athlete_profile_id is null and (
       nullif(trim(p_first_name), '') is null
       or nullif(trim(p_last_name), '') is null
       or p_date_of_birth is null
       or p_gender not in ('F', 'M', 'U')
     )) then
    raise exception using errcode = '22023', message = 'onsite_registration_input_invalid';
  end if;

  if p_country_code is not null
     and nullif(trim(p_country_code), '') is not null
     and upper(trim(p_country_code)) !~ '^[A-Z]{2}$' then
    raise exception using errcode = '22023', message = 'onsite_country_code_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('organizer-onsite-registration:' || p_idempotency_key_hash, 0)
  );

  select registration.*
  into existing_registration
  from public.registrations registration
  where registration.idempotency_key_hash = p_idempotency_key_hash;

  if found then
    if existing_registration.idempotency_request_hash is distinct from p_idempotency_request_hash then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;

    return jsonb_build_object(
      'registrationId', existing_registration.id,
      'athleteProfileId', existing_registration.athlete_profile_id,
      'registrationStatus', existing_registration.status,
      'paymentStatus', existing_registration.payment_status,
      'profileCreated', false,
      'replayed', true
    );
  end if;

  select category.*
  into category_row
  from public.event_categories category
  where category.id = p_event_category_id
    and category.event_edition_id = p_event_edition_id
    and category.organizer_deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'onsite_category_not_found';
  end if;

  select edition.*
  into edition_row
  from public.event_editions edition
  where edition.id = p_event_edition_id
    and edition.organizer_deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  if category_row.status not in ('published')
     or edition_row.status not in ('published', 'registration_open', 'registration_closed') then
    raise exception using errcode = 'P0001', message = 'onsite_registration_closed';
  end if;

  select series.organization_id
  into organization_id
  from public.event_series series
  where series.id = edition_row.event_series_id;

  if p_existing_athlete_profile_id is not null then
    select athlete.*
    into athlete_row
    from public.athlete_profiles athlete
    where athlete.id = p_existing_athlete_profile_id
      and athlete.status = 'active'
      and athlete.merged_into_athlete_profile_id is null
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'onsite_athlete_not_found';
    end if;
  else
    if normalized_email is not null and exists (
      select 1
      from public.athlete_profiles athlete
      where lower(athlete.primary_email::text) = normalized_email
        and athlete.merged_into_athlete_profile_id is null
      union all
      select 1
      from public.athlete_identities identity
      where identity.identity_type = 'email'
        and lower(identity.identity_value) = normalized_email
    ) then
      raise exception using errcode = '23505', message = 'onsite_email_exists';
    end if;

    slug_base := trim(both '-' from regexp_replace(lower(coalesce(nullif(trim(p_athlete_slug_base), ''), trim(p_first_name) || '-' || trim(p_last_name))), '[^a-z0-9]+', '-', 'g'));
    if slug_base = '' then
      slug_base := 'onsite-athlete';
    end if;
    slug_candidate := slug_base;

    loop
      begin
        insert into public.athlete_profiles (
          slug,
          first_name,
          last_name,
          display_name,
          gender,
          date_of_birth,
          birth_year,
          city,
          country_code,
          primary_email,
          is_claimed,
          status
        ) values (
          slug_candidate,
          trim(p_first_name),
          trim(p_last_name),
          trim(p_first_name) || ' ' || trim(p_last_name),
          p_gender,
          p_date_of_birth,
          extract(year from p_date_of_birth)::smallint,
          nullif(trim(p_city), ''),
          nullif(upper(trim(p_country_code)), ''),
          normalized_email,
          false,
          'active'
        )
        returning * into athlete_row;
        exit;
      exception
        when unique_violation then
          if exists (select 1 from public.athlete_profiles where slug = slug_candidate) then
            slug_suffix := slug_suffix + 1;
            slug_candidate := slug_base || '-' || slug_suffix::text;
          else
            raise;
          end if;
      end;
    end loop;
    profile_created := true;

    if normalized_email is not null then
      insert into public.athlete_identities (
        athlete_profile_id,
        identity_type,
        identity_value,
        is_verified
      ) values (
        athlete_row.id,
        'email',
        normalized_email,
        false
      );
    end if;

    insert into public.profile_visibility_settings (athlete_profile_id)
    values (athlete_row.id)
    on conflict (athlete_profile_id) do nothing;
  end if;

  insert into public.athlete_registration_profiles (
    athlete_profile_id,
    phone,
    emergency_contact_name,
    emergency_contact_phone
  ) values (
    athlete_row.id,
    nullif(trim(p_phone), ''),
    nullif(trim(p_emergency_contact_name), ''),
    nullif(trim(p_emergency_contact_phone), '')
  )
  on conflict (athlete_profile_id) do update
  set
    phone = coalesce(public.athlete_registration_profiles.phone, excluded.phone),
    emergency_contact_name = coalesce(public.athlete_registration_profiles.emergency_contact_name, excluded.emergency_contact_name),
    emergency_contact_phone = coalesce(public.athlete_registration_profiles.emergency_contact_phone, excluded.emergency_contact_phone);

  select membership.club_id
  into represented_club_id
  from public.club_memberships membership
  where membership.athlete_profile_id = athlete_row.id
    and membership.status = 'active'
  order by membership.is_primary desc, membership.joined_at asc nulls last
  limit 1;

  select registration.*
  into existing_registration
  from public.registrations registration
  where registration.event_category_id = p_event_category_id
    and registration.athlete_profile_id = athlete_row.id
    and registration.status not in ('cancelled', 'expired', 'transferred', 'deferred')
  order by registration.created_at desc
  limit 1;

  if found then
    raise exception using errcode = '23505', message = 'already_registered';
  end if;

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

  has_capacity := category_row.capacity is null or occupied_count < category_row.capacity;
  fee_cents := greatest(coalesce(category_row.registration_fee_cents, 0), 0);
  quote_currency := upper(coalesce(category_row.currency, 'EUR'))::char(3);

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
    participation_status,
    result_status,
    confirmed_at,
    source,
    consent_basis,
    terms_version,
    terms_accepted_at,
    public_start_list_opt_in,
    idempotency_key_hash,
    idempotency_request_hash,
    birth_year_snapshot
  ) values (
    p_event_category_id,
    athlete_row.id,
    represented_club_id,
    initial_status,
    initial_payment_status,
    'not_started',
    'uncomputed',
    case when initial_status = 'confirmed' then now() else null end,
    'organizer_onsite',
    'organizer_attested',
    'organizer-onsite-v1',
    now(),
    coalesce(p_public_start_list_opt_in, false),
    p_idempotency_key_hash,
    p_idempotency_request_hash,
    coalesce(athlete_row.birth_year, extract(year from athlete_row.date_of_birth)::smallint)
  )
  returning * into created_registration;

  if not has_capacity then
    select coalesce(max(entry.queue_position), 0) + 1
    into queue_position
    from public.registration_waitlist_entries entry
    where entry.event_category_id = p_event_category_id;

    insert into public.registration_waitlist_entries (
      registration_id,
      event_category_id,
      queue_position,
      state
    ) values (
      created_registration.id,
      p_event_category_id,
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
    ) values (
      created_registration.id,
      p_event_category_id,
      organization_id,
      case when fee_cents = 0 then 'accepted' else 'active' end,
      quote_currency,
      fee_cents,
      fee_cents,
      jsonb_build_array(jsonb_build_object(
        'type', 'registration_fee',
        'label', category_row.name,
        'quantity', 1,
        'unitAmountCents', fee_cents,
        'totalCents', fee_cents
      )),
      jsonb_build_object(
        'eventCategoryId', category_row.id,
        'eventCategoryName', category_row.name,
        'registrationFeeCents', fee_cents,
        'currency', quote_currency,
        'source', 'organizer_onsite'
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
      ) values (
        created_registration.id,
        p_event_category_id,
        created_quote_id,
        'active',
        'organizer',
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
  ) values (
    created_registration.id,
    null,
    created_registration.status,
    p_actor_user_id,
    case when created_registration.status = 'waitlisted'
      then 'onsite_capacity_waitlisted'
      else 'organizer_onsite_created'
    end
  );

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  ) values (
    organization_id,
    p_actor_user_id,
    'registration',
    created_registration.id,
    'registration.onsite_created',
    jsonb_build_object(
      'eventEditionId', p_event_edition_id,
      'eventCategoryId', p_event_category_id,
      'athleteProfileId', athlete_row.id,
      'profileCreated', profile_created,
      'status', created_registration.status,
      'paymentStatus', created_registration.payment_status,
      'quoteId', created_quote_id
    )
  );

  return jsonb_build_object(
    'registrationId', created_registration.id,
    'athleteProfileId', athlete_row.id,
    'registrationStatus', created_registration.status,
    'paymentStatus', created_registration.payment_status,
    'profileCreated', profile_created,
    'replayed', false
  );
end;
$$;

comment on function public.service_create_organizer_onsite_registration(
  uuid, uuid, uuid, text, text, text, text, date, text, text, text, text, text,
  text, boolean, boolean, uuid, text, text
) is
  'Creates or reuses an athlete profile and registers that athlete at the authorized race-day desk, including capacity, price snapshot, organizer attestation, and audit history.';

revoke all on function public.service_create_organizer_onsite_registration(
  uuid, uuid, uuid, text, text, text, text, date, text, text, text, text, text,
  text, boolean, boolean, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.service_create_organizer_onsite_registration(
  uuid, uuid, uuid, text, text, text, text, date, text, text, text, text, text,
  text, boolean, boolean, uuid, text, text
) to service_role;

create or replace function public.enforce_registration_category_eligibility()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  category_row public.event_categories%rowtype;
  edition_start_date date;
  athlete_birth_date date;
  athlete_gender text;
  athlete_age integer;
begin
  if new.source not in ('direct', 'guest', 'organizer_onsite') then
    return new;
  end if;

  select category.*
  into category_row
  from public.event_categories category
  where category.id = new.event_category_id;

  select edition.start_date
  into edition_start_date
  from public.event_editions edition
  where edition.id = category_row.event_edition_id;

  if category_row.minimum_age is null
     and category_row.maximum_age is null
     and category_row.allowed_genders = array['F', 'M', 'U']::text[] then
    return new;
  end if;

  select athlete.date_of_birth, athlete.gender
  into athlete_birth_date, athlete_gender
  from public.athlete_profiles athlete
  where athlete.id = new.athlete_profile_id;

  if category_row.minimum_age is not null or category_row.maximum_age is not null then
    if athlete_birth_date is null then
      raise exception using errcode = '22023', message = 'eligibility_birth_date_required';
    end if;

    athlete_age := extract(year from age(edition_start_date, athlete_birth_date))::integer;
    if category_row.minimum_age is not null and athlete_age < category_row.minimum_age then
      raise exception using errcode = '22023', message = 'eligibility_minimum_age_not_met';
    end if;
    if category_row.maximum_age is not null and athlete_age > category_row.maximum_age then
      raise exception using errcode = '22023', message = 'eligibility_maximum_age_exceeded';
    end if;
  end if;

  athlete_gender := case lower(coalesce(athlete_gender, ''))
    when 'f' then 'F'
    when 'female' then 'F'
    when 'woman' then 'F'
    when 'w' then 'F'
    when 'm' then 'M'
    when 'male' then 'M'
    when 'man' then 'M'
    else 'U'
  end;
  if not (athlete_gender = any(category_row.allowed_genders)) then
    raise exception using errcode = '22023', message = 'eligibility_gender_not_allowed';
  end if;

  return new;
end;
$$;

comment on function public.enforce_registration_category_eligibility() is
  'Enforces demographic category eligibility for athlete, guest, and organizer-attested onsite registrations.';

revoke all on function public.enforce_registration_category_eligibility()
  from public, anon, authenticated;

create or replace function public.service_complete_terminal_race_edition(
  p_event_edition_id uuid,
  p_actor_user_id uuid,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  edition_row public.event_editions%rowtype;
  organization_id uuid;
  category_ids uuid[] := '{}'::uuid[];
  nonterminal_count integer := 0;
  league_round_event_count integer := 0;
  legacy_league_round_count integer := 0;
  command_event public.domain_events%rowtype;
  command_payload jsonb;
begin
  if p_event_edition_id is null or p_actor_user_id is null or p_client_event_id is null then
    raise exception using errcode = '22023', message = 'terminal_race_completion_input_invalid';
  end if;

  select event.*
  into command_event
  from public.domain_events event
  where event.event_type = 'race.finish.terminal_completion'
    and event.idempotency_key = p_client_event_id::text;

  if found then
    if command_event.aggregate_id <> p_event_edition_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return command_event.payload_json || jsonb_build_object(
      'domainEventId', command_event.id,
      'resultJobs', '[]'::jsonb,
      'unfinishedParticipantCount', 0,
      'markedDnfCount', 0,
      'replayed', true
    );
  end if;

  select edition.*
  into edition_row
  from public.event_editions edition
  where edition.id = p_event_edition_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  select series.organization_id
  into organization_id
  from public.event_series series
  where series.id = edition_row.event_series_id;

  perform 1
  from public.event_categories category
  where category.event_edition_id = p_event_edition_id
    and category.results_mode <> 'informative_age'
  order by category.id
  for update;

  select
    coalesce(array_agg(category.id order by category.id), '{}'::uuid[]),
    count(*) filter (where category.status not in ('completed', 'closed'))::integer
  into category_ids, nonterminal_count
  from public.event_categories category
  where category.event_edition_id = p_event_edition_id
    and category.results_mode <> 'informative_age';

  if cardinality(category_ids) = 0 or nonterminal_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'terminal_race_completion_invalid',
      detail = nonterminal_count::text;
  end if;

  if edition_row.status not in ('completed', 'archived') then
    update public.event_editions edition
    set status = 'completed'
    where edition.id = p_event_edition_id;
  end if;

  update public.league_round_events round_event
  set status = 'completed'
  where round_event.event_edition_id = p_event_edition_id
    and round_event.status not in ('completed', 'cancelled');
  get diagnostics league_round_event_count = row_count;

  update public.league_rounds round
  set status = 'completed'
  where round.event_edition_id = p_event_edition_id
    and round.status not in ('completed', 'cancelled');
  get diagnostics legacy_league_round_count = row_count;

  command_payload := jsonb_build_object(
    'eventEditionId', p_event_edition_id,
    'requestedCategoryIds', to_jsonb(category_ids),
    'finishedCategoryIds', to_jsonb(category_ids),
    'newlyFinishedCategoryIds', '[]'::jsonb,
    'closedTimingSessionCount', 0,
    'editionCompleted', true,
    'leagueRoundEventCount', league_round_event_count,
    'legacyLeagueRoundCount', legacy_league_round_count,
    'completionReason', 'all_races_terminal_without_result_snapshot'
  );

  insert into public.domain_events (
    organization_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload_json,
    actor_user_id,
    correlation_id,
    idempotency_key
  ) values (
    organization_id,
    'race.finish.terminal_completion',
    'event_edition',
    p_event_edition_id,
    command_payload,
    p_actor_user_id,
    p_client_event_id,
    p_client_event_id::text
  )
  returning * into command_event;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  ) values (
    organization_id,
    p_actor_user_id,
    'event_edition',
    p_event_edition_id,
    'race_day.completed_without_results',
    jsonb_build_object(
      'categoryIds', to_jsonb(category_ids),
      'domainEventId', command_event.id,
      'clientEventId', p_client_event_id
    )
  );

  if edition_row.status not in ('completed', 'archived') then
    insert into public.domain_events (
      organization_id,
      event_type,
      aggregate_type,
      aggregate_id,
      payload_json,
      actor_user_id,
      correlation_id,
      causation_event_id,
      idempotency_key
    ) values (
      organization_id,
      'event.edition.completed',
      'event_edition',
      p_event_edition_id,
      jsonb_build_object(
        'eventEditionId', p_event_edition_id,
        'completedAt', command_event.occurred_at,
        'reason', 'terminal_races_without_results'
      ),
      p_actor_user_id,
      p_client_event_id,
      command_event.id,
      p_client_event_id::text || ':edition'
    );
  end if;

  return command_payload || jsonb_build_object(
    'domainEventId', command_event.id,
    'resultJobs', '[]'::jsonb,
    'unfinishedParticipantCount', 0,
    'markedDnfCount', 0,
    'replayed', false
  );
end;
$$;

comment on function public.service_complete_terminal_race_edition(uuid, uuid, uuid) is
  'Completes an edition when every competitive race is already completed or closed, without inventing participants or result snapshots.';

revoke all on function public.service_complete_terminal_race_edition(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_complete_terminal_race_edition(uuid, uuid, uuid)
  to service_role;

commit;
