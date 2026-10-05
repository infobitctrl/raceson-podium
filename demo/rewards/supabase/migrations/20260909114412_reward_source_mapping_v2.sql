begin;

-- Demo-only, unfunded configuration. No result ownership or sporting approval.
create table app_private.reward_source_mappings_v2 (
  draft_id uuid primary key references app_private.reward_planning_drafts(id),
  revision integer not null check (revision > 0),
  mapping jsonb not null check (jsonb_typeof(mapping)='object' and octet_length(mapping::text)<=32768),
  catalogue_hash text not null check (catalogue_hash ~ '^[0-9a-f]{64}$'),
  rules_revision integer not null check (rules_revision > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by_user_id uuid not null references public.user_profiles(user_id)
);
create table app_private.reward_source_mapping_revisions_v2 (
  draft_id uuid not null references app_private.reward_planning_drafts(id),
  revision integer not null,
  mapping jsonb not null,
  catalogue_hash text not null,
  rules_revision integer not null,
  saved_at timestamptz not null,
  saved_by_user_id uuid not null references public.user_profiles(user_id),
  primary key(draft_id,revision)
);
alter table app_private.reward_source_mappings_v2 enable row level security;
alter table app_private.reward_source_mapping_revisions_v2 enable row level security;
revoke all on app_private.reward_source_mappings_v2,app_private.reward_source_mapping_revisions_v2 from public,anon,authenticated,service_role;
grant select,insert,update on app_private.reward_source_mappings_v2 to service_role;
grant select,insert on app_private.reward_source_mapping_revisions_v2 to service_role;

-- Only the draft's local season and organization. No cross-project query, DOB,
-- names of athletes, contact details, private notes or wallet-profile links.
create function app_private.reward_mapping_catalogue_v2(p_season_id uuid,p_organization_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'rounds',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'editionId',e.id,'slot',r.round_number,'name',coalesce(r.public_name,e.name),
      'date',e.start_date,'status',r.status,'races',coalesce((select jsonb_agg(jsonb_build_object(
        'id',c.id,'competitionId',m.league_competition_id,'name',c.name,
        'distanceMetres',case when c.distance_km>0 then (c.distance_km*1000)::bigint::text else null end,
        'publicationId',pub.id,'publicationState',pub.publication_state,
        'resultCount',(select count(*) from public.result_rows rr where rr.result_run_id=pub.result_run_id and rr.event_category_id=c.id)
      ) order by m.league_competition_id)
      from public.league_round_race_mappings m join public.event_categories c on c.id=m.event_category_id and c.event_edition_id=e.id
        join public.league_competitions competition on competition.id=m.league_competition_id and competition.league_season_id=p_season_id
        left join lateral (select p.id,p.publication_state,p.result_run_id from public.result_publications p
          where p.event_category_id=c.id order by p.published_at desc,p.id desc limit 1) pub on true
      where m.league_round_event_id=r.id and m.status='mapped'), '[]'::jsonb)
    ) order by r.round_number,r.id)
    from public.league_round_events r join public.event_editions e on e.id=r.event_edition_id
      join public.event_series s on s.id=e.event_series_id and s.organization_id=p_organization_id
    where r.league_season_id=p_season_id),'[]'::jsonb),
    'categories',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'competitionId',competition.id,'competitionName',competition.name,'name',c.name,
      'target',competition.scoring_target,'eligibility',c.eligibility_json
    ) order by competition.display_order,competition.id,c.display_order,c.id)
    from public.league_classifications c join public.league_competitions competition on competition.id=c.league_competition_id
    where competition.league_season_id=p_season_id and competition.status<>'archived' and c.status<>'archived'),'[]'::jsonb)
  )
