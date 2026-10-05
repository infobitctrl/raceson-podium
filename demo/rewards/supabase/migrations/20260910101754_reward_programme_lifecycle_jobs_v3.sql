-- Isolated demo only: exact saved attempts, bounded leases and atomic receipts.
begin;
create table app_private.reward_programme_lifecycle_jobs_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  intent_id uuid not null unique references app_private.reward_programme_lifecycle_intents_v3(id),
  attempt_id uuid not null unique,
  transaction_hash app_private.reward_bytes32 not null,
  created_by_user_id uuid not null references public.user_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  state text not null default 'queued' check(state in('queued','leased','broadcasting','submitted','confirmed')),
  may_have_broadcast boolean not null default false,
  lease_owner uuid, lease_token uuid, lease_expires_at timestamptz,
  lease_generation integer not null default 0 check(lease_generation>=0),
  foreign key(attempt_id,intent_id,transaction_hash) references app_private.reward_programme_lifecycle_attempts_v3(id,intent_id,transaction_hash),
  unique(id,intent_id,attempt_id,transaction_hash),
  check((lease_owner is null)=(lease_token is null) and (lease_owner is null)=(lease_expires_at is null)),
  check(state<>'confirmed' or (lease_owner is null and may_have_broadcast)),
  check(state not in('broadcasting','submitted') or may_have_broadcast),
  check(state<>'queued' or (lease_owner is null and lease_generation=0 and not may_have_broadcast)),
  check(state not in('leased','broadcasting','submitted') or (lease_owner is not null and lease_generation>0))
);
create table app_private.reward_programme_lifecycle_receipts_v3 (
  job_id uuid primary key,
  intent_id uuid not null unique,
  attempt_id uuid not null unique,
  transaction_hash app_private.reward_bytes32 not null,
  receipt jsonb not null check(jsonb_typeof(receipt)='object' and octet_length(receipt::text)<=16000),
  recorded_by_user_id uuid not null references public.user_profiles(user_id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key(job_id,intent_id,attempt_id,transaction_hash)
    references app_private.reward_programme_lifecycle_jobs_v3(id,intent_id,attempt_id,transaction_hash)
);
create table app_private.reward_programme_lifecycle_job_events_v3 (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references app_private.reward_programme_lifecycle_jobs_v3(id),
  kind text not null check(kind in('queued','leased','armed','submitted','confirmed')),
  actor_user_id uuid not null references public.user_profiles(user_id),
  worker_id uuid, lease_generation integer not null check(lease_generation>=0),
  recorded_at timestamptz not null default clock_timestamp()
);
create index reward_programme_lifecycle_job_events_v3_lookup on app_private.reward_programme_lifecycle_job_events_v3(job_id,recorded_at,id);
alter table app_private.reward_programme_lifecycle_jobs_v3 enable row level security;
alter table app_private.reward_programme_lifecycle_receipts_v3 enable row level security;
alter table app_private.reward_programme_lifecycle_job_events_v3 enable row level security;
revoke all on app_private.reward_programme_lifecycle_jobs_v3,app_private.reward_programme_lifecycle_receipts_v3,
  app_private.reward_programme_lifecycle_job_events_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_programme_lifecycle_jobs_v3,app_private.reward_programme_lifecycle_receipts_v3,
  app_private.reward_programme_lifecycle_job_events_v3 to service_role;
grant update(state,may_have_broadcast,lease_owner,lease_token,lease_expires_at,lease_generation) on app_private.reward_programme_lifecycle_jobs_v3 to service_role;
create policy reward_programme_lifecycle_jobs_v3_read on app_private.reward_programme_lifecycle_jobs_v3 for select to service_role using(true);
create policy reward_programme_lifecycle_jobs_v3_insert on app_private.reward_programme_lifecycle_jobs_v3 for insert to service_role with check(true);
create policy reward_programme_lifecycle_jobs_v3_update on app_private.reward_programme_lifecycle_jobs_v3 for update to service_role using(true) with check(true);
create policy reward_programme_lifecycle_receipts_v3_read on app_private.reward_programme_lifecycle_receipts_v3 for select to service_role using(true);
create policy reward_programme_lifecycle_receipts_v3_insert on app_private.reward_programme_lifecycle_receipts_v3 for insert to service_role with check(true);
create policy reward_programme_lifecycle_events_v3_read on app_private.reward_programme_lifecycle_job_events_v3 for select to service_role using(true);
create policy reward_programme_lifecycle_events_v3_insert on app_private.reward_programme_lifecycle_job_events_v3 for insert to service_role with check(true);
create trigger reward_programme_lifecycle_receipts_v3_immutable before update or delete on app_private.reward_programme_lifecycle_receipts_v3
  for each row execute function app_private.reject_reward_ledger_mutation();
create trigger reward_programme_lifecycle_events_v3_immutable before update or delete on app_private.reward_programme_lifecycle_job_events_v3
  for each row execute function app_private.reject_reward_ledger_mutation();
create function app_private.protect_reward_programme_lifecycle_job_v3() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'reward_job_identity_is_immutable'; end if;
  if (new.id,new.intent_id,new.attempt_id,new.transaction_hash,new.created_by_user_id,new.created_at)
    is distinct from (old.id,old.intent_id,old.attempt_id,old.transaction_hash,old.created_by_user_id,old.created_at)
    or (old.may_have_broadcast and not new.may_have_broadcast) or new.lease_generation<old.lease_generation
    or (old.state='confirmed' and new is distinct from old) then raise exception 'reward_job_identity_is_immutable'; end if;
  if new.state='confirmed' and not exists(select 1 from app_private.reward_programme_lifecycle_receipts_v3 r
    where r.job_id=new.id and r.intent_id=new.intent_id and r.attempt_id=new.attempt_id and r.transaction_hash=new.transaction_hash)
    then raise exception 'reward_programme_lifecycle_receipt_required'; end if;
  return new;
end $$;
create trigger reward_programme_lifecycle_job_v3_identity before update or delete on app_private.reward_programme_lifecycle_jobs_v3
  for each row execute function app_private.protect_reward_programme_lifecycle_job_v3();

-- Bidirectional exclusion with all existing operator job kinds. Every caller
-- holds the same chain/signer advisory lock before checking/acquiring a lease.
create or replace function app_private.reward_operator_job_busy(p_chain integer,p_operator text,p_kind text,p_job uuid)
returns boolean language sql volatile security invoker set search_path='' as $$
  select exists(select 1 from app_private.reward_deployment_jobs j join app_private.reward_deployment_intents i on i.id=j.intent_id
    where i.chain_id=p_chain and i.operator_address=p_operator and j.lease_expires_at>clock_timestamp() and not(p_kind='deployment' and j.id=p_job))
  or exists(select 1 from app_private.reward_funding_jobs j join app_private.reward_funding_intents i on i.id=j.intent_id
    where i.chain_id=p_chain and i.operator_address=p_operator and j.lease_expires_at>clock_timestamp() and not(p_kind='funding' and j.id=p_job))
  or exists(select 1 from app_private.reward_lifecycle_jobs j join app_private.reward_lifecycle_intents i on i.id=j.intent_id
    where i.chain_id=p_chain and i.operator_address=p_operator and j.lease_expires_at>clock_timestamp() and not(p_kind='lifecycle' and j.id=p_job))
  or exists(select 1 from app_private.reward_programme_jobs_v3 j join app_private.reward_programme_deployment_intents_v3 i on i.id=j.intent_id
    where i.chain_id=p_chain and i.operator_address=p_operator and j.lease_expires_at>clock_timestamp() and not(p_kind='programme-v3' and j.id=p_job))
  or exists(select 1 from app_private.reward_programme_lifecycle_jobs_v3 j join app_private.reward_programme_lifecycle_intents_v3 i on i.id=j.intent_id
    where i.chain_id=p_chain and i.operator_address=p_operator and j.lease_expires_at>clock_timestamp() and not(p_kind='programme-lifecycle-v3' and j.id=p_job));
$$;
create function app_private.reward_programme_lifecycle_job_document_v3(j app_private.reward_programme_lifecycle_jobs_v3)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select case when j.id is not null then jsonb_build_object('jobId',j.id,'intentId',j.intent_id,'attemptId',j.attempt_id,
    'transactionHash','0x'||encode(j.transaction_hash,'hex'),'createdByUserId',j.created_by_user_id,'createdAt',j.created_at,
    'state',j.state,'mayHaveBroadcast',j.may_have_broadcast,'leaseOwner',j.lease_owner,'leaseToken',j.lease_token,
    'leaseExpiresAt',j.lease_expires_at,'leaseGeneration',j.lease_generation) end;
$$;

-- Service witness validation, not a substitute for the worker's crypto/finality
-- checks. Receipt-block accounting and finalized-head provenance stay distinct.
create function app_private.require_reward_programme_lifecycle_receipt_v3(p jsonb,v jsonb,j app_private.reward_programme_lifecycle_jobs_v3)
returns void language plpgsql security invoker set search_path='' as $$
declare i app_private.reward_programme_lifecycle_intents_v3%rowtype; signed jsonb; u jsonb; a jsonb; f jsonb; publication jsonb;
  prior jsonb; k text; count_uploaded integer; prefix_total numeric; zero_hash text:='0x'||repeat('0',64);
  keys text[]:=array['protocolVersion','provenance','action','campaignAddress','transactionHash','nonce','blockNumber','blockHash','blockTimestamp',
    'gasUsed','effectiveGasPrice','feeWei','finalizedBlock','accountingAtReceiptBlock','publicationAtReceiptBlock'];
begin
  select * into strict i from app_private.reward_programme_lifecycle_intents_v3 where id=j.intent_id;
  select body into strict signed from app_private.reward_programme_lifecycle_attempts_v3 where id=j.attempt_id;
  u:=v->'upload'->'prepared'->'package'; a:=p->'accountingAtReceiptBlock'; f:=p->'finalizedBlock'; publication:=p->'publicationAtReceiptBlock';
  if p is null or jsonb_typeof(p)<>'object' or not(p ?& keys) or p-keys<>'{}'::jsonb or p->'protocolVersion' is distinct from '3'::jsonb
    or p->'action' is distinct from i.body->'action' or p->'campaignAddress' is distinct from u->'campaignAddress'
    or p->>'transactionHash' is distinct from '0x'||encode(j.transaction_hash,'hex') or p->>'nonce' is distinct from i.nonce::text
    or p->'provenance' is distinct from jsonb_build_object('kind','programme-child','programmeAddress',u->'programmeAddress',
      'deploymentTransactionHash',u->'deploymentTransactionHash','slot',i.slot-1)
    or jsonb_typeof(f) is distinct from 'object' or not(f ?& array['number','hash','timestamp']) or f-array['number','hash','timestamp']<>'{}'::jsonb
    or jsonb_typeof(publication) is distinct from 'object' or not(publication ?& array['reviewPeriod','reviewStartedAt','officialPublishedAt','publicationEvidenceHash'])
    or publication-array['reviewPeriod','reviewStartedAt','officialPublishedAt','publicationEvidenceHash']<>'{}'::jsonb
    then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
  foreach k in array array['nonce','blockNumber','blockTimestamp','gasUsed','effectiveGasPrice','feeWei'] loop
    if jsonb_typeof(p->k) is distinct from 'string' or p->>k !~ '^(0|[1-9][0-9]{0,77})$' then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
    perform (p->>k)::app_private.reward_uint256;
  end loop;
  foreach k in array array['number','timestamp'] loop
    if jsonb_typeof(f->k) is distinct from 'string' or f->>k !~ '^[1-9][0-9]{0,77}$' then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
    perform (f->>k)::app_private.reward_uint256;
  end loop;
  foreach k in array array['reviewPeriod','reviewStartedAt','officialPublishedAt'] loop
    if jsonb_typeof(publication->k) is distinct from 'string' or publication->>k !~ '^(0|[1-9][0-9]{0,19})$'
      or (publication->>k)::numeric>18446744073709551615 then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
  end loop;
  if jsonb_typeof(p->'blockHash') is distinct from 'string' or p->>'blockHash' !~ '^0x[0-9a-f]{64}$' or p->>'blockHash'=zero_hash
    or jsonb_typeof(f->'hash') is distinct from 'string' or f->>'hash' !~ '^0x[0-9a-f]{64}$' or f->>'hash'=zero_hash
    or jsonb_typeof(publication->'publicationEvidenceHash') is distinct from 'string' or publication->>'publicationEvidenceHash' !~ '^0x[0-9a-f]{64}$'
    or publication->'reviewPeriod' is distinct from u->'reviewPeriod'
    or (p->>'gasUsed')::numeric=0 or (p->>'effectiveGasPrice')::numeric=0
    or (p->>'gasUsed')::numeric>(signed->>'gasLimit')::numeric or (p->>'effectiveGasPrice')::numeric>(signed->>'maxFeePerGas')::numeric
    or (p->>'feeWei')::numeric<>(p->>'gasUsed')::numeric*(p->>'effectiveGasPrice')::numeric
    or (p->>'feeWei')::numeric>(i.body->>'maxGasCostWei')::numeric
    or (p->>'blockNumber')::numeric<(v#>>'{registry,registry,provenance,deploymentBlockNumber}')::numeric
    or (p->>'blockNumber')::numeric>(f->>'number')::numeric or (p->>'blockTimestamp')::numeric=0
    or (p->>'blockTimestamp')::numeric>(f->>'timestamp')::numeric
    or ((p->>'blockNumber')::numeric=(f->>'number')::numeric and (p->>'blockHash'<>f->>'hash' or p->>'blockTimestamp'<>f->>'timestamp'))
    then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
  if i.predecessor_id is not null then
    select r.receipt into prior from app_private.reward_programme_lifecycle_receipts_v3 r
      join app_private.reward_programme_lifecycle_jobs_v3 previous on previous.id=r.job_id
      where r.intent_id=i.predecessor_id and previous.state='confirmed';
    if prior is null then raise exception 'reward_programme_lifecycle_predecessor_required'; end if;
    if (p->>'blockNumber')::numeric<(prior->>'blockNumber')::numeric or (p->>'blockTimestamp')::numeric<(prior->>'blockTimestamp')::numeric
      or (p->>'blockNumber'=prior->>'blockNumber' and p->>'blockHash'<>prior->>'blockHash') then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
  end if;
  perform app_private.require_reward_campaign_accounting(a,0);
  if a->>'state'='0' or a->'accountedFunding' is distinct from u->'budgetWei' or a->'budgets'->0 is distinct from u->'budgetWei'
    or (a->>'entitlementCount')::numeric>jsonb_array_length(u->'awards') then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
  count_uploaded:=(a->>'entitlementCount')::integer;
  select coalesce(sum((award->>'amount')::numeric),0) into prefix_total from jsonb_array_elements(u->'awards') with ordinality x(award,n) where n<=count_uploaded;
  if (a->'allocated'->>0)::numeric<>prefix_total or (count_uploaded=jsonb_array_length(u->'awards') and a->'uploadDigest' is distinct from u->'uploadDigest')
    or (i.body->>'action'='upload_awards' and count_uploaded<(i.body->>'batchStart')::integer+(i.body->>'batchSize')::integer)
    or (a->>'snapshotDigest'<>zero_hash and a->'snapshotDigest' is distinct from u->'snapshotDigest')
    or (a->>'activationNotBefore'='0' and (publication->>'reviewStartedAt'<>'0' or publication->>'officialPublishedAt'<>'0' or publication->>'publicationEvidenceHash'<>zero_hash))
    or (a->>'activationNotBefore'<>'0' and ((publication->>'reviewStartedAt')::numeric=0 or publication->>'publicationEvidenceHash'=zero_hash
      or (publication->>'officialPublishedAt')::numeric<(publication->>'reviewStartedAt')::numeric+(publication->>'reviewPeriod')::numeric
      or (publication->>'officialPublishedAt')::numeric>(a->>'activationNotBefore')::numeric))
    then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
end $$;

create function public.service_read_reward_programme_lifecycle_job_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid,p_upload_id uuid,p_intent_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare v jsonb; j app_private.reward_programme_lifecycle_jobs_v3%rowtype; r app_private.reward_programme_lifecycle_receipts_v3%rowtype;
begin
  v:=public.service_read_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id,p_upload_id,p_intent_id);
  if v->'intent'->>'id' is null then raise exception 'reward_programme_lifecycle_required'; end if;
  select * into j from app_private.reward_programme_lifecycle_jobs_v3 where intent_id=p_intent_id;
  select * into r from app_private.reward_programme_lifecycle_receipts_v3 where job_id=j.id;
  v:=public.service_read_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id,p_upload_id,p_intent_id);
  return jsonb_build_object('schema','raceson-programme-lifecycle-job-v3','job',app_private.reward_programme_lifecycle_job_document_v3(j),
    'receipt',case when r.job_id is not null then jsonb_build_object('body',r.receipt,'recordedAt',r.recorded_at,'recordedByUserId',r.recorded_by_user_id) end);
