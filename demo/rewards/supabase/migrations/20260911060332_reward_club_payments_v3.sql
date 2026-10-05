-- Isolated demo only. Dedicated original-Safe club policy; shared relayer nonce/lease lane.
begin;
create table app_private.reward_club_payments_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  claim_id uuid not null unique references app_private.reward_club_claims_v3(id),
  chain_id integer not null check(chain_id in(31337,10143)),
  relayer_address app_private.reward_address not null,
  nonce app_private.reward_uint256 not null check(nonce<=9007199254740991),
  fees jsonb not null check(jsonb_typeof(fees)='object' and octet_length(fees::text)<2000),
  witness jsonb not null check(jsonb_typeof(witness)='object' and octet_length(witness::text)<6000),
  created_by_user_id uuid not null references public.user_profiles(user_id),
  created_session_id uuid not null, created_at timestamptz not null default clock_timestamp(),
  unique(id,chain_id,relayer_address,nonce)
);
create index reward_club_payments_v3_actor on app_private.reward_club_payments_v3(created_by_user_id);
create index reward_club_payments_v3_nonce_scope on app_private.reward_club_payments_v3(chain_id,relayer_address,nonce,id);
alter table app_private.reward_relayer_nonce_slots add column club_payment_v3_id uuid unique;
alter table app_private.reward_relayer_nonce_slots drop constraint reward_relayer_exactly_one_owner;
alter table app_private.reward_relayer_nonce_slots add constraint reward_relayer_exactly_one_owner
  check(num_nonnulls(athlete_payment_intent_id,club_payment_intent_id,athlete_payment_v3_id,club_payment_v3_id)=1);
alter table app_private.reward_relayer_nonce_slots add constraint reward_relayer_club_v3_scope unique(chain_id,relayer_address,nonce,club_payment_v3_id);
alter table app_private.reward_relayer_nonce_slots add constraint reward_relayer_club_v3_owner foreign key(club_payment_v3_id,chain_id,relayer_address,nonce)
  references app_private.reward_club_payments_v3(id,chain_id,relayer_address,nonce);
create index reward_relayer_club_v3_owner_scope on app_private.reward_relayer_nonce_slots(club_payment_v3_id,chain_id,relayer_address,nonce);
alter table app_private.reward_club_payments_v3 add constraint reward_club_payment_v3_nonce_required
  foreign key(chain_id,relayer_address,nonce,id) references app_private.reward_relayer_nonce_slots(chain_id,relayer_address,nonce,club_payment_v3_id)
  deferrable initially deferred;
create function app_private.record_reward_club_payment_nonce_v3() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  insert into app_private.reward_relayer_nonce_slots(chain_id,relayer_address,nonce,club_payment_v3_id)
    values(new.chain_id,new.relayer_address,new.nonce,new.id); return new;
end $$;
create trigger reward_club_payment_v3_nonce after insert on app_private.reward_club_payments_v3
  for each row execute function app_private.record_reward_club_payment_nonce_v3();

