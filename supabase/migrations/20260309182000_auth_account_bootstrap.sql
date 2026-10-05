begin;

create index if not exists athlete_profiles_claimed_by_user_idx
  on athlete_profiles (claimed_by_user_id)
  where claimed_by_user_id is not null;

create index if not exists organization_memberships_user_status_idx
  on organization_memberships (user_id, status);

create or replace function public.bootstrap_current_user_account(
  requested_roles text[] default array['athlete']::text[],
  preferred_display_name text default null,
  preferred_first_name text default null,
  preferred_last_name text default null,
  preferred_locale text default null,
  preferred_timezone text default null,
  create_athlete_profile boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := public.request_user_id();
  auth_user_row auth.users%rowtype;
  current_profile public.user_profiles%rowtype;
  next_email citext;
  next_display_name text;
  next_first_name text;
  next_last_name text;
  next_locale text;
  next_timezone text;
  next_default_role text;
  next_preferences jsonb;
  next_athlete_profile_id uuid;
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

  next_email := nullif(trim(auth_user_row.email), '')::citext;
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
    when requested_roles is not null and 'organizer' = any (requested_roles) then 'organizer'
    when requested_roles is not null and 'timer' = any (requested_roles) then 'timer'
    else 'athlete'
  end;
  next_preferences := jsonb_build_object(
    'default_role', next_default_role,
    'requested_roles', coalesce(to_jsonb(requested_roles), '[]'::jsonb)
  );

  insert into public.user_profiles (
    user_id,
    email,
    display_name,
    first_name,
    last_name,
    locale,
    timezone,
    preferences_json
  )
  values (
    current_user_id,
    next_email,
    next_display_name,
    next_first_name,
    next_last_name,
    next_locale,
    next_timezone,
    next_preferences
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
      updated_at = now()
    where user_id = current_user_id
    returning *
    into current_profile;
  end if;

  return jsonb_build_object(
    'user_profile_id', current_profile.id,
    'primary_athlete_profile_id', current_profile.primary_athlete_profile_id,
    'default_role', coalesce(current_profile.preferences_json ->> 'default_role', next_default_role)
  );
end;
$$;

revoke all on function public.bootstrap_current_user_account(text[], text, text, text, text, text, boolean) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.bootstrap_current_user_account(text[], text, text, text, text, text, boolean) to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.bootstrap_current_user_account(text[], text, text, text, text, text, boolean) to service_role;
  end if;
end;
$$;

commit;
