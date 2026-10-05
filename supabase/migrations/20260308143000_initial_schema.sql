begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create type organization_membership_role as enum (
  'owner',
  'admin',
  'staff',
  'timer'
);

create type organization_membership_status as enum (
  'invited',
  'active',
  'suspended',
  'removed'
);

create type event_edition_status as enum (
  'draft',
  'published',
  'registration_open',
  'registration_closed',
  'in_progress',
  'completed',
  'archived'
);

create type event_category_status as enum (
  'draft',
  'published',
  'closed',
  'in_progress',
  'completed'
);

create type registration_status as enum (
  'draft',
  'pending',
  'confirmed',
  'waitlisted',
  'cancelled'
);

create type payment_status as enum (
  'not_required',
  'unpaid',
  'paid',
  'refunded',
  'failed'
);

create type participation_status as enum (
  'not_started',
  'checked_in',
  'dns',
  'started',
  'finished',
  'dnf',
  'dsq'
);

create type result_status as enum (
  'uncomputed',
  'provisional',
  'official',
  'corrected',
  'void'
);

create type checkpoint_type as enum (
  'start',
  'split',
  'finish'
);

create type timing_session_mode as enum (
  'online',
  'offline_buffered'
);

create type timing_session_status as enum (
  'active',
  'paused',
  'closed'
);

create type result_run_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed'
);

create type publication_state as enum (
  'provisional',
  'official',
  'corrected'
);

create type club_membership_status as enum (
  'pending',
  'active',
  'rejected',
  'removed'
);

create type club_verification_status as enum (
  'unverified',
  'verified',
  'merged',
  'flagged'
);

create table athlete_profiles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  first_name text not null,
  last_name text not null,
  display_name text not null,
  gender text,
  date_of_birth date,
  city text,
  country_code char(2),
  primary_email citext,
  is_claimed boolean not null default false,
  claimed_by_user_id uuid,
  status text not null default 'active',
  merged_into_athlete_profile_id uuid references athlete_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table athlete_identities (
  id uuid primary key default gen_random_uuid(),
  athlete_profile_id uuid not null references athlete_profiles (id) on delete cascade,
  user_id uuid,
  identity_type text not null,
  identity_value text not null,
  is_verified boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (identity_type, identity_value)
);

create table athlete_aliases (
  id uuid primary key default gen_random_uuid(),
  athlete_profile_id uuid not null references athlete_profiles (id) on delete cascade,
  alias_type text not null,
  full_name text not null,
  source text,
  confidence numeric(4, 3),
  created_at timestamptz not null default now()
);

create table profile_visibility_settings (
  athlete_profile_id uuid primary key references athlete_profiles (id) on delete cascade,
  show_city boolean not null default false,
  show_clubs boolean not null default true,
  show_history boolean not null default true,
  show_stats boolean not null default true,
  show_rankings boolean not null default false,
  show_age_category boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  legal_name text,
  country_code char(2),
  region text,
  contact_email citext,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null,
  role organization_membership_role not null,
  status organization_membership_status not null default 'invited',
  invited_by_user_id uuid,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table event_series (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  location_name text,
  country_code char(2),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table event_editions (
  id uuid primary key default gen_random_uuid(),
  event_series_id uuid not null references event_series (id) on delete cascade,
  slug text not null,
  name text not null,
  start_date date not null,
  end_date date,
  timezone text not null default 'Europe/Zagreb',
  location_name text,
  registration_open_at timestamptz,
  registration_close_at timestamptz,
  results_visibility text not null default 'public',
  status event_edition_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_series_id, slug),
  check (end_date is null or end_date >= start_date)
);

create table event_rulesets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  ranking_method text not null,
  tie_break_method text,
  checkpoint_policy text,
  club_scoring_mode text,
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table event_categories (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references event_editions (id) on delete cascade,
  slug text not null,
  name text not null,
  distance_km numeric(7, 2),
  elevation_gain_m integer,
  capacity integer,
  registration_fee_cents integer,
  currency char(3),
  start_at timestamptz,
  ruleset_id uuid references event_rulesets (id),
  results_mode text not null default 'standard',
  status event_category_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_edition_id, slug),
  check (capacity is null or capacity > 0),
  check (registration_fee_cents is null or registration_fee_cents >= 0)
);

create table event_documents (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references event_editions (id) on delete cascade,
  document_type text not null,
  title text not null,
  storage_path text not null,
  visibility text not null default 'public',
  created_at timestamptz not null default now()
);

