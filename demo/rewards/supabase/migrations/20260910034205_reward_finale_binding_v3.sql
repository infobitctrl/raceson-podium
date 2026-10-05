begin;

-- Demo-only source bridge. The imported four-round document is never modified.
-- A binding identifies a local event edition and explicit race/competition pairs;
-- it does not create results, approve an allocation or grant a wallet authority.
create table app_private.reward_finale_bindings_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  draft_id uuid not null references app_private.reward_planning_drafts(id),
  previous_id uuid,
  context_hash text not null check(context_hash ~ '^[0-9a-f]{64}$'),
  edition_id uuid not null references public.event_editions(id),
  races jsonb not null check(jsonb_typeof(races)='array' and jsonb_array_length(races) between 1 and 64),
  saved_by_user_id uuid not null references public.user_profiles(user_id),
  saved_at timestamptz not null default clock_timestamp(),
  sequence bigint generated always as identity unique,
  unique(draft_id,id),
  foreign key(draft_id,previous_id) references app_private.reward_finale_bindings_v3(draft_id,id),
  check(previous_id is null or previous_id<>id)
);
create index reward_finale_bindings_v3_latest on app_private.reward_finale_bindings_v3(draft_id,sequence desc);
alter table app_private.reward_finale_bindings_v3 enable row level security;
revoke all on app_private.reward_finale_bindings_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_finale_bindings_v3 to service_role;
create policy reward_finale_bindings_v3_read on app_private.reward_finale_bindings_v3 for select to service_role using(true);
create policy reward_finale_bindings_v3_write on app_private.reward_finale_bindings_v3 for insert to service_role with check(true);
revoke all on sequence app_private.reward_finale_bindings_v3_sequence_seq from public,anon,authenticated;
grant usage on sequence app_private.reward_finale_bindings_v3_sequence_seq to service_role;
create trigger reward_finale_bindings_v3_immutable before update or delete on app_private.reward_finale_bindings_v3
  for each row execute function app_private.reward_result_review_immutable_v3();

create function app_private.reward_planning_catalogue_v3(p_draft_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype; b app_private.reward_finale_bindings_v3%rowtype; catalogue jsonb; finale jsonb;
begin
  select * into d from app_private.reward_planning_drafts where id=p_draft_id;
  catalogue:=app_private.reward_mapping_catalogue_v2(d.season_id,d.organization_id);
  select * into b from app_private.reward_finale_bindings_v3 where draft_id=p_draft_id order by sequence desc limit 1;
  if b.id is null then return catalogue; end if;
  -- Ownership/removal/cancellation changes are visible as stale source scope,
  -- never a silent replacement with a different edition or historical round.
  select jsonb_build_object('id',b.id,'editionId',e.id,'slot',5,'name',e.name,'date',e.start_date,'status',
    case when e.status::text in ('archived','cancelled') or exists(select 1 from public.league_round_events lr where lr.event_edition_id=e.id and lr.status='cancelled')
      then 'cancelled' else e.status::text end,
    'races',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'competitionId',m->>'competitionId','name',c.name,
      'distanceMetres',case when c.distance_km>0 then (c.distance_km*1000)::bigint::text else null end,
      'publicationId',pub.id,'publicationState',pub.publication_state,
      'resultCount',(select count(*) from public.result_rows rr where rr.result_run_id=pub.result_run_id and rr.event_category_id=c.id))
      order by m->>'competitionId') from jsonb_array_elements(b.races) m
      join public.event_categories c on c.id=(m->>'raceId')::uuid and c.event_edition_id=e.id and c.status::text<>'cancelled'
      left join lateral (select p.id,p.publication_state,p.result_run_id from public.result_publications p
        where p.event_category_id=c.id order by p.published_at desc,p.id desc limit 1) pub on true),'[]'::jsonb)) into finale
    from public.event_editions e join public.event_series s on s.id=e.event_series_id
    where e.id=b.edition_id and s.organization_id=d.organization_id;
  if finale is not null then
    if jsonb_array_length(finale->'races')<>jsonb_array_length(b.races) then finale:=jsonb_set(finale,'{races}','[]'::jsonb); end if;
    catalogue:=jsonb_set(catalogue,'{rounds}',(catalogue->'rounds')||jsonb_build_array(finale));
  end if;
  return catalogue;
