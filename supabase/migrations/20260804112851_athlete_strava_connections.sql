begin;

create table public.athlete_strava_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  athlete_profile_id uuid not null unique references public.athlete_profiles (id) on delete cascade,
  strava_athlete_id bigint not null unique,
  strava_athlete_name text,
  granted_scopes text[] not null default '{}',
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  access_token_expires_at timestamptz not null,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (strava_athlete_id > 0),
  check (encrypted_access_token ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  check (encrypted_refresh_token ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);

create trigger athlete_strava_connections_set_updated_at
before update on public.athlete_strava_connections
for each row execute function public.set_updated_at();

alter table public.athlete_strava_connections enable row level security;

revoke all on table public.athlete_strava_connections from anon, authenticated;
grant select, insert, update, delete on table public.athlete_strava_connections to service_role;

commit;
