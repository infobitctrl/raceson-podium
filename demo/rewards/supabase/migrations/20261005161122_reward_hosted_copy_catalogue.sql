begin;
-- Server-only projection for the real Podium UI. No athlete rows are returned
-- to an unauthenticated browser; the API verifies the independent sporting pin.
create function app_private.reward_demo_copy_catalogue()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source jsonb; metadata jsonb;
begin
 source:=public.operator_read_reward_five_round_copy_v1('073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644');
 select jsonb_build_object('name',l.name,'status',s.status,
  'categories',(select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'competitionId',c.id,'competitionName',c.name,'target','individual') order by c.id,d.id)
   from public.league_classifications d join public.league_competitions c on c.id=d.league_competition_id where c.league_season_id=s.id),
  'rounds',(select jsonb_agg(jsonb_build_object('slot',e.round_number,'roundId',e.id,'sourceRoundId',e.id,'eventEditionId',e.event_edition_id,'editionId',e.event_edition_id,
   'name',e.public_name,'date',d.start_date,'status',e.status,
   'tracks',(select jsonb_agg(jsonb_build_object('raceId',r.id,'sourceRaceId',r.id,'name',r.name,'competitionId',m.league_competition_id,'distanceMetres',(r.distance_km*1000)::bigint::text) order by r.id)
    from public.league_round_race_mappings m join public.event_categories r on r.id=m.event_category_id where m.league_round_event_id=e.id)) order by e.round_number)
   from public.league_round_events e join public.event_editions d on d.id=e.event_edition_id where e.league_season_id=s.id)) into strict metadata
 from public.league_seasons s join public.leagues l on l.id=s.league_id where s.id=(source->>'seasonId')::uuid;
 return jsonb_build_object('source',source,'metadata',metadata,
  'hasLaunches',exists(select 1 from app_private.reward_sponsor_launches),
  'checkedAt',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;
create function public.service_reward_demo_copy_catalogue()
returns jsonb language sql stable security invoker set search_path='' as $$
 select app_private.reward_demo_copy_catalogue();
$$;
revoke all on function app_private.reward_demo_copy_catalogue(),public.service_reward_demo_copy_catalogue() from public,anon,authenticated,service_role;
grant execute on function app_private.reward_demo_copy_catalogue(),public.service_reward_demo_copy_catalogue() to service_role;
create or replace function app_private.reward_demo_copy_sponsor(p_actor_user_id uuid,p_actor_session_id uuid,p_action text,p_setup_id uuid default null,
 p_request_id uuid default null,p_expected_revision integer default null,p_configuration jsonb default null,p_source_fingerprint text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare account jsonb; source jsonb; fingerprint text; result jsonb; canonical jsonb; i integer; j integer;
 binding app_private.reward_demo_copy_setup_bindings; d app_private.reward_distribution_setups;
begin
 account:=app_private.reward_demo_copy_session(p_actor_user_id,p_actor_session_id);
 if account->>'kind'<>'sponsor' or account->>'batchSha256'<>'073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644' then raise exception 'reward_demo_sponsor_required'; end if;
 if p_action is null or p_action not in('template','list','read','save') or (p_action='list')<>(p_setup_id is null)
  or (p_action<>'save' and (p_request_id is not null or p_expected_revision is not null or p_configuration is not null or p_source_fingerprint is not null))
 then raise exception 'invalid_reward_setup'; end if;
 if p_action='save' then
  -- Same lock order as the existing revision store; authorization is checked again after waiting.
  perform pg_advisory_xact_lock(hashtextextended('reward-setup-owner:'||p_actor_user_id::text||':10143',0));
  perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_setup_id::text,0));
  account:=app_private.reward_demo_copy_session(p_actor_user_id,p_actor_session_id);
  if account->>'kind'<>'sponsor' then raise exception 'reward_demo_sponsor_required'; end if;
 end if;
 source:=public.operator_read_reward_five_round_copy_v1(account->>'batchSha256');
 fingerprint:=encode(sha256(convert_to(source::text,'UTF8')),'hex');
 if p_action='template' then result:=app_private.reward_demo_copy_setup_template(p_setup_id,source);
 elsif p_action='list' then
  select coalesce(jsonb_agg(app_private.reward_setup_document(t) order by t.updated_at desc,t.id),'[]'::jsonb) into result
   from app_private.reward_distribution_setups t join app_private.reward_demo_copy_setup_bindings b on b.setup_id=t.id
   where t.owner_user_id=p_actor_user_id and t.chain_id=10143 and t.archived_at is null
    and b.batch_sha256=account->>'batchSha256' and b.source_fingerprint=fingerprint;
 else
  select * into d from app_private.reward_distribution_setups where id=p_setup_id;
  select * into binding from app_private.reward_demo_copy_setup_bindings where setup_id=p_setup_id;
  if d.id is not null and (d.owner_user_id<>p_actor_user_id or d.chain_id<>10143 or d.archived_at is not null or binding.setup_id is null) then raise exception 'reward_setup_not_found'; end if;
  if binding.setup_id is not null and (binding.batch_sha256<>account->>'batchSha256' or binding.source_fingerprint<>fingerprint) then raise exception 'copy_scope_changed'; end if;
  if p_action='read' then
   if d.id is null then raise exception 'reward_setup_not_found'; end if;
   result:=public.service_reward_distribution_setups(p_actor_user_id,p_actor_session_id,10143,p_setup_id);
  else
   if p_source_fingerprint is distinct from fingerprint then raise exception 'copy_scope_changed'; end if;
   if p_request_id is null or p_configuration is null then raise exception 'invalid_reward_setup'; end if;
   perform app_private.validate_reward_setup_configuration(p_configuration);
   canonical:=app_private.reward_demo_copy_setup_template(p_setup_id,source);
   -- Only economic inputs are editable. Names/categories, copied source, readiness,
   -- eligibility, policy and structural identities must match the canonical template.
   canonical:=canonical||jsonb_build_object('name',p_configuration->'name','budgetMon',p_configuration->'budgetMon','policy',p_configuration->'policy');
   -- Selection is display/scope metadata, never a source-context approval.
   if p_configuration#>>'{sponsorSelection,sourceLeagueId}' is distinct from source->>'leagueId'
    or p_configuration#>>'{sponsorSelection,sourceSeasonId}' is distinct from source->>'seasonId' then raise exception 'invalid_reward_setup'; end if;
   if p_configuration#>>'{sponsorSelection,eventEditionId}' is not null then
    select e.round_number into strict i from public.league_round_events e
     where e.league_season_id=(source->>'seasonId')::uuid and e.event_edition_id=(p_configuration#>>'{sponsorSelection,eventEditionId}')::uuid;
    if exists(select 1 from jsonb_array_elements(p_configuration#>'{root,children}') with ordinality x(n,slot)
     where x.slot<>i+1 and (n->>'shareBps')::integer<>0) then raise exception 'invalid_reward_setup'; end if;
    if p_configuration#>>'{sponsorSelection,raceId}' is not null then
     if not exists(select 1 from jsonb_array_elements(source->'races') r where r->>'id'=p_configuration#>>'{sponsorSelection,raceId}' and (r->>'slot')::integer=i) then raise exception 'invalid_reward_setup'; end if;
     if exists(select 1 from jsonb_array_elements(p_configuration#>array['root','children',i::text,'children']) with ordinality x(n,pos)
       left join (select c,row_number() over(order by c->>'competitionId',c->>'id') pos from jsonb_array_elements(source->'classifications') c) cat on cat.pos=x.pos
       where (n->>'shareBps')::integer>0 and (cat.c is null or cat.c->>'competitionId' is distinct from
        (select r->>'competitionId' from jsonb_array_elements(source->'races') r where r->>'id'=p_configuration#>>'{sponsorSelection,raceId}'))) then raise exception 'invalid_reward_setup'; end if;
    end if;
   elsif p_configuration#>>'{sponsorSelection,raceId}' is not null then raise exception 'invalid_reward_setup'; end if;
   canonical:=canonical||jsonb_build_object('sponsorSelection',p_configuration->'sponsorSelection');
   for i in 0..5 loop
    canonical:=jsonb_set(canonical,array['root','children',i::text,'shareBps'],p_configuration#>array['root','children',i::text,'shareBps']);
    for j in 0..jsonb_array_length(canonical#>array['root','children',i::text,'children'])-1 loop
     canonical:=jsonb_set(canonical,array['root','children',i::text,'children',j::text,'shareBps'],p_configuration#>array['root','children',i::text,'children',j::text,'shareBps']);
     if canonical#>>array['root','children',i::text,'children',j::text,'rule','basis']<>'participation' then
      canonical:=jsonb_set(canonical,array['root','children',i::text,'children',j::text,'rule','sharesBps'],p_configuration#>array['root','children',i::text,'children',j::text,'rule','sharesBps']);
     end if;
    end loop;
   end loop;
   if canonical is distinct from p_configuration then raise exception 'invalid_reward_setup'; end if;
   result:=public.service_reward_distribution_setups(p_actor_user_id,p_actor_session_id,10143,p_setup_id,p_request_id,p_expected_revision,p_configuration);
   insert into app_private.reward_demo_copy_setup_bindings(setup_id,batch_sha256,source_fingerprint)
    values(p_setup_id,account->>'batchSha256',fingerprint) on conflict(setup_id) do nothing;
  end if;
 end if;
 account:=app_private.reward_demo_copy_session(p_actor_user_id,p_actor_session_id);
 if account->>'kind'<>'sponsor' then raise exception 'reward_demo_sponsor_required'; end if;
 return jsonb_build_object('source',source,'sourceFingerprint',fingerprint,'result',result);
end $$;
commit;
