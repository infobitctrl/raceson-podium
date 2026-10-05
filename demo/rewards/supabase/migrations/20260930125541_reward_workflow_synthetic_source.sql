begin;
-- Owner-approved 30 September fixture. Private demo overlay only. Historical
-- sources keep their original checks. No identity, consent or approval writes.
create function app_private.reward_workflow_snapshot_20260930(p jsonb, season uuid)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
 if p->>'version' is distinct from '3' or p->>'sourceOrigin' is distinct from 'urn:raceson:synthetic:workflow-20260930:v1'
  or season is distinct from '9b000000-0000-4000-8000-000000000051'::uuid
  or p->>'sourceSeasonId' is distinct from season::text
  or p->>'sourceLeagueId' is distinct from '9b000000-0000-4000-8000-000000000050'
  or jsonb_typeof(p->'results') is distinct from 'array' or jsonb_typeof(p->'clubs') is distinct from 'array'
  or jsonb_typeof(p#>'{catalogue,rounds}') is distinct from 'array'
  or jsonb_typeof(p#>'{catalogue,categories}') is distinct from 'array' then return false; end if;
 if jsonb_array_length(p->'results')<>8 or jsonb_array_length(p->'clubs')<>0
  or jsonb_array_length(p#>'{catalogue,rounds}')<>4 or jsonb_array_length(p#>'{catalogue,categories}')<>8
  or exists(select 1 from jsonb_array_elements(p->'results') r where
    r->>'athleteId' is null or r->>'athleteId' not in('9a000000-0000-4000-8000-000000001060','9a000000-0000-4000-8000-000000001061')
    or r->'clubId' is distinct from 'null'::jsonb or r->'clubName' is distinct from 'null'::jsonb
    or coalesce(r->>'athleteName','') not like '%Synthetic%')
  or exists(select 1 from jsonb_array_elements(p#>'{catalogue,categories}') c where c#>'{eligibility,demoOnly}' is distinct from 'true'::jsonb)
  then return false; end if;
 return true;
end $$;
revoke all on function app_private.reward_workflow_snapshot_20260930(jsonb,uuid) from public,anon,authenticated;
grant execute on function app_private.reward_workflow_snapshot_20260930(jsonb,uuid) to service_role;
-- Keep the previous constraint expression intact while reserving this new
-- source identity exclusively for its labelled finite fixture.
do $constraint$ declare prior text; begin
 select pg_get_expr(conbin,conrelid) into strict prior from pg_constraint
 where conrelid='app_private.reward_public_snapshots_v2'::regclass and conname='reward_public_snapshots_v2_payload_check';
 alter table app_private.reward_public_snapshots_v2 drop constraint reward_public_snapshots_v2_payload_check;
 execute 'alter table app_private.reward_public_snapshots_v2 add constraint reward_public_snapshots_v2_payload_check check ((('
   ||prior||') and season_id<>''9b000000-0000-4000-8000-000000000051''::uuid and payload->>''sourceLeagueId''<>''9b000000-0000-4000-8000-000000000050'' and payload->>''sourceSeasonId''<>''9b000000-0000-4000-8000-000000000051'') or (octet_length(payload::text)<=2097152 and app_private.reward_workflow_snapshot_20260930(payload,season_id)))';
end $constraint$;
alter table app_private.reward_planning_drafts add constraint reward_workflow_20260930_chain
 check(season_id<>'9b000000-0000-4000-8000-000000000051'::uuid or (chain_id=10143 and id='9b000000-0000-4000-8000-000000000052'::uuid));
create or replace function public.service_resolve_reward_sponsor_source_v4(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_source_league_id uuid default null,p_source_season_id uuid default null,p_event_edition_id uuid default null,p_setup_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare publication app_private.reward_sponsor_sources_v4%rowtype; d app_private.reward_planning_drafts%rowtype;
 mapping app_private.reward_source_mappings_v2%rowtype; snapshot jsonb; catalogue jsonb; visible_catalogue jsonb;
 selected jsonb; item jsonb; target_draft uuid; target_hash text; category_id text; selected_id uuid; selected_slot integer;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(31337,10143)
   or (p_setup_id is null and (p_source_league_id is null or p_source_season_id is null))
   or (p_setup_id is not null and (p_source_league_id is not null or p_source_season_id is not null or p_event_edition_id is not null)) then
   raise exception 'invalid_reward_sponsor_source'; end if;
 if p_setup_id is not null then
   select (configuration#>>'{context,draftId}')::uuid,configuration#>>'{context,catalogueHash}' into target_draft,target_hash from app_private.reward_distribution_setups
     where id=p_setup_id and owner_user_id=p_actor_user_id and chain_id=p_chain_id and archived_at is null for share;
   if target_draft is null then raise exception 'reward_sponsor_source_not_found'; end if;
 end if;
 select * into publication from app_private.reward_sponsor_sources_v4 r where r.chain_id=p_chain_id and r.enabled
   and case when p_setup_id is not null then r.draft_id=target_draft
     else r.source_league_id=p_source_league_id and r.source_season_id=p_source_season_id end;
 if not found then raise exception 'reward_sponsor_source_not_found'; end if;
 if p_setup_id is not null and target_hash is distinct from publication.catalogue_hash then raise exception 'reward_sponsor_source_stale'; end if;
 select draft.* into d from app_private.reward_planning_drafts draft
   join public.league_seasons season on season.id=draft.season_id
   join public.leagues league on league.id=season.league_id and league.organization_id=draft.organization_id
   where draft.id=publication.draft_id and draft.chain_id=p_chain_id and season.status<>'archived' and league.status<>'archived'
   for share of draft,season,league;
 if not found or not app_private.reward_planning_authorized(publication.published_by_user_id,d.organization_id) then
   raise exception 'reward_sponsor_source_not_found'; end if;
 select * into mapping from app_private.reward_source_mappings_v2 where draft_id=d.id for share;
 select payload into snapshot from app_private.reward_public_snapshots_v2 where season_id=d.season_id and organization_id=d.organization_id;
 if snapshot is null or not ((snapshot->>'version'='2' and snapshot->>'sourceOrigin'='https://www.raceson.com')
   or (p_chain_id=10143 and d.id='9b000000-0000-4000-8000-000000000052'::uuid
     and publication.display_name like '%Synthetic%'
     and app_private.reward_workflow_snapshot_20260930(snapshot,d.season_id)))
   or snapshot->>'sourceLeagueId' is distinct from publication.source_league_id::text
   or snapshot->>'sourceSeasonId' is distinct from publication.source_season_id::text then raise exception 'reward_sponsor_source_not_found'; end if;
 catalogue:=app_private.reward_planning_catalogue_v3(d.id);
 if mapping.draft_id is null or mapping.rules_revision<>d.revision or mapping.catalogue_hash<>publication.catalogue_hash
   or encode(sha256(convert_to(catalogue::text,'UTF8')),'hex')<>publication.catalogue_hash
   or jsonb_array_length(catalogue->'rounds')<>5 then raise exception 'reward_sponsor_source_stale'; end if;
 -- Exact event identities include the explicitly copied pending finale. Every
 -- published event maps once to an existing current, non-cancelled round.
 if (select count(distinct value->>'sourceEventEditionId') from jsonb_array_elements(publication.event_mappings))<>5
   or (select count(distinct value->>'editionId') from jsonb_array_elements(publication.event_mappings))<>5 then raise exception 'reward_sponsor_source_stale'; end if;
 for item in select value from jsonb_array_elements(publication.event_mappings) loop
   if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>2
     or item->>'sourceEventEditionId' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
     or not exists(select 1 from jsonb_array_elements(catalogue->'rounds') r where r->>'editionId'=item->>'editionId'
       and r->>'status'<>'cancelled' and exists(select 1 from jsonb_array_elements(mapping.mapping->'rounds') m
         where m->>'roundId'=r->>'id' and m->>'slot'=r->>'slot')) then raise exception 'reward_sponsor_source_stale'; end if;
   -- Completed imported rounds may not be relabelled as another public event.
   if exists(select 1 from jsonb_array_elements(snapshot#>'{catalogue,rounds}') r where r->>'editionId'=item->>'editionId')
      and item->>'sourceEventEditionId'<>item->>'editionId' then raise exception 'reward_sponsor_source_stale'; end if;
 end loop;
 if (select array_agg(key order by key) from jsonb_object_keys(publication.category_presets) key) is distinct from
   array['clubs','long_female','long_male','short_female','short_female_u16','short_male','short_male_u16','short_senior']::text[] then raise exception 'reward_sponsor_source_stale'; end if;
 if (select count(distinct value) from jsonb_each_text(publication.category_presets))<>8 then raise exception 'reward_sponsor_source_stale'; end if;
 for item in select jsonb_build_object('key',key,'id',value) from jsonb_each_text(publication.category_presets) loop
   category_id:=item->>'id';
   if not exists(select 1 from jsonb_array_elements(catalogue->'categories') c where c->>'id'=category_id
     and c->>'target'=case when item->>'key'='clubs' then 'club' else 'individual' end) then raise exception 'reward_sponsor_source_stale'; end if;
 end loop;
 if p_event_edition_id is not null then
   select r into selected from jsonb_array_elements(catalogue->'rounds') r
     join jsonb_array_elements(publication.event_mappings) e on e->>'editionId'=r->>'editionId'
     where e->>'sourceEventEditionId'=p_event_edition_id::text;
   if selected is null then raise exception 'reward_sponsor_source_not_found'; end if;
   selected_id:=(selected->>'id')::uuid;selected_slot:=(selected->>'slot')::integer;
 end if;
 -- Project public classification metadata only; never return a planning record,
 -- imported participant rows, owner identity, session or sporting approvals.
 visible_catalogue:=jsonb_set(catalogue,'{categories}',coalesce((select jsonb_agg(jsonb_set(c,'{eligibility}',
   coalesce((select jsonb_object_agg(key,value) from jsonb_each(c->'eligibility')
     where key in('gender','minimumAge','maximumAge','classificationSource','source','allocationRule','sportingApproval')
       and jsonb_typeof(value) in('string','number','boolean','null') and length(value::text)<=128),'{}'::jsonb)) order by n)
   from jsonb_array_elements(catalogue->'categories') with ordinality x(c,n)),'[]'::jsonb));
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 -- Publication remains SELECT-only for the service role. Recheck it after any
 -- source-table wait rather than granting UPDATE solely to acquire a row lock.
 if not exists(select 1 from app_private.reward_sponsor_sources_v4 r where r is not distinct from publication)
   or not app_private.reward_planning_authorized(publication.published_by_user_id,d.organization_id) then
   raise exception 'reward_sponsor_source_not_found'; end if;
 if app_private.reward_planning_catalogue_v3(d.id) is distinct from catalogue then raise exception 'reward_sponsor_source_stale'; end if;
 return jsonb_build_object('schema','raceson-sponsor-source-v4','sourceLeagueId',publication.source_league_id,'sourceSeasonId',publication.source_season_id,
   'eventEditionId',p_event_edition_id,'context',jsonb_build_object('draftId',d.id,'catalogueHash',publication.catalogue_hash,
     'roundId',null,'editionId',null,'programmeName',publication.display_name,'eventName',publication.display_name),
   'catalogue',visible_catalogue,'selectedRoundId',selected_id,'selectedSlot',selected_slot,'categoryPresets',publication.category_presets);
end $$;

commit;
