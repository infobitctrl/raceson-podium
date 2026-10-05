/*
 * Phase 5 — governed clubs and versioned league standings.
 *
 * Historical registrations and result rows retain the represented club that
 * was recorded for the race. Club aliases and merges provide canonical
 * discovery without rewriting those facts.
 *
 * League rounds bind exact immutable result publications. Scoring rules and
 * standings are immutable versions, allowing a corrected race publication to
 * produce a new, explainable standings lineage.
 */

insert into public.organization_permission_catalog (
  permission_code,
  area,
  title,
  description,
  sensitivity,
  staff_default,
  timer_default
)
values
  (
    'clubs.manage',
    'clubs',
    'Manage clubs',
    'Manage club verification, aliases, rosters, and merge cases.',
    'elevated',
    true,
    false
  ),
  (
    'clubs.verify',
    'clubs',
    'Verify clubs',
    'Decide club identity and verification evidence.',
    'restricted',
    false,
    false
  ),
  (
    'identity.resolve',
    'identity',
    'Resolve identity',
    'Decide historical athlete and club identity claims and merges.',
    'restricted',
    false,
    false
  )
on conflict (permission_code) do nothing;
create table public.club_aliases (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  alias_name text not null,
  normalized_alias text not null,
  alias_type text not null default 'historical',
  country_code char(2),
  source_reference text,
  created_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (normalized_alias, country_code),
  check (length(trim(alias_name)) between 2 and 160),
  check (normalized_alias ~ '^[a-z0-9][a-z0-9 -]{1,159}$'),
  check (alias_type in ('historical', 'abbreviation', 'import', 'transliteration', 'merged'))
);
create table public.club_verification_cases (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  case_number bigint generated always as identity unique,
  case_state text not null default 'pending',
  evidence_json jsonb not null,
  evidence_digest_sha256 text not null,
  submitted_by_user_id uuid not null,
  submitted_at timestamptz not null default clock_timestamp(),
  decided_by_user_id uuid,
  decided_at timestamptz,
  decision_note text,
  client_event_id uuid not null unique,
  check (case_state in ('pending', 'verified', 'rejected', 'needs_information', 'cancelled')),
  check (jsonb_typeof(evidence_json) = 'object'),
  check (evidence_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (
    case_state in ('pending', 'cancelled')
    or (
      decided_by_user_id is not null
      and decided_at is not null
      and length(trim(decision_note)) > 0
    )
  )
);
create unique index club_verification_cases_pending_idx
  on public.club_verification_cases (club_id)
  where case_state in ('pending', 'needs_information');
create table public.club_verification_events (
  id uuid primary key default gen_random_uuid(),
  club_verification_case_id uuid not null
    references public.club_verification_cases (id) on delete restrict,
  sequence_number integer not null,
  event_type text not null,
  note text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid not null,
  client_event_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (club_verification_case_id, sequence_number),
  check (
    event_type in (
      'submitted', 'evidence_added', 'information_requested',
      'verified', 'rejected', 'cancelled'
    )
  ),
  check (length(trim(note)) > 0),
  check (jsonb_typeof(metadata_json) = 'object')
);
create table public.club_membership_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  athlete_profile_id uuid not null references public.athlete_profiles (id) on delete restrict,
  membership_id uuid references public.club_memberships (id) on delete restrict,
  sequence_number integer not null,
  event_type text not null,
  from_status public.club_membership_status,
  to_status public.club_membership_status,
  membership_role text not null,
  effective_at timestamptz not null,
  note text not null,
  actor_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (club_id, athlete_profile_id, sequence_number),
  check (event_type in ('invited', 'requested', 'activated', 'role_changed', 'made_primary', 'removed', 'rejected')),
  check (length(trim(membership_role)) > 0),
  check (length(trim(note)) > 0)
);
create table public.club_roster_snapshots (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  version_number integer not null,
  member_count integer not null,
  roster_digest_sha256 text not null,
  reason text not null,
  created_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (club_id, version_number),
  check (version_number > 0),
  check (member_count >= 0),
  check (roster_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (length(trim(reason)) > 0)
);
create table public.club_roster_snapshot_members (
  club_roster_snapshot_id uuid not null
    references public.club_roster_snapshots (id) on delete restrict,
  athlete_profile_id uuid not null references public.athlete_profiles (id) on delete restrict,
  membership_role text not null,
  is_primary boolean not null,
  joined_at timestamptz,
  primary key (club_roster_snapshot_id, athlete_profile_id)
);
create table public.club_identity_merges (
  id uuid primary key default gen_random_uuid(),
  source_club_id uuid not null references public.clubs (id) on delete restrict,
  canonical_club_id uuid not null references public.clubs (id) on delete restrict,
  merge_state text not null default 'proposed',
  reason text not null,
  evidence_json jsonb not null default '{}'::jsonb,
  proposed_by_user_id uuid not null,
  decided_by_user_id uuid,
  decided_at timestamptz,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  check (source_club_id <> canonical_club_id),
  check (merge_state in ('proposed', 'approved', 'rejected', 'cancelled')),
  check (length(trim(reason)) > 0),
  check (jsonb_typeof(evidence_json) = 'object'),
  check (
    merge_state = 'proposed'
    or (decided_by_user_id is not null and decided_at is not null)
  )
);
create unique index club_identity_merges_approved_source_idx
  on public.club_identity_merges (source_club_id)
  where merge_state = 'approved';
create table public.league_scoring_rule_versions (
  id uuid primary key default gen_random_uuid(),
  league_season_id uuid not null references public.league_seasons (id) on delete restrict,
  version_number integer not null,
  name text not null,
  points_table_json jsonb not null,
  best_n_rounds integer,
  minimum_rounds integer not null default 1,
  tie_break_method text not null default 'most_wins',
  club_members_per_round integer not null default 3,
  eligibility_json jsonb not null default '{}'::jsonb,
  scoring_digest_sha256 text not null,
  created_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (league_season_id, version_number),
  check (length(trim(name)) > 0),
  check (jsonb_typeof(points_table_json) = 'array' and jsonb_array_length(points_table_json) > 0),
  check (best_n_rounds is null or best_n_rounds > 0),
  check (minimum_rounds > 0),
  check (club_members_per_round between 1 and 20),
  check (tie_break_method in ('most_wins', 'best_finish', 'last_round')),
  check (jsonb_typeof(eligibility_json) = 'object'),
  check (scoring_digest_sha256 ~ '^[0-9a-f]{64}$')
);
create table public.league_round_source_versions (
  id uuid primary key default gen_random_uuid(),
  league_round_id uuid not null references public.league_rounds (id) on delete restrict,
  version_number integer not null,
  result_publication_id uuid not null references public.result_publications (id) on delete restrict,
  publication_state public.publication_state not null,
  publication_digest_sha256 text not null,
  source_digest_sha256 text not null,
  change_note text not null,
  selected_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (league_round_id, version_number),
  unique (league_round_id, result_publication_id),
  check (publication_state in ('official', 'corrected')),
  check (publication_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (source_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (length(trim(change_note)) > 0)
);
create table public.league_standings_versions (
  id uuid primary key default gen_random_uuid(),
  league_season_id uuid not null references public.league_seasons (id) on delete restrict,
  version_number integer not null,
  supersedes_standings_version_id uuid
    references public.league_standings_versions (id) on delete restrict,
  scoring_rule_version_id uuid not null
    references public.league_scoring_rule_versions (id) on delete restrict,
  publication_state text not null default 'official',
  source_manifest_json jsonb not null,
  input_digest_sha256 text not null,
  standings_digest_sha256 text,
  individual_count integer not null default 0,
  club_count integer not null default 0,
  change_note text not null,
  generated_by_user_id uuid not null,
  client_event_id uuid not null unique,
  generated_at timestamptz not null default clock_timestamp(),
  unique (league_season_id, version_number),
  check (publication_state in ('official', 'corrected')),
  check (jsonb_typeof(source_manifest_json) = 'object'),
  check (input_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (standings_digest_sha256 is null or standings_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (individual_count >= 0 and club_count >= 0),
  check (length(trim(change_note)) > 0),
  check (
    (publication_state = 'official' and supersedes_standings_version_id is null)
    or publication_state = 'corrected'
  )
);
create table public.league_individual_standing_rows (
  id uuid primary key default gen_random_uuid(),
  league_standings_version_id uuid not null
    references public.league_standings_versions (id) on delete restrict,
  athlete_profile_id uuid not null references public.athlete_profiles (id) on delete restrict,
  represented_club_id uuid references public.clubs (id) on delete restrict,
  points_total numeric(12, 2) not null,
  scored_rounds integer not null,
  eligible boolean not null,
  rank_overall integer,
  wins integer not null default 0,
  best_finish integer,
  last_round_points numeric(12, 2) not null default 0,
  contributions_json jsonb not null,
  tie_break_json jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (league_standings_version_id, athlete_profile_id),
  check (points_total >= 0),
  check (scored_rounds >= 0 and wins >= 0),
  check (jsonb_typeof(contributions_json) = 'array'),
  check (jsonb_typeof(tie_break_json) = 'object')
);
create table public.league_club_standing_rows (
  id uuid primary key default gen_random_uuid(),
  league_standings_version_id uuid not null
    references public.league_standings_versions (id) on delete restrict,
  club_id uuid not null references public.clubs (id) on delete restrict,
  points_total numeric(12, 2) not null,
  scored_rounds integer not null,
  rank_overall integer,
  wins integer not null default 0,
  contributions_json jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (league_standings_version_id, club_id),
  check (points_total >= 0),
  check (scored_rounds >= 0 and wins >= 0),
  check (jsonb_typeof(contributions_json) = 'array')
);
create table public.league_standings_events (
  id uuid primary key default gen_random_uuid(),
  league_season_id uuid not null references public.league_seasons (id) on delete restrict,
  league_standings_version_id uuid references public.league_standings_versions (id) on delete restrict,
  event_type text not null,
  note text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid not null,
  client_event_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  check (event_type in ('rules_published', 'round_source_bound', 'standings_published', 'standings_stale')),
  check (length(trim(note)) > 0),
  check (jsonb_typeof(metadata_json) = 'object')
);
alter table public.league_seasons
  add column if not exists current_scoring_rule_version_id uuid
    references public.league_scoring_rule_versions (id) on delete restrict,
  add column if not exists current_standings_version_id uuid
    references public.league_standings_versions (id) on delete restrict,
  add column if not exists standings_stale_since timestamptz;
alter table public.league_rounds
  add column if not exists current_source_version_id uuid
    references public.league_round_source_versions (id) on delete restrict,
  add column if not exists current_result_publication_id uuid
    references public.result_publications (id) on delete restrict;
create index club_aliases_club_idx on public.club_aliases (club_id);
create index club_membership_events_roster_idx
  on public.club_membership_events (club_id, athlete_profile_id, effective_at desc);
create index league_round_sources_publication_idx
  on public.league_round_source_versions (result_publication_id);
create index league_individual_rows_rank_idx
  on public.league_individual_standing_rows (league_standings_version_id, rank_overall);
create index league_club_rows_rank_idx
  on public.league_club_standing_rows (league_standings_version_id, rank_overall);
create or replace function public.reject_phase5_immutable_mutation()
returns trigger
language plpgsql
set search_path = ''
as $immutable$
begin
  raise exception using errcode = '55000', message = 'phase5_evidence_is_append_only';
end
$immutable$;
create trigger club_aliases_immutable
before update or delete on public.club_aliases
for each row execute function public.reject_phase5_immutable_mutation();
create trigger club_verification_events_immutable
before update or delete on public.club_verification_events
for each row execute function public.reject_phase5_immutable_mutation();
create trigger club_membership_events_immutable
before update or delete on public.club_membership_events
for each row execute function public.reject_phase5_immutable_mutation();
create trigger club_roster_snapshots_immutable
before update or delete on public.club_roster_snapshots
for each row execute function public.reject_phase5_immutable_mutation();
create trigger club_roster_snapshot_members_immutable
before update or delete on public.club_roster_snapshot_members
for each row execute function public.reject_phase5_immutable_mutation();
create trigger league_scoring_rule_versions_immutable
before update or delete on public.league_scoring_rule_versions
for each row execute function public.reject_phase5_immutable_mutation();
create trigger league_round_source_versions_immutable
before update or delete on public.league_round_source_versions
for each row execute function public.reject_phase5_immutable_mutation();
create or replace function public.guard_league_standings_version_finalization()
returns trigger
language plpgsql
set search_path = ''
as $guard$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'phase5_evidence_is_append_only';
  end if;
  if old.standings_digest_sha256 is not null
     or new.id <> old.id
     or new.league_season_id <> old.league_season_id
     or new.version_number <> old.version_number
     or new.supersedes_standings_version_id is distinct from old.supersedes_standings_version_id
     or new.scoring_rule_version_id <> old.scoring_rule_version_id
     or new.publication_state <> old.publication_state
     or new.source_manifest_json <> old.source_manifest_json
     or new.input_digest_sha256 <> old.input_digest_sha256
     or new.change_note <> old.change_note
     or new.generated_by_user_id <> old.generated_by_user_id
     or new.client_event_id <> old.client_event_id
     or new.generated_at <> old.generated_at
     or new.standings_digest_sha256 is null then
    raise exception using errcode = '55000', message = 'league_standings_version_is_immutable';
  end if;
  return new;
end
$guard$;
create trigger league_standings_versions_finalization_guard
before update or delete on public.league_standings_versions
for each row execute function public.guard_league_standings_version_finalization();
create trigger league_individual_standing_rows_immutable
before update or delete on public.league_individual_standing_rows
for each row execute function public.reject_phase5_immutable_mutation();
create trigger league_club_standing_rows_immutable
before update or delete on public.league_club_standing_rows
for each row execute function public.reject_phase5_immutable_mutation();
create trigger league_standings_events_immutable
before update or delete on public.league_standings_events
for each row execute function public.reject_phase5_immutable_mutation();
create or replace function public.service_submit_club_verification(
  p_organization_id uuid,
  p_club_id uuid,
  p_actor_user_id uuid,
  p_evidence_json jsonb,
  p_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $submit$
declare
  club_row public.clubs%rowtype;
  replayed_case public.club_verification_cases%rowtype;
  created_case public.club_verification_cases%rowtype;
  evidence_digest text;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'clubs.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'club_manage_permission_required';
  end if;
  if jsonb_typeof(coalesce(p_evidence_json, 'null'::jsonb)) <> 'object'
     or coalesce(p_evidence_json, '{}'::jsonb) = '{}'::jsonb
     or nullif(trim(p_note), '') is null then
    raise exception using errcode = '22023', message = 'club_verification_evidence_invalid';
  end if;

  select verification.*
  into replayed_case
  from public.club_verification_cases verification
  where verification.client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'caseId', replayed_case.id,
      'caseState', replayed_case.case_state,
      'replayed', true
    );
  end if;

  select club.*
  into club_row
  from public.clubs club
  where club.id = p_club_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'club_not_found';
  end if;
  if club_row.organization_id is distinct from p_organization_id then
    raise exception using errcode = '42501', message = 'club_organization_mismatch';
  end if;
  if club_row.verification_status = 'verified' then
    raise exception using errcode = '55000', message = 'club_already_verified';
  end if;

  evidence_digest := encode(
    public.digest(convert_to(p_evidence_json::text, 'utf8'), 'sha256'),
    'hex'
  );

  insert into public.club_verification_cases (
    club_id,
    evidence_json,
    evidence_digest_sha256,
    submitted_by_user_id,
    client_event_id
  )
  values (
    p_club_id,
    p_evidence_json,
    evidence_digest,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_case;

  insert into public.club_verification_events (
    club_verification_case_id,
    sequence_number,
    event_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    created_case.id,
    1,
    'submitted',
    trim(p_note),
    jsonb_build_object('evidenceDigestSha256', evidence_digest),
    p_actor_user_id,
    p_client_event_id
  );

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'club_verification_case',
    created_case.id,
    'club.verification_submitted',
    jsonb_build_object('clubId', p_club_id, 'evidenceDigestSha256', evidence_digest)
  );

  return jsonb_build_object(
    'caseId', created_case.id,
    'caseNumber', created_case.case_number,
    'caseState', created_case.case_state,
    'evidenceDigestSha256', evidence_digest,
    'replayed', false
  );
end
$submit$;
create or replace function public.service_decide_club_verification(
  p_organization_id uuid,
  p_case_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $decide$
declare
  case_row public.club_verification_cases%rowtype;
  club_row public.clubs%rowtype;
  resolved_event_type text;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'clubs.verify', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'club_verify_permission_required';
  end if;
  if p_decision not in ('verified', 'rejected', 'needs_information')
     or nullif(trim(p_note), '') is null then
    raise exception using errcode = '22023', message = 'club_verification_decision_invalid';
  end if;

  if exists (
    select 1 from public.club_verification_events event
    where event.client_event_id = p_client_event_id
  ) then
    select verification.*
    into case_row
    from public.club_verification_cases verification
    where verification.id = p_case_id;
    return jsonb_build_object(
      'caseId', case_row.id,
      'caseState', case_row.case_state,
      'replayed', true
    );
  end if;

  select verification.*
  into case_row
  from public.club_verification_cases verification
  where verification.id = p_case_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'club_verification_case_not_found';
  end if;
  if case_row.case_state not in ('pending', 'needs_information') then
    raise exception using errcode = '55000', message = 'club_verification_case_closed';
  end if;

  select club.*
  into club_row
  from public.clubs club
  where club.id = case_row.club_id
  for update;
  if club_row.organization_id is distinct from p_organization_id then
    raise exception using errcode = '42501', message = 'club_organization_mismatch';
  end if;

  update public.club_verification_cases verification
  set
    case_state = p_decision,
    decided_by_user_id = p_actor_user_id,
    decided_at = clock_timestamp(),
    decision_note = trim(p_note)
  where verification.id = p_case_id
  returning * into case_row;

  if p_decision = 'verified' then
    update public.clubs club
    set verification_status = 'verified', updated_at = clock_timestamp()
    where club.id = case_row.club_id;
  elsif p_decision = 'rejected' then
    update public.clubs club
    set verification_status = 'flagged', updated_at = clock_timestamp()
    where club.id = case_row.club_id;
  end if;

  resolved_event_type := case
    when p_decision = 'needs_information' then 'information_requested'
    else p_decision
  end;

  insert into public.club_verification_events (
    club_verification_case_id,
    sequence_number,
    event_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  select
    case_row.id,
    coalesce(max(event.sequence_number), 0) + 1,
    resolved_event_type,
    trim(p_note),
    jsonb_build_object('decision', p_decision),
    p_actor_user_id,
    p_client_event_id
  from public.club_verification_events event
  where event.club_verification_case_id = case_row.id;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'club_verification_case',
    case_row.id,
    'club.verification_decided',
    jsonb_build_object('clubId', case_row.club_id, 'decision', p_decision)
  );

  return jsonb_build_object(
    'caseId', case_row.id,
    'clubId', case_row.club_id,
    'caseState', case_row.case_state,
    'replayed', false
  );
end
$decide$;
create or replace function public.service_record_club_membership(
  p_organization_id uuid,
  p_club_id uuid,
  p_athlete_profile_id uuid,
  p_actor_user_id uuid,
  p_event_type text,
  p_membership_role text,
  p_is_primary boolean,
  p_effective_at timestamptz,
  p_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $membership$
declare
  club_row public.clubs%rowtype;
  membership_row public.club_memberships%rowtype;
  resolved_status public.club_membership_status;
  previous_status public.club_membership_status;
  next_sequence integer;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'clubs.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'club_manage_permission_required';
  end if;
  if p_event_type not in ('invited', 'requested', 'activated', 'role_changed', 'made_primary', 'removed', 'rejected')
     or nullif(trim(p_membership_role), '') is null
     or nullif(trim(p_note), '') is null then
    raise exception using errcode = '22023', message = 'club_membership_event_invalid';
  end if;

  select event.membership_id
  into membership_row.id
  from public.club_membership_events event
  where event.client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'membershipId', membership_row.id,
      'eventType', p_event_type,
      'replayed', true
    );
  end if;

  select club.*
  into club_row
  from public.clubs club
  where club.id = p_club_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'club_not_found';
  end if;
  if club_row.organization_id is distinct from p_organization_id then
    raise exception using errcode = '42501', message = 'club_organization_mismatch';
  end if;

  select membership.*
  into membership_row
  from public.club_memberships membership
  where membership.club_id = p_club_id
    and membership.athlete_profile_id = p_athlete_profile_id
  for update;
  previous_status := membership_row.status;

  resolved_status := case
    when p_event_type in ('activated', 'role_changed', 'made_primary') then 'active'::public.club_membership_status
    when p_event_type = 'rejected' then 'rejected'::public.club_membership_status
    when p_event_type = 'removed' then 'removed'::public.club_membership_status
    else 'pending'::public.club_membership_status
  end;

  if coalesce(p_is_primary, false) and resolved_status = 'active' then
    update public.club_memberships membership
    set is_primary = false, updated_at = clock_timestamp()
    where membership.athlete_profile_id = p_athlete_profile_id
      and membership.club_id <> p_club_id
      and membership.is_primary;
  end if;

  insert into public.club_memberships (
    club_id,
    athlete_profile_id,
    membership_role,
    status,
    is_primary,
    joined_at
  )
  values (
    p_club_id,
    p_athlete_profile_id,
    trim(p_membership_role),
    resolved_status,
    coalesce(p_is_primary, false) and resolved_status = 'active',
    case when resolved_status = 'active' then coalesce(p_effective_at, clock_timestamp()) else null end
  )
  on conflict (club_id, athlete_profile_id)
  do update set
    membership_role = excluded.membership_role,
    status = excluded.status,
    is_primary = excluded.is_primary,
    joined_at = coalesce(public.club_memberships.joined_at, excluded.joined_at),
    updated_at = clock_timestamp()
  returning * into membership_row;

  if membership_row.is_primary then
    update public.club_memberships membership
    set is_primary = false, updated_at = clock_timestamp()
    where membership.athlete_profile_id = p_athlete_profile_id
      and membership.id <> membership_row.id
      and membership.is_primary;
  end if;

  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.club_membership_events event
  where event.club_id = p_club_id
    and event.athlete_profile_id = p_athlete_profile_id;

  insert into public.club_membership_events (
    club_id,
    athlete_profile_id,
    membership_id,
    sequence_number,
    event_type,
    from_status,
    to_status,
    membership_role,
    effective_at,
    note,
    actor_user_id,
    client_event_id
  )
  values (
    p_club_id,
    p_athlete_profile_id,
    membership_row.id,
    next_sequence,
    p_event_type,
    previous_status,
    resolved_status,
    membership_row.membership_role,
    coalesce(p_effective_at, clock_timestamp()),
    trim(p_note),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'membershipId', membership_row.id,
    'clubId', p_club_id,
    'athleteProfileId', p_athlete_profile_id,
    'status', membership_row.status,
    'membershipRole', membership_row.membership_role,
    'isPrimary', membership_row.is_primary,
    'replayed', false
  );
end
$membership$;
create or replace function public.service_snapshot_club_roster(
  p_organization_id uuid,
  p_club_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $snapshot$
declare
  club_row public.clubs%rowtype;
  existing_snapshot public.club_roster_snapshots%rowtype;
  created_snapshot public.club_roster_snapshots%rowtype;
  roster_json jsonb;
  roster_digest text;
  next_version integer;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'clubs.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'club_manage_permission_required';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'club_roster_snapshot_reason_required';
  end if;

  select snapshot.*
  into existing_snapshot
  from public.club_roster_snapshots snapshot
  where snapshot.client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'snapshotId', existing_snapshot.id,
      'versionNumber', existing_snapshot.version_number,
      'memberCount', existing_snapshot.member_count,
      'rosterDigestSha256', existing_snapshot.roster_digest_sha256,
      'replayed', true
    );
  end if;

  select club.*
  into club_row
  from public.clubs club
  where club.id = p_club_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'club_not_found';
  end if;
  if club_row.organization_id is distinct from p_organization_id then
    raise exception using errcode = '42501', message = 'club_organization_mismatch';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'athleteProfileId', membership.athlete_profile_id,
        'membershipRole', membership.membership_role,
        'isPrimary', membership.is_primary,
        'joinedAt', membership.joined_at
      )
      order by membership.athlete_profile_id
    ),
    '[]'::jsonb
  )
  into roster_json
  from public.club_memberships membership
  where membership.club_id = p_club_id
    and membership.status = 'active';

  roster_digest := encode(
    public.digest(convert_to(roster_json::text, 'utf8'), 'sha256'),
    'hex'
  );
  select coalesce(max(snapshot.version_number), 0) + 1
  into next_version
  from public.club_roster_snapshots snapshot
  where snapshot.club_id = p_club_id;

  insert into public.club_roster_snapshots (
    club_id,
    version_number,
    member_count,
    roster_digest_sha256,
    reason,
    created_by_user_id,
    client_event_id
  )
  values (
    p_club_id,
    next_version,
    jsonb_array_length(roster_json),
    roster_digest,
    trim(p_reason),
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_snapshot;

  insert into public.club_roster_snapshot_members (
    club_roster_snapshot_id,
    athlete_profile_id,
    membership_role,
    is_primary,
    joined_at
  )
  select
    created_snapshot.id,
    membership.athlete_profile_id,
    membership.membership_role,
    membership.is_primary,
    membership.joined_at
  from public.club_memberships membership
  where membership.club_id = p_club_id
    and membership.status = 'active';

  return jsonb_build_object(
    'snapshotId', created_snapshot.id,
    'versionNumber', created_snapshot.version_number,
    'memberCount', created_snapshot.member_count,
    'rosterDigestSha256', created_snapshot.roster_digest_sha256,
    'replayed', false
  );
end
$snapshot$;
create or replace function public.service_publish_league_scoring_rules(
  p_organization_id uuid,
  p_league_season_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_points_table_json jsonb,
  p_best_n_rounds integer,
  p_minimum_rounds integer,
  p_tie_break_method text,
  p_club_members_per_round integer,
  p_eligibility_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $rules$
declare
  season_row public.league_seasons%rowtype;
  resolved_organization_id uuid;
  existing_version public.league_scoring_rule_versions%rowtype;
  created_version public.league_scoring_rule_versions%rowtype;
  next_version integer;
  normalized_rules jsonb;
  rules_digest text;
begin
  if jsonb_typeof(p_points_table_json) <> 'array'
     or jsonb_array_length(p_points_table_json) = 0
     or nullif(trim(p_name), '') is null
     or coalesce(p_minimum_rounds, 0) < 1
     or p_tie_break_method not in ('most_wins', 'best_finish', 'last_round')
     or coalesce(p_club_members_per_round, 0) not between 1 and 20
     or jsonb_typeof(coalesce(p_eligibility_json, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'league_scoring_rules_invalid';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_points_table_json) with ordinality entry(value, position)
    where jsonb_typeof(entry.value) <> 'object'
      or (entry.value->>'points') is null
      or (entry.value->>'points')::numeric < 0
  ) then
    raise exception using errcode = '22023', message = 'league_points_table_invalid';
  end if;

  select version.*
  into existing_version
  from public.league_scoring_rule_versions version
  where version.client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'scoringRuleVersionId', existing_version.id,
      'versionNumber', existing_version.version_number,
      'scoringDigestSha256', existing_version.scoring_digest_sha256,
      'replayed', true
    );
  end if;

  select season.*
  into season_row
  from public.league_seasons season
  where season.id = p_league_season_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'league_season_not_found';
  end if;

  select league.organization_id
  into resolved_organization_id
  from public.leagues league
  where league.id = season_row.league_id;
  if resolved_organization_id is distinct from p_organization_id then
    raise exception using errcode = '42501', message = 'league_organization_mismatch';
  end if;
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'leagues.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'league_manage_permission_required';
  end if;

  normalized_rules := jsonb_build_object(
    'name', trim(p_name),
    'pointsTable', p_points_table_json,
    'bestNRounds', p_best_n_rounds,
    'minimumRounds', p_minimum_rounds,
    'tieBreakMethod', p_tie_break_method,
    'clubMembersPerRound', p_club_members_per_round,
    'eligibility', coalesce(p_eligibility_json, '{}'::jsonb)
  );
  rules_digest := encode(
    public.digest(convert_to(normalized_rules::text, 'utf8'), 'sha256'),
    'hex'
  );

  if exists (
    select 1
    from public.league_scoring_rule_versions version
    where version.league_season_id = p_league_season_id
      and version.scoring_digest_sha256 = rules_digest
  ) then
    raise exception using errcode = '23505', message = 'league_scoring_rules_unchanged';
  end if;

  select coalesce(max(version.version_number), 0) + 1
  into next_version
  from public.league_scoring_rule_versions version
  where version.league_season_id = p_league_season_id;

  insert into public.league_scoring_rule_versions (
    league_season_id,
    version_number,
    name,
    points_table_json,
    best_n_rounds,
    minimum_rounds,
    tie_break_method,
    club_members_per_round,
    eligibility_json,
    scoring_digest_sha256,
    created_by_user_id,
    client_event_id
  )
  values (
    p_league_season_id,
    next_version,
    trim(p_name),
    p_points_table_json,
    p_best_n_rounds,
    p_minimum_rounds,
    p_tie_break_method,
    p_club_members_per_round,
    coalesce(p_eligibility_json, '{}'::jsonb),
    rules_digest,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_version;

  update public.league_seasons season
  set
    current_scoring_rule_version_id = created_version.id,
    standings_stale_since = case
      when season.current_standings_version_id is not null then clock_timestamp()
      else season.standings_stale_since
    end,
    updated_at = clock_timestamp()
  where season.id = p_league_season_id;

  insert into public.league_standings_events (
    league_season_id,
    league_standings_version_id,
    event_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    p_league_season_id,
    season_row.current_standings_version_id,
    'rules_published',
    'Published immutable scoring rules version ' || next_version::text,
    jsonb_build_object(
      'scoringRuleVersionId', created_version.id,
      'versionNumber', next_version,
      'scoringDigestSha256', rules_digest
    ),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'scoringRuleVersionId', created_version.id,
    'versionNumber', created_version.version_number,
    'scoringDigestSha256', created_version.scoring_digest_sha256,
    'replayed', false
  );
end
$rules$;
create or replace function public.service_bind_league_round_publication(
  p_organization_id uuid,
  p_league_round_id uuid,
  p_result_publication_id uuid,
  p_actor_user_id uuid,
  p_change_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $bind$
declare
  round_row public.league_rounds%rowtype;
  publication_row public.result_publications%rowtype;
  season_row public.league_seasons%rowtype;
  existing_source public.league_round_source_versions%rowtype;
  created_source public.league_round_source_versions%rowtype;
  resolved_organization_id uuid;
  next_version integer;
  publication_digest text;
  source_digest text;
begin
  if nullif(trim(p_change_note), '') is null then
    raise exception using errcode = '22023', message = 'league_round_source_note_required';
  end if;

  select source.*
  into existing_source
  from public.league_round_source_versions source
  where source.client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'sourceVersionId', existing_source.id,
      'versionNumber', existing_source.version_number,
      'sourceDigestSha256', existing_source.source_digest_sha256,
      'replayed', true
    );
  end if;

  select round.*
  into round_row
  from public.league_rounds round
  where round.id = p_league_round_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'league_round_not_found';
  end if;

  select season.*
  into season_row
  from public.league_seasons season
  where season.id = round_row.league_season_id
  for update;

  select league.organization_id
  into resolved_organization_id
  from public.leagues league
  where league.id = season_row.league_id;
  if resolved_organization_id is distinct from p_organization_id then
    raise exception using errcode = '42501', message = 'league_organization_mismatch';
  end if;
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'leagues.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'league_manage_permission_required';
  end if;

  select publication.*
  into publication_row
  from public.result_publications publication
  where publication.id = p_result_publication_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'result_publication_not_found';
  end if;
  if publication_row.event_category_id <> round_row.event_category_id
     or publication_row.publication_state not in ('official', 'corrected') then
    raise exception using errcode = '22023', message = 'league_round_publication_invalid';
  end if;

  publication_digest := coalesce(
    publication_row.manifest_digest_sha256,
    encode(
      public.digest(
        convert_to(
          jsonb_build_object(
            'publicationId', publication_row.id,
            'resultRunId', publication_row.result_run_id,
            'publicationState', publication_row.publication_state,
            'publishedAt', publication_row.published_at
          )::text,
          'utf8'
        ),
        'sha256'
      ),
      'hex'
    )
  );
  select coalesce(max(source.version_number), 0) + 1
  into next_version
  from public.league_round_source_versions source
  where source.league_round_id = p_league_round_id;
  source_digest := encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'leagueRoundId', p_league_round_id,
          'versionNumber', next_version,
          'resultPublicationId', p_result_publication_id,
          'publicationDigestSha256', publication_digest
        )::text,
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.league_round_source_versions (
    league_round_id,
    version_number,
    result_publication_id,
    publication_state,
    publication_digest_sha256,
    source_digest_sha256,
    change_note,
    selected_by_user_id,
    client_event_id
  )
  values (
    p_league_round_id,
    next_version,
    p_result_publication_id,
    publication_row.publication_state,
    publication_digest,
    source_digest,
    trim(p_change_note),
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_source;

  update public.league_rounds round
  set
    current_source_version_id = created_source.id,
    current_result_publication_id = p_result_publication_id,
    status = 'completed',
    updated_at = clock_timestamp()
  where round.id = p_league_round_id;

  update public.league_seasons season
  set
    standings_stale_since = case
      when season.current_standings_version_id is not null then clock_timestamp()
      else season.standings_stale_since
    end,
    updated_at = clock_timestamp()
  where season.id = round_row.league_season_id;

  insert into public.league_standings_events (
    league_season_id,
    league_standings_version_id,
    event_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    round_row.league_season_id,
    season_row.current_standings_version_id,
    'round_source_bound',
    trim(p_change_note),
    jsonb_build_object(
      'leagueRoundId', p_league_round_id,
      'sourceVersionId', created_source.id,
      'resultPublicationId', p_result_publication_id,
      'sourceDigestSha256', source_digest
    ),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'sourceVersionId', created_source.id,
    'versionNumber', created_source.version_number,
    'publicationState', created_source.publication_state,
    'sourceDigestSha256', created_source.source_digest_sha256,
    'standingsStale', season_row.current_standings_version_id is not null,
    'replayed', false
  );
end
$bind$;
create or replace function public.service_compute_league_standings(
  p_organization_id uuid,
  p_league_season_id uuid,
  p_actor_user_id uuid,
  p_change_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $standings$
declare
  season_row public.league_seasons%rowtype;
  rules_row public.league_scoring_rule_versions%rowtype;
  existing_version public.league_standings_versions%rowtype;
  created_version public.league_standings_versions%rowtype;
  resolved_organization_id uuid;
  source_manifest jsonb;
  input_digest text;
  standings_digest text;
  next_version integer;
  resolved_state text;
  resolved_individual_count integer;
  resolved_club_count integer;
begin
  if nullif(trim(p_change_note), '') is null then
    raise exception using errcode = '22023', message = 'league_standings_change_note_required';
  end if;

  select standings.*
  into existing_version
  from public.league_standings_versions standings
  where standings.client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'standingsVersionId', existing_version.id,
      'versionNumber', existing_version.version_number,
      'standingsDigestSha256', existing_version.standings_digest_sha256,
      'replayed', true
    );
  end if;

  select season.*
  into season_row
  from public.league_seasons season
  where season.id = p_league_season_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'league_season_not_found';
  end if;
  select league.organization_id
  into resolved_organization_id
  from public.leagues league
  where league.id = season_row.league_id;
  if resolved_organization_id is distinct from p_organization_id then
    raise exception using errcode = '42501', message = 'league_organization_mismatch';
  end if;
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'leagues.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'league_manage_permission_required';
  end if;
  if season_row.current_scoring_rule_version_id is null then
    raise exception using errcode = 'P0001', message = 'league_scoring_rules_required';
  end if;
  if not exists (
    select 1
    from public.league_rounds round
    where round.league_season_id = p_league_season_id
  ) or exists (
    select 1
    from public.league_rounds round
    where round.league_season_id = p_league_season_id
      and round.current_source_version_id is null
  ) then
    raise exception using errcode = 'P0001', message = 'league_round_sources_incomplete';
  end if;

  select rules.*
  into rules_row
  from public.league_scoring_rule_versions rules
  where rules.id = season_row.current_scoring_rule_version_id;

  select jsonb_build_object(
    'leagueSeasonId', p_league_season_id,
    'scoringRuleVersionId', rules_row.id,
    'scoringDigestSha256', rules_row.scoring_digest_sha256,
    'rounds',
    jsonb_agg(
      jsonb_build_object(
        'leagueRoundId', round.id,
        'roundNumber', round.round_number,
        'sourceVersionId', source.id,
        'sourceVersionNumber', source.version_number,
        'resultPublicationId', source.result_publication_id,
        'publicationDigestSha256', source.publication_digest_sha256,
        'sourceDigestSha256', source.source_digest_sha256
      )
      order by round.round_number
    )
  )
  into source_manifest
  from public.league_rounds round
  join public.league_round_source_versions source
    on source.id = round.current_source_version_id
  where round.league_season_id = p_league_season_id;

  input_digest := encode(
    public.digest(convert_to(source_manifest::text, 'utf8'), 'sha256'),
    'hex'
  );
  if exists (
    select 1
    from public.league_standings_versions standings
    where standings.league_season_id = p_league_season_id
      and standings.input_digest_sha256 = input_digest
  ) then
    raise exception using errcode = '23505', message = 'league_standings_inputs_unchanged';
  end if;

  select coalesce(max(standings.version_number), 0) + 1
  into next_version
  from public.league_standings_versions standings
  where standings.league_season_id = p_league_season_id;
  resolved_state := case when next_version = 1 then 'official' else 'corrected' end;

  insert into public.league_standings_versions (
    league_season_id,
    version_number,
    supersedes_standings_version_id,
    scoring_rule_version_id,
    publication_state,
    source_manifest_json,
    input_digest_sha256,
    change_note,
    generated_by_user_id,
    client_event_id
  )
  values (
    p_league_season_id,
    next_version,
    season_row.current_standings_version_id,
    rules_row.id,
    resolved_state,
    source_manifest,
    input_digest,
    trim(p_change_note),
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_version;

  with round_results as (
    select
      round.id as league_round_id,
      round.round_number,
      source.result_publication_id,
      result.athlete_profile_id,
      result.represented_club_id,
      result.rank_overall,
      coalesce(
        (rules_row.points_table_json -> (result.rank_overall - 1) ->> 'points')::numeric,
        0
      ) as points
    from public.league_rounds round
    join public.league_round_source_versions source
      on source.id = round.current_source_version_id
    join public.result_publications publication
      on publication.id = source.result_publication_id
    join public.result_rows result
      on result.result_run_id = publication.result_run_id
    where round.league_season_id = p_league_season_id
      and result.result_status in ('official', 'corrected')
      and result.rank_overall is not null
      and result.finish_time_ms is not null
  ),
  scored_candidates as (
    select
      result.*,
      row_number() over (
        partition by result.athlete_profile_id
        order by result.points desc, result.rank_overall, result.round_number
      ) as score_order
    from round_results result
  ),
  athlete_aggregates as (
    select
      candidate.athlete_profile_id,
      (array_agg(candidate.represented_club_id order by candidate.round_number desc)
        filter (where candidate.represented_club_id is not null))[1] as represented_club_id,
      sum(candidate.points) filter (
        where rules_row.best_n_rounds is null
          or candidate.score_order <= rules_row.best_n_rounds
      ) as points_total,
      count(*) filter (
        where rules_row.best_n_rounds is null
          or candidate.score_order <= rules_row.best_n_rounds
      )::integer as scored_rounds,
      count(*) filter (where candidate.rank_overall = 1)::integer as wins,
      min(candidate.rank_overall)::integer as best_finish,
      (array_agg(candidate.points order by candidate.round_number desc))[1] as last_round_points,
      jsonb_agg(
        jsonb_build_object(
          'leagueRoundId', candidate.league_round_id,
          'roundNumber', candidate.round_number,
          'resultPublicationId', candidate.result_publication_id,
          'rank', candidate.rank_overall,
          'points', candidate.points,
          'scored', rules_row.best_n_rounds is null
            or candidate.score_order <= rules_row.best_n_rounds
        )
        order by candidate.round_number
      ) as contributions_json
    from scored_candidates candidate
    group by candidate.athlete_profile_id
  ),
  athlete_ranked as (
    select
      aggregate.*,
      aggregate.scored_rounds >= rules_row.minimum_rounds as eligible,
      rank() over (
        order by
          (aggregate.scored_rounds >= rules_row.minimum_rounds) desc,
          aggregate.points_total desc,
          case when rules_row.tie_break_method = 'most_wins' then aggregate.wins end desc nulls last,
          case when rules_row.tie_break_method = 'best_finish' then aggregate.best_finish end asc nulls last,
          case when rules_row.tie_break_method = 'last_round' then aggregate.last_round_points end desc nulls last,
          aggregate.wins desc,
          aggregate.best_finish asc nulls last,
          aggregate.last_round_points desc
      )::integer as computed_rank
    from athlete_aggregates aggregate
  )
  insert into public.league_individual_standing_rows (
    league_standings_version_id,
    athlete_profile_id,
    represented_club_id,
    points_total,
    scored_rounds,
    eligible,
    rank_overall,
    wins,
    best_finish,
    last_round_points,
    contributions_json,
    tie_break_json
  )
  select
    created_version.id,
    ranked.athlete_profile_id,
    ranked.represented_club_id,
    coalesce(ranked.points_total, 0),
    ranked.scored_rounds,
    ranked.eligible,
    case when ranked.eligible then ranked.computed_rank else null end,
    ranked.wins,
    ranked.best_finish,
    coalesce(ranked.last_round_points, 0),
    ranked.contributions_json,
    jsonb_build_object(
      'method', rules_row.tie_break_method,
      'wins', ranked.wins,
      'bestFinish', ranked.best_finish,
      'lastRoundPoints', ranked.last_round_points
    )
  from athlete_ranked ranked;

  with round_results as (
    select
      round.id as league_round_id,
      round.round_number,
      source.result_publication_id,
      result.athlete_profile_id,
      result.represented_club_id as club_id,
      result.rank_overall,
      coalesce(
        (rules_row.points_table_json -> (result.rank_overall - 1) ->> 'points')::numeric,
        0
      ) as points
    from public.league_rounds round
    join public.league_round_source_versions source
      on source.id = round.current_source_version_id
    join public.result_publications publication
      on publication.id = source.result_publication_id
    join public.result_rows result
      on result.result_run_id = publication.result_run_id
    where round.league_season_id = p_league_season_id
      and result.result_status in ('official', 'corrected')
      and result.rank_overall is not null
      and result.finish_time_ms is not null
      and result.represented_club_id is not null
  ),
  club_member_ranked as (
    select
      result.*,
      row_number() over (
        partition by result.league_round_id, result.club_id
        order by result.points desc, result.rank_overall, result.athlete_profile_id
      ) as club_member_order
    from round_results result
  ),
  club_rounds as (
    select
      result.club_id,
      result.league_round_id,
      result.round_number,
      result.result_publication_id,
      sum(result.points) as round_points,
      jsonb_agg(
        jsonb_build_object(
          'athleteProfileId', result.athlete_profile_id,
          'rank', result.rank_overall,
          'points', result.points
        )
        order by result.club_member_order
      ) as members_json
    from club_member_ranked result
    where result.club_member_order <= rules_row.club_members_per_round
    group by
      result.club_id,
      result.league_round_id,
      result.round_number,
      result.result_publication_id
  ),
  club_aggregates as (
    select
      club_round.club_id,
      sum(club_round.round_points) as points_total,
      count(*)::integer as scored_rounds,
      jsonb_agg(
        jsonb_build_object(
          'leagueRoundId', club_round.league_round_id,
          'roundNumber', club_round.round_number,
          'resultPublicationId', club_round.result_publication_id,
          'points', club_round.round_points,
          'members', club_round.members_json
        )
        order by club_round.round_number
      ) as contributions_json
    from club_rounds club_round
    group by club_round.club_id
  ),
  club_ranked as (
    select
      aggregate.*,
      rank() over (
        order by aggregate.points_total desc, aggregate.scored_rounds desc
      )::integer as computed_rank
    from club_aggregates aggregate
  )
  insert into public.league_club_standing_rows (
    league_standings_version_id,
    club_id,
    points_total,
    scored_rounds,
    rank_overall,
    wins,
    contributions_json
  )
  select
    created_version.id,
    ranked.club_id,
    ranked.points_total,
    ranked.scored_rounds,
    ranked.computed_rank,
    0,
    ranked.contributions_json
  from club_ranked ranked;

  select count(*)::integer
  into resolved_individual_count
  from public.league_individual_standing_rows standing
  where standing.league_standings_version_id = created_version.id;
  select count(*)::integer
  into resolved_club_count
  from public.league_club_standing_rows standing
  where standing.league_standings_version_id = created_version.id;

  select encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'individual',
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'athleteProfileId', standing.athlete_profile_id,
                'rank', standing.rank_overall,
                'points', standing.points_total,
                'eligible', standing.eligible
              )
              order by standing.rank_overall nulls last, standing.athlete_profile_id
            )
            from public.league_individual_standing_rows standing
            where standing.league_standings_version_id = created_version.id
          ), '[]'::jsonb),
          'clubs',
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'clubId', standing.club_id,
                'rank', standing.rank_overall,
                'points', standing.points_total
              )
              order by standing.rank_overall, standing.club_id
            )
            from public.league_club_standing_rows standing
            where standing.league_standings_version_id = created_version.id
          ), '[]'::jsonb)
        )::text,
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  )
  into standings_digest;

  update public.league_standings_versions standings
  set
    standings_digest_sha256 = standings_digest,
    individual_count = resolved_individual_count,
    club_count = resolved_club_count
  where standings.id = created_version.id;

  delete from public.league_individual_standings standing
  where standing.league_season_id = p_league_season_id;
  insert into public.league_individual_standings (
    league_season_id,
    athlete_profile_id,
    points_total,
    scored_rounds,
    rank_overall,
    last_computed_at
  )
  select
    p_league_season_id,
    standing.athlete_profile_id,
    standing.points_total,
    standing.scored_rounds,
    standing.rank_overall,
    clock_timestamp()
  from public.league_individual_standing_rows standing
  where standing.league_standings_version_id = created_version.id;

  delete from public.league_club_standings standing
  where standing.league_season_id = p_league_season_id;
  insert into public.league_club_standings (
    league_season_id,
    club_id,
    points_total,
    scored_rounds,
    rank_overall,
    last_computed_at
  )
  select
    p_league_season_id,
    standing.club_id,
    standing.points_total,
    standing.scored_rounds,
    standing.rank_overall,
    clock_timestamp()
  from public.league_club_standing_rows standing
  where standing.league_standings_version_id = created_version.id;

  update public.league_seasons season
  set
    current_standings_version_id = created_version.id,
    standings_stale_since = null,
    updated_at = clock_timestamp()
  where season.id = p_league_season_id;

  insert into public.league_standings_events (
    league_season_id,
    league_standings_version_id,
    event_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    p_league_season_id,
    created_version.id,
    'standings_published',
    trim(p_change_note),
    jsonb_build_object(
      'versionNumber', next_version,
      'publicationState', resolved_state,
      'inputDigestSha256', input_digest,
      'standingsDigestSha256', standings_digest,
      'individualCount', resolved_individual_count,
      'clubCount', resolved_club_count
    ),
    p_actor_user_id,
    p_client_event_id
  );

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'league_standings_version',
    created_version.id,
    'league.standings_published',
    jsonb_build_object(
      'leagueSeasonId', p_league_season_id,
      'versionNumber', next_version,
      'publicationState', resolved_state,
      'inputDigestSha256', input_digest,
      'standingsDigestSha256', standings_digest
    )
  );

  return jsonb_build_object(
    'standingsVersionId', created_version.id,
    'versionNumber', next_version,
    'publicationState', resolved_state,
    'inputDigestSha256', input_digest,
    'standingsDigestSha256', standings_digest,
    'individualCount', resolved_individual_count,
    'clubCount', resolved_club_count,
    'replayed', false
  );
