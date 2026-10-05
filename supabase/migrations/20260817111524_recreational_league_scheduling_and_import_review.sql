-- Phase 1 foundation for recreational leagues and reviewed legacy imports.
-- The migration is deliberately additive: existing trail leagues keep their
-- current points model, dates, registrations, and track assignments.

alter table public.league_seasons
  add column if not exists starts_on date,
  add column if not exists ends_on date,
  add column if not exists timezone text not null default 'Europe/Zagreb';

update public.league_seasons season
set
  starts_on = coalesce(season.starts_on, boundaries.starts_on),
  ends_on = coalesce(season.ends_on, boundaries.ends_on)
from (
  select
    round_event.league_season_id,
    min(edition.start_date) as starts_on,
    max(coalesce(edition.end_date, edition.start_date)) as ends_on
  from public.league_round_events round_event
  join public.event_editions edition on edition.id = round_event.event_edition_id
  group by round_event.league_season_id
) boundaries
where season.id = boundaries.league_season_id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'league_seasons_date_range_check'
      and conrelid = 'public.league_seasons'::regclass
  ) then
    alter table public.league_seasons
      add constraint league_seasons_date_range_check
      check (ends_on is null or starts_on is null or ends_on >= starts_on);
  end if;
end
$$;

alter table public.track_templates
  add column if not exists sport_code text;

update public.track_templates
set sport_code = 'trail_running'
where sport_code is null;

alter table public.track_templates
  alter column sport_code set default 'trail_running',
  alter column sport_code set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'track_templates_sport_code_fkey'
      and conrelid = 'public.track_templates'::regclass
  ) then
    alter table public.track_templates
      add constraint track_templates_sport_code_fkey
      foreign key (sport_code)
      references public.sport_disciplines(code)
      on delete restrict;
  end if;
end
$$;

create index if not exists track_templates_organization_sport_idx
  on public.track_templates (organization_id, sport_code, name);

alter table public.league_competitions
  add column if not exists standings_mode text not null default 'points';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'league_competitions_standings_mode_check'
      and conrelid = 'public.league_competitions'::regclass
  ) then
    alter table public.league_competitions
      add constraint league_competitions_standings_mode_check
      check (standings_mode in ('points', 'best_time', 'participation', 'none'));
  end if;
end
$$;

create table if not exists public.event_category_selection_groups (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(trim(name)) between 2 and 120),
  selection_limit smallint not null default 1 check (selection_limit = 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_edition_id, slug),
  unique (id, event_edition_id)
);

alter table public.event_categories
  add column if not exists selection_group_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'event_categories_selection_group_edition_fkey'
      and conrelid = 'public.event_categories'::regclass
  ) then
    alter table public.event_categories
      add constraint event_categories_selection_group_edition_fkey
      foreign key (selection_group_id, event_edition_id)
      references public.event_category_selection_groups(id, event_edition_id)
      on delete restrict;
  end if;
end
$$;

create index if not exists event_categories_selection_group_idx
  on public.event_categories (selection_group_id)
  where selection_group_id is not null;

alter table public.registrations
  add column if not exists event_category_selection_group_id uuid
    references public.event_category_selection_groups(id) on delete restrict,
  add column if not exists birth_year_snapshot smallint;

alter table public.athlete_profiles
  add column if not exists birth_year smallint;

update public.athlete_profiles
set birth_year = extract(year from date_of_birth)::smallint
where birth_year is null
  and date_of_birth is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'athlete_profiles_birth_year_check'
      and conrelid = 'public.athlete_profiles'::regclass
  ) then
    alter table public.athlete_profiles
      add constraint athlete_profiles_birth_year_check
      check (
        birth_year is null
        or birth_year between 1900 and 2200
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'athlete_profiles_birth_date_year_check'
      and conrelid = 'public.athlete_profiles'::regclass
  ) then
    alter table public.athlete_profiles
      add constraint athlete_profiles_birth_date_year_check
      check (
        date_of_birth is null
        or birth_year is null
        or extract(year from date_of_birth)::integer = birth_year
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'registrations_birth_year_snapshot_check'
      and conrelid = 'public.registrations'::regclass
  ) then
    alter table public.registrations
      add constraint registrations_birth_year_snapshot_check
      check (
        birth_year_snapshot is null
        or birth_year_snapshot between 1900 and 2200
      );
  end if;
