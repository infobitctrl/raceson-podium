begin;

create table app_private.reward_programme_jobs_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  intent_id uuid not null unique references app_private.reward_programme_deployment_intents_v3(id),
  attempt_id uuid not null unique,
  transaction_hash app_private.reward_bytes32 not null,
  created_by_user_id uuid not null references public.user_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  state text not null default 'queued' check(state in('queued','leased','broadcasting','submitted','confirmed')),
  may_have_broadcast boolean not null default false,
  lease_owner uuid, lease_token uuid, lease_expires_at timestamptz,
  lease_generation integer not null default 0 check(lease_generation>=0),
  foreign key(attempt_id,intent_id,transaction_hash) references app_private.reward_programme_attempts_v3(id,intent_id,transaction_hash),
  unique(id,intent_id,attempt_id,transaction_hash),
  check((lease_owner is null)=(lease_token is null) and (lease_owner is null)=(lease_expires_at is null)),
  check(state<>'confirmed' or lease_owner is null),
  check(state not in('broadcasting','submitted') or may_have_broadcast),
  check(state<>'queued' or (lease_owner is null and lease_generation=0 and not may_have_broadcast)),
  check(state not in('leased','broadcasting','submitted') or (lease_owner is not null and lease_generation>0))
);
create table app_private.reward_programme_registry_v3 (
  job_id uuid primary key,
  intent_id uuid not null unique,
  attempt_id uuid not null unique,
  transaction_hash app_private.reward_bytes32 not null,
  provenance jsonb not null check(jsonb_typeof(provenance)='object'),
  recorded_by_user_id uuid not null references public.user_profiles(user_id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key(job_id,intent_id,attempt_id,transaction_hash)
    references app_private.reward_programme_jobs_v3(id,intent_id,attempt_id,transaction_hash)
);
create table app_private.reward_programme_job_events_v3 (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references app_private.reward_programme_jobs_v3(id),
  kind text not null check(kind in('queued','leased','armed','submitted','confirmed')),
  actor_user_id uuid not null references public.user_profiles(user_id),
  worker_id uuid, lease_generation integer not null check(lease_generation>=0),
  recorded_at timestamptz not null default clock_timestamp()
);
create index reward_programme_job_events_v3_lookup on app_private.reward_programme_job_events_v3(job_id,recorded_at,id);
alter table app_private.reward_programme_jobs_v3 enable row level security;
alter table app_private.reward_programme_registry_v3 enable row level security;
alter table app_private.reward_programme_job_events_v3 enable row level security;
revoke all on app_private.reward_programme_jobs_v3,app_private.reward_programme_registry_v3,app_private.reward_programme_job_events_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_programme_jobs_v3,app_private.reward_programme_registry_v3,app_private.reward_programme_job_events_v3 to service_role;
grant update(state,may_have_broadcast,lease_owner,lease_token,lease_expires_at,lease_generation) on app_private.reward_programme_jobs_v3 to service_role;
create policy reward_programme_jobs_v3_select on app_private.reward_programme_jobs_v3 for select to service_role using(true);
create policy reward_programme_jobs_v3_insert on app_private.reward_programme_jobs_v3 for insert to service_role with check(true);
create policy reward_programme_jobs_v3_update on app_private.reward_programme_jobs_v3 for update to service_role using(true) with check(true);
create policy reward_programme_registry_v3_select on app_private.reward_programme_registry_v3 for select to service_role using(true);
create policy reward_programme_registry_v3_insert on app_private.reward_programme_registry_v3 for insert to service_role with check(true);
create policy reward_programme_job_events_v3_select on app_private.reward_programme_job_events_v3 for select to service_role using(true);
create policy reward_programme_job_events_v3_insert on app_private.reward_programme_job_events_v3 for insert to service_role with check(true);
create trigger reward_programme_registry_v3_immutable before update or delete on app_private.reward_programme_registry_v3
  for each row execute function app_private.reject_reward_ledger_mutation();
create trigger reward_programme_job_events_v3_immutable before update or delete on app_private.reward_programme_job_events_v3
  for each row execute function app_private.reject_reward_ledger_mutation();
create function app_private.protect_reward_programme_job_v3() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'reward_job_identity_is_immutable'; end if;
  if (new.id,new.intent_id,new.attempt_id,new.transaction_hash,new.created_by_user_id,new.created_at)
    is distinct from (old.id,old.intent_id,old.attempt_id,old.transaction_hash,old.created_by_user_id,old.created_at)
    or (old.may_have_broadcast and not new.may_have_broadcast) or new.lease_generation<old.lease_generation
    or (old.state='confirmed' and new is distinct from old) then raise exception 'reward_job_identity_is_immutable'; end if;
  if new.state='confirmed' and not exists(select 1 from app_private.reward_programme_registry_v3 r
    where r.job_id=new.id and r.intent_id=new.intent_id and r.attempt_id=new.attempt_id and r.transaction_hash=new.transaction_hash)
    then raise exception 'reward_programme_not_verified'; end if;
  return new;
end $$;
create trigger reward_programme_job_v3_identity before update or delete on app_private.reward_programme_jobs_v3
  for each row execute function app_private.protect_reward_programme_job_v3();

-- All four job kinds call this helper under the same chain/signer advisory lock.
-- Exclusion is bidirectional; a new programme cannot race legacy funding work.
create or replace function app_private.reward_operator_job_busy(p_chain integer,p_operator text,p_kind text,p_job uuid)
returns boolean language sql volatile security invoker set search_path='' as $$
  select exists(select 1 from app_private.reward_deployment_jobs j join app_private.reward_deployment_intents i on i.id=j.intent_id
    where i.chain_id=p_chain and i.operator_address=p_operator and j.lease_expires_at>clock_timestamp() and not(p_kind='deployment' and j.id=p_job))
  or exists(select 1 from app_private.reward_funding_jobs j join app_private.reward_funding_intents i on i.id=j.intent_id
    where i.chain_id=p_chain and i.operator_address=p_operator and j.lease_expires_at>clock_timestamp() and not(p_kind='funding' and j.id=p_job))
  or exists(select 1 from app_private.reward_lifecycle_jobs j join app_private.reward_lifecycle_intents i on i.id=j.intent_id
    where i.chain_id=p_chain and i.operator_address=p_operator and j.lease_expires_at>clock_timestamp() and not(p_kind='lifecycle' and j.id=p_job))
  or exists(select 1 from app_private.reward_programme_jobs_v3 j join app_private.reward_programme_deployment_intents_v3 i on i.id=j.intent_id
    where i.chain_id=p_chain and i.operator_address=p_operator and j.lease_expires_at>clock_timestamp() and not(p_kind='programme-v3' and j.id=p_job));
$$;

create function app_private.reward_programme_job_document_v3(j app_private.reward_programme_jobs_v3)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select case when j.id is not null then jsonb_build_object('jobId',j.id,'intentId',j.intent_id,'attemptId',j.attempt_id,
    'transactionHash','0x'||encode(j.transaction_hash,'hex'),'createdByUserId',j.created_by_user_id,'createdAt',j.created_at,
    'state',j.state,'mayHaveBroadcast',j.may_have_broadcast,'leaseOwner',j.lease_owner,'leaseToken',j.lease_token,
    'leaseExpiresAt',j.lease_expires_at,'leaseGeneration',j.lease_generation) end;
$$;
create function app_private.lock_reward_programme_job_scope_v3(p_actor uuid,p_session uuid,p_chain integer,p_draft uuid,p_intent uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; org uuid; signer text;
begin
  -- The full approval reader takes a draft SHARE lock. Do not call it before
  -- the signer lock: two callers could retain SHARE while one upgrades to UPDATE
  -- and the other waits for the advisory lock (an inverted-order deadlock).
  v:=public.service_read_reward_planning_draft(p_actor,p_session,p_chain,p_draft);
  select operator_address into signer from app_private.reward_programme_deployment_intents_v3
    where id=p_intent and draft_id=p_draft and chain_id=p_chain and created_by_user_id=p_actor;
  if not found then raise exception 'reward_programme_deployment_required'; end if;
  org:=(v->>'organizationId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||p_chain::text||':'||signer,0));
  perform 1 from public.organization_memberships where user_id=p_actor and organization_id=org for share;
  perform 1 from public.organizations where id=org for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft for update;
  return public.service_read_reward_programme_deployment_v3(p_actor,p_session,p_chain,p_draft);
end $$;

create function public.service_read_reward_programme_job_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,p_intent_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; j app_private.reward_programme_jobs_v3%rowtype;
begin
  v:=public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if p_intent_id is null or v->'intent'->>'id' is distinct from p_intent_id::text
    or v->'intent'->>'createdByUserId' is distinct from p_actor_user_id::text then raise exception 'reward_programme_deployment_required'; end if;
  select * into j from app_private.reward_programme_jobs_v3 where intent_id=p_intent_id;
  perform public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  return app_private.reward_programme_job_document_v3(j);
end $$;
create function public.service_queue_reward_programme_job_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_intent_id uuid,p_attempt_id uuid,p_job_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; a app_private.reward_programme_attempts_v3%rowtype; j app_private.reward_programme_jobs_v3%rowtype;
begin
  v:=app_private.lock_reward_programme_job_scope_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_intent_id);
  if p_job_id is null or p_job_id='00000000-0000-0000-0000-000000000000'::uuid then raise exception 'invalid_reward_programme_job'; end if;
  select * into a from app_private.reward_programme_attempts_v3 where id=p_attempt_id and intent_id=p_intent_id and recorded_by_user_id=p_actor_user_id;
  if not found then raise exception 'reward_programme_attempt_required'; end if;
  select * into j from app_private.reward_programme_jobs_v3 where intent_id=p_intent_id or id=p_job_id;
  if found then
    if j.id<>p_job_id or j.intent_id<>p_intent_id or j.attempt_id<>p_attempt_id or j.created_by_user_id<>p_actor_user_id
      then raise exception 'reward_programme_job_conflict'; end if;
  else
    if v->'intent'->'current' is distinct from 'true'::jsonb then raise exception 'reward_programme_approval_required'; end if;
    insert into app_private.reward_programme_jobs_v3(id,intent_id,attempt_id,transaction_hash,created_by_user_id)
      values(p_job_id,p_intent_id,p_attempt_id,a.transaction_hash,p_actor_user_id) returning * into j;
    insert into app_private.reward_programme_job_events_v3(job_id,kind,actor_user_id,lease_generation) values(j.id,'queued',p_actor_user_id,0);
    v:=public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
    if v->'intent'->'current' is distinct from 'true'::jsonb then raise exception 'reward_programme_approval_required'; end if;
  end if;
  perform public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  return app_private.reward_programme_job_document_v3(j);
end $$;

create function public.service_step_reward_programme_job_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_intent_id uuid,p_job_id uuid,p_worker_id uuid,p_lease_token uuid,p_action text,p_provenance jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; j app_private.reward_programme_jobs_v3%rowtype; a app_private.reward_programme_attempts_v3%rowtype;
  k text; event_kind text; held_deadline timestamptz; keys text[]:=array['schemaVersion','chainId','contractAddress','transactionHash','deploymentBlockNumber',
    'deploymentBlockHash','finalizedBlockNumber','finalizedBlockHash','finalizedBlockTimestamp','runtimeCodeHash','programmeId','programmeManifestHash'];
begin
  v:=app_private.lock_reward_programme_job_scope_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_intent_id);
  if p_worker_id is null or p_worker_id='00000000-0000-0000-0000-000000000000'::uuid or p_action is null
    or p_action not in('lease','arm','submitted','confirm') or (p_action='lease' and p_lease_token is not null)
    or (p_action<>'confirm' and p_provenance is not null) then raise exception 'invalid_reward_programme_job'; end if;
  select * into j from app_private.reward_programme_jobs_v3 where id=p_job_id and intent_id=p_intent_id for update;
  if not found or j.created_by_user_id<>p_actor_user_id then raise exception 'reward_programme_job_required'; end if;
  -- A job/table wait may outlive the caller's Auth session.
  v:=public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if j.state='confirmed' then return app_private.reward_programme_job_document_v3(j); end if;
  if p_action='lease' then
    if j.lease_expires_at>clock_timestamp() then
      if j.lease_owner=p_worker_id then return app_private.reward_programme_job_document_v3(j); else return null; end if;
    end if;
    if app_private.reward_operator_job_busy(p_chain_id,v->'intent'->'terms'->>'operatorAddress','programme-v3',j.id) then return null; end if;
    -- A stale job can acquire a reconciliation lease. Only arm authorizes send.
    update app_private.reward_programme_jobs_v3 set state='leased',lease_owner=p_worker_id,lease_token=gen_random_uuid(),
      lease_expires_at=clock_timestamp()+interval '60 seconds',lease_generation=lease_generation+1 where id=j.id returning * into j;
    event_kind:='leased';
  else
    if p_lease_token is null or j.lease_token is distinct from p_lease_token or j.lease_owner is distinct from p_worker_id
      or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception 'reward_programme_lease_lost'; end if;
    held_deadline:=j.lease_expires_at;
    if p_action='confirm' then
      -- The worker already verified full factory/children and canonical finality.
      -- Persist provenance atomically with terminal state; never infer from tx presence.
      select * into strict a from app_private.reward_programme_attempts_v3 where id=j.attempt_id;
      if p_provenance is null or jsonb_typeof(p_provenance)<>'object' or not(p_provenance ?& keys) or p_provenance-keys<>'{}'::jsonb
        or p_provenance->'schemaVersion' is distinct from '3'::jsonb or p_provenance->'chainId' is distinct from to_jsonb(p_chain_id)
        then raise exception 'invalid_reward_programme_provenance'; end if;
      foreach k in array keys[3:12] loop
        if jsonb_typeof(p_provenance->k)<>'string' then raise exception 'invalid_reward_programme_provenance'; end if;
      end loop;
      foreach k in array array['deploymentBlockNumber','finalizedBlockNumber','finalizedBlockTimestamp'] loop
        if p_provenance->>k !~ '^[1-9][0-9]{0,77}$' then raise exception 'invalid_reward_programme_provenance'; end if;
        perform (p_provenance->>k)::app_private.reward_uint256;
      end loop;
      foreach k in array array['transactionHash','deploymentBlockHash','finalizedBlockHash','runtimeCodeHash','programmeId','programmeManifestHash'] loop
        if p_provenance->>k !~ '^0x[0-9a-f]{64}$' or p_provenance->>k='0x'||repeat('0',64) then raise exception 'invalid_reward_programme_provenance'; end if;
      end loop;
      if p_provenance->>'transactionHash'<>'0x'||encode(j.transaction_hash,'hex') or p_provenance->>'contractAddress'<>a.body->>'contractAddress'
        or (p_provenance->>'deploymentBlockNumber')::numeric>(p_provenance->>'finalizedBlockNumber')::numeric
        then raise exception 'invalid_reward_programme_provenance'; end if;
      insert into app_private.reward_programme_registry_v3(job_id,intent_id,attempt_id,transaction_hash,provenance,recorded_by_user_id)
        values(j.id,j.intent_id,j.attempt_id,j.transaction_hash,p_provenance,p_actor_user_id);
      update app_private.reward_programme_jobs_v3 set state='confirmed',may_have_broadcast=true,
        lease_owner=null,lease_token=null,lease_expires_at=null where id=j.id returning * into j;
      event_kind:='confirmed';
    else
      if p_action='arm' and v->'intent'->'current' is distinct from 'true'::jsonb then raise exception 'reward_programme_approval_required'; end if;
      update app_private.reward_programme_jobs_v3 set state=case p_action when 'arm' then 'broadcasting' else 'submitted' end,
        may_have_broadcast=true where id=j.id returning * into j;
      event_kind:=case p_action when 'arm' then 'armed' else 'submitted' end;
    end if;
  end if;
  insert into app_private.reward_programme_job_events_v3(job_id,kind,actor_user_id,worker_id,lease_generation)
    values(j.id,event_kind,p_actor_user_id,p_worker_id,j.lease_generation);
  v:=public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if p_action='arm' and v->'intent'->'current' is distinct from 'true'::jsonb then raise exception 'reward_programme_approval_required'; end if;
  if j.state<>'confirmed' and j.lease_expires_at<=clock_timestamp() then raise exception 'reward_programme_lease_lost'; end if;
  if held_deadline is not null and held_deadline<=clock_timestamp() then raise exception 'reward_programme_lease_lost'; end if;
  return app_private.reward_programme_job_document_v3(j);
end $$;

-- Organizer read projection contains no signed bytes or worker lease tokens.
-- It can show historical provenance, but the service must hold changed approvals.
create function public.service_read_reward_programme_registry_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare v jsonb; r app_private.reward_programme_registry_v3%rowtype;
begin
  v:=public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select r0.* into r from app_private.reward_programme_registry_v3 r0 join app_private.reward_programme_jobs_v3 j on j.id=r0.job_id
    where r0.intent_id=(v->'intent'->>'id')::uuid and j.state='confirmed';
  v:=public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  return jsonb_build_object('schema','raceson-programme-registry-v3','context',v,'registry',case when r.job_id is not null then
    jsonb_build_object('jobId',r.job_id,'intentId',r.intent_id,'attemptId',r.attempt_id,'provenance',r.provenance,'recordedAt',r.recorded_at) end);
end $$;
revoke all on function app_private.protect_reward_programme_job_v3(),
  app_private.reward_programme_job_document_v3(app_private.reward_programme_jobs_v3),app_private.lock_reward_programme_job_scope_v3(uuid,uuid,integer,uuid,uuid),
  public.service_read_reward_programme_job_v3(uuid,uuid,integer,uuid,uuid),public.service_queue_reward_programme_job_v3(uuid,uuid,integer,uuid,uuid,uuid,uuid),
  public.service_step_reward_programme_job_v3(uuid,uuid,integer,uuid,uuid,uuid,uuid,uuid,text,jsonb),
  public.service_read_reward_programme_registry_v3(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.protect_reward_programme_job_v3(),
  app_private.reward_programme_job_document_v3(app_private.reward_programme_jobs_v3),app_private.lock_reward_programme_job_scope_v3(uuid,uuid,integer,uuid,uuid),
  public.service_read_reward_programme_job_v3(uuid,uuid,integer,uuid,uuid),public.service_queue_reward_programme_job_v3(uuid,uuid,integer,uuid,uuid,uuid,uuid),
  public.service_step_reward_programme_job_v3(uuid,uuid,integer,uuid,uuid,uuid,uuid,uuid,text,jsonb),
  public.service_read_reward_programme_registry_v3(uuid,uuid,integer,uuid) to service_role;
-- Correct the same pre-lock reader inversion in the already-applied attempt
-- recorder additively; preserve its immutable migration and every other check.
create or replace function public.service_record_reward_programme_attempt_v3(p_actor_user_id uuid,p_actor_session_id uuid,
  p_chain_id integer,p_draft_id uuid,p_intent_id uuid,p_attempt_id uuid,p_body jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare v jsonb; i app_private.reward_programme_deployment_intents_v3%rowtype;
  a app_private.reward_programme_attempts_v3%rowtype; org uuid; k text;
  keys text[]:=array['schemaVersion','chainId','operatorAddress','nonce','contractAddress','transactionHash','signedTransaction',
    'creationCodeHash','calldataHash','gasLimit','maxFeePerGas','maxPriorityFeePerGas','maximumGasCostWei'];
begin
  -- Resolve authority/signer without taking the approval reader's draft SHARE
  -- lock. Acquire signer first, then organization and draft, as reservations do.
  v:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select * into i from app_private.reward_programme_deployment_intents_v3
    where id=p_intent_id and draft_id=p_draft_id and chain_id=p_chain_id and created_by_user_id=p_actor_user_id;
  if not found then raise exception 'reward_programme_deployment_required'; end if;
  org:=(v->>'organizationId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||p_chain_id::text||':'||i.operator_address,0));
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=org for share;
  perform 1 from public.organizations where id=org for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  v:=public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);

  -- SQL validates transport/scope; the trusted service verifies the signature,
  -- exact pinned constructor and keccak hashes before recording AND on reload.
  if p_attempt_id is null or p_attempt_id='00000000-0000-0000-0000-000000000000'::uuid or p_body is null
    or jsonb_typeof(p_body)<>'object' or not(p_body ?& keys) or p_body-keys<>'{}'::jsonb
    or p_body->'schemaVersion' is distinct from '3'::jsonb or p_body->'chainId' is distinct from to_jsonb(p_chain_id)
    then raise exception 'invalid_reward_programme_attempt'; end if;
  foreach k in array keys[3:13] loop
    if jsonb_typeof(p_body->k)<>'string' then raise exception 'invalid_reward_programme_attempt'; end if;
  end loop;
  foreach k in array array['nonce','gasLimit','maxFeePerGas','maxPriorityFeePerGas','maximumGasCostWei'] loop
    if p_body->>k !~ '^(0|[1-9][0-9]{0,77})$' then raise exception 'invalid_reward_programme_attempt'; end if;
    perform (p_body->>k)::app_private.reward_uint256;
  end loop;
  foreach k in array array['transactionHash','creationCodeHash','calldataHash'] loop
    if p_body->>k !~ '^0x[0-9a-f]{64}$' or p_body->>k='0x'||repeat('0',64) then raise exception 'invalid_reward_programme_attempt'; end if;
  end loop;
  if p_body->>'operatorAddress'<>i.operator_address or p_body->>'nonce'<>i.nonce::text
    or p_body->>'maximumGasCostWei'<>i.maximum_gas_cost_wei::text
    or p_body->>'creationCodeHash'<>'0x'||encode(i.creation_code_hash,'hex')
    or p_body->>'contractAddress' !~ '^0x[0-9a-f]{40}$' or p_body->>'contractAddress'='0x'||repeat('0',40)
    or length(p_body->>'signedTransaction')>131074 or p_body->>'signedTransaction' !~ '^0x02([0-9a-f]{2})+$'
    or (p_body->>'gasLimit')::numeric not between 1 and 30000000
    or (p_body->>'maxFeePerGas')::numeric=0
    or (p_body->>'maxPriorityFeePerGas')::numeric>(p_body->>'maxFeePerGas')::numeric
    or (p_body->>'gasLimit')::numeric*(p_body->>'maxFeePerGas')::numeric>i.maximum_gas_cost_wei
    then raise exception 'invalid_reward_programme_attempt'; end if;
  select * into a from app_private.reward_programme_attempts_v3 where intent_id=p_intent_id or id=p_attempt_id;
  if found then
    if a.id<>p_attempt_id or a.intent_id<>p_intent_id or a.body<>p_body or a.recorded_by_user_id<>p_actor_user_id
      then raise exception 'reward_programme_attempt_conflict'; end if;
  else
    if v->'intent'->'current' is distinct from 'true'::jsonb then raise exception 'reward_programme_approval_required'; end if;
    insert into app_private.reward_programme_attempts_v3(id,intent_id,chain_id,operator_address,nonce,transaction_hash,body,recorded_by_user_id)
      values(p_attempt_id,i.id,i.chain_id,i.operator_address,i.nonce,decode(substr(p_body->>'transactionHash',3),'hex'),p_body,p_actor_user_id) returning * into a;
    v:=public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
    if v->'intent'->'current' is distinct from 'true'::jsonb then raise exception 'reward_programme_approval_required'; end if;
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,org) then raise exception 'reward_planning_not_found'; end if;
  -- No signed bytes in the recording acknowledgement.
  return jsonb_build_object('attemptId',a.id,'intentId',a.intent_id,'transactionHash','0x'||encode(a.transaction_hash,'hex'),
    'recordedByUserId',a.recorded_by_user_id,'recordedAt',a.recorded_at);
end $$;

commit;