end
$standings$;
create or replace function public.service_get_ecosystem_workspace(
  p_organization_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $workspace$
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'leagues.manage', 'organization', null
  ) and not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'clubs.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'ecosystem_workspace_permission_required';
  end if;

  return jsonb_build_object(
    'organizationId', p_organization_id,
    'summary', jsonb_build_object(
      'clubCount', (
        select count(*)
        from public.clubs club
        where club.organization_id = p_organization_id
          and club.status <> 'merged'
      ),
      'verifiedClubCount', (
        select count(*)
        from public.clubs club
        where club.organization_id = p_organization_id
          and club.verification_status = 'verified'
      ),
      'pendingVerificationCount', (
        select count(*)
        from public.club_verification_cases verification
        join public.clubs club on club.id = verification.club_id
        where club.organization_id = p_organization_id
          and verification.case_state in ('pending', 'needs_information')
      ),
      'leagueSeasonCount', (
        select count(*)
        from public.league_seasons season
        join public.leagues league on league.id = season.league_id
        where league.organization_id = p_organization_id
      ),
      'staleStandingsCount', (
        select count(*)
        from public.league_seasons season
        join public.leagues league on league.id = season.league_id
        where league.organization_id = p_organization_id
          and season.standings_stale_since is not null
      )
    ),
    'clubs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', club.id,
          'slug', club.slug,
          'name', club.name,
          'city', club.city,
          'countryCode', trim(club.country_code),
          'status', club.status,
          'verificationStatus', club.verification_status,
          'activeMembers', (
            select count(*)
            from public.club_memberships membership
            where membership.club_id = club.id
              and membership.status = 'active'
          ),
          'latestRosterSnapshot', (
            select jsonb_build_object(
              'id', snapshot.id,
              'versionNumber', snapshot.version_number,
              'memberCount', snapshot.member_count,
              'digestSha256', snapshot.roster_digest_sha256,
              'createdAt', snapshot.created_at
            )
            from public.club_roster_snapshots snapshot
            where snapshot.club_id = club.id
            order by snapshot.version_number desc
            limit 1
          ),
          'verificationCase', (
            select jsonb_build_object(
              'id', verification.id,
              'caseNumber', verification.case_number,
              'state', verification.case_state,
              'submittedAt', verification.submitted_at,
              'decisionNote', verification.decision_note
            )
            from public.club_verification_cases verification
            where verification.club_id = club.id
            order by verification.submitted_at desc
            limit 1
          )
        )
        order by club.name
      )
      from public.clubs club
      where club.organization_id = p_organization_id
    ), '[]'::jsonb),
    'leagueSeasons', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'leagueId', league.id,
          'leagueName', league.name,
          'seasonId', season.id,
          'seasonName', season.name,
          'year', season.year,
          'status', season.status,
          'roundCount', (
            select count(*) from public.league_rounds round
            where round.league_season_id = season.id
          ),
          'boundRoundCount', (
            select count(*) from public.league_rounds round
            where round.league_season_id = season.id
              and round.current_source_version_id is not null
          ),
          'scoringRuleVersion', rules.version_number,
          'scoringDigestSha256', rules.scoring_digest_sha256,
          'standingsVersion', standings.version_number,
          'standingsState', standings.publication_state,
          'standingsDigestSha256', standings.standings_digest_sha256,
          'standingsStaleSince', season.standings_stale_since
        )
        order by season.year desc, league.name
      )
      from public.league_seasons season
      join public.leagues league on league.id = season.league_id
      left join public.league_scoring_rule_versions rules
        on rules.id = season.current_scoring_rule_version_id
      left join public.league_standings_versions standings
        on standings.id = season.current_standings_version_id
      where league.organization_id = p_organization_id
    ), '[]'::jsonb)
  );
