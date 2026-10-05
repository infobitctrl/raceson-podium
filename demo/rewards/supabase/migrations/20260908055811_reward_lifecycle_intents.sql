begin;

-- One complete immutable package per verified vault, including future batches.
-- Upload calldata alone only commits its slice, not the remaining package.
alter table app_private.reward_upload_packages add constraint reward_upload_campaign_key unique(id,campaign_id);
create table app_private.reward_campaign_upload_bindings (
  campaign_id uuid primary key references app_private.reward_verified_deployments(campaign_id) on delete restrict,
  upload_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique(campaign_id,upload_id),
  foreign key(upload_id,campaign_id) references app_private.reward_upload_packages(id,campaign_id) on delete restrict
);
create table app_private.reward_lifecycle_intents (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  upload_id uuid not null,
  observation_id uuid not null references app_private.reward_campaign_observations(id) on delete restrict,
  chain_id integer not null check(chain_id in (10143,31337)),
  operator_address app_private.reward_address not null,
  nonce app_private.reward_uint256 not null check(nonce<=9007199254740991),
  action text not null check(action in ('upload_awards','stage_allocation','activate')),
  batch_start integer,
  batch_size integer,
  created_by_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  check((action='upload_awards' and batch_start is not null and batch_start between 0 and 19999
    and batch_size is not null and batch_size between 1 and 64 and batch_start+batch_size<=20000)
    or (action in ('stage_allocation','activate') and batch_start is null and batch_size is null)),
  foreign key(campaign_id,upload_id) references app_private.reward_campaign_upload_bindings(campaign_id,upload_id) on delete restrict,
  unique nulls not distinct(campaign_id,action,batch_start),
  unique(campaign_id,created_by_user_id,idempotency_key),
  unique(id,campaign_id,chain_id,operator_address,nonce)
);
create index reward_lifecycle_observation_idx on app_private.reward_lifecycle_intents(observation_id);

-- Extend the existing nonce owner sum type; never create a separate nonce book.
alter table app_private.reward_operator_nonce_slots add column lifecycle_intent_id uuid unique;
alter table app_private.reward_operator_nonce_slots drop constraint reward_operator_nonce_slots_check;
alter table app_private.reward_operator_nonce_slots add constraint reward_operator_nonce_slots_check
  check(num_nonnulls(deployment_intent_id,funding_intent_id,lifecycle_intent_id)=1);
alter table app_private.reward_operator_nonce_slots add constraint reward_lifecycle_nonce_slot_key
  unique(chain_id,operator_address,nonce,lifecycle_intent_id);
alter table app_private.reward_operator_nonce_slots add constraint reward_lifecycle_nonce_owner_fk
  foreign key(lifecycle_intent_id,campaign_id,chain_id,operator_address,nonce)
  references app_private.reward_lifecycle_intents(id,campaign_id,chain_id,operator_address,nonce) on delete restrict;
alter table app_private.reward_lifecycle_intents add constraint reward_lifecycle_requires_nonce_slot
  foreign key(chain_id,operator_address,nonce,id)
  references app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,lifecycle_intent_id) deferrable initially deferred;

create or replace function app_private.record_reward_operator_nonce_slot()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_schema<>'app_private' or tg_op<>'INSERT' then
    raise exception using errcode='22023',message='invalid_reward_nonce_owner'; end if;
  if tg_table_name='reward_deployment_intents' then
    insert into app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,campaign_id,deployment_intent_id)
      values(new.chain_id,new.operator_address,new.nonce,new.campaign_id,new.id);
  elsif tg_table_name='reward_funding_intents' then
    insert into app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,campaign_id,funding_intent_id)
      values(new.chain_id,new.operator_address,new.nonce,new.campaign_id,new.id);
  elsif tg_table_name='reward_lifecycle_intents' then
    insert into app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,campaign_id,lifecycle_intent_id)
      values(new.chain_id,new.operator_address,new.nonce,new.campaign_id,new.id);
  else raise exception using errcode='22023',message='invalid_reward_nonce_owner'; end if;
  return new;
end $$;
create trigger reward_lifecycle_nonce_slot after insert on app_private.reward_lifecycle_intents
  for each row execute function app_private.record_reward_operator_nonce_slot();

