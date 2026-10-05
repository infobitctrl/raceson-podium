begin;
create table app_private.reward_deployment_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references app_private.reward_campaigns(id) on delete restrict,
  intent_id uuid not null unique references app_private.reward_deployment_intents(id) on delete restrict,
  attempt_id uuid not null unique references app_private.reward_deployment_attempts(id) on delete restrict,
  transaction_hash app_private.reward_bytes32 not null,
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
  check(state<>'confirmed' or lease_owner is null)
);
create index reward_deployment_job_confirmation on app_private.reward_deployment_jobs(confirmation_observation_id) where confirmation_observation_id is not null;
create table app_private.reward_deployment_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references app_private.reward_deployment_jobs(id) on delete restrict,
  kind text not null check(kind in ('queued','leased','armed','submitted','confirmed')),
  actor_user_id uuid not null,
  worker_id uuid,
  lease_generation integer not null check(lease_generation>=0),
  recorded_at timestamptz not null default clock_timestamp()
);
create index reward_deployment_job_event_lookup on app_private.reward_deployment_job_events(job_id,recorded_at,id);

alter table app_private.reward_deployment_jobs enable row level security;
alter table app_private.reward_deployment_job_events enable row level security;
revoke all on app_private.reward_deployment_jobs,app_private.reward_deployment_job_events from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_deployment_jobs,app_private.reward_deployment_job_events to service_role;
grant update(state,may_have_broadcast,lease_owner,lease_token,lease_expires_at,lease_generation,confirmation_observation_id)
  on app_private.reward_deployment_jobs to service_role;
create policy reward_deployment_jobs_select on app_private.reward_deployment_jobs for select to service_role using(true);
create policy reward_deployment_jobs_insert on app_private.reward_deployment_jobs for insert to service_role with check(true);
create policy reward_deployment_jobs_update on app_private.reward_deployment_jobs for update to service_role using(true) with check(true);
create policy reward_deployment_events_select on app_private.reward_deployment_job_events for select to service_role using(true);
create policy reward_deployment_events_insert on app_private.reward_deployment_job_events for insert to service_role with check(true);
create trigger reward_job_events_immutable before update or delete on app_private.reward_deployment_job_events
  for each row execute function app_private.reject_reward_ledger_mutation();
create function app_private.protect_reward_deployment_job() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception using errcode='22023',message='reward_job_identity_is_immutable'; end if;
  if (new.id,new.campaign_id,new.intent_id,new.attempt_id,new.transaction_hash,new.created_by_user_id,new.created_at,new.idempotency_key)
    is distinct from (old.id,old.campaign_id,old.intent_id,old.attempt_id,old.transaction_hash,old.created_by_user_id,old.created_at,old.idempotency_key)
    or (old.may_have_broadcast and not new.may_have_broadcast) or new.lease_generation<old.lease_generation
    or (old.state='confirmed' and new is distinct from old) then
    raise exception using errcode='22023',message='reward_job_identity_is_immutable'; end if;
  if new.state='confirmed' and not exists(select 1 from app_private.reward_verified_deployments d
    join app_private.reward_campaign_observations o on o.campaign_id=d.campaign_id
    where d.campaign_id=new.campaign_id and d.intent_id=new.intent_id and d.attempt_id=new.attempt_id and o.id=new.confirmation_observation_id) then
    raise exception using errcode='22023',message='reward_job_deployment_not_verified'; end if;
  return new;
end $$;
create trigger reward_job_identity before update or delete on app_private.reward_deployment_jobs
  for each row execute function app_private.protect_reward_deployment_job();
create function app_private.reward_deployment_job_document(j app_private.reward_deployment_jobs)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('jobId',j.id,'campaignId',j.campaign_id,'intentId',j.intent_id,'attemptId',j.attempt_id,
    'transactionHash','0x'||encode(j.transaction_hash,'hex'),'createdByUserId',j.created_by_user_id,'createdAt',j.created_at,'idempotencyKey',j.idempotency_key,
    'state',j.state,'mayHaveBroadcast',j.may_have_broadcast,'leaseOwner',j.lease_owner,'leaseToken',j.lease_token,
    'leaseExpiresAt',j.lease_expires_at,'leaseGeneration',j.lease_generation,'confirmationObservationId',j.confirmation_observation_id);
