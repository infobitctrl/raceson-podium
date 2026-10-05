begin;
-- Explicit demo-owner publication, never automatic discovery of private drafts.
-- No HTTP write capability. Publishing this row approves catalogue visibility
-- only, not sporting finality, prize rules, funding, allocations or claims.
create table app_private.reward_sponsor_sources_v4 (
 chain_id integer not null check(chain_id in(31337,10143)),
 source_league_id uuid not null, source_season_id uuid not null,
 draft_id uuid not null references app_private.reward_planning_drafts(id),
 catalogue_hash text not null check(catalogue_hash ~ '^[0-9a-f]{64}$'),
 display_name text not null check(length(display_name) between 1 and 100),
 event_mappings jsonb not null check(jsonb_typeof(event_mappings)='array' and jsonb_array_length(event_mappings)=5),
 category_presets jsonb not null check(jsonb_typeof(category_presets)='object'),
 published_by_user_id uuid not null references public.user_profiles(user_id),
 published_at timestamptz not null default clock_timestamp(),
 enabled boolean not null default true,
 primary key(chain_id,source_league_id,source_season_id), unique(chain_id,draft_id)
);
alter table app_private.reward_sponsor_sources_v4 enable row level security;
revoke all on app_private.reward_sponsor_sources_v4 from public,anon,authenticated,service_role;
grant select on app_private.reward_sponsor_sources_v4 to service_role;
create policy reward_sponsor_sources_v4_read on app_private.reward_sponsor_sources_v4 for select to service_role using(true);

create function public.service_resolve_reward_sponsor_source_v4(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
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
 if snapshot is null or snapshot->>'version'<>'2' or snapshot->>'sourceOrigin'<>'https://www.raceson.com'
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
revoke all on function public.service_resolve_reward_sponsor_source_v4(uuid,uuid,integer,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_resolve_reward_sponsor_source_v4(uuid,uuid,integer,uuid,uuid,uuid,uuid) to service_role;
commit;
