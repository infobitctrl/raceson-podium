begin;

-- Private signed payout capabilities. Storing an attempt neither sends it nor
-- grants an execution lease. No key material is accepted by this boundary.
create table app_private.reward_club_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references app_private.reward_club_payment_intents(id) on delete restrict,
  transaction_hash app_private.reward_bytes32 not null unique,
  attempt_body jsonb not null check(jsonb_typeof(attempt_body)='object' and octet_length(attempt_body::text)<32768),
  recorded_by_user_id uuid not null,
  recorded_session_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  unique(payment_intent_id,recorded_by_user_id,idempotency_key)
);
alter table app_private.reward_club_payment_attempts enable row level security;
revoke all on app_private.reward_club_payment_attempts from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_club_payment_attempts to service_role;
create policy reward_club_attempt_select on app_private.reward_club_payment_attempts for select to service_role using(true);
create policy reward_club_attempt_insert on app_private.reward_club_payment_attempts for insert to service_role with check(true);
create trigger reward_club_attempt_immutable before update or delete on app_private.reward_club_payment_attempts
  for each row execute function app_private.reject_reward_ledger_mutation();

-- SQL validates shape and exact private bindings, never cryptography. The
-- service must verify canonical relayer bytes and both historical approvals,
-- then observe the current unpaid award, original Safe consent and gas nonce.
create function public.service_record_reward_club_payment_attempt(p_actor_user_id uuid,p_actor_session_id uuid,p_claim_intent_id uuid,
  p_payment_intent_id uuid,p_idempotency_key text,p_attempt jsonb,p_pending_nonce text,p_witness jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c jsonb; cc jsonb; i app_private.reward_club_payment_intents%rowtype; a app_private.reward_club_payment_attempts%rowtype;
  first_body jsonb; field text; proof jsonb; previous_block jsonb;
begin
  c:=app_private.lock_reward_club_payment_context(p_actor_user_id,p_actor_session_id,p_claim_intent_id); cc:=c->'claimContext';
  select * into i from app_private.reward_club_payment_intents where id=p_payment_intent_id and claim_intent_id=p_claim_intent_id;
  if not found or i.prepared_by_user_id<>p_actor_user_id then
    raise exception using errcode='42501',message='reward_payment_intent_required'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or jsonb_typeof(p_attempt) is distinct from 'object' or octet_length(p_attempt::text)>=32768
    or (select count(*) from jsonb_object_keys(p_attempt))<>28
    or not p_attempt ?& array['schemaVersion','action','chainId','relayerAddress','nonce','contractAddress','transactionHash','signedTransaction','buildId',
      'calldataHash','entitlementId','recipient','amount','pot','authorizationNonce','issuedAt','expiresAt','allocationDigest','operatorDigest','recipientDigest',
      'value','gasLimit','maxFeePerGas','maxPriorityFeePerGas','wrappedRecipientDigest','safeBuildId','safeExecutionNonce','consentCheckpoint'] then
    raise exception using errcode='22023',message='invalid_reward_payment_attempt'; end if;
  foreach field in array array['nonce','amount','authorizationNonce','issuedAt','expiresAt','value','gasLimit','maxFeePerGas','maxPriorityFeePerGas','safeExecutionNonce'] loop
    if jsonb_typeof(p_attempt->field) is distinct from 'string' or p_attempt->>field !~ '^(0|[1-9][0-9]{0,77})$' then
      raise exception using errcode='22023',message='invalid_reward_payment_attempt'; end if;
    perform (p_attempt->>field)::app_private.reward_uint256;
  end loop;
  foreach field in array array['transactionHash','calldataHash','entitlementId','allocationDigest','operatorDigest','recipientDigest','wrappedRecipientDigest'] loop
    if coalesce(p_attempt->>field,'') !~ '^0x[0-9a-f]{64}$' or p_attempt->>field='0x'||repeat('0',64) then
      raise exception using errcode='22023',message='invalid_reward_payment_attempt'; end if;
  end loop;
  if p_attempt->'schemaVersion' is distinct from '1'::jsonb or p_attempt->>'action' is distinct from 'pay_club'
    or p_attempt->'chainId' is distinct from to_jsonb(i.chain_id) or p_attempt->>'relayerAddress' is distinct from i.relayer_address
    or p_attempt->>'nonce' is distinct from i.nonce::text or p_attempt->>'value' is distinct from '0'
    or p_attempt->>'contractAddress' is distinct from cc#>>'{lifecycleContext,checkpoint,deployment,contractAddress}'
    or p_attempt->>'buildId' is distinct from cc#>>'{lifecycleContext,checkpoint,deployment,buildId}'
    or p_attempt->>'entitlementId' is distinct from cc#>>'{entitlement,onChainId}' or p_attempt->>'amount' is distinct from cc#>>'{entitlement,amountWei}'
    or p_attempt->>'recipient' is distinct from cc#>>'{intent,recipientAddress}' or p_attempt->>'authorizationNonce' is distinct from cc#>>'{intent,nonce}'
    or p_attempt->>'issuedAt' is distinct from cc#>>'{intent,issuedAt}' or p_attempt->>'expiresAt' is distinct from cc#>>'{intent,expiresAt}'
    or p_attempt->>'allocationDigest' is distinct from cc#>>'{lifecycleContext,upload,body,allocationDigest}'
    or p_attempt->>'pot' is distinct from (case when cc#>>'{lifecycleContext,upload,body,enabledPot}'='0' then 'race' else 'league' end)
    or p_attempt->>'safeBuildId' is distinct from cc#>>'{intent,chainWitness,treasury,buildId}'
    or p_attempt->>'safeExecutionNonce' is distinct from cc#>>'{intent,chainWitness,treasury,executionNonce}'
    or jsonb_typeof(p_attempt->'signedTransaction') is distinct from 'string'
    -- PostgreSQL regex repetition bounds stop at 255; enforce 1..12288
    -- complete bytes after the EIP-1559 prefix with an independent length cap.
    or length(p_attempt->>'signedTransaction') not between 6 and 24580
    or coalesce(p_attempt->>'signedTransaction','') !~ '^0x02([0-9a-f]{2})+$'
    or (p_attempt->>'gasLimit')::numeric=0 or (p_attempt->>'gasLimit')::numeric>=18446744073709551616
    or (p_attempt->>'maxFeePerGas')::numeric=0 or (p_attempt->>'maxPriorityFeePerGas')::numeric>(p_attempt->>'maxFeePerGas')::numeric then
    raise exception using errcode='22023',message='invalid_reward_payment_attempt'; end if;
  perform ((p_attempt->>'gasLimit')::numeric*(p_attempt->>'maxFeePerGas')::numeric)::app_private.reward_uint256;
  foreach field in array array['operator','recipient'] loop
    select value into proof from jsonb_array_elements(c->'proofs') where value->>'role'=field
      and value->>'proofId'=case when field='operator' then i.operator_proof_id::text else i.recipient_proof_id::text end;
    if proof is null or p_attempt->>(field||'Digest') is distinct from proof->>'digest'
      or (field='recipient' and (p_attempt->>'wrappedRecipientDigest' is distinct from proof->>'wrappedDigest'
        or p_attempt->'consentCheckpoint' is distinct from proof#>'{chainWitness,observation,finalizedBlock}')) then
      raise exception using errcode='22023',message='invalid_reward_payment_attempt'; end if;
  end loop;
  select * into a from app_private.reward_club_payment_attempts where payment_intent_id=i.id and recorded_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    if a.attempt_body is distinct from p_attempt then raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
  else
    perform app_private.require_reward_club_payment_ready(c,p_witness,p_observed_at);
    if p_pending_nonce is null or p_pending_nonce !~ '^(0|[1-9][0-9]{0,15})$' or p_pending_nonce::numeric>9007199254740991 then
      raise exception using errcode='22023',message='invalid_reward_payment_request'; end if;
    if p_pending_nonce::numeric>i.nonce then raise exception using errcode='42501',message='reward_payment_nonce_consumed'; end if;
    previous_block:=i.chain_witness#>'{observation,finalizedBlock}';
    if (p_witness#>>'{observation,finalizedBlock,number}')::numeric<(previous_block->>'number')::numeric
      or (p_witness#>>'{observation,finalizedBlock,timestamp}')::numeric<(previous_block->>'timestamp')::numeric
      or ((p_witness#>>'{observation,finalizedBlock,number}')::numeric=(previous_block->>'number')::numeric
        and p_witness#>'{observation,finalizedBlock}' is distinct from previous_block) then
      raise exception using errcode='22023',message='reward_claim_observation_regressed'; end if;
    select attempt_body into first_body from app_private.reward_club_payment_attempts where payment_intent_id=i.id order by recorded_at,id limit 1;
    if first_body is not null and (first_body-array['transactionHash','signedTransaction','gasLimit','maxFeePerGas','maxPriorityFeePerGas'])
      is distinct from (p_attempt-array['transactionHash','signedTransaction','gasLimit','maxFeePerGas','maxPriorityFeePerGas']) then
      raise exception using errcode='22023',message='reward_payment_attempt_mismatch'; end if;
    if exists(select 1 from app_private.reward_club_payment_attempts where transaction_hash=decode(substr(p_attempt->>'transactionHash',3),'hex')) then
      raise exception using errcode='22023',message='reward_payment_transaction_already_recorded'; end if;
    insert into app_private.reward_club_payment_attempts(payment_intent_id,transaction_hash,attempt_body,recorded_by_user_id,recorded_session_id,idempotency_key)
      values(i.id,decode(substr(p_attempt->>'transactionHash',3),'hex'),p_attempt,p_actor_user_id,p_actor_session_id,p_idempotency_key) returning * into a;
    -- A table lock can delay INSERT after the earlier source/session read.
    -- New capabilities need a fresh check after that wait; exact old retries do not.
    c:=public.service_read_reward_club_claim_proofs(p_actor_user_id,p_actor_session_id,p_claim_intent_id,'operator');
    perform app_private.require_reward_club_payment_ready(c,p_witness,p_observed_at);
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator((c->>'programmeId')::uuid,p_actor_user_id);
  return jsonb_build_object('attemptId',a.id,'paymentIntentId',i.id,'claimIntentId',i.claim_intent_id,
    'recordedByUserId',a.recorded_by_user_id,'recordedAt',a.recorded_at,'transactionHash','0x'||encode(a.transaction_hash,'hex'));
end $$;

create function public.service_read_reward_club_payment_attempt(p_actor_user_id uuid,p_actor_session_id uuid,p_claim_intent_id uuid,p_payment_intent_id uuid,
  p_attempt_id uuid default null,p_idempotency_key text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c jsonb; a app_private.reward_club_payment_attempts%rowtype;
begin
  c:=public.service_read_reward_club_payment_context(p_actor_user_id,p_actor_session_id,p_claim_intent_id);
  if c#>>'{paymentIntent,paymentIntentId}' is distinct from p_payment_intent_id::text or p_payment_intent_id is null then
    raise exception using errcode='42501',message='reward_payment_intent_required'; end if;
  if (p_attempt_id is null)=(p_idempotency_key is null) or (p_idempotency_key is not null and length(p_idempotency_key) not between 8 and 128) then
    raise exception using errcode='22023',message='invalid_reward_payment_request'; end if;
  select * into a from app_private.reward_club_payment_attempts where payment_intent_id=p_payment_intent_id and recorded_by_user_id=p_actor_user_id
    and ((p_attempt_id is not null and id=p_attempt_id) or (p_idempotency_key is not null and idempotency_key=p_idempotency_key));
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator((c#>>'{claimContext,programmeId}')::uuid,p_actor_user_id);
  if a.id is null then
    if p_idempotency_key is not null then return null; end if;
    raise exception using errcode='42501',message='reward_payment_attempt_required'; end if;
  return jsonb_build_object('context',c,'attempt',jsonb_build_object('attemptId',a.id,'paymentIntentId',a.payment_intent_id,
    'body',a.attempt_body,'recordedByUserId',a.recorded_by_user_id,'recordedSessionId',a.recorded_session_id,
    'recordedAt',a.recorded_at,'idempotencyKey',a.idempotency_key));
end $$;

revoke all on function public.service_record_reward_club_payment_attempt(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb,timestamptz),
  public.service_read_reward_club_payment_attempt(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_record_reward_club_payment_attempt(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb,timestamptz),
  public.service_read_reward_club_payment_attempt(uuid,uuid,uuid,uuid,uuid,text) to service_role;
commit;
