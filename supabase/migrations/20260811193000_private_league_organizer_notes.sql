-- League organizer notes are operational data. Keep them outside the public
-- league description/read model while retaining them for organizer editing.

create table if not exists public.league_season_private_settings (
  league_season_id uuid primary key references public.league_seasons(id) on delete cascade,
  organizer_notes text,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists league_season_private_settings_set_updated_at
  on public.league_season_private_settings;
create trigger league_season_private_settings_set_updated_at
before update on public.league_season_private_settings
for each row execute function public.set_updated_at();

alter table public.league_season_private_settings enable row level security;
revoke all on table public.league_season_private_settings from anon, authenticated;
grant all on table public.league_season_private_settings to service_role;

comment on table public.league_season_private_settings is
  'Server-only organizer settings that must never enter public league payloads.';
