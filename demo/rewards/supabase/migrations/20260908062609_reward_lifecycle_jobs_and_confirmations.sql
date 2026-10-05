begin;
alter table app_private.reward_lifecycle_intents add constraint reward_lifecycle_job_scope unique(id,campaign_id,upload_id);
alter table app_private.reward_lifecycle_attempts add constraint reward_lifecycle_attempt_scope unique(id,intent_id);
alter table app_private.reward_funding_jobs add constraint reward_funding_job_scope unique(id,campaign_id);

create table app_private.reward_lifecycle_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  upload_id uuid not null,
  intent_id uuid not null unique,
  attempt_id uuid not null unique,
  transaction_hash app_private.reward_bytes32 not null unique,
  predecessor_funding_job_id uuid,
  predecessor_lifecycle_job_id uuid,
  created_by_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  state text not null default 'queued' check(state in ('queued','leased','broadcasting','submitted','confirmed')),
  may_have_broadcast boolean not null default false,
  lease_owner uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  lease_generation integer not null default 0 check(lease_generation>=0),
  confirmation_observation_id uuid references app_private.reward_campaign_observations(id) on delete restrict,
  check((lease_owner is null)=(lease_token is null) and (lease_owner is null)=(lease_expires_at is null)),
  check((state='confirmed')=(confirmation_observation_id is not null)),
  check(state<>'confirmed' or lease_owner is null),
  check(num_nonnulls(predecessor_funding_job_id,predecessor_lifecycle_job_id)=1),
  check(predecessor_lifecycle_job_id is distinct from id),
  unique(id,campaign_id,upload_id),
  unique(campaign_id,created_by_user_id,idempotency_key),
  foreign key(intent_id,campaign_id,upload_id) references app_private.reward_lifecycle_intents(id,campaign_id,upload_id) on delete restrict,
  foreign key(attempt_id,intent_id) references app_private.reward_lifecycle_attempts(id,intent_id) on delete restrict,
  foreign key(predecessor_funding_job_id,campaign_id) references app_private.reward_funding_jobs(id,campaign_id) on delete restrict,
  foreign key(predecessor_lifecycle_job_id,campaign_id,upload_id) references app_private.reward_lifecycle_jobs(id,campaign_id,upload_id) on delete restrict
);
create index reward_lifecycle_job_confirmation on app_private.reward_lifecycle_jobs(confirmation_observation_id) where confirmation_observation_id is not null;
create index reward_lifecycle_funding_predecessor on app_private.reward_lifecycle_jobs(predecessor_funding_job_id) where predecessor_funding_job_id is not null;
create index reward_lifecycle_predecessor on app_private.reward_lifecycle_jobs(predecessor_lifecycle_job_id) where predecessor_lifecycle_job_id is not null;
create table app_private.reward_lifecycle_job_events (
  id uuid primary key default gen_random_uuid(),job_id uuid not null references app_private.reward_lifecycle_jobs(id) on delete restrict,
  kind text not null check(kind in ('queued','leased','armed','submitted','confirmed')),
  actor_user_id uuid not null,worker_id uuid,lease_generation integer not null check(lease_generation>=0),
  recorded_at timestamptz not null default clock_timestamp()
);
create index reward_lifecycle_job_event_lookup on app_private.reward_lifecycle_job_events(job_id,recorded_at,id);
create table app_private.reward_lifecycle_confirmations (
  id uuid primary key default gen_random_uuid(),job_id uuid not null unique references app_private.reward_lifecycle_jobs(id) on delete restrict,
  observation_id uuid not null unique references app_private.reward_campaign_observations(id) on delete restrict,
  lifecycle_body jsonb not null check(jsonb_typeof(lifecycle_body)='object' and octet_length(lifecycle_body::text)<=12000),
  confirmed_by_user_id uuid not null,confirmed_at timestamptz not null default clock_timestamp()
);
do $$ declare name text; begin
  foreach name in array array['reward_lifecycle_jobs','reward_lifecycle_job_events','reward_lifecycle_confirmations'] loop
    execute format('alter table app_private.%I enable row level security',name);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',name);
    execute format('grant select,insert on app_private.%I to service_role',name);
    execute format('create policy %I on app_private.%I for select to service_role using(true)',name||'_service_select',name);
    execute format('create policy %I on app_private.%I for insert to service_role with check(true)',name||'_service_insert',name);
  end loop;
