begin;

alter table public.user_profiles
  add column if not exists cover_image_url text;

commit;
