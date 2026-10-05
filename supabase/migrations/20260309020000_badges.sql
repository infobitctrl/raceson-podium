begin;

create type badge_scope as enum (
  'athlete',
  'track'
);

create type badge_tier as enum (
  'default',
  'bronze',
  'silver',
  'gold'
);

create type badge_award_source as enum (
  'system',
  'manual',
  'result',
  'track_attempt',
  'activity'
);

create table badge_definitions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null,
  scope badge_scope not null default 'athlete',
  tier badge_tier not null default 'default',
  icon_key text,
  track_template_id uuid references track_templates (id) on delete cascade,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  criteria_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(slug)) > 0),
  check (length(trim(name)) > 0),
  check (length(trim(description)) > 0),
  check (sort_order > 0),
  check (
    (scope = 'athlete' and track_template_id is null)
    or (scope = 'track' and track_template_id is not null)
  )
);

create table athlete_badges (
  id uuid primary key default gen_random_uuid(),
  athlete_profile_id uuid not null references athlete_profiles (id) on delete cascade,
  badge_definition_id uuid not null references badge_definitions (id) on delete cascade,
  progress_percent integer not null default 0,
  progress_note text,
  earned_at timestamptz,
  source badge_award_source not null default 'system',
  track_attempt_id uuid references track_attempts (id) on delete set null,
  result_row_id uuid references result_rows (id) on delete set null,
  athlete_activity_id uuid references athlete_activities (id) on delete set null,
  context_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (athlete_profile_id, badge_definition_id),
  check (progress_percent >= 0 and progress_percent <= 100),
  check (earned_at is null or progress_percent = 100),
  check (num_nonnulls(track_attempt_id, result_row_id, athlete_activity_id) <= 1)
);

create index badge_definitions_scope_active_sort_idx
  on badge_definitions (scope, is_active, sort_order);

create index badge_definitions_track_sort_idx
  on badge_definitions (track_template_id, sort_order)
  where track_template_id is not null;

create index athlete_badges_profile_earned_idx
  on athlete_badges (athlete_profile_id, earned_at desc, created_at desc);

create index athlete_badges_definition_progress_idx
  on athlete_badges (badge_definition_id, progress_percent desc, earned_at desc);

create trigger badge_definitions_set_updated_at
before update on badge_definitions
for each row execute function public.set_updated_at();

create trigger athlete_badges_set_updated_at
before update on athlete_badges
for each row execute function public.set_updated_at();

commit;
