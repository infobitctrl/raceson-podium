-- Isolated demo only. These records authorize neither signing nor broadcasting.
-- Publication/activation deliberately await authoritative V3 clock composition.
begin;
create table app_private.reward_programme_lifecycle_intents_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  programme_intent_id uuid not null references app_private.reward_programme_deployment_intents_v3(id),
  upload_id uuid not null references app_private.reward_allocation_uploads_v3(id),
  slot integer not null check(slot between 1 and 4),
  step integer not null check(step>=0),
  predecessor_id uuid unique,
  chain_id integer not null check(chain_id in(31337,10143)),
  operator_address app_private.reward_address not null,
  nonce app_private.reward_uint256 not null check(nonce<=9007199254740991),
  body jsonb not null check(jsonb_typeof(body)='object'),
  created_by_user_id uuid not null references public.user_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  unique(programme_intent_id,slot,step),
  unique(programme_intent_id,slot,upload_id,id),
  unique(id,chain_id,operator_address,nonce),
  foreign key(programme_intent_id,slot,upload_id,predecessor_id)
    references app_private.reward_programme_lifecycle_intents_v3(programme_intent_id,slot,upload_id,id),
  check((step=0 and predecessor_id is null) or (step>0 and predecessor_id is not null))
);
create table app_private.reward_programme_lifecycle_attempts_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  intent_id uuid not null unique,
  chain_id integer not null,
  operator_address app_private.reward_address not null,
  nonce app_private.reward_uint256 not null,
  transaction_hash app_private.reward_bytes32 not null,
  body jsonb not null check(jsonb_typeof(body)='object'),
  recorded_by_user_id uuid not null references public.user_profiles(user_id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key(intent_id,chain_id,operator_address,nonce)
    references app_private.reward_programme_lifecycle_intents_v3(id,chain_id,operator_address,nonce),
  unique(chain_id,transaction_hash), unique(id,intent_id,transaction_hash)
);
alter table app_private.reward_programme_lifecycle_intents_v3 enable row level security;
alter table app_private.reward_programme_lifecycle_attempts_v3 enable row level security;
revoke all on app_private.reward_programme_lifecycle_intents_v3,app_private.reward_programme_lifecycle_attempts_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_programme_lifecycle_intents_v3,app_private.reward_programme_lifecycle_attempts_v3 to service_role;
create policy reward_programme_lifecycle_intents_v3_read on app_private.reward_programme_lifecycle_intents_v3 for select to service_role using(true);
create policy reward_programme_lifecycle_intents_v3_insert on app_private.reward_programme_lifecycle_intents_v3 for insert to service_role with check(true);
create policy reward_programme_lifecycle_attempts_v3_read on app_private.reward_programme_lifecycle_attempts_v3 for select to service_role using(true);
create policy reward_programme_lifecycle_attempts_v3_insert on app_private.reward_programme_lifecycle_attempts_v3 for insert to service_role with check(true);
create trigger reward_programme_lifecycle_intents_v3_immutable before update or delete on app_private.reward_programme_lifecycle_intents_v3
  for each row execute function app_private.reject_reward_ledger_mutation();
create trigger reward_programme_lifecycle_attempts_v3_immutable before update or delete on app_private.reward_programme_lifecycle_attempts_v3
  for each row execute function app_private.reject_reward_ledger_mutation();

-- One nonce namespace across legacy deployment/funding/lifecycle and V3 parent
-- and child work. Both FK directions require an actual, exactly scoped owner.
alter table app_private.reward_operator_nonce_slots add column programme_lifecycle_intent_id uuid unique;
alter table app_private.reward_operator_nonce_slots drop constraint reward_operator_nonce_slots_check;
alter table app_private.reward_operator_nonce_slots add constraint reward_operator_nonce_slots_check
  check(num_nonnulls(deployment_intent_id,funding_intent_id,lifecycle_intent_id,programme_deployment_intent_id,programme_lifecycle_intent_id)=1
    and ((num_nonnulls(programme_deployment_intent_id,programme_lifecycle_intent_id)=0 and campaign_id is not null)
      or (num_nonnulls(programme_deployment_intent_id,programme_lifecycle_intent_id)=1 and campaign_id is null)));
