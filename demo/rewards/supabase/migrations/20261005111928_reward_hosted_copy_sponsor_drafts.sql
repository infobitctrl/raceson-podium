begin;
-- A frozen copy binding is separate from an organizer-approved source catalogue.
create table app_private.reward_demo_copy_setup_bindings (
 setup_id uuid primary key references app_private.reward_distribution_setups(id),
 batch_sha256 text not null references app_private.reward_demo_copy_batches(file_sha256),
 source_fingerprint text not null check(source_fingerprint ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now()
);
alter table app_private.reward_demo_copy_setup_bindings enable row level security;
revoke all on app_private.reward_demo_copy_setup_bindings from public,anon,authenticated,service_role;

create function app_private.reward_demo_copy_setup_template(p_id uuid,p_source jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare pots jsonb:='[]'; groups jsonb:='[]'; nodes jsonb:='[]'; leaves jsonb;
 slot integer; pot_id uuid; node_id uuid; round_id uuid; c jsonb; kind text; label text; basis text;
begin
 if p_id is null or p_id='00000000-0000-0000-0000-000000000000' then raise exception 'invalid_reward_setup'; end if;
 for slot in 0..5 loop
  pot_id:=md5(p_id::text||':pot:'||slot)::uuid;
  round_id:=null;
  if slot>0 then select (r->>'roundId')::uuid into strict round_id from jsonb_array_elements(p_source->'races') r where (r->>'slot')::integer=slot group by r->>'roundId'; end if;
  pots:=pots||jsonb_build_array(jsonb_build_object('nodeId',pot_id,'slot',slot,'roundId',round_id));
  leaves:='[]';
  for c in select value from jsonb_array_elements(p_source->'classifications') order by value->>'competitionId',value->>'id' loop
   node_id:=md5(p_id::text||':group:'||slot||':'||(c->>'id'))::uuid;
   label:=(case c->>'competitionId' when '38161390-0b72-48c8-b69b-ecd8cf85a800' then 'Long' when '94ed9600-f238-4db1-a2af-0da319da60a3' then 'Short' else null end)||' · '||(c->>'name');
   if label is null then raise exception 'copy_scope_changed'; end if;
   leaves:=leaves||jsonb_build_array(jsonb_build_object('id',node_id,'name',label,'shareBps',0,'locked',false,'children','[]'::jsonb,'rule',jsonb_build_object('basis',case when slot=0 then 'league_position' else 'race_position' end,'sharesBps','[5000,3000,2000]'::jsonb,'source',null)));
   groups:=groups||jsonb_build_array(jsonb_build_object('nodeId',node_id,'type','athlete_standings','method','ranked','minimumFinishes',1,'eligibilityApproved',false));
  end loop;
  foreach kind in array array['club_standings','athlete_finishes','athlete_metres','club_metres'] loop
   if slot>0 and kind<>'club_standings' then continue; end if;
   node_id:=md5(p_id::text||':group:'||slot||':'||kind)::uuid;
   label:=case kind when 'club_standings' then 'Combined clubs' when 'athlete_finishes' then 'Athlete finishes' when 'athlete_metres' then 'Athlete kilometres' else 'Club kilometres' end;
   basis:=case when kind='club_standings' then 'club_points' else 'participation' end;
   leaves:=leaves||jsonb_build_array(jsonb_build_object('id',node_id,'name',label,'shareBps',0,'locked',false,'children','[]'::jsonb,'rule',jsonb_build_object('basis',basis,'sharesBps',case when kind='club_standings' then '[5000,3000,2000]'::jsonb else '[]'::jsonb end,'source',null)));
   groups:=groups||jsonb_build_array(jsonb_build_object('nodeId',node_id,'type',kind,'method',case when kind='club_standings' then 'ranked' else 'proportional' end,'minimumFinishes',1,'eligibilityApproved',false));
  end loop;
  nodes:=nodes||jsonb_build_array(jsonb_build_object('id',pot_id,'name',case when slot=0 then 'League' else 'Round '||slot end,'shareBps',case when slot=0 then 5000 else 1000 end,'locked',false,'children',leaves,'rule',null));
 end loop;
 return jsonb_build_object('version',5,'name','Šibenik Trail League rewards','budgetMon','100','context',null,'stage','draft','programmeKind','league','event',null,
  'sponsorSelection',jsonb_build_object('sourceLeagueId',p_source->>'leagueId','sourceSeasonId',p_source->>'seasonId','eventEditionId',null),
  'policy','{"multipleAwards":"allow","ties":"split_occupied_places","fewerFinishers":"raceson_main_treasury","claimWindowDays":365,"claimStartsAt":"claims_open","securityPausesExtendWindow":true,"expiredClaims":"fixed_treasury","treasuryReturn":"raceson_default"}'::jsonb,
  'root',jsonb_build_object('id',md5(p_id::text||':root')::uuid,'name','Main pot','shareBps',10000,'locked',false,'children',nodes,'rule',null),
  'guided',jsonb_build_object('version',1,'pots',pots,'groups',groups,'counting','one_finish_per_round','clubAttribution','represented_at_finish'));
end $$;

create function app_private.reward_demo_copy_sponsor(p_actor_user_id uuid,p_actor_session_id uuid,p_action text,p_setup_id uuid default null,
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
   canonical:=canonical||jsonb_build_object('name',p_configuration->'name','budgetMon',p_configuration->'budgetMon');
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
create function public.service_reward_demo_copy_sponsor(p_actor_user_id uuid,p_actor_session_id uuid,p_action text,p_setup_id uuid default null,
 p_request_id uuid default null,p_expected_revision integer default null,p_configuration jsonb default null,p_source_fingerprint text default null)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select app_private.reward_demo_copy_sponsor(p_actor_user_id,p_actor_session_id,p_action,p_setup_id,p_request_id,p_expected_revision,p_configuration,p_source_fingerprint);
$$;
revoke all on function app_private.reward_demo_copy_setup_template(uuid,jsonb),
 app_private.reward_demo_copy_sponsor(uuid,uuid,text,uuid,uuid,integer,jsonb,text),
 public.service_reward_demo_copy_sponsor(uuid,uuid,text,uuid,uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_demo_copy_sponsor(uuid,uuid,text,uuid,uuid,integer,jsonb,text),
 public.service_reward_demo_copy_sponsor(uuid,uuid,text,uuid,uuid,integer,jsonb,text) to service_role;
commit;
