-- Club standings use the season's published tie-break policy after total
-- points. In particular, `last_round` must separate clubs that finish level on
-- season points instead of assigning both clubs rank one.

do $migration$
declare
  compute_definition text;
  old_club_ranking text := $old$  club_aggregates as (
    select
      club_round.club_id,
      sum(club_round.round_points) as points_total,
      count(*)::integer as scored_rounds,
      jsonb_agg(
        jsonb_build_object(
          'leagueRoundId', club_round.league_round_id,
          'roundNumber', club_round.round_number,
          'resultPublicationIds', club_round.result_publication_ids,
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
  )$old$;
  new_club_ranking text := $new$  club_aggregates as (
    select
      club_round.club_id,
      sum(club_round.round_points) as points_total,
      count(*)::integer as scored_rounds,
      (array_agg(
        club_round.round_points
        order by club_round.round_number desc, club_round.league_round_id desc
      ))[1] as last_round_points,
      jsonb_agg(
        jsonb_build_object(
          'leagueRoundId', club_round.league_round_id,
          'roundNumber', club_round.round_number,
          'resultPublicationIds', club_round.result_publication_ids,
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
        order by
          aggregate.points_total desc,
          case
            when rules_row.tie_break_method = 'last_round'
              then aggregate.last_round_points
          end desc nulls last,
          aggregate.scored_rounds desc
      )::integer as computed_rank
    from club_aggregates aggregate
  )$new$;
  replacement_count integer;
begin
  select pg_get_functiondef(
    'public.service_compute_league_standings(uuid,uuid,uuid,text,uuid)'::regprocedure
  ) into compute_definition;

  replacement_count := (
    length(compute_definition) - length(replace(compute_definition, old_club_ranking, ''))
  ) / length(old_club_ranking);
  if replacement_count <> 1 then
    raise exception 'Expected one league club ranking block, found %', replacement_count;
  end if;

  execute replace(compute_definition, old_club_ranking, new_club_ranking);
end
$migration$;

do $validation$
declare
  compute_definition text;
begin
  select pg_get_functiondef(
    'public.service_compute_league_standings(uuid,uuid,uuid,text,uuid)'::regprocedure
  ) into compute_definition;

  if position(
    'when rules_row.tie_break_method = ''last_round''' in compute_definition
  ) = 0 or position('aggregate.last_round_points' in compute_definition) = 0 then
    raise exception 'League club last-round tie-break was not installed';
  end if;
end
$validation$;
