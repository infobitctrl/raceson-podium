begin;

create type athlete_claim_status as enum (
  'pending',
  'approved',
  'rejected',
  'revoked'
);

create type event_registration_field_type as enum (
  'text',
  'textarea',
  'number',
  'boolean',
  'select',
  'multiselect',
  'date',
  'email',
  'phone'
);

create type athlete_favorite_entity_type as enum (
  'event_edition',
  'track_template',
  'club',
  'athlete_profile'
);

create type athlete_activity_source as enum (
  'manual',
  'gpx_upload',
  'imported'
);

create type track_attempt_source as enum (
  'manual',
  'gpx_upload',
  'strava',
  'imported'
);

create type track_attempt_verification_status as enum (
  'draft',
  'submitted',
  'verified',
  'rejected'
);

create type track_condition_report_status as enum (
  'good',
  'caution',
  'warning',
  'closed'
);

create table user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  email citext,
  display_name text,
  first_name text,
  last_name text,
  locale text not null default 'en',
  timezone text not null default 'Europe/Zagreb',
  primary_athlete_profile_id uuid references athlete_profiles (id) on delete set null,
  status text not null default 'active',
  preferences_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(locale)) > 0),
  check (length(trim(timezone)) > 0)
);

create table athlete_claims (
  id uuid primary key default gen_random_uuid(),
  athlete_profile_id uuid not null references athlete_profiles (id) on delete cascade,
  claimant_user_id uuid not null references user_profiles (user_id) on delete cascade,
  status athlete_claim_status not null default 'pending',
  evidence_json jsonb not null default '{}'::jsonb,
  note text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references user_profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reviewed_at is null or reviewed_at >= submitted_at)
);

create table event_registration_fields (
  id uuid primary key default gen_random_uuid(),
  event_category_id uuid not null references event_categories (id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type event_registration_field_type not null,
  help_text text,
  placeholder text,
  is_required boolean not null default false,
  is_published boolean not null default true,
  position integer not null,
  options_json jsonb not null default '[]'::jsonb,
  validation_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_category_id, field_key),
  unique (event_category_id, position),
  check (position > 0)
);

create table athlete_favorites (
  id uuid primary key default gen_random_uuid(),
  athlete_profile_id uuid not null references athlete_profiles (id) on delete cascade,
  entity_type athlete_favorite_entity_type not null,
  event_edition_id uuid references event_editions (id) on delete cascade,
  track_template_id uuid references track_templates (id) on delete cascade,
  club_id uuid references clubs (id) on delete cascade,
  target_athlete_profile_id uuid references athlete_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(event_edition_id, track_template_id, club_id, target_athlete_profile_id) = 1),
  check (
    (entity_type = 'event_edition' and event_edition_id is not null)
    or (entity_type = 'track_template' and track_template_id is not null)
    or (entity_type = 'club' and club_id is not null)
    or (entity_type = 'athlete_profile' and target_athlete_profile_id is not null)
  ),
  check (
    target_athlete_profile_id is null
    or target_athlete_profile_id <> athlete_profile_id
  )
);

create table athlete_activities (
  id uuid primary key default gen_random_uuid(),
  athlete_profile_id uuid not null references athlete_profiles (id) on delete cascade,
  track_template_id uuid references track_templates (id) on delete set null,
  source athlete_activity_source not null default 'manual',
  title text not null,
  description text,
  performed_at timestamptz not null,
  distance_km numeric(7, 2),
  elevation_gain_m integer,
  elevation_loss_m integer,
  moving_time_seconds integer,
  elapsed_time_seconds integer,
  gpx_storage_path text,
  summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (distance_km is null or distance_km >= 0),
  check (elevation_gain_m is null or elevation_gain_m >= 0),
  check (elevation_loss_m is null or elevation_loss_m >= 0),
  check (moving_time_seconds is null or moving_time_seconds >= 0),
  check (elapsed_time_seconds is null or elapsed_time_seconds >= 0)
);

