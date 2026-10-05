begin;

-- Private gas-payer reservations. Award authorization nonces remain in the
-- claim table; this independent book owns transaction nonces across programmes.
create table app_private.reward_athlete_payment_intents (
  id uuid primary key default gen_random_uuid(),
  claim_intent_id uuid not null unique references app_private.reward_athlete_claim_intents(id) on delete restrict,
  chain_id integer not null check(chain_id in (10143,31337)),
  relayer_address app_private.reward_address not null,
  nonce app_private.reward_uint256 not null check(nonce<=9007199254740991),
  recipient_proof_id uuid not null references app_private.reward_athlete_claim_proofs(id) on delete restrict,
  operator_proof_id uuid not null references app_private.reward_athlete_claim_proofs(id) on delete restrict,
  prepared_by_user_id uuid not null,
  prepared_session_id uuid not null,
  prepared_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  chain_witness jsonb not null check(jsonb_typeof(chain_witness)='object' and octet_length(chain_witness::text)<32768),
  check(recipient_proof_id<>operator_proof_id),
  unique(id,chain_id,relayer_address,nonce)
);
create index reward_payment_recipient_proof on app_private.reward_athlete_payment_intents(recipient_proof_id);
create index reward_payment_operator_proof on app_private.reward_athlete_payment_intents(operator_proof_id);
create table app_private.reward_relayer_nonce_slots (
  chain_id integer not null check(chain_id in (10143,31337)),
  relayer_address app_private.reward_address not null,
  nonce app_private.reward_uint256 not null check(nonce<=9007199254740991),
  athlete_payment_intent_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  primary key(chain_id,relayer_address,nonce),
  unique(chain_id,relayer_address,nonce,athlete_payment_intent_id),
  foreign key(athlete_payment_intent_id,chain_id,relayer_address,nonce)
    references app_private.reward_athlete_payment_intents(id,chain_id,relayer_address,nonce) on delete restrict
);
alter table app_private.reward_athlete_payment_intents add constraint reward_payment_requires_nonce_slot
  foreign key(chain_id,relayer_address,nonce,id)
  references app_private.reward_relayer_nonce_slots(chain_id,relayer_address,nonce,athlete_payment_intent_id)
  deferrable initially deferred;

-- Both role books use the existing chain/address lock namespace. An address
-- cannot become an operator after it has reserved relayer slots, or vice versa.
create function app_private.require_reward_nonce_role_separation()
returns trigger language plpgsql security invoker set search_path='' as $$
declare signer text;
begin
  if tg_table_schema<>'app_private' or tg_op<>'INSERT' then
    raise exception using errcode='22023',message='invalid_reward_nonce_owner'; end if;
  if tg_table_name='reward_operator_nonce_slots' then signer:=new.operator_address;
  elsif tg_table_name='reward_relayer_nonce_slots' then signer:=new.relayer_address;
  else raise exception using errcode='22023',message='invalid_reward_nonce_owner'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||new.chain_id::text||':'||signer,0));
  if (tg_table_name='reward_operator_nonce_slots' and exists(select 1 from app_private.reward_relayer_nonce_slots where chain_id=new.chain_id and relayer_address=signer))
    or (tg_table_name='reward_relayer_nonce_slots' and exists(select 1 from app_private.reward_operator_nonce_slots where chain_id=new.chain_id and operator_address=signer)) then
    raise exception using errcode='22023',message='reward_separate_relayer_required'; end if;
  return new;
end $$;
create trigger reward_operator_role_separation before insert on app_private.reward_operator_nonce_slots
  for each row execute function app_private.require_reward_nonce_role_separation();
create trigger reward_relayer_role_separation before insert on app_private.reward_relayer_nonce_slots
  for each row execute function app_private.require_reward_nonce_role_separation();
create function app_private.record_reward_relayer_nonce_slot()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  insert into app_private.reward_relayer_nonce_slots(chain_id,relayer_address,nonce,athlete_payment_intent_id)
    values(new.chain_id,new.relayer_address,new.nonce,new.id);
  return new;