end
$$;

create or replace function public.normalize_athlete_profile_birth_year()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.date_of_birth is not null and new.birth_year is null then
    new.birth_year := extract(year from new.date_of_birth)::smallint;
  end if;
  return new;
end;
$$;

drop trigger if exists athlete_profiles_normalize_birth_year on public.athlete_profiles;
create trigger athlete_profiles_normalize_birth_year
before insert or update of date_of_birth, birth_year on public.athlete_profiles
for each row execute function public.normalize_athlete_profile_birth_year();

create or replace function public.sync_registration_recreational_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_group_id uuid;
  target_birth_year smallint;
begin
  select category.selection_group_id
  into target_group_id
  from public.event_categories category
  where category.id = new.event_category_id;

  new.event_category_selection_group_id := target_group_id;

  if new.birth_year_snapshot is null then
    select coalesce(
      athlete.birth_year,
      extract(year from athlete.date_of_birth)::smallint
    )
    into target_birth_year
    from public.athlete_profiles athlete
    where athlete.id = new.athlete_profile_id;
    new.birth_year_snapshot := target_birth_year;
  end if;

  return new;
end;
$$;

drop trigger if exists registrations_sync_recreational_identity on public.registrations;
create trigger registrations_sync_recreational_identity
before insert or update of event_category_id, athlete_profile_id, birth_year_snapshot
on public.registrations
for each row execute function public.sync_registration_recreational_identity();

update public.registrations registration
set
  event_category_selection_group_id = category.selection_group_id,
  birth_year_snapshot = coalesce(
    registration.birth_year_snapshot,
    athlete.birth_year,
    extract(year from athlete.date_of_birth)::smallint
  )
from public.event_categories category,
     public.athlete_profiles athlete
where category.id = registration.event_category_id
  and athlete.id = registration.athlete_profile_id;

create unique index if not exists registrations_active_single_selection_group_idx
  on public.registrations (event_category_selection_group_id, athlete_profile_id)
  where event_category_selection_group_id is not null
    and status in ('draft', 'pending', 'confirmed', 'waitlisted');

create or replace function public.sync_selection_group_registrations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.selection_group_id is distinct from old.selection_group_id then
    update public.registrations
    set event_category_selection_group_id = new.selection_group_id
    where event_category_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists event_categories_sync_selection_group on public.event_categories;
create trigger event_categories_sync_selection_group
after update of selection_group_id on public.event_categories
for each row execute function public.sync_selection_group_registrations();

create table if not exists public.league_recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  league_season_id uuid not null references public.league_seasons(id) on delete cascade,
  event_series_id uuid not null references public.event_series(id) on delete restrict,
  track_template_id uuid not null references public.track_templates(id) on delete restrict,
  track_version_id uuid not null references public.track_versions(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 2 and 120),
  valid_from date not null,
  valid_until date not null,
  weekdays smallint[] not null,
  local_start_time time not null,
  timezone text not null default 'Europe/Zagreb',
  registration_open_days_before integer check (registration_open_days_before is null or registration_open_days_before >= 0),
  registration_close_minutes_before integer not null default 0 check (registration_close_minutes_before >= 0),
  location_name text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_season_id, name),
  check (valid_until >= valid_from),
  check (cardinality(weekdays) between 1 and 7),
  check (weekdays <@ array[1,2,3,4,5,6,7]::smallint[])
);

create table if not exists public.league_recurrence_category_templates (
  id uuid primary key default gen_random_uuid(),
  recurrence_rule_id uuid not null references public.league_recurrence_rules(id) on delete cascade,
  league_competition_id uuid not null references public.league_competitions(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(trim(name)) between 2 and 120),
  sport_code text not null references public.sport_disciplines(code) on delete restrict,
  distance_km numeric(7, 3) check (distance_km is null or distance_km > 0),
  selection_group_key text check (
    selection_group_key is null
    or selection_group_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  results_mode text not null default 'standard',
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recurrence_rule_id, slug)
);

create table if not exists public.league_recurrence_overrides (
  id uuid primary key default gen_random_uuid(),
  recurrence_rule_id uuid not null references public.league_recurrence_rules(id) on delete cascade,
  source_date date not null,
  action text not null check (action in ('skip', 'cancel', 'reschedule')),
  replacement_date date,
  replacement_local_start_time time,
  reason text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recurrence_rule_id, source_date),
  check (
    (action = 'reschedule' and replacement_date is not null)
    or (action <> 'reschedule' and replacement_date is null and replacement_local_start_time is null)
  )
);