$$;
create function public.service_queue_reward_deployment_job(p_campaign_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_attempt_id uuid,p_idempotency_key text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_campaigns%rowtype; a app_private.reward_deployment_attempts%rowtype; j app_private.reward_deployment_jobs%rowtype;
begin
  select * into c from app_private.reward_campaigns where id=p_campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  perform id from app_private.reward_programmes where id=c.programme_id for update;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception using errcode='22023',message='invalid_reward_deployment_job'; end if;
  if not exists(select 1 from app_private.reward_deployment_intents where id=p_intent_id and campaign_id=c.id) then
    raise exception using errcode='22023',message='reward_deployment_intent_mismatch'; end if;
  select * into a from app_private.reward_deployment_attempts where id=p_attempt_id and intent_id=p_intent_id;
  if not found then raise exception using errcode='22023',message='reward_deployment_attempt_mismatch'; end if;
  select * into j from app_private.reward_deployment_jobs where campaign_id=c.id;
  if found then
    if j.intent_id<>p_intent_id or j.attempt_id<>p_attempt_id or j.created_by_user_id<>p_actor_user_id or j.idempotency_key<>p_idempotency_key then
      raise exception using errcode='22023',message='reward_deployment_job_already_queued'; end if;
  else
    insert into app_private.reward_deployment_jobs(campaign_id,intent_id,attempt_id,transaction_hash,created_by_user_id,idempotency_key)
      values(c.id,p_intent_id,a.id,a.transaction_hash,p_actor_user_id,p_idempotency_key) returning * into j;
    insert into app_private.reward_deployment_job_events(job_id,kind,actor_user_id,lease_generation) values(j.id,'queued',p_actor_user_id,0);
  end if;
  return app_private.reward_deployment_job_document(j);
end $$;
create function public.service_read_reward_deployment_job(p_job_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare j app_private.reward_deployment_jobs%rowtype; programme uuid;
begin
  select * into j from app_private.reward_deployment_jobs where id=p_job_id;
  select programme_id into programme from app_private.reward_campaigns where id=j.campaign_id;
  perform app_private.require_reward_operator(programme,p_actor_user_id);
  return app_private.reward_deployment_job_document(j);
end $$;
create function public.service_step_reward_deployment_job(p_job_id uuid,p_actor_user_id uuid,p_worker_id uuid,p_lease_token uuid,p_action text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare j app_private.reward_deployment_jobs%rowtype; i app_private.reward_deployment_intents%rowtype; programme uuid; event_kind text; observed uuid;
begin
  select * into j from app_private.reward_deployment_jobs where id=p_job_id;
  select programme_id into programme from app_private.reward_campaigns where id=j.campaign_id;
  perform app_private.require_reward_operator(programme,p_actor_user_id);
  if p_worker_id is null or p_action is null or p_action not in ('lease','arm','submitted','confirm') then
    raise exception using errcode='22023',message='invalid_reward_deployment_job'; end if;
  select * into i from app_private.reward_deployment_intents where id=j.intent_id;
  -- The same chain/signer order used by nonce preparation, then programme/job.
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||i.chain_id::text||':'||i.operator_address,0));
  perform id from app_private.reward_programmes where id=programme for update;
  select * into j from app_private.reward_deployment_jobs where id=p_job_id for update;
  perform app_private.require_reward_operator(programme,p_actor_user_id);
  if j.state='confirmed' then return app_private.reward_deployment_job_document(j); end if;
  if p_action='lease' then
    if p_lease_token is not null then raise exception using errcode='22023',message='invalid_reward_deployment_job'; end if;
    if j.lease_expires_at>clock_timestamp() then
      if j.lease_owner=p_worker_id then return app_private.reward_deployment_job_document(j); else return null; end if;
    end if;
    if exists(select 1 from app_private.reward_deployment_jobs other join app_private.reward_deployment_intents oi on oi.id=other.intent_id
      where other.id<>j.id and oi.chain_id=i.chain_id and oi.operator_address=i.operator_address and other.lease_expires_at>clock_timestamp()) then return null; end if;
    update app_private.reward_deployment_jobs set state='leased',lease_owner=p_worker_id,lease_token=gen_random_uuid(),
      lease_expires_at=clock_timestamp()+interval '60 seconds',lease_generation=lease_generation+1 where id=j.id returning * into j;
    event_kind:='leased';
  else
    if p_lease_token is null or j.lease_token is distinct from p_lease_token or j.lease_owner is distinct from p_worker_id
      or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then
      raise exception using errcode='22023',message='reward_deployment_job_lease_lost'; end if;
    if p_action='confirm' then
      select o.id into observed from app_private.reward_verified_deployments d join app_private.reward_campaign_observations o on o.campaign_id=d.campaign_id
        where d.campaign_id=j.campaign_id and d.intent_id=j.intent_id and d.attempt_id=j.attempt_id
        order by o.finalized_block_number desc,o.observed_at desc,o.id desc limit 1;
      if not found then raise exception using errcode='22023',message='reward_job_deployment_not_verified'; end if;
      update app_private.reward_deployment_jobs set state='confirmed',confirmation_observation_id=observed,
        lease_owner=null,lease_token=null,lease_expires_at=null where id=j.id returning * into j;
      event_kind:='confirmed';
    else
      update app_private.reward_deployment_jobs set state=case p_action when 'arm' then 'broadcasting' else 'submitted' end,
        may_have_broadcast=true where id=j.id returning * into j;
      event_kind:=case p_action when 'arm' then 'armed' else 'submitted' end;
    end if;
  end if;
  insert into app_private.reward_deployment_job_events(job_id,kind,actor_user_id,worker_id,lease_generation)
    values(j.id,event_kind,p_actor_user_id,p_worker_id,j.lease_generation);
  return app_private.reward_deployment_job_document(j);
end $$;
revoke all on function app_private.protect_reward_deployment_job(),app_private.reward_deployment_job_document(app_private.reward_deployment_jobs),
  public.service_queue_reward_deployment_job(uuid,uuid,uuid,uuid,text),public.service_read_reward_deployment_job(uuid,uuid),
  public.service_step_reward_deployment_job(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_private.protect_reward_deployment_job(),app_private.reward_deployment_job_document(app_private.reward_deployment_jobs),
  public.service_queue_reward_deployment_job(uuid,uuid,uuid,uuid,text),public.service_read_reward_deployment_job(uuid,uuid),
  public.service_step_reward_deployment_job(uuid,uuid,uuid,uuid,text) to service_role;
commit;
