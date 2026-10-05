begin;

drop policy if exists club_media_select_own on storage.objects;
create policy club_media_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'club-media'
  and owner_id = (select auth.uid()::text)
);

commit;