create table if not exists public.league_recurrence_occurrences (
  id uuid primary key default gen_random_uuid(),
  recurrence_rule_id uuid not null references public.league_recurrence_rules(id) on delete restrict,
  source_date date not null,
  scheduled_date date not null,
  local_start_time time not null,
  state text not null default 'planned'
    check (state in ('planned', 'materialized', 'cancelled', 'skipped', 'failed')),
  event_edition_id uuid references public.event_editions(id) on delete restrict,
  league_round_event_id uuid references public.league_round_events(id) on delete restrict,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recurrence_rule_id, source_date),
  check (
    (state = 'materialized' and event_edition_id is not null and league_round_event_id is not null)
    or state <> 'materialized'
  )
);

create index if not exists league_recurrence_rules_season_idx
  on public.league_recurrence_rules (league_season_id, valid_from, valid_until);
create index if not exists league_recurrence_occurrences_rule_date_idx
  on public.league_recurrence_occurrences (recurrence_rule_id, scheduled_date);

create table if not exists public.legacy_import_review_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  league_season_id uuid references public.league_seasons(id) on delete restrict,
  source_label text not null check (char_length(trim(source_label)) between 2 and 160),
  source_digest_sha256 text,
  status text not null default 'prepared'
    check (status in ('prepared', 'reviewing', 'approved', 'importing', 'completed', 'failed')),
  summary_json jsonb not null default '{}'::jsonb check (jsonb_typeof(summary_json) = 'object'),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_digest_sha256 is null or source_digest_sha256 ~ '^[0-9a-f]{64}$')
);

create table if not exists public.legacy_event_mapping_reviews (
  id uuid primary key default gen_random_uuid(),
  review_batch_id uuid not null references public.legacy_import_review_batches(id) on delete cascade,
  source_table text not null,
  source_id text not null,
  source_record_json jsonb not null check (jsonb_typeof(source_record_json) = 'object'),
  suggested_event_edition_id uuid references public.event_editions(id) on delete set null,
  resolved_event_edition_id uuid references public.event_editions(id) on delete set null,
  decision text not null default 'pending'
    check (decision in ('pending', 'mapped', 'create_new', 'skip')),
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  reasons_json jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons_json) = 'array'),
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_batch_id, source_table, source_id)
);

create table if not exists public.legacy_athlete_match_reviews (
  id uuid primary key default gen_random_uuid(),
  review_batch_id uuid not null references public.legacy_import_review_batches(id) on delete cascade,
  source_table text not null,
  source_id text not null,
  source_record_json jsonb not null check (jsonb_typeof(source_record_json) = 'object'),
  candidate_athlete_profile_ids uuid[] not null default '{}'::uuid[],
  suggested_athlete_profile_id uuid references public.athlete_profiles(id) on delete set null,
  resolved_athlete_profile_id uuid references public.athlete_profiles(id) on delete set null,
  decision text not null default 'pending'
    check (decision in ('pending', 'link_existing', 'create_unclaimed', 'keep_distinct', 'skip')),
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  reasons_json jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons_json) = 'array'),
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_batch_id, source_table, source_id)
);

create index if not exists legacy_event_mapping_reviews_queue_idx
  on public.legacy_event_mapping_reviews (review_batch_id, decision, created_at);
create index if not exists legacy_athlete_match_reviews_queue_idx
  on public.legacy_athlete_match_reviews (review_batch_id, decision, created_at);
create unique index if not exists legacy_import_review_batches_source_digest_idx
  on public.legacy_import_review_batches (organization_id, source_digest_sha256)
  where source_digest_sha256 is not null;

drop trigger if exists set_event_category_selection_groups_updated_at on public.event_category_selection_groups;
create trigger set_event_category_selection_groups_updated_at
before update on public.event_category_selection_groups
for each row execute function public.set_updated_at();

drop trigger if exists set_league_recurrence_rules_updated_at on public.league_recurrence_rules;
create trigger set_league_recurrence_rules_updated_at
before update on public.league_recurrence_rules
for each row execute function public.set_updated_at();

