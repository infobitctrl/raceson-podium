-- Fresh Podium schema: generic fix retained; historical identity data,
-- temporary correction fixtures and identity-specific assertions omitted.
begin;
do $standings_job_fix$
declare
  process_job_definition text;
  old_job_round_guard text := $old$    and not exists (
      select 1 from public.league_rounds round
      where round.league_season_id = season_row.id
        and round.current_source_version_id is null
    )$old$;
  new_job_round_guard text := $new$    and not exists (
      select 1 from public.league_rounds round
      where round.league_season_id = season_row.id
        and round.status = 'completed'
        and round.current_source_version_id is null
    )$new$;
  old_job_mapping_guard text := $old$      where round_event.league_season_id = season_row.id
        and (
          mapping.current_source_version_id is null
          or competition.current_scoring_policy_version_id is null
        )$old$;
  new_job_mapping_guard text := $new$      where round_event.league_season_id = season_row.id
        and round_event.status = 'completed'
        and (
          mapping.current_source_version_id is null
          or competition.current_scoring_policy_version_id is null
        )$new$;
  round_guard_count integer;
  mapping_guard_count integer;
begin
  select pg_get_functiondef(
    'public.service_process_league_standings_job(uuid,uuid)'::regprocedure
  )
  into process_job_definition;

  round_guard_count := (
    length(process_job_definition) - length(replace(process_job_definition, old_job_round_guard, ''))
  ) / length(old_job_round_guard);
  mapping_guard_count := (
    length(process_job_definition) - length(replace(process_job_definition, old_job_mapping_guard, ''))
  ) / length(old_job_mapping_guard);

  if round_guard_count <> 1 or mapping_guard_count <> 1 then
    raise exception
      'Expected one standings-job round guard and one mapping guard, found round %, mapping %',
      round_guard_count,
      mapping_guard_count;
  end if;

  process_job_definition := replace(
    process_job_definition,
    old_job_round_guard,
    new_job_round_guard
  );
  process_job_definition := replace(
    process_job_definition,
    old_job_mapping_guard,
    new_job_mapping_guard
  );
  execute process_job_definition;
end
$standings_job_fix$;
commit;
