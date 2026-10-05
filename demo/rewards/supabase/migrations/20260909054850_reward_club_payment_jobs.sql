begin;
alter table app_private.reward_club_claim_intents add constraint reward_club_payment_job_claim_scope unique(id,campaign_id,upload_id,entitlement_id);
alter table app_private.reward_club_payment_intents add constraint reward_club_payment_job_intent_scope unique(id,claim_intent_id);
alter table app_private.reward_club_payment_attempts add constraint reward_club_payment_job_attempt_scope unique(id,payment_intent_id,transaction_hash);
create table app_private.reward_club_payment_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,upload_id uuid not null,entitlement_id uuid not null,
  claim_intent_id uuid not null,payment_intent_id uuid not null unique,attempt_id uuid not null unique,
  transaction_hash app_private.reward_bytes32 not null unique,activation_job_id uuid not null,
  created_by_user_id uuid not null,created_session_id uuid not null,created_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  state text not null default 'queued' check(state in ('queued','leased','broadcasting','submitted','confirmed')),
  may_have_broadcast boolean not null default false,
  lease_owner uuid,lease_token uuid,lease_expires_at timestamptz,
  lease_generation integer not null default 0 check(lease_generation>=0),
  confirmation_observation_id uuid references app_private.reward_campaign_observations(id) on delete restrict,
  check((lease_owner is null)=(lease_token is null) and (lease_owner is null)=(lease_expires_at is null)),
  check((state='confirmed')=(confirmation_observation_id is not null)),
  check(state<>'confirmed' or (lease_owner is null and may_have_broadcast)),
  check(state<>'queued' or (lease_owner is null and lease_generation=0 and not may_have_broadcast)),
  check(state not in ('leased','broadcasting','submitted') or (lease_owner is not null and lease_generation>0)),
  check(state not in ('broadcasting','submitted') or may_have_broadcast),
  unique(id,entitlement_id),unique(campaign_id,created_by_user_id,idempotency_key),
  foreign key(claim_intent_id,campaign_id,upload_id,entitlement_id) references app_private.reward_club_claim_intents(id,campaign_id,upload_id,entitlement_id) on delete restrict,
  foreign key(payment_intent_id,claim_intent_id) references app_private.reward_club_payment_intents(id,claim_intent_id) on delete restrict,
  foreign key(attempt_id,payment_intent_id,transaction_hash) references app_private.reward_club_payment_attempts(id,payment_intent_id,transaction_hash) on delete restrict,
  foreign key(activation_job_id,campaign_id,upload_id) references app_private.reward_lifecycle_jobs(id,campaign_id,upload_id) on delete restrict
);
create index reward_club_payment_job_activation on app_private.reward_club_payment_jobs(activation_job_id);
create index reward_club_payment_job_claim on app_private.reward_club_payment_jobs(claim_intent_id);
create index reward_club_payment_job_entitlement on app_private.reward_club_payment_jobs(entitlement_id);
create index reward_club_payment_job_confirmation on app_private.reward_club_payment_jobs(confirmation_observation_id) where confirmation_observation_id is not null;
create table app_private.reward_club_payment_job_events (
  id uuid primary key default gen_random_uuid(),job_id uuid not null references app_private.reward_club_payment_jobs(id) on delete restrict,
  kind text not null check(kind in ('queued','leased','armed','submitted','confirmed')),
  actor_user_id uuid not null,actor_session_id uuid not null,worker_id uuid,
  lease_generation integer not null check(lease_generation>=0),recorded_at timestamptz not null default clock_timestamp(),
  execution_witness jsonb check(execution_witness is null or (jsonb_typeof(execution_witness)='object' and octet_length(execution_witness::text)<40000)),
  check((kind='armed')=(execution_witness is not null))
);
create index reward_club_payment_job_event_lookup on app_private.reward_club_payment_job_events(job_id,recorded_at,id);
create table app_private.reward_club_payment_confirmations (
  id uuid primary key default gen_random_uuid(),job_id uuid not null unique,entitlement_id uuid not null unique,
  observation_id uuid not null unique references app_private.reward_campaign_observations(id) on delete restrict,
  payment_body jsonb not null check(jsonb_typeof(payment_body)='object' and octet_length(payment_body::text)<12000),
  confirmed_by_user_id uuid not null,confirmed_session_id uuid not null,confirmed_at timestamptz not null default clock_timestamp(),
  foreign key(job_id,entitlement_id) references app_private.reward_club_payment_jobs(id,entitlement_id) on delete restrict
);
do $$ declare name text; begin
  foreach name in array array['reward_club_payment_jobs','reward_club_payment_job_events','reward_club_payment_confirmations'] loop
    execute format('alter table app_private.%I enable row level security',name);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',name);
    execute format('grant select,insert on app_private.%I to service_role',name);
    execute format('create policy %I on app_private.%I for select to service_role using(true)',name||'_select',name);
    execute format('create policy %I on app_private.%I for insert to service_role with check(true)',name||'_insert',name);
  end loop;
end $$;
grant update(state,may_have_broadcast,lease_owner,lease_token,lease_expires_at,lease_generation,confirmation_observation_id) on app_private.reward_club_payment_jobs to service_role;
create policy reward_payment_jobs_update on app_private.reward_club_payment_jobs for update to service_role using(true) with check(true);
create trigger reward_payment_events_immutable before update or delete on app_private.reward_club_payment_job_events for each row execute function app_private.reject_reward_ledger_mutation();
create trigger reward_payment_confirmation_immutable before update or delete on app_private.reward_club_payment_confirmations for each row execute function app_private.reject_reward_ledger_mutation();
create function app_private.protect_reward_club_payment_job() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception using errcode='22023',message='reward_job_identity_is_immutable'; end if;
  if (to_jsonb(new)-array['state','may_have_broadcast','lease_owner','lease_token','lease_expires_at','lease_generation','confirmation_observation_id'])
    is distinct from (to_jsonb(old)-array['state','may_have_broadcast','lease_owner','lease_token','lease_expires_at','lease_generation','confirmation_observation_id'])
    or (old.may_have_broadcast and not new.may_have_broadcast) or new.lease_generation<old.lease_generation
    or (old.state='confirmed' and new is distinct from old) then raise exception using errcode='22023',message='reward_job_identity_is_immutable'; end if;
  if new.state='confirmed' and not exists(select 1 from app_private.reward_club_payment_confirmations where job_id=new.id and entitlement_id=new.entitlement_id and observation_id=new.confirmation_observation_id) then
    raise exception using errcode='22023',message='reward_payment_not_verified'; end if;
  return new;
