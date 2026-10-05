begin;
-- Isolated demo overlay only. Copy provenance is not source consent or an award.
create table app_private.reward_demo_copy_batches (
  file_sha256 text primary key check(file_sha256 ~ '^[0-9a-f]{64}$'),
  sporting_sha256 text not null check(sporting_sha256 ~ '^[0-9a-f]{64}$'),
  target_project_ref text not null check(target_project_ref='niklhlmljiikwbkrmapw'),
  source_captured_at timestamptz not null,
  closed_after_round integer not null check(closed_after_round=5),
  imported_at timestamptz not null default clock_timestamp()
);
create table app_private.reward_demo_copy_athletes (
  athlete_id uuid primary key references public.athlete_profiles(id),
  batch_sha256 text not null references app_private.reward_demo_copy_batches(file_sha256),
  ordinal integer not null unique check(ordinal between 1 and 274),
  username text not null unique check(username='racesmon'||ordinal::text)
);
create table app_private.reward_demo_copy_results (
  result_id uuid primary key references public.result_rows(id),
  batch_sha256 text not null references app_private.reward_demo_copy_batches(file_sha256),
  publication_id uuid not null references public.result_publications(id),
  classification_ids uuid[] not null
);
alter table app_private.reward_demo_copy_batches enable row level security;
alter table app_private.reward_demo_copy_athletes enable row level security;
alter table app_private.reward_demo_copy_results enable row level security;
revoke all on app_private.reward_demo_copy_batches,app_private.reward_demo_copy_athletes,app_private.reward_demo_copy_results from public,anon,authenticated,service_role;
grant select on app_private.reward_demo_copy_batches,app_private.reward_demo_copy_athletes,app_private.reward_demo_copy_results to service_role;

alter table public.result_publications add column demo_copy_batch_sha256 text
 references app_private.reward_demo_copy_batches(file_sha256);
alter table public.result_publications drop constraint result_publications_check;
alter table public.result_publications add constraint result_publications_check check(
 publication_state<>'corrected' or supersedes_publication_id is not null or demo_copy_batch_sha256 is not null);
alter table public.result_publications add constraint result_publications_demo_copy_unsigned check(
 demo_copy_batch_sha256 is null or (published_by_user_id is null and supersedes_publication_id is null
 and signature_state='legacy_unsigned' and manifest_json is null and manifest_digest_sha256 is null
 and detached_signature is null and signed_by_user_id is null and signed_at is null));
comment on column public.result_publications.demo_copy_batch_sha256 is
 'Pseudonymized external publication copy. Source revision status retained; no local publication approval, signature or fabricated predecessor.';