alter table app_private.reward_operator_nonce_slots add constraint reward_programme_lifecycle_nonce_v3_key
  unique(chain_id,operator_address,nonce,programme_lifecycle_intent_id);
alter table app_private.reward_operator_nonce_slots add constraint reward_programme_lifecycle_nonce_v3_owner
  foreign key(programme_lifecycle_intent_id,chain_id,operator_address,nonce)
  references app_private.reward_programme_lifecycle_intents_v3(id,chain_id,operator_address,nonce);
alter table app_private.reward_programme_lifecycle_intents_v3 add constraint reward_programme_lifecycle_v3_requires_nonce
  foreign key(chain_id,operator_address,nonce,id)
  references app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,programme_lifecycle_intent_id)
  deferrable initially deferred;
create function app_private.record_reward_programme_lifecycle_nonce_v3()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  insert into app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,programme_lifecycle_intent_id)
    values(new.chain_id,new.operator_address,new.nonce,new.id);
  return new;
end $$;
create trigger reward_programme_lifecycle_v3_nonce after insert on app_private.reward_programme_lifecycle_intents_v3
  for each row execute function app_private.record_reward_programme_lifecycle_nonce_v3();

-- Private read includes salted source mappings and possibly signed bytes. It is
-- never an HTTP projection. Reads preserve held history but always require Auth.
create function public.service_read_reward_programme_lifecycle_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid,p_upload_id uuid,p_intent_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare r jsonb; u jsonb; fresh jsonb; i app_private.reward_programme_lifecycle_intents_v3%rowtype;
  a app_private.reward_programme_lifecycle_attempts_v3%rowtype;
begin
  r:=public.service_read_reward_programme_registry_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if r->'registry'->>'intentId' is null or r->'context'->'intent'->>'createdByUserId' is distinct from p_actor_user_id::text
    then raise exception 'reward_programme_not_verified'; end if;
  u:=public.service_read_reward_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if p_upload_id is null or u->'prepared'->>'id' is distinct from p_upload_id::text
    or p_intent_id is null or p_intent_id='00000000-0000-0000-0000-000000000000'::uuid
    then raise exception 'reward_allocation_upload_not_found'; end if;
  select * into i from app_private.reward_programme_lifecycle_intents_v3 where id=p_intent_id;
  if i.id is not null and (i.programme_intent_id::text<>r->'registry'->>'intentId' or i.upload_id<>p_upload_id or i.slot<>p_slot
    or i.chain_id<>p_chain_id or i.created_by_user_id<>p_actor_user_id) then raise exception 'reward_programme_lifecycle_conflict'; end if;
  select * into a from app_private.reward_programme_lifecycle_attempts_v3 where intent_id=i.id;
  fresh:=public.service_read_reward_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if fresh is distinct from u then raise exception 'reward_planning_revision_changed'; end if;
  r:=public.service_read_reward_programme_registry_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  return jsonb_build_object('schema','raceson-programme-lifecycle-private-v3','registry',r,'upload',u,
    'intent',case when i.id is not null then jsonb_build_object('id',i.id,'programmeIntentId',i.programme_intent_id,'uploadId',i.upload_id,
      'slot',i.slot,'step',i.step,'predecessorId',i.predecessor_id,'chainId',i.chain_id,'operatorAddress',i.operator_address,
      'nonce',i.nonce::text,'body',i.body,'createdByUserId',i.created_by_user_id,'createdAt',i.created_at) end,
    'attempt',case when a.id is not null then jsonb_build_object('id',a.id,'intentId',a.intent_id,'body',a.body,
      'recordedByUserId',a.recorded_by_user_id,'recordedAt',a.recorded_at) end);
end $$;

