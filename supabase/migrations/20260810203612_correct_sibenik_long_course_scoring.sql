-- The legacy Ši Trail source scores long-course gender classifications with
-- the official 100-point curve rather than the generic generated curve that
-- was imported into the candidate project. Keep scoring policy history
-- append-only and move the Long competition pointer to the corrected version.

do $migration$
declare
  competition_row record;
  corrected_policy_id uuid;
  next_version integer;
begin
  for competition_row in
    select
      competition.id,
      competition.current_scoring_policy_version_id
    from public.league_competitions competition
    join public.league_seasons season
      on season.id = competition.league_season_id
    join public.leagues league
      on league.id = season.league_id
    where league.slug in ('sibenska-trail-liga', 's-i-trail-liga', 'si-trail-liga')
      and season.year = 2026
      and competition.status <> 'archived'
      and (
        competition.slug in ('long', 'velika')
        or lower(trim(competition.name)) in ('long', 'velika')
      )
  loop
    corrected_policy_id := null;

    select coalesce(max(policy.version_number), 0) + 1
    into next_version
    from public.league_scoring_policy_versions policy
    where policy.league_competition_id = competition_row.id;

    insert into public.league_scoring_policy_versions (
      league_competition_id,
      version_number,
      name,
      points_table_json,
      best_n_rounds,
      minimum_rounds,
      tie_break_method,
      club_scoring_mode,
      result_status_policy_json,
      field_size_profile,
      participation_points,
      scoring_method,
      scoring_parameters_json,
      change_note
    )
    select
      competition_row.id,
      next_version,
      'Official Ši Trail long-course scoring',
      '[100,85,75,70,65,62,59,56,53,50,48,46,44,42,40,39,38,37,36,35,34,33,32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6]'::jsonb,
      current_policy.best_n_rounds,
      current_policy.minimum_rounds,
      current_policy.tie_break_method,
      current_policy.club_scoring_mode,
      current_policy.result_status_policy_json,
      'custom',
      5,
      'custom',
      jsonb_build_object(
        'source', 'https://sitrail.com/rezultati',
        'course', 'long',
        'verifiedAt', '2026-08-10'
      ),
      'Corrected to the official Ši Trail long-course curve: 1st=100, 2nd=85, 3rd=75, and 50th onward=5.'
    from public.league_scoring_policy_versions current_policy
    where current_policy.id = competition_row.current_scoring_policy_version_id
    returning id into corrected_policy_id;

    if corrected_policy_id is not null then
      update public.league_competitions competition
      set current_scoring_policy_version_id = corrected_policy_id
      where competition.id = competition_row.id;
    end if;
  end loop;
end
$migration$;
