begin;

-- One initial funding intent per vault. Changed-prestate/reverted/replacement
-- reconciliation must be implemented explicitly; never edit/reuse this nonce.
create table app_private.reward_funding_intents (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references app_private.reward_verified_deployments(campaign_id) on delete restrict,
  observation_id uuid not null references app_private.reward_campaign_observations(id) on delete restrict,
  chain_id integer not null check(chain_id in (10143,31337)),
  operator_address app_private.reward_address not null,
  nonce app_private.reward_uint256 not null check(nonce<=9007199254740991),
  expected_accounted_funding app_private.reward_uint256 not null,
  expected_budget app_private.reward_uint256 not null check(expected_budget>0),
  created_by_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  check(expected_accounted_funding<=expected_budget),
  unique(id,campaign_id,chain_id,operator_address,nonce)
);
alter table app_private.reward_deployment_intents
  add constraint reward_deployment_nonce_owner_key unique(id,campaign_id,chain_id,operator_address,nonce);

-- Both directions are checked: every intent owns exactly one slot, and every
-- slot has exactly one real, matching owner. No polymorphic unvalidated UUID.
create table app_private.reward_operator_nonce_slots (
  chain_id integer not null check(chain_id in (10143,31337)),
  operator_address app_private.reward_address not null,
  nonce app_private.reward_uint256 not null check(nonce<=9007199254740991),
  campaign_id uuid not null references app_private.reward_campaigns(id) on delete restrict,
  deployment_intent_id uuid unique,
  funding_intent_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  primary key(chain_id,operator_address,nonce),
  check((deployment_intent_id is null)<>(funding_intent_id is null)),
  unique(chain_id,operator_address,nonce,deployment_intent_id),
  unique(chain_id,operator_address,nonce,funding_intent_id),
  foreign key(deployment_intent_id,campaign_id,chain_id,operator_address,nonce)
    references app_private.reward_deployment_intents(id,campaign_id,chain_id,operator_address,nonce) on delete restrict,
  foreign key(funding_intent_id,campaign_id,chain_id,operator_address,nonce)
    references app_private.reward_funding_intents(id,campaign_id,chain_id,operator_address,nonce) on delete restrict
);
insert into app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,campaign_id,deployment_intent_id,created_at)
  select chain_id,operator_address,nonce,campaign_id,id,created_at from app_private.reward_deployment_intents;

alter table app_private.reward_deployment_intents add constraint reward_deployment_requires_nonce_slot
  foreign key(chain_id,operator_address,nonce,id)
  references app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,deployment_intent_id)
  deferrable initially deferred;
alter table app_private.reward_funding_intents add constraint reward_funding_requires_nonce_slot
  foreign key(chain_id,operator_address,nonce,id)
  references app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,funding_intent_id)
  deferrable initially deferred;

create function app_private.record_reward_operator_nonce_slot()
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
  else raise exception using errcode='22023',message='invalid_reward_nonce_owner'; end if;
  return new;
end $$;
create trigger reward_deployment_nonce_slot after insert on app_private.reward_deployment_intents
  for each row execute function app_private.record_reward_operator_nonce_slot();
create trigger reward_funding_nonce_slot after insert on app_private.reward_funding_intents
  for each row execute function app_private.record_reward_operator_nonce_slot();

create table app_private.reward_funding_attempts (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references app_private.reward_funding_intents(id) on delete restrict,
  transaction_hash app_private.reward_bytes32 not null unique,
  attempt_body jsonb not null check(jsonb_typeof(attempt_body)='object' and octet_length(attempt_body::text)<=12000),
  recorded_by_user_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  unique(intent_id,recorded_by_user_id,idempotency_key)
);

do $$ declare name text; begin
  foreach name in array array['reward_funding_intents','reward_operator_nonce_slots','reward_funding_attempts'] loop
    execute format('alter table app_private.%I enable row level security',name);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',name);
    execute format('grant select,insert on app_private.%I to service_role',name);
    execute format('create policy %I on app_private.%I for select to service_role using(true)',name||'_service_select',name);
    execute format('create policy %I on app_private.%I for insert to service_role with check(true)',name||'_service_insert',name);
    execute format('create trigger reward_funding_immutable before update or delete on app_private.%I for each row execute function app_private.reject_reward_ledger_mutation()',name);
  end loop;
end $$;

