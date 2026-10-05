-- Preserve confirmed league participation even when no configured classification matches.
-- Do not infer gender/age or award points/ranks without classification eligibility.
-- The existing classification scoring calculation and function grants are unchanged.

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
  with mapped_result_base as (
    select
      athlete.id as athlete_profile_id,
      athlete.slug as athlete_slug,
      athlete.display_name,
      upper(coalesce(source_athlete.gender::text, '')) as athlete_gender,
      case
        when coalesce(
          registration.birth_year_snapshot,
          source_athlete.birth_year,
          extract(year from source_athlete.date_of_birth)::smallint
        ) between 1900 and season.year
        then (
          season.year - coalesce(
            registration.birth_year_snapshot,
            source_athlete.birth_year,
            extract(year from source_athlete.date_of_birth)::smallint
          )
        )::numeric
        else null
      end as athlete_age,
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
      policy.points_table_json,
      policy.participation_points,
      round_event.id as league_round_id,
      round_event.round_number,
      result.rank_overall as race_rank,
      round_event.points_multiplier * coalesce(mapping.points_multiplier_override, 1) as points_multiplier
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
    join public.athlete_profiles source_athlete
      on source_athlete.id = result.athlete_profile_id
    join public.registrations registration
      on registration.id = result.registration_id
     and registration.athlete_profile_id = result.athlete_profile_id
    where league.status in ('active', 'published', 'completed')
  ),
  classification_ranked as (
    select
      result.*,
      classification.id as classification_id,
      row_number() over (
        partition by
          result.league_season_id,
          result.competition_id,
          result.league_round_id,
          classification.id
        order by result.race_rank, result.athlete_profile_id
      )::integer as classification_rank
    from mapped_result_base result
    join lateral (
      select configured.id
      from public.league_classifications configured
      where configured.league_competition_id = result.competition_id
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
      select null::uuid
      where not exists (
        select 1
        from public.league_classifications configured
        where configured.league_competition_id = result.competition_id
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
  athlete_round_scored as (
    select
      candidate.*,
      row_number() over (
        partition by
          candidate.league_season_id,
          candidate.competition_id,
          candidate.league_round_id,
          candidate.athlete_profile_id
        order by
          candidate.points desc,
          candidate.classification_rank,
          candidate.race_rank,
          candidate.classification_id nulls first
      ) as athlete_round_score_order
    from classification_scored candidate
  ),
  mapped_results as (
    select
      candidate.*,
      candidate.classification_rank as scoring_rank,
      candidate.race_rank as rank_overall
    from athlete_round_scored candidate
    where candidate.athlete_round_score_order = 1
  ),
  scored_candidates as (
    select
      result.*,
      row_number() over (
        partition by result.league_season_id, result.competition_id, result.athlete_profile_id
        order by result.points desc, result.scoring_rank, result.rank_overall, result.round_number
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
      count(*) filter (where candidate.scoring_rank = 1)::integer as wins,
      min(candidate.scoring_rank)::integer as best_finish,
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
  union all
  select
    participant.athlete_profile_id,
    participant.athlete_slug,
    participant.league_season_id,
    participant.league_slug,
    participant.league_name,
    participant.season_name,
    participant.season_year,
    case
      when dates.first_round_date is null then concat(participant.season_name, ' ', participant.season_year)
      when participant.season_status = 'completed' and dates.last_round_date is not null then
        concat(
          to_char(dates.first_round_date, 'Mon YYYY'),
          ' - ',
          to_char(dates.last_round_date, 'Mon YYYY')
        )
      else concat(to_char(dates.first_round_date, 'Mon YYYY'), ' - TBA')
    end as season_label,
    participant.competition_id,
    participant.competition_slug,
    participant.competition_name,
    null::integer as rank_overall,
    0::numeric as points_total,
    0::integer as scored_rounds
  from (
    select distinct
      result.athlete_profile_id, result.athlete_slug,
      result.league_season_id, result.league_slug, result.league_name,
      result.season_name, result.season_year, result.season_status,
      result.competition_id, result.competition_slug, result.competition_name
    from mapped_result_base result
    where not exists (
      select 1 from ranked scored
      where scored.athlete_profile_id = result.athlete_profile_id
        and scored.competition_id = result.competition_id
    )
  ) participant
  left join season_dates dates
    on dates.league_season_id = participant.league_season_id
  where p_athlete_slug is null or participant.athlete_slug = trim(p_athlete_slug)
  order by season_year desc, league_name, competition_name, rank_overall nulls last, athlete_slug
$public$;

comment on function public.public_athlete_league_competition_standings(text) is
  'Returns classification-scored competition standings plus official finishers without an eligible classification as unranked participants with zero points and zero scored rounds. Existing scoring and privacy boundaries are preserved.';