end $$;
create trigger reward_payment_nonce_slot after insert on app_private.reward_athlete_payment_intents
  for each row execute function app_private.record_reward_relayer_nonce_slot();

create table app_private.reward_athlete_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references app_private.reward_athlete_payment_intents(id) on delete restrict,
  transaction_hash app_private.reward_bytes32 not null unique,
  attempt_body jsonb not null check(jsonb_typeof(attempt_body)='object' and octet_length(attempt_body::text)<12000),
  recorded_by_user_id uuid not null,
  recorded_session_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  unique(payment_intent_id,recorded_by_user_id,idempotency_key)
);
do $$ declare name text; begin
  foreach name in array array['reward_athlete_payment_intents','reward_relayer_nonce_slots','reward_athlete_payment_attempts'] loop
    execute format('alter table app_private.%I enable row level security',name);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',name);
    execute format('grant select,insert on app_private.%I to service_role',name);
    execute format('create policy %I on app_private.%I for select to service_role using(true)',name||'_select',name);
    execute format('create policy %I on app_private.%I for insert to service_role with check(true)',name||'_insert',name);
    execute format('create trigger reward_payment_immutable before update or delete on app_private.%I for each row execute function app_private.reject_reward_ledger_mutation()',name);
  end loop;
end $$;

create function app_private.reward_athlete_payment_document(i app_private.reward_athlete_payment_intents)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('paymentIntentId',i.id,'claimIntentId',i.claim_intent_id,'chainId',i.chain_id,
    'relayerAddress',i.relayer_address,'nonce',i.nonce::text,'recipientProofId',i.recipient_proof_id,'operatorProofId',i.operator_proof_id,
    'preparedByUserId',i.prepared_by_user_id,'preparedSessionId',i.prepared_session_id,'preparedAt',i.prepared_at,
    'idempotencyKey',i.idempotency_key,'chainWitness',i.chain_witness);