create table app_private.reward_lifecycle_attempts (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references app_private.reward_lifecycle_intents(id) on delete restrict,
  transaction_hash app_private.reward_bytes32 not null unique,
  attempt_body jsonb not null check(jsonb_typeof(attempt_body)='object' and octet_length(attempt_body::text)<=40000),
  recorded_by_user_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  unique(intent_id,recorded_by_user_id,idempotency_key)
);
do $$ declare name text; begin
  foreach name in array array['reward_campaign_upload_bindings','reward_lifecycle_intents','reward_lifecycle_attempts'] loop
    execute format('alter table app_private.%I enable row level security',name);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',name);
    execute format('grant select,insert on app_private.%I to service_role',name);
    execute format('create policy %I on app_private.%I for select to service_role using(true)',name||'_service_select',name);
    execute format('create policy %I on app_private.%I for insert to service_role with check(true)',name||'_service_insert',name);
    execute format('create trigger reward_lifecycle_immutable before update or delete on app_private.%I for each row execute function app_private.reject_reward_ledger_mutation()',name);
  end loop;
end $$;

-- Private public-shaped package read: no evidence body, entity IDs or salts.
-- Exact intent/key reads retain their ORIGINAL checkpoint, not latest state.
create function public.service_read_reward_lifecycle_context(p_campaign_id uuid,p_actor_user_id uuid,p_upload_id uuid,
  p_intent_id uuid default null,p_idempotency_key text default null)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare context jsonb; u app_private.reward_upload_packages%rowtype; i app_private.reward_lifecycle_intents%rowtype;
  d app_private.reward_verified_deployments%rowtype; o app_private.reward_campaign_observations%rowtype;
begin
  context:=public.service_read_reward_deployment_context(p_campaign_id,p_actor_user_id,null);
  select * into u from app_private.reward_upload_packages where id=p_upload_id and campaign_id=p_campaign_id;
  if not found then raise exception using errcode='22023',message='reward_upload_reference_mismatch'; end if;
  if (p_intent_id is not null and p_idempotency_key is not null)
    or (p_idempotency_key is not null and length(p_idempotency_key) not between 8 and 128) then
    raise exception using errcode='22023',message='invalid_reward_lifecycle_request'; end if;
  select * into i from app_private.reward_lifecycle_intents where campaign_id=p_campaign_id
    and ((p_intent_id is not null and id=p_intent_id)
      or (p_idempotency_key is not null and idempotency_key=p_idempotency_key and created_by_user_id=p_actor_user_id));
  if (p_intent_id is not null and i.id is null) or (i.id is not null and i.upload_id<>u.id) then
    raise exception using errcode='22023',message='reward_lifecycle_intent_mismatch'; end if;
  select * into d from app_private.reward_verified_deployments where campaign_id=p_campaign_id;
  select * into o from app_private.reward_campaign_observations where campaign_id=p_campaign_id
    and (i.id is null or id=i.observation_id) order by finalized_block_number desc,observed_at desc,id desc limit 1;
  return jsonb_build_object('deploymentContext',context,
    'upload',jsonb_build_object('id',u.id,'allocationId',u.allocation_id,'preparedByUserId',u.prepared_by_user_id,'preparedAt',u.prepared_at,'body',u.upload_body),
    'checkpoint',case when o.id is null then null else jsonb_build_object('campaignId',d.campaign_id,'intentId',d.intent_id,'attemptId',d.attempt_id,
      'deployment',d.identity_body,'observationId',o.id,'observation',o.observation_body,'observedByUserId',o.observed_by_user_id,
      'observedAt',o.observed_at,'idempotencyKey',o.idempotency_key) end,
    'intent',case when i.id is null then null else jsonb_build_object('id',i.id,'observationId',i.observation_id,'nonce',i.nonce::text,
      'action',i.action,'batchStart',i.batch_start,'batchSize',i.batch_size,'createdByUserId',i.created_by_user_id,
      'createdAt',i.created_at,'idempotencyKey',i.idempotency_key) end);
end $$;

