begin;

/*
 * Public account credentials are deliberately separate from athlete identity.
 * Passwords remain exclusively in Supabase Auth. This table only maps a stable
 * auth user UUID to the username and optional email accepted by Trail Portal.
 * Athlete profile emails remain nullable and are not globally unique.
 */
create table public.account_login_identifiers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username citext not null,
  email citext,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (username),
  unique (email),
  check (username::text = lower(trim(username::text))),
  check (username::text ~ '^[a-z0-9][a-z0-9._-]{2,47}$'),
  check (email is null or email::text = lower(trim(email::text)))
);

comment on table public.account_login_identifiers is
  'Service-only username and optional account-email mapping. Passwords stay in Supabase Auth.';
comment on column public.account_login_identifiers.email is
  'Optional account sign-in/contact email; independent from athlete profile contact data.';

create trigger account_login_identifiers_set_updated_at
before update on public.account_login_identifiers
for each row execute function public.set_updated_at();

alter table public.account_login_identifiers enable row level security;
revoke all on table public.account_login_identifiers from public, anon, authenticated;
grant all on table public.account_login_identifiers to service_role;

/*
 * Supabase Auth requires an email for password credentials. Username-first
 * accounts therefore use a non-deliverable internal alias in auth.users. Never
 * copy that alias into public profile/contact fields.
 */
create or replace function public.sync_user_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  is_username_account boolean;
  next_email citext;
  next_display_name text;
  next_first_name text;
  next_last_name text;
  next_avatar_url text;
  next_email_verified_at timestamptz;
  next_auth_providers jsonb;
  next_last_sign_in_at timestamptz;
begin
  is_username_account := coalesce(
    new.raw_app_meta_data ->> 'trail_credential_mode',
    ''
  ) = 'username';

  if is_username_account then
    select identifier.email
    into next_email
    from public.account_login_identifiers identifier
    where identifier.user_id = new.id;
    next_email_verified_at := null;
  else
    next_email := nullif(trim(new.email), '')::citext;
    next_email_verified_at := new.email_confirmed_at;
  end if;

  next_display_name := public.auth_user_display_name(new.raw_user_meta_data, new.email);
  next_first_name := nullif(trim(new.raw_user_meta_data ->> 'first_name'), '');
  next_last_name := nullif(trim(new.raw_user_meta_data ->> 'last_name'), '');
  next_avatar_url := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'picture'), '')
  );
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
    email_verified_at = case
      when is_username_account then null
      else coalesce(excluded.email_verified_at, public.user_profiles.email_verified_at)
    end,
    auth_providers_json = excluded.auth_providers_json,
    last_sign_in_at = coalesce(excluded.last_sign_in_at, public.user_profiles.last_sign_in_at),
    updated_at = now();

  return new;
end;
$$;

commit;