end $$;
grant update(state,may_have_broadcast,lease_owner,lease_token,lease_expires_at,lease_generation,confirmation_observation_id) on app_private.reward_lifecycle_jobs to service_role;
create policy reward_lifecycle_jobs_update on app_private.reward_lifecycle_jobs for update to service_role using(true) with check(true);
create trigger reward_lifecycle_events_immutable before update or delete on app_private.reward_lifecycle_job_events
  for each row execute function app_private.reject_reward_ledger_mutation();
create trigger reward_lifecycle_confirmation_immutable before update or delete on app_private.reward_lifecycle_confirmations
  for each row execute function app_private.reject_reward_ledger_mutation();

-- Same advisory lock already used by deployment/funding steps. The new kind
-- participates in exclusion in BOTH directions, including other programmes.
create or replace function app_private.reward_operator_job_busy(p_chain integer,p_operator text,p_kind text,p_job uuid)
returns boolean language sql volatile security invoker set search_path='' as $$
  select exists(select 1 from app_private.reward_deployment_jobs j join app_private.reward_deployment_intents i on i.id=j.intent_id
    where i.chain_id=p_chain and i.operator_address=p_operator and j.lease_expires_at>clock_timestamp() and not(p_kind='deployment' and j.id=p_job))
  or exists(select 1 from app_private.reward_funding_jobs j join app_private.reward_funding_intents i on i.id=j.intent_id
    where i.chain_id=p_chain and i.operator_address=p_operator and j.lease_expires_at>clock_timestamp() and not(p_kind='funding' and j.id=p_job))
  or exists(select 1 from app_private.reward_lifecycle_jobs j join app_private.reward_lifecycle_intents i on i.id=j.intent_id
    where i.chain_id=p_chain and i.operator_address=p_operator and j.lease_expires_at>clock_timestamp() and not(p_kind='lifecycle' and j.id=p_job));
$$;

create function app_private.protect_reward_lifecycle_job() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception using errcode='22023',message='reward_job_identity_is_immutable'; end if;
  if (new.id,new.campaign_id,new.upload_id,new.intent_id,new.attempt_id,new.transaction_hash,new.predecessor_funding_job_id,new.predecessor_lifecycle_job_id,
      new.created_by_user_id,new.created_at,new.idempotency_key)
    is distinct from (old.id,old.campaign_id,old.upload_id,old.intent_id,old.attempt_id,old.transaction_hash,old.predecessor_funding_job_id,old.predecessor_lifecycle_job_id,
      old.created_by_user_id,old.created_at,old.idempotency_key)
    or (old.may_have_broadcast and not new.may_have_broadcast) or new.lease_generation<old.lease_generation or (old.state='confirmed' and new is distinct from old) then
    raise exception using errcode='22023',message='reward_job_identity_is_immutable'; end if;
  if new.state='confirmed' and not exists(select 1 from app_private.reward_lifecycle_confirmations f where f.job_id=new.id and f.observation_id=new.confirmation_observation_id) then
    raise exception using errcode='22023',message='reward_lifecycle_not_verified'; end if;
  return new;
end $$;
create trigger reward_lifecycle_job_identity before update or delete on app_private.reward_lifecycle_jobs
  for each row execute function app_private.protect_reward_lifecycle_job();
create function app_private.reward_lifecycle_job_document(j app_private.reward_lifecycle_jobs)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('jobId',j.id,'campaignId',j.campaign_id,'uploadId',j.upload_id,'intentId',j.intent_id,'attemptId',j.attempt_id,
    'transactionHash','0x'||encode(j.transaction_hash,'hex'),'predecessorFundingJobId',j.predecessor_funding_job_id,'predecessorLifecycleJobId',j.predecessor_lifecycle_job_id,
    'createdByUserId',j.created_by_user_id,'createdAt',j.created_at,'idempotencyKey',j.idempotency_key,'state',j.state,'mayHaveBroadcast',j.may_have_broadcast,
    'leaseOwner',j.lease_owner,'leaseToken',j.lease_token,'leaseExpiresAt',j.lease_expires_at,'leaseGeneration',j.lease_generation,'confirmationObservationId',j.confirmation_observation_id);
$$;

