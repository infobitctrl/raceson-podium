create or replace function public.create_guest_registration_atomically(
  target_event_category_id uuid,
  target_athlete_slug_base text,
  target_first_name text,
  target_last_name text,
  target_display_name text,
  target_email text,
  target_date_of_birth date,
  target_gender text,
  target_city text,
  target_country_code text,
  target_phone text,
  target_emergency_contact_name text,
  target_emergency_contact_phone text,
  target_shirt_size text,
  target_terms_version text,
  target_public_start_list_opt_in boolean,
  target_idempotency_key_hash text,
  target_idempotency_request_hash text
)
returns table (
  registration_id uuid,
  registration_status public.registration_status,
  payment_status public.payment_status,
  athlete_profile_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_email text := lower(trim(target_email));
  slug_base text := trim(target_athlete_slug_base);
  slug_candidate text;
  slug_suffix integer := 1;
  existing_registration public.registrations%rowtype;
  created_athlete_profile_id uuid;
  created_registration_id uuid;
  created_registration_status public.registration_status;
  created_payment_status public.payment_status;
begin
  if normalized_email = ''
     or slug_base = ''
     or trim(target_first_name) = ''
     or trim(target_last_name) = ''
     or trim(target_display_name) = ''
     or trim(target_phone) = ''
     or trim(target_emergency_contact_name) = ''
     or trim(target_emergency_contact_phone) = '' then
    raise exception using errcode = '22023', message = 'guest_registration_fields_required';
  end if;

  if target_idempotency_key_hash is null
     or trim(target_idempotency_key_hash) = ''
     or target_idempotency_request_hash is null
     or trim(target_idempotency_request_hash) = '' then
    raise exception using errcode = '22023', message = 'guest_idempotency_required';
  end if;

  if target_date_of_birth is null or target_date_of_birth >= current_date then
    raise exception using errcode = '22023', message = 'invalid_guest_date_of_birth';
  end if;

  if target_gender not in ('F', 'M', 'U') then
    raise exception using errcode = '22023', message = 'invalid_guest_gender';
  end if;

  if target_country_code is not null and target_country_code !~ '^[A-Z]{2}$' then
    raise exception using errcode = '22023', message = 'invalid_guest_country_code';
  end if;

  /*
   * Serialize first by email and then by request key. The stable lock order
   * prevents duplicate guest identities and makes concurrent HTTP retries
   * converge on the same registration.
   */
  perform pg_advisory_xact_lock(
    hashtextextended('guest-registration-email:' || normalized_email, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('guest-registration-key:' || target_idempotency_key_hash, 0)
  );

  select *
  into existing_registration
  from public.registrations
  where idempotency_key_hash = target_idempotency_key_hash;

  if found then
    if existing_registration.idempotency_request_hash is distinct from target_idempotency_request_hash then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;

    return query
    select
      existing_registration.id,
      existing_registration.status,
      existing_registration.payment_status,
      existing_registration.athlete_profile_id;
    return;
  end if;

  if exists (
    select 1
    from public.athlete_identities identity
    where identity.identity_type = 'email'
      and lower(identity.identity_value) = normalized_email
  ) then
    raise exception using errcode = '23505', message = 'guest_identity_exists';
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
        city,
        country_code,
        primary_email,
        is_claimed,
        status
      ) values (
        slug_candidate,
        trim(target_first_name),
        trim(target_last_name),
        trim(target_display_name),
        target_gender,
        target_date_of_birth,
        nullif(trim(target_city), ''),
        nullif(trim(target_country_code), ''),
        normalized_email,
        false,
        'active'
      )
      returning id into created_athlete_profile_id;
      exit;
    exception
      when unique_violation then
        if exists (
          select 1
          from public.athlete_profiles
          where slug = slug_candidate
        ) then
          slug_suffix := slug_suffix + 1;
          slug_candidate := format('%s-%s', slug_base, slug_suffix);
        else
          raise;
        end if;
    end;
  end loop;

  insert into public.athlete_identities (
    athlete_profile_id,
    user_id,
    identity_type,
    identity_value,
    is_verified
  ) values (
    created_athlete_profile_id,
    null,
    'email',
    normalized_email,
    false
  );

  insert into public.profile_visibility_settings (athlete_profile_id)
  values (created_athlete_profile_id);

  insert into public.athlete_registration_profiles (
    athlete_profile_id,
    phone,
    emergency_contact_name,
    emergency_contact_phone,
    shirt_size
  ) values (
    created_athlete_profile_id,
    trim(target_phone),
    trim(target_emergency_contact_name),
    trim(target_emergency_contact_phone),
    nullif(upper(trim(target_shirt_size)), '')
  );

  select
    created.registration_id,
    created.registration_status,
    created.payment_status
  into
    created_registration_id,
    created_registration_status,
    created_payment_status
  from public.create_registration_atomically(
    target_event_category_id => target_event_category_id,
    target_athlete_profile_id => created_athlete_profile_id,
    target_represented_club_id => null,
    target_changed_by_user_id => null,
    target_source => 'guest',
    target_terms_version => target_terms_version,
    target_terms_accepted_at => now(),
    target_public_start_list_opt_in => target_public_start_list_opt_in,
    target_idempotency_key_hash => target_idempotency_key_hash,
    target_idempotency_request_hash => target_idempotency_request_hash
  ) created;

  return query
  select
    created_registration_id,
    created_registration_status,
    created_payment_status,
    created_athlete_profile_id;
end;
$$;
