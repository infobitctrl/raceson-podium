begin;

create or replace function public.service_update_platform_account_details(
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_expected_email text,
  p_expected_username text,
  p_credential_mode text,
  p_profile jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_profile public.user_profiles%rowtype;
  previous_identifier public.account_login_identifiers%rowtype;
  previous_athlete public.athlete_profiles%rowtype;
  previous_registration public.athlete_registration_profiles%rowtype;
  next_display_name text := nullif(btrim(p_profile ->> 'displayName'), '');
  next_email text := lower(nullif(btrim(p_profile ->> 'email'), ''));
  next_username text := lower(nullif(btrim(p_profile ->> 'username'), ''));
  expected_email text := lower(nullif(btrim(p_expected_email), ''));
  expected_username text := lower(nullif(btrim(p_expected_username), ''));
  current_email text;
  current_username text;
  reason_text text := nullif(btrim(p_reason), '');
  next_preferences jsonb;
  next_requested_roles jsonb;
  next_default_role text;
  organizer_setup_enabled boolean := coalesce((p_profile ->> 'organizerSetupEnabled')::boolean, false);
  changed_at timestamptz := now();
  target_label text;
begin
  if not exists (
    select 1
    from public.platform_administrators administrator
    where administrator.user_id = p_actor_user_id
      and administrator.platform_role = 'super_admin'
      and administrator.is_active
  ) then
    raise exception using errcode = '42501', message = 'platform_super_admin_required';
  end if;

  if p_credential_mode not in ('email', 'username') then
    raise exception using errcode = '22023', message = 'account_credential_mode_invalid';
  end if;
  if next_display_name is null or length(next_display_name) not between 2 and 200 then
    raise exception using errcode = '22023', message = 'account_display_name_invalid';
  end if;
  if p_credential_mode = 'email' and next_email is null then
    raise exception using errcode = '22023', message = 'email_account_requires_email';
  end if;
  if next_email is not null and next_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'account_email_invalid';
  end if;
  if next_username is not null and (
    length(next_username) not between 3 and 48
    or next_username !~ '^[a-z0-9][a-z0-9._-]{2,47}$'
  ) then
    raise exception using errcode = '22023', message = 'account_username_invalid';
  end if;
  if nullif(btrim(p_profile ->> 'countryCode'), '') is not null
    and upper(btrim(p_profile ->> 'countryCode')) !~ '^[A-Z]{2}$'
  then
    raise exception using errcode = '22023', message = 'account_country_code_invalid';
  end if;
  if nullif(btrim(p_profile ->> 'gender'), '') is not null
    and btrim(p_profile ->> 'gender') not in ('F', 'M', 'U')
  then
    raise exception using errcode = '22023', message = 'account_gender_invalid';
  end if;
  if reason_text is null or length(reason_text) not between 8 and 1000 then
    raise exception using errcode = '22023', message = 'platform_management_reason_invalid';
  end if;

  select profile.*
  into previous_profile
  from public.user_profiles profile
  where profile.user_id = p_target_user_id
  for update;

  select identifier.*
  into previous_identifier
  from public.account_login_identifiers identifier
  where identifier.user_id = p_target_user_id
  for update;

  if previous_profile.user_id is null then
    raise exception using errcode = 'P0002', message = 'account_profile_not_found';
  end if;
  if p_credential_mode = 'username' and previous_identifier.user_id is null then
    raise exception using errcode = '55000', message = 'username_account_identifier_missing';
  end if;
  if previous_identifier.user_id is not null and next_username is null then
    raise exception using errcode = '22023', message = 'account_username_required';
  end if;

  current_email := case
    when p_credential_mode = 'username' then previous_identifier.email::text
    else previous_profile.email::text
  end;
  current_username := previous_identifier.username::text;
  if current_email is distinct from expected_email
    or current_username is distinct from expected_username
  then
    raise exception using errcode = '40001', message = 'account_update_conflict';
  end if;

  if previous_profile.primary_athlete_profile_id is not null then
    select athlete.*
    into previous_athlete
    from public.athlete_profiles athlete
    where athlete.id = previous_profile.primary_athlete_profile_id
    for update;

    select registration.*
    into previous_registration
    from public.athlete_registration_profiles registration
    where registration.athlete_profile_id = previous_profile.primary_athlete_profile_id
    for update;
  end if;

  if next_username is distinct from current_username then
    if exists (
      select 1
      from public.account_login_identifiers identifier
      where identifier.username = next_username
        and identifier.user_id <> p_target_user_id
    ) or exists (
      select 1
      from public.organization_memberships membership
      where membership.login_username = next_username
        and membership.status <> 'removed'
    ) or exists (
      select 1
      from public.account_username_history history
      where history.username = next_username
        and history.user_id <> p_target_user_id
        and history.reserved_until > changed_at
    ) then
      raise exception using errcode = '23505', message = 'account_username_conflict';
    end if;

    if current_username is not null then
      insert into public.account_username_history (
        username,
        user_id,
        reserved_until,
        created_at
      ) values (
        current_username,
        p_target_user_id,
        changed_at + interval '90 days',
        changed_at
      )
      on conflict (username) do update
      set
        user_id = excluded.user_id,
        reserved_until = excluded.reserved_until,
        created_at = excluded.created_at;
    end if;
  end if;

  next_preferences := coalesce(previous_profile.preferences_json, '{}'::jsonb);
  next_requested_roles := next_preferences -> 'requested_roles';
  if jsonb_typeof(next_requested_roles) <> 'array' then
    next_requested_roles := '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(role_name), '[]'::jsonb)
  into next_requested_roles
  from jsonb_array_elements_text(next_requested_roles) as roles(role_name)
  where role_name <> 'organizer';
  if organizer_setup_enabled then
    next_requested_roles := next_requested_roles || '["organizer"]'::jsonb;
  end if;
  next_default_role := case
    when next_preferences ->> 'default_role' = 'timer' then 'timer'
    when organizer_setup_enabled then 'organizer'
    else 'athlete'
  end;
  next_preferences := jsonb_set(next_preferences, '{requested_roles}', next_requested_roles, true);
  next_preferences := jsonb_set(next_preferences, '{default_role}', to_jsonb(next_default_role), true);

  begin
    update public.user_profiles profile
    set
      email = next_email,
      display_name = next_display_name,
      first_name = nullif(btrim(p_profile ->> 'firstName'), ''),
      last_name = nullif(btrim(p_profile ->> 'lastName'), ''),
      date_of_birth = nullif(btrim(p_profile ->> 'dateOfBirth'), '')::date,
      city = nullif(btrim(p_profile ->> 'city'), ''),
      country_code = upper(nullif(btrim(p_profile ->> 'countryCode'), '')),
      phone = nullif(btrim(p_profile ->> 'phone'), ''),
      job_title = nullif(btrim(p_profile ->> 'jobTitle'), ''),
      bio = nullif(btrim(p_profile ->> 'bio'), ''),
      website_url = nullif(btrim(p_profile ->> 'websiteUrl'), ''),
      instagram_url = nullif(btrim(p_profile ->> 'instagramUrl'), ''),
      facebook_url = nullif(btrim(p_profile ->> 'facebookUrl'), ''),
      linkedin_url = nullif(btrim(p_profile ->> 'linkedinUrl'), ''),
      youtube_url = nullif(btrim(p_profile ->> 'youtubeUrl'), ''),
      tiktok_url = nullif(btrim(p_profile ->> 'tiktokUrl'), ''),
      x_url = nullif(btrim(p_profile ->> 'xUrl'), ''),
      locale = coalesce(nullif(btrim(p_profile ->> 'locale'), ''), 'en'),
      timezone = coalesce(nullif(btrim(p_profile ->> 'timezone'), ''), 'Europe/Zagreb'),
      avatar_url = nullif(btrim(p_profile ->> 'avatarUrl'), ''),
      cover_image_url = nullif(btrim(p_profile ->> 'coverImageUrl'), ''),
      preferences_json = next_preferences,
      updated_at = changed_at
    where profile.user_id = p_target_user_id;

    if previous_identifier.user_id is not null then
      update public.account_login_identifiers identifier
      set
        username = next_username,
        email = next_email,
        username_changed_at = case
          when next_username is distinct from current_username then changed_at
          else identifier.username_changed_at
        end,
        updated_at = changed_at
      where identifier.user_id = p_target_user_id;
    elsif next_username is not null then
      insert into public.account_login_identifiers (
        user_id,
        username,
        email,
        username_changed_at
      ) values (
        p_target_user_id,
        next_username,
        next_email,
        changed_at
      );
    end if;
  exception
    when unique_violation then
      raise exception using errcode = '23505', message = 'account_email_conflict';
  end;

  if previous_athlete.id is not null then
    update public.athlete_profiles athlete
    set
      display_name = next_display_name,
      first_name = coalesce(
        nullif(btrim(p_profile ->> 'firstName'), ''),
        previous_athlete.first_name,
        next_display_name
      ),
      last_name = coalesce(
        nullif(btrim(p_profile ->> 'lastName'), ''),
        previous_athlete.last_name,
        next_display_name
      ),
      gender = nullif(btrim(p_profile ->> 'gender'), ''),
      date_of_birth = nullif(btrim(p_profile ->> 'dateOfBirth'), '')::date,
      city = nullif(btrim(p_profile ->> 'city'), ''),
      country_code = upper(nullif(btrim(p_profile ->> 'countryCode'), '')),
      primary_email = next_email,
      updated_at = changed_at
    where athlete.id = previous_athlete.id;

    insert into public.athlete_registration_profiles (
      athlete_profile_id,
      phone,
      emergency_contact_name,
      emergency_contact_phone,
      shirt_size
    ) values (
      previous_athlete.id,
      nullif(btrim(p_profile ->> 'phone'), ''),
      nullif(btrim(p_profile ->> 'emergencyContactName'), ''),
      nullif(btrim(p_profile ->> 'emergencyContactPhone'), ''),
      upper(nullif(btrim(p_profile ->> 'shirtSize'), ''))
    )
    on conflict (athlete_profile_id) do update
    set
      phone = excluded.phone,
      emergency_contact_name = excluded.emergency_contact_name,
      emergency_contact_phone = excluded.emergency_contact_phone,
      shirt_size = excluded.shirt_size,
      updated_at = changed_at;
  end if;

  target_label := coalesce(next_email, next_username, next_display_name);
  insert into public.platform_management_actions (
    actor_user_id,
    target_kind,
    target_id,
    target_label,
    action,
    reason,
    detail_json
  ) values (
    p_actor_user_id,
    'account',
    p_target_user_id,
    target_label,
    'account_updated',
    reason_text,
    jsonb_build_object(
      'before', jsonb_build_object(
        'displayName', previous_profile.display_name,
        'email', current_email,
        'username', current_username,
        'firstName', previous_profile.first_name,
        'lastName', previous_profile.last_name,
        'dateOfBirth', coalesce(previous_athlete.date_of_birth, previous_profile.date_of_birth),
        'gender', previous_athlete.gender,
        'city', coalesce(previous_athlete.city, previous_profile.city),
        'countryCode', coalesce(previous_athlete.country_code, previous_profile.country_code),
        'phone', coalesce(previous_profile.phone, previous_registration.phone),
        'jobTitle', previous_profile.job_title,
        'bio', previous_profile.bio,
        'websiteUrl', previous_profile.website_url,
        'instagramUrl', previous_profile.instagram_url,
        'facebookUrl', previous_profile.facebook_url,
        'linkedinUrl', previous_profile.linkedin_url,
        'youtubeUrl', previous_profile.youtube_url,
        'tiktokUrl', previous_profile.tiktok_url,
        'xUrl', previous_profile.x_url,
        'emergencyContactName', previous_registration.emergency_contact_name,
        'emergencyContactPhone', previous_registration.emergency_contact_phone,
        'shirtSize', previous_registration.shirt_size,
        'locale', previous_profile.locale,
        'timezone', previous_profile.timezone,
        'avatarUrl', previous_profile.avatar_url,
        'coverImageUrl', previous_profile.cover_image_url,
        'organizerSetupEnabled', coalesce((previous_profile.preferences_json -> 'requested_roles') ? 'organizer', false)
      ),
      'after', p_profile,
      'credentialMode', p_credential_mode
    )
  );

  return jsonb_build_object(
    'userId', p_target_user_id,
    'displayName', next_display_name,
    'email', next_email,
    'username', next_username,
    'updated', true
  );
end;
$$;

comment on function public.service_update_platform_account_details(uuid, uuid, text, text, text, jsonb, text) is
  'Atomically updates every editable My Account profile field for a super administrator and records a reasoned before/after audit entry.';

revoke all on function public.service_update_platform_account_details(uuid, uuid, text, text, text, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_update_platform_account_details(uuid, uuid, text, text, text, jsonb, text)
  to service_role;

commit;