-- Server-derived dependency. A matching live prefix alone never adopts a manual
-- transaction. Every predecessor must have its own exact durable confirmation.
create function app_private.reward_lifecycle_predecessor(p_intent_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare i app_private.reward_lifecycle_intents%rowtype; total integer; prev app_private.reward_lifecycle_jobs%rowtype;
  funding app_private.reward_funding_jobs%rowtype; receipt jsonb; block_number numeric; activation numeric; observed jsonb;
begin
  select * into i from app_private.reward_lifecycle_intents where id=p_intent_id;
  if not found then raise exception using errcode='22023',message='reward_lifecycle_intent_mismatch'; end if;
  select jsonb_array_length(upload_body->'awards') into total from app_private.reward_upload_packages where id=i.upload_id;
  select observation_body into observed from app_private.reward_campaign_observations where id=i.observation_id and campaign_id=i.campaign_id;
  if (i.action='upload_awards' and i.batch_start=0) or (i.action='stage_allocation' and total=0) then
    select j.* into funding from app_private.reward_funding_jobs j join app_private.reward_funding_intents fi on fi.id=j.intent_id
      join app_private.reward_funding_confirmations f on f.job_id=j.id and f.observation_id=j.confirmation_observation_id
      where j.campaign_id=i.campaign_id and j.state='confirmed' and fi.chain_id=i.chain_id and fi.operator_address=i.operator_address and fi.nonce<i.nonce;
    if funding.id is null then raise exception using errcode='55000',message='reward_lifecycle_predecessor_not_confirmed'; end if;
    select funding_body into receipt from app_private.reward_funding_confirmations where job_id=funding.id;
  else
    select j.* into prev from app_private.reward_lifecycle_jobs j join app_private.reward_lifecycle_intents pi on pi.id=j.intent_id
      join app_private.reward_lifecycle_confirmations f on f.job_id=j.id and f.observation_id=j.confirmation_observation_id
      where j.campaign_id=i.campaign_id and j.upload_id=i.upload_id and j.state='confirmed' and pi.chain_id=i.chain_id
        and pi.operator_address=i.operator_address and pi.nonce<i.nonce
        and ((i.action='upload_awards' and pi.action='upload_awards' and pi.batch_start+pi.batch_size=i.batch_start)
          or (i.action='stage_allocation' and pi.action='upload_awards' and pi.batch_start+pi.batch_size=total)
          or (i.action='activate' and pi.action='stage_allocation'));
    if prev.id is null then raise exception using errcode='55000',message='reward_lifecycle_predecessor_not_confirmed'; end if;
    select lifecycle_body into receipt from app_private.reward_lifecycle_confirmations where job_id=prev.id;
    if i.action='activate' then
      activation:=(receipt->>'activationNotBefore')::numeric;
      if activation is null or activation is distinct from (observed#>>'{accounting,activationNotBefore}')::numeric then
        raise exception using errcode='22023',message='reward_lifecycle_predecessor_mismatch'; end if;
    end if;
  end if;
  block_number:=(receipt->>'blockNumber')::numeric;
  if block_number is null or observed is null or block_number>(observed#>>'{finalizedBlock,number}')::numeric then
    raise exception using errcode='22023',message='reward_lifecycle_predecessor_mismatch'; end if;
  return jsonb_build_object('fundingJobId',funding.id,'lifecycleJobId',prev.id,'blockNumber',block_number::text,
    'activationNotBefore',case when activation is null then null else activation::text end);
end $$;

create function public.service_queue_reward_lifecycle_job(p_campaign_id uuid,p_actor_user_id uuid,p_upload_id uuid,p_intent_id uuid,p_attempt_id uuid,p_idempotency_key text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_campaigns%rowtype; a app_private.reward_lifecycle_attempts%rowtype; j app_private.reward_lifecycle_jobs%rowtype; predecessor jsonb;
begin
  select * into c from app_private.reward_campaigns where id=p_campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  perform id from app_private.reward_programmes where id=c.programme_id for update;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception using errcode='22023',message='invalid_reward_lifecycle_job'; end if;
  if not exists(select 1 from app_private.reward_lifecycle_intents where id=p_intent_id and campaign_id=c.id and upload_id=p_upload_id) then
    raise exception using errcode='22023',message='reward_lifecycle_intent_mismatch'; end if;
  select * into a from app_private.reward_lifecycle_attempts where id=p_attempt_id and intent_id=p_intent_id;
  if not found then raise exception using errcode='22023',message='reward_lifecycle_attempt_mismatch'; end if;
  select * into j from app_private.reward_lifecycle_jobs where intent_id=p_intent_id or (campaign_id=c.id and created_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key);
  if found then
    if j.intent_id<>p_intent_id or j.upload_id<>p_upload_id or j.attempt_id<>p_attempt_id or j.created_by_user_id<>p_actor_user_id or j.idempotency_key<>p_idempotency_key then
      raise exception using errcode='22023',message='reward_lifecycle_job_already_queued'; end if;
  else
    perform public.service_check_reward_upload_evidence(c.id,p_actor_user_id,p_upload_id);
    predecessor:=app_private.reward_lifecycle_predecessor(p_intent_id);
    insert into app_private.reward_lifecycle_jobs(campaign_id,upload_id,intent_id,attempt_id,transaction_hash,predecessor_funding_job_id,predecessor_lifecycle_job_id,created_by_user_id,idempotency_key)
      values(c.id,p_upload_id,p_intent_id,a.id,a.transaction_hash,(predecessor->>'fundingJobId')::uuid,(predecessor->>'lifecycleJobId')::uuid,p_actor_user_id,p_idempotency_key) returning * into j;
    insert into app_private.reward_lifecycle_job_events(job_id,kind,actor_user_id,lease_generation) values(j.id,'queued',p_actor_user_id,0);
  end if;
  return app_private.reward_lifecycle_job_document(j);
end $$;
-- Exact historical receipt + accounting + completion commit together. Source
-- corrections do not erase a mined transaction; they stop arm/new sends instead.
create function public.service_confirm_reward_lifecycle_job(p_job_id uuid,p_actor_user_id uuid,p_worker_id uuid,p_lease_token uuid,
  p_lifecycle jsonb,p_deployment jsonb,p_observation jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare j app_private.reward_lifecycle_jobs%rowtype; i app_private.reward_lifecycle_intents%rowtype; d app_private.reward_verified_deployments%rowtype;
  c app_private.reward_campaigns%rowtype; u app_private.reward_upload_packages%rowtype; receipt app_private.reward_lifecycle_confirmations%rowtype;
  checkpoint jsonb; predecessor jsonb; a jsonb; field text; pot integer; count_uploaded integer; total integer; prefix_total numeric; expected_activation numeric;
begin
  select * into j from app_private.reward_lifecycle_jobs where id=p_job_id;
  select * into c from app_private.reward_campaigns where id=j.campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into i from app_private.reward_lifecycle_intents where id=j.intent_id;
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||i.chain_id::text||':'||i.operator_address,0));
  perform id from app_private.reward_programmes where id=c.programme_id for update;
  select * into j from app_private.reward_lifecycle_jobs where id=p_job_id for update;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into d from app_private.reward_verified_deployments where campaign_id=c.id;
  if j.state='confirmed' then
    select * into receipt from app_private.reward_lifecycle_confirmations where job_id=j.id;
    if receipt.lifecycle_body is distinct from p_lifecycle or d.identity_body is distinct from p_deployment
      or not exists(select 1 from app_private.reward_campaign_observations where id=receipt.observation_id and observation_body=p_observation) then
      raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
    return app_private.reward_lifecycle_job_document(j);
  end if;
  if p_worker_id is null or p_lease_token is null or j.lease_owner is distinct from p_worker_id or j.lease_token is distinct from p_lease_token
    or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then
    raise exception using errcode='22023',message='reward_lifecycle_job_lease_lost'; end if;
  predecessor:=app_private.reward_lifecycle_predecessor(i.id);
  if (predecessor->>'fundingJobId')::uuid is distinct from j.predecessor_funding_job_id
    or (predecessor->>'lifecycleJobId')::uuid is distinct from j.predecessor_lifecycle_job_id then
    raise exception using errcode='22023',message='reward_lifecycle_predecessor_mismatch'; end if;
  select * into u from app_private.reward_upload_packages where id=j.upload_id;
  pot:=case c.pot when 'race' then 0 else 1 end; total:=jsonb_array_length(u.upload_body->'awards');
  if jsonb_typeof(p_lifecycle) is distinct from 'object' or octet_length(p_lifecycle::text)>12000 then
    raise exception using errcode='22023',message='invalid_reward_lifecycle_confirmation'; end if;
  if (select count(*) from jsonb_object_keys(p_lifecycle))<>19 or not p_lifecycle ?& array['schemaVersion','action','chainId','contractAddress','operatorAddress',
    'transactionHash','nonce','blockNumber','blockHash','blockTimestamp','firstLogIndex','lastLogIndex','batchStart','batchSize','allocationDigest',
    'activationNotBefore','claimDeadline','runtimeCodeHash','finalizedBlock']
    or p_lifecycle->'schemaVersion' is distinct from '1'::jsonb or p_lifecycle->>'action' is distinct from i.action
    or p_lifecycle->'chainId' is distinct from to_jsonb(i.chain_id) or p_lifecycle->>'contractAddress' is distinct from d.contract_address
    or p_lifecycle->>'operatorAddress' is distinct from i.operator_address or p_lifecycle->>'transactionHash' is distinct from '0x'||encode(j.transaction_hash,'hex')
    or p_lifecycle->>'runtimeCodeHash' is distinct from d.identity_body->>'runtimeCodeHash'
    or p_lifecycle->>'allocationDigest' is distinct from u.upload_body->>'allocationDigest'
    or p_lifecycle->'finalizedBlock' is distinct from p_observation->'finalizedBlock'
    or p_lifecycle->'batchStart' is distinct from coalesce(to_jsonb(i.batch_start),'null'::jsonb)
    or p_lifecycle->'batchSize' is distinct from coalesce(to_jsonb(i.batch_size),'null'::jsonb)
    or jsonb_typeof(p_lifecycle->'blockHash') is distinct from 'string' or p_lifecycle->>'blockHash' !~ '^0x[0-9a-f]{64}$'
    or p_lifecycle->>'blockHash'='0x'||repeat('0',64) then
    raise exception using errcode='22023',message='invalid_reward_lifecycle_confirmation'; end if;
  foreach field in array array['firstLogIndex','lastLogIndex'] loop
    if jsonb_typeof(p_lifecycle->field) is distinct from 'number' or p_lifecycle->>field !~ '^(0|[1-9][0-9]{0,15})$'
      or (p_lifecycle->>field)::numeric>9007199254740991 then
      raise exception using errcode='22023',message='invalid_reward_lifecycle_confirmation'; end if;
  end loop;
  foreach field in array array['nonce','blockNumber','blockTimestamp'] loop
    if jsonb_typeof(p_lifecycle->field) is distinct from 'string' or p_lifecycle->>field !~ '^(0|[1-9][0-9]{0,77})$' then
      raise exception using errcode='22023',message='invalid_reward_lifecycle_confirmation'; end if;
    perform (p_lifecycle->>field)::app_private.reward_uint256;
  end loop;
  foreach field in array array['activationNotBefore','claimDeadline'] loop
    if p_lifecycle->field<>'null'::jsonb then
      if jsonb_typeof(p_lifecycle->field)<>'string' or p_lifecycle->>field !~ '^(0|[1-9][0-9]{0,77})$' then
        raise exception using errcode='22023',message='invalid_reward_lifecycle_confirmation'; end if;
      perform (p_lifecycle->>field)::app_private.reward_uint256;
    end if;
  end loop;
  a:=p_observation->'accounting';perform app_private.require_reward_campaign_accounting(a,pot);
  if p_lifecycle->>'nonce'<>i.nonce::text
    or (p_lifecycle->>'blockNumber')::numeric<greatest((d.identity_body->>'deploymentBlockNumber')::numeric,(predecessor->>'blockNumber')::numeric)
    or (p_lifecycle->>'blockNumber')::numeric>(p_observation#>>'{finalizedBlock,number}')::numeric
    or (p_lifecycle->>'blockTimestamp')::numeric>(p_observation#>>'{finalizedBlock,timestamp}')::numeric
    or ((p_lifecycle->>'blockNumber')::numeric=(p_observation#>>'{finalizedBlock,number}')::numeric
      and (p_lifecycle->>'blockHash' is distinct from p_observation#>>'{finalizedBlock,hash}'
        or p_lifecycle->>'blockTimestamp' is distinct from p_observation#>>'{finalizedBlock,timestamp}'))
    or (p_lifecycle->>'lastLogIndex')::numeric-(p_lifecycle->>'firstLogIndex')::numeric+1<>coalesce(i.batch_size,1)
    or a->>'state'='0' or a->>'accountedFunding' is distinct from c.budget_wei::text or a->'budgets'->>pot is distinct from c.budget_wei::text
    or (a->>'entitlementCount')::numeric>total then
    raise exception using errcode='22023',message='invalid_reward_lifecycle_confirmation'; end if;
  count_uploaded:=(a->>'entitlementCount')::integer;
  select coalesce(sum((award->>'amount')::numeric),0) into prefix_total from jsonb_array_elements(u.upload_body->'awards') with ordinality x(award,n) where n<=count_uploaded;
  if (a->'allocated'->>pot)::numeric<>prefix_total
    or (count_uploaded=total and a->>'uploadDigest' is distinct from u.upload_body->>'uploadDigest')
    or (a->>'allocationDigest'<>'0x'||repeat('0',64) and (a->>'allocationDigest' is distinct from u.upload_body->>'allocationDigest'
      or a->>'snapshotDigest' is distinct from u.upload_body->>'snapshotDigest')) then
    raise exception using errcode='22023',message='invalid_reward_lifecycle_confirmation'; end if;
  if i.action='upload_awards' then
    if count_uploaded<i.batch_start+i.batch_size or p_lifecycle->'activationNotBefore'<>'null'::jsonb or p_lifecycle->'claimDeadline'<>'null'::jsonb then
      raise exception using errcode='22023',message='invalid_reward_lifecycle_confirmation'; end if;
  else
    if count_uploaded<>total or a->>'allocationDigest' is distinct from u.upload_body->>'allocationDigest' or a->>'snapshotDigest' is distinct from u.upload_body->>'snapshotDigest' then
      raise exception using errcode='22023',message='invalid_reward_lifecycle_confirmation'; end if;
    if i.action='stage_allocation' then
      expected_activation:=greatest((u.upload_body->>'latestPublicationAt')::numeric+259200,(p_lifecycle->>'blockTimestamp')::numeric+86400);
      if (u.upload_body->>'latestPublicationAt')::numeric>(p_lifecycle->>'blockTimestamp')::numeric
        or p_lifecycle->>'activationNotBefore' is distinct from expected_activation::text or p_lifecycle->'claimDeadline'<>'null'::jsonb
        or a->>'activationNotBefore' is distinct from expected_activation::text or a->>'state' not in ('2','3','4','5') then
        raise exception using errcode='22023',message='invalid_reward_lifecycle_confirmation'; end if;
    else
      if p_lifecycle->'activationNotBefore'<>'null'::jsonb
        or p_lifecycle->>'claimDeadline' is distinct from ((p_lifecycle->>'blockTimestamp')::numeric+31536000)::text
        or (p_lifecycle->>'blockTimestamp')::numeric<(predecessor->>'activationNotBefore')::numeric
        or a->>'activationNotBefore' is distinct from predecessor->>'activationNotBefore'
        or (a->>'claimDeadline')::numeric<(p_lifecycle->>'claimDeadline')::numeric or a->>'state' not in ('3','4') then
        raise exception using errcode='22023',message='invalid_reward_lifecycle_confirmation'; end if;
    end if;
  end if;
  checkpoint:=public.service_record_reward_campaign_checkpoint(c.id,p_actor_user_id,d.intent_id,d.attempt_id,'lifecycle-job:'||j.id::text,p_deployment,p_observation);
  insert into app_private.reward_lifecycle_confirmations(job_id,observation_id,lifecycle_body,confirmed_by_user_id)
    values(j.id,(checkpoint->>'observationId')::uuid,p_lifecycle,p_actor_user_id);
  update app_private.reward_lifecycle_jobs set state='confirmed',may_have_broadcast=true,confirmation_observation_id=(checkpoint->>'observationId')::uuid,
    lease_owner=null,lease_token=null,lease_expires_at=null where id=j.id returning * into j;
  insert into app_private.reward_lifecycle_job_events(job_id,kind,actor_user_id,worker_id,lease_generation) values(j.id,'confirmed',p_actor_user_id,p_worker_id,j.lease_generation);
  return app_private.reward_lifecycle_job_document(j);
end $$;
create function public.service_read_reward_lifecycle_job(p_job_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare j app_private.reward_lifecycle_jobs%rowtype; programme uuid;
begin
  select * into j from app_private.reward_lifecycle_jobs where id=p_job_id;
  select programme_id into programme from app_private.reward_campaigns where id=j.campaign_id;
  perform app_private.require_reward_operator(programme,p_actor_user_id);
  return app_private.reward_lifecycle_job_document(j);
end $$;
create function public.service_step_reward_lifecycle_job(p_job_id uuid,p_actor_user_id uuid,p_worker_id uuid,p_lease_token uuid,p_action text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare j app_private.reward_lifecycle_jobs%rowtype; i app_private.reward_lifecycle_intents%rowtype; programme uuid; event_kind text; predecessor jsonb; evidence jsonb;
begin
  select * into j from app_private.reward_lifecycle_jobs where id=p_job_id;
  select programme_id into programme from app_private.reward_campaigns where id=j.campaign_id;
  perform app_private.require_reward_operator(programme,p_actor_user_id);
  if p_worker_id is null or p_action is null or p_action not in ('lease','arm','submitted') then
    raise exception using errcode='22023',message='invalid_reward_lifecycle_job'; end if;
  select * into i from app_private.reward_lifecycle_intents where id=j.intent_id;
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||i.chain_id::text||':'||i.operator_address,0));
  perform id from app_private.reward_programmes where id=programme for update;
  select * into j from app_private.reward_lifecycle_jobs where id=p_job_id for update;
  perform app_private.require_reward_operator(programme,p_actor_user_id);
  if j.state='confirmed' then return app_private.reward_lifecycle_job_document(j); end if;
  if p_action='lease' then
    if p_lease_token is not null then raise exception using errcode='22023',message='invalid_reward_lifecycle_job'; end if;
    if j.lease_expires_at>clock_timestamp() then
      if j.lease_owner=p_worker_id then return app_private.reward_lifecycle_job_document(j); else return null; end if;
    end if;
    if app_private.reward_operator_job_busy(i.chain_id,i.operator_address,'lifecycle',j.id) then return null; end if;
    update app_private.reward_lifecycle_jobs set state='leased',lease_owner=p_worker_id,lease_token=gen_random_uuid(),
      lease_expires_at=clock_timestamp()+interval '60 seconds',lease_generation=lease_generation+1 where id=j.id returning * into j;
    event_kind:='leased';
  else
    if p_lease_token is null or j.lease_token is distinct from p_lease_token or j.lease_owner is distinct from p_worker_id
      or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then
      raise exception using errcode='22023',message='reward_lifecycle_job_lease_lost'; end if;
    if p_action='arm' then
      predecessor:=app_private.reward_lifecycle_predecessor(i.id);
      if (predecessor->>'fundingJobId')::uuid is distinct from j.predecessor_funding_job_id
        or (predecessor->>'lifecycleJobId')::uuid is distinct from j.predecessor_lifecycle_job_id then
        raise exception using errcode='22023',message='reward_lifecycle_predecessor_mismatch'; end if;
      evidence:=public.service_check_reward_upload_evidence(j.campaign_id,p_actor_user_id,j.upload_id);
      if i.action='activate' and floor(extract(epoch from clock_timestamp()))<(evidence->>'sourceReviewEndsAt')::numeric then
        raise exception using errcode='55000',message='reward_lifecycle_review_not_finished'; end if;
    end if;
    -- Pending/mined reconciliation is allowed after evidence changes. Only arm
    -- authorizes a new send; current actor/lease still gate every transition.
    update app_private.reward_lifecycle_jobs set state=case p_action when 'arm' then 'broadcasting' else 'submitted' end,may_have_broadcast=true
      where id=j.id returning * into j;
    event_kind:=case p_action when 'arm' then 'armed' else 'submitted' end;
  end if;
  insert into app_private.reward_lifecycle_job_events(job_id,kind,actor_user_id,worker_id,lease_generation)
    values(j.id,event_kind,p_actor_user_id,p_worker_id,j.lease_generation);
  return app_private.reward_lifecycle_job_document(j);
end $$;
revoke all on function app_private.protect_reward_lifecycle_job(),app_private.reward_lifecycle_job_document(app_private.reward_lifecycle_jobs),
  app_private.reward_lifecycle_predecessor(uuid),public.service_queue_reward_lifecycle_job(uuid,uuid,uuid,uuid,uuid,text),
  public.service_read_reward_lifecycle_job(uuid,uuid),public.service_step_reward_lifecycle_job(uuid,uuid,uuid,uuid,text),
  public.service_confirm_reward_lifecycle_job(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.protect_reward_lifecycle_job(),app_private.reward_lifecycle_job_document(app_private.reward_lifecycle_jobs),
  app_private.reward_lifecycle_predecessor(uuid),public.service_queue_reward_lifecycle_job(uuid,uuid,uuid,uuid,uuid,text),
  public.service_read_reward_lifecycle_job(uuid,uuid),public.service_step_reward_lifecycle_job(uuid,uuid,uuid,uuid,text),
  public.service_confirm_reward_lifecycle_job(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb) to service_role;
commit;
