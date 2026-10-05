-- Keep the season-level immutable scoring pointer in sync with organizer
-- publication. Competition-specific policies remain the public source of truth;
-- this version is the frozen primary policy consumed by the standings pipeline.

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
  source_rules public.league_scoring_rules%rowtype;
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

  select rules.*
  into source_rules
  from public.league_scoring_rules rules
  where rules.league_season_id = p_league_season_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'league_scoring_rules_not_found';
  end if;

  normalized_rules := jsonb_build_object(
    'name', trim(p_name),
    'pointsTable', p_points_table_json,
    'bestNRounds', p_best_n_rounds,
    'minimumRounds', p_minimum_rounds,
    'tieBreakMethod', p_tie_break_method,
    'clubMembersPerRound', p_club_members_per_round,
    'eligibility', coalesce(p_eligibility_json, '{}'::jsonb),
    'fieldSizeProfile', source_rules.field_size_profile,
    'participationPoints', source_rules.participation_points,
    'scoringMethod', source_rules.scoring_method,
    'scoringParameters', source_rules.scoring_parameters_json
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
    field_size_profile,
    participation_points,
    scoring_method,
    scoring_parameters_json,
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
    source_rules.field_size_profile,
    source_rules.participation_points,
    source_rules.scoring_method,
    source_rules.scoring_parameters_json,
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

revoke all on function public.service_publish_league_scoring_rules(uuid,uuid,uuid,text,jsonb,integer,integer,text,integer,jsonb,uuid)
  from public, anon, authenticated;
grant execute on function public.service_publish_league_scoring_rules(uuid,uuid,uuid,text,jsonb,integer,integer,text,integer,jsonb,uuid)
  to service_role;
