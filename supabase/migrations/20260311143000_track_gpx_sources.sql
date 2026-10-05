create table if not exists track_version_gpx_sources (
  track_version_id uuid primary key references track_versions (id) on delete cascade,
  file_name text not null,
  mime_type text not null default 'application/gpx+xml',
  gpx_xml text not null,
  byte_size integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (byte_size >= 0)
);

alter table track_version_gpx_sources enable row level security;

drop trigger if exists track_version_gpx_sources_set_updated_at on track_version_gpx_sources;
create trigger track_version_gpx_sources_set_updated_at
before update on track_version_gpx_sources
for each row execute function public.set_updated_at();
