-- Club standings are one overall competition across every mapped race in an
-- event round. Individual Short/Long policies still determine the points each
-- athlete contributes; the club then keeps its strongest configured number of
-- performances (three for the Sitrail default) from the combined pool.

do $migration$
declare
  compute_definition text;
  source_guard_anchor text := $anchor$  end if;

  select rules.*
  into rules_row
  from public.league_scoring_rule_versions rules
  where rules.id = season_row.current_scoring_rule_version_id;$anchor$;
  source_guard_replacement text := $replacement$  end if;

  if exists (
    select 1
    from public.league_round_events round_event
    join public.league_round_race_mappings mapping
      on mapping.league_round_event_id = round_event.id
     and mapping.status = 'mapped'
    join public.league_competitions competition
      on competition.id = mapping.league_competition_id
     and competition.status <> 'archived'
    where round_event.league_season_id = p_league_season_id
      and not exists (
        select 1
        from public.result_publications publication
        where publication.event_category_id = mapping.event_category_id
          and publication.publication_state in ('official', 'corrected')
      )
  ) then
    raise exception using errcode = 'P0001', message = 'league_mapped_result_publications_incomplete';
  end if;

  select rules.*
  into rules_row
  from public.league_scoring_rule_versions rules
  where rules.id = season_row.current_scoring_rule_version_id;$replacement$;
  old_manifest text := $old$  select jsonb_build_object(
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
  where round.league_season_id = p_league_season_id;$old$;
  new_manifest text := $new$  select jsonb_build_object(
    'leagueSeasonId', p_league_season_id,
    'scoringRuleVersionId', rules_row.id,
    'scoringDigestSha256', rules_row.scoring_digest_sha256,
    'rounds', coalesce((
      select jsonb_agg(
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
      from public.league_rounds round
      join public.league_round_source_versions source
        on source.id = round.current_source_version_id
      where round.league_season_id = p_league_season_id
    ), '[]'::jsonb),
    'mappedRaceSources', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'leagueRoundEventId', round_event.id,
          'roundNumber', round_event.round_number,
          'competitionId', competition.id,
          'competitionSlug', competition.slug,
          'scoringPolicyVersionId', policy.id,
          'eventCategoryId', mapping.event_category_id,
          'resultPublicationId', publication.id,
          'resultRunId', publication.result_run_id,
          'pointsMultiplier', round_event.points_multiplier * coalesce(mapping.points_multiplier_override, 1)
        )
        order by round_event.round_number, competition.display_order, competition.id
      )
      from public.league_round_events round_event
      join public.league_round_race_mappings mapping
        on mapping.league_round_event_id = round_event.id
       and mapping.status = 'mapped'
      join public.league_competitions competition
        on competition.id = mapping.league_competition_id
       and competition.status <> 'archived'
      join public.league_scoring_policy_versions policy
        on policy.id = competition.current_scoring_policy_version_id
      join lateral (
        select candidate.*
        from public.result_publications candidate
        where candidate.event_category_id = mapping.event_category_id
          and candidate.publication_state in ('official', 'corrected')
        order by candidate.published_at desc, candidate.id desc
        limit 1
      ) publication on true
      where round_event.league_season_id = p_league_season_id
    ), '[]'::jsonb)
  )
  into source_manifest;$new$;
  old_club_scoring text := $old$  with round_results as (
    select
      round.id as league_round_id,
      round.round_number,
      source.result_publication_id,
      result.athlete_profile_id,
      result.represented_club_id as club_id,
      result.rank_overall,
      public.league_points_for_place(
        rules_row.points_table_json,
        rules_row.participation_points,
        result.rank_overall
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
  ),$old$;
  new_club_scoring text := $new$  with round_results as (
    select
      round_event.id as league_round_id,
      round_event.round_number,
      competition.id as league_competition_id,
      competition.name as competition_name,
      publication.id as result_publication_id,
      result.athlete_profile_id,
      result.represented_club_id as club_id,
      result.rank_overall,
      case coalesce(policy.club_scoring_mode, 'best_three')
        when 'best_two' then 2
        when 'best_three' then 3
        when 'best_four' then 4
        else rules_row.club_members_per_round
      end as club_member_limit,
      public.league_points_for_place(
        policy.points_table_json,
        policy.participation_points,
        result.rank_overall
      ) * round_event.points_multiplier * coalesce(mapping.points_multiplier_override, 1) as points
    from public.league_round_events round_event
    join public.league_round_race_mappings mapping
      on mapping.league_round_event_id = round_event.id
     and mapping.status = 'mapped'
    join public.league_competitions competition
      on competition.id = mapping.league_competition_id
     and competition.status <> 'archived'
    join public.league_scoring_policy_versions policy
      on policy.id = competition.current_scoring_policy_version_id
     and coalesce(policy.club_scoring_mode, 'best_three') <> 'none'
    join lateral (
      select candidate.*
      from public.result_publications candidate
      where candidate.event_category_id = mapping.event_category_id
        and candidate.publication_state in ('official', 'corrected')
      order by candidate.published_at desc, candidate.id desc
      limit 1
    ) publication on true
    join public.result_rows result
      on result.result_run_id = publication.result_run_id
    where round_event.league_season_id = p_league_season_id
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
      sum(result.points) as round_points,
      jsonb_agg(to_jsonb(result.result_publication_id) order by result.club_member_order) as result_publication_ids,
      jsonb_agg(
        jsonb_build_object(
          'athleteProfileId', result.athlete_profile_id,
          'competitionId', result.league_competition_id,
          'competitionName', result.competition_name,
          'resultPublicationId', result.result_publication_id,
          'rank', result.rank_overall,
          'points', result.points
        )
        order by result.club_member_order
      ) as members_json
    from club_member_ranked result
    where result.club_member_order <= result.club_member_limit
    group by
      result.club_id,
      result.league_round_id,
      result.round_number
  ),$new$;
  old_contribution_publication text := $old$          'resultPublicationId', club_round.result_publication_id,
          'points', club_round.round_points,$old$;
  new_contribution_publication text := $new$          'resultPublicationIds', club_round.result_publication_ids,
          'points', club_round.round_points,$new$;
  replacement_count integer;
begin
  select pg_get_functiondef(
    'public.service_compute_league_standings(uuid,uuid,uuid,text,uuid)'::regprocedure
  ) into compute_definition;

  replacement_count := (
    length(compute_definition) - length(replace(compute_definition, source_guard_anchor, ''))
  ) / length(source_guard_anchor);
  if replacement_count <> 1 then
    raise exception 'Expected one league source guard anchor, found %', replacement_count;
  end if;
  compute_definition := replace(compute_definition, source_guard_anchor, source_guard_replacement);

  replacement_count := (
    length(compute_definition) - length(replace(compute_definition, old_manifest, ''))
  ) / length(old_manifest);
  if replacement_count <> 1 then
    raise exception 'Expected one league source manifest, found %', replacement_count;
  end if;
  compute_definition := replace(compute_definition, old_manifest, new_manifest);

  replacement_count := (
    length(compute_definition) - length(replace(compute_definition, old_club_scoring, ''))
  ) / length(old_club_scoring);
  if replacement_count <> 1 then
    raise exception 'Expected one club scoring query, found %', replacement_count;
  end if;
  compute_definition := replace(compute_definition, old_club_scoring, new_club_scoring);

  replacement_count := (
    length(compute_definition) - length(replace(compute_definition, old_contribution_publication, ''))
  ) / length(old_contribution_publication);
  if replacement_count <> 1 then
    raise exception 'Expected one club publication contribution, found %', replacement_count;
  end if;
  compute_definition := replace(
    compute_definition,
    old_contribution_publication,
    new_contribution_publication
  );

  execute compute_definition;
end
$migration$;
