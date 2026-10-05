-- A league may publish standings while later rounds are already scheduled.
-- Only completed rounds require an immutable result source; the previous guard
-- blocked every recalculation as soon as a future round was added to a season.

do $migration$
declare
  compute_definition text;
  old_round_guard text := $old$  if not exists (
    select 1
    from public.league_rounds round
    where round.league_season_id = p_league_season_id
  ) or exists (
    select 1
    from public.league_rounds round
    where round.league_season_id = p_league_season_id
      and round.current_source_version_id is null
  ) then
    raise exception using errcode = 'P0001', message = 'league_round_sources_incomplete';
  end if;$old$;
  new_round_guard text := $new$  if not exists (
    select 1
    from public.league_rounds round
    where round.league_season_id = p_league_season_id
      and round.current_source_version_id is not null
  ) or exists (
    select 1
    from public.league_rounds round
    where round.league_season_id = p_league_season_id
      and round.status = 'completed'
      and round.current_source_version_id is null
  ) then
    raise exception using errcode = 'P0001', message = 'league_round_sources_incomplete';
  end if;$new$;
  old_mapping_guard text := $old$  if exists (
    select 1
    from public.league_round_events round_event
    join public.league_round_race_mappings mapping
      on mapping.league_round_event_id = round_event.id
     and mapping.status = 'mapped'
    join public.league_competitions competition
      on competition.id = mapping.league_competition_id
     and competition.status <> 'archived'
    where round_event.league_season_id = p_league_season_id
      and mapping.current_source_version_id is null
  ) then
    raise exception using errcode = 'P0001', message = 'league_mapped_source_versions_incomplete';
  end if;$old$;
  new_mapping_guard text := $new$  if exists (
    select 1
    from public.league_round_events round_event
    join public.league_round_race_mappings mapping
      on mapping.league_round_event_id = round_event.id
     and mapping.status = 'mapped'
    join public.league_competitions competition
      on competition.id = mapping.league_competition_id
     and competition.status <> 'archived'
    where round_event.league_season_id = p_league_season_id
      and round_event.status = 'completed'
      and mapping.current_source_version_id is null
  ) then
    raise exception using errcode = 'P0001', message = 'league_mapped_source_versions_incomplete';
  end if;$new$;
  replacement_count integer;
begin
  select pg_get_functiondef(
    'public.service_compute_league_standings(uuid,uuid,uuid,text,uuid)'::regprocedure
  ) into compute_definition;

  replacement_count := (
    length(compute_definition) - length(replace(compute_definition, old_round_guard, ''))
  ) / length(old_round_guard);
  if replacement_count <> 1 then
    raise exception 'Expected one all-round source guard, found %', replacement_count;
  end if;
  compute_definition := replace(compute_definition, old_round_guard, new_round_guard);

  replacement_count := (
    length(compute_definition) - length(replace(compute_definition, old_mapping_guard, ''))
  ) / length(old_mapping_guard);
  if replacement_count <> 1 then
    raise exception 'Expected one all-mapping source guard, found %', replacement_count;
  end if;
  compute_definition := replace(compute_definition, old_mapping_guard, new_mapping_guard);

  execute compute_definition;
end
$migration$;
