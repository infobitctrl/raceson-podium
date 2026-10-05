begin;

create table app_private.reward_verified_deployments (
  campaign_id uuid primary key references app_private.reward_campaigns(id) on delete restrict,
  intent_id uuid not null unique references app_private.reward_deployment_intents(id) on delete restrict,
  attempt_id uuid not null unique references app_private.reward_deployment_attempts(id) on delete restrict,
  chain_id integer not null check(chain_id in (10143,31337)),
  contract_address app_private.reward_address not null,
  identity_body jsonb not null check(jsonb_typeof(identity_body)='object' and octet_length(identity_body::text)<=10000),
  verified_by_user_id uuid not null,
  verified_at timestamptz not null default clock_timestamp(),
  unique(chain_id,contract_address)
);
create table app_private.reward_campaign_observations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app_private.reward_verified_deployments(campaign_id) on delete restrict,
  finalized_block_number app_private.reward_uint256 not null,
  observation_body jsonb not null check(jsonb_typeof(observation_body)='object' and octet_length(observation_body::text)<=16000),
  observed_by_user_id uuid not null,
  observed_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  unique(campaign_id,observed_by_user_id,idempotency_key)
);
create index reward_campaign_observations_latest on app_private.reward_campaign_observations(campaign_id,finalized_block_number desc,observed_at desc,id desc);

do $$ declare name text; begin
  foreach name in array array['reward_verified_deployments','reward_campaign_observations'] loop
    execute format('alter table app_private.%I enable row level security',name);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',name);
    execute format('grant select,insert on app_private.%I to service_role',name);
    execute format('create policy %I on app_private.%I for select to service_role using(true)',name||'_service_select',name);
    execute format('create policy %I on app_private.%I for insert to service_role with check(true)',name||'_service_insert',name);
    execute format('create trigger reward_checkpoint_immutable before update or delete on app_private.%I for each row execute function app_private.reject_reward_ledger_mutation()',name);
  end loop;
end $$;

