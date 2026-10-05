begin;

-- Private review evidence, NOT approved entitlements or a chain settlement.
-- No FK to mutable/deletable sporting rows: their IDs are historical provenance.
-- No email, exact DOB, wallet, credential, or claim-readiness data is copied.
create table app_private.reward_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  league_season_id uuid not null,
  round_ids uuid[] not null check (cardinality(round_ids) between 1 and 5),
  captured_by_user_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  captured_at timestamptz not null default clock_timestamp(),
  source_body jsonb not null check (jsonb_typeof(source_body) = 'object'),
  source_fingerprint_sha256 text not null check
    (source_fingerprint_sha256 = encode(sha256(convert_to(source_body::text, 'UTF8')), 'hex')),
  unique (organization_id, captured_by_user_id, idempotency_key),
  check (octet_length(source_body::text) <= 8388608)
);
create index reward_source_snapshots_season_idx
  on app_private.reward_source_snapshots (league_season_id, captured_at desc);
alter table app_private.reward_source_snapshots enable row level security;
revoke all on app_private.reward_source_snapshots from public, anon, authenticated, service_role;
grant usage on schema app_private to service_role;
grant select, insert on app_private.reward_source_snapshots to service_role;
create policy reward_source_snapshots_service_select on app_private.reward_source_snapshots
  for select to service_role using (true);
create policy reward_source_snapshots_service_insert on app_private.reward_source_snapshots
  for insert to service_role with check (true);

create function app_private.reject_reward_source_snapshot_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'reward_source_snapshot_is_immutable';
end
$$;
revoke all on function app_private.reject_reward_source_snapshot_mutation()
  from public, anon, authenticated, service_role;
create trigger reward_source_snapshot_immutable
  before update or delete on app_private.reward_source_snapshots
  for each row execute function app_private.reject_reward_source_snapshot_mutation();

-- STABLE keeps every source read on the calling statement's MVCC snapshot.
-- Service-only entry point still enforces the acting user's current league role.
-- Explicit fields prevent a later source-column addition from exporting secrets.
create function public.service_read_reward_source(
  p_organization_id uuid, p_league_season_id uuid, p_round_ids uuid[], p_actor_user_id uuid
)
returns jsonb language plpgsql stable security invoker
set search_path = '' set timezone = 'UTC' as $$
declare
  body jsonb;
  normalized_round_ids uuid[];
  item jsonb;
