-- The selected Šibenska Trail Liga recovery retained official represented-club
-- result rows, but recovered race categories inherited the platform default
-- that disables club rankings. The legacy live source has valid team standings
-- for these races, so restore the intended best-three-by-place presentation for
-- publication-backed legacy result runs only.

update public.event_categories category
set ranking_config_json = jsonb_set(
  coalesce(category.ranking_config_json, '{}'::jsonb),
  '{team}',
  coalesce(category.ranking_config_json -> 'team', '{}'::jsonb)
    || jsonb_build_object(
      'enabled', true,
      'mode', 'club',
      'label', 'Club / Team',
      'scoringMethod', 'best_three_by_place',
      'scoringCount', 3
    ),
  true
)
where category.results_mode <> 'informative_age'
  and coalesce((category.ranking_config_json -> 'team' ->> 'enabled')::boolean, false) = false
  and exists (
    select 1
    from public.current_published_result_rows result
    join public.result_runs run on run.id = result.result_run_id
    where result.event_category_id = category.id
      and result.represented_club_id is not null
      and result.rank_overall is not null
      and run.summary_json ->> 'sourceProjectRef' = 'gnnmnhhvujdvyohcidki'
  );

do $$
begin
  if exists (
    select 1
    from public.current_published_result_rows result
    join public.result_runs run on run.id = result.result_run_id
    join public.event_categories category on category.id = result.event_category_id
    where result.represented_club_id is not null
      and result.rank_overall is not null
      and run.summary_json ->> 'sourceProjectRef' = 'gnnmnhhvujdvyohcidki'
      and coalesce((category.ranking_config_json -> 'team' ->> 'enabled')::boolean, false) = false
  ) then
    raise exception 'Recovered legacy club ranking configuration remains disabled';
  end if;
end
$$;
