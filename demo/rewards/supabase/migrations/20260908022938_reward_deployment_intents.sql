begin;

-- Reservations are not broadcasts/deployments. Never reuse an old nonce simply
-- because a worker stopped: a signed attempt may already be in the network.
create table app_private.reward_deployment_intents (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references app_private.reward_campaigns(id) on delete restrict,
  chain_id integer not null check (chain_id in (10143,31337)),
  operator_address app_private.reward_address not null,
  nonce app_private.reward_uint256 not null check (nonce <= 9007199254740991),
  build_id text not null check (build_id = 'raceson-reward-campaign-v2-solc-0.8.36-cancun-ir-200'),
  creation_code_hash app_private.reward_bytes32 not null check
    (creation_code_hash = decode('8195f9fe8d307325596d3610f12e8627c42748cc55d0755c0da9b4e47d0314b3','hex')),
  created_by_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  unique (chain_id,operator_address,nonce)
);

-- Signed bytes are server-only broadcast capabilities, NOT private keys. Exact
-- calldata/sender/signature validation is the trusted TypeScript service boundary;
-- SQL independently checks scope, fixed build, nonce and structural fields.
create table app_private.reward_deployment_attempts (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references app_private.reward_deployment_intents(id) on delete restrict,
  transaction_hash app_private.reward_bytes32 not null unique,
  attempt_body jsonb not null check (jsonb_typeof(attempt_body) = 'object' and octet_length(attempt_body::text) <= 140000),
  recorded_by_user_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  unique (intent_id,recorded_by_user_id,idempotency_key)
);

do $$ declare name text; begin
  foreach name in array array['reward_deployment_intents','reward_deployment_attempts'] loop
    execute format('alter table app_private.%I enable row level security',name);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',name);
    execute format('grant select,insert on app_private.%I to service_role',name);
    execute format('create policy %I on app_private.%I for select to service_role using(true)',name||'_service_select',name);
    execute format('create policy %I on app_private.%I for insert to service_role with check(true)',name||'_service_insert',name);
    execute format('create trigger reward_deployment_immutable before update or delete on app_private.%I for each row execute function app_private.reject_reward_ledger_mutation()',name);
  end loop;
end $$;

create function public.service_read_reward_deployment_context(p_campaign_id uuid,p_actor_user_id uuid,p_intent_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_campaigns%rowtype; p app_private.reward_programmes%rowtype; i app_private.reward_deployment_intents%rowtype;
begin
  select * into c from app_private.reward_campaigns where id=p_campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into p from app_private.reward_programmes where id=c.programme_id;
  select * into i from app_private.reward_deployment_intents where campaign_id=c.id;
  if p_intent_id is not null and (i.id is null or i.id<>p_intent_id) then
    raise exception using errcode='22023',message='reward_deployment_intent_mismatch';
  end if;
  return jsonb_build_object('schemaVersion',1,'programmeId',p.id,'campaignId',c.id,'environment',p.environment,'chainId',p.chain_id,
    'operatorAddress',p.operator_address,'treasuryAddress',p.treasury_address,'programmeOnChainId','0x'||encode(p.on_chain_id,'hex'),
    'campaignOnChainId','0x'||encode(c.on_chain_id,'hex'),'manifestHash','0x'||encode(p.manifest_hash,'hex'),'pot',c.pot,'budgetWei',c.budget_wei::text,
    'intent',case when i.id is null then null else jsonb_build_object('id',i.id,'nonce',i.nonce::text,'buildId',i.build_id,
      'creationCodeHash','0x'||encode(i.creation_code_hash,'hex'),'createdByUserId',i.created_by_user_id,'createdAt',i.created_at,'idempotencyKey',i.idempotency_key) end);
end $$;

create function public.service_reserve_reward_deployment(p_campaign_id uuid,p_actor_user_id uuid,p_idempotency_key text,
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
    raise exception using errcode='22023',message='invalid_reward_deployment_request';
  end if;
  -- One global signer/chain order, then programme lock. Parallel campaigns and
  -- programmes cannot reserve the same nonce. No RPC is performed inside SQL.
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||p.chain_id::text||':'||p.operator_address,0));
  perform id from app_private.reward_programmes where id=p.id for update;
  perform app_private.require_reward_operator(p.id,p_actor_user_id);
  select * into i from app_private.reward_deployment_intents where campaign_id=c.id;
  if found then
    if i.created_by_user_id<>p_actor_user_id or i.idempotency_key<>p_idempotency_key then
      raise exception using errcode='22023',message='reward_deployment_already_planned';
    end if;
  else
    select greatest(p_pending_nonce::numeric,coalesce(max(nonce)+1,0)) into next_nonce
      from app_private.reward_deployment_intents where chain_id=p.chain_id and operator_address=p.operator_address;
    if next_nonce>9007199254740991 then raise exception using errcode='22023',message='reward_deployment_nonce_exhausted'; end if;
    insert into app_private.reward_deployment_intents(campaign_id,chain_id,operator_address,nonce,build_id,creation_code_hash,created_by_user_id,idempotency_key)
      values(c.id,p.chain_id,p.operator_address,next_nonce,'raceson-reward-campaign-v2-solc-0.8.36-cancun-ir-200',
        decode('8195f9fe8d307325596d3610f12e8627c42748cc55d0755c0da9b4e47d0314b3','hex'),p_actor_user_id,p_idempotency_key) returning * into i;
  end if;
  return public.service_read_reward_deployment_context(c.id,p_actor_user_id,i.id);
end $$;

