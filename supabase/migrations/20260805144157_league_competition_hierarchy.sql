-- A league season contains competitions. Each round is an event edition, and
-- each competition maps to one race within that event.

create table if not exists public.league_round_events (
  id uuid primary key default gen_random_uuid(),
  league_season_id uuid not null references public.league_seasons(id) on delete cascade,
  event_edition_id uuid not null references public.event_editions(id) on delete restrict,
  round_number integer not null check (round_number > 0),
  public_name text,
  status text not null default 'scheduled'
    check (status in ('draft', 'scheduled', 'registration_open', 'completed', 'cancelled')),
  is_mandatory boolean not null default false,
  is_finale boolean not null default false,
  points_multiplier numeric(8, 3) not null default 1 check (points_multiplier > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_season_id, round_number),
  unique (league_season_id, event_edition_id)
);

create table if not exists public.league_competitions (
  id uuid primary key default gen_random_uuid(),
  league_season_id uuid not null references public.league_seasons(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(trim(name)) between 2 and 120),
  description text,
  scoring_target text not null default 'individual'
    check (scoring_target in ('individual', 'club')),
  result_basis text not null default 'finish_place'
    check (result_basis in ('finish_place', 'elapsed_time', 'age_grade', 'custom_points')),
  display_order integer not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_season_id, slug)
);

create table if not exists public.league_classifications (
  id uuid primary key default gen_random_uuid(),
  league_competition_id uuid not null references public.league_competitions(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(trim(name)) between 2 and 120),
  eligibility_json jsonb not null default '{}'::jsonb
    check (jsonb_typeof(eligibility_json) = 'object'),
  award_depth integer check (award_depth is null or award_depth > 0),
  display_order integer not null default 0,
  status text not null default 'active'
    check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_competition_id, slug)
);