begin
  select array_agg(distinct id order by id) into normalized_round_ids from unnest(p_round_ids) id;
  if p_organization_id is null or p_league_season_id is null or p_actor_user_id is null
     or coalesce(cardinality(p_round_ids), 0) not between 1 and 5
     or array_position(p_round_ids, null) is not null
     or cardinality(p_round_ids) <> cardinality(normalized_round_ids) then
    raise exception using errcode = '22023', message = 'invalid_reward_source_scope';
  end if;
  if not exists (
    select 1 from public.league_seasons s join public.leagues l on l.id = s.league_id
    where s.id = p_league_season_id and l.organization_id = p_organization_id
  ) or public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'leagues.manage', 'organization', null
  ) is not true then
    raise exception using errcode = '42501', message = 'reward_source_permission_required';
  end if;

  with recursive selected_rounds as (
    select r.* from public.league_round_events r
    where r.league_season_id = p_league_season_id and r.id = any(normalized_round_ids)
  ), selected_mappings as (
    select m.* from public.league_round_race_mappings m
    join selected_rounds r on r.id = m.league_round_event_id
    where m.status = 'mapped'
  ), selected_rows as (
    select rr.*, m.id as mapping_id, m.league_round_event_id as round_id,
      m.current_result_publication_id as publication_id
    from selected_mappings m
    join public.result_publications p on p.id = m.current_result_publication_id
    join public.result_rows rr on rr.result_run_id = p.result_run_id
    order by m.id, rr.id limit 20001
  ), identities as (
    select distinct rr.athlete_profile_id as source_id, a.id, a.merged_into_athlete_profile_id as next_id,
      array[a.id] as path, false as cycle, 0 as depth
    from selected_rows rr join public.athlete_profiles a on a.id = rr.athlete_profile_id
    union all
    select i.source_id, a.id, a.merged_into_athlete_profile_id, i.path || a.id, a.id = any(i.path), i.depth + 1
    from identities i join public.athlete_profiles a on a.id = i.next_id
    where not i.cycle and i.depth < 16
  ), canonical_identities as (
    select distinct on (source_id) * from identities order by source_id, depth desc
  ), club_identities as (
    select distinct rr.represented_club_id as source_id, c.id, c.merged_into_club_id as next_id,
      array[c.id] as path, false as cycle, 0 as depth
    from selected_rows rr join public.clubs c on c.id = rr.represented_club_id
    union all
    select i.source_id, c.id, c.merged_into_club_id, i.path || c.id, c.id = any(i.path), i.depth + 1
    from club_identities i join public.clubs c on c.id = i.next_id
    where not i.cycle and i.depth < 16
  ), canonical_club_identities as (
    select distinct on (source_id) * from club_identities order by source_id, depth desc
  )
  select jsonb_build_object(
    'schemaVersion', 1,
    'season', (select jsonb_build_object('id', s.id, 'leagueId', s.league_id, 'year', s.year,
      'status', s.status, 'leagueStatus', l.status, 'organizationId', l.organization_id,
      'organizerRules', s.organizer_rules)
      from public.league_seasons s join public.leagues l on l.id = s.league_id where s.id = p_league_season_id),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.round_number,
      'status', r.status, 'eventEditionId', r.event_edition_id, 'eventStatus', e.status,
      'isPractice', e.is_practice, 'organizerDeletedAt', e.organizer_deleted_at,
      'startDate', e.start_date, 'timezone', e.timezone) order by r.id)
      from selected_rounds r join public.event_editions e on e.id = r.event_edition_id), '[]'::jsonb),
    'mappings', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'roundId', m.league_round_event_id, 'competitionId', m.league_competition_id,
      'raceId', m.event_category_id, 'status', m.status, 'sourceVersionId', m.current_source_version_id,
      'publicationId', m.current_result_publication_id, 'latestPublicationId', latest.id,
      'raceEditionId', c.event_edition_id, 'raceStatus', c.status, 'resultsMode', c.results_mode,
      'organizerDeletedAt', c.organizer_deleted_at, 'distanceMetres', (c.distance_km * 1000)::text,
      'startAt', c.start_at, 'courseFormat', c.course_format, 'lapCount', c.lap_count,
      'trackSnapshotId', t.id, 'trackVersionId', t.track_version_id, 'trackTemplateId', t.track_template_id,
      'trackMetres', (t.distance_km * 1000)::text,
      'publication', jsonb_build_object('id', p.id, 'raceId', p.event_category_id, 'runId', p.result_run_id,
        'state', p.publication_state, 'publishedAt', p.published_at, 'createdAt', p.created_at,
        'supersedesId', p.supersedes_publication_id, 'manifestDigest', p.manifest_digest_sha256,
        'signatureState', p.signature_state, 'signedDigest', p.signed_digest_sha256),
      'run', jsonb_build_object('id', run.id, 'raceId', run.event_category_id, 'status', run.status,
        'completedAt', run.completed_at)) order by m.id)
      from selected_mappings m join public.event_categories c on c.id = m.event_category_id
      left join public.event_category_track_snapshots t on t.event_category_id = c.id
      left join public.result_publications p on p.id = m.current_result_publication_id
      left join public.result_runs run on run.id = p.result_run_id
      left join lateral (select candidate.id from public.result_publications candidate
        where candidate.event_category_id = c.id and candidate.publication_state in ('official', 'corrected')
        order by candidate.published_at desc, candidate.created_at desc, candidate.id desc limit 1) latest on true
      ), '[]'::jsonb),
    'competitions', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'seasonId', c.league_season_id, 'status', c.status,
      'scoringTarget', c.scoring_target, 'resultBasis', c.result_basis) order by c.id)
      from public.league_competitions c where c.id in (select m.league_competition_id from selected_mappings m)), '[]'::jsonb),
    'classifications', coalesce((select jsonb_agg(jsonb_build_object('id', c.id,
      'competitionId', c.league_competition_id, 'name', c.name, 'status', c.status,
      'eligibility', c.eligibility_json) order by c.id)
      from public.league_classifications c where c.league_competition_id in
        (select m.league_competition_id from selected_mappings m)), '[]'::jsonb),
    'adjudicationCases', coalesce((select jsonb_agg(jsonb_build_object('id', c.id,
      'raceId', c.event_category_id, 'registrationId', c.registration_id, 'resultRunId', c.result_run_id,
      'state', c.case_state, 'appealOfCaseId', c.appeal_of_case_id, 'outcome', c.decision_outcome,
      'recomputeRequired', c.recompute_required, 'decidedAt', c.decided_at,
      'closedAt', c.closed_at, 'createdAt', c.created_at) order by c.id)
      from public.result_adjudication_cases c where c.event_category_id in
        (select m.event_category_id from selected_mappings m)), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', rr.id, 'mappingId', rr.mapping_id,
      'roundId', rr.round_id, 'raceId', rr.event_category_id, 'publicationId', rr.publication_id,
      'resultRunId', rr.result_run_id, 'registrationId', rr.registration_id,
      'sourceAthleteId', rr.athlete_profile_id, 'canonicalAthleteId', i.id,
      'identityPath', i.path, 'identityCycle', i.cycle, 'unresolvedMergeId', i.next_id,
      'athleteStatus', a.status, 'gender', a.gender,
      'registrationAthleteId', reg.athlete_profile_id, 'registrationRaceId', reg.event_category_id,
      'registrationStatus', reg.status, 'participationStatus', reg.participation_status,
      'registrationBirthYear', reg.birth_year_snapshot,
      'profileBirthYear', a.birth_year, 'profileDateBirthYear', extract(year from a.date_of_birth)::integer,
      'representedClubId', rr.represented_club_id, 'canonicalClubId', ci.id,
      'clubIdentityPath', ci.path, 'clubIdentityCycle', ci.cycle, 'unresolvedClubMergeId', ci.next_id,
      'resultStatus', rr.result_status,
      'finishTimeMs', rr.finish_time_ms::text, 'rankOverall', rr.rank_overall,
      'rankGender', rr.rank_gender, 'rankAgeCategory', rr.rank_age_category,
      'clubPointsHundredths', (rr.club_points * 100)::text) order by rr.mapping_id, rr.id)
      from selected_rows rr left join canonical_identities i on i.source_id = rr.athlete_profile_id
      left join canonical_club_identities ci on ci.source_id = rr.represented_club_id
      left join public.athlete_profiles a on a.id = i.id
      left join public.registrations reg on reg.id = rr.registration_id), '[]'::jsonb)
  ) into body;

  if jsonb_array_length(body->'rounds') <> cardinality(normalized_round_ids) then
    raise exception using errcode = '22023', message = 'reward_round_scope_mismatch';
  end if;
  for item in select value from jsonb_array_elements(body->'rounds') loop
    if item->>'status' <> 'completed' or item->>'isPractice' <> 'false'
       or item->>'organizerDeletedAt' is not null or item->>'eventStatus' = 'cancelled'
       or not exists (select 1 from jsonb_array_elements(body->'mappings') m where m->>'roundId' = item->>'id') then
      raise exception using errcode = '55000', message = 'reward_round_not_ready';
    end if;
  end loop;
  for item in select value from jsonb_array_elements(body->'mappings') loop
    if item->>'publicationId' is null or item->>'publicationId' is distinct from item->>'latestPublicationId'
       or item->'publication'->>'raceId' is distinct from item->>'raceId'
       or item->'run'->>'raceId' is distinct from item->>'raceId'
       or not exists (select 1 from jsonb_array_elements(body->'rounds') r
         where r->>'id' = item->>'roundId' and r->>'eventEditionId' = item->>'raceEditionId')
       or item->>'raceStatus' = 'cancelled' or item->>'organizerDeletedAt' is not null
       or item->>'resultsMode' <> 'standard' then
      raise exception using errcode = '55000', message = 'reward_mapping_source_not_ready';
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(body->'competitions') c where c->>'status' <> 'active') then
    raise exception using errcode = '55000', message = 'reward_competition_not_active';
  end if;
  if jsonb_array_length(body->'rows') > 20000 or octet_length(body::text) > 8388608 then
    raise exception using errcode = '54000', message = 'reward_source_too_large';
  end if;
  -- Missing ranks, ambiguous identities/finishes and unverified records are retained
  -- for sporting diagnostics, never silently selected, repaired or excluded here.
  return body;
