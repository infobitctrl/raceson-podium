alter table track_versions
  add column if not exists published_at timestamptz;

alter table league_seasons
  add column if not exists published_at timestamptz;

create index if not exists track_versions_template_published_idx
  on track_versions (track_template_id, published_at desc, version_number desc);

create index if not exists league_seasons_league_published_idx
  on league_seasons (league_id, published_at desc, year desc);

create or replace function public.is_event_edition_public(target_event_edition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from event_editions ee
    where ee.id = target_event_edition_id
      and ee.published_at is not null
      and ee.status <> 'draft'
  )
$$;

create or replace function public.is_track_template_public(target_track_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from track_versions tv
    where tv.track_template_id = target_track_template_id
      and tv.published_at is not null
  )
$$;

create or replace function public.is_track_version_public(target_track_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from track_versions tv
    where tv.id = target_track_version_id
      and tv.published_at is not null
  )
$$;

create or replace function public.is_league_public(target_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from league_seasons ls
    where ls.league_id = target_league_id
      and ls.published_at is not null
  )
$$;

create or replace function public.is_league_season_public(target_league_season_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from league_seasons ls
    where ls.id = target_league_season_id
      and ls.published_at is not null
  )
$$;
