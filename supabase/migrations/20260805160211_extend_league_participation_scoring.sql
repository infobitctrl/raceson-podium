-- Extend league scoring beyond a short ranked table. Places within the table
-- receive graded points; every later official finisher receives the configured
-- participation floor. DNS, DNF, and DSQ remain governed by result status and
-- never receive this finisher floor.

alter table public.league_scoring_rules
  add column if not exists field_size_profile text not null default 'custom',
  add column if not exists participation_points numeric(10, 2) not null default 0;

alter table public.league_scoring_rule_versions
  add column if not exists field_size_profile text not null default 'custom',
  add column if not exists participation_points numeric(10, 2) not null default 0;

alter table public.league_scoring_policy_versions
  add column if not exists field_size_profile text not null default 'custom',
  add column if not exists participation_points numeric(10, 2) not null default 0;

alter table public.league_scoring_rules
  add constraint league_scoring_rules_field_size_profile_check
    check (field_size_profile in ('small_up_to_50', 'medium_50_200', 'large_200_plus', 'custom')),
  add constraint league_scoring_rules_participation_points_check
    check (participation_points >= 0);

alter table public.league_scoring_rule_versions
  add constraint league_scoring_rule_versions_field_size_profile_check
    check (field_size_profile in ('small_up_to_50', 'medium_50_200', 'large_200_plus', 'custom')),
  add constraint league_scoring_rule_versions_participation_points_check
    check (participation_points >= 0);

alter table public.league_scoring_policy_versions
  add constraint league_scoring_policy_versions_field_size_profile_check
    check (field_size_profile in ('small_up_to_50', 'medium_50_200', 'large_200_plus', 'custom')),
  add constraint league_scoring_policy_versions_participation_points_check
    check (participation_points >= 0);

update public.league_scoring_rules
set field_size_profile = case jsonb_array_length(points_table_json)
  when 20 then 'small_up_to_50'
  when 50 then 'medium_50_200'
  when 100 then 'large_200_plus'
  else 'custom'
end
where field_size_profile = 'custom';

update public.league_scoring_rule_versions
set field_size_profile = case jsonb_array_length(points_table_json)
  when 20 then 'small_up_to_50'
  when 50 then 'medium_50_200'
  when 100 then 'large_200_plus'
  else 'custom'
end
where field_size_profile = 'custom';

update public.league_scoring_policy_versions
set field_size_profile = case jsonb_array_length(points_table_json)
  when 20 then 'small_up_to_50'
  when 50 then 'medium_50_200'
  when 100 then 'large_200_plus'
  else 'custom'
end
where field_size_profile = 'custom';

create or replace function public.league_points_for_place(
  p_points_table_json jsonb,
  p_participation_points numeric,
  p_finish_place integer
)
returns numeric
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_finish_place is null or p_finish_place < 1 then 0::numeric
    when p_finish_place <= jsonb_array_length(coalesce(p_points_table_json, '[]'::jsonb)) then
      coalesce(
        case jsonb_typeof(p_points_table_json -> (p_finish_place - 1))
          when 'object' then (p_points_table_json -> (p_finish_place - 1) ->> 'points')::numeric
          when 'number' then (p_points_table_json ->> (p_finish_place - 1))::numeric
          else 0::numeric
        end,
        0::numeric
      )
    else greatest(coalesce(p_participation_points, 0), 0)
  end
$function$;

revoke all on function public.league_points_for_place(jsonb,numeric,integer) from public, anon, authenticated;
grant execute on function public.league_points_for_place(jsonb,numeric,integer) to service_role;

-- Keep the existing versioned standings workflow intact while routing its two
-- individual/club point lookups through the extended scoring rule. The source
-- function is migration-owned and the exact replacement count protects against
-- silently changing an unexpected definition.
do $migration$
declare
  compute_definition text;
  legacy_lookup text := $old$coalesce(
        (rules_row.points_table_json -> (result.rank_overall - 1) ->> 'points')::numeric,
        0
      ) as points$old$;
  extended_lookup text := $new$public.league_points_for_place(
        rules_row.points_table_json,
        rules_row.participation_points,
        result.rank_overall
      ) as points$new$;
  replacement_count integer;
begin
  select pg_get_functiondef(
    'public.service_compute_league_standings(uuid,uuid,uuid,text,uuid)'::regprocedure
  ) into compute_definition;

  replacement_count := (
    length(compute_definition) - length(replace(compute_definition, legacy_lookup, ''))
  ) / length(legacy_lookup);
  if replacement_count <> 2 then
    raise exception 'Expected two league standings point lookups, found %', replacement_count;
  end if;

  execute replace(compute_definition, legacy_lookup, extended_lookup);
end
$migration$;