create function app_private.import_reward_demo_copy(p jsonb, file_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; race jsonb; org uuid:=gen_random_uuid(); series uuid:=gen_random_uuid(); policy uuid;
begin
 -- Operator-only function, no client/service-role grant; never replaces records.
 if p->>'kind' is distinct from 'podium-five-round-pseudonymized-copy'
 or p->>'targetProjectRef' is distinct from 'niklhlmljiikwbkrmapw'
 or p->>'formatVersion' is distinct from '1' or p->>'demoClosedAfterRound' is distinct from '5'
 or jsonb_array_length(p->'races')<>10 or jsonb_array_length(p->'results')<>471
 or jsonb_array_length(p->'registrations')<>471 or jsonb_array_length(p->'athletes')<>274
 or jsonb_array_length(p->'clubs')<>41 or jsonb_array_length(p->'classifications')<>7
 or jsonb_array_length(p->'competitions')<>2 then raise exception 'invalid_demo_copy'; end if;
 perform pg_advisory_xact_lock(72616365,20261005);
 if exists(select 1 from app_private.reward_demo_copy_batches)
 or exists(select 1 from public.athlete_profiles) or exists(select 1 from public.registrations)
 or exists(select 1 from public.result_rows) or exists(select 1 from public.result_publications)
 or exists(select 1 from public.leagues) or exists(select 1 from auth.users)
 then raise exception 'demo_copy_requires_empty_identity_and_sporting_target'; end if;
 insert into app_private.reward_demo_copy_batches values(file_hash,p->>'sportingSha256',p->>'targetProjectRef',
 (p#>>'{source,capturedAt}')::timestamptz,5,clock_timestamp());
 insert into public.organizations(id,slug,name,profile_visibility,contact_details_visibility)
 values(org,'podium-demo-source','Podium demo source container','members','members');
 insert into public.event_series(id,organization_id,slug,name) values(series,org,'podium-five-round-copy','Five-round Podium copy');
 insert into public.leagues(id,organization_id,slug,name,status,description)
 values((p#>>'{source,leagueId}')::uuid,org,'sibenik-trail-demo','Šibenik Trail League · Podium copy','active',
 'Pseudonymized five-round demo. Exact public results retained. No original accounts, consent or source publication signatures.');
 insert into public.league_seasons(id,league_id,year,name,status,club_scoring_scope,starts_on,ends_on)
 values((p#>>'{source,seasonId}')::uuid,(p#>>'{source,leagueId}')::uuid,2026,'Podium demo · closed after round 5','completed',
 p#>>'{source,clubScoringScope}',(select min((r->>'start_date')::date) from jsonb_array_elements(p->'races') r),
 (select max((r->>'start_date')::date) from jsonb_array_elements(p->'races') r));
 alter table public.athlete_profiles disable trigger athlete_profiles_default_active_country;
 for item in select * from jsonb_array_elements(p->'athletes') loop
  insert into public.athlete_profiles(id,slug,first_name,last_name,display_name,country_code)
   values((item->>'id')::uuid,item->>'slug',item->>'first_name',item->>'last_name',item->>'display_name',null);
  insert into app_private.reward_demo_copy_athletes values((item->>'id')::uuid,file_hash,(item->>'ordinal')::integer,item->>'username');
 end loop;
 alter table public.athlete_profiles enable trigger athlete_profiles_default_active_country;
 for item in select * from jsonb_array_elements(p->'clubs') loop
  insert into public.clubs(id,slug,name,has_regular_training) values((item->>'id')::uuid,item->>'slug',item->>'name',false);
 end loop;
 for item in select * from jsonb_array_elements(p->'competitions') loop
  insert into public.league_competitions(id,league_season_id,slug,name,status,scoring_target,result_basis,standings_mode)
   values((item->>'id')::uuid,(p#>>'{source,seasonId}')::uuid,lower(item->>'name'),item->>'name','active',item->>'scoring_target',item->>'result_basis',item->>'standings_mode');
  insert into public.league_scoring_policy_versions(league_competition_id,version_number,points_table_json,best_n_rounds,minimum_rounds,
   tie_break_method,club_scoring_mode,result_status_policy_json,field_size_profile,participation_points,scoring_method,scoring_parameters_json)
   values((item->>'id')::uuid,(item->>'version_number')::integer,item->'points_table',(item->>'best_n_rounds')::integer,(item->>'minimum_rounds')::integer,
   item->>'tie_break_method',item->>'club_scoring_mode',item->'result_status_policy',item->>'field_size_profile',(item->>'participation_points')::numeric,
   item->>'scoring_method',item->'scoring_parameters') returning id into policy;
  update public.league_competitions set current_scoring_policy_version_id=policy where id=(item->>'id')::uuid;
 end loop;
 for item in select * from jsonb_array_elements(p->'classifications') loop
  insert into public.league_classifications(id,league_competition_id,slug,name,eligibility_json,award_depth,display_order,is_default)
  values((item->>'id')::uuid,(item->>'competition_id')::uuid,'category-'||(item->>'id'),item->>'name',item->'eligibility',
   (item->>'award_depth')::integer,(item->>'display_order')::integer,(item->>'is_default')::boolean);
 end loop;
 for race in select distinct on (r->>'round_id') r from jsonb_array_elements(p->'races') r loop
  insert into public.event_editions(id,event_series_id,slug,name,start_date,status,public_visibility,results_visibility,registration_access)
   values((race->>'event_edition_id')::uuid,series,'round-'||(race->>'round_number'),race->>'event_name',(race->>'start_date')::date,'completed','private','private','open');
  insert into public.league_round_events(id,league_season_id,event_edition_id,round_number,public_name,status,is_finale,points_multiplier)
   values((race->>'round_id')::uuid,(p#>>'{source,seasonId}')::uuid,(race->>'event_edition_id')::uuid,(race->>'round_number')::integer,
   race->>'event_name','completed',(race->>'round_number')='5',(race->>'points_multiplier')::numeric);
 end loop;
 for race in select * from jsonb_array_elements(p->'races') loop
  insert into public.event_categories(id,event_edition_id,slug,name,distance_km,elevation_gain_m,status,results_mode,course_format,lap_count)
   values((race->>'race_id')::uuid,(race->>'event_edition_id')::uuid,'race-'||(race->>'race_id'),race->>'race_name',(race->>'distance_km')::numeric,
   (race->>'elevation_gain_m')::integer,'completed',race->>'results_mode',race->>'course_format',(race->>'lap_count')::integer);
  insert into public.result_runs(id,event_category_id,trigger_type,status,completed_at)
   values((race->>'result_run_id')::uuid,(race->>'race_id')::uuid,'podium_demo_copy','succeeded',(race->>'published_at')::timestamptz);
 end loop;
 -- Preserve foreign keys and sporting guards. Suppress only automatic membership
 -- creation and new-publication actions: these are copied facts, not new consent,
 -- a sporting publisher action, an outgoing webhook or a new reward review clock.
 alter table public.registrations disable trigger registrations_apply_represented_club_membership;
 for item in select * from jsonb_array_elements(p->'registrations') loop
  insert into public.registrations(id,event_category_id,athlete_profile_id,represented_club_id,status,payment_status,participation_status,result_status,source,consent_basis)
   values((item->>'id')::uuid,(item->>'race_id')::uuid,(item->>'athlete_id')::uuid,(item->>'club_id')::uuid,
   (item->>'status')::public.registration_status,'not_required',(item->>'participation_status')::public.participation_status,
   (item->>'result_status')::public.result_status,'podium_demo_copy','legacy_unknown');
 end loop;
 alter table public.registrations enable trigger registrations_apply_represented_club_membership;
 for item in select * from jsonb_array_elements(p->'results') loop
  insert into public.result_rows(id,result_run_id,registration_id,athlete_profile_id,event_category_id,result_status,finish_time_ms,gap_ms,rank_overall,rank_gender,rank_age_category,club_points,represented_club_id)
   values((item->>'id')::uuid,(item->>'result_run_id')::uuid,(item->>'registration_id')::uuid,(item->>'athlete_id')::uuid,(item->>'race_id')::uuid,
   (item->>'result_status')::public.result_status,(item->>'finish_time_ms')::bigint,(item->>'gap_ms')::bigint,(item->>'rank_overall')::integer,
   (item->>'rank_gender')::integer,(item->>'rank_age_category')::integer,(item->>'club_points')::numeric,(item->>'club_id')::uuid);
  if item->>'bib' is not null then
   insert into public.bib_assignments(registration_id,event_edition_id,event_category_id,bib_number,scope)
    select (item->>'registration_id')::uuid,event_edition_id,id,item->>'bib','category' from public.event_categories where id=(item->>'race_id')::uuid;
  end if;
 end loop;
 alter table public.result_publications disable trigger result_publications_actor_permission;
 alter table public.result_publications disable trigger result_publications_partner_outbox;
 alter table public.result_publications disable trigger result_publications_complete_event_edition;
 alter table public.result_publications disable trigger reward_result_publication_stamp_v3;
 alter table public.result_publications disable trigger reward_result_publication_capture_v3;
 for race in select * from jsonb_array_elements(p->'races') loop
  insert into public.result_publications(id,event_category_id,result_run_id,publication_state,published_at,change_note,demo_copy_batch_sha256)
   values((race->>'publication_id')::uuid,(race->>'race_id')::uuid,(race->>'result_run_id')::uuid,(race->>'publication_state')::public.publication_state,
   (race->>'published_at')::timestamptz,'External pseudonymized demo copy; predecessor history and source signatures intentionally not copied.',file_hash);
  insert into public.league_round_race_mappings(league_round_event_id,league_competition_id,event_category_id,current_result_publication_id)
   values((race->>'round_id')::uuid,(race->>'competition_id')::uuid,(race->>'race_id')::uuid,(race->>'publication_id')::uuid);
 end loop;
 alter table public.result_publications enable trigger result_publications_actor_permission;
 alter table public.result_publications enable trigger result_publications_partner_outbox;
 alter table public.result_publications enable trigger result_publications_complete_event_edition;
 alter table public.result_publications enable trigger reward_result_publication_stamp_v3;
 alter table public.result_publications enable trigger reward_result_publication_capture_v3;
 for item in select * from jsonb_array_elements(p->'results') loop
  if exists(select 1 from jsonb_array_elements_text(item->'classification_ids') c where not exists(
   select 1 from public.league_classifications lc join public.league_round_race_mappings m on m.league_competition_id=lc.league_competition_id
   where lc.id=c::uuid and m.event_category_id=(item->>'race_id')::uuid)) then raise exception 'invalid_copy_classification'; end if;
  insert into app_private.reward_demo_copy_results values((item->>'id')::uuid,file_hash,(item->>'publication_id')::uuid,
    array(select value::uuid from jsonb_array_elements_text(item->'classification_ids')));
 end loop;
 return jsonb_build_object('athletes',(select count(*) from public.athlete_profiles),'clubs',(select count(*) from public.clubs),
 'results',(select count(*) from public.result_rows),'registrations',(select count(*) from public.registrations),'authUsers',(select count(*) from auth.users));
end $$;
revoke all on function app_private.import_reward_demo_copy(jsonb,text) from public,anon,authenticated,service_role;
commit;
