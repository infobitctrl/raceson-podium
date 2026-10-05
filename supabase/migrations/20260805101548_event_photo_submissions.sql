create table if not exists public.event_photo_submissions (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  event_category_id uuid not null references public.event_categories (id) on delete cascade,
  athlete_profile_id uuid not null references public.athlete_profiles (id) on delete cascade,
  submitted_by_user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique,
  original_file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  moderation_status text not null default 'pending'
    check (moderation_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references auth.users (id) on delete set null,
  check (mime_type in ('image/jpeg', 'image/png', 'image/webp'))
);

create index if not exists event_photo_submissions_edition_status_created_idx
  on public.event_photo_submissions (event_edition_id, moderation_status, created_at desc);

create index if not exists event_photo_submissions_submitter_created_idx
  on public.event_photo_submissions (submitted_by_user_id, created_at desc);

alter table public.event_photo_submissions enable row level security;

revoke all on table public.event_photo_submissions from public, anon;
grant select, delete on table public.event_photo_submissions to authenticated;
grant all on table public.event_photo_submissions to service_role;

create or replace function public.can_submit_event_photo(
  target_event_edition_id uuid,
  target_event_category_id uuid,
  target_athlete_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and target_athlete_profile_id = public.current_primary_athlete_profile_id()
    and exists (
      select 1
      from public.registrations registration
      join public.event_categories category
        on category.id = registration.event_category_id
      where registration.athlete_profile_id = target_athlete_profile_id
        and registration.event_category_id = target_event_category_id
        and category.event_edition_id = target_event_edition_id
        and registration.status in ('pending', 'confirmed')
    )
$$;

revoke all on function public.can_submit_event_photo(uuid, uuid, uuid) from public;
grant execute on function public.can_submit_event_photo(uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists "event photo submitters read own submissions" on public.event_photo_submissions;
create policy "event photo submitters read own submissions"
on public.event_photo_submissions
for select
to authenticated
using (submitted_by_user_id = (select auth.uid()));

drop policy if exists "event photo submitters delete pending submissions" on public.event_photo_submissions;
create policy "event photo submitters delete pending submissions"
on public.event_photo_submissions
for delete
to authenticated
using (
  submitted_by_user_id = (select auth.uid())
  and moderation_status = 'pending'
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'event-community-photos',
  'event-community-photos',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "athletes upload own event photos" on storage.objects;
create policy "athletes upload own event photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'event-community-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.can_submit_event_photo(
    (storage.foldername(name))[2]::uuid,
    (storage.foldername(name))[3]::uuid,
    public.current_primary_athlete_profile_id()
  )
);

drop policy if exists "athletes read own event photos" on storage.objects;
create policy "athletes read own event photos"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'event-community-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "athletes delete own event photos" on storage.objects;
create policy "athletes delete own event photos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'event-community-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
