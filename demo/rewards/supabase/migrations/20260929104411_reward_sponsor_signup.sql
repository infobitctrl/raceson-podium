-- Podium-only sponsor bootstrap; preserves hardened empty search_path and qualified types.
CREATE OR REPLACE FUNCTION public.bootstrap_current_user_account(requested_roles text[] DEFAULT ARRAY['athlete'::text], preferred_display_name text DEFAULT NULL::text, preferred_first_name text DEFAULT NULL::text, preferred_last_name text DEFAULT NULL::text, preferred_locale text DEFAULT NULL::text, preferred_timezone text DEFAULT NULL::text, create_athlete_profile boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_user_id uuid := public.request_user_id();
  auth_user_row auth.users%rowtype;
  current_profile public.user_profiles%rowtype;
  next_email extensions.citext;
  next_display_name text;
  next_first_name text;
  next_last_name text;
  next_locale text;
  next_timezone text;
  next_default_role text;
  next_preferences jsonb;
  next_athlete_profile_id uuid;
  next_email_verified_at timestamptz;
  next_auth_providers jsonb;
  slug_base text;
  slug_candidate text;
  suffix integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authenticated user required'
      using errcode = '42501';
  end if;

  select *
  into auth_user_row
  from auth.users
  where id = current_user_id;

  if not found then
    raise exception 'Auth user % not found', current_user_id
      using errcode = 'P0001';
  end if;

  -- Server-owned purpose cannot be changed through editable user metadata.
  if auth_user_row.raw_app_meta_data ->> 'podium_registration_purpose' = 'sponsor' then
    requested_roles := array['sponsor']::text[];
    create_athlete_profile := false;
  end if;

  next_email := nullif(trim(auth_user_row.email), '')::extensions.citext;
  next_display_name := coalesce(
    nullif(trim(preferred_display_name), ''),
    public.auth_user_display_name(auth_user_row.raw_user_meta_data, auth_user_row.email)
  );
  next_first_name := coalesce(
    nullif(trim(preferred_first_name), ''),
    nullif(trim(auth_user_row.raw_user_meta_data ->> 'first_name'), ''),
    nullif(split_part(next_display_name, ' ', 1), ''),
    'Trail'
  );
  next_last_name := coalesce(
    nullif(trim(preferred_last_name), ''),
    nullif(trim(auth_user_row.raw_user_meta_data ->> 'last_name'), ''),
    nullif(trim(substr(next_display_name, length(next_first_name) + 1)), ''),
    'User'
  );
  next_locale := coalesce(nullif(trim(preferred_locale), ''), 'en');
  next_timezone := coalesce(nullif(trim(preferred_timezone), ''), 'Europe/Zagreb');
  next_default_role := case
    when requested_roles = array['sponsor']::text[] then 'sponsor'
    when requested_roles is not null and 'organizer' = any (requested_roles) then 'organizer'
    when requested_roles is not null and 'timer' = any (requested_roles) then 'timer'
    else 'athlete'
  end;
  next_preferences := jsonb_build_object(
    'default_role', next_default_role,
    'requested_roles', coalesce(to_jsonb(requested_roles), '[]'::jsonb)
  );
  next_email_verified_at := auth_user_row.email_confirmed_at;
  next_auth_providers := public.auth_user_provider_list(auth_user_row.raw_app_meta_data);

  insert into public.user_profiles (
    user_id,
    email,
    display_name,
    first_name,
    last_name,
    locale,
    timezone,
    preferences_json,
    email_verified_at,
    auth_providers_json,
    last_sign_in_at
  )
  values (
    current_user_id,
    next_email,
    next_display_name,
    next_first_name,
    next_last_name,
    next_locale,
    next_timezone,
    next_preferences,
    next_email_verified_at,
    next_auth_providers,
    auth_user_row.last_sign_in_at
  )
  on conflict (user_id) do update
  set
    email = excluded.email,
    display_name = coalesce(nullif(trim(public.user_profiles.display_name), ''), excluded.display_name),
    first_name = coalesce(nullif(trim(public.user_profiles.first_name), ''), excluded.first_name),
    last_name = coalesce(nullif(trim(public.user_profiles.last_name), ''), excluded.last_name),
    locale = coalesce(nullif(trim(public.user_profiles.locale), ''), excluded.locale),
    timezone = coalesce(nullif(trim(public.user_profiles.timezone), ''), excluded.timezone),
    preferences_json = coalesce(public.user_profiles.preferences_json, '{}'::jsonb) || next_preferences,
    email_verified_at = coalesce(excluded.email_verified_at, public.user_profiles.email_verified_at),
    auth_providers_json = excluded.auth_providers_json,
    last_sign_in_at = coalesce(excluded.last_sign_in_at, public.user_profiles.last_sign_in_at),
    updated_at = now()
  returning *
  into current_profile;

  next_athlete_profile_id := current_profile.primary_athlete_profile_id;

  if create_athlete_profile and next_athlete_profile_id is null then
    select ai.athlete_profile_id
    into next_athlete_profile_id
    from public.athlete_identities ai
    join public.athlete_profiles ap on ap.id = ai.athlete_profile_id
    where ai.user_id = current_user_id
      and ai.is_verified
      and ap.merged_into_athlete_profile_id is null
    order by coalesce(ai.verified_at, ai.created_at) asc
    limit 1;

    if next_athlete_profile_id is null then
      select ap.id
      into next_athlete_profile_id
      from public.athlete_profiles ap
      where ap.claimed_by_user_id = current_user_id
        and ap.merged_into_athlete_profile_id is null
      order by ap.created_at asc
      limit 1;
    end if;

    if next_athlete_profile_id is null then
      slug_base := trim(
        both '-'
        from regexp_replace(
          translate(lower(next_display_name), 'čćžšđ', 'cczsd'),
          '[^a-z0-9]+',
          '-',
          'g'
        )
      );

      if slug_base = '' then
        slug_base := format('athlete-%s', left(replace(current_user_id::text, '-', ''), 8));
      end if;

      slug_candidate := slug_base;

      while exists (
        select 1
        from public.athlete_profiles ap
        where ap.slug = slug_candidate
      ) loop
        suffix := suffix + 1;
        slug_candidate := format('%s-%s', slug_base, suffix);
      end loop;

      insert into public.athlete_profiles (
        slug,
        first_name,
        last_name,
        display_name,
        primary_email,
        is_claimed,
        claimed_by_user_id,
        status
      )
      values (
        slug_candidate,
        next_first_name,
        next_last_name,
        next_display_name,
        next_email,
        true,
        current_user_id,
        'active'
      )
      returning id
      into next_athlete_profile_id;
    else
      update public.athlete_profiles
      set
        display_name = coalesce(nullif(trim(display_name), ''), next_display_name),
        first_name = coalesce(nullif(trim(first_name), ''), next_first_name),
        last_name = coalesce(nullif(trim(last_name), ''), next_last_name),
        primary_email = coalesce(primary_email, next_email),
        is_claimed = true,
        claimed_by_user_id = coalesce(claimed_by_user_id, current_user_id),
        updated_at = now()
      where id = next_athlete_profile_id;
    end if;

    insert into public.profile_visibility_settings (athlete_profile_id)
    values (next_athlete_profile_id)
    on conflict (athlete_profile_id) do nothing;

    insert into public.athlete_identities (
      athlete_profile_id,
      user_id,
      identity_type,
      identity_value,
      is_verified,
      verified_at
    )
    values (
      next_athlete_profile_id,
      current_user_id,
      'auth_user',
      current_user_id::text,
      true,
      now()
    )
    on conflict (identity_type, identity_value) do nothing;

    update public.user_profiles
    set
      primary_athlete_profile_id = next_athlete_profile_id,
      email_verified_at = coalesce(next_email_verified_at, email_verified_at),
      auth_providers_json = next_auth_providers,
      last_sign_in_at = coalesce(auth_user_row.last_sign_in_at, last_sign_in_at),
      updated_at = now()
    where user_id = current_user_id
    returning *
    into current_profile;
  end if;

  insert into public.auth_security_events (
    user_id,
    email,
    event_type,
    event_status,
    metadata_json
  )
  values (
    current_user_id,
    next_email,
    'account_bootstrap',
    'success',
    jsonb_build_object(
      'requested_roles', coalesce(to_jsonb(requested_roles), '[]'::jsonb),
      'default_role', next_default_role,
      'email_verified', next_email_verified_at is not null,
      'created_athlete_profile', next_athlete_profile_id is not null
    )
  );

  return jsonb_build_object(
    'user_profile_id', current_profile.id,
    'primary_athlete_profile_id', current_profile.primary_athlete_profile_id,
    'default_role', coalesce(current_profile.preferences_json ->> 'default_role', next_default_role)
  );
end;
$function$