$$;
create function public.service_read_reward_athlete_payment_context(p_actor_user_id uuid,p_actor_session_id uuid,p_claim_intent_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c jsonb; i app_private.reward_athlete_payment_intents%rowtype;
begin
  c:=public.service_read_reward_athlete_claim_proofs(p_actor_user_id,p_actor_session_id,p_claim_intent_id,'operator');
  select * into i from app_private.reward_athlete_payment_intents where claim_intent_id=p_claim_intent_id;
  return jsonb_build_object('claimContext',c,'paymentIntent',case when i.id is null then null else app_private.reward_athlete_payment_document(i) end);
end $$;

-- Lock order agrees with consent/readiness: programme, recipient account,
-- ordered user rows, athlete row; re-read actual operator session after waits.
create function app_private.lock_reward_athlete_payment_context(p_actor_user_id uuid,p_actor_session_id uuid,p_claim_intent_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c jsonb;
begin
  c:=public.service_read_reward_athlete_claim_proofs(p_actor_user_id,p_actor_session_id,p_claim_intent_id,'operator');
  perform id from app_private.reward_programmes where id=(c->>'programmeId')::uuid for update;
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||(c#>>'{intent,recipientUserId}'),0));
  perform user_id from public.user_profiles where user_id in (p_actor_user_id,(c#>>'{intent,recipientUserId}')::uuid) order by user_id for share;
  perform id from public.athlete_profiles where id=(c#>>'{entitlement,athleteProfileId}')::uuid for share;
  return public.service_read_reward_athlete_claim_proofs(p_actor_user_id,p_actor_session_id,p_claim_intent_id,'operator');
end $$;

-- Structural SQL defence; the application must independently verify all three
-- signatures and RPC observations. No SQL witness is a cryptographic oracle.
create function app_private.require_reward_athlete_payment_ready(c jsonb,w jsonb,observed_at timestamptz)
returns void language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare stamp numeric; now_at timestamptz; prior jsonb;
begin
  if jsonb_array_length(c->'proofs')<>2 then raise exception using errcode='42501',message='reward_payment_approvals_required'; end if;
  if c#>>'{reviewContext,reviewState}' is distinct from 'reviewed'
    or c#>>'{reviewContext,latestReview,reviewId}' is distinct from c#>>'{intent,readinessReviewId}' then
    raise exception using errcode='42501',message='reward_claim_readiness_required'; end if;
  perform app_private.assert_reward_allocation_source_current((c#>>'{upload,allocationId}')::uuid,(c->>'operatorUserId')::uuid);
  perform app_private.require_reward_athlete_claim_witness(w,jsonb_build_object('lifecycleContext',jsonb_build_object(
    'upload',c->'upload','checkpoint',c->'checkpoint'),'reviewContext',c->'reviewContext','entitlement',c->'entitlement'));
  stamp:=(w#>>'{observation,finalizedBlock,timestamp}')::numeric; now_at:=clock_timestamp();
  if w#>>'{award,nonce}' is distinct from c#>>'{intent,nonce}' or stamp<(c#>>'{intent,issuedAt}')::numeric
    or stamp>=(c#>>'{intent,expiresAt}')::numeric then raise exception using errcode='42501',message='reward_claim_not_live'; end if;
  if observed_at is null or observed_at>now_at+interval '5 seconds' or observed_at<now_at-interval '2 minutes'
    or (c#>>'{upload,body,sourceReviewEndsAt}')::numeric>extract(epoch from now_at)
    or ((c#>>'{upload,body,chainId}')::integer=10143 and (stamp>extract(epoch from now_at)+5 or stamp<extract(epoch from now_at)-120
      or (c#>>'{intent,expiresAt}')::numeric<=extract(epoch from now_at))) then
    raise exception using errcode='42501',message='reward_claim_observation_stale'; end if;
  for prior in select c#>'{intent,chainWitness,observation,finalizedBlock}' union all
    select value#>'{chainWitness,observation,finalizedBlock}' from jsonb_array_elements(c->'proofs') loop
    if (w#>>'{observation,finalizedBlock,number}')::numeric<(prior->>'number')::numeric or stamp<(prior->>'timestamp')::numeric
      or ((w#>>'{observation,finalizedBlock,number}')::numeric=(prior->>'number')::numeric and w#>'{observation,finalizedBlock}' is distinct from prior) then
      raise exception using errcode='22023',message='reward_claim_observation_regressed'; end if;
  end loop;
end $$;

create function public.service_reserve_reward_athlete_payment(p_actor_user_id uuid,p_actor_session_id uuid,p_claim_intent_id uuid,
  p_relayer_address text,p_idempotency_key text,p_observed_chain_id integer,p_pending_nonce text,p_witness jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c jsonb; i app_private.reward_athlete_payment_intents%rowtype; next_nonce numeric; chain integer;
begin
  c:=public.service_read_reward_athlete_claim_proofs(p_actor_user_id,p_actor_session_id,p_claim_intent_id,'operator');
  chain:=(c#>>'{upload,body,chainId}')::integer;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or p_relayer_address is null or p_relayer_address !~ '^0x[0-9a-f]{40}$' or p_relayer_address='0x'||repeat('0',40)
    or p_observed_chain_id is distinct from chain or p_pending_nonce is null or p_pending_nonce !~ '^(0|[1-9][0-9]{0,15})$'
    or p_pending_nonce::numeric>9007199254740991 then raise exception using errcode='22023',message='invalid_reward_payment_request'; end if;
  if p_relayer_address in (c#>>'{upload,body,operatorAddress}',c#>>'{upload,body,treasuryAddress}',c#>>'{intent,recipientAddress}') then
    raise exception using errcode='22023',message='reward_separate_relayer_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||chain::text||':'||p_relayer_address,0));
  c:=app_private.lock_reward_athlete_payment_context(p_actor_user_id,p_actor_session_id,p_claim_intent_id);
  select * into i from app_private.reward_athlete_payment_intents where claim_intent_id=p_claim_intent_id;
  if found then
    if i.idempotency_key<>p_idempotency_key or i.relayer_address<>p_relayer_address or i.prepared_by_user_id<>p_actor_user_id then
      raise exception using errcode='22023',message='reward_payment_already_planned'; end if;
    return public.service_read_reward_athlete_payment_context(p_actor_user_id,p_actor_session_id,p_claim_intent_id);
  end if;
  perform app_private.require_reward_athlete_payment_ready(c,p_witness,p_observed_at);
  select greatest(p_pending_nonce::numeric,coalesce(max(nonce)+1,0)) into next_nonce from app_private.reward_relayer_nonce_slots
    where chain_id=chain and relayer_address=p_relayer_address;
  if next_nonce>9007199254740991 then raise exception using errcode='22023',message='reward_payment_nonce_exhausted'; end if;
  insert into app_private.reward_athlete_payment_intents(claim_intent_id,chain_id,relayer_address,nonce,recipient_proof_id,operator_proof_id,
    prepared_by_user_id,prepared_session_id,idempotency_key,chain_witness)
    values(p_claim_intent_id,chain,p_relayer_address,next_nonce,
      (select (value->>'proofId')::uuid from jsonb_array_elements(c->'proofs') where value->>'role'='recipient'),
      (select (value->>'proofId')::uuid from jsonb_array_elements(c->'proofs') where value->>'role'='operator'),
      p_actor_user_id,p_actor_session_id,p_idempotency_key,p_witness);
  return public.service_read_reward_athlete_payment_context(p_actor_user_id,p_actor_session_id,p_claim_intent_id);
end $$;

create function public.service_record_reward_athlete_payment_attempt(p_actor_user_id uuid,p_actor_session_id uuid,p_claim_intent_id uuid,
  p_payment_intent_id uuid,p_idempotency_key text,p_attempt jsonb,p_witness jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c jsonb; i app_private.reward_athlete_payment_intents%rowtype; a app_private.reward_athlete_payment_attempts%rowtype;
  first_body jsonb; field text; digest text; previous_block jsonb;
begin
  c:=app_private.lock_reward_athlete_payment_context(p_actor_user_id,p_actor_session_id,p_claim_intent_id);
  select * into i from app_private.reward_athlete_payment_intents where id=p_payment_intent_id and claim_intent_id=p_claim_intent_id;
  if not found then raise exception using errcode='42501',message='reward_payment_intent_required'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or jsonb_typeof(p_attempt) is distinct from 'object' or octet_length(p_attempt::text)>=12000
    or (select count(*) from jsonb_object_keys(p_attempt))<>24
    or not p_attempt ?& array['schemaVersion','action','chainId','relayerAddress','nonce','contractAddress','transactionHash','signedTransaction','buildId',
      'calldataHash','entitlementId','recipient','amount','pot','authorizationNonce','issuedAt','expiresAt','allocationDigest','operatorDigest','recipientDigest',
      'value','gasLimit','maxFeePerGas','maxPriorityFeePerGas'] then
    raise exception using errcode='22023',message='invalid_reward_payment_attempt'; end if;
  foreach field in array array['nonce','amount','authorizationNonce','issuedAt','expiresAt','value','gasLimit','maxFeePerGas','maxPriorityFeePerGas'] loop
    if jsonb_typeof(p_attempt->field) is distinct from 'string' or p_attempt->>field !~ '^(0|[1-9][0-9]{0,77})$' then
      raise exception using errcode='22023',message='invalid_reward_payment_attempt'; end if;
    perform (p_attempt->>field)::app_private.reward_uint256;
  end loop;
  foreach field in array array['transactionHash','calldataHash','entitlementId','allocationDigest','operatorDigest','recipientDigest'] loop
    if coalesce(p_attempt->>field,'') !~ '^0x[0-9a-f]{64}$' or p_attempt->>field='0x'||repeat('0',64) then
      raise exception using errcode='22023',message='invalid_reward_payment_attempt'; end if;
  end loop;
  if p_attempt->'schemaVersion' is distinct from '1'::jsonb or p_attempt->>'action' is distinct from 'pay_athlete'
    or p_attempt->'chainId' is distinct from to_jsonb(i.chain_id) or p_attempt->>'relayerAddress' is distinct from i.relayer_address
    or p_attempt->>'nonce' is distinct from i.nonce::text or p_attempt->>'value' is distinct from '0'
    or p_attempt->>'contractAddress' is distinct from c#>>'{checkpoint,deployment,contractAddress}'
    or p_attempt->>'buildId' is distinct from c#>>'{checkpoint,deployment,buildId}'
    or p_attempt->>'entitlementId' is distinct from c#>>'{entitlement,onChainId}' or p_attempt->>'amount' is distinct from c#>>'{entitlement,amountWei}'
    or p_attempt->>'recipient' is distinct from c#>>'{intent,recipientAddress}' or p_attempt->>'authorizationNonce' is distinct from c#>>'{intent,nonce}'
    or p_attempt->>'issuedAt' is distinct from c#>>'{intent,issuedAt}' or p_attempt->>'expiresAt' is distinct from c#>>'{intent,expiresAt}'
    or p_attempt->>'allocationDigest' is distinct from c#>>'{upload,body,allocationDigest}'
    or p_attempt->>'pot' is distinct from (case when c#>>'{upload,body,enabledPot}'='0' then 'race' else 'league' end)
    -- PostgreSQL regex repetition bounds stop at 255. Preserve the exact
    -- 1..2048-byte envelope with a separate length check, as other intents do.
    or jsonb_typeof(p_attempt->'signedTransaction') is distinct from 'string'
    or length(p_attempt->>'signedTransaction') not between 6 and 4100
    or coalesce(p_attempt->>'signedTransaction','') !~ '^0x02([0-9a-f]{2})+$'
    or (p_attempt->>'gasLimit')::numeric=0 or (p_attempt->>'gasLimit')::numeric>=18446744073709551616
    or (p_attempt->>'maxFeePerGas')::numeric=0 or (p_attempt->>'maxPriorityFeePerGas')::numeric>(p_attempt->>'maxFeePerGas')::numeric then
    raise exception using errcode='22023',message='invalid_reward_payment_attempt'; end if;
  perform ((p_attempt->>'gasLimit')::numeric*(p_attempt->>'maxFeePerGas')::numeric)::app_private.reward_uint256;
  foreach field in array array['operator','recipient'] loop
    select value->>'digest' into digest from jsonb_array_elements(c->'proofs') where value->>'role'=field
      and value->>'proofId'=case when field='operator' then i.operator_proof_id::text else i.recipient_proof_id::text end;
    if digest is null or p_attempt->>(field||'Digest') is distinct from digest then
      raise exception using errcode='22023',message='invalid_reward_payment_attempt'; end if;
  end loop;
  select * into a from app_private.reward_athlete_payment_attempts where payment_intent_id=i.id and recorded_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    if a.attempt_body is distinct from p_attempt then raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
  else
    perform app_private.require_reward_athlete_payment_ready(c,p_witness,p_observed_at);
    previous_block:=i.chain_witness#>'{observation,finalizedBlock}';
    if (p_witness#>>'{observation,finalizedBlock,number}')::numeric<(previous_block->>'number')::numeric
      or (p_witness#>>'{observation,finalizedBlock,timestamp}')::numeric<(previous_block->>'timestamp')::numeric
      or ((p_witness#>>'{observation,finalizedBlock,number}')::numeric=(previous_block->>'number')::numeric
        and p_witness#>'{observation,finalizedBlock}' is distinct from previous_block) then
      raise exception using errcode='22023',message='reward_claim_observation_regressed'; end if;
    select attempt_body into first_body from app_private.reward_athlete_payment_attempts where payment_intent_id=i.id order by recorded_at,id limit 1;
    if first_body is not null and (first_body-array['transactionHash','signedTransaction','gasLimit','maxFeePerGas','maxPriorityFeePerGas'])
      is distinct from (p_attempt-array['transactionHash','signedTransaction','gasLimit','maxFeePerGas','maxPriorityFeePerGas']) then
      raise exception using errcode='22023',message='reward_payment_attempt_mismatch'; end if;
    if exists(select 1 from app_private.reward_athlete_payment_attempts where transaction_hash=decode(substr(p_attempt->>'transactionHash',3),'hex')) then
      raise exception using errcode='22023',message='reward_payment_transaction_already_recorded'; end if;
    insert into app_private.reward_athlete_payment_attempts(payment_intent_id,transaction_hash,attempt_body,recorded_by_user_id,recorded_session_id,idempotency_key)
      values(i.id,decode(substr(p_attempt->>'transactionHash',3),'hex'),p_attempt,p_actor_user_id,p_actor_session_id,p_idempotency_key) returning * into a;
  end if;
  return jsonb_build_object('attemptId',a.id,'paymentIntentId',i.id,'claimIntentId',i.claim_intent_id,
    'recordedByUserId',a.recorded_by_user_id,'recordedAt',a.recorded_at,'transactionHash','0x'||encode(a.transaction_hash,'hex'));
end $$;

create function public.service_read_reward_athlete_payment_attempt(p_actor_user_id uuid,p_actor_session_id uuid,p_claim_intent_id uuid,p_payment_intent_id uuid,
  p_attempt_id uuid default null,p_idempotency_key text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c jsonb; a app_private.reward_athlete_payment_attempts%rowtype;
begin
  c:=public.service_read_reward_athlete_payment_context(p_actor_user_id,p_actor_session_id,p_claim_intent_id);
  if c#>>'{paymentIntent,paymentIntentId}' is distinct from p_payment_intent_id::text or p_payment_intent_id is null then
    raise exception using errcode='42501',message='reward_payment_intent_required'; end if;
  if (p_attempt_id is null)=(p_idempotency_key is null) or (p_idempotency_key is not null and length(p_idempotency_key) not between 8 and 128) then
    raise exception using errcode='22023',message='invalid_reward_payment_request'; end if;
  select * into a from app_private.reward_athlete_payment_attempts where payment_intent_id=p_payment_intent_id
    and ((p_attempt_id is not null and id=p_attempt_id) or (p_idempotency_key is not null and idempotency_key=p_idempotency_key and recorded_by_user_id=p_actor_user_id));
  if not found then
    if p_idempotency_key is not null then return null; end if;
    raise exception using errcode='42501',message='reward_payment_attempt_required'; end if;
  return jsonb_build_object('context',c,'attempt',jsonb_build_object('attemptId',a.id,'paymentIntentId',a.payment_intent_id,
    'body',a.attempt_body,'recordedByUserId',a.recorded_by_user_id,'recordedSessionId',a.recorded_session_id,
    'recordedAt',a.recorded_at,'idempotencyKey',a.idempotency_key));
end $$;

revoke all on function app_private.require_reward_nonce_role_separation(),app_private.record_reward_relayer_nonce_slot(),
  app_private.reward_athlete_payment_document(app_private.reward_athlete_payment_intents),
  app_private.lock_reward_athlete_payment_context(uuid,uuid,uuid),app_private.require_reward_athlete_payment_ready(jsonb,jsonb,timestamptz),
  public.service_read_reward_athlete_payment_context(uuid,uuid,uuid),
  public.service_reserve_reward_athlete_payment(uuid,uuid,uuid,text,text,integer,text,jsonb,timestamptz),
  public.service_record_reward_athlete_payment_attempt(uuid,uuid,uuid,uuid,text,jsonb,jsonb,timestamptz),
  public.service_read_reward_athlete_payment_attempt(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_private.require_reward_nonce_role_separation(),app_private.record_reward_relayer_nonce_slot(),
  app_private.reward_athlete_payment_document(app_private.reward_athlete_payment_intents),
  app_private.lock_reward_athlete_payment_context(uuid,uuid,uuid),app_private.require_reward_athlete_payment_ready(jsonb,jsonb,timestamptz),
  public.service_read_reward_athlete_payment_context(uuid,uuid,uuid),
  public.service_reserve_reward_athlete_payment(uuid,uuid,uuid,text,text,integer,text,jsonb,timestamptz),
  public.service_record_reward_athlete_payment_attempt(uuid,uuid,uuid,uuid,text,jsonb,jsonb,timestamptz),
  public.service_read_reward_athlete_payment_attempt(uuid,uuid,uuid,uuid,uuid,text) to service_role;
commit;
