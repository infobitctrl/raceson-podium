-- A recurrence rule name is a display label, not a season-scoped identifier.
-- Organizers commonly keep the default label while defining consecutive
-- timetable phases with different date ranges and weekdays.
alter table public.league_recurrence_rules
  drop constraint if exists league_recurrence_rules_league_season_id_name_key;
