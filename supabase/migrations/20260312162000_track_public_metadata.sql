alter table track_templates
  add column if not exists public_overview text,
  add column if not exists location_label text,
  add column if not exists season_label text,
  add column if not exists parking_label text,
  add column if not exists weather_location_label text,
  add column if not exists best_time_label text,
  add column if not exists gallery_items_json jsonb not null default '[]'::jsonb;

alter table track_versions
  add column if not exists surface_summary text,
  add column if not exists safety_notes text,
  add column if not exists water_point_count integer not null default 0,
  add column if not exists segment_definitions_json jsonb not null default '[]'::jsonb;
