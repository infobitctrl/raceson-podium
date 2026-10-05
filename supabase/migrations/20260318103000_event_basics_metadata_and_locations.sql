alter table event_editions
  add column if not exists public_visibility text not null default 'private',
  add column if not exists cover_image_url text,
  add column if not exists website_url text,
  add column if not exists instagram_url text,
  add column if not exists facebook_url text;

create table if not exists event_locations (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references event_editions (id) on delete cascade,
  location_type text not null,
  label text not null,
  place_label text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null and longitude is null) or (latitude is not null and longitude is not null)),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

create index if not exists event_locations_edition_order_idx
  on event_locations (event_edition_id, display_order, created_at);

drop trigger if exists event_locations_set_updated_at on event_locations;

create trigger event_locations_set_updated_at
before update on event_locations
for each row execute function public.set_updated_at();