end $$;

create function public.service_read_reward_finale_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare d jsonb; b app_private.reward_finale_bindings_v3%rowtype; imported jsonb; editions jsonb; v jsonb;
begin
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select payload into imported from app_private.reward_public_snapshots_v2
    where season_id=(d->>'seasonId')::uuid and organization_id=(d->>'organizationId')::uuid;
  if imported is null then raise exception 'reward_historical_source_missing'; end if;
  select * into b from app_private.reward_finale_bindings_v3 where draft_id=p_draft_id order by sequence desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'date',e.start_date,
    'races',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'distanceMetres',
      case when c.distance_km>0 then (c.distance_km*1000)::bigint::text else null end) order by c.id)
      from public.event_categories c where c.event_edition_id=e.id and c.status::text<>'cancelled'),'[]'::jsonb)) order by e.start_date,e.id),'[]'::jsonb)
    into editions from public.event_editions e join public.event_series s on s.id=e.event_series_id
    where s.organization_id=(d->>'organizationId')::uuid and e.status::text not in ('archived','cancelled')
      and not exists(select 1 from public.league_round_events lr where lr.event_edition_id=e.id and lr.status='cancelled')
      and not exists(select 1 from jsonb_array_elements(imported#>'{catalogue,rounds}') r where r->>'editionId'=e.id::text);
  v:=jsonb_build_object('schema','raceson-finale-binding-v3','draftId',p_draft_id,'chainId',p_chain_id,
    'recordRevision',d->'revision','sourceHash',encode(sha256(convert_to(imported::text,'UTF8')),'hex'),
    'categories',imported#>'{catalogue,categories}','editions',editions,
    'binding',case when b.id is null then null else jsonb_build_object('id',b.id,'previousId',b.previous_id,
      'editionId',b.edition_id,'races',b.races,'savedAt',b.saved_at) end,
    'locked',exists(select 1 from app_private.reward_programme_deployment_intents_v3 where draft_id=p_draft_id));
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,(d->>'organizationId')::uuid) then raise exception 'reward_planning_not_found'; end if;
  return v||jsonb_build_object('contextHash',encode(sha256(convert_to(v::text,'UTF8')),'hex'));
end $$;

create function public.service_bind_reward_finale_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_request_id uuid,p_expected_binding_id uuid,p_context_hash text,p_edition_id uuid,p_races jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d jsonb; v jsonb; before_view jsonb; edition jsonb; pair jsonb; expected_count integer; normalized jsonb; saved app_private.reward_finale_bindings_v3%rowtype;
begin
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(d->>'organizationId')::uuid for share;
  perform 1 from public.organizations where id=(d->>'organizationId')::uuid for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  v:=public.service_read_reward_finale_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid or p_edition_id is null
    or p_context_hash is null or p_context_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_races) is distinct from 'array' or jsonb_array_length(p_races) not between 1 and 64 then
    raise exception 'invalid_reward_finale'; end if;
  select jsonb_agg(value order by value->>'competitionId') into normalized from jsonb_array_elements(p_races);
  select * into saved from app_private.reward_finale_bindings_v3 where id=p_request_id;
  if found then
    if saved.draft_id<>p_draft_id or saved.saved_by_user_id<>p_actor_user_id or saved.previous_id is distinct from p_expected_binding_id
      or saved.context_hash<>p_context_hash or saved.edition_id<>p_edition_id or saved.races<>normalized then raise exception 'reward_finale_conflict'; end if;
    return v||jsonb_build_object('recordedId',saved.id);
  end if;
  if v->>'contextHash' is distinct from p_context_hash or v#>>'{binding,id}' is distinct from p_expected_binding_id::text then
    raise exception 'reward_planning_revision_changed'; end if;
  if (v->>'locked')::boolean then raise exception 'reward_finale_locked'; end if;
  select value into edition from jsonb_array_elements(v->'editions') e where e->>'id'=p_edition_id::text;
  if edition is null then raise exception 'invalid_reward_finale'; end if;
  -- Every imported individual competition must have exactly one explicit native
  -- race. Club standings aggregate those races and do not invent a club course.
  select count(distinct c->>'competitionId') into expected_count from jsonb_array_elements(v->'categories') c where c->>'target'='individual';
  if expected_count<>jsonb_array_length(normalized)
    or (select count(distinct value->>'competitionId') from jsonb_array_elements(normalized))<>expected_count
    or (select count(distinct value->>'raceId') from jsonb_array_elements(normalized))<>expected_count then raise exception 'invalid_reward_finale'; end if;
  for pair in select value from jsonb_array_elements(normalized) loop
    if jsonb_typeof(pair)<>'object' or (select count(*) from jsonb_object_keys(pair))<>2
      or not exists(select 1 from jsonb_array_elements(v->'categories') c where c->>'target'='individual' and c->>'competitionId'=pair->>'competitionId')
      or not exists(select 1 from jsonb_array_elements(edition->'races') r where r->>'id'=pair->>'raceId') then raise exception 'invalid_reward_finale'; end if;
  end loop;
  perform 1 from public.event_series s join public.event_editions e on e.event_series_id=s.id where e.id=p_edition_id for share of s,e;
  perform 1 from public.event_categories where event_edition_id=p_edition_id for share;
  if public.service_read_reward_finale_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id)->>'contextHash' is distinct from p_context_hash then
    raise exception 'reward_planning_revision_changed'; end if;
  insert into app_private.reward_finale_bindings_v3(id,draft_id,previous_id,context_hash,edition_id,races,saved_by_user_id)
    values(p_request_id,p_draft_id,p_expected_binding_id,p_context_hash,p_edition_id,normalized,p_actor_user_id);
  before_view:=v;
  v:=public.service_read_reward_finale_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  -- Keep source mapping a separate explicit revision; no automatic pot or share changes.
  if v#>>'{binding,id}' is distinct from p_request_id::text or (v - 'binding' - 'contextHash') is distinct from (before_view - 'binding' - 'contextHash') then
    raise exception 'reward_planning_revision_changed'; end if;
  return v||jsonb_build_object('recordedId',p_request_id);
