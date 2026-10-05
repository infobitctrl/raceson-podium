alter table public.track_versions
  add column if not exists template_patch_json jsonb not null default '{}'::jsonb;

alter table public.track_versions
  drop constraint if exists track_versions_template_patch_json_object_check;

alter table public.track_versions
  add constraint track_versions_template_patch_json_object_check
  check (jsonb_typeof(template_patch_json) = 'object');

comment on column public.track_versions.template_patch_json is
  'Organizer-only draft changes to track template metadata. Applied atomically when this version is published.';

create or replace function public.publish_track_version_with_template_patch(
  target_track_template_id uuid,
  target_track_version_id uuid,
  target_published_at timestamptz default now()
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  draft_patch jsonb;
begin
  select coalesce(tv.template_patch_json, '{}'::jsonb)
    into draft_patch
  from public.track_versions tv
  where tv.id = target_track_version_id
    and tv.track_template_id = target_track_template_id
  for update;

  if not found then
    raise exception 'Track version not found';
  end if;

  update public.track_templates template
  set
    name = case when draft_patch ? 'name' then draft_patch ->> 'name' else template.name end,
    terrain_type = case when draft_patch ? 'terrain_type' then draft_patch ->> 'terrain_type' else template.terrain_type end,
    notes = case when draft_patch ? 'notes' then draft_patch ->> 'notes' else template.notes end,
    public_overview = case when draft_patch ? 'public_overview' then draft_patch ->> 'public_overview' else template.public_overview end,
    location_label = case when draft_patch ? 'location_label' then draft_patch ->> 'location_label' else template.location_label end,
    season_label = case when draft_patch ? 'season_label' then draft_patch ->> 'season_label' else template.season_label end,
    parking_label = case when draft_patch ? 'parking_label' then draft_patch ->> 'parking_label' else template.parking_label end,
    weather_location_label = case when draft_patch ? 'weather_location_label' then draft_patch ->> 'weather_location_label' else template.weather_location_label end,
    best_time_label = case when draft_patch ? 'best_time_label' then draft_patch ->> 'best_time_label' else template.best_time_label end,
    gallery_items_json = case when draft_patch ? 'gallery_items_json' then coalesce(draft_patch -> 'gallery_items_json', '[]'::jsonb) else template.gallery_items_json end,
    updated_at = target_published_at
  where template.id = target_track_template_id;

  if not found then
    raise exception 'Track template not found';
  end if;

  update public.track_versions
  set published_at = target_published_at
  where id = target_track_version_id
    and track_template_id = target_track_template_id;
end;
$$;

revoke all on function public.publish_track_version_with_template_patch(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.publish_track_version_with_template_patch(uuid, uuid, timestamptz)
  to service_role;
