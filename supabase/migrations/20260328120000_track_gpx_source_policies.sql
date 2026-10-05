begin;

drop policy if exists track_version_gpx_sources_select_manage on track_version_gpx_sources;
create policy track_version_gpx_sources_select_manage
on track_version_gpx_sources
for select
using (
  public.can_manage_organization(public.organization_id_for_track_version(track_version_id))
);

drop policy if exists track_version_gpx_sources_insert_manage on track_version_gpx_sources;
create policy track_version_gpx_sources_insert_manage
on track_version_gpx_sources
for insert
with check (
  public.can_manage_organization(public.organization_id_for_track_version(track_version_id))
);

drop policy if exists track_version_gpx_sources_update_manage on track_version_gpx_sources;
create policy track_version_gpx_sources_update_manage
on track_version_gpx_sources
for update
using (
  public.can_manage_organization(public.organization_id_for_track_version(track_version_id))
)
with check (
  public.can_manage_organization(public.organization_id_for_track_version(track_version_id))
);

drop policy if exists track_version_gpx_sources_delete_manage on track_version_gpx_sources;
create policy track_version_gpx_sources_delete_manage
on track_version_gpx_sources
for delete
using (
  public.can_manage_organization(public.organization_id_for_track_version(track_version_id))
);

commit;
