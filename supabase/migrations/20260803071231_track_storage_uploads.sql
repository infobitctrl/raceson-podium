begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'track-media',
    'track-media',
    true,
    20971520,
    array['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'track-gpx',
    'track-gpx',
    false,
    52428800,
    array['application/gpx+xml']
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.track_version_gpx_sources
  add column if not exists storage_path text;

alter table public.track_version_gpx_sources
  alter column gpx_xml drop not null;

alter table public.track_version_gpx_sources
  drop constraint if exists track_version_gpx_sources_content_check;

alter table public.track_version_gpx_sources
  add constraint track_version_gpx_sources_content_check
  check (gpx_xml is not null or storage_path is not null);

create unique index if not exists track_version_gpx_sources_storage_path_uidx
  on public.track_version_gpx_sources (storage_path)
  where storage_path is not null;

drop policy if exists track_media_select_organization on storage.objects;
create policy track_media_select_organization
on storage.objects
for select
to authenticated
using (
  bucket_id = 'track-media'
  and exists (
    select 1
    from public.organizations organization
    where organization.id::text = (storage.foldername(name))[1]
      and public.can_manage_organization(organization.id)
  )
);

drop policy if exists track_media_insert_organization on storage.objects;
create policy track_media_insert_organization
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'track-media'
  and exists (
    select 1
    from public.organizations organization
    where organization.id::text = (storage.foldername(name))[1]
      and public.can_manage_organization(organization.id)
  )
);

drop policy if exists track_media_update_organization on storage.objects;
create policy track_media_update_organization
on storage.objects
for update
to authenticated
using (
  bucket_id = 'track-media'
  and exists (
    select 1
    from public.organizations organization
    where organization.id::text = (storage.foldername(name))[1]
      and public.can_manage_organization(organization.id)
  )
)
with check (
  bucket_id = 'track-media'
  and exists (
    select 1
    from public.organizations organization
    where organization.id::text = (storage.foldername(name))[1]
      and public.can_manage_organization(organization.id)
  )
);

drop policy if exists track_media_delete_organization on storage.objects;
create policy track_media_delete_organization
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'track-media'
  and exists (
    select 1
    from public.organizations organization
    where organization.id::text = (storage.foldername(name))[1]
      and public.can_manage_organization(organization.id)
  )
);

drop policy if exists track_gpx_select_organization on storage.objects;
create policy track_gpx_select_organization
on storage.objects
for select
to authenticated
using (
  bucket_id = 'track-gpx'
  and exists (
    select 1
    from public.organizations organization
    where organization.id::text = (storage.foldername(name))[1]
      and public.can_manage_organization(organization.id)
  )
);

drop policy if exists track_gpx_insert_organization on storage.objects;
create policy track_gpx_insert_organization
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'track-gpx'
  and exists (
    select 1
    from public.organizations organization
    where organization.id::text = (storage.foldername(name))[1]
      and public.can_manage_organization(organization.id)
  )
);

drop policy if exists track_gpx_update_organization on storage.objects;
create policy track_gpx_update_organization
on storage.objects
for update
to authenticated
using (
  bucket_id = 'track-gpx'
  and exists (
    select 1
    from public.organizations organization
    where organization.id::text = (storage.foldername(name))[1]
      and public.can_manage_organization(organization.id)
  )
)
with check (
  bucket_id = 'track-gpx'
  and exists (
    select 1
    from public.organizations organization
    where organization.id::text = (storage.foldername(name))[1]
      and public.can_manage_organization(organization.id)
  )
);

drop policy if exists track_gpx_delete_organization on storage.objects;
create policy track_gpx_delete_organization
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'track-gpx'
  and exists (
    select 1
    from public.organizations organization
    where organization.id::text = (storage.foldername(name))[1]
      and public.can_manage_organization(organization.id)
  )
);

commit;
