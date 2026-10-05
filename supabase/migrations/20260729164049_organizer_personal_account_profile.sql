begin;

alter table public.user_profiles
  add column if not exists date_of_birth date,
  add column if not exists city text,
  add column if not exists country_code text,
  add column if not exists bio text,
  add column if not exists website_url text,
  add column if not exists instagram_url text,
  add column if not exists facebook_url text,
  add column if not exists linkedin_url text,
  add column if not exists youtube_url text,
  add column if not exists tiktok_url text,
  add column if not exists x_url text;

alter table public.user_profiles
  drop constraint if exists user_profiles_country_code_check,
  drop constraint if exists user_profiles_bio_length_check;

alter table public.user_profiles
  add constraint user_profiles_country_code_check
    check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  add constraint user_profiles_bio_length_check
    check (bio is null or length(bio) <= 1200);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'user-avatars',
  'user-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists user_avatars_select_own on storage.objects;
create policy user_avatars_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'user-avatars'
  and owner_id = (select auth.uid()::text)
);

drop policy if exists user_avatars_insert_own on storage.objects;
create policy user_avatars_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'user-avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists user_avatars_update_own on storage.objects;
create policy user_avatars_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'user-avatars'
  and owner_id = (select auth.uid()::text)
)
with check (
  bucket_id = 'user-avatars'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists user_avatars_delete_own on storage.objects;
create policy user_avatars_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'user-avatars'
  and owner_id = (select auth.uid()::text)
);

commit;