create table app_private.reward_club_payment_attempts_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  payment_id uuid not null unique references app_private.reward_club_payments_v3(id),
  transaction_hash app_private.reward_bytes32 not null unique,
  body jsonb not null check(jsonb_typeof(body)='object' and octet_length(body::text)<32000),
  created_by_user_id uuid not null references public.user_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(), unique(id,payment_id,transaction_hash)
);
create index reward_club_payment_attempts_v3_actor on app_private.reward_club_payment_attempts_v3(created_by_user_id);
create table app_private.reward_club_payment_jobs_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  payment_id uuid not null unique references app_private.reward_club_payments_v3(id),
  attempt_id uuid not null unique, transaction_hash app_private.reward_bytes32 not null,
  created_by_user_id uuid not null references public.user_profiles(user_id), created_at timestamptz not null default clock_timestamp(),
  state text not null default 'queued' check(state in('queued','leased','broadcasting','submitted','confirmed')),
  may_have_broadcast boolean not null default false,
  lease_owner uuid,lease_token uuid,lease_expires_at timestamptz,lease_generation integer not null default 0 check(lease_generation>=0),
  foreign key(attempt_id,payment_id,transaction_hash) references app_private.reward_club_payment_attempts_v3(id,payment_id,transaction_hash),
  unique(id,payment_id,attempt_id,transaction_hash),
  check((lease_owner is null)=(lease_token is null) and (lease_owner is null)=(lease_expires_at is null)),
  check(state<>'confirmed' or (lease_owner is null and may_have_broadcast)),
  check(state not in('broadcasting','submitted') or may_have_broadcast),
  check(state<>'queued' or (lease_owner is null and lease_generation=0 and not may_have_broadcast)),
  check(state not in('leased','broadcasting','submitted') or (lease_owner is not null and lease_generation>0))
);
create index reward_club_payment_jobs_v3_actor on app_private.reward_club_payment_jobs_v3(created_by_user_id);
create index reward_club_payment_jobs_v3_attempt_scope on app_private.reward_club_payment_jobs_v3(attempt_id,payment_id,transaction_hash);
create table app_private.reward_club_payment_receipts_v3 (
  job_id uuid primary key,payment_id uuid not null unique,attempt_id uuid not null unique,transaction_hash app_private.reward_bytes32 not null,
  chain_id integer not null,campaign_address app_private.reward_address not null,entitlement_id app_private.reward_bytes32 not null,
  body jsonb not null check(jsonb_typeof(body)='object' and octet_length(body::text)<16000),
  recorded_by_user_id uuid not null references public.user_profiles(user_id),recorded_at timestamptz not null default clock_timestamp(),
  unique(chain_id,campaign_address,entitlement_id),
  foreign key(job_id,payment_id,attempt_id,transaction_hash) references app_private.reward_club_payment_jobs_v3(id,payment_id,attempt_id,transaction_hash)
);
create index reward_club_payment_receipts_v3_actor on app_private.reward_club_payment_receipts_v3(recorded_by_user_id);
create index reward_club_payment_receipts_v3_job_scope on app_private.reward_club_payment_receipts_v3(job_id,payment_id,attempt_id,transaction_hash);
create table app_private.reward_club_payment_events_v3 (
  id uuid primary key default gen_random_uuid(),job_id uuid not null references app_private.reward_club_payment_jobs_v3(id),
  kind text not null check(kind in('queued','leased','armed','submitted','confirmed')),actor_user_id uuid not null references public.user_profiles(user_id),
  worker_id uuid,lease_generation integer not null,recorded_at timestamptz not null default clock_timestamp(),
  execution jsonb check(execution is null or octet_length(execution::text)<16000),check((kind='armed')=(execution is not null))
);
create index reward_club_payment_events_v3_lookup on app_private.reward_club_payment_events_v3(job_id,recorded_at,id);
create index reward_club_payment_events_v3_actor on app_private.reward_club_payment_events_v3(actor_user_id);
do $$ declare n text; begin
  foreach n in array array['reward_club_payments_v3','reward_club_payment_attempts_v3','reward_club_payment_jobs_v3','reward_club_payment_receipts_v3','reward_club_payment_events_v3'] loop
    execute format('alter table app_private.%I enable row level security',n);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',n);
    execute format('grant select,insert on app_private.%I to service_role',n);
    execute format('create policy %I on app_private.%I for select to service_role using(true)',n||'_read',n);
    execute format('create policy %I on app_private.%I for insert to service_role with check(true)',n||'_insert',n);
    if n<>'reward_club_payment_jobs_v3' then
      execute format('create trigger reward_club_payment_v3_immutable before update or delete on app_private.%I for each row execute function app_private.reject_reward_ledger_mutation()',n);
    end if;
  end loop;
end $$;
grant update(state,may_have_broadcast,lease_owner,lease_token,lease_expires_at,lease_generation) on app_private.reward_club_payment_jobs_v3 to service_role;
create policy reward_club_payment_jobs_v3_update on app_private.reward_club_payment_jobs_v3 for update to service_role using(true) with check(true);
create function app_private.protect_reward_club_payment_job_v3() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'reward_job_identity_is_immutable'; end if;
  if (new.id,new.payment_id,new.attempt_id,new.transaction_hash,new.created_by_user_id,new.created_at)
    is distinct from (old.id,old.payment_id,old.attempt_id,old.transaction_hash,old.created_by_user_id,old.created_at)
    or (old.may_have_broadcast and not new.may_have_broadcast) or new.lease_generation<old.lease_generation
    or (old.state='confirmed' and new is distinct from old) then raise exception 'reward_job_identity_is_immutable'; end if;
  if new.state='confirmed' and not exists(select 1 from app_private.reward_club_payment_receipts_v3 r
    where r.job_id=new.id and r.payment_id=new.payment_id and r.attempt_id=new.attempt_id and r.transaction_hash=new.transaction_hash)
    then raise exception 'reward_payment_receipt_required'; end if; return new;
end $$;
create trigger reward_club_payment_job_v3_identity before update or delete on app_private.reward_club_payment_jobs_v3
  for each row execute function app_private.protect_reward_club_payment_job_v3();
