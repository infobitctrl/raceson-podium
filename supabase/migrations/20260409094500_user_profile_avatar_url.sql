begin;

alter table public.user_profiles
  add column if not exists avatar_url text;

update public.user_profiles up
set avatar_url = coalesce(
  nullif(trim(au.raw_user_meta_data ->> 'avatar_url'), ''),
  nullif(trim(au.raw_user_meta_data ->> 'picture'), '')
)
from auth.users au
where up.user_id = au.id
  and up.avatar_url is null
  and coalesce(
    nullif(trim(au.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(trim(au.raw_user_meta_data ->> 'picture'), '')
  ) is not null;

commit;