$$;
create function public.service_read_reward_mapping_v2(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype; m app_private.reward_source_mappings_v2%rowtype; catalogue jsonb; empty_mapping jsonb;
begin
  perform public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select * into d from app_private.reward_planning_drafts where id=p_draft_id;
  select * into m from app_private.reward_source_mappings_v2 where draft_id=p_draft_id;
  catalogue:=app_private.reward_mapping_catalogue_v2(d.season_id,d.organization_id);
  select jsonb_build_object('version',2,'leagueCategories','[]'::jsonb,'rounds',jsonb_agg(
    jsonb_build_object('slot',i,'roundId',null,'categories','[]'::jsonb) order by i)) into empty_mapping from generate_series(1,5) i;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then raise exception 'reward_planning_not_found'; end if;
  return jsonb_build_object('draftId',d.id,'revision',coalesce(m.revision,0),'rulesRevision',d.revision,
    'catalogueHash',encode(sha256(convert_to(catalogue::text,'UTF8')),'hex'),
    'boundCatalogueHash',m.catalogue_hash,'mapping',coalesce(m.mapping,empty_mapping),'catalogue',catalogue);
end $$;

create function public.service_save_reward_mapping_v2(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_expected_revision integer,p_expected_rules_revision integer,p_catalogue_hash text,p_mapping jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype; m app_private.reward_source_mappings_v2%rowtype;
  catalogue jsonb; current_hash text; round_row jsonb; share_row jsonb; family_rows jsonb;
  category_target text; athlete_bps integer; club_bps integer; slot integer:=0; share_value integer;
begin
  perform public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select * into d from app_private.reward_planning_drafts where id=p_draft_id;
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=d.organization_id for share;
  perform 1 from public.organizations where id=d.organization_id for share;
  select * into d from app_private.reward_planning_drafts where id=p_draft_id for update;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then raise exception 'reward_planning_not_found'; end if;
  select * into m from app_private.reward_source_mappings_v2 where draft_id=p_draft_id;
  catalogue:=app_private.reward_mapping_catalogue_v2(d.season_id,d.organization_id);
  current_hash:=encode(sha256(convert_to(catalogue::text,'UTF8')),'hex');
  if p_expected_revision is distinct from coalesce(m.revision,0) or p_expected_rules_revision is distinct from d.revision
    or p_catalogue_hash is distinct from current_hash then raise exception 'reward_planning_revision_changed'; end if;
  if p_mapping is null or jsonb_typeof(p_mapping)<>'object' or octet_length(p_mapping::text)>32768
    or p_mapping->>'version' is distinct from '2' or jsonb_typeof(p_mapping->'rounds') is distinct from 'array'
    or jsonb_array_length(p_mapping->'rounds')<>5 or jsonb_typeof(p_mapping->'leagueCategories') is distinct from 'array'
    or (select count(*) from jsonb_object_keys(p_mapping))<>3 then raise exception 'invalid_reward_planning_request'; end if;
  for round_row in select value from jsonb_array_elements(p_mapping->'rounds') loop
    slot:=slot+1;
    if jsonb_typeof(round_row)<>'object' or (select count(*) from jsonb_object_keys(round_row))<>3
      or round_row->>'slot' is distinct from slot::text or not round_row ? 'roundId'
      or jsonb_typeof(round_row->'categories') is distinct from 'array' then raise exception 'invalid_reward_planning_request'; end if;
    if round_row->>'roundId' is not null and not exists(select 1 from jsonb_array_elements(catalogue->'rounds') r
      where r->>'id'=round_row->>'roundId' and r->>'slot'=slot::text and r->>'status'<>'cancelled') then
      raise exception 'invalid_reward_planning_request'; end if;
  end loop;
  for family_rows in select value->'categories' from jsonb_array_elements(p_mapping->'rounds')
    union all select p_mapping->'leagueCategories' loop
    if jsonb_array_length(family_rows)>64 or (select count(distinct value->>'categoryId') from jsonb_array_elements(family_rows))<>jsonb_array_length(family_rows)
      then raise exception 'invalid_reward_planning_request'; end if;
    athlete_bps:=0; club_bps:=0;
    for share_row in select value from jsonb_array_elements(family_rows) loop
      if jsonb_typeof(share_row)<>'object' or (select count(*) from jsonb_object_keys(share_row))<>2
        or jsonb_typeof(share_row->'shareBps') is distinct from 'number'
        or coalesce(share_row->>'shareBps','') !~ '^[0-9]{1,5}$' then raise exception 'invalid_reward_planning_request'; end if;
      select c->>'target' into category_target from jsonb_array_elements(catalogue->'categories') c where c->>'id'=share_row->>'categoryId';
      if category_target is null then raise exception 'invalid_reward_planning_request'; end if;
      share_value:=(share_row->>'shareBps')::integer;
      if category_target='individual' then athlete_bps:=athlete_bps+share_value; else club_bps:=club_bps+share_value; end if;
    end loop;
    if athlete_bps>10000 or club_bps>10000 then raise exception 'invalid_reward_planning_request'; end if;
  end loop;
  if m.mapping=p_mapping and m.catalogue_hash=current_hash and m.rules_revision=d.revision then
    return public.service_read_reward_mapping_v2(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id); end if;
  insert into app_private.reward_source_mappings_v2(draft_id,revision,mapping,catalogue_hash,rules_revision,updated_by_user_id)
    values(d.id,coalesce(m.revision,0)+1,p_mapping,current_hash,d.revision,p_actor_user_id)
    on conflict(draft_id) do update set revision=excluded.revision,mapping=excluded.mapping,catalogue_hash=excluded.catalogue_hash,
      rules_revision=excluded.rules_revision,updated_at=clock_timestamp(),updated_by_user_id=excluded.updated_by_user_id returning * into m;
  insert into app_private.reward_source_mapping_revisions_v2(draft_id,revision,mapping,catalogue_hash,rules_revision,saved_at,saved_by_user_id)
    values(d.id,m.revision,m.mapping,m.catalogue_hash,m.rules_revision,m.updated_at,p_actor_user_id);
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return public.service_read_reward_mapping_v2(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
end $$;
revoke all on function app_private.reward_mapping_catalogue_v2(uuid,uuid),
  public.service_read_reward_mapping_v2(uuid,uuid,integer,uuid),
  public.service_save_reward_mapping_v2(uuid,uuid,integer,uuid,integer,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_mapping_catalogue_v2(uuid,uuid),
  public.service_read_reward_mapping_v2(uuid,uuid,integer,uuid),
  public.service_save_reward_mapping_v2(uuid,uuid,integer,uuid,integer,integer,text,jsonb) to service_role;
commit;