create function public.service_record_reward_deployment_attempt(p_campaign_id uuid,p_actor_user_id uuid,p_intent_id uuid,
  p_idempotency_key text,p_attempt jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_campaigns%rowtype; i app_private.reward_deployment_intents%rowtype; a app_private.reward_deployment_attempts%rowtype; field text;
begin
  select * into c from app_private.reward_campaigns where id=p_campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  perform id from app_private.reward_programmes where id=c.programme_id for update;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into i from app_private.reward_deployment_intents where id=p_intent_id and campaign_id=c.id;
  if not found then raise exception using errcode='22023',message='reward_deployment_intent_mismatch'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or jsonb_typeof(p_attempt) is distinct from 'object' or octet_length(p_attempt::text)>140000 then
    raise exception using errcode='22023',message='invalid_reward_deployment_attempt';
  end if;
  select * into a from app_private.reward_deployment_attempts where intent_id=i.id and recorded_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    if a.attempt_body is distinct from p_attempt then raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
  else
    if (select count(*) from jsonb_object_keys(p_attempt))<>12 or not p_attempt ?& array['schemaVersion','chainId','operatorAddress','nonce',
      'contractAddress','transactionHash','signedTransaction','creationCodeHash','calldataHash','gasLimit','maxFeePerGas','maxPriorityFeePerGas']
      or p_attempt->'schemaVersion' is distinct from '1'::jsonb or p_attempt->'chainId' is distinct from to_jsonb(i.chain_id)
      or jsonb_typeof(p_attempt->'nonce') is distinct from 'string'
      or p_attempt->>'operatorAddress' is distinct from i.operator_address or p_attempt->>'nonce' is distinct from i.nonce::text
      or p_attempt->>'creationCodeHash' is distinct from '0x'||encode(i.creation_code_hash,'hex')
      or jsonb_typeof(p_attempt->'signedTransaction') is distinct from 'string' or length(p_attempt->>'signedTransaction') not between 6 and 131074
      or p_attempt->>'signedTransaction' !~ '^0x02([0-9a-f]{2})+$'
      or jsonb_typeof(p_attempt->'contractAddress') is distinct from 'string' or p_attempt->>'contractAddress' !~ '^0x[0-9a-f]{40}$'
      or p_attempt->>'contractAddress'='0x0000000000000000000000000000000000000000' then
      raise exception using errcode='22023',message='invalid_reward_deployment_attempt';
    end if;
    foreach field in array array['transactionHash','calldataHash'] loop
      if jsonb_typeof(p_attempt->field) is distinct from 'string' or p_attempt->>field !~ '^0x[0-9a-f]{64}$' or p_attempt->>field='0x'||repeat('0',64) then
        raise exception using errcode='22023',message='invalid_reward_deployment_attempt'; end if;
    end loop;
    foreach field in array array['gasLimit','maxFeePerGas','maxPriorityFeePerGas'] loop
      if jsonb_typeof(p_attempt->field) is distinct from 'string' or p_attempt->>field !~ '^(0|[1-9][0-9]{0,77})$' then
        raise exception using errcode='22023',message='invalid_reward_deployment_attempt'; end if;
      perform (p_attempt->>field)::app_private.reward_uint256;
    end loop;
    if (p_attempt->>'gasLimit')::numeric=0 or (p_attempt->>'maxFeePerGas')::numeric=0
      or (p_attempt->>'maxPriorityFeePerGas')::numeric>(p_attempt->>'maxFeePerGas')::numeric then
      raise exception using errcode='22023',message='invalid_reward_deployment_attempt'; end if;
    if exists(select 1 from app_private.reward_deployment_attempts where transaction_hash=decode(substr(p_attempt->>'transactionHash',3),'hex')) then
      raise exception using errcode='22023',message='reward_deployment_transaction_already_recorded'; end if;
    insert into app_private.reward_deployment_attempts(intent_id,transaction_hash,attempt_body,recorded_by_user_id,idempotency_key)
      values(i.id,decode(substr(p_attempt->>'transactionHash',3),'hex'),p_attempt,p_actor_user_id,p_idempotency_key) returning * into a;
  end if;
  return jsonb_build_object('attemptId',a.id,'intentId',i.id,'campaignId',c.id,'recordedByUserId',a.recorded_by_user_id,
    'recordedAt',a.recorded_at,'transactionHash','0x'||encode(a.transaction_hash,'hex'));
end $$;

create function public.service_read_reward_deployment_attempt(p_campaign_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare context jsonb; a app_private.reward_deployment_attempts%rowtype;
begin
  context:=public.service_read_reward_deployment_context(p_campaign_id,p_actor_user_id,p_intent_id);
  select * into a from app_private.reward_deployment_attempts where id=p_attempt_id and intent_id=p_intent_id;
  if not found then raise exception using errcode='22023',message='reward_deployment_attempt_mismatch'; end if;
  return jsonb_build_object('context',context,'attempt',jsonb_build_object('id',a.id,'intentId',a.intent_id,'body',a.attempt_body,
    'recordedByUserId',a.recorded_by_user_id,'recordedAt',a.recorded_at,'idempotencyKey',a.idempotency_key));
end $$;

revoke all on function public.service_read_reward_deployment_context(uuid,uuid,uuid),public.service_reserve_reward_deployment(uuid,uuid,text,integer,text),
  public.service_record_reward_deployment_attempt(uuid,uuid,uuid,text,jsonb),public.service_read_reward_deployment_attempt(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_read_reward_deployment_context(uuid,uuid,uuid),public.service_reserve_reward_deployment(uuid,uuid,text,integer,text),
  public.service_record_reward_deployment_attempt(uuid,uuid,uuid,text,jsonb),public.service_read_reward_deployment_attempt(uuid,uuid,uuid,uuid) to service_role;

commit;
