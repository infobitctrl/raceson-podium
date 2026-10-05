-- Round numbers are presentation and scoring order. Keep them aligned with the
-- linked event dates even when an earlier recurring occurrence is generated
-- after later occurrences already exist.

with season_offsets as (
  select
    round_event.league_season_id,
    max(round_event.round_number) + count(*)::integer + 1 as offset
  from public.league_round_events round_event
  group by round_event.league_season_id
)
update public.league_round_events round_event
set round_number = round_event.round_number + season_offsets.offset
from season_offsets
where season_offsets.league_season_id = round_event.league_season_id;

with chronological_rounds as (
  select
    round_event.id,
    row_number() over (
      partition by round_event.league_season_id
      order by edition.start_date nulls last, round_event.event_edition_id, round_event.id
    )::integer as chronological_round_number
  from public.league_round_events round_event
  join public.event_editions edition
    on edition.id = round_event.event_edition_id
)
update public.league_round_events round_event
set round_number = chronological_rounds.chronological_round_number
from chronological_rounds
where chronological_rounds.id = round_event.id;

with season_offsets as (
  select
    round.league_season_id,
    max(round.round_number) + count(*)::integer + 1 as offset
  from public.league_rounds round
  group by round.league_season_id
)
update public.league_rounds round
set round_number = round.round_number + season_offsets.offset
from season_offsets
where season_offsets.league_season_id = round.league_season_id;

with chronological_rounds as (
  select
    round.id,
    row_number() over (
      partition by round.league_season_id
      order by edition.start_date nulls last, round.event_edition_id, round.id
    )::integer as chronological_round_number
  from public.league_rounds round
  join public.event_editions edition
    on edition.id = round.event_edition_id
)
update public.league_rounds round
set round_number = chronological_rounds.chronological_round_number
from chronological_rounds
where chronological_rounds.id = round.id;