create table track_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  slug text not null,
  name text not null,
  terrain_type text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table track_versions (
  id uuid primary key default gen_random_uuid(),
  track_template_id uuid not null references track_templates (id) on delete cascade,
  version_number integer not null,
  gpx_storage_path text not null,
  distance_km numeric(7, 2),
  elevation_gain_m integer,
  elevation_loss_m integer,
  start_lat numeric(9, 6),
  start_lng numeric(9, 6),
  finish_lat numeric(9, 6),
  finish_lng numeric(9, 6),
  created_at timestamptz not null default now(),
  unique (track_template_id, version_number)
);

create table event_category_track_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_category_id uuid not null unique references event_categories (id) on delete cascade,
  track_template_id uuid not null references track_templates (id),
  track_version_id uuid not null references track_versions (id),
  snapshot_name text not null,
  snapshot_gpx_storage_path text,
  distance_km numeric(7, 2),
  elevation_gain_m integer,
  elevation_loss_m integer,
  snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table checkpoints (
  id uuid primary key default gen_random_uuid(),
  event_category_id uuid not null references event_categories (id) on delete cascade,
  track_snapshot_id uuid not null references event_category_track_snapshots (id) on delete cascade,
  code text not null,
  name text not null,
  checkpoint_type checkpoint_type not null,
  sequence_number integer not null,
  distance_from_start_km numeric(7, 2),
  cutoff_at timestamptz,
  is_mandatory boolean not null default true,
  created_at timestamptz not null default now(),
  unique (event_category_id, code),
  unique (event_category_id, sequence_number)
);

create table clubs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  country_code char(2),
  region text,
  city text,
  description text,
  created_by_athlete_profile_id uuid references athlete_profiles (id),
  status text not null default 'active',
  verification_status club_verification_status not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table club_memberships (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs (id) on delete cascade,
  athlete_profile_id uuid not null references athlete_profiles (id) on delete cascade,
  membership_role text not null default 'member',
  status club_membership_status not null default 'pending',
  is_primary boolean not null default false,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, athlete_profile_id)
);

create table club_posts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs (id) on delete cascade,
  author_athlete_profile_id uuid not null references athlete_profiles (id),
  title text not null,
  body text not null,
  visibility text not null default 'club',
  created_at timestamptz not null default now()
);

