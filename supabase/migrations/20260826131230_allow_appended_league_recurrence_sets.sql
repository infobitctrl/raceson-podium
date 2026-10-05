begin;

-- Generated rounds are durable season history. When the organizer changes the
-- weekly pattern, the existing replacement trigger archives the materialized
-- rule and makes the new definition active. Blocking the insert forced users
-- to delete valid rounds instead of appending the next schedule segment.
drop trigger if exists league_recurrence_rules_block_generated_replacement
on public.league_recurrence_rules;

drop function if exists public.block_generated_league_schedule_replacement();

comment on function public.replace_previous_active_league_recurrence_rule() is
  'Keeps one editable active recurrence definition per league season while archiving generated rules so later schedule segments can be appended without changing existing rounds.';

commit;