end $$;
create trigger reward_payment_job_identity before update or delete on app_private.reward_club_payment_jobs for each row execute function app_private.protect_reward_club_payment_job();
create function app_private.reward_club_payment_job_document(j app_private.reward_club_payment_jobs)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('jobId',j.id,'campaignId',j.campaign_id,'uploadId',j.upload_id,'entitlementId',j.entitlement_id,
    'claimIntentId',j.claim_intent_id,'paymentIntentId',j.payment_intent_id,'attemptId',j.attempt_id,'transactionHash','0x'||encode(j.transaction_hash,'hex'),
    'activationJobId',j.activation_job_id,'createdByUserId',j.created_by_user_id,'createdSessionId',j.created_session_id,'createdAt',j.created_at,
    'idempotencyKey',j.idempotency_key,'state',j.state,'mayHaveBroadcast',j.may_have_broadcast,'leaseOwner',j.lease_owner,'leaseToken',j.lease_token,
    'leaseExpiresAt',j.lease_expires_at,'leaseGeneration',j.lease_generation,'confirmationObservationId',j.confirmation_observation_id);
$$;
create function app_private.reward_club_payment_activation(p_claim uuid)
returns uuid language plpgsql stable security invoker set search_path='' as $$
declare activation uuid;
begin
  select j.id into activation from app_private.reward_club_claim_intents c
    join app_private.reward_lifecycle_jobs j on j.campaign_id=c.campaign_id and j.upload_id=c.upload_id and j.state='confirmed'
    join app_private.reward_lifecycle_intents i on i.id=j.intent_id and i.action='activate'
    join app_private.reward_lifecycle_confirmations f on f.job_id=j.id and f.observation_id=j.confirmation_observation_id
    where c.id=p_claim and (f.lifecycle_body->>'blockNumber')::numeric<=(c.chain_witness#>>'{observation,finalizedBlock,number}')::numeric;
  if activation is null then raise exception using errcode='42501',message='reward_payment_activation_required'; end if;
  return activation;
end $$;
-- Lock chain/relayer before programme/profile and job. Re-read the actual
-- operator session after every possible lock wait, including the job row.
create function app_private.lock_reward_club_payment_job(p_job uuid,p_actor uuid,p_session uuid)
returns app_private.reward_club_payment_jobs language plpgsql volatile security invoker set search_path='' as $$
declare j app_private.reward_club_payment_jobs%rowtype;i app_private.reward_club_payment_intents%rowtype;
begin
  select * into j from app_private.reward_club_payment_jobs where id=p_job;
  if not found then raise exception using errcode='42501',message='reward_payment_job_required'; end if;
  perform public.service_read_reward_club_payment_context(p_actor,p_session,j.claim_intent_id);
  select * into i from app_private.reward_club_payment_intents where id=j.payment_intent_id;
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||i.chain_id::text||':'||i.relayer_address,0));
  perform app_private.lock_reward_club_payment_context(p_actor,p_session,j.claim_intent_id);
  select * into j from app_private.reward_club_payment_jobs where id=p_job for update;
  perform public.service_read_reward_club_payment_context(p_actor,p_session,j.claim_intent_id);
  return j;
