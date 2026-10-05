begin;

update storage.buckets
set allowed_mime_types = array[
  'application/gpx+xml',
  'application/xml',
  'text/xml',
  'application/octet-stream'
]
where id = 'track-gpx';

drop policy if exists track_media_select_organization on storage.objects;
create policy track_media_select_organization
on storage.objects
for select
to authenticated
using (
  bucket_id = 'track-media'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then public.can_manage_organization(((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists track_media_insert_organization on storage.objects;
create policy track_media_insert_organization
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'track-media'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then public.can_manage_organization(((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists track_media_update_organization on storage.objects;
create policy track_media_update_organization
on storage.objects
for update
to authenticated
using (
  bucket_id = 'track-media'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then public.can_manage_organization(((storage.foldername(name))[1])::uuid)
    else false
  end
)
with check (
  bucket_id = 'track-media'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then public.can_manage_organization(((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists track_media_delete_organization on storage.objects;
create policy track_media_delete_organization
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'track-media'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then public.can_manage_organization(((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists track_gpx_select_organization on storage.objects;
create policy track_gpx_select_organization
on storage.objects
for select
to authenticated
using (
  bucket_id = 'track-gpx'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then public.can_manage_organization(((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists track_gpx_insert_organization on storage.objects;
create policy track_gpx_insert_organization
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'track-gpx'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then public.can_manage_organization(((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists track_gpx_update_organization on storage.objects;
create policy track_gpx_update_organization
on storage.objects
for update
to authenticated
using (
  bucket_id = 'track-gpx'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then public.can_manage_organization(((storage.foldername(name))[1])::uuid)
    else false
  end
)
with check (
  bucket_id = 'track-gpx'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then public.can_manage_organization(((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists track_gpx_delete_organization on storage.objects;
create policy track_gpx_delete_organization
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'track-gpx'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then public.can_manage_organization(((storage.foldername(name))[1])::uuid)
    else false
  end
);

commit;