-- Existing club/club workers call this helper too: exclusion is bidirectional.
create or replace function app_private.reward_relayer_lane_busy(p_chain integer,p_signer text,p_kind text,p_job uuid)
returns boolean language sql volatile security invoker set search_path='' as $$
  select exists(
    select 1 from app_private.reward_athlete_payment_jobs j join app_private.reward_athlete_payment_intents i on i.id=j.payment_intent_id
      where i.chain_id=p_chain and i.relayer_address=p_signer and (p_kind<>'athlete' or j.id<>p_job) and j.lease_expires_at>clock_timestamp()
    union all select 1 from app_private.reward_club_payment_jobs j join app_private.reward_club_payment_intents i on i.id=j.payment_intent_id
      where i.chain_id=p_chain and i.relayer_address=p_signer and (p_kind<>'club' or j.id<>p_job) and j.lease_expires_at>clock_timestamp()
    union all select 1 from app_private.reward_athlete_payment_jobs_v3 j join app_private.reward_athlete_payments_v3 i on i.id=j.payment_id
      where i.chain_id=p_chain and i.relayer_address=p_signer and (p_kind<>'athlete-v3' or j.id<>p_job) and j.lease_expires_at>clock_timestamp()
    union all select 1 from app_private.reward_club_payment_jobs_v3 j join app_private.reward_club_payments_v3 i on i.id=j.payment_id
      where i.chain_id=p_chain and i.relayer_address=p_signer and (p_kind<>'club-v3' or j.id<>p_job) and j.lease_expires_at>clock_timestamp());
$$;
create function app_private.require_reward_club_payment_ready_v3(c jsonb,w jsonb,observed_at timestamptz)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare i jsonb:=c->'intent';f jsonb:=w->'finalizedBlock';prior jsonb;
begin
  if i='null'::jsonb or c#>>'{readiness,state}' is distinct from 'reviewed'
    or c#>'{readiness,review,id}' is distinct from i->'reviewId'
    or c#>'{readiness,identityFingerprint}' is distinct from i->'identityFingerprint'
    or c#>'{readiness,source,sourceGuardHash}' is distinct from i->'sourceGuardHash'
    then raise exception 'reward_claim_readiness_required'; end if;
  if jsonb_array_length(c->'proofs')<>2 then raise exception 'reward_payment_approvals_required'; end if;
  perform app_private.require_reward_club_claim_witness_v3(c,w,observed_at);
  if w->'entitlementId' is distinct from i->'entitlementId' or w->'nonce' is distinct from i->'nonce'
    or w->'treasury' is distinct from i#>'{witness,treasury}'
    or (f->>'timestamp')::numeric<(i->>'issuedAt')::numeric or (f->>'timestamp')::numeric>=(i->>'expiresAt')::numeric
    then raise exception 'reward_claim_window_unavailable'; end if;
  for prior in select i->'witness'->'finalizedBlock' union all select value->'witness'->'finalizedBlock' from jsonb_array_elements(c->'proofs') loop
    if (f->>'number')::numeric<(prior->>'number')::numeric or (f->>'timestamp')::numeric<(prior->>'timestamp')::numeric
      or (f->>'number'=prior->>'number' and f is distinct from prior) then raise exception 'reward_claim_observation_regressed'; end if;
  end loop;
end $$;

create function public.service_read_reward_club_payment_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_upload_id uuid,p_request_id uuid,p_entitlement_id text,p_claim_id uuid,p_payment_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c jsonb;i app_private.reward_club_payments_v3%rowtype;a app_private.reward_club_payment_attempts_v3%rowtype;
  j app_private.reward_club_payment_jobs_v3%rowtype;r app_private.reward_club_payment_receipts_v3%rowtype;
begin
  c:=public.service_read_reward_club_claim_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_upload_id,p_request_id,p_entitlement_id,p_claim_id,'operator');
  if c->'intent'='null'::jsonb or p_payment_id is null or p_payment_id='00000000-0000-0000-0000-000000000000'::uuid then raise exception 'reward_payment_scope_required'; end if;
  select * into i from app_private.reward_club_payments_v3 where id=p_payment_id;
  if i.id is not null and (i.claim_id<>p_claim_id or i.chain_id<>p_chain_id or i.created_by_user_id<>p_actor_user_id) then raise exception 'reward_payment_scope_required'; end if;
  select * into a from app_private.reward_club_payment_attempts_v3 where payment_id=i.id;
  select * into j from app_private.reward_club_payment_jobs_v3 where payment_id=i.id;
  select * into r from app_private.reward_club_payment_receipts_v3 where job_id=j.id;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return jsonb_build_object('schema','raceson-club-payment-private-v3','claimContext',c,
    'payment',case when i.id is not null then jsonb_build_object('id',i.id,'claimId',i.claim_id,'chainId',i.chain_id,'relayerAddress',i.relayer_address,
      'nonce',i.nonce::text,'fees',i.fees,'witness',i.witness,'createdByUserId',i.created_by_user_id,'createdSessionId',i.created_session_id,'createdAt',i.created_at) end,
    'attempt',case when a.id is not null then jsonb_build_object('id',a.id,'paymentId',a.payment_id,'body',a.body,'createdByUserId',a.created_by_user_id,'createdAt',a.created_at) end,
    'job',case when j.id is not null then jsonb_build_object('jobId',j.id,'intentId',j.payment_id,'attemptId',j.attempt_id,'transactionHash','0x'||encode(j.transaction_hash,'hex'),
      'createdByUserId',j.created_by_user_id,'createdAt',j.created_at,'state',j.state,'mayHaveBroadcast',j.may_have_broadcast,
      'leaseOwner',j.lease_owner,'leaseToken',j.lease_token,'leaseExpiresAt',j.lease_expires_at,'leaseGeneration',j.lease_generation) end,
    'receipt',case when r.job_id is not null then r.body end);
