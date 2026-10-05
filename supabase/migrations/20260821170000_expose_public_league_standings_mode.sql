-- Public league consumers need the configured standings mode so non-points
-- competitions do not fall back to the season's legacy points rules.

create or replace function public.public_league_competition_definitions(
  p_league_season_id uuid
)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $public$
  select case
    when season.published_at is null then null
    else jsonb_build_object(
      'leagueSeasonId', season.id,
      'competitions', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', competition.id,
            'slug', competition.slug,
            'name', competition.name,
            'description', competition.description,
            'scoringTarget', competition.scoring_target,
            'resultBasis', competition.result_basis,
            'standingsMode', competition.standings_mode,
            'displayOrder', competition.display_order,
            'isDefault', competition.is_default,
            'rules', jsonb_build_object(
              'pointsTable', policy.points_table_json,
              'fieldSizeProfile', policy.field_size_profile,
              'participationPoints', policy.participation_points,
              'bestN', policy.best_n_rounds,
              'minimumRounds', policy.minimum_rounds,
              'tieBreakMethod', policy.tie_break_method,
              'clubScoringMode', policy.club_scoring_mode
            ),
            'classifications', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', classification.id,
                  'slug', classification.slug,
                  'name', classification.name,
                  'eligibility', classification.eligibility_json,
                  'awardDepth', classification.award_depth,
                  'displayOrder', classification.display_order,
                  'isDefault', classification.is_default
                )
                order by classification.display_order, classification.name, classification.id
              )
              from public.league_classifications classification
              where classification.league_competition_id = competition.id
                and classification.status = 'active'
            ), '[]'::jsonb),
            'roundMappings', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'roundId', round_event.id,
                  'roundNumber', round_event.round_number,
                  'eventEditionId', round_event.event_edition_id,
                  'eventCategoryId', mapping.event_category_id,
                  'status', round_event.status,
                  'pointsMultiplier', round_event.points_multiplier
                    * coalesce(mapping.points_multiplier_override, 1)
                )
                order by round_event.round_number, mapping.id
              )
              from public.league_round_race_mappings mapping
              join public.league_round_events round_event
                on round_event.id = mapping.league_round_event_id
              where mapping.league_competition_id = competition.id
                and mapping.status = 'mapped'
                and round_event.status <> 'cancelled'
            ), '[]'::jsonb)
          )
          order by competition.display_order, competition.name, competition.id
        )
        from public.league_competitions competition
        left join public.league_scoring_policy_versions policy
          on policy.id = competition.current_scoring_policy_version_id
        where competition.league_season_id = season.id
          and competition.status = 'active'
      ), '[]'::jsonb)
    )
  end
  from public.league_seasons season
  where season.id = p_league_season_id
$public$;

revoke all on function public.public_league_competition_definitions(uuid)
  from public;
grant execute on function public.public_league_competition_definitions(uuid)
  to anon, authenticated, service_role;

comment on function public.public_league_competition_definitions(uuid) is
  'Returns canonical public competition, standings-mode, default, classification, scoring, and race-mapping definitions for a published league season.';
