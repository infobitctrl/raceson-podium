begin;

create or replace function public.sync_user_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  next_email citext;
  next_display_name text;
  next_first_name text;
  next_last_name text;
  next_avatar_url text;
  next_email_verified_at timestamptz;
  next_auth_providers jsonb;
  next_last_sign_in_at timestamptz;
begin
  next_email := nullif(trim(new.email), '')::citext;
  next_display_name := public.auth_user_display_name(new.raw_user_meta_data, new.email);
  next_first_name := nullif(trim(new.raw_user_meta_data ->> 'first_name'), '');
  next_last_name := nullif(trim(new.raw_user_meta_data ->> 'last_name'), '');
  next_avatar_url := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'picture'), '')
  );
  next_email_verified_at := new.email_confirmed_at;
  next_auth_providers := public.auth_user_provider_list(new.raw_app_meta_data);
  next_last_sign_in_at := new.last_sign_in_at;

  insert into public.user_profiles (
    user_id,
    email,
    display_name,
    first_name,
    last_name,
    avatar_url,
    email_verified_at,
    auth_providers_json,
    last_sign_in_at
  )
  values (
    new.id,
    next_email,
    next_display_name,
    next_first_name,
    next_last_name,
    next_avatar_url,
    next_email_verified_at,
    next_auth_providers,
    next_last_sign_in_at
  )
  on conflict (user_id) do update
  set
    email = excluded.email,
    display_name = coalesce(nullif(trim(public.user_profiles.display_name), ''), excluded.display_name),
    first_name = coalesce(nullif(trim(public.user_profiles.first_name), ''), excluded.first_name),
    last_name = coalesce(nullif(trim(public.user_profiles.last_name), ''), excluded.last_name),
    avatar_url = coalesce(excluded.avatar_url, public.user_profiles.avatar_url),
    email_verified_at = coalesce(excluded.email_verified_at, public.user_profiles.email_verified_at),
    auth_providers_json = excluded.auth_providers_json,
    last_sign_in_at = coalesce(excluded.last_sign_in_at, public.user_profiles.last_sign_in_at),
    updated_at = now();

  return new;
end;
$$;

update public.user_profiles up
set avatar_url = coalesce(
  nullif(trim(au.raw_user_meta_data ->> 'avatar_url'), ''),
  nullif(trim(au.raw_user_meta_data ->> 'picture'), ''),
  up.avatar_url
)
from auth.users au
where up.user_id = au.id;

commit;