create table club_stats (
  club_id uuid primary key references clubs (id) on delete cascade,
  active_member_count integer not null default 0,
  finish_count integer not null default 0,
  distance_total_km numeric(12, 2) not null default 0,
  elevation_total_m bigint not null default 0,
  season_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table registrations (
  id uuid primary key default gen_random_uuid(),
  event_category_id uuid not null references event_categories (id) on delete cascade,
  athlete_profile_id uuid not null references athlete_profiles (id),
  represented_club_id uuid references clubs (id),
  status registration_status not null default 'draft',
  payment_status payment_status not null default 'unpaid',
  participation_status participation_status not null default 'not_started',
  result_status result_status not null default 'uncomputed',
  source text not null default 'direct',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table registration_answers (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations (id) on delete cascade,
  field_key text not null,
  field_label text not null,
  value_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (registration_id, field_key)
);

create table registration_status_history (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations (id) on delete cascade,
  from_status registration_status,
  to_status registration_status not null,
  changed_by_user_id uuid,
  reason text,
  created_at timestamptz not null default now()
);

create table bib_assignments (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations (id) on delete cascade,
  event_edition_id uuid not null references event_editions (id) on delete cascade,
  event_category_id uuid not null references event_categories (id) on delete cascade,
  bib_number text not null,
  scope text not null default 'edition',
  assigned_by_user_id uuid,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (length(trim(bib_number)) > 0)
);

create table checkins (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references registrations (id) on delete cascade,
  checked_in_by_user_id uuid,
  checked_in_at timestamptz not null default now(),
  location_label text,
  notes text,
  created_at timestamptz not null default now()
);

create table timing_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  device_label text,
  device_fingerprint text not null unique,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table timing_sessions (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references event_editions (id) on delete cascade,
  event_category_id uuid references event_categories (id) on delete cascade,
  checkpoint_id uuid references checkpoints (id) on delete set null,
  device_id uuid references timing_devices (id),
  started_by_user_id uuid,
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  mode timing_session_mode not null default 'online',
  status timing_session_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table punch_events (
  id uuid primary key default gen_random_uuid(),
  timing_session_id uuid not null references timing_sessions (id) on delete cascade,
  event_category_id uuid not null references event_categories (id) on delete cascade,
  checkpoint_id uuid not null references checkpoints (id) on delete cascade,
  registration_id uuid references registrations (id) on delete set null,
  athlete_profile_id uuid references athlete_profiles (id) on delete set null,
  bib_number text,
  recorded_at timestamptz not null,
  recorded_at_source text not null default 'device',
  entered_by_user_id uuid,
  device_id uuid references timing_devices (id),
  client_event_id uuid not null,
  ingested_at timestamptz not null default now(),
  is_voided boolean not null default false,
  created_at timestamptz not null default now(),
  unique (client_event_id),
  check (
    registration_id is not null
    or athlete_profile_id is not null
    or bib_number is not null
  )
);

create table punch_event_revisions (
  id uuid primary key default gen_random_uuid(),
  punch_event_id uuid not null references punch_events (id) on delete cascade,
  revision_type text not null,
  reason text,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);

create table participant_statuses (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations (id) on delete cascade,
  status participation_status not null,
  effective_at timestamptz not null,
  reason text,
  created_by_user_id uuid,
  created_at timestamptz not null default now()
);

create table result_runs (
  id uuid primary key default gen_random_uuid(),
  event_category_id uuid not null references event_categories (id) on delete cascade,
  trigger_type text not null,
  trigger_reference_id uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status result_run_status not null default 'queued',
  summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table result_rows (
  id uuid primary key default gen_random_uuid(),
  result_run_id uuid not null references result_runs (id) on delete cascade,
  registration_id uuid not null references registrations (id) on delete cascade,
  athlete_profile_id uuid not null references athlete_profiles (id),
  event_category_id uuid not null references event_categories (id) on delete cascade,
  result_status result_status not null default 'provisional',
  finish_time_ms bigint,
  gap_ms bigint,
  rank_overall integer,
  rank_gender integer,
  rank_age_category integer,
  club_points numeric(10, 2),
  represented_club_id uuid references clubs (id),
  created_at timestamptz not null default now(),
  unique (result_run_id, registration_id)
);

create table result_splits (
  id uuid primary key default gen_random_uuid(),
  result_row_id uuid not null references result_rows (id) on delete cascade,
  checkpoint_id uuid not null references checkpoints (id) on delete cascade,
  sequence_number integer not null,
  elapsed_time_ms bigint,
  split_time_ms bigint,
  rank_at_checkpoint integer,
  created_at timestamptz not null default now(),
  unique (result_row_id, checkpoint_id),
  unique (result_row_id, sequence_number)
);

create table result_publications (
  id uuid primary key default gen_random_uuid(),
  event_category_id uuid not null references event_categories (id) on delete cascade,
  result_run_id uuid not null references result_runs (id) on delete cascade,
  publication_state publication_state not null,
  published_by_user_id uuid,
  published_at timestamptz not null default now(),
  supersedes_publication_id uuid references result_publications (id),
  change_note text,
  created_at timestamptz not null default now(),
  check (
    publication_state <> 'corrected'
    or supersedes_publication_id is not null
  )
);

create table leagues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table league_seasons (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  year integer not null,
  name text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, year)
);

create table league_rounds (
  id uuid primary key default gen_random_uuid(),
  league_season_id uuid not null references league_seasons (id) on delete cascade,
  event_edition_id uuid not null references event_editions (id) on delete cascade,
  event_category_id uuid not null references event_categories (id) on delete cascade,
  round_number integer not null,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_season_id, round_number),
  unique (league_season_id, event_category_id)
);

create table league_scoring_rules (
  id uuid primary key default gen_random_uuid(),
  league_season_id uuid not null unique references league_seasons (id) on delete cascade,
  name text not null,
  points_table_json jsonb not null default '[]'::jsonb,
  best_n_rounds integer,
  minimum_rounds integer,
  tie_break_method text,
  club_scoring_mode text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table league_individual_standings (
  id uuid primary key default gen_random_uuid(),
  league_season_id uuid not null references league_seasons (id) on delete cascade,
  athlete_profile_id uuid not null references athlete_profiles (id) on delete cascade,
  points_total numeric(10, 2) not null default 0,
  scored_rounds integer not null default 0,
  rank_overall integer,
  last_computed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_season_id, athlete_profile_id)
);

create table league_club_standings (
  id uuid primary key default gen_random_uuid(),
  league_season_id uuid not null references league_seasons (id) on delete cascade,
  club_id uuid not null references clubs (id) on delete cascade,
  points_total numeric(10, 2) not null default 0,
  scored_rounds integer not null default 0,
  rank_overall integer,
  last_computed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_season_id, club_id)
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations (id) on delete set null,
  actor_user_id uuid,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table import_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  job_type text not null,
  status text not null default 'queued',
  started_at timestamptz,
  completed_at timestamptz,
  summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table export_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations (id) on delete set null,
  export_type text not null,
  status text not null default 'queued',
  requested_by_user_id uuid,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notification_jobs (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  notification_type text not null,
  status text not null default 'queued',
  payload_json jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index athlete_profiles_name_dob_idx
  on athlete_profiles (last_name, first_name, date_of_birth);

create index athlete_profiles_primary_email_idx
  on athlete_profiles (primary_email);

create index athlete_profiles_merged_into_idx
  on athlete_profiles (merged_into_athlete_profile_id);

create index athlete_identities_athlete_profile_idx
  on athlete_identities (athlete_profile_id);

create index athlete_identities_user_id_idx
  on athlete_identities (user_id);

create index organization_memberships_status_idx
  on organization_memberships (organization_id, status);

create index event_editions_start_date_idx
  on event_editions (start_date);

create index event_editions_status_idx
  on event_editions (status);

create index event_categories_status_idx
  on event_categories (event_edition_id, status);

create index checkpoints_snapshot_idx
  on checkpoints (track_snapshot_id);

create index club_memberships_status_idx
  on club_memberships (club_id, status);

create unique index club_memberships_primary_active_idx
  on club_memberships (athlete_profile_id)
  where is_primary = true and status = 'active';

create unique index registrations_active_per_athlete_category_idx
  on registrations (event_category_id, athlete_profile_id)
  where status in ('draft', 'pending', 'confirmed', 'waitlisted');

create index registrations_status_idx
  on registrations (event_category_id, status);

create index registration_status_history_registration_idx
  on registration_status_history (registration_id, created_at desc);

create unique index bib_assignments_active_edition_scope_idx
  on bib_assignments (event_edition_id, bib_number)
  where revoked_at is null and scope = 'edition';

create unique index bib_assignments_active_category_scope_idx
  on bib_assignments (event_category_id, bib_number)
  where revoked_at is null and scope = 'category';

create index timing_sessions_category_idx
  on timing_sessions (event_category_id, status);

create index punch_events_category_time_idx
  on punch_events (event_category_id, recorded_at);

create index punch_events_checkpoint_time_idx
  on punch_events (checkpoint_id, recorded_at);

create index punch_events_registration_idx
  on punch_events (registration_id);

create index participant_statuses_registration_idx
  on participant_statuses (registration_id, effective_at desc);

create index result_runs_category_status_idx
  on result_runs (event_category_id, status, started_at desc);

create index result_rows_category_rank_idx
  on result_rows (event_category_id, rank_overall);

create index result_publications_category_published_idx
  on result_publications (event_category_id, published_at desc);

create index league_rounds_season_edition_idx
  on league_rounds (league_season_id, event_edition_id);

create index audit_log_org_created_idx
  on audit_log (organization_id, created_at desc);

create trigger athlete_profiles_set_updated_at
before update on athlete_profiles
for each row execute function public.set_updated_at();

create trigger profile_visibility_settings_set_updated_at
before update on profile_visibility_settings
for each row execute function public.set_updated_at();

create trigger organizations_set_updated_at
before update on organizations
for each row execute function public.set_updated_at();

create trigger organization_memberships_set_updated_at
before update on organization_memberships
for each row execute function public.set_updated_at();

create trigger event_series_set_updated_at
before update on event_series
for each row execute function public.set_updated_at();

create trigger event_editions_set_updated_at
before update on event_editions
for each row execute function public.set_updated_at();

create trigger event_rulesets_set_updated_at
before update on event_rulesets
for each row execute function public.set_updated_at();

create trigger event_categories_set_updated_at
before update on event_categories
for each row execute function public.set_updated_at();

create trigger track_templates_set_updated_at
before update on track_templates
for each row execute function public.set_updated_at();

create trigger clubs_set_updated_at
before update on clubs
for each row execute function public.set_updated_at();

create trigger club_memberships_set_updated_at
before update on club_memberships
for each row execute function public.set_updated_at();

create trigger registrations_set_updated_at
before update on registrations
for each row execute function public.set_updated_at();

create trigger timing_devices_set_updated_at
before update on timing_devices
for each row execute function public.set_updated_at();

create trigger timing_sessions_set_updated_at
before update on timing_sessions
for each row execute function public.set_updated_at();

create trigger leagues_set_updated_at
before update on leagues
for each row execute function public.set_updated_at();

create trigger league_seasons_set_updated_at
before update on league_seasons
for each row execute function public.set_updated_at();

create trigger league_rounds_set_updated_at
before update on league_rounds
for each row execute function public.set_updated_at();

create trigger league_scoring_rules_set_updated_at
before update on league_scoring_rules
for each row execute function public.set_updated_at();

create trigger league_individual_standings_set_updated_at
before update on league_individual_standings
for each row execute function public.set_updated_at();

create trigger league_club_standings_set_updated_at
before update on league_club_standings
for each row execute function public.set_updated_at();

create trigger import_jobs_set_updated_at
before update on import_jobs
for each row execute function public.set_updated_at();

create trigger export_jobs_set_updated_at
before update on export_jobs
for each row execute function public.set_updated_at();

create trigger notification_jobs_set_updated_at
before update on notification_jobs
for each row execute function public.set_updated_at();

commit;
