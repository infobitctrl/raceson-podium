-- Isolated demo only. Private programme configuration and read-only event results.
begin;
create function app_private.validate_reward_setup_configuration_v3(c jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare p jsonb;
begin
 if c->'version' in ('1'::jsonb,'2'::jsonb) then return app_private.validate_reward_setup_configuration_v2(c);end if;
 if c is null or jsonb_typeof(c) is distinct from 'object' or pg_column_size(c)>262144 or c->'version' is distinct from '3'::jsonb then raise exception 'invalid_reward_setup';end if;
 if (select array_agg(key order by key) from jsonb_object_keys(c) key) is distinct from array['budgetMon','context','name','policy','root','stage','version'] then raise exception 'invalid_reward_setup';end if;
 p:=c->'policy';
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'invalid_reward_setup';end if;
 if (select array_agg(key order by key) from jsonb_object_keys(p) key) is distinct from array['claimStartsAt','claimWindowDays','expiredClaims','fewerFinishers','multipleAwards','securityPausesExtendWindow','ties','treasuryReturn'] then raise exception 'invalid_reward_setup';end if;
 if p->'claimStartsAt' is distinct from '"claims_open"'::jsonb or p->'expiredClaims' is distinct from '"fixed_treasury"'::jsonb or
  p->'fewerFinishers' is distinct from '"raceson_main_treasury"'::jsonb or p->'multipleAwards' is distinct from '"allow"'::jsonb or
  p->'securityPausesExtendWindow' is distinct from 'true'::jsonb or p->'ties' is distinct from '"split_occupied_places"'::jsonb or
  jsonb_typeof(p->'treasuryReturn') is distinct from 'string' or p->>'treasuryReturn' not in('original_sender','raceson_default') or
  jsonb_typeof(p->'claimWindowDays') is distinct from 'number' or p->>'claimWindowDays' !~ '^[0-9]+$' then raise exception 'invalid_reward_setup';end if;
 if (p->>'claimWindowDays')::numeric not between 1 and 3650 then raise exception 'invalid_reward_setup';end if;
 return app_private.validate_reward_setup_configuration_v2((c-'policy')||'{"version":2}'::jsonb);
end $$;
create or replace function app_private.validate_reward_setup_configuration(c jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare e jsonb; choice jsonb; n jsonb; item record; total numeric; seen text[]:='{}';
begin
 if c->'version' is distinct from '4'::jsonb then return app_private.validate_reward_setup_configuration_v3(c);end if;
 if jsonb_typeof(c) is distinct from 'object' or pg_column_size(c)>262144 or
 (select array_agg(key order by key) from jsonb_object_keys(c) key) is distinct from array['budgetMon','context','event','name','policy','programmeKind','root','stage','version'] or
 c->>'programmeKind' not in ('event','league') or c->>'stage' not in ('draft','ready') then raise exception 'invalid_reward_setup';end if;
 perform app_private.validate_reward_setup_configuration_v3((c-'event'-'programmeKind')||jsonb_build_object('version',3,'stage',case when c->>'programmeKind'='event' then 'draft' else c->>'stage' end));
 e:=c->'event';
 if c->>'programmeKind'='league' then
  if e is distinct from 'null'::jsonb then raise exception 'invalid_reward_setup';end if;
  return true;
 end if;
 if c->'context' is distinct from 'null'::jsonb then raise exception 'invalid_reward_setup';end if;
 if e<>'null'::jsonb then
  if jsonb_typeof(e) is distinct from 'object' or (select array_agg(key order by key) from jsonb_object_keys(e) key) is distinct from array['catalogueHash','choices','date','editionId','name'] then raise exception 'invalid_reward_setup';end if;
  if jsonb_typeof(e->'editionId') is distinct from 'string' or e->>'editionId' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or e->>'editionId'='00000000-0000-0000-0000-000000000000' or
  jsonb_typeof(e->'name') is distinct from 'string' or length(btrim(e->>'name')) not between 1 and 100 or e->>'name' ~ '[[:cntrl:]]' or
  jsonb_typeof(e->'date') is distinct from 'string' or e->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
  jsonb_typeof(e->'catalogueHash') is distinct from 'string' or e->>'catalogueHash' !~ '^[0-9a-f]{64}$' or
  jsonb_typeof(e->'choices') is distinct from 'array' then raise exception 'invalid_reward_setup';end if;
  perform (e->>'date')::date;
  if jsonb_array_length(e->'choices')>1000 then raise exception 'invalid_reward_setup';end if;
  for choice in select value from jsonb_array_elements(e->'choices') loop
   if jsonb_typeof(choice) is distinct from 'object' or (select array_agg(key order by key) from jsonb_object_keys(choice) key) is distinct from array['approved','groupKey','nodeId','raceId'] then raise exception 'invalid_reward_setup';end if;
   if jsonb_typeof(choice->'nodeId') is distinct from 'string' or jsonb_typeof(choice->'raceId') is distinct from 'string' or
   choice->>'nodeId' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or choice->>'raceId' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or
   choice->>'nodeId'='00000000-0000-0000-0000-000000000000' or choice->>'raceId'='00000000-0000-0000-0000-000000000000' or choice->>'nodeId'=any(seen) or
   jsonb_typeof(choice->'approved') is distinct from 'boolean' or jsonb_typeof(choice->'groupKey') is distinct from 'string' or choice->>'groupKey' !~ '^[a-zA-Z0-9_.:-]{1,100}$' then raise exception 'invalid_reward_setup';end if;
   seen:=array_append(seen,choice->>'nodeId');
  end loop;
 end if;
 if c->>'stage'='ready' then
  if e='null'::jsonb then raise exception 'invalid_reward_setup';end if;
  for item in with recursive tree(node) as (select c->'root' union all select child from tree cross join lateral jsonb_array_elements(node->'children') child) select * from tree loop
   n:=item.node;
   if n->'rule'='null'::jsonb then select sum((value->>'shareBps')::numeric) into total from jsonb_array_elements(n->'children');
   else
    select sum(value::text::numeric) into total from jsonb_array_elements(n->'rule'->'sharesBps');
    if n->'rule'->>'basis' not in ('race_position','club_points') or not exists(select 1 from jsonb_array_elements(e->'choices') ch where ch->'nodeId'=n->'id' and ch->'approved'='true'::jsonb and n->'rule'->>'basis'=case when ch->>'groupKey'='club' then 'club_points' else 'race_position' end) then raise exception 'invalid_reward_setup';end if;
   end if;
   if total is distinct from 10000::numeric then raise exception 'invalid_reward_setup';end if;
  end loop;
 end if;
 return true;
end $$;
-- Immutable private versions. Editing a ready programme creates a new draft revision.
create table app_private.reward_setup_revisions (
 setup_id uuid not null references app_private.reward_distribution_setups(id), revision integer not null,
 configuration jsonb not null, saved_at timestamptz not null, primary key(setup_id,revision)
);
alter table app_private.reward_setup_revisions enable row level security;
revoke all on app_private.reward_setup_revisions from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_setup_revisions to service_role;
create policy reward_setup_revisions_service_read on app_private.reward_setup_revisions for select to service_role using(true);
create policy reward_setup_revisions_service_insert on app_private.reward_setup_revisions for insert to service_role with check(true);
insert into app_private.reward_setup_revisions select id,revision,configuration,updated_at from app_private.reward_distribution_setups;
create function app_private.archive_reward_setup_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin insert into app_private.reward_setup_revisions values(new.id,new.revision,new.configuration,new.updated_at);return new;end $$;
create trigger reward_setup_revision after insert or update on app_private.reward_distribution_setups for each row execute function app_private.archive_reward_setup_revision();

create function app_private.reward_setup_event_catalogue(p_edition_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',e.id,'name',e.name,'date',e.start_date::text,'organizationName',o.name,
 'races',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'distanceKm',c.distance_km,'minimumAge',c.minimum_age,'maximumAge',c.maximum_age,'genders',c.allowed_genders,'ranking',c.ranking_config_json,'resultsMode',c.results_mode) order by c.id)
 from public.event_categories c where c.event_edition_id=e.id and c.organizer_deleted_at is null and c.status::text<>'cancelled'),'[]'::jsonb))
 from public.event_editions e join public.event_series s on s.id=e.event_series_id join public.organizations o on o.id=s.organization_id where e.id=p_edition_id and e.organizer_deleted_at is null and e.status::text<>'cancelled'
$$;
create function public.service_reward_setup_events(p_actor_user_id uuid,p_actor_session_id uuid,p_edition_id uuid default null,p_race_id uuid default null)
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
  result:=jsonb_set(result,'{catalogue}',catalogue||jsonb_build_object('catalogueHash',encode(extensions.digest(convert_to(catalogue::text,'UTF8'),'sha256'),'hex')));
  if not app_private.reward_planning_authorized(p_actor_user_id,org) then raise exception 'reward_setup_not_found';end if;
 end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 return result;
end $$;
revoke all on function app_private.validate_reward_setup_configuration_v3(jsonb),app_private.archive_reward_setup_revision(),app_private.reward_setup_event_catalogue(uuid),public.service_reward_setup_events(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.validate_reward_setup_configuration_v3(jsonb),app_private.archive_reward_setup_revision(),app_private.reward_setup_event_catalogue(uuid),public.service_reward_setup_events(uuid,uuid,uuid,uuid) to service_role;
commit;