create table if not exists public.league_round_race_mappings (
  id uuid primary key default gen_random_uuid(),
  league_round_event_id uuid not null references public.league_round_events(id) on delete cascade,
  league_competition_id uuid not null references public.league_competitions(id) on delete cascade,
  event_category_id uuid not null references public.event_categories(id) on delete restrict,
  result_basis_override text
    check (result_basis_override is null or result_basis_override in ('finish_place', 'elapsed_time', 'age_grade', 'custom_points')),
  points_multiplier_override numeric(8, 3)
    check (points_multiplier_override is null or points_multiplier_override > 0),
  status text not null default 'mapped'
    check (status in ('draft', 'mapped', 'excluded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_round_event_id, league_competition_id)
);

create table if not exists public.league_scoring_policy_versions (
  id uuid primary key default gen_random_uuid(),
  league_competition_id uuid not null references public.league_competitions(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  name text not null default 'Scoring policy',
  points_table_json jsonb not null
    check (jsonb_typeof(points_table_json) = 'array' and jsonb_array_length(points_table_json) > 0),
  best_n_rounds integer check (best_n_rounds is null or best_n_rounds > 0),
  minimum_rounds integer not null default 1 check (minimum_rounds >= 0),
  tie_break_method text not null default 'best_finish'
    check (tie_break_method in ('best_finish', 'most_wins', 'latest_round', 'last_round_better', 'head_to_head')),
  club_scoring_mode text
    check (club_scoring_mode is null or club_scoring_mode in ('none', 'best_two', 'best_three', 'best_four', 'top_n_athletes', 'all_finishers', 'placement_table')),
  result_status_policy_json jsonb not null default '{"dns":"zero","dnf":"zero","dsq":"excluded"}'::jsonb
    check (jsonb_typeof(result_status_policy_json) = 'object'),
  change_note text,
  created_at timestamptz not null default now(),
  unique (league_competition_id, version_number)
);

alter table public.league_competitions
  add column if not exists current_scoring_policy_version_id uuid
  references public.league_scoring_policy_versions(id) on delete set null;

create index if not exists league_round_events_season_idx
  on public.league_round_events (league_season_id, round_number);
create index if not exists league_competitions_season_idx
  on public.league_competitions (league_season_id, display_order);
create index if not exists league_classifications_competition_idx
  on public.league_classifications (league_competition_id, display_order);
create index if not exists league_round_race_mappings_round_idx
  on public.league_round_race_mappings (league_round_event_id);
create index if not exists league_round_race_mappings_competition_idx
  on public.league_round_race_mappings (league_competition_id);
create index if not exists league_scoring_policy_versions_competition_idx
  on public.league_scoring_policy_versions (league_competition_id, version_number desc);

drop trigger if exists set_league_round_events_updated_at on public.league_round_events;
create trigger set_league_round_events_updated_at
before update on public.league_round_events
for each row execute function public.set_updated_at();

drop trigger if exists set_league_competitions_updated_at on public.league_competitions;
create trigger set_league_competitions_updated_at
before update on public.league_competitions
for each row execute function public.set_updated_at();

drop trigger if exists set_league_classifications_updated_at on public.league_classifications;
create trigger set_league_classifications_updated_at
before update on public.league_classifications
for each row execute function public.set_updated_at();

drop trigger if exists set_league_round_race_mappings_updated_at on public.league_round_race_mappings;
create trigger set_league_round_race_mappings_updated_at
before update on public.league_round_race_mappings
for each row execute function public.set_updated_at();

alter table public.league_round_events enable row level security;
alter table public.league_competitions enable row level security;
alter table public.league_classifications enable row level security;
alter table public.league_round_race_mappings enable row level security;
alter table public.league_scoring_policy_versions enable row level security;

revoke all on table public.league_round_events from public, anon, authenticated;
revoke all on table public.league_competitions from public, anon, authenticated;
revoke all on table public.league_classifications from public, anon, authenticated;
revoke all on table public.league_round_race_mappings from public, anon, authenticated;
revoke all on table public.league_scoring_policy_versions from public, anon, authenticated;

grant select, insert, update, delete on table public.league_round_events to service_role;
grant select, insert, update, delete on table public.league_competitions to service_role;
grant select, insert, update, delete on table public.league_classifications to service_role;
grant select, insert, update, delete on table public.league_round_race_mappings to service_role;
grant select, insert, update, delete on table public.league_scoring_policy_versions to service_role;

-- Preserve every legacy season as one Overall competition. This makes the
-- migration additive and gives existing leagues the new hierarchy immediately.
insert into public.league_competitions (
  league_season_id,
  slug,
  name,
  description,
  scoring_target,
  result_basis,
  display_order,
  status
)
select
  season.id,
  'overall',
  'Overall',
  'All eligible races in this league season.',
  'individual',
  'finish_place',
  0,
  case when season.status = 'draft' then 'draft' else 'active' end
from public.league_seasons season
on conflict (league_season_id, slug) do nothing;

insert into public.league_classifications (
  league_competition_id,
  slug,
  name,
  eligibility_json,
  display_order,
  status
)
select competition.id, 'overall', 'Overall', '{}'::jsonb, 0, 'active'
from public.league_competitions competition
where competition.slug = 'overall'
on conflict (league_competition_id, slug) do nothing;

with unique_legacy_rounds as (
  select distinct on (legacy.league_season_id, legacy.event_edition_id)
    legacy.league_season_id,
    legacy.event_edition_id,
    legacy.round_number,
    legacy.status
  from public.league_rounds legacy
  order by legacy.league_season_id, legacy.event_edition_id, legacy.round_number
), ranked_legacy_rounds as (
  select
    unique_round.*,
    row_number() over (
      partition by unique_round.league_season_id
      order by unique_round.round_number, unique_round.event_edition_id
    )::integer as normalized_round_number
  from unique_legacy_rounds unique_round
)
insert into public.league_round_events (
  league_season_id,
  event_edition_id,
  round_number,
  status
)
select
  legacy.league_season_id,
  legacy.event_edition_id,
  legacy.normalized_round_number,
  case
    when legacy.status = 'completed' then 'completed'
    when legacy.status = 'cancelled' then 'cancelled'
    else 'scheduled'
  end
from ranked_legacy_rounds legacy
on conflict do nothing;

with primary_legacy_races as (
  select distinct on (legacy.league_season_id, legacy.event_edition_id)
    legacy.league_season_id,
    legacy.event_edition_id,
    legacy.event_category_id
  from public.league_rounds legacy
  order by legacy.league_season_id, legacy.event_edition_id, legacy.round_number
)
insert into public.league_round_race_mappings (
  league_round_event_id,
  league_competition_id,
  event_category_id,
  status
)
select
  round_event.id,
  competition.id,
  legacy.event_category_id,
  'mapped'
from primary_legacy_races legacy
join public.league_round_events round_event
  on round_event.league_season_id = legacy.league_season_id
 and round_event.event_edition_id = legacy.event_edition_id
join public.league_competitions competition
  on competition.league_season_id = legacy.league_season_id
 and competition.slug = 'overall'
on conflict (league_round_event_id, league_competition_id) do nothing;

insert into public.league_scoring_policy_versions (
  league_competition_id,
  version_number,
  name,
  points_table_json,
  best_n_rounds,
  minimum_rounds,
  tie_break_method,
  club_scoring_mode,
  change_note
)
select
  competition.id,
  1,
  'Initial scoring policy',
  case
    when jsonb_typeof(rule.points_table_json) = 'array'
      and jsonb_array_length(rule.points_table_json) > 0
    then (
      select jsonb_agg(
        case
          when jsonb_typeof(item.value) = 'object' then to_jsonb(coalesce((item.value ->> 'points')::numeric, 0))
          else item.value
        end
        order by item.ordinality
      )
      from jsonb_array_elements(rule.points_table_json) with ordinality as item(value, ordinality)
    )
    else '[100,80,65,55,50,45,40,36,32,29]'::jsonb
  end,
  rule.best_n_rounds,
  rule.minimum_rounds,
  case
    when rule.tie_break_method in ('best_finish', 'most_wins', 'latest_round', 'last_round_better', 'head_to_head')
      then rule.tie_break_method
    else 'best_finish'
  end,
  case
    when rule.club_scoring_mode in ('none', 'best_two', 'best_three', 'best_four', 'top_n_athletes', 'all_finishers', 'placement_table')
      then rule.club_scoring_mode
    else null
  end,
  'Migrated from the season scoring rules.'
from public.league_competitions competition
join public.league_scoring_rules rule
  on rule.league_season_id = competition.league_season_id
where competition.slug = 'overall'
on conflict (league_competition_id, version_number) do nothing;

-- A season without legacy scoring rules still receives a safe, editable policy.
insert into public.league_scoring_policy_versions (
  league_competition_id,
  version_number,
  name,
  points_table_json,
  best_n_rounds,
  minimum_rounds,
  tie_break_method,
  change_note
)
select
  competition.id,
  1,
  'Initial scoring policy',
  '[100,80,65,55,50,45,40,36,32,29]'::jsonb,
  null,
  1,
  'best_finish',
  'Created during league hierarchy migration.'
from public.league_competitions competition
where not exists (
  select 1
  from public.league_scoring_policy_versions policy
  where policy.league_competition_id = competition.id
)
on conflict (league_competition_id, version_number) do nothing;

update public.league_competitions competition
set current_scoring_policy_version_id = policy.id
from public.league_scoring_policy_versions policy
where policy.league_competition_id = competition.id
  and policy.version_number = 1
  and competition.current_scoring_policy_version_id is null;