create table track_render_cache (
  track_version_id uuid primary key references track_versions (id) on delete cascade,
  polyline_json jsonb not null default '[]'::jsonb,
  elevation_profile_json jsonb not null default '[]'::jsonb,
  bounds_json jsonb not null default '{}'::jsonb,
  checkpoints_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table track_attempts (
  id uuid primary key default gen_random_uuid(),
  track_template_id uuid not null references track_templates (id) on delete cascade,
  track_version_id uuid references track_versions (id) on delete set null,
  athlete_profile_id uuid not null references athlete_profiles (id) on delete cascade,
  athlete_activity_id uuid references athlete_activities (id) on delete set null,
  source track_attempt_source not null default 'manual',
  verification_status track_attempt_verification_status not null default 'draft',
  started_at timestamptz not null,
  finished_at timestamptz,
  elapsed_time_ms bigint,
  strava_url text,
  notes text,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (finished_at is null or finished_at >= started_at),
  check (elapsed_time_ms is null or elapsed_time_ms >= 0)
);

create table track_reviews (
  id uuid primary key default gen_random_uuid(),
  track_template_id uuid not null references track_templates (id) on delete cascade,
  athlete_profile_id uuid not null references athlete_profiles (id) on delete cascade,
  rating smallint not null,
  title text,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (track_template_id, athlete_profile_id),
  check (rating between 1 and 5)
);

create table track_condition_reports (
  id uuid primary key default gen_random_uuid(),
  track_template_id uuid not null references track_templates (id) on delete cascade,
  athlete_profile_id uuid not null references athlete_profiles (id) on delete cascade,
  status track_condition_report_status not null,
  title text,
  note text not null,
  reported_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > reported_at)
);

create unique index user_profiles_email_unique_idx
  on user_profiles (email)
  where email is not null;

create index user_profiles_primary_athlete_idx
  on user_profiles (primary_athlete_profile_id);

create index athlete_claims_athlete_status_idx
  on athlete_claims (athlete_profile_id, status, submitted_at desc);

create unique index athlete_claims_open_per_user_idx
  on athlete_claims (athlete_profile_id, claimant_user_id)
  where status in ('pending', 'approved');

create unique index athlete_claims_single_approved_per_athlete_idx
  on athlete_claims (athlete_profile_id)
  where status = 'approved';

create index event_registration_fields_category_published_position_idx
  on event_registration_fields (event_category_id, is_published, position);

create index athlete_favorites_athlete_created_idx
  on athlete_favorites (athlete_profile_id, created_at desc);

create unique index athlete_favorites_event_edition_unique_idx
  on athlete_favorites (athlete_profile_id, event_edition_id)
  where event_edition_id is not null;

create unique index athlete_favorites_track_template_unique_idx
  on athlete_favorites (athlete_profile_id, track_template_id)
  where track_template_id is not null;

create unique index athlete_favorites_club_unique_idx
  on athlete_favorites (athlete_profile_id, club_id)
  where club_id is not null;

create unique index athlete_favorites_athlete_unique_idx
  on athlete_favorites (athlete_profile_id, target_athlete_profile_id)
  where target_athlete_profile_id is not null;

create index athlete_activities_profile_performed_idx
  on athlete_activities (athlete_profile_id, performed_at desc);

create index athlete_activities_track_performed_idx
  on athlete_activities (track_template_id, performed_at desc);

create index track_attempts_athlete_track_started_idx
  on track_attempts (athlete_profile_id, track_template_id, started_at desc);

create index track_attempts_track_verification_started_idx
  on track_attempts (track_template_id, verification_status, started_at desc);

create unique index track_attempts_activity_unique_idx
  on track_attempts (athlete_activity_id)
  where athlete_activity_id is not null;

create index track_reviews_track_created_idx
  on track_reviews (track_template_id, created_at desc);

create index track_condition_reports_track_reported_idx
  on track_condition_reports (track_template_id, reported_at desc);

create trigger user_profiles_set_updated_at
before update on user_profiles
for each row execute function public.set_updated_at();

create trigger athlete_claims_set_updated_at
before update on athlete_claims
for each row execute function public.set_updated_at();

create trigger event_registration_fields_set_updated_at
before update on event_registration_fields
for each row execute function public.set_updated_at();

create trigger athlete_activities_set_updated_at
before update on athlete_activities
for each row execute function public.set_updated_at();

create trigger track_render_cache_set_updated_at
before update on track_render_cache
for each row execute function public.set_updated_at();

create trigger track_attempts_set_updated_at
before update on track_attempts
for each row execute function public.set_updated_at();

create trigger track_reviews_set_updated_at
before update on track_reviews
for each row execute function public.set_updated_at();

create trigger track_condition_reports_set_updated_at
before update on track_condition_reports
for each row execute function public.set_updated_at();

commit;
