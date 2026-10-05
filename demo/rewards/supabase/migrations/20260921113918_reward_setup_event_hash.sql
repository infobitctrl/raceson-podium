-- Built-in SHA256 works in both Supabase and disposable PostgreSQL; no extension schema dependency.
begin;
create or replace function public.service_reward_setup_events(p_actor_user_id uuid,p_actor_session_id uuid,p_edition_id uuid default null,p_race_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare org uuid; result jsonb; catalogue jsonb;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_edition_id is null then
  if p_race_id is not null then raise exception 'invalid_reward_setup';end if;
  select coalesce(jsonb_agg(x.doc order by x.date desc,x.id),'[]'::jsonb) into result from (
   select e.id,e.start_date as date,jsonb_build_object('id',e.id,'name',e.name,'date',e.start_date::text,'organizationName',o.name) doc
   from public.event_editions e join public.event_series s on s.id=e.event_series_id join public.organizations o on o.id=s.organization_id
   where e.organizer_deleted_at is null and e.status::text<>'cancelled' and app_private.reward_planning_authorized(p_actor_user_id,o.id)
   order by e.start_date desc,e.id limit 501) x;
 else
  select s.organization_id into org from public.event_editions e join public.event_series s on s.id=e.event_series_id where e.id=p_edition_id and e.organizer_deleted_at is null and e.status::text<>'cancelled';
  if org is null or not app_private.reward_planning_authorized(p_actor_user_id,org) then raise exception 'reward_setup_not_found';end if;
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=org for share;
  perform 1 from public.organizations where id=org for share;
  if p_race_id is not null and not exists(select 1 from public.event_categories where id=p_race_id and event_edition_id=p_edition_id and organizer_deleted_at is null and status::text<>'cancelled') then raise exception 'reward_setup_not_found';end if;
  -- Catalogue, publication, run and result rows are read from a single snapshot.
  select jsonb_build_object('catalogue',app_private.reward_setup_event_catalogue(p_edition_id),'publication',case when p.id is null then null else jsonb_build_object('id',p.id,'state',p.publication_state,'publishedAt',p.published_at,'runStatus',run.status,'runRaceId',run.event_category_id,'completed',run.completed_at is not null) end,
   'expectedCount',(select count(*) from public.result_rows rr where rr.result_run_id=p.result_run_id),
   'rows',coalesce((select jsonb_agg(jsonb_build_object('id',rr.id,'athleteId',rr.athlete_profile_id,'name',ap.display_name,'gender',ap.gender,
   'age',case when ap.date_of_birth is not null then extract(year from age(e.start_date,ap.date_of_birth))::integer else null end,
   'clubId',rr.represented_club_id,'clubName',cl.name,'status',rr.result_status,'participation',reg.participation_status,'finishTimeMs',rr.finish_time_ms,'rank',rr.rank_overall,
   'valid',reg.athlete_profile_id=rr.athlete_profile_id and reg.event_category_id=rr.event_category_id and rr.event_category_id=p_race_id and ap.status='active' and ap.merged_into_athlete_profile_id is null) order by rr.id)
   from (select * from public.result_rows where result_run_id=p.result_run_id order by id limit 10001) rr
   left join public.registrations reg on reg.id=rr.registration_id left join public.athlete_profiles ap on ap.id=rr.athlete_profile_id left join public.clubs cl on cl.id=rr.represented_club_id),'[]'::jsonb)) into result
  from public.event_editions e left join lateral (select * from public.result_publications where event_category_id=p_race_id order by published_at desc,created_at desc,id desc limit 1) p on true
  left join public.result_runs run on run.id=p.result_run_id where e.id=p_edition_id;
  catalogue:=result->'catalogue';
  result:=jsonb_set(result,'{catalogue}',catalogue||jsonb_build_object('catalogueHash',encode(sha256(convert_to(catalogue::text,'UTF8')),'hex')));
  if not app_private.reward_planning_authorized(p_actor_user_id,org) then raise exception 'reward_setup_not_found';end if;
 end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 return result;
end $$;
commit;