end $$;
create function public.service_queue_reward_programme_lifecycle_job_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid,p_upload_id uuid,p_intent_id uuid,p_attempt_id uuid,p_job_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; j app_private.reward_programme_lifecycle_jobs_v3%rowtype; a app_private.reward_programme_lifecycle_attempts_v3%rowtype;
begin
  perform app_private.lock_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  v:=public.service_read_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id,p_upload_id,p_intent_id);
  if p_job_id is null or p_job_id='00000000-0000-0000-0000-000000000000'::uuid then raise exception 'invalid_reward_programme_lifecycle_job'; end if;
  select * into a from app_private.reward_programme_lifecycle_attempts_v3 where id=p_attempt_id and intent_id=p_intent_id and recorded_by_user_id=p_actor_user_id;
  if not found then raise exception 'reward_programme_lifecycle_required'; end if;
  select * into j from app_private.reward_programme_lifecycle_jobs_v3 where id=p_job_id or intent_id=p_intent_id;
  if found then
    if j.id<>p_job_id or j.intent_id<>p_intent_id or j.attempt_id<>p_attempt_id or j.created_by_user_id<>p_actor_user_id
      then raise exception 'reward_programme_lifecycle_job_conflict'; end if;
  else
    if v->'upload'->'current' is distinct from 'true'::jsonb or v->'registry'->'context'->'intent'->'current' is distinct from 'true'::jsonb
      then raise exception 'reward_allocation_not_ready'; end if;
    insert into app_private.reward_programme_lifecycle_jobs_v3(id,intent_id,attempt_id,transaction_hash,created_by_user_id)
      values(p_job_id,p_intent_id,p_attempt_id,a.transaction_hash,p_actor_user_id) returning * into j;
    insert into app_private.reward_programme_lifecycle_job_events_v3(job_id,kind,actor_user_id,lease_generation) values(j.id,'queued',p_actor_user_id,0);
    v:=public.service_read_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id,p_upload_id,p_intent_id);
    if v->'upload'->'current' is distinct from 'true'::jsonb or v->'registry'->'context'->'intent'->'current' is distinct from 'true'::jsonb
      then raise exception 'reward_allocation_not_ready'; end if;
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return app_private.reward_programme_lifecycle_job_document_v3(j);
end $$;