end $$;

create function public.service_change_reward_club_payment_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_upload_id uuid,p_request_id uuid,p_entitlement_id text,p_claim_id uuid,p_payment_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare v jsonb;c jsonb;i app_private.reward_club_payments_v3%rowtype;a app_private.reward_club_payment_attempts_v3%rowtype;j app_private.reward_club_payment_jobs_v3%rowtype;
  signer text;fees jsonb;w jsonb;b jsonb;f jsonb;at timestamptz;worker uuid;token uuid;deadline timestamptz;event text;k text;next_nonce numeric;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if p_action is null or p_action not in('prepare','attempt','queue','lease','arm','submitted','confirm') then raise exception 'invalid_reward_club_payment_v3'; end if;
  select relayer_address into signer from app_private.reward_club_payments_v3 where id=p_payment_id and created_by_user_id=p_actor_user_id;
  if signer is null and p_action='prepare' then signer:=p_payload->>'relayerAddress'; end if;
  if signer is null or signer!~'^0x[0-9a-f]{40}$' or signer='0x'||repeat('0',40) then raise exception 'reward_payment_scope_required'; end if;
  -- Signer before award/source/job: same order as all other relayer workers.
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||p_chain_id::text||':'||signer,0));
  v:=public.service_read_reward_club_payment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_upload_id,p_request_id,p_entitlement_id,p_claim_id,p_payment_id);
  c:=v->'claimContext';
  select * into i from app_private.reward_club_payments_v3 where id=p_payment_id;
  select * into a from app_private.reward_club_payment_attempts_v3 where payment_id=i.id;
  select * into j from app_private.reward_club_payment_jobs_v3 where payment_id=i.id for update;
  if p_action='prepare' then
    perform app_private.require_reward_payment_keys_v3(p_payload,array['relayerAddress','pendingNonce','fees','witness','observedAt']);
    fees:=p_payload->'fees';w:=p_payload->'witness';at:=(p_payload->>'observedAt')::timestamptz;
    perform app_private.require_reward_payment_keys_v3(fees,array['gasLimit','maxFeePerGas','maxPriorityFeePerGas','maxGasCostWei']);
    foreach k in array array['gasLimit','maxFeePerGas','maxPriorityFeePerGas','maxGasCostWei'] loop
      if jsonb_typeof(fees->k) is distinct from 'string' or fees->>k!~'^(0|[1-9][0-9]{0,77})$' then raise exception 'invalid_reward_club_payment_v3'; end if;
      perform (fees->>k)::app_private.reward_uint256;
    end loop;
    if (fees->>'gasLimit')::numeric not between 1 and 30000000 or (fees->>'maxFeePerGas')::numeric=0
      or (fees->>'maxPriorityFeePerGas')::numeric>(fees->>'maxFeePerGas')::numeric
      or (fees->>'gasLimit')::numeric*(fees->>'maxFeePerGas')::numeric>(fees->>'maxGasCostWei')::numeric
      or coalesce(p_payload->>'pendingNonce','')!~'^(0|[1-9][0-9]{0,15})$' or (p_payload->>'pendingNonce')::numeric>9007199254740991
      then raise exception 'invalid_reward_club_payment_v3'; end if;
    if i.id is not null then
      if i.relayer_address is distinct from p_payload->>'relayerAddress' or i.fees<>fees then raise exception 'reward_payment_conflict'; end if; return v;
    end if;
    if signer in(c#>>'{deployment,terms,operatorAddress}',c#>>'{deployment,terms,funderAddress}',c#>>'{package,programmeAddress}',c#>>'{intent,recipientAddress}')
      then raise exception 'reward_separate_relayer_required'; end if;
    perform app_private.require_reward_club_payment_ready_v3(c,w,at);
    if exists(select 1 from app_private.reward_club_payments_v3 where claim_id=p_claim_id) then raise exception 'reward_payment_conflict'; end if;
    select greatest((p_payload->>'pendingNonce')::numeric,coalesce(max(nonce)+1,0)) into next_nonce from app_private.reward_relayer_nonce_slots where chain_id=p_chain_id and relayer_address=signer;
    insert into app_private.reward_club_payments_v3(id,claim_id,chain_id,relayer_address,nonce,fees,witness,created_by_user_id,created_session_id)
      values(p_payment_id,p_claim_id,p_chain_id,signer,next_nonce,fees,w,p_actor_user_id,p_actor_session_id);
  elsif p_action='attempt' then
    perform app_private.require_reward_payment_keys_v3(p_payload,array['attemptId','body','witness','observedAt']); b:=p_payload->'body';w:=p_payload->'witness';at:=(p_payload->>'observedAt')::timestamptz;
    perform app_private.require_reward_payment_keys_v3(b,array['protocolVersion','chainId','contractAddress','relayerAddress','nonce','transactionHash','calldataHash','signedTransaction',
      'gasLimit','maxFeePerGas','maxPriorityFeePerGas','operatorDigest','recipientDigest','wrappedRecipientDigest','safeExecutionNonce','consentCheckpoint']);
    if a.id is not null then
      if a.id::text is distinct from p_payload->>'attemptId' or a.body<>b then raise exception 'reward_payment_conflict'; end if;return v;
    end if;
    perform app_private.require_reward_club_payment_ready_v3(c,w,at);
    if b->'protocolVersion' is distinct from '3'::jsonb or b->'chainId' is distinct from to_jsonb(p_chain_id)
      or b->'contractAddress' is distinct from c#>'{intent,campaignAddress}' or b->>'relayerAddress' is distinct from i.relayer_address
      or b->>'nonce' is distinct from i.nonce::text
      or b->'gasLimit' is distinct from i.fees->'gasLimit' or b->'maxFeePerGas' is distinct from i.fees->'maxFeePerGas'
      or b->'maxPriorityFeePerGas' is distinct from i.fees->'maxPriorityFeePerGas'
      or coalesce(b->>'signedTransaction','')!~'^0x02([0-9a-f]{2})+$' or length(b->>'signedTransaction')>24578
      or b->>'operatorDigest' is distinct from (select value#>>'{proof,digest}' from jsonb_array_elements(c->'proofs') where value->>'role'='operator')
      or b->>'recipientDigest' is distinct from (select value#>>'{proof,digest}' from jsonb_array_elements(c->'proofs') where value->>'role'='recipient')
      or b->>'wrappedRecipientDigest' is distinct from (select value#>>'{proof,wrappedDigest}' from jsonb_array_elements(c->'proofs') where value->>'role'='recipient')
      or b->'safeExecutionNonce' is distinct from c#>'{intent,witness,treasury,executionNonce}'
      or b->'consentCheckpoint' is distinct from (select value#>'{witness,finalizedBlock}' from jsonb_array_elements(c->'proofs') where value->>'role'='recipient')
      then raise exception 'invalid_reward_club_payment_v3'; end if;
    foreach k in array array['transactionHash','calldataHash','operatorDigest','recipientDigest','wrappedRecipientDigest'] loop
      if coalesce(b->>k,'')!~'^0x[0-9a-f]{64}$' or b->>k='0x'||repeat('0',64) then raise exception 'invalid_reward_club_payment_v3'; end if;
    end loop;
    insert into app_private.reward_club_payment_attempts_v3(id,payment_id,transaction_hash,body,created_by_user_id)
      values((p_payload->>'attemptId')::uuid,i.id,decode(substr(b->>'transactionHash',3),'hex'),b,p_actor_user_id);
  elsif p_action='queue' then
    perform app_private.require_reward_payment_keys_v3(p_payload,array['jobId','attemptId','witness','observedAt']);w:=p_payload->'witness';at:=(p_payload->>'observedAt')::timestamptz;
    if a.id is null or a.id::text is distinct from p_payload->>'attemptId' then raise exception 'reward_payment_attempt_required'; end if;
    if j.id is not null then
      if j.id::text is distinct from p_payload->>'jobId' or j.attempt_id<>a.id then raise exception 'reward_payment_conflict'; end if; return v;
    end if;
    perform app_private.require_reward_club_payment_ready_v3(c,w,at);
    insert into app_private.reward_club_payment_jobs_v3(id,payment_id,attempt_id,transaction_hash,created_by_user_id)
      values((p_payload->>'jobId')::uuid,i.id,a.id,a.transaction_hash,p_actor_user_id) returning * into j;event:='queued';
  else
    perform app_private.require_reward_payment_keys_v3(p_payload,array['jobId','workerId','leaseToken','execution','receipt','observedAt']);
    if j.id is null or j.id::text is distinct from p_payload->>'jobId' then raise exception 'reward_payment_job_required'; end if;
    worker:=(p_payload->>'workerId')::uuid;token:=(p_payload->>'leaseToken')::uuid;
    if worker is null or worker='00000000-0000-0000-0000-000000000000'::uuid or (p_action='lease' and token is not null)
      or (p_action='arm')<>(p_payload->'execution'<>'null'::jsonb) or (p_action='confirm')<>(p_payload->'receipt'<>'null'::jsonb)
      then raise exception 'invalid_reward_club_payment_v3'; end if;
    if j.state='confirmed' then return v; end if;
    if p_action='lease' then
      if j.lease_expires_at>clock_timestamp() then
        if j.lease_owner=worker then return v;else return null;end if;
      end if;
      if app_private.reward_relayer_lane_busy(p_chain_id,signer,'club-v3',j.id) then return null;end if;
      update app_private.reward_club_payment_jobs_v3 set state='leased',lease_owner=worker,lease_token=gen_random_uuid(),
        lease_expires_at=clock_timestamp()+interval '60 seconds',lease_generation=lease_generation+1 where id=j.id returning * into j;event:='leased';
    else
      if token is null or j.lease_token is distinct from token or j.lease_owner is distinct from worker or j.lease_expires_at<=clock_timestamp()
        then raise exception 'reward_payment_lease_lost'; end if;deadline:=j.lease_expires_at;
      if p_action='arm' then
        b:=p_payload->'execution';perform app_private.require_reward_payment_keys_v3(b,array['witness','latestNonce','pendingNonce','relayerBalanceWei']);
        w:=b->'witness';at:=(p_payload->>'observedAt')::timestamptz;perform app_private.require_reward_club_payment_ready_v3(c,w,at);
        if b->>'latestNonce' is distinct from i.nonce::text or b->>'pendingNonce' is distinct from i.nonce::text
          or coalesce(b->>'relayerBalanceWei','')!~'^(0|[1-9][0-9]{0,77})$'
          or (b->>'relayerBalanceWei')::numeric<(i.fees->>'maxGasCostWei')::numeric then raise exception 'reward_payment_execution_unavailable'; end if;
        update app_private.reward_club_payment_jobs_v3 set state='broadcasting',may_have_broadcast=true where id=j.id returning * into j;event:='armed';
      elsif p_action='submitted' then
        update app_private.reward_club_payment_jobs_v3 set state='submitted',may_have_broadcast=true where id=j.id returning * into j;event:='submitted';
      else
        perform app_private.require_reward_club_payment_receipt_v3(p_payload->'receipt',c,i,a,j);
        insert into app_private.reward_club_payment_receipts_v3(job_id,payment_id,attempt_id,transaction_hash,chain_id,campaign_address,entitlement_id,body,recorded_by_user_id)
          values(j.id,i.id,a.id,a.transaction_hash,p_chain_id,c#>>'{intent,campaignAddress}',decode(substr(p_entitlement_id,3),'hex'),p_payload->'receipt',p_actor_user_id);
        update app_private.reward_club_payment_jobs_v3 set state='confirmed',may_have_broadcast=true,lease_owner=null,lease_token=null,lease_expires_at=null
          where id=j.id returning * into j;event:='confirmed';
      end if;
    end if;
  end if;
  if event is not null then insert into app_private.reward_club_payment_events_v3(job_id,kind,actor_user_id,worker_id,lease_generation,execution)
    values(j.id,event,p_actor_user_id,worker,j.lease_generation,case when event='armed' then p_payload->'execution' end); end if;
  v:=public.service_read_reward_club_payment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_upload_id,p_request_id,p_entitlement_id,p_claim_id,p_payment_id);
  if w is not null then
    perform app_private.require_reward_club_payment_ready_v3(v->'claimContext',w,at);
    f:=i.witness->'finalizedBlock';
    if f is not null and ((w#>>'{finalizedBlock,number}')::numeric<(f->>'number')::numeric
      or (w#>>'{finalizedBlock,timestamp}')::numeric<(f->>'timestamp')::numeric
      or (w#>>'{finalizedBlock,number}'=f->>'number' and w->'finalizedBlock' is distinct from f)) then raise exception 'reward_claim_observation_regressed'; end if;
  end if;
  if (deadline is not null and deadline<=clock_timestamp()) or (j.lease_expires_at is not null and j.lease_expires_at<=clock_timestamp()) then raise exception 'reward_payment_lease_lost'; end if;
  return v;
end $$;

-- Structural binding of trusted-worker evidence. Crypto, runtime, full factory
-- provenance, canonical logs and RPC finality are independently checked in TS.
create function app_private.require_reward_club_payment_receipt_v3(r jsonb,c jsonb,i app_private.reward_club_payments_v3,
  a app_private.reward_club_payment_attempts_v3,j app_private.reward_club_payment_jobs_v3)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare p jsonb;f jsonb;accounting jsonb;claim jsonb:=c->'intent';source jsonb:=c#>'{activation,receipt,accountingAtReceiptBlock}';k text;pot integer;prior_paid numeric;
begin
  perform app_private.require_reward_payment_keys_v3(r,array['payment','accounting']);p:=r->'payment';f:=p->'finalizedBlock';accounting:=r->'accounting';
  perform app_private.require_reward_payment_keys_v3(p,array['schemaVersion','protocolVersion','action','chainId','contractAddress','relayerAddress','provenance',
    'transactionHash','nonce','blockNumber','blockHash','blockTimestamp','logIndex','safeReceivedLogIndex','entitlementId','recipient','amount','pot','authorizationNonce','allocationDigest',
    'gasLimit','gasUsed','effectiveGasPrice','monadGasLimitFee','runtimeCodeHash','finalizedBlock']);
  perform app_private.require_reward_payment_keys_v3(f,array['number','hash','timestamp']);
  pot:=(c->'package'->>'enabledPot')::integer;
  if p->'schemaVersion' is distinct from '3'::jsonb or p->'protocolVersion' is distinct from '3'::jsonb or p->>'action' is distinct from 'pay_club'
    or p->'chainId' is distinct from to_jsonb(i.chain_id) or p->'contractAddress' is distinct from claim->'campaignAddress'
    or p->>'relayerAddress' is distinct from i.relayer_address or p->>'nonce' is distinct from i.nonce::text
    or p->>'transactionHash' is distinct from '0x'||encode(j.transaction_hash,'hex') or p->'entitlementId' is distinct from claim->'entitlementId'
    or p->'recipient' is distinct from claim->'recipientAddress' or p->'amount' is distinct from claim#>'{witness,amountWei}'
    or p->'authorizationNonce' is distinct from claim->'nonce' or p->'allocationDigest' is distinct from source->'allocationDigest'
    or p->>'pot' is distinct from (case pot when 0 then 'race' else 'league' end)
    or p->'provenance' is distinct from jsonb_build_object('kind','programme-child','programmeAddress',c#>'{package,programmeAddress}',
      'deploymentTransactionHash',c#>'{package,deploymentTransactionHash}','slot',(c#>>'{readiness,source,slot}')::integer-1)
    or p->'gasLimit' is distinct from a.body->'gasLimit' then raise exception 'invalid_reward_club_payment_receipt'; end if;
  foreach k in array array['nonce','blockNumber','blockTimestamp','amount','authorizationNonce','gasLimit','gasUsed','effectiveGasPrice','monadGasLimitFee'] loop
    if jsonb_typeof(p->k) is distinct from 'string' or p->>k!~'^(0|[1-9][0-9]{0,77})$' then raise exception 'invalid_reward_club_payment_receipt'; end if;
    perform (p->>k)::app_private.reward_uint256;
  end loop;
  foreach k in array array['number','timestamp'] loop
    if jsonb_typeof(f->k) is distinct from 'string' or f->>k!~'^[1-9][0-9]{0,77}$' then raise exception 'invalid_reward_club_payment_receipt'; end if;
    perform (f->>k)::app_private.reward_uint256;
  end loop;
  foreach k in array array['blockHash','runtimeCodeHash'] loop
    if coalesce(p->>k,'')!~'^0x[0-9a-f]{64}$' or p->>k='0x'||repeat('0',64) then raise exception 'invalid_reward_club_payment_receipt'; end if;
  end loop;
  if coalesce(f->>'hash','')!~'^0x[0-9a-f]{64}$' or f->>'hash'='0x'||repeat('0',64)
    or jsonb_typeof(p->'logIndex') is distinct from 'number' or p->>'logIndex'!~'^(0|[1-9][0-9]{0,15})$'
    or (p->>'logIndex')::numeric>=9007199254740991
    or jsonb_typeof(p->'safeReceivedLogIndex') is distinct from 'number'
    or coalesce(p->>'safeReceivedLogIndex','')!~'^(0|[1-9][0-9]{0,15})$'
    or (p->>'safeReceivedLogIndex')::numeric<>(p->>'logIndex')::numeric+1
    or (p->>'gasUsed')::numeric not between 1 and (a.body->>'gasLimit')::numeric
    or (p->>'effectiveGasPrice')::numeric>(a.body->>'maxFeePerGas')::numeric
    or (p->>'monadGasLimitFee')::numeric<>(p->>'gasLimit')::numeric*(p->>'effectiveGasPrice')::numeric
    or (p->>'monadGasLimitFee')::numeric>(i.fees->>'maxGasCostWei')::numeric
    or (p->>'blockNumber')::numeric<=(i.witness#>>'{finalizedBlock,number}')::numeric
    or (p->>'blockTimestamp')::numeric<(i.witness#>>'{finalizedBlock,timestamp}')::numeric
    or (p->>'blockTimestamp')::numeric<(claim->>'issuedAt')::numeric or (p->>'blockTimestamp')::numeric>=(claim->>'expiresAt')::numeric
    or (p->>'blockNumber')::numeric>(f->>'number')::numeric or (p->>'blockTimestamp')::numeric>(f->>'timestamp')::numeric
    or (p->>'blockNumber'=f->>'number' and (p->>'blockHash'<>f->>'hash' or p->>'blockTimestamp'<>f->>'timestamp'))
    then raise exception 'invalid_reward_club_payment_receipt'; end if;
  perform app_private.require_reward_campaign_accounting(accounting,pot);
  foreach k in array array['accountedFunding','budgets','allocated','entitlementCount','uploadDigest','snapshotDigest','allocationDigest'] loop
    if accounting->k is distinct from source->k then raise exception 'invalid_reward_club_payment_receipt'; end if;
  end loop;
  select coalesce(sum(amount),0) into prior_paid from (
    select (body#>>'{payment,amount}')::numeric amount from app_private.reward_athlete_payment_receipts_v3
      where chain_id=i.chain_id and campaign_address=claim->>'campaignAddress'
    union all select (body#>>'{payment,amount}')::numeric from app_private.reward_club_payment_receipts_v3
      where chain_id=i.chain_id and campaign_address=claim->>'campaignAddress') paid;
  if accounting->>'state' not in('3','4') or (accounting->'paid'->>pot)::numeric<prior_paid+(p->>'amount')::numeric
    then raise exception 'invalid_reward_club_payment_receipt'; end if;
end $$;
-- A recipient reads with their OWN identity, never the operator's capability.
-- Only minimized persisted history crosses this boundary; no raw signed bytes.
create function public.service_read_reward_club_payment_status_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_upload_id uuid,p_request_id uuid,p_entitlement_id text,p_claim_id uuid,p_role text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c jsonb;i app_private.reward_club_payments_v3%rowtype;a app_private.reward_club_payment_attempts_v3%rowtype;
  j app_private.reward_club_payment_jobs_v3%rowtype;r app_private.reward_club_payment_receipts_v3%rowtype;v jsonb;
begin
  c:=public.service_read_reward_club_claim_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_upload_id,p_request_id,p_entitlement_id,p_claim_id,p_role);
  if c->'intent'='null'::jsonb then raise exception 'reward_claim_scope_required'; end if;
  select * into i from app_private.reward_club_payments_v3 where claim_id=p_claim_id and chain_id=p_chain_id;
  select * into a from app_private.reward_club_payment_attempts_v3 where payment_id=i.id;
  select * into j from app_private.reward_club_payment_jobs_v3 where payment_id=i.id;
  select * into r from app_private.reward_club_payment_receipts_v3 where job_id=j.id;
  if (j.state='confirmed') is true and r.job_id is null then raise exception 'reward_payment_receipt_required'; end if;
  v:=jsonb_build_object('schema','raceson-club-payment-status-v3','chainId',p_chain_id,'uploadId',p_upload_id,'requestId',p_request_id,
    'entitlementId',p_entitlement_id,'claimId',p_claim_id,'recipientAddress',c#>'{intent,recipientAddress}','amountWei',c#>'{intent,witness,amountWei}',
    'paymentId',i.id,'state',coalesce(j.state,case when a.id is not null then 'signed' when i.id is not null then 'prepared' else 'not_prepared' end),
    'transactionHash',case when a.id is not null then '0x'||encode(a.transaction_hash,'hex') end,'confirmed',r.job_id is not null,
    'blockNumber',r.body#>'{payment,blockNumber}','blockHash',r.body#>'{payment,blockHash}',
    'readinessHeld',c#>>'{readiness,state}' is distinct from 'reviewed'
      or c#>'{readiness,review,id}' is distinct from c#>'{intent,reviewId}'
      or c#>'{readiness,source,sourceGuardHash}' is distinct from c#>'{intent,sourceGuardHash}'
      or c#>'{readiness,identityFingerprint}' is distinct from c#>'{intent,identityFingerprint}');
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);return v;
end $$;
revoke all on function public.service_read_reward_club_payment_status_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_read_reward_club_payment_status_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text) to service_role;
revoke all on function app_private.record_reward_club_payment_nonce_v3(),app_private.protect_reward_club_payment_job_v3(),
  app_private.require_reward_club_payment_ready_v3(jsonb,jsonb,timestamptz),
  app_private.require_reward_club_payment_receipt_v3(jsonb,jsonb,app_private.reward_club_payments_v3,app_private.reward_club_payment_attempts_v3,app_private.reward_club_payment_jobs_v3),
  public.service_read_reward_club_payment_v3(uuid,uuid,integer,uuid,uuid,text,uuid,uuid),
  public.service_change_reward_club_payment_v3(uuid,uuid,integer,uuid,uuid,text,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.record_reward_club_payment_nonce_v3(),app_private.protect_reward_club_payment_job_v3(),
  app_private.require_reward_club_payment_ready_v3(jsonb,jsonb,timestamptz),
  app_private.require_reward_club_payment_receipt_v3(jsonb,jsonb,app_private.reward_club_payments_v3,app_private.reward_club_payment_attempts_v3,app_private.reward_club_payment_jobs_v3),
  public.service_read_reward_club_payment_v3(uuid,uuid,integer,uuid,uuid,text,uuid,uuid),
  public.service_change_reward_club_payment_v3(uuid,uuid,integer,uuid,uuid,text,uuid,uuid,text,jsonb) to service_role;
commit;
