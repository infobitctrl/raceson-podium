-- Fresh Podium schema: generic fix retained; historical identity data,
-- temporary correction fixtures and identity-specific assertions omitted.
begin;
do $scoring_fix$
declare
  compute_definition text;
  old_result_filter text := $old$      and result.finish_time_ms is not null
      and result.represented_club_id is not null
  ),
  classification_ranked as ($old$;
  new_result_filter text := $new$      and result.finish_time_ms is not null
  ),
  classification_ranked as ($new$;
  old_club_filter text := $old$    from athlete_score_ranked result
    where result.athlete_score_order = 1
  ),
  club_rounds as ($old$;
  new_club_filter text := $new$    from athlete_score_ranked result
    where result.athlete_score_order = 1
      and result.club_id is not null
  ),
  club_rounds as ($new$;
  result_filter_replacement_count integer;
  club_filter_replacement_count integer;
begin
  select pg_get_functiondef(
    'public.service_compute_league_standings(uuid,uuid,uuid,text,uuid)'::regprocedure
  )
  into compute_definition;

  result_filter_replacement_count := (
    length(compute_definition) - length(replace(compute_definition, old_result_filter, ''))
  ) / length(old_result_filter);
  club_filter_replacement_count := (
    length(compute_definition) - length(replace(compute_definition, old_club_filter, ''))
  ) / length(old_club_filter);

  if result_filter_replacement_count <> 1 or club_filter_replacement_count <> 1 then
    raise exception
      'Expected one early club filter and one post-classification club filter anchor, found early %, late %',
      result_filter_replacement_count,
      club_filter_replacement_count;
  end if;

  compute_definition := replace(compute_definition, old_result_filter, new_result_filter);
  compute_definition := replace(compute_definition, old_club_filter, new_club_filter);
  execute compute_definition;
end
$scoring_fix$;
commit;