-- Acquire shared signer FIRST. Calling the locked source reader before this
-- lock would invert order with the deployment worker and risk a deadlock.
create function app_private.lock_reward_programme_lifecycle_v3(p_actor uuid,p_session uuid,p_chain integer,p_draft uuid)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare d jsonb; signer text; org uuid;
begin
  d:=public.service_read_reward_planning_draft(p_actor,p_session,p_chain,p_draft);
  select operator_address into signer from app_private.reward_programme_deployment_intents_v3
    where draft_id=p_draft and chain_id=p_chain and created_by_user_id=p_actor;
  if not found then raise exception 'reward_programme_not_verified'; end if;
  org:=(d->>'organizationId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||p_chain::text||':'||signer,0));
  perform 1 from public.organization_memberships where user_id=p_actor and organization_id=org for share;
  perform 1 from public.organizations where id=org for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft for update;
end $$;
create function public.service_reserve_reward_programme_lifecycle_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid,p_upload_id uuid,p_intent_id uuid,p_predecessor_id uuid,p_pending_nonce text,p_body jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; r jsonb; u jsonb; i app_private.reward_programme_lifecycle_intents_v3%rowtype;
  previous app_private.reward_programme_lifecycle_intents_v3%rowtype; parent uuid; signer text; next_nonce numeric; next_step integer; k text;
  keys text[]:=array['action','batchStart','batchSize','packageHash','gasLimit','maxFeePerGas','maxPriorityFeePerGas','maxGasCostWei'];
begin
  perform app_private.lock_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  v:=public.service_read_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id,p_upload_id,p_intent_id);
  r:=v->'registry'; u:=v->'upload'; parent:=(r->'registry'->>'intentId')::uuid; signer:=r->'context'->'intent'->>'operatorAddress';
  if p_body is null or jsonb_typeof(p_body)<>'object' or not(p_body ?& keys) or p_body-keys<>'{}'::jsonb
    or p_body->>'action' is null or p_body->>'action' not in('complete_funding','upload_awards')
    or p_body->'packageHash' is distinct from u->'prepared'->'packageHash'
    or p_pending_nonce is null or p_pending_nonce !~ '^(0|[1-9][0-9]{0,15})$' or p_pending_nonce::numeric>9007199254740991
    then raise exception 'invalid_reward_programme_lifecycle'; end if;
  foreach k in array keys[5:8] loop
    if jsonb_typeof(p_body->k)<>'string' or p_body->>k !~ '^(0|[1-9][0-9]{0,77})$' then raise exception 'invalid_reward_programme_lifecycle'; end if;
    perform (p_body->>k)::app_private.reward_uint256;
  end loop;
  if (p_body->>'gasLimit')::numeric not between 1 and 30000000 or (p_body->>'maxFeePerGas')::numeric=0
    or (p_body->>'maxGasCostWei')::numeric=0 or (p_body->>'maxPriorityFeePerGas')::numeric>(p_body->>'maxFeePerGas')::numeric
    or (p_body->>'gasLimit')::numeric*(p_body->>'maxFeePerGas')::numeric>(p_body->>'maxGasCostWei')::numeric
    then raise exception 'invalid_reward_programme_lifecycle'; end if;
  select * into i from app_private.reward_programme_lifecycle_intents_v3 where id=p_intent_id;
  if found then
    if i.body<>p_body or i.predecessor_id is distinct from p_predecessor_id then raise exception 'reward_programme_lifecycle_conflict'; end if;
    return v; -- Exact history, including the original nonce, survives a hold.
  end if;
  if u->'current' is distinct from 'true'::jsonb or r->'context'->'intent'->'current' is distinct from 'true'::jsonb
    then raise exception 'reward_allocation_not_ready'; end if;
  if p_body->>'action'='complete_funding' then
    if p_predecessor_id is not null or p_body->'batchStart'<>'null'::jsonb or p_body->'batchSize'<>'null'::jsonb
      then raise exception 'invalid_reward_programme_lifecycle'; end if;
    next_step:=0;
  else
    select * into previous from app_private.reward_programme_lifecycle_intents_v3 where id=p_predecessor_id and programme_intent_id=parent
      and upload_id=p_upload_id and slot=p_slot and created_by_user_id=p_actor_user_id;
    if not found then raise exception 'reward_programme_lifecycle_predecessor_required'; end if;
    if jsonb_typeof(p_body->'batchStart')<>'number' or p_body->>'batchStart' !~ '^(0|[1-9][0-9]{0,4})$'
      or jsonb_typeof(p_body->'batchSize')<>'number' or p_body->>'batchSize' !~ '^[1-9][0-9]?$'
      or (p_body->>'batchSize')::integer>64
      or (p_body->>'batchStart')::integer<>(case when previous.step=0 then 0 else (previous.body->>'batchStart')::integer+(previous.body->>'batchSize')::integer end)
      or (p_body->>'batchStart')::integer+(p_body->>'batchSize')::integer>jsonb_array_length(u->'prepared'->'package'->'awards')
      then raise exception 'invalid_reward_programme_lifecycle'; end if;
    next_step:=previous.step+1;
  end if;
  if exists(select 1 from app_private.reward_programme_lifecycle_intents_v3 where programme_intent_id=parent and slot=p_slot and step=next_step)
    then raise exception 'reward_programme_lifecycle_conflict'; end if;
  select greatest(p_pending_nonce::numeric,coalesce(max(s.nonce)+1,0)) into next_nonce
    from app_private.reward_operator_nonce_slots s where s.chain_id=p_chain_id and s.operator_address=signer;
  if next_nonce>9007199254740991 then raise exception 'reward_deployment_nonce_exhausted'; end if;
  insert into app_private.reward_programme_lifecycle_intents_v3(id,programme_intent_id,upload_id,slot,step,predecessor_id,chain_id,operator_address,nonce,body,created_by_user_id)
    values(p_intent_id,parent,p_upload_id,p_slot,next_step,p_predecessor_id,p_chain_id,signer,next_nonce,p_body,p_actor_user_id);
  v:=public.service_read_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id,p_upload_id,p_intent_id);
  if v->'upload'->'current' is distinct from 'true'::jsonb or v->'registry'->'context'->'intent'->'current' is distinct from 'true'::jsonb
    then raise exception 'reward_allocation_not_ready'; end if;
  return v;
