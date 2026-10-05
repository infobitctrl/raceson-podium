-- Club contributors must be selected from the league scores shown on the
-- public competition boards. The previous combined scorer converted each
-- athlete's raw race-overall place directly to points, even when the published
-- league competition ranked Female/Male or age classifications separately.
-- Rank every eligible classification first, keep an athlete's strongest score
-- in the round, and only then select the configured number of club members.

do $migration$
declare
  compute_definition text;
  old_club_scoring text := $old$  with round_results as (
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
    join public.league_round_mapping_source_versions mapping_source
      on mapping_source.id = mapping.current_source_version_id
    join public.result_publications publication
      on publication.id = mapping_source.result_publication_id
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
  ),$old$;
  new_club_scoring text := $new$  with round_results as (
    select
      round_event.id as league_round_id,
      round_event.round_number,
      competition.id as league_competition_id,
      competition.name as competition_name,
      policy.points_table_json,
      policy.participation_points,
      publication.id as result_publication_id,
      result.athlete_profile_id,
      result.represented_club_id as club_id,
      result.rank_overall as race_rank,
      upper(coalesce(athlete.gender::text, '')) as athlete_gender,
      case
        when athlete.date_of_birth is null then null
        else extract(
          year from age(make_date(season_row.year, 12, 31), athlete.date_of_birth)
        )::numeric
      end as athlete_age,
      round_event.points_multiplier * coalesce(mapping.points_multiplier_override, 1) as points_multiplier
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
    join public.league_round_mapping_source_versions mapping_source
      on mapping_source.id = mapping.current_source_version_id
    join public.result_publications publication
      on publication.id = mapping_source.result_publication_id
    join public.result_rows result
      on result.result_run_id = publication.result_run_id
    join public.athlete_profiles athlete
      on athlete.id = result.athlete_profile_id
    where round_event.league_season_id = p_league_season_id
      and result.result_status in ('official', 'corrected')
      and result.rank_overall is not null
      and result.finish_time_ms is not null
      and result.represented_club_id is not null
  ),
  classification_ranked as (
    select
      result.*,
      classification.id as classification_id,
      classification.name as classification_name,
      row_number() over (
        partition by
          result.league_round_id,
          result.league_competition_id,
          classification.id
        order by result.race_rank, result.athlete_profile_id
      )::integer as classification_rank
    from round_results result
    join lateral (
      select
        configured.id,
        configured.name
      from public.league_classifications configured
      where configured.league_competition_id = result.league_competition_id
        and configured.status = 'active'
        and (
          configured.eligibility_json ->> 'gender' is null
          or upper(configured.eligibility_json ->> 'gender') = result.athlete_gender
        )
        and (
          configured.eligibility_json ->> 'minimumAge' is null
          or (
            result.athlete_age is not null
            and result.athlete_age >= (configured.eligibility_json ->> 'minimumAge')::numeric
          )
        )
        and (
          configured.eligibility_json ->> 'maximumAge' is null
          or (
            result.athlete_age is not null
            and result.athlete_age <= (configured.eligibility_json ->> 'maximumAge')::numeric
          )
        )
      union all
      select
        null::uuid as id,
        'Overall'::text as name
      where not exists (
        select 1
        from public.league_classifications configured
        where configured.league_competition_id = result.league_competition_id
          and configured.status = 'active'
      )
    ) classification on true
  ),
  classification_scored as (
    select
      candidate.*,
      public.league_points_for_place(
        candidate.points_table_json,
        candidate.participation_points,
        candidate.classification_rank
      ) * candidate.points_multiplier as points
    from classification_ranked candidate
  ),
  athlete_score_ranked as (
    select
      candidate.*,
      row_number() over (
        partition by candidate.league_round_id, candidate.athlete_profile_id
        order by
          candidate.points desc,
          candidate.classification_rank,
          candidate.race_rank,
          candidate.league_competition_id,
          candidate.classification_id nulls first
      ) as athlete_score_order
    from classification_scored candidate
  ),
  club_member_ranked as (
    select
      result.*,
      row_number() over (
        partition by result.league_round_id, result.club_id
        order by
          result.points desc,
          result.classification_rank,
          result.race_rank,
          result.athlete_profile_id
      ) as club_member_order
    from athlete_score_ranked result
    where result.athlete_score_order = 1
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
          'classificationId', result.classification_id,
          'classificationName', result.classification_name,
          'resultPublicationId', result.result_publication_id,
          'rank', result.classification_rank,
          'raceRank', result.race_rank,
          'points', result.points
        )
        order by result.club_member_order
      ) as members_json
    from club_member_ranked result
    where result.club_member_order <= rules_row.club_members_per_round
    group by
      result.club_id,
      result.league_round_id,
      result.round_number
  ),$new$;
  replacement_count integer;
begin
  select pg_get_functiondef(
    'public.service_compute_league_standings(uuid,uuid,uuid,text,uuid)'::regprocedure
  ) into compute_definition;

  replacement_count := (
    length(compute_definition) - length(replace(compute_definition, old_club_scoring, ''))
  ) / length(old_club_scoring);
  if replacement_count <> 1 then
    raise exception 'Expected one raw-place club scoring query, found %', replacement_count;
  end if;

  compute_definition := replace(compute_definition, old_club_scoring, new_club_scoring);
  execute compute_definition;
end
$migration$;