drop trigger if exists set_league_recurrence_category_templates_updated_at on public.league_recurrence_category_templates;
create trigger set_league_recurrence_category_templates_updated_at
before update on public.league_recurrence_category_templates
for each row execute function public.set_updated_at();

drop trigger if exists set_league_recurrence_overrides_updated_at on public.league_recurrence_overrides;
create trigger set_league_recurrence_overrides_updated_at
before update on public.league_recurrence_overrides
for each row execute function public.set_updated_at();

drop trigger if exists set_league_recurrence_occurrences_updated_at on public.league_recurrence_occurrences;
create trigger set_league_recurrence_occurrences_updated_at
before update on public.league_recurrence_occurrences
for each row execute function public.set_updated_at();

drop trigger if exists set_legacy_import_review_batches_updated_at on public.legacy_import_review_batches;
create trigger set_legacy_import_review_batches_updated_at
before update on public.legacy_import_review_batches
for each row execute function public.set_updated_at();

drop trigger if exists set_legacy_event_mapping_reviews_updated_at on public.legacy_event_mapping_reviews;
create trigger set_legacy_event_mapping_reviews_updated_at
before update on public.legacy_event_mapping_reviews
for each row execute function public.set_updated_at();

drop trigger if exists set_legacy_athlete_match_reviews_updated_at on public.legacy_athlete_match_reviews;
create trigger set_legacy_athlete_match_reviews_updated_at
before update on public.legacy_athlete_match_reviews
for each row execute function public.set_updated_at();

alter table public.event_category_selection_groups enable row level security;
alter table public.league_recurrence_rules enable row level security;
alter table public.league_recurrence_category_templates enable row level security;
alter table public.league_recurrence_overrides enable row level security;
alter table public.league_recurrence_occurrences enable row level security;
alter table public.legacy_import_review_batches enable row level security;
alter table public.legacy_event_mapping_reviews enable row level security;
alter table public.legacy_athlete_match_reviews enable row level security;

create policy event_category_selection_groups_select_public_or_org
on public.event_category_selection_groups
for select
to anon, authenticated
using (
  public.is_event_edition_public(event_edition_id)
  or public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
  or public.can_time_organization(public.organization_id_for_event_edition(event_edition_id))
);

revoke all on table public.event_category_selection_groups from public, anon, authenticated;
revoke all on table public.league_recurrence_rules from public, anon, authenticated;
revoke all on table public.league_recurrence_category_templates from public, anon, authenticated;
revoke all on table public.league_recurrence_overrides from public, anon, authenticated;
revoke all on table public.league_recurrence_occurrences from public, anon, authenticated;
revoke all on table public.legacy_import_review_batches from public, anon, authenticated;
revoke all on table public.legacy_event_mapping_reviews from public, anon, authenticated;
revoke all on table public.legacy_athlete_match_reviews from public, anon, authenticated;

grant select on table public.event_category_selection_groups to anon, authenticated;
grant select, insert, update, delete on table public.event_category_selection_groups to service_role;
grant select, insert, update, delete on table public.league_recurrence_rules to service_role;
grant select, insert, update, delete on table public.league_recurrence_category_templates to service_role;
grant select, insert, update, delete on table public.league_recurrence_overrides to service_role;
grant select, insert, update, delete on table public.league_recurrence_occurrences to service_role;
grant select, insert, update, delete on table public.legacy_import_review_batches to service_role;
grant select, insert, update, delete on table public.legacy_event_mapping_reviews to service_role;
grant select, insert, update, delete on table public.legacy_athlete_match_reviews to service_role;

revoke all on function public.normalize_athlete_profile_birth_year() from public, anon, authenticated;
revoke all on function public.sync_registration_recreational_identity() from public, anon, authenticated;
revoke all on function public.sync_selection_group_registrations() from public, anon, authenticated;
grant execute on function public.normalize_athlete_profile_birth_year() to service_role;
grant execute on function public.sync_registration_recreational_identity() to service_role;
grant execute on function public.sync_selection_group_registrations() to service_role;

comment on column public.athlete_profiles.birth_year is
  'Exact legacy birth year when no full date of birth was collected. Do not fabricate a month or day.';
comment on table public.league_recurrence_rules is
  'Organizer-owned weekly schedule definitions. Occurrences are generated explicitly and remain reviewable.';
comment on table public.legacy_athlete_match_reviews is
  'Server-only queue for human review before legacy athletes are linked to or created in canonical profiles.';