end
$workspace$;
create or replace function public.public_league_standings(
  p_league_season_id uuid
)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $public$
  select case
    when season.published_at is null or standings.id is null then null
    else jsonb_build_object(
      'leagueSeasonId', season.id,
      'leagueName', league.name,
      'seasonName', season.name,
      'year', season.year,
      'versionNumber', standings.version_number,
      'publicationState', standings.publication_state,
      'publishedAt', standings.generated_at,
      'standingsDigestSha256', standings.standings_digest_sha256,
      'stale', season.standings_stale_since is not null,
      'individual', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'athleteProfileId', row.athlete_profile_id,
            'athleteName', athlete.display_name,
            'clubId', row.represented_club_id,
            'clubName', club.name,
            'points', row.points_total,
            'scoredRounds', row.scored_rounds,
            'eligible', row.eligible,
            'rank', row.rank_overall,
            'contributions', row.contributions_json,
            'tieBreak', row.tie_break_json
          )
          order by row.rank_overall nulls last, athlete.display_name
        )
        from public.league_individual_standing_rows row
        join public.athlete_profiles athlete on athlete.id = row.athlete_profile_id
        left join public.clubs club on club.id = row.represented_club_id
        where row.league_standings_version_id = standings.id
          and athlete.status = 'active'
      ), '[]'::jsonb),
      'clubs', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'clubId', row.club_id,
            'clubName', club.name,
            'points', row.points_total,
            'scoredRounds', row.scored_rounds,
            'rank', row.rank_overall,
            'contributions', row.contributions_json
          )
          order by row.rank_overall, club.name
        )
        from public.league_club_standing_rows row
        join public.clubs club on club.id = row.club_id
        where row.league_standings_version_id = standings.id
      ), '[]'::jsonb)
    )
  end
  from public.league_seasons season
  join public.leagues league on league.id = season.league_id
  left join public.league_standings_versions standings
    on standings.id = season.current_standings_version_id
  where season.id = p_league_season_id