-- A preparation record, NOT permission to send or proof of predecessor jobs.
-- TS verifies full prefix Keccak/code/RPC before calling. SQL rechecks current
-- source, latest checkpoint, budgets, prefix totals, clocks and actor under lock.
create function public.service_reserve_reward_lifecycle(p_campaign_id uuid,p_actor_user_id uuid,p_upload_id uuid,p_action text,
  p_idempotency_key text,p_observation_id uuid,p_observed_chain_id integer,p_pending_nonce text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_campaigns%rowtype; p app_private.reward_programmes%rowtype; u app_private.reward_upload_packages%rowtype;
  i app_private.reward_lifecycle_intents%rowtype; d app_private.reward_verified_deployments%rowtype; o app_private.reward_campaign_observations%rowtype;
  next_nonce numeric; a jsonb; evidence jsonb; count_uploaded integer; total_count integer; start_at integer; size integer; pot integer; prefix_total numeric;
begin
  select * into c from app_private.reward_campaigns where id=p_campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into p from app_private.reward_programmes where id=c.programme_id;
  if p_action is null or p_action not in ('upload_awards','stage_allocation','activate') or p_upload_id is null or p_observation_id is null
    or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 or p_observed_chain_id is distinct from p.chain_id
    or p_pending_nonce is null or p_pending_nonce !~ '^(0|[1-9][0-9]{0,15})$' or p_pending_nonce::numeric>9007199254740991 then
    raise exception using errcode='22023',message='invalid_reward_lifecycle_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||p.chain_id::text||':'||p.operator_address,0));
  perform id from app_private.reward_programmes where id=p.id for update;
  perform app_private.require_reward_operator(p.id,p_actor_user_id);
  select * into i from app_private.reward_lifecycle_intents where campaign_id=c.id and created_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    if i.upload_id<>p_upload_id or i.action<>p_action then
      raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
    return public.service_read_reward_lifecycle_context(c.id,p_actor_user_id,p_upload_id,i.id,null);
  end if;
  evidence:=public.service_check_reward_upload_evidence(c.id,p_actor_user_id,p_upload_id);
  select * into u from app_private.reward_upload_packages where id=p_upload_id and campaign_id=c.id;
  select * into d from app_private.reward_verified_deployments where campaign_id=c.id;
  if not found or d.chain_id<>p.chain_id
    or d.identity_body->>'buildId' is distinct from 'raceson-reward-campaign-v2-funding-v1-solc-0.8.36-cancun-ir-200'
    or d.identity_body->>'creationCodeHash' is distinct from '0x57486b6aee9c3f6cc7182982b67243919bea1e2ca05dd034501450bc6d22641e' then
    raise exception using errcode='22023',message='reward_lifecycle_deployment_not_verified'; end if;
  select * into o from app_private.reward_campaign_observations where campaign_id=c.id
    order by finalized_block_number desc,observed_at desc,id desc limit 1;
  if not found or o.id<>p_observation_id or o.observed_by_user_id<>p_actor_user_id then
    raise exception using errcode='22023',message='reward_lifecycle_checkpoint_changed'; end if;
  a:=o.observation_body->'accounting'; pot:=case c.pot when 'race' then 0 else 1 end;
  perform app_private.require_reward_campaign_accounting(a,pot);
  total_count:=jsonb_array_length(u.upload_body->'awards');
  if a->>'state' is distinct from (case p_action when 'activate' then '2' else '1' end)
    or (a->>'accountedFunding')::numeric<>c.budget_wei or (a->'budgets'->>pot)::numeric<>c.budget_wei or c.budget_wei=0
    or (a->>'entitlementCount')::numeric>total_count then
    raise exception using errcode='22023',message='reward_lifecycle_prestate_mismatch'; end if;
  count_uploaded:=(a->>'entitlementCount')::integer;
  select coalesce(sum((award->>'amount')::numeric),0) into prefix_total
    from jsonb_array_elements(u.upload_body->'awards') with ordinality x(award,n) where n<=count_uploaded;
  if (a->'allocated'->>pot)::numeric<>prefix_total
    or (count_uploaded=0 and a->>'uploadDigest'<>'0x'||repeat('0',64))
    or (count_uploaded=total_count and a->>'uploadDigest' is distinct from u.upload_body->>'uploadDigest') then
    raise exception using errcode='22023',message='reward_lifecycle_prestate_mismatch'; end if;
  if p_action='upload_awards' then
    if count_uploaded>=total_count then raise exception using errcode='22023',message='reward_lifecycle_upload_complete'; end if;
    start_at:=count_uploaded; size:=least(64,total_count-count_uploaded);
  else
    if count_uploaded<>total_count or (o.observation_body#>>'{finalizedBlock,timestamp}')::numeric<(u.upload_body->>'latestPublicationAt')::numeric then
      raise exception using errcode='22023',message='reward_lifecycle_prestate_mismatch'; end if;
    if p_action='activate' then
      if a->>'snapshotDigest' is distinct from u.upload_body->>'snapshotDigest' or a->>'allocationDigest' is distinct from u.upload_body->>'allocationDigest'
        or (a->>'activationNotBefore')::numeric<(evidence->>'sourceReviewEndsAt')::numeric then
        raise exception using errcode='22023',message='reward_lifecycle_prestate_mismatch'; end if;
      if (o.observation_body#>>'{finalizedBlock,timestamp}')::numeric<(a->>'activationNotBefore')::numeric
        or floor(extract(epoch from clock_timestamp()))<(evidence->>'sourceReviewEndsAt')::numeric then
        raise exception using errcode='55000',message='reward_lifecycle_review_not_finished'; end if;
    end if;
  end if;
  if exists(select 1 from app_private.reward_campaign_upload_bindings where campaign_id=c.id and upload_id<>u.id) then
    raise exception using errcode='22023',message='reward_lifecycle_package_conflict'; end if;
  if exists(select 1 from app_private.reward_lifecycle_intents where campaign_id=c.id and action=p_action and batch_start is not distinct from start_at) then
    raise exception using errcode='22023',message='reward_lifecycle_already_planned'; end if;
  select greatest(p_pending_nonce::numeric,coalesce(max(nonce)+1,0)) into next_nonce
    from app_private.reward_operator_nonce_slots where chain_id=p.chain_id and operator_address=p.operator_address;
  if next_nonce>9007199254740991 then raise exception using errcode='22023',message='reward_lifecycle_nonce_exhausted'; end if;
  insert into app_private.reward_campaign_upload_bindings(campaign_id,upload_id) values(c.id,u.id) on conflict(campaign_id) do nothing;
  insert into app_private.reward_lifecycle_intents(campaign_id,upload_id,observation_id,chain_id,operator_address,nonce,action,batch_start,batch_size,created_by_user_id,idempotency_key)
    values(c.id,u.id,o.id,p.chain_id,p.operator_address,next_nonce,p_action,start_at,size,p_actor_user_id,p_idempotency_key) returning * into i;
  return public.service_read_reward_lifecycle_context(c.id,p_actor_user_id,u.id,i.id,null);
end $$;

-- Structural defense only; no SQL signature recovery or trusted hash oracle.
create function public.service_record_reward_lifecycle_attempt(p_campaign_id uuid,p_actor_user_id uuid,p_upload_id uuid,p_intent_id uuid,
  p_idempotency_key text,p_attempt jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_campaigns%rowtype; i app_private.reward_lifecycle_intents%rowtype; d app_private.reward_verified_deployments%rowtype;
  a app_private.reward_lifecycle_attempts%rowtype; u app_private.reward_upload_packages%rowtype; field text;
begin
  select * into c from app_private.reward_campaigns where id=p_campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  perform id from app_private.reward_programmes where id=c.programme_id for update;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into i from app_private.reward_lifecycle_intents where id=p_intent_id and campaign_id=c.id and upload_id=p_upload_id;
  if not found then raise exception using errcode='22023',message='reward_lifecycle_intent_mismatch'; end if;
  select * into d from app_private.reward_verified_deployments where campaign_id=c.id;
  select * into u from app_private.reward_upload_packages where id=i.upload_id;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or jsonb_typeof(p_attempt) is distinct from 'object' or octet_length(p_attempt::text)>40000 then
    raise exception using errcode='22023',message='invalid_reward_lifecycle_attempt'; end if;
  select * into a from app_private.reward_lifecycle_attempts where intent_id=i.id and recorded_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    if a.attempt_body is distinct from p_attempt then raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
  else
    if (select count(*) from jsonb_object_keys(p_attempt))<>17 or not p_attempt ?& array['schemaVersion','action','chainId','operatorAddress','nonce',
      'contractAddress','transactionHash','signedTransaction','buildId','calldataHash','allocationDigest','batchStart','batchSize','value','gasLimit','maxFeePerGas','maxPriorityFeePerGas'] then
      raise exception using errcode='22023',message='invalid_reward_lifecycle_attempt'; end if;
    if p_attempt->'schemaVersion' is distinct from '1'::jsonb or p_attempt->>'action' is distinct from i.action
      or p_attempt->'chainId' is distinct from to_jsonb(i.chain_id) or p_attempt->>'operatorAddress' is distinct from i.operator_address
      or p_attempt->>'contractAddress' is distinct from d.contract_address or p_attempt->>'buildId' is distinct from d.identity_body->>'buildId'
      or p_attempt->>'allocationDigest' is distinct from u.upload_body->>'allocationDigest'
      or p_attempt->'batchStart' is distinct from coalesce(to_jsonb(i.batch_start),'null'::jsonb)
      or p_attempt->'batchSize' is distinct from coalesce(to_jsonb(i.batch_size),'null'::jsonb)
      or jsonb_typeof(p_attempt->'signedTransaction') is distinct from 'string' or length(p_attempt->>'signedTransaction') not between 6 and 32772
      or p_attempt->>'signedTransaction' !~ '^0x02([0-9a-f]{2})+$' then
      raise exception using errcode='22023',message='invalid_reward_lifecycle_attempt'; end if;
    foreach field in array array['transactionHash','calldataHash'] loop
      if jsonb_typeof(p_attempt->field) is distinct from 'string' or p_attempt->>field !~ '^0x[0-9a-f]{64}$' or p_attempt->>field='0x'||repeat('0',64) then
        raise exception using errcode='22023',message='invalid_reward_lifecycle_attempt'; end if;
    end loop;
    foreach field in array array['nonce','value','gasLimit','maxFeePerGas','maxPriorityFeePerGas'] loop
      if jsonb_typeof(p_attempt->field) is distinct from 'string' or p_attempt->>field !~ '^(0|[1-9][0-9]{0,77})$' then
        raise exception using errcode='22023',message='invalid_reward_lifecycle_attempt'; end if;
      perform (p_attempt->>field)::app_private.reward_uint256;
    end loop;
    if p_attempt->>'nonce'<>i.nonce::text or p_attempt->>'value'<>'0'
      or (p_attempt->>'gasLimit')::numeric=0 or (p_attempt->>'maxFeePerGas')::numeric=0
      or (p_attempt->>'maxPriorityFeePerGas')::numeric>(p_attempt->>'maxFeePerGas')::numeric then
      raise exception using errcode='22023',message='invalid_reward_lifecycle_attempt'; end if;
    if exists(select 1 from app_private.reward_lifecycle_attempts where transaction_hash=decode(substr(p_attempt->>'transactionHash',3),'hex')) then
      raise exception using errcode='22023',message='reward_lifecycle_transaction_already_recorded'; end if;
    insert into app_private.reward_lifecycle_attempts(intent_id,transaction_hash,attempt_body,recorded_by_user_id,idempotency_key)
      values(i.id,decode(substr(p_attempt->>'transactionHash',3),'hex'),p_attempt,p_actor_user_id,p_idempotency_key) returning * into a;
  end if;
  return jsonb_build_object('attemptId',a.id,'intentId',i.id,'campaignId',c.id,'recordedByUserId',a.recorded_by_user_id,
    'recordedAt',a.recorded_at,'transactionHash','0x'||encode(a.transaction_hash,'hex'));
end $$;

create function public.service_read_reward_lifecycle_attempt(p_campaign_id uuid,p_actor_user_id uuid,p_upload_id uuid,p_intent_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare context jsonb; a app_private.reward_lifecycle_attempts%rowtype;
begin
  context:=public.service_read_reward_lifecycle_context(p_campaign_id,p_actor_user_id,p_upload_id,p_intent_id,null);
  select * into a from app_private.reward_lifecycle_attempts where id=p_attempt_id and intent_id=p_intent_id;
  if not found then raise exception using errcode='22023',message='reward_lifecycle_attempt_mismatch'; end if;
  return jsonb_build_object('context',context,'attempt',jsonb_build_object('id',a.id,'intentId',a.intent_id,'body',a.attempt_body,
    'recordedByUserId',a.recorded_by_user_id,'recordedAt',a.recorded_at,'idempotencyKey',a.idempotency_key));
end $$;
revoke all on function public.service_read_reward_lifecycle_context(uuid,uuid,uuid,uuid,text),
  public.service_reserve_reward_lifecycle(uuid,uuid,uuid,text,text,uuid,integer,text),
  public.service_record_reward_lifecycle_attempt(uuid,uuid,uuid,uuid,text,jsonb),public.service_read_reward_lifecycle_attempt(uuid,uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.service_read_reward_lifecycle_context(uuid,uuid,uuid,uuid,text),
  public.service_reserve_reward_lifecycle(uuid,uuid,uuid,text,text,uuid,integer,text),
  public.service_record_reward_lifecycle_attempt(uuid,uuid,uuid,uuid,text,jsonb),public.service_read_reward_lifecycle_attempt(uuid,uuid,uuid,uuid,uuid)
  to service_role;
commit;