-- Existing deployments now reserve from the common book. Same advisory key and
-- chain/operator -> programme lock order; no network I/O inside a transaction.
create or replace function public.service_reserve_reward_deployment(p_campaign_id uuid,p_actor_user_id uuid,p_idempotency_key text,
  p_observed_chain_id integer,p_pending_nonce text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_campaigns%rowtype; p app_private.reward_programmes%rowtype; i app_private.reward_deployment_intents%rowtype; next_nonce numeric;
begin
  select * into c from app_private.reward_campaigns where id=p_campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into p from app_private.reward_programmes where id=c.programme_id;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or p_observed_chain_id is distinct from p.chain_id or p_pending_nonce is null or p_pending_nonce !~ '^(0|[1-9][0-9]{0,15})$'
    or p_pending_nonce::numeric>9007199254740991 then
    raise exception using errcode='22023',message='invalid_reward_deployment_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||p.chain_id::text||':'||p.operator_address,0));
  perform id from app_private.reward_programmes where id=p.id for update;
  perform app_private.require_reward_operator(p.id,p_actor_user_id);
  select * into i from app_private.reward_deployment_intents where campaign_id=c.id;
  if found then
    if i.created_by_user_id<>p_actor_user_id or i.idempotency_key<>p_idempotency_key then
      raise exception using errcode='22023',message='reward_deployment_already_planned'; end if;
  else
    select greatest(p_pending_nonce::numeric,coalesce(max(nonce)+1,0)) into next_nonce
      from app_private.reward_operator_nonce_slots where chain_id=p.chain_id and operator_address=p.operator_address;
    if next_nonce>9007199254740991 then raise exception using errcode='22023',message='reward_deployment_nonce_exhausted'; end if;
    insert into app_private.reward_deployment_intents(campaign_id,chain_id,operator_address,nonce,build_id,creation_code_hash,created_by_user_id,idempotency_key)
      values(c.id,p.chain_id,p.operator_address,next_nonce,'raceson-reward-campaign-v2-funding-v1-solc-0.8.36-cancun-ir-200',
        decode('57486b6aee9c3f6cc7182982b67243919bea1e2ca05dd034501450bc6d22641e','hex'),p_actor_user_id,p_idempotency_key) returning * into i;
  end if;
  return public.service_read_reward_deployment_context(c.id,p_actor_user_id,i.id);
end $$;

create function public.service_read_reward_funding_context(p_campaign_id uuid,p_actor_user_id uuid,p_intent_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare context jsonb; i app_private.reward_funding_intents%rowtype; d app_private.reward_verified_deployments%rowtype;
  o app_private.reward_campaign_observations%rowtype;
begin
  context:=public.service_read_reward_deployment_context(p_campaign_id,p_actor_user_id,null);
  select * into i from app_private.reward_funding_intents where campaign_id=p_campaign_id;
  if p_intent_id is not null and (i.id is null or i.id<>p_intent_id) then
    raise exception using errcode='22023',message='reward_funding_intent_mismatch'; end if;
  select * into d from app_private.reward_verified_deployments where campaign_id=p_campaign_id;
  select * into o from app_private.reward_campaign_observations where campaign_id=p_campaign_id
    and (i.id is null or id=i.observation_id) order by finalized_block_number desc,observed_at desc,id desc limit 1;
  return jsonb_build_object('deploymentContext',context,'checkpoint',case when o.id is null then null else jsonb_build_object(
    'campaignId',d.campaign_id,'intentId',d.intent_id,'attemptId',d.attempt_id,'deployment',d.identity_body,
    'observationId',o.id,'observation',o.observation_body,'observedByUserId',o.observed_by_user_id,'observedAt',o.observed_at,'idempotencyKey',o.idempotency_key) end,
    'intent',case when i.id is null then null else jsonb_build_object('id',i.id,'observationId',i.observation_id,'nonce',i.nonce::text,
      'expectedAccountedFunding',i.expected_accounted_funding::text,'expectedBudget',i.expected_budget::text,
      'createdByUserId',i.created_by_user_id,'createdAt',i.created_at,'idempotencyKey',i.idempotency_key) end);
end $$;

create function public.service_reserve_reward_funding(p_campaign_id uuid,p_actor_user_id uuid,p_idempotency_key text,
  p_observation_id uuid,p_observed_chain_id integer,p_pending_nonce text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_campaigns%rowtype; p app_private.reward_programmes%rowtype; i app_private.reward_funding_intents%rowtype;
  d app_private.reward_verified_deployments%rowtype; o app_private.reward_campaign_observations%rowtype; next_nonce numeric; accounted numeric;
begin
  select * into c from app_private.reward_campaigns where id=p_campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into p from app_private.reward_programmes where id=c.programme_id;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 or p_observation_id is null
    or p_observed_chain_id is distinct from p.chain_id or p_pending_nonce is null or p_pending_nonce !~ '^(0|[1-9][0-9]{0,15})$'
    or p_pending_nonce::numeric>9007199254740991 then
    raise exception using errcode='22023',message='invalid_reward_funding_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||p.chain_id::text||':'||p.operator_address,0));
  perform id from app_private.reward_programmes where id=p.id for update;
  perform app_private.require_reward_operator(p.id,p_actor_user_id);
  select * into i from app_private.reward_funding_intents where campaign_id=c.id;
  if found then
    if i.created_by_user_id<>p_actor_user_id or i.idempotency_key<>p_idempotency_key then
      raise exception using errcode='22023',message='reward_funding_already_planned'; end if;
  else
    select * into d from app_private.reward_verified_deployments where campaign_id=c.id;
    if not found or d.chain_id<>p.chain_id
      or d.identity_body->>'buildId' is distinct from 'raceson-reward-campaign-v2-funding-v1-solc-0.8.36-cancun-ir-200'
      or d.identity_body->>'creationCodeHash' is distinct from '0x57486b6aee9c3f6cc7182982b67243919bea1e2ca05dd034501450bc6d22641e' then
      raise exception using errcode='22023',message='reward_funding_deployment_not_verified'; end if;
    select * into o from app_private.reward_campaign_observations where campaign_id=c.id
      order by finalized_block_number desc,observed_at desc,id desc limit 1;
    if not found or o.id<>p_observation_id or o.observed_by_user_id<>p_actor_user_id then
      raise exception using errcode='22023',message='reward_funding_checkpoint_changed'; end if;
    perform app_private.require_reward_campaign_accounting(o.observation_body->'accounting',case c.pot when 'race' then 0 else 1 end);
    accounted:=(o.observation_body->'accounting'->>'accountedFunding')::numeric;
    if o.observation_body->'accounting'->>'state'<>'0' or accounted>c.budget_wei or c.budget_wei=0 then
      raise exception using errcode='22023',message='reward_campaign_not_fundable'; end if;
    select greatest(p_pending_nonce::numeric,coalesce(max(nonce)+1,0)) into next_nonce
      from app_private.reward_operator_nonce_slots where chain_id=p.chain_id and operator_address=p.operator_address;
    if next_nonce>9007199254740991 then raise exception using errcode='22023',message='reward_funding_nonce_exhausted'; end if;
    insert into app_private.reward_funding_intents(campaign_id,observation_id,chain_id,operator_address,nonce,
      expected_accounted_funding,expected_budget,created_by_user_id,idempotency_key)
      values(c.id,o.id,p.chain_id,p.operator_address,next_nonce,accounted,c.budget_wei,p_actor_user_id,p_idempotency_key) returning * into i;
  end if;
  return public.service_read_reward_funding_context(c.id,p_actor_user_id,i.id);
end $$;

-- Structural defence in depth only. Cryptographic signed-byte validation occurs
-- in the private TypeScript service before write and again on worker reads.
create function public.service_record_reward_funding_attempt(p_campaign_id uuid,p_actor_user_id uuid,p_intent_id uuid,
  p_idempotency_key text,p_attempt jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_campaigns%rowtype; i app_private.reward_funding_intents%rowtype; d app_private.reward_verified_deployments%rowtype;
  a app_private.reward_funding_attempts%rowtype; field text;
begin
  select * into c from app_private.reward_campaigns where id=p_campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  perform id from app_private.reward_programmes where id=c.programme_id for update;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into i from app_private.reward_funding_intents where id=p_intent_id and campaign_id=c.id;
  if not found then raise exception using errcode='22023',message='reward_funding_intent_mismatch'; end if;
  select * into d from app_private.reward_verified_deployments where campaign_id=c.id;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or jsonb_typeof(p_attempt) is distinct from 'object' or octet_length(p_attempt::text)>12000 then
    raise exception using errcode='22023',message='invalid_reward_funding_attempt'; end if;
  select * into a from app_private.reward_funding_attempts where intent_id=i.id and recorded_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    if a.attempt_body is distinct from p_attempt then raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
  else
    if (select count(*) from jsonb_object_keys(p_attempt))<>16 or not p_attempt ?& array['schemaVersion','action','chainId','operatorAddress','nonce',
      'contractAddress','transactionHash','signedTransaction','buildId','calldataHash','expectedAccountedFunding','expectedBudget','value','gasLimit','maxFeePerGas','maxPriorityFeePerGas']
      or p_attempt->'schemaVersion' is distinct from '1'::jsonb or p_attempt->>'action' is distinct from 'complete_funding'
      or p_attempt->'chainId' is distinct from to_jsonb(i.chain_id) or p_attempt->>'operatorAddress' is distinct from i.operator_address
      or p_attempt->>'contractAddress' is distinct from d.contract_address or p_attempt->>'buildId' is distinct from d.identity_body->>'buildId'
      or jsonb_typeof(p_attempt->'signedTransaction') is distinct from 'string' or length(p_attempt->>'signedTransaction') not between 6 and 2052
      or p_attempt->>'signedTransaction' !~ '^0x02([0-9a-f]{2})+$' then
      raise exception using errcode='22023',message='invalid_reward_funding_attempt'; end if;
    foreach field in array array['transactionHash','calldataHash'] loop
      if jsonb_typeof(p_attempt->field) is distinct from 'string' or p_attempt->>field !~ '^0x[0-9a-f]{64}$' or p_attempt->>field='0x'||repeat('0',64) then
        raise exception using errcode='22023',message='invalid_reward_funding_attempt'; end if;
    end loop;
    foreach field in array array['nonce','expectedAccountedFunding','expectedBudget','value','gasLimit','maxFeePerGas','maxPriorityFeePerGas'] loop
      if jsonb_typeof(p_attempt->field) is distinct from 'string' or p_attempt->>field !~ '^(0|[1-9][0-9]{0,77})$' then
        raise exception using errcode='22023',message='invalid_reward_funding_attempt'; end if;
      perform (p_attempt->>field)::app_private.reward_uint256;
    end loop;
    if p_attempt->>'nonce'<>i.nonce::text or p_attempt->>'expectedAccountedFunding'<>i.expected_accounted_funding::text
      or p_attempt->>'expectedBudget'<>i.expected_budget::text or (p_attempt->>'value')::numeric<>i.expected_budget-i.expected_accounted_funding
      or (p_attempt->>'gasLimit')::numeric=0 or (p_attempt->>'maxFeePerGas')::numeric=0
      or (p_attempt->>'maxPriorityFeePerGas')::numeric>(p_attempt->>'maxFeePerGas')::numeric then
      raise exception using errcode='22023',message='invalid_reward_funding_attempt'; end if;
    if exists(select 1 from app_private.reward_funding_attempts where transaction_hash=decode(substr(p_attempt->>'transactionHash',3),'hex')) then
      raise exception using errcode='22023',message='reward_funding_transaction_already_recorded'; end if;
    insert into app_private.reward_funding_attempts(intent_id,transaction_hash,attempt_body,recorded_by_user_id,idempotency_key)
      values(i.id,decode(substr(p_attempt->>'transactionHash',3),'hex'),p_attempt,p_actor_user_id,p_idempotency_key) returning * into a;
  end if;
  return jsonb_build_object('attemptId',a.id,'intentId',i.id,'campaignId',c.id,'recordedByUserId',a.recorded_by_user_id,
    'recordedAt',a.recorded_at,'transactionHash','0x'||encode(a.transaction_hash,'hex'));
end $$;

create function public.service_read_reward_funding_attempt(p_campaign_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare context jsonb; a app_private.reward_funding_attempts%rowtype;
begin
  context:=public.service_read_reward_funding_context(p_campaign_id,p_actor_user_id,p_intent_id);
  select * into a from app_private.reward_funding_attempts where id=p_attempt_id and intent_id=p_intent_id;
  if not found then raise exception using errcode='22023',message='reward_funding_attempt_mismatch'; end if;
  return jsonb_build_object('context',context,'attempt',jsonb_build_object('id',a.id,'intentId',a.intent_id,'body',a.attempt_body,
    'recordedByUserId',a.recorded_by_user_id,'recordedAt',a.recorded_at,'idempotencyKey',a.idempotency_key));
end $$;

revoke all on function app_private.record_reward_operator_nonce_slot(),public.service_read_reward_funding_context(uuid,uuid,uuid),
  public.service_reserve_reward_funding(uuid,uuid,text,uuid,integer,text),public.service_record_reward_funding_attempt(uuid,uuid,uuid,text,jsonb),
  public.service_read_reward_funding_attempt(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.record_reward_operator_nonce_slot(),public.service_read_reward_funding_context(uuid,uuid,uuid),
  public.service_reserve_reward_funding(uuid,uuid,text,uuid,integer,text),public.service_record_reward_funding_attempt(uuid,uuid,uuid,text,jsonb),
  public.service_read_reward_funding_attempt(uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.service_reserve_reward_deployment(uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.service_reserve_reward_deployment(uuid,uuid,text,integer,text) to service_role;
commit;
