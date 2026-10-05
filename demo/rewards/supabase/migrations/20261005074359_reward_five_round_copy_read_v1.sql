begin;
-- Operator-only read projection of the isolated copy. No review/claim authority.
create function public.operator_read_reward_five_round_copy_v1(batch_hash text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare batch app_private.reward_demo_copy_batches; season public.league_seasons;
begin
 select * into strict batch from app_private.reward_demo_copy_batches where file_sha256=batch_hash;
 if batch.target_project_ref<>'niklhlmljiikwbkrmapw' or batch.closed_after_round<>5 then
  raise exception 'invalid_copy_scope'; end if;
 select distinct s.* into strict season from public.league_seasons s
 join public.league_round_events e on e.league_season_id=s.id
 join public.league_round_race_mappings m on m.league_round_event_id=e.id
 join public.result_publications p on p.id=m.current_result_publication_id
 where p.demo_copy_batch_sha256=batch_hash;
 if season.status<>'completed' or season.club_scoring_scope<>'combined' then raise exception 'invalid_copy_season'; end if;
 -- This adapter understands finish-place integer points and the copied best-three
 -- combined club policy. A changed/unsupported policy requires another adapter.
 if exists(select 1 from public.league_competitions c
  join public.league_scoring_policy_versions p on p.id=c.current_scoring_policy_version_id
  where c.league_season_id=season.id and (c.result_basis<>'finish_place' or c.scoring_target<>'individual'
   or c.standings_mode<>'points' or p.club_scoring_mode<>'best_three'
   or p.participation_points<>trunc(p.participation_points)
   or p.result_status_policy_json<>'{"dnf":"zero","dns":"zero","dsq":"excluded"}'::jsonb)) then raise exception 'unsupported_copy_policy'; end if;
 if exists(select 1 from public.league_round_events e where e.league_season_id=season.id
  and (e.status<>'completed' or e.round_number not between 1 and 5 or e.points_multiplier<>1)) then raise exception 'unsupported_copy_round'; end if;
 return (
 with races as (
  select r.id,e.id round_id,e.round_number,c.id competition_id,p.id publication_id,p.result_run_id,
   p.publication_state,p.published_at,r.distance_km
  from public.league_round_events e
  join public.league_round_race_mappings m on m.league_round_event_id=e.id
  join public.league_competitions c on c.id=m.league_competition_id and c.league_season_id=season.id
  join public.event_categories r on r.id=m.event_category_id and r.event_edition_id=e.event_edition_id
  join public.result_publications p on p.id=m.current_result_publication_id and p.event_category_id=r.id
  where e.league_season_id=season.id and p.demo_copy_batch_sha256=batch_hash
   and r.status='completed' and r.results_mode='standard' and r.course_format='standard'
 ), results as (
  select r.*,m.publication_id,m.classification_ids,g.participation_status
  from app_private.reward_demo_copy_results m join public.result_rows r on r.id=m.result_id
  join public.registrations g on g.id=r.registration_id and g.athlete_profile_id=r.athlete_profile_id
   and g.event_category_id=r.event_category_id and g.represented_club_id is not distinct from r.represented_club_id
  join races x on x.id=r.event_category_id and x.result_run_id=r.result_run_id and x.publication_id=m.publication_id
  where m.batch_sha256=batch_hash
 )
 select jsonb_build_object(
  'version','raceson-five-round-copy-v1','batchSha256',batch.file_sha256,'sportingSha256',batch.sporting_sha256,
  'leagueId',season.league_id,'seasonId',season.id,'closedAfterRound',batch.closed_after_round,'clubScoringScope',season.club_scoring_scope,
  'capturedAt',to_char(batch.source_captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'athletes',(select jsonb_agg(jsonb_build_object('id',a.id,'ordinal',m.ordinal,'name',a.display_name,'username',m.username) order by a.id)
   from app_private.reward_demo_copy_athletes m join public.athlete_profiles a on a.id=m.athlete_id where m.batch_sha256=batch_hash),
  'clubs',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.id) from public.clubs c
   where exists(select 1 from results r where r.represented_club_id=c.id)),'[]'::jsonb),
  'classifications',(select jsonb_agg(jsonb_build_object('id',d.id,'competitionId',c.id,'name',d.name) order by d.id)
   from public.league_classifications d join public.league_competitions c on c.id=d.league_competition_id where c.league_season_id=season.id),
  'policies',(select jsonb_agg(jsonb_build_object('id',c.id,'points',p.points_table_json,'participationPoints',p.participation_points,
   'bestN',p.best_n_rounds,'minimumRounds',p.minimum_rounds,'tieBreak',p.tie_break_method,'clubMode',p.club_scoring_mode) order by c.id)
   from public.league_competitions c join public.league_scoring_policy_versions p on p.id=c.current_scoring_policy_version_id where c.league_season_id=season.id),
  'races',(select jsonb_agg(jsonb_build_object('id',x.id,'roundId',x.round_id,'slot',x.round_number,'competitionId',x.competition_id,
   'publicationId',x.publication_id,'runId',x.result_run_id,'publicationState',x.publication_state,
   'publishedAt',to_char(x.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'distanceMetres',(x.distance_km*1000)::bigint::text,'resultCount',(select count(*) from results r where r.event_category_id=x.id)) order by x.id) from races x),
  'results',(select jsonb_agg(jsonb_build_object('id',r.id,'registrationId',r.registration_id,'raceId',r.event_category_id,
   'athleteId',r.athlete_profile_id,'clubId',r.represented_club_id,'publicationId',r.publication_id,'runId',r.result_run_id,
   'status',r.participation_status,'finishTimeMs',r.finish_time_ms::text,'rankOverall',r.rank_overall,'classificationIds',r.classification_ids) order by r.id) from results r)
  ));
end;
$$;
revoke all on function public.operator_read_reward_five_round_copy_v1(text) from public,anon,authenticated,service_role;
comment on function public.operator_read_reward_five_round_copy_v1(text) is
 'Operator-only frozen-copy projection. Caller must verify an independently pinned projection hash. No source review, identity consent, wallet or payment authorization.';
commit;
