begin;

-- Athlete surfaces must use the same competition-scoped result sources and
-- scoring policies as the public league page. The legacy
-- league_individual_standings table intentionally represents only the
-- compatibility/default competition and therefore cannot describe athletes
-- who race in another mapped competition (for example, Long instead of Short).
create or replace function public.public_athlete_league_competition_standings(
  p_athlete_slug text default null
)
returns table (
  athlete_profile_id uuid,
  athlete_slug text,
  league_season_id uuid,
  league_slug text,
  league_name text,
  season_name text,
  season_year integer,
  season_label text,
  competition_id uuid,
  competition_slug text,
  competition_name text,
  rank_overall integer,
  points_total numeric,
  scored_rounds integer
)
language sql
security definer
stable
set search_path = ''
as $public$
  with mapped_results as (
    select
      athlete.id as athlete_profile_id,
      athlete.slug as athlete_slug,
      athlete.display_name,
      season.id as league_season_id,
      league.slug as league_slug,
      league.name as league_name,
      season.name as season_name,
      season.year as season_year,
      season.status as season_status,
      competition.id as competition_id,
      competition.slug as competition_slug,
      competition.name as competition_name,
      policy.best_n_rounds,
      policy.minimum_rounds,
      policy.tie_break_method,
      round_event.round_number,
      result.rank_overall,
      public.league_points_for_place(
        policy.points_table_json,
        policy.participation_points,
        result.rank_overall
      ) * round_event.points_multiplier * coalesce(mapping.points_multiplier_override, 1) as points
    from public.leagues league
    join public.league_seasons season
      on season.league_id = league.id
     and season.published_at is not null
    join public.league_competitions competition
      on competition.league_season_id = season.id
     and competition.status = 'active'
     and competition.scoring_target = 'individual'
    join public.league_scoring_policy_versions policy
      on policy.id = competition.current_scoring_policy_version_id
    join public.league_round_race_mappings mapping
      on mapping.league_competition_id = competition.id
     and mapping.status = 'mapped'
    join public.league_round_events round_event
      on round_event.id = mapping.league_round_event_id
     and round_event.status <> 'cancelled'
    join public.current_published_result_rows result
      on result.event_category_id = mapping.event_category_id
     and result.result_status in ('official', 'corrected')
     and result.rank_overall is not null
     and result.finish_time_ms is not null
    join public.public_athlete_profiles athlete
      on athlete.id = result.athlete_profile_id
     and athlete.status = 'active'
    where league.status in ('active', 'published', 'completed')
  ),
  scored_candidates as (
    select
      result.*,
      row_number() over (
        partition by result.league_season_id, result.competition_id, result.athlete_profile_id
        order by result.points desc, result.rank_overall, result.round_number
      ) as score_order
    from mapped_results result
  ),
  athlete_aggregates as (
    select
      candidate.athlete_profile_id,
      candidate.athlete_slug,
      candidate.display_name,
      candidate.league_season_id,
      candidate.league_slug,
      candidate.league_name,
      candidate.season_name,
      candidate.season_year,
      candidate.season_status,
      candidate.competition_id,
      candidate.competition_slug,
      candidate.competition_name,
      candidate.minimum_rounds,
      candidate.tie_break_method,
      sum(candidate.points) filter (
        where candidate.best_n_rounds is null
          or candidate.best_n_rounds <= 0
          or candidate.score_order <= candidate.best_n_rounds
      ) as points_total,
      count(*)::integer as scored_rounds,
      count(*) filter (where candidate.rank_overall = 1)::integer as wins,
      min(candidate.rank_overall)::integer as best_finish,
      (array_agg(candidate.points order by candidate.round_number desc))[1] as last_round_points
    from scored_candidates candidate
    group by
      candidate.athlete_profile_id,
      candidate.athlete_slug,
      candidate.display_name,
      candidate.league_season_id,
      candidate.league_slug,
      candidate.league_name,
      candidate.season_name,
      candidate.season_year,
      candidate.season_status,
      candidate.competition_id,
      candidate.competition_slug,
      candidate.competition_name,
      candidate.minimum_rounds,
      candidate.tie_break_method
  ),
  ranked as (
    select
      aggregate.*,
      aggregate.scored_rounds >= aggregate.minimum_rounds as eligible,
      row_number() over (
        partition by aggregate.league_season_id, aggregate.competition_id
        order by
          (aggregate.scored_rounds >= aggregate.minimum_rounds) desc,
          aggregate.points_total desc,
          case when aggregate.tie_break_method = 'most_wins' then aggregate.wins end desc nulls last,
          case when aggregate.tie_break_method = 'best_finish' then aggregate.best_finish end asc nulls last,
          case when aggregate.tie_break_method = 'last_round' then aggregate.last_round_points end desc nulls last,
          aggregate.best_finish asc nulls last,
          aggregate.wins desc,
          aggregate.last_round_points desc,
          aggregate.display_name,
          aggregate.athlete_profile_id
      )::integer as computed_rank
    from athlete_aggregates aggregate
  ),
  season_dates as (
    select
      season.id as league_season_id,
      min(edition.start_date) as first_round_date,
      max(edition.start_date) as last_round_date
    from public.league_seasons season
    left join public.league_round_events round_event
      on round_event.league_season_id = season.id
     and round_event.status <> 'cancelled'
    left join public.event_editions edition
      on edition.id = round_event.event_edition_id
    group by season.id
  )
  select
    ranked.athlete_profile_id,
    ranked.athlete_slug,
    ranked.league_season_id,
    ranked.league_slug,
    ranked.league_name,
    ranked.season_name,
    ranked.season_year,
    case
      when dates.first_round_date is null then concat(ranked.season_name, ' ', ranked.season_year)
      when ranked.season_status = 'completed' and dates.last_round_date is not null then
        concat(
          to_char(dates.first_round_date, 'Mon YYYY'),
          ' - ',
          to_char(dates.last_round_date, 'Mon YYYY')
        )
      else concat(to_char(dates.first_round_date, 'Mon YYYY'), ' - TBA')
    end as season_label,
    ranked.competition_id,
    ranked.competition_slug,
    ranked.competition_name,
    case when ranked.eligible then ranked.computed_rank else null end as rank_overall,
    coalesce(ranked.points_total, 0) as points_total,
    ranked.scored_rounds
  from ranked
  left join season_dates dates
    on dates.league_season_id = ranked.league_season_id
  where p_athlete_slug is null or ranked.athlete_slug = trim(p_athlete_slug)
  order by
    ranked.season_year desc,
    ranked.league_name,
    ranked.competition_name,
    ranked.computed_rank,
    ranked.display_name
$public$;

revoke all on function public.public_athlete_league_competition_standings(text)
  from public, anon, authenticated;
grant execute on function public.public_athlete_league_competition_standings(text)
  to service_role;

comment on function public.public_athlete_league_competition_standings(text) is
  'Returns competition-scoped public athlete standings from the latest published mapped race results and the same scoring policies used by public league pages.';

commit;