end $$;

create function public.service_record_reward_programme_lifecycle_attempt_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid,p_upload_id uuid,p_intent_id uuid,p_attempt_id uuid,p_body jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare v jsonb; i app_private.reward_programme_lifecycle_intents_v3%rowtype; a app_private.reward_programme_lifecycle_attempts_v3%rowtype; k text;
  keys text[]:=array['protocolVersion','action','chainId','contractAddress','operatorAddress','nonce','transactionHash','calldataHash',
    'signedTransaction','gasLimit','maxFeePerGas','maxPriorityFeePerGas'];
begin
  perform app_private.lock_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  v:=public.service_read_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id,p_upload_id,p_intent_id);
  select * into i from app_private.reward_programme_lifecycle_intents_v3 where id=p_intent_id;
  if not found then raise exception 'reward_programme_lifecycle_required'; end if;
  if p_attempt_id is null or p_attempt_id='00000000-0000-0000-0000-000000000000'::uuid or p_body is null
    or jsonb_typeof(p_body)<>'object' or not(p_body ?& keys) or p_body-keys<>'{}'::jsonb
    or p_body->'protocolVersion' is distinct from '3'::jsonb or p_body->'chainId' is distinct from to_jsonb(p_chain_id)
    or p_body->'action' is distinct from i.body->'action' or p_body->>'operatorAddress' is distinct from i.operator_address::text
    or p_body->>'nonce' is distinct from i.nonce::text
    or p_body->'contractAddress' is distinct from v->'upload'->'prepared'->'package'->'campaignAddress'
    then raise exception 'invalid_reward_programme_lifecycle_attempt'; end if;
  foreach k in array array['nonce','gasLimit','maxFeePerGas','maxPriorityFeePerGas'] loop
    if jsonb_typeof(p_body->k)<>'string' or p_body->>k !~ '^(0|[1-9][0-9]{0,77})$' then raise exception 'invalid_reward_programme_lifecycle_attempt'; end if;
    perform (p_body->>k)::app_private.reward_uint256;
  end loop;
  foreach k in array array['transactionHash','calldataHash'] loop
    if jsonb_typeof(p_body->k)<>'string' or p_body->>k !~ '^0x[0-9a-f]{64}$' or p_body->>k='0x'||repeat('0',64)
      then raise exception 'invalid_reward_programme_lifecycle_attempt'; end if;
  end loop;
  if jsonb_typeof(p_body->'signedTransaction')<>'string' or length(p_body->>'signedTransaction')>32772
    or p_body->>'signedTransaction' !~ '^0x02([0-9a-f]{2})+$' or (p_body->>'gasLimit')::numeric=0
    or (p_body->>'maxFeePerGas')::numeric=0 or (p_body->>'gasLimit')::numeric>(i.body->>'gasLimit')::numeric
    or (p_body->>'maxFeePerGas')::numeric>(i.body->>'maxFeePerGas')::numeric
    or (p_body->>'maxPriorityFeePerGas')::numeric>(i.body->>'maxPriorityFeePerGas')::numeric
    or (p_body->>'maxPriorityFeePerGas')::numeric>(p_body->>'maxFeePerGas')::numeric
    or (p_body->>'gasLimit')::numeric*(p_body->>'maxFeePerGas')::numeric>(i.body->>'maxGasCostWei')::numeric
    then raise exception 'invalid_reward_programme_lifecycle_attempt'; end if;
  select * into a from app_private.reward_programme_lifecycle_attempts_v3 where intent_id=p_intent_id or id=p_attempt_id;
  if found then
    if a.id<>p_attempt_id or a.intent_id<>p_intent_id or a.body<>p_body or a.recorded_by_user_id<>p_actor_user_id
      then raise exception 'reward_programme_lifecycle_attempt_conflict'; end if;
  else
    if v->'upload'->'current' is distinct from 'true'::jsonb or v->'registry'->'context'->'intent'->'current' is distinct from 'true'::jsonb
      then raise exception 'reward_allocation_not_ready'; end if;
    insert into app_private.reward_programme_lifecycle_attempts_v3(id,intent_id,chain_id,operator_address,nonce,transaction_hash,body,recorded_by_user_id)
      values(p_attempt_id,i.id,i.chain_id,i.operator_address,i.nonce,decode(substr(p_body->>'transactionHash',3),'hex'),p_body,p_actor_user_id) returning * into a;
    v:=public.service_read_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id,p_upload_id,p_intent_id);
    if v->'upload'->'current' is distinct from 'true'::jsonb or v->'registry'->'context'->'intent'->'current' is distinct from 'true'::jsonb
      then raise exception 'reward_allocation_not_ready'; end if;
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return jsonb_build_object('attemptId',a.id,'intentId',a.intent_id,'transactionHash','0x'||encode(a.transaction_hash,'hex'),
    'recordedByUserId',a.recorded_by_user_id,'recordedAt',a.recorded_at);
end $$;
revoke all on function app_private.record_reward_programme_lifecycle_nonce_v3(),app_private.lock_reward_programme_lifecycle_v3(uuid,uuid,integer,uuid),
  public.service_read_reward_programme_lifecycle_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid),
  public.service_reserve_reward_programme_lifecycle_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,uuid,text,jsonb),
  public.service_record_reward_programme_lifecycle_attempt_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function app_private.record_reward_programme_lifecycle_nonce_v3(),app_private.lock_reward_programme_lifecycle_v3(uuid,uuid,integer,uuid),
  public.service_read_reward_programme_lifecycle_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid),
  public.service_reserve_reward_programme_lifecycle_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,uuid,text,jsonb),
  public.service_record_reward_programme_lifecycle_attempt_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,uuid,jsonb) to service_role;
commit;