$public$;
alter table public.club_aliases enable row level security;
alter table public.club_verification_cases enable row level security;
alter table public.club_verification_events enable row level security;
alter table public.club_membership_events enable row level security;
alter table public.club_roster_snapshots enable row level security;
alter table public.club_roster_snapshot_members enable row level security;
alter table public.club_identity_merges enable row level security;
alter table public.league_scoring_rule_versions enable row level security;
alter table public.league_round_source_versions enable row level security;
alter table public.league_standings_versions enable row level security;
alter table public.league_individual_standing_rows enable row level security;
alter table public.league_club_standing_rows enable row level security;
alter table public.league_standings_events enable row level security;
revoke all on table
  public.club_aliases,
  public.club_verification_cases,
  public.club_verification_events,
  public.club_membership_events,
  public.club_roster_snapshots,
  public.club_roster_snapshot_members,
  public.club_identity_merges,
  public.league_scoring_rule_versions,
  public.league_round_source_versions,
  public.league_standings_versions,
  public.league_individual_standing_rows,
  public.league_club_standing_rows,
  public.league_standings_events
from public, anon, authenticated;
revoke all on function public.service_submit_club_verification(uuid,uuid,uuid,jsonb,text,uuid)
  from public, anon, authenticated;
revoke all on function public.service_decide_club_verification(uuid,uuid,uuid,text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.service_record_club_membership(uuid,uuid,uuid,uuid,text,text,boolean,timestamptz,text,uuid)
  from public, anon, authenticated;
revoke all on function public.service_snapshot_club_roster(uuid,uuid,uuid,text,uuid)
  from public, anon, authenticated;
revoke all on function public.service_publish_league_scoring_rules(uuid,uuid,uuid,text,jsonb,integer,integer,text,integer,jsonb,uuid)
  from public, anon, authenticated;
revoke all on function public.service_bind_league_round_publication(uuid,uuid,uuid,uuid,text,uuid)
  from public, anon, authenticated;
revoke all on function public.service_compute_league_standings(uuid,uuid,uuid,text,uuid)
  from public, anon, authenticated;
revoke all on function public.service_get_ecosystem_workspace(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.public_league_standings(uuid)
  from public;
grant execute on function public.service_submit_club_verification(uuid,uuid,uuid,jsonb,text,uuid)
  to service_role;
grant execute on function public.service_decide_club_verification(uuid,uuid,uuid,text,text,uuid)
  to service_role;
grant execute on function public.service_record_club_membership(uuid,uuid,uuid,uuid,text,text,boolean,timestamptz,text,uuid)
  to service_role;
grant execute on function public.service_snapshot_club_roster(uuid,uuid,uuid,text,uuid)
  to service_role;
grant execute on function public.service_publish_league_scoring_rules(uuid,uuid,uuid,text,jsonb,integer,integer,text,integer,jsonb,uuid)
  to service_role;
grant execute on function public.service_bind_league_round_publication(uuid,uuid,uuid,uuid,text,uuid)
  to service_role;
grant execute on function public.service_compute_league_standings(uuid,uuid,uuid,text,uuid)
  to service_role;
grant execute on function public.service_get_ecosystem_workspace(uuid,uuid)
  to service_role;
grant execute on function public.public_league_standings(uuid)
  to anon, authenticated, service_role;