end
$$;

create function public.service_capture_reward_source(
  p_organization_id uuid, p_league_season_id uuid, p_round_ids uuid[], p_actor_user_id uuid, p_idempotency_key text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  captured app_private.reward_source_snapshots%rowtype;
  sorted_rounds uuid[];
  body jsonb;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception using errcode = '22023', message = 'invalid_reward_capture_key';
  end if;
  select array_agg(distinct id order by id) into sorted_rounds from unnest(p_round_ids) id;
  if p_organization_id is null or p_league_season_id is null or p_actor_user_id is null
     or coalesce(cardinality(p_round_ids), 0) not between 1 and 5
     or array_position(p_round_ids, null) is not null
     or cardinality(p_round_ids) <> cardinality(sorted_rounds) then
    raise exception using errcode = '22023', message = 'invalid_reward_source_scope';
  end if;
  -- Current object authority is required even on replay. Source changes do not
  -- rewrite an earlier capture or turn a replay into a second snapshot.
  if not exists (
    select 1 from public.league_seasons s join public.leagues l on l.id = s.league_id
    where s.id = p_league_season_id and l.organization_id = p_organization_id
  ) or public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'leagues.manage', 'organization', null
  ) is not true then
    raise exception using errcode = '42501', message = 'reward_source_permission_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key, 0));
  -- Waiting does not preserve authority. In particular, an existing-key replay
  -- must not reveal its private evidence after a committed ownership transfer.
  if not exists (
    select 1 from public.league_seasons s join public.leagues l on l.id = s.league_id
    where s.id = p_league_season_id and l.organization_id = p_organization_id
  ) or public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'leagues.manage', 'organization', null
  ) is not true then
    raise exception using errcode = '42501', message = 'reward_source_permission_required';
  end if;
  select * into captured from app_private.reward_source_snapshots
    where organization_id = p_organization_id and captured_by_user_id = p_actor_user_id and idempotency_key = p_idempotency_key;
  if found then
    if captured.league_season_id <> p_league_season_id or captured.round_ids <> sorted_rounds then
      raise exception using errcode = '22023', message = 'reward_capture_idempotency_conflict';
    end if;
  else
    body := public.service_read_reward_source(p_organization_id, p_league_season_id, p_round_ids, p_actor_user_id);
    insert into app_private.reward_source_snapshots
      (organization_id, league_season_id, round_ids, captured_by_user_id, idempotency_key, source_body, source_fingerprint_sha256)
    values (p_organization_id, p_league_season_id, sorted_rounds, p_actor_user_id, p_idempotency_key, body,
      encode(sha256(convert_to(body::text, 'UTF8')), 'hex'))
    returning * into captured;
  end if;
  return jsonb_build_object('snapshotId', captured.id, 'capturedAt', captured.captured_at,
    'sourceFingerprintSha256', captured.source_fingerprint_sha256, 'source', captured.source_body);
end
$$;

revoke all on function public.service_read_reward_source(uuid,uuid,uuid[],uuid) from public, anon, authenticated, service_role;
revoke all on function public.service_capture_reward_source(uuid,uuid,uuid[],uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.service_read_reward_source(uuid,uuid,uuid[],uuid) to service_role;
grant execute on function public.service_capture_reward_source(uuid,uuid,uuid[],uuid,text) to service_role;
comment on table app_private.reward_source_snapshots is
  'Private immutable sporting review evidence. Database-local SHA256 is NOT the salted chain allocation commitment. No rewards, approvals, wallets or consumption are created.';

commit;