create function public.service_step_reward_programme_lifecycle_job_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid,p_upload_id uuid,p_intent_id uuid,p_job_id uuid,p_worker_id uuid,p_lease_token uuid,p_action text,p_receipt jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; j app_private.reward_programme_lifecycle_jobs_v3%rowtype; i app_private.reward_programme_lifecycle_intents_v3%rowtype;
  event_kind text; held_deadline timestamptz;
begin
  perform app_private.lock_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  v:=public.service_read_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id,p_upload_id,p_intent_id);
  if p_worker_id is null or p_worker_id='00000000-0000-0000-0000-000000000000'::uuid or p_action is null
    or p_action not in('lease','arm','submitted','confirm') or (p_action='lease' and p_lease_token is not null)
    or (p_action<>'confirm' and p_receipt is not null) then raise exception 'invalid_reward_programme_lifecycle_job'; end if;
  select * into j from app_private.reward_programme_lifecycle_jobs_v3 where id=p_job_id and intent_id=p_intent_id for update;
  if not found or j.created_by_user_id<>p_actor_user_id then raise exception 'reward_programme_lifecycle_job_required'; end if;
  select * into strict i from app_private.reward_programme_lifecycle_intents_v3 where id=p_intent_id;
  v:=public.service_read_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id,p_upload_id,p_intent_id);
  if j.state='confirmed' then
    if p_action='confirm' and not exists(select 1 from app_private.reward_programme_lifecycle_receipts_v3 where job_id=j.id and receipt=p_receipt)
      then raise exception 'reward_programme_lifecycle_job_conflict'; end if;
    return app_private.reward_programme_lifecycle_job_document_v3(j);
  end if;
  if p_action='lease' then
    if j.lease_expires_at>clock_timestamp() then
      if j.lease_owner=p_worker_id then return app_private.reward_programme_lifecycle_job_document_v3(j); else return null; end if;
    end if;
    if app_private.reward_operator_job_busy(p_chain_id,i.operator_address,'programme-lifecycle-v3',j.id) then return null; end if;
    update app_private.reward_programme_lifecycle_jobs_v3 set state='leased',lease_owner=p_worker_id,lease_token=gen_random_uuid(),
      lease_expires_at=clock_timestamp()+interval '60 seconds',lease_generation=lease_generation+1 where id=j.id returning * into j;
    event_kind:='leased'; -- A hold still permits reconciliation, never new send.
  else
    if p_lease_token is null or j.lease_token is distinct from p_lease_token or j.lease_owner is distinct from p_worker_id
      or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception 'reward_programme_lifecycle_lease_lost'; end if;
    held_deadline:=j.lease_expires_at;
    if p_action='arm' then
      if v->'upload'->'current' is distinct from 'true'::jsonb or v->'registry'->'context'->'intent'->'current' is distinct from 'true'::jsonb
        then raise exception 'reward_allocation_not_ready'; end if;
      if i.predecessor_id is not null and not exists(select 1 from app_private.reward_programme_lifecycle_jobs_v3 previous
        join app_private.reward_programme_lifecycle_receipts_v3 r on r.job_id=previous.id
        where previous.intent_id=i.predecessor_id and previous.state='confirmed') then raise exception 'reward_programme_lifecycle_predecessor_required'; end if;
    end if;
    if p_action='confirm' then
      perform app_private.require_reward_programme_lifecycle_receipt_v3(p_receipt,v,j);
      insert into app_private.reward_programme_lifecycle_receipts_v3(job_id,intent_id,attempt_id,transaction_hash,receipt,recorded_by_user_id)
        values(j.id,j.intent_id,j.attempt_id,j.transaction_hash,p_receipt,p_actor_user_id);
      update app_private.reward_programme_lifecycle_jobs_v3 set state='confirmed',may_have_broadcast=true,
        lease_owner=null,lease_token=null,lease_expires_at=null where id=j.id returning * into j;
      event_kind:='confirmed';
    else
      update app_private.reward_programme_lifecycle_jobs_v3 set state=case p_action when 'arm' then 'broadcasting' else 'submitted' end,
        may_have_broadcast=true where id=j.id returning * into j;
      event_kind:=case p_action when 'arm' then 'armed' else 'submitted' end;
    end if;
  end if;
  insert into app_private.reward_programme_lifecycle_job_events_v3(job_id,kind,actor_user_id,worker_id,lease_generation)
    values(j.id,event_kind,p_actor_user_id,p_worker_id,j.lease_generation);
  v:=public.service_read_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id,p_upload_id,p_intent_id);
  if p_action='arm' and (v->'upload'->'current' is distinct from 'true'::jsonb or v->'registry'->'context'->'intent'->'current' is distinct from 'true'::jsonb)
    then raise exception 'reward_allocation_not_ready'; end if;
  if (j.state<>'confirmed' and j.lease_expires_at<=clock_timestamp()) or (held_deadline is not null and held_deadline<=clock_timestamp())
    then raise exception 'reward_programme_lifecycle_lease_lost'; end if;
  return app_private.reward_programme_lifecycle_job_document_v3(j);
end $$;
revoke all on function app_private.protect_reward_programme_lifecycle_job_v3(),
  app_private.reward_programme_lifecycle_job_document_v3(app_private.reward_programme_lifecycle_jobs_v3),
  app_private.require_reward_programme_lifecycle_receipt_v3(jsonb,jsonb,app_private.reward_programme_lifecycle_jobs_v3),
  public.service_read_reward_programme_lifecycle_job_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid),
  public.service_queue_reward_programme_lifecycle_job_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,uuid,uuid),
  public.service_step_reward_programme_lifecycle_job_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.protect_reward_programme_lifecycle_job_v3(),
  app_private.reward_programme_lifecycle_job_document_v3(app_private.reward_programme_lifecycle_jobs_v3),
  app_private.require_reward_programme_lifecycle_receipt_v3(jsonb,jsonb,app_private.reward_programme_lifecycle_jobs_v3),
  public.service_read_reward_programme_lifecycle_job_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid),
  public.service_queue_reward_programme_lifecycle_job_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,uuid,uuid),
  public.service_step_reward_programme_lifecycle_job_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;
commit;
