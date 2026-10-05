begin;

create or replace function public.auth_user_display_name(
  raw_user_meta_data jsonb,
  email text
)
returns text
language sql
stable
as $$
  select coalesce(
    nullif(trim(raw_user_meta_data ->> 'display_name'), ''),
    nullif(
      trim(
        concat_ws(
          ' ',
          nullif(trim(raw_user_meta_data ->> 'first_name'), ''),
          nullif(trim(raw_user_meta_data ->> 'last_name'), '')
        )
      ),
      ''
    ),
    nullif(split_part(coalesce(email, ''), '@', 1), ''),
    'Trail Portal User'
  )
$$;

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
begin
  next_email := nullif(trim(new.email), '')::citext;
  next_display_name := public.auth_user_display_name(new.raw_user_meta_data, new.email);
  next_first_name := nullif(trim(new.raw_user_meta_data ->> 'first_name'), '');
  next_last_name := nullif(trim(new.raw_user_meta_data ->> 'last_name'), '');

  insert into public.user_profiles (
    user_id,
    email,
    display_name,
    first_name,
    last_name
  )
  values (
    new.id,
    next_email,
    next_display_name,
    next_first_name,
    next_last_name
  )
  on conflict (user_id) do update
  set
    email = excluded.email,
    display_name = coalesce(nullif(trim(public.user_profiles.display_name), ''), excluded.display_name),
    first_name = coalesce(nullif(trim(public.user_profiles.first_name), ''), excluded.first_name),
    last_name = coalesce(nullif(trim(public.user_profiles.last_name), ''), excluded.last_name),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists sync_user_profile_from_auth_user on auth.users;

create trigger sync_user_profile_from_auth_user
after insert or update of email, raw_user_meta_data
on auth.users
for each row execute function public.sync_user_profile_from_auth_user();

insert into public.user_profiles (
  user_id,
  email,
  display_name,
  first_name,
  last_name
)
select
  au.id,
  nullif(trim(au.email), '')::citext,
  public.auth_user_display_name(au.raw_user_meta_data, au.email),
  nullif(trim(au.raw_user_meta_data ->> 'first_name'), ''),
  nullif(trim(au.raw_user_meta_data ->> 'last_name'), '')
from auth.users au
on conflict (user_id) do update
set
  email = excluded.email,
  display_name = coalesce(nullif(trim(public.user_profiles.display_name), ''), excluded.display_name),
  first_name = coalesce(nullif(trim(public.user_profiles.first_name), ''), excluded.first_name),
  last_name = coalesce(nullif(trim(public.user_profiles.last_name), ''), excluded.last_name),
  updated_at = now();

commit;