end $$;
create function public.service_read_reward_club_payment_job(p_actor_user_id uuid,p_actor_session_id uuid,p_job_id uuid default null,p_payment_intent_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare j app_private.reward_club_payment_jobs%rowtype;claim uuid;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if num_nonnulls(p_job_id,p_payment_intent_id)<>1 then raise exception using errcode='22023',message='invalid_reward_payment_job'; end if;
  if p_payment_intent_id is not null then
    select claim_intent_id into claim from app_private.reward_club_payment_intents where id=p_payment_intent_id;
    perform public.service_read_reward_club_payment_context(p_actor_user_id,p_actor_session_id,claim);
  end if;
  select * into j from app_private.reward_club_payment_jobs where id=p_job_id or payment_intent_id=p_payment_intent_id;
  if not found then
    if p_payment_intent_id is not null then
      perform public.service_read_reward_club_payment_context(p_actor_user_id,p_actor_session_id,claim);
      return null; end if;
    raise exception using errcode='42501',message='reward_payment_job_required'; end if;
  perform public.service_read_reward_club_payment_context(p_actor_user_id,p_actor_session_id,j.claim_intent_id);
  perform public.service_read_reward_club_payment_context(p_actor_user_id,p_actor_session_id,j.claim_intent_id);
  return app_private.reward_club_payment_job_document(j);
end $$;
create function public.service_queue_reward_club_payment_job(p_actor_user_id uuid,p_actor_session_id uuid,p_claim_intent_id uuid,
  p_payment_intent_id uuid,p_attempt_id uuid,p_idempotency_key text,p_witness jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c jsonb;i app_private.reward_club_payment_intents%rowtype;a app_private.reward_club_payment_attempts%rowtype;j app_private.reward_club_payment_jobs%rowtype;prior jsonb;observed_block jsonb;
begin
  c:=app_private.lock_reward_club_payment_context(p_actor_user_id,p_actor_session_id,p_claim_intent_id);
  select * into i from app_private.reward_club_payment_intents where id=p_payment_intent_id and claim_intent_id=p_claim_intent_id;
  select * into a from app_private.reward_club_payment_attempts where id=p_attempt_id and payment_intent_id=i.id;
  if i.id is null or a.id is null then raise exception using errcode='42501',message='reward_payment_attempt_required'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception using errcode='22023',message='invalid_reward_payment_job'; end if;
  select * into j from app_private.reward_club_payment_jobs where payment_intent_id=i.id
    or (campaign_id=(c#>>'{claimContext,intent,campaignId}')::uuid and created_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key);
  if found then
    if j.payment_intent_id<>i.id or j.attempt_id<>a.id or j.created_by_user_id<>p_actor_user_id or j.idempotency_key<>p_idempotency_key then
      raise exception using errcode='22023',message='reward_payment_job_already_queued'; end if;
  else
    perform app_private.require_reward_club_payment_ready(c,p_witness,p_observed_at);
    prior:=i.chain_witness#>'{observation,finalizedBlock}';observed_block:=p_witness#>'{observation,finalizedBlock}';
    if (observed_block->>'number')::numeric<(prior->>'number')::numeric or (observed_block->>'timestamp')::numeric<(prior->>'timestamp')::numeric
      or ((observed_block->>'number')::numeric=(prior->>'number')::numeric and observed_block is distinct from prior) then
      raise exception using errcode='22023',message='reward_claim_observation_regressed'; end if;
    insert into app_private.reward_club_payment_jobs(campaign_id,upload_id,entitlement_id,claim_intent_id,payment_intent_id,attempt_id,transaction_hash,
      activation_job_id,created_by_user_id,created_session_id,idempotency_key)
      values((c#>>'{claimContext,intent,campaignId}')::uuid,(c#>>'{claimContext,intent,uploadId}')::uuid,(c#>>'{claimContext,entitlement,id}')::uuid,p_claim_intent_id,i.id,a.id,a.transaction_hash,
        app_private.reward_club_payment_activation(p_claim_intent_id),p_actor_user_id,p_actor_session_id,p_idempotency_key) returning * into j;
    insert into app_private.reward_club_payment_job_events(job_id,kind,actor_user_id,actor_session_id,lease_generation) values(j.id,'queued',p_actor_user_id,p_actor_session_id,0);
  end if;
  perform public.service_read_reward_club_payment_context(p_actor_user_id,p_actor_session_id,j.claim_intent_id);
  return app_private.reward_club_payment_job_document(j);
end $$;
-- An arm witness is private trusted-worker evidence, not an RPC oracle. Gas
-- policy caps and minimum remaining gas balance are explicit operator config.
create function app_private.require_reward_club_payment_execution(j app_private.reward_club_payment_jobs,c jsonb,x jsonb,observed_at timestamptz)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare a jsonb;i app_private.reward_club_payment_intents%rowtype;policy jsonb;field text;cost numeric;prior jsonb;block jsonb;
begin
  select * into i from app_private.reward_club_payment_intents where id=j.payment_intent_id;
  select attempt_body into a from app_private.reward_club_payment_attempts where id=j.attempt_id;
  if jsonb_typeof(x) is distinct from 'object' or octet_length(x::text)>=40000 or (select count(*) from jsonb_object_keys(x))<>7
    or not x ?& array['schemaVersion','claimWitness','latestNonce','pendingNonce','relayerBalanceWei','estimatedGas','gasPolicy']
    or x->'schemaVersion' is distinct from '1'::jsonb then raise exception using errcode='22023',message='invalid_reward_payment_execution'; end if;
  policy:=x->'gasPolicy';
  if jsonb_typeof(policy) is distinct from 'object' or (select count(*) from jsonb_object_keys(policy))<>4
    or not policy ?& array['maxGasLimit','maxFeePerGas','maxTotalFeeWei','minimumRemainingBalanceWei'] then
    raise exception using errcode='22023',message='invalid_reward_payment_execution'; end if;
  foreach field in array array['latestNonce','pendingNonce','relayerBalanceWei','estimatedGas','maxGasLimit','maxFeePerGas','maxTotalFeeWei','minimumRemainingBalanceWei'] loop
    if field in ('maxGasLimit','maxFeePerGas','maxTotalFeeWei','minimumRemainingBalanceWei') then
      if jsonb_typeof(policy->field) is distinct from 'string' or policy->>field !~ '^(0|[1-9][0-9]{0,77})$' then raise exception using errcode='22023',message='invalid_reward_payment_execution'; end if;
      perform (policy->>field)::app_private.reward_uint256;
    else
      if jsonb_typeof(x->field) is distinct from 'string' or x->>field !~ '^(0|[1-9][0-9]{0,77})$' then raise exception using errcode='22023',message='invalid_reward_payment_execution'; end if;
      perform (x->>field)::app_private.reward_uint256;
    end if;
  end loop;
  cost:=(a->>'gasLimit')::numeric*(a->>'maxFeePerGas')::numeric;
  if x->>'latestNonce' is distinct from i.nonce::text or x->>'pendingNonce' is distinct from i.nonce::text then
    raise exception using errcode='22023',message='reward_payment_nonce_conflict'; end if;
  if (x->>'estimatedGas')::numeric=0 or (x->>'estimatedGas')::numeric>(a->>'gasLimit')::numeric
    or (a->>'gasLimit')::numeric>(policy->>'maxGasLimit')::numeric or (a->>'maxFeePerGas')::numeric>(policy->>'maxFeePerGas')::numeric
    or cost>(policy->>'maxTotalFeeWei')::numeric or (x->>'relayerBalanceWei')::numeric<cost+(policy->>'minimumRemainingBalanceWei')::numeric then
    raise exception using errcode='22023',message='reward_payment_gas_guard'; end if;
  perform app_private.require_reward_club_payment_ready(c,x->'claimWitness',observed_at);
  prior:=i.chain_witness#>'{observation,finalizedBlock}';block:=x#>'{claimWitness,observation,finalizedBlock}';
  if (block->>'number')::numeric<(prior->>'number')::numeric or (block->>'timestamp')::numeric<(prior->>'timestamp')::numeric
    or ((block->>'number')::numeric=(prior->>'number')::numeric and block is distinct from prior) then
    raise exception using errcode='22023',message='reward_claim_observation_regressed'; end if;
end $$;
create function public.service_step_reward_club_payment_job(p_actor_user_id uuid,p_actor_session_id uuid,p_job_id uuid,p_worker_id uuid,p_lease_token uuid,
  p_action text,p_execution jsonb default null,p_observed_at timestamptz default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare j app_private.reward_club_payment_jobs%rowtype;i app_private.reward_club_payment_intents%rowtype;c jsonb;kind text;
begin
  if p_worker_id is null or p_action is null or p_action not in ('lease','arm','submitted') or (p_action='lease' and p_lease_token is not null)
    or (p_action<>'arm' and (p_execution is not null or p_observed_at is not null)) then raise exception using errcode='22023',message='invalid_reward_payment_job'; end if;
  j:=app_private.lock_reward_club_payment_job(p_job_id,p_actor_user_id,p_actor_session_id);
  if j.state='confirmed' then perform public.service_read_reward_club_payment_context(p_actor_user_id,p_actor_session_id,j.claim_intent_id);
  return app_private.reward_club_payment_job_document(j); end if;
  select * into i from app_private.reward_club_payment_intents where id=j.payment_intent_id;
  if p_action='lease' then
    if j.lease_expires_at>clock_timestamp() then
      if j.lease_owner=p_worker_id then perform public.service_read_reward_club_payment_context(p_actor_user_id,p_actor_session_id,j.claim_intent_id);
  return app_private.reward_club_payment_job_document(j); else return null; end if;
    end if;
    if app_private.reward_relayer_lane_busy(i.chain_id,i.relayer_address,'club',j.id) then return null; end if;
    update app_private.reward_club_payment_jobs set state='leased',lease_owner=p_worker_id,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '60 seconds',
      lease_generation=lease_generation+1 where id=j.id returning * into j;kind:='leased';
  else
    if p_lease_token is null or j.lease_token is distinct from p_lease_token or j.lease_owner is distinct from p_worker_id
      or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception using errcode='22023',message='reward_payment_job_lease_lost'; end if;
    if p_action='arm' then
      if app_private.reward_club_payment_activation(j.claim_intent_id)<>j.activation_job_id then raise exception using errcode='22023',message='reward_payment_activation_required'; end if;
      c:=public.service_read_reward_club_claim_proofs(p_actor_user_id,p_actor_session_id,j.claim_intent_id,'operator');
      perform app_private.require_reward_club_payment_execution(j,c,p_execution,p_observed_at);
    end if;
    update app_private.reward_club_payment_jobs set state=case p_action when 'arm' then 'broadcasting' else 'submitted' end,may_have_broadcast=true where id=j.id returning * into j;
    kind:=case p_action when 'arm' then 'armed' else 'submitted' end;
  end if;
  insert into app_private.reward_club_payment_job_events(job_id,kind,actor_user_id,actor_session_id,worker_id,lease_generation,execution_witness)
    values(j.id,kind,p_actor_user_id,p_actor_session_id,p_worker_id,j.lease_generation,p_execution);
  perform public.service_read_reward_club_payment_context(p_actor_user_id,p_actor_session_id,j.claim_intent_id);
  return app_private.reward_club_payment_job_document(j);
end $$;
-- Exact history is reconciled even after destination/source withdrawal. The
-- operator's current account/session and lease still gate every new write.
create function public.service_confirm_reward_club_payment_job(p_actor_user_id uuid,p_actor_session_id uuid,p_job_id uuid,p_worker_id uuid,p_lease_token uuid,
  p_payment jsonb,p_deployment jsonb,p_observation jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare j app_private.reward_club_payment_jobs%rowtype;d app_private.reward_verified_deployments%rowtype;receipt app_private.reward_club_payment_confirmations%rowtype;
  a jsonb;c jsonb;u jsonb;accounting jsonb;field text;pot integer;checkpoint jsonb;prior jsonb;at numeric;previous_paid numeric;
begin
  j:=app_private.lock_reward_club_payment_job(p_job_id,p_actor_user_id,p_actor_session_id);
  select * into d from app_private.reward_verified_deployments where campaign_id=j.campaign_id;
  if j.state='confirmed' then
    select * into receipt from app_private.reward_club_payment_confirmations where job_id=j.id;
    if receipt.payment_body is distinct from p_payment or d.identity_body is distinct from p_deployment
      or not exists(select 1 from app_private.reward_campaign_observations where id=receipt.observation_id and observation_body=p_observation) then
      raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
    perform public.service_read_reward_club_payment_context(p_actor_user_id,p_actor_session_id,j.claim_intent_id);
  return app_private.reward_club_payment_job_document(j);
  end if;
  if p_worker_id is null or p_lease_token is null or j.lease_token is distinct from p_lease_token or j.lease_owner is distinct from p_worker_id
    or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception using errcode='22023',message='reward_payment_job_lease_lost'; end if;
  if app_private.reward_club_payment_activation(j.claim_intent_id)<>j.activation_job_id then raise exception using errcode='22023',message='reward_payment_activation_required'; end if;
  select attempt_body into a from app_private.reward_club_payment_attempts where id=j.attempt_id;
  c:=public.service_read_reward_club_claim_proofs(p_actor_user_id,p_actor_session_id,j.claim_intent_id,'operator');u:=c#>'{claimContext,lifecycleContext,upload,body}';pot:=(u->>'enabledPot')::integer;
  if jsonb_typeof(p_payment) is distinct from 'object' or octet_length(p_payment::text)>=12000 or (select count(*) from jsonb_object_keys(p_payment))<>24
    or not p_payment ?& array['schemaVersion','action','chainId','contractAddress','relayerAddress','transactionHash','nonce','blockNumber','blockHash','blockTimestamp','logIndex',
      'entitlementId','recipient','amount','pot','authorizationNonce','allocationDigest','gasLimit','gasUsed','effectiveGasPrice','monadGasLimitFee','runtimeCodeHash','finalizedBlock','safeReceivedLogIndex'] then
    raise exception using errcode='22023',message='invalid_reward_payment_confirmation'; end if;
  foreach field in array array['schemaVersion','action','chainId','contractAddress','relayerAddress','transactionHash','nonce','entitlementId','recipient','amount','pot','authorizationNonce','allocationDigest','gasLimit'] loop
    if p_payment->field is distinct from a->field then raise exception using errcode='22023',message='invalid_reward_payment_confirmation'; end if;
  end loop;
  foreach field in array array['blockNumber','blockTimestamp','gasUsed','effectiveGasPrice','monadGasLimitFee'] loop
    if jsonb_typeof(p_payment->field) is distinct from 'string' or p_payment->>field !~ '^(0|[1-9][0-9]{0,77})$' then raise exception using errcode='22023',message='invalid_reward_payment_confirmation'; end if;
    perform (p_payment->>field)::app_private.reward_uint256;
  end loop;
  if coalesce(p_payment->>'blockHash','') !~ '^0x[0-9a-f]{64}$' or p_payment->>'blockHash'='0x'||repeat('0',64)
    or jsonb_typeof(p_payment->'logIndex') is distinct from 'number' or p_payment->>'logIndex' !~ '^(0|[1-9][0-9]{0,15})$'
    or jsonb_typeof(p_payment->'safeReceivedLogIndex') is distinct from 'number' or p_payment->>'safeReceivedLogIndex' !~ '^(0|[1-9][0-9]{0,15})$'
    or (p_payment->>'safeReceivedLogIndex')::numeric>9007199254740991 or (p_payment->>'safeReceivedLogIndex')::numeric<>(p_payment->>'logIndex')::numeric+1
    or (p_payment->>'logIndex')::numeric>9007199254740991 or p_payment->'runtimeCodeHash' is distinct from d.identity_body->'runtimeCodeHash'
    or p_deployment is distinct from d.identity_body or p_payment->'finalizedBlock' is distinct from p_observation->'finalizedBlock'
    or (p_payment->>'gasUsed')::numeric>(a->>'gasLimit')::numeric or (p_payment->>'effectiveGasPrice')::numeric>(a->>'maxFeePerGas')::numeric
    or (p_payment->>'monadGasLimitFee')::numeric<>(a->>'gasLimit')::numeric*(p_payment->>'effectiveGasPrice')::numeric then
    raise exception using errcode='22023',message='invalid_reward_payment_confirmation'; end if;
  select chain_witness#>'{observation,finalizedBlock}' into prior from app_private.reward_club_payment_intents where id=j.payment_intent_id;
  at:=(p_payment->>'blockTimestamp')::numeric;
  if (p_payment->>'blockNumber')::numeric<=(prior->>'number')::numeric or at<(prior->>'timestamp')::numeric
    or at<(a->>'issuedAt')::numeric or at>=(a->>'expiresAt')::numeric
    or (p_payment->>'blockNumber')::numeric>(p_observation#>>'{finalizedBlock,number}')::numeric or at>(p_observation#>>'{finalizedBlock,timestamp}')::numeric
    or ((p_payment->>'blockNumber')::numeric=(p_observation#>>'{finalizedBlock,number}')::numeric and (p_payment->>'blockHash' is distinct from p_observation#>>'{finalizedBlock,hash}'
      or p_payment->>'blockTimestamp' is distinct from p_observation#>>'{finalizedBlock,timestamp}')) then raise exception using errcode='22023',message='invalid_reward_payment_confirmation'; end if;
  accounting:=p_observation->'accounting';perform app_private.require_reward_campaign_accounting(accounting,pot);
  previous_paid:=app_private.reward_confirmed_campaign_payments(j.campaign_id);
  if accounting->>'state' not in ('3','4') or (accounting->'paid'->>pot)::numeric<previous_paid+(a->>'amount')::numeric
    or accounting->>'accountedFunding' is distinct from u->'budgets'->>pot then raise exception using errcode='22023',message='invalid_reward_payment_confirmation'; end if;
  foreach field in array array['budgets','allocated','entitlementCount','uploadDigest','snapshotDigest','allocationDigest'] loop
    if accounting->field is distinct from u->field then raise exception using errcode='22023',message='invalid_reward_payment_confirmation'; end if;
  end loop;
  checkpoint:=public.service_record_reward_campaign_checkpoint(j.campaign_id,p_actor_user_id,d.intent_id,d.attempt_id,'payment-job:'||j.id::text,p_deployment,p_observation);
  insert into app_private.reward_club_payment_confirmations(job_id,entitlement_id,observation_id,payment_body,confirmed_by_user_id,confirmed_session_id)
    values(j.id,j.entitlement_id,(checkpoint->>'observationId')::uuid,p_payment,p_actor_user_id,p_actor_session_id);
  update app_private.reward_club_payment_jobs set state='confirmed',may_have_broadcast=true,confirmation_observation_id=(checkpoint->>'observationId')::uuid,
    lease_owner=null,lease_token=null,lease_expires_at=null where id=j.id returning * into j;
  insert into app_private.reward_club_payment_job_events(job_id,kind,actor_user_id,actor_session_id,worker_id,lease_generation)
    values(j.id,'confirmed',p_actor_user_id,p_actor_session_id,p_worker_id,j.lease_generation);
  perform public.service_read_reward_club_payment_context(p_actor_user_id,p_actor_session_id,j.claim_intent_id);
  return app_private.reward_club_payment_job_document(j);
end $$;
revoke all on function app_private.protect_reward_club_payment_job(),app_private.reward_club_payment_job_document(app_private.reward_club_payment_jobs),
  app_private.reward_club_payment_activation(uuid),app_private.lock_reward_club_payment_job(uuid,uuid,uuid),
  app_private.require_reward_club_payment_execution(app_private.reward_club_payment_jobs,jsonb,jsonb,timestamptz),
  public.service_read_reward_club_payment_job(uuid,uuid,uuid,uuid),public.service_queue_reward_club_payment_job(uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz),
  public.service_step_reward_club_payment_job(uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz),public.service_confirm_reward_club_payment_job(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function app_private.protect_reward_club_payment_job(),app_private.reward_club_payment_job_document(app_private.reward_club_payment_jobs),
  app_private.reward_club_payment_activation(uuid),app_private.lock_reward_club_payment_job(uuid,uuid,uuid),
  app_private.require_reward_club_payment_execution(app_private.reward_club_payment_jobs,jsonb,jsonb,timestamptz),
  public.service_read_reward_club_payment_job(uuid,uuid,uuid,uuid),public.service_queue_reward_club_payment_job(uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz),
  public.service_step_reward_club_payment_job(uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz),public.service_confirm_reward_club_payment_job(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb)
  to service_role;

-- Both callers take the SAME chain/relayer advisory lock before this query.
-- This covers every programme, not just jobs in the current programme queue.
create function app_private.reward_relayer_lane_busy(p_chain integer,p_signer text,p_kind text,p_job uuid)
returns boolean language sql volatile security invoker set search_path='' as $$
  select exists(
    select 1 from app_private.reward_athlete_payment_jobs j join app_private.reward_athlete_payment_intents i on i.id=j.payment_intent_id
      where i.chain_id=p_chain and i.relayer_address=p_signer and (p_kind<>'athlete' or j.id<>p_job) and j.lease_expires_at>clock_timestamp()
    union all
    select 1 from app_private.reward_club_payment_jobs j join app_private.reward_club_payment_intents i on i.id=j.payment_intent_id
      where i.chain_id=p_chain and i.relayer_address=p_signer and (p_kind<>'club' or j.id<>p_job) and j.lease_expires_at>clock_timestamp()
  );
$$;
-- A campaign's accounted paid minimum includes BOTH beneficiary kinds.
create function app_private.reward_confirmed_campaign_payments(p_campaign uuid)
returns numeric language sql volatile security invoker set search_path='' as $$
  select coalesce(sum(amount),0) from (
    select (f.payment_body->>'amount')::numeric amount from app_private.reward_athlete_payment_confirmations f
      join app_private.reward_athlete_payment_jobs j on j.id=f.job_id where j.campaign_id=p_campaign
    union all
    select (f.payment_body->>'amount')::numeric from app_private.reward_club_payment_confirmations f
      join app_private.reward_club_payment_jobs j on j.id=f.job_id where j.campaign_id=p_campaign
  ) payments;
$$;
revoke all on function app_private.reward_relayer_lane_busy(integer,text,text,uuid),app_private.reward_confirmed_campaign_payments(uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_relayer_lane_busy(integer,text,text,uuid),app_private.reward_confirmed_campaign_payments(uuid) to service_role;

create or replace function public.service_step_reward_athlete_payment_job(p_actor_user_id uuid,p_actor_session_id uuid,p_job_id uuid,p_worker_id uuid,p_lease_token uuid,
  p_action text,p_execution jsonb default null,p_observed_at timestamptz default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare j app_private.reward_athlete_payment_jobs%rowtype;i app_private.reward_athlete_payment_intents%rowtype;c jsonb;kind text;
begin
  if p_worker_id is null or p_action is null or p_action not in ('lease','arm','submitted') or (p_action='lease' and p_lease_token is not null)
    or (p_action<>'arm' and (p_execution is not null or p_observed_at is not null)) then raise exception using errcode='22023',message='invalid_reward_payment_job'; end if;
  j:=app_private.lock_reward_athlete_payment_job(p_job_id,p_actor_user_id,p_actor_session_id);
  if j.state='confirmed' then return app_private.reward_athlete_payment_job_document(j); end if;
  select * into i from app_private.reward_athlete_payment_intents where id=j.payment_intent_id;
  if p_action='lease' then
    if j.lease_expires_at>clock_timestamp() then
      if j.lease_owner=p_worker_id then return app_private.reward_athlete_payment_job_document(j); else return null; end if;
    end if;
    if app_private.reward_relayer_lane_busy(i.chain_id,i.relayer_address,'athlete',j.id) then return null; end if;
    update app_private.reward_athlete_payment_jobs set state='leased',lease_owner=p_worker_id,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '60 seconds',
      lease_generation=lease_generation+1 where id=j.id returning * into j;kind:='leased';
  else
    if p_lease_token is null or j.lease_token is distinct from p_lease_token or j.lease_owner is distinct from p_worker_id
      or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception using errcode='22023',message='reward_payment_job_lease_lost'; end if;
    if p_action='arm' then
      if app_private.reward_payment_activation(j.claim_intent_id)<>j.activation_job_id then raise exception using errcode='22023',message='reward_payment_activation_required'; end if;
      c:=public.service_read_reward_athlete_claim_proofs(p_actor_user_id,p_actor_session_id,j.claim_intent_id,'operator');
      perform app_private.require_reward_payment_execution(j,c,p_execution,p_observed_at);
    end if;
    update app_private.reward_athlete_payment_jobs set state=case p_action when 'arm' then 'broadcasting' else 'submitted' end,may_have_broadcast=true where id=j.id returning * into j;
    kind:=case p_action when 'arm' then 'armed' else 'submitted' end;
  end if;
  insert into app_private.reward_athlete_payment_job_events(job_id,kind,actor_user_id,actor_session_id,worker_id,lease_generation,execution_witness)
    values(j.id,kind,p_actor_user_id,p_actor_session_id,p_worker_id,j.lease_generation,p_execution);
  return app_private.reward_athlete_payment_job_document(j);
end $$;
create or replace function public.service_confirm_reward_athlete_payment_job(p_actor_user_id uuid,p_actor_session_id uuid,p_job_id uuid,p_worker_id uuid,p_lease_token uuid,
  p_payment jsonb,p_deployment jsonb,p_observation jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare j app_private.reward_athlete_payment_jobs%rowtype;d app_private.reward_verified_deployments%rowtype;receipt app_private.reward_athlete_payment_confirmations%rowtype;
  a jsonb;c jsonb;u jsonb;accounting jsonb;field text;pot integer;checkpoint jsonb;prior jsonb;at numeric;previous_paid numeric;
begin
  j:=app_private.lock_reward_athlete_payment_job(p_job_id,p_actor_user_id,p_actor_session_id);
  select * into d from app_private.reward_verified_deployments where campaign_id=j.campaign_id;
  if j.state='confirmed' then
    select * into receipt from app_private.reward_athlete_payment_confirmations where job_id=j.id;
    if receipt.payment_body is distinct from p_payment or d.identity_body is distinct from p_deployment
      or not exists(select 1 from app_private.reward_campaign_observations where id=receipt.observation_id and observation_body=p_observation) then
      raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
    return app_private.reward_athlete_payment_job_document(j);
  end if;
  if p_worker_id is null or p_lease_token is null or j.lease_token is distinct from p_lease_token or j.lease_owner is distinct from p_worker_id
    or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception using errcode='22023',message='reward_payment_job_lease_lost'; end if;
  if app_private.reward_payment_activation(j.claim_intent_id)<>j.activation_job_id then raise exception using errcode='22023',message='reward_payment_activation_required'; end if;
  select attempt_body into a from app_private.reward_athlete_payment_attempts where id=j.attempt_id;
  c:=public.service_read_reward_athlete_claim_proofs(p_actor_user_id,p_actor_session_id,j.claim_intent_id,'operator');u:=c#>'{upload,body}';pot:=(u->>'enabledPot')::integer;
  if jsonb_typeof(p_payment) is distinct from 'object' or octet_length(p_payment::text)>=12000 or (select count(*) from jsonb_object_keys(p_payment))<>23
    or not p_payment ?& array['schemaVersion','action','chainId','contractAddress','relayerAddress','transactionHash','nonce','blockNumber','blockHash','blockTimestamp','logIndex',
      'entitlementId','recipient','amount','pot','authorizationNonce','allocationDigest','gasLimit','gasUsed','effectiveGasPrice','monadGasLimitFee','runtimeCodeHash','finalizedBlock'] then
    raise exception using errcode='22023',message='invalid_reward_payment_confirmation'; end if;
  foreach field in array array['schemaVersion','action','chainId','contractAddress','relayerAddress','transactionHash','nonce','entitlementId','recipient','amount','pot','authorizationNonce','allocationDigest','gasLimit'] loop
    if p_payment->field is distinct from a->field then raise exception using errcode='22023',message='invalid_reward_payment_confirmation'; end if;
  end loop;
  foreach field in array array['blockNumber','blockTimestamp','gasUsed','effectiveGasPrice','monadGasLimitFee'] loop
    if jsonb_typeof(p_payment->field) is distinct from 'string' or p_payment->>field !~ '^(0|[1-9][0-9]{0,77})$' then raise exception using errcode='22023',message='invalid_reward_payment_confirmation'; end if;
    perform (p_payment->>field)::app_private.reward_uint256;
  end loop;
  if coalesce(p_payment->>'blockHash','') !~ '^0x[0-9a-f]{64}$' or p_payment->>'blockHash'='0x'||repeat('0',64)
    or jsonb_typeof(p_payment->'logIndex') is distinct from 'number' or p_payment->>'logIndex' !~ '^(0|[1-9][0-9]{0,15})$'
    or (p_payment->>'logIndex')::numeric>9007199254740991 or p_payment->'runtimeCodeHash' is distinct from d.identity_body->'runtimeCodeHash'
    or p_deployment is distinct from d.identity_body or p_payment->'finalizedBlock' is distinct from p_observation->'finalizedBlock'
    or (p_payment->>'gasUsed')::numeric>(a->>'gasLimit')::numeric or (p_payment->>'effectiveGasPrice')::numeric>(a->>'maxFeePerGas')::numeric
    or (p_payment->>'monadGasLimitFee')::numeric<>(a->>'gasLimit')::numeric*(p_payment->>'effectiveGasPrice')::numeric then
    raise exception using errcode='22023',message='invalid_reward_payment_confirmation'; end if;
  select chain_witness#>'{observation,finalizedBlock}' into prior from app_private.reward_athlete_payment_intents where id=j.payment_intent_id;
  at:=(p_payment->>'blockTimestamp')::numeric;
  if (p_payment->>'blockNumber')::numeric<=(prior->>'number')::numeric or at<(prior->>'timestamp')::numeric
    or at<(a->>'issuedAt')::numeric or at>=(a->>'expiresAt')::numeric
    or (p_payment->>'blockNumber')::numeric>(p_observation#>>'{finalizedBlock,number}')::numeric or at>(p_observation#>>'{finalizedBlock,timestamp}')::numeric
    or ((p_payment->>'blockNumber')::numeric=(p_observation#>>'{finalizedBlock,number}')::numeric and (p_payment->>'blockHash' is distinct from p_observation#>>'{finalizedBlock,hash}'
      or p_payment->>'blockTimestamp' is distinct from p_observation#>>'{finalizedBlock,timestamp}')) then raise exception using errcode='22023',message='invalid_reward_payment_confirmation'; end if;
  accounting:=p_observation->'accounting';perform app_private.require_reward_campaign_accounting(accounting,pot);
  previous_paid:=app_private.reward_confirmed_campaign_payments(j.campaign_id);
  if accounting->>'state' not in ('3','4') or (accounting->'paid'->>pot)::numeric<previous_paid+(a->>'amount')::numeric
    or accounting->>'accountedFunding' is distinct from u->'budgets'->>pot then raise exception using errcode='22023',message='invalid_reward_payment_confirmation'; end if;
  foreach field in array array['budgets','allocated','entitlementCount','uploadDigest','snapshotDigest','allocationDigest'] loop
    if accounting->field is distinct from u->field then raise exception using errcode='22023',message='invalid_reward_payment_confirmation'; end if;
  end loop;
  checkpoint:=public.service_record_reward_campaign_checkpoint(j.campaign_id,p_actor_user_id,d.intent_id,d.attempt_id,'payment-job:'||j.id::text,p_deployment,p_observation);
  insert into app_private.reward_athlete_payment_confirmations(job_id,entitlement_id,observation_id,payment_body,confirmed_by_user_id,confirmed_session_id)
    values(j.id,j.entitlement_id,(checkpoint->>'observationId')::uuid,p_payment,p_actor_user_id,p_actor_session_id);
  update app_private.reward_athlete_payment_jobs set state='confirmed',may_have_broadcast=true,confirmation_observation_id=(checkpoint->>'observationId')::uuid,
    lease_owner=null,lease_token=null,lease_expires_at=null where id=j.id returning * into j;
  insert into app_private.reward_athlete_payment_job_events(job_id,kind,actor_user_id,actor_session_id,worker_id,lease_generation)
    values(j.id,'confirmed',p_actor_user_id,p_actor_session_id,p_worker_id,j.lease_generation);
  return app_private.reward_athlete_payment_job_document(j);
end $$;

-- A private, read-only cursor over existing durable jobs. Selection is NOT an
-- execution lease or renewed approval; each worker still reloads and fences its
-- exact attempt. Confirmed jobs leave the queue without deleting their history.
create or replace function public.service_next_reward_operator_job(
  p_programme_id uuid,p_actor_user_id uuid,p_actor_session_id uuid,
  p_chain_id integer,p_excluded_signers text[]
)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare programme app_private.reward_programmes%rowtype; selected jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  select * into programme from app_private.reward_programmes where id=p_programme_id;
  if p_chain_id is null or p_chain_id not in (10143,31337) or programme.chain_id is distinct from p_chain_id
    or p_excluded_signers is null or cardinality(p_excluded_signers)>100
    or exists(select 1 from unnest(p_excluded_signers) a where a is null or a !~ '^0x[0-9a-f]{40}$'
      or a='0x0000000000000000000000000000000000000000')
    or (select count(distinct a) from unnest(p_excluded_signers) a)<>cardinality(p_excluded_signers) then
    raise exception using errcode='22023',message='invalid_reward_operator_queue';
  end if;
  with jobs as (
    select 'deployment'::text kind,j.id,j.campaign_id,j.intent_id,j.attempt_id,j.transaction_hash,j.state,
      i.chain_id,i.operator_address::text signer,i.nonce from app_private.reward_deployment_jobs j
      join app_private.reward_deployment_intents i on i.id=j.intent_id
    union all
    select 'funding',j.id,j.campaign_id,j.intent_id,j.attempt_id,j.transaction_hash,j.state,
      i.chain_id,i.operator_address::text,i.nonce from app_private.reward_funding_jobs j
      join app_private.reward_funding_intents i on i.id=j.intent_id
    union all
    select 'lifecycle',j.id,j.campaign_id,j.intent_id,j.attempt_id,j.transaction_hash,j.state,
      i.chain_id,i.operator_address::text,i.nonce from app_private.reward_lifecycle_jobs j
      join app_private.reward_lifecycle_intents i on i.id=j.intent_id
    union all
    select 'athlete_payment',j.id,j.campaign_id,j.payment_intent_id,j.attempt_id,j.transaction_hash,j.state,
      i.chain_id,i.relayer_address::text,i.nonce from app_private.reward_athlete_payment_jobs j
      join app_private.reward_athlete_payment_intents i on i.id=j.payment_intent_id
    union all
    select 'club_payment',j.id,j.campaign_id,j.payment_intent_id,j.attempt_id,j.transaction_hash,j.state,
      i.chain_id,i.relayer_address::text,i.nonce from app_private.reward_club_payment_jobs j
      join app_private.reward_club_payment_intents i on i.id=j.payment_intent_id
  )
  select jsonb_build_object('kind',j.kind,'jobId',j.id,'campaignId',j.campaign_id,'intentId',j.intent_id,
    'attemptId',j.attempt_id,'transactionHash','0x'||encode(j.transaction_hash,'hex'),
    'signerAddress',j.signer,'nonce',j.nonce::text,'state',j.state) into selected
  from jobs j join app_private.reward_campaigns c on c.id=j.campaign_id
  where c.programme_id=p_programme_id and j.chain_id=p_chain_id and j.state<>'confirmed'
    and not(j.signer=any(p_excluded_signers))
  order by j.signer,j.nonce,j.kind,j.id limit 1;
  -- A read could have waited for DDL. Recheck live identity before returning it.
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  return jsonb_build_object('schemaVersion',1,'programmeId',p_programme_id,'chainId',p_chain_id,'job',selected);
end $$;
revoke all on function public.service_next_reward_operator_job(uuid,uuid,uuid,integer,text[]) from public,anon,authenticated,service_role;
grant execute on function public.service_next_reward_operator_job(uuid,uuid,uuid,integer,text[]) to service_role;


-- Private transaction envelope for the existing stored-job runner. No signing,
-- queuing, new intents or arbitrary RPC dispatch. Underlying functions retain
-- their own operator/source/lease checks and privileges. A post-call session
-- failure rolls back ALL changes made by that call, including after lock waits.
create or replace function public.service_reward_operator_session_call(
  p_actor_user_id uuid,p_actor_session_id uuid,p_method text,p_arguments jsonb
)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare routine pg_catalog.pg_proc%rowtype; parameters text; result jsonb;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='22023',message='reward_operator_session_isolation_required';
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if p_method is null or p_method <> all(array[
    'service_read_reward_deployment_context','service_read_reward_deployment_attempt',
    'service_read_reward_campaign_checkpoint','service_record_reward_campaign_checkpoint',
    'service_read_reward_deployment_job','service_step_reward_deployment_job',
    'service_read_reward_funding_context','service_read_reward_funding_attempt',
    'service_read_reward_funding_job','service_step_reward_funding_job','service_confirm_reward_funding_job',
    'service_read_reward_lifecycle_context','service_read_reward_lifecycle_attempt',
    'service_read_reward_lifecycle_job','service_step_reward_lifecycle_job','service_confirm_reward_lifecycle_job',
    'service_read_reward_athlete_payment_context','service_read_reward_athlete_payment_attempt',
    'service_read_reward_athlete_payment_job','service_step_reward_athlete_payment_job','service_confirm_reward_athlete_payment_job',
    'service_read_reward_club_payment_context','service_read_reward_club_payment_attempt',
    'service_read_reward_club_payment_job','service_step_reward_club_payment_job','service_confirm_reward_club_payment_job'
  ]) or jsonb_typeof(p_arguments) is distinct from 'object' or octet_length(p_arguments::text)>131072
    or p_arguments->>'p_actor_user_id' is distinct from p_actor_user_id::text
    or (p_arguments ? 'p_actor_session_id' and p_arguments->>'p_actor_session_id' is distinct from p_actor_session_id::text) then
    raise exception using errcode='22023',message='invalid_reward_operator_session_call';
  end if;
  -- Only a single non-overloaded, invoker JSON function in public is allowed.
  -- Names and types come from trusted schema, not supplied JSON. Overloads,
  -- changed argument keys and unsupported signatures are rejected.
  if (select count(*) from pg_catalog.pg_proc where pronamespace='public'::regnamespace and proname=p_method)<>1 then
    raise exception using errcode='22023',message='invalid_reward_operator_session_call';
  end if;
  select * into routine from pg_catalog.pg_proc where pronamespace='public'::regnamespace and proname=p_method;
  if routine.prokind<>'f' or routine.prosecdef or routine.proretset or routine.proargmodes is not null
    or routine.provariadic<>0 or routine.prorettype<>'jsonb'::regtype or routine.proargnames is null
    or (select array_agg(k order by k) from jsonb_object_keys(p_arguments) k)
      is distinct from (select array_agg(k order by k) from unnest(routine.proargnames) k)
    or exists(select 1 from unnest(routine.proargtypes::oid[]) t
      where t not in ('uuid'::regtype,'text'::regtype,'integer'::regtype,'jsonb'::regtype,'timestamptz'::regtype)) then
    raise exception using errcode='22023',message='invalid_reward_operator_session_call';
  end if;
  select string_agg(case when t='jsonb'::regtype
    then format('%I => nullif($1 -> %L, ''null''::jsonb)',n,n)
    else format('%I => ($1 ->> %L)::%s',n,n,pg_catalog.format_type(t,null)) end,',' order by position)
    into parameters from unnest(routine.proargnames,routine.proargtypes::oid[]) with ordinality as a(n,t,position);
  execute format('select public.%I(%s)',p_method,parameters) into result using p_arguments;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return jsonb_build_object('schemaVersion',1,'actorUserId',p_actor_user_id,'actorSessionId',p_actor_session_id,
    'method',p_method,'result',result);
end $$;
revoke all on function public.service_reward_operator_session_call(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_operator_session_call(uuid,uuid,text,jsonb) to service_role;


commit;