-- Structural/accounting defence in depth; not an RPC honesty or bytecode proof.
create function app_private.require_reward_campaign_accounting(a jsonb,pot integer)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare field text; item jsonb; state integer; budget numeric; allocated numeric; paid numeric; funding numeric; returned numeric; inactive integer;
begin
  if pot not in (0,1) or jsonb_typeof(a) is distinct from 'object' or (select count(*) from jsonb_object_keys(a))<>15
    or not a ?& array['state','paused','accountedFunding','treasuryReturned','budgets','allocated','paid','nativeBalance','entitlementCount',
      'uploadDigest','snapshotDigest','allocationDigest','activationNotBefore','claimDeadline','pausedAt']
    or jsonb_typeof(a->'state') is distinct from 'number' or a->>'state' !~ '^[0-5]$'
    or jsonb_typeof(a->'paused') is distinct from 'boolean' then
    raise exception using errcode='22023',message='invalid_reward_campaign_accounting'; end if;
  state:=(a->>'state')::integer; inactive:=1-pot;
  foreach field in array array['accountedFunding','treasuryReturned','nativeBalance','entitlementCount','activationNotBefore','claimDeadline','pausedAt'] loop
    if jsonb_typeof(a->field) is distinct from 'string' or a->>field !~ '^(0|[1-9][0-9]{0,77})$' then
      raise exception using errcode='22023',message='invalid_reward_campaign_accounting'; end if;
    perform (a->>field)::app_private.reward_uint256;
  end loop;
  foreach field in array array['budgets','allocated','paid'] loop
    if jsonb_typeof(a->field) is distinct from 'array' or jsonb_array_length(a->field)<>2 then
      raise exception using errcode='22023',message='invalid_reward_campaign_accounting'; end if;
    for item in select value from jsonb_array_elements(a->field) loop
      if jsonb_typeof(item) is distinct from 'string' or item#>>'{}' !~ '^(0|[1-9][0-9]{0,77})$' then
        raise exception using errcode='22023',message='invalid_reward_campaign_accounting'; end if;
      perform (item#>>'{}')::app_private.reward_uint256;
    end loop;
    if (a->field->>inactive)::numeric<>0 then raise exception using errcode='22023',message='invalid_reward_campaign_accounting'; end if;
  end loop;
  foreach field in array array['uploadDigest','snapshotDigest','allocationDigest'] loop
    if jsonb_typeof(a->field) is distinct from 'string' or a->>field !~ '^0x[0-9a-f]{64}$' then
      raise exception using errcode='22023',message='invalid_reward_campaign_accounting'; end if;
  end loop;
  budget:=(a->'budgets'->>pot)::numeric; allocated:=(a->'allocated'->>pot)::numeric; paid:=(a->'paid'->>pot)::numeric;
  funding:=(a->>'accountedFunding')::numeric; returned:=(a->>'treasuryReturned')::numeric;
  if paid>allocated or allocated>budget or budget>funding or paid+returned>funding
    or (a->>'nativeBalance')::numeric<funding-paid-returned
    or (budget<>0 and budget<>funding) or (state in (1,2,3,4) and (budget=0 or budget<>funding))
    or ((a->>'entitlementCount')::numeric=0)<>(allocated=0)
    or ((a->>'entitlementCount')::numeric=0)<>(a->>'uploadDigest'='0x'||repeat('0',64))
    or (state=0 and (budget<>0 or allocated<>0))
    or (state not in (3,4) and (paid<>0 or (a->>'claimDeadline')::numeric<>0))
    or (state in (3,4) and (a->>'claimDeadline')::numeric=0)
    or (state not in (4,5) and returned<>0)
    or ((a->>'paused')::boolean and (state<>3 or (a->>'pausedAt')::numeric=0))
    or (not (a->>'paused')::boolean and (a->>'pausedAt')::numeric<>0)
    or ((a->>'snapshotDigest'='0x'||repeat('0',64))<>(a->>'allocationDigest'='0x'||repeat('0',64)))
    or ((a->>'snapshotDigest'='0x'||repeat('0',64))<>((a->>'activationNotBefore')::numeric=0))
    or (state in (0,1) and (a->>'activationNotBefore')::numeric<>0)
    or (state in (2,3,4) and (a->>'activationNotBefore')::numeric=0) then
    raise exception using errcode='22023',message='invalid_reward_campaign_accounting'; end if;
end $$;

create function public.service_read_reward_campaign_checkpoint(p_campaign_id uuid,p_actor_user_id uuid,p_idempotency_key text default null)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare d app_private.reward_verified_deployments%rowtype; o app_private.reward_campaign_observations%rowtype;
begin
  perform public.service_read_reward_deployment_context(p_campaign_id,p_actor_user_id,null);
  select * into d from app_private.reward_verified_deployments where campaign_id=p_campaign_id;
  if not found then return null; end if;
  select * into o from app_private.reward_campaign_observations where campaign_id=p_campaign_id
    and (p_idempotency_key is null or (observed_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key))
    order by finalized_block_number desc,observed_at desc,id desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('campaignId',d.campaign_id,'intentId',d.intent_id,'attemptId',d.attempt_id,'deployment',d.identity_body,
    'observationId',o.id,'observation',o.observation_body,'observedByUserId',o.observed_by_user_id,'observedAt',o.observed_at,'idempotencyKey',o.idempotency_key);
end $$;

create function public.service_record_reward_campaign_checkpoint(p_campaign_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_attempt_id uuid,
  p_idempotency_key text,p_deployment jsonb,p_observation jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_campaigns%rowtype; i app_private.reward_deployment_intents%rowtype; a app_private.reward_deployment_attempts%rowtype;
  d app_private.reward_verified_deployments%rowtype; o app_private.reward_campaign_observations%rowtype;
  field text; block_number numeric; f jsonb; accounting jsonb; old_accounting jsonb; old_state integer; new_state integer;
begin
  select * into c from app_private.reward_campaigns where id=p_campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  perform id from app_private.reward_programmes where id=c.programme_id for update;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into i from app_private.reward_deployment_intents where id=p_intent_id and campaign_id=c.id;
  if not found then raise exception using errcode='22023',message='reward_deployment_intent_mismatch'; end if;
  select * into a from app_private.reward_deployment_attempts where id=p_attempt_id and intent_id=i.id;
  if not found then raise exception using errcode='22023',message='reward_deployment_attempt_mismatch'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or jsonb_typeof(p_deployment) is distinct from 'object' or octet_length(p_deployment::text)>10000
    or (select count(*) from jsonb_object_keys(p_deployment))<>10
    or not p_deployment ?& array['schemaVersion','chainId','contractAddress','buildId','creationCodeHash','runtimeCodeHash',
      'deploymentTransactionHash','deploymentNonce','deploymentBlockNumber','deploymentBlockHash']
    or p_deployment->'schemaVersion' is distinct from '1'::jsonb or p_deployment->'chainId' is distinct from to_jsonb(i.chain_id)
    or p_deployment->>'contractAddress' is distinct from a.attempt_body->>'contractAddress'
    or p_deployment->>'buildId' is distinct from i.build_id or p_deployment->>'creationCodeHash' is distinct from '0x'||encode(i.creation_code_hash,'hex')
    or p_deployment->>'deploymentTransactionHash' is distinct from '0x'||encode(a.transaction_hash,'hex')
    or jsonb_typeof(p_deployment->'deploymentNonce') is distinct from 'string' or p_deployment->>'deploymentNonce' is distinct from i.nonce::text
    or jsonb_typeof(p_deployment->'deploymentBlockNumber') is distinct from 'string'
    or p_deployment->>'deploymentBlockNumber' !~ '^(0|[1-9][0-9]{0,77})$'
    or jsonb_typeof(p_observation) is distinct from 'object' or octet_length(p_observation::text)>16000
    or (select count(*) from jsonb_object_keys(p_observation))<>3 or not p_observation ?& array['schemaVersion','finalizedBlock','accounting']
    or p_observation->'schemaVersion' is distinct from '1'::jsonb then
    raise exception using errcode='22023',message='invalid_reward_campaign_checkpoint'; end if;
  perform (p_deployment->>'deploymentBlockNumber')::app_private.reward_uint256;
  foreach field in array array['runtimeCodeHash','deploymentBlockHash'] loop
    if jsonb_typeof(p_deployment->field) is distinct from 'string' or p_deployment->>field !~ '^0x[0-9a-f]{64}$'
      or p_deployment->>field='0x'||repeat('0',64) then raise exception using errcode='22023',message='invalid_reward_campaign_checkpoint'; end if;
  end loop;
  f:=p_observation->'finalizedBlock'; accounting:=p_observation->'accounting';
  if jsonb_typeof(f) is distinct from 'object' or (select count(*) from jsonb_object_keys(f))<>3 or not f ?& array['number','hash','timestamp']
    or jsonb_typeof(f->'hash') is distinct from 'string' or f->>'hash' !~ '^0x[0-9a-f]{64}$' or f->>'hash'='0x'||repeat('0',64) then
    raise exception using errcode='22023',message='invalid_reward_campaign_checkpoint'; end if;
  foreach field in array array['number','timestamp'] loop
    if jsonb_typeof(f->field) is distinct from 'string' or f->>field !~ '^(0|[1-9][0-9]{0,77})$' then
      raise exception using errcode='22023',message='invalid_reward_campaign_checkpoint'; end if;
    perform (f->>field)::app_private.reward_uint256;
  end loop;
  block_number:=(f->>'number')::numeric;
  if block_number<(p_deployment->>'deploymentBlockNumber')::numeric
    or (block_number=(p_deployment->>'deploymentBlockNumber')::numeric and f->>'hash'<>p_deployment->>'deploymentBlockHash') then
    raise exception using errcode='22023',message='invalid_reward_campaign_checkpoint'; end if;
  perform app_private.require_reward_campaign_accounting(accounting,case c.pot when 'race' then 0 else 1 end);
  if (accounting->>'pausedAt')::numeric>(f->>'timestamp')::numeric then
    raise exception using errcode='22023',message='invalid_reward_campaign_checkpoint'; end if;

  select * into d from app_private.reward_verified_deployments where campaign_id=c.id;
  if found then
    if d.intent_id<>i.id or d.attempt_id<>a.id or d.identity_body is distinct from p_deployment then
      raise exception using errcode='22023',message='reward_verified_deployment_conflict'; end if;
  else
    insert into app_private.reward_verified_deployments(campaign_id,intent_id,attempt_id,chain_id,contract_address,identity_body,verified_by_user_id)
      values(c.id,i.id,a.id,i.chain_id,p_deployment->>'contractAddress',p_deployment,p_actor_user_id);
  end if;
  select * into o from app_private.reward_campaign_observations where campaign_id=c.id and observed_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    if o.observation_body is distinct from p_observation then raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
    return public.service_read_reward_campaign_checkpoint(c.id,p_actor_user_id,p_idempotency_key);
  end if;
  select * into o from app_private.reward_campaign_observations where campaign_id=c.id
    order by finalized_block_number desc,observed_at desc,id desc limit 1;
  if found then
    if block_number<o.finalized_block_number then raise exception using errcode='22023',message='reward_campaign_checkpoint_regressed'; end if;
    if (block_number=o.finalized_block_number and o.observation_body is distinct from p_observation)
      or (f->>'timestamp')::numeric<(o.observation_body->'finalizedBlock'->>'timestamp')::numeric then
      raise exception using errcode='22023',message='reward_campaign_checkpoint_conflict'; end if;
    old_accounting:=o.observation_body->'accounting'; old_state:=(old_accounting->>'state')::integer; new_state:=(accounting->>'state')::integer;
    if new_state<old_state or (old_state>=3 and new_state=5 and old_state<>5)
      or (old_state in (4,5) and new_state<>old_state) then
      raise exception using errcode='22023',message='reward_campaign_checkpoint_regressed'; end if;
    foreach field in array array['accountedFunding','treasuryReturned','entitlementCount','claimDeadline'] loop
      if (accounting->>field)::numeric<(old_accounting->>field)::numeric then
        raise exception using errcode='22023',message='reward_campaign_checkpoint_regressed'; end if;
    end loop;
    foreach field in array array['budgets','allocated','paid'] loop
      if (accounting->field->>0)::numeric<(old_accounting->field->>0)::numeric or (accounting->field->>1)::numeric<(old_accounting->field->>1)::numeric then
        raise exception using errcode='22023',message='reward_campaign_checkpoint_regressed'; end if;
    end loop;
  end if;
  insert into app_private.reward_campaign_observations(campaign_id,finalized_block_number,observation_body,observed_by_user_id,idempotency_key)
    values(c.id,block_number,p_observation,p_actor_user_id,p_idempotency_key);
  return public.service_read_reward_campaign_checkpoint(c.id,p_actor_user_id,p_idempotency_key);
end $$;

revoke all on function app_private.require_reward_campaign_accounting(jsonb,integer),public.service_read_reward_campaign_checkpoint(uuid,uuid,text),
  public.service_record_reward_campaign_checkpoint(uuid,uuid,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.require_reward_campaign_accounting(jsonb,integer),public.service_read_reward_campaign_checkpoint(uuid,uuid,text),
  public.service_record_reward_campaign_checkpoint(uuid,uuid,uuid,uuid,text,jsonb,jsonb) to service_role;
commit;