end $$;
revoke all on function app_private.reward_planning_catalogue_v3(uuid),
  public.service_read_reward_finale_v3(uuid,uuid,integer,uuid),
  public.service_bind_reward_finale_v3(uuid,uuid,integer,uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_planning_catalogue_v3(uuid),
  public.service_read_reward_finale_v3(uuid,uuid,integer,uuid),
  public.service_bind_reward_finale_v3(uuid,uuid,integer,uuid,uuid,uuid,text,uuid,jsonb) to service_role;

-- Same mapping schema and CAS rules; only the catalogue resolver changes.
create or replace function public.service_read_reward_mapping_v2(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype; m app_private.reward_source_mappings_v2%rowtype; catalogue jsonb; empty_mapping jsonb;
begin
  perform public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select * into d from app_private.reward_planning_drafts where id=p_draft_id;
  select * into m from app_private.reward_source_mappings_v2 where draft_id=p_draft_id;
  catalogue:=app_private.reward_planning_catalogue_v3(d.id);
  select jsonb_build_object('version',2,'leagueCategories','[]'::jsonb,'rounds',jsonb_agg(
    jsonb_build_object('slot',i,'roundId',null,'categories','[]'::jsonb) order by i)) into empty_mapping from generate_series(1,5) i;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then raise exception 'reward_planning_not_found'; end if;
  return jsonb_build_object('draftId',d.id,'revision',coalesce(m.revision,0),'rulesRevision',d.revision,
    'catalogueHash',encode(sha256(convert_to(catalogue::text,'UTF8')),'hex'),
    'boundCatalogueHash',m.catalogue_hash,'mapping',coalesce(m.mapping,empty_mapping),'catalogue',catalogue);
end $$;

create or replace function public.service_save_reward_mapping_v2(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
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
  catalogue:=app_private.reward_planning_catalogue_v3(d.id);
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
commit;
