begin;

-- Durable gas-payer reservation, not a signed transaction, send lease or payment.
create table app_private.reward_club_payment_intents (
  id uuid primary key default gen_random_uuid(),
  claim_intent_id uuid not null unique references app_private.reward_club_claim_intents(id) on delete restrict,
  chain_id integer not null check(chain_id in (10143,31337)),
  relayer_address app_private.reward_address not null,
  nonce app_private.reward_uint256 not null check(nonce<=9007199254740991),
  recipient_proof_id uuid not null references app_private.reward_club_claim_proofs(id) on delete restrict,
  operator_proof_id uuid not null references app_private.reward_club_claim_proofs(id) on delete restrict,
  prepared_by_user_id uuid not null,
  prepared_session_id uuid not null,
  prepared_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  chain_witness jsonb not null check(jsonb_typeof(chain_witness)='object' and octet_length(chain_witness::text)<32768),
  check(recipient_proof_id<>operator_proof_id),
  unique(id,chain_id,relayer_address,nonce)
);
create index reward_club_payment_recipient_proof on app_private.reward_club_payment_intents(recipient_proof_id);
create index reward_club_payment_operator_proof on app_private.reward_club_payment_intents(operator_proof_id);

-- Keep the existing cross-programme book and its operator/relayer role lock.
-- Every slot has exactly one real typed owner; every owner has its exact slot.
alter table app_private.reward_relayer_nonce_slots
  alter column athlete_payment_intent_id drop not null,
  add column club_payment_intent_id uuid unique,
  add constraint reward_relayer_exactly_one_owner check(num_nonnulls(athlete_payment_intent_id,club_payment_intent_id)=1),
  add constraint reward_relayer_club_slot_identity unique(chain_id,relayer_address,nonce,club_payment_intent_id),
  add constraint reward_relayer_club_owner foreign key(club_payment_intent_id,chain_id,relayer_address,nonce)
    references app_private.reward_club_payment_intents(id,chain_id,relayer_address,nonce) on delete restrict;
alter table app_private.reward_club_payment_intents add constraint reward_club_payment_requires_nonce_slot
  foreign key(chain_id,relayer_address,nonce,id)
  references app_private.reward_relayer_nonce_slots(chain_id,relayer_address,nonce,club_payment_intent_id)
  deferrable initially deferred;
create function app_private.record_reward_club_relayer_nonce_slot()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_schema<>'app_private' or tg_table_name<>'reward_club_payment_intents' or tg_op<>'INSERT' then
    raise exception using errcode='22023',message='invalid_reward_nonce_owner'; end if;
  insert into app_private.reward_relayer_nonce_slots(chain_id,relayer_address,nonce,club_payment_intent_id)
    values(new.chain_id,new.relayer_address,new.nonce,new.id);
  return new;
end $$;
create trigger reward_club_payment_nonce_slot after insert on app_private.reward_club_payment_intents
  for each row execute function app_private.record_reward_club_relayer_nonce_slot();

alter table app_private.reward_club_payment_intents enable row level security;
revoke all on app_private.reward_club_payment_intents from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_club_payment_intents to service_role;
create policy reward_club_payment_select on app_private.reward_club_payment_intents for select to service_role using(true);
create policy reward_club_payment_insert on app_private.reward_club_payment_intents for insert to service_role with check(true);
create trigger reward_club_payment_immutable before update or delete on app_private.reward_club_payment_intents
  for each row execute function app_private.reject_reward_ledger_mutation();

create function app_private.reward_club_payment_document(i app_private.reward_club_payment_intents)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('paymentIntentId',i.id,'claimIntentId',i.claim_intent_id,'chainId',i.chain_id,
    'relayerAddress',i.relayer_address,'nonce',i.nonce::text,'recipientProofId',i.recipient_proof_id,'operatorProofId',i.operator_proof_id,
    'preparedByUserId',i.prepared_by_user_id,'preparedSessionId',i.prepared_session_id,'preparedAt',i.prepared_at,
    'idempotencyKey',i.idempotency_key,'chainWitness',i.chain_witness);
$$;
create function public.service_read_reward_club_payment_context(p_actor_user_id uuid,p_actor_session_id uuid,p_claim_intent_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c jsonb; i app_private.reward_club_payment_intents%rowtype; result jsonb;
begin
  c:=public.service_read_reward_club_claim_proofs(p_actor_user_id,p_actor_session_id,p_claim_intent_id,'operator');
  select * into i from app_private.reward_club_payment_intents where claim_intent_id=p_claim_intent_id;
  result:=jsonb_build_object('claimContext',c,'paymentIntent',case when i.id is null then null else app_private.reward_club_payment_document(i) end);
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator((c->>'programmeId')::uuid,p_actor_user_id);
  return result;
end $$;

create function app_private.lock_reward_club_payment_context(p_actor_user_id uuid,p_actor_session_id uuid,p_claim_intent_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c jsonb; i app_private.reward_club_claim_intents%rowtype; d app_private.reward_club_treasury_requests%rowtype;
begin
  c:=public.service_read_reward_club_claim_proofs(p_actor_user_id,p_actor_session_id,p_claim_intent_id,'operator');
  select * into i from app_private.reward_club_claim_intents where id=p_claim_intent_id;
  select q.* into d from app_private.reward_club_treasury_requests q join app_private.reward_club_treasury_reviews r on r.request_id=q.id where r.id=i.treasury_review_id;
  perform id from app_private.reward_programmes where id=(c->>'programmeId')::uuid for update;
  perform pg_advisory_xact_lock(hashtextextended('reward-club-account:'||i.recipient_user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('reward-club-treasury:'||i.club_id::text||':'||d.chain_id::text,0));
  perform user_id from public.user_profiles where user_id in(p_actor_user_id,i.recipient_user_id) order by user_id for share;
  perform id from public.clubs where id=i.club_id for share;
  perform id from public.athlete_profiles where claimed_by_user_id=i.recipient_user_id or id=(d.owner_identity->>'athleteProfileId')::uuid order by id for share;
  perform id from public.club_memberships where club_id=i.club_id order by id for share;
  perform id from public.club_roles where club_id=i.club_id order by id for share;
  return public.service_read_reward_club_claim_proofs(p_actor_user_id,p_actor_session_id,p_claim_intent_id,'operator');
end $$;

-- Structural defence only. The private service must reverify both approvals,
-- original Safe provenance/current consent, the exact award and relayer EOA.
create function app_private.require_reward_club_payment_ready(c jsonb,w jsonb,observed_at timestamptz)
returns void language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare cc jsonb:=c->'claimContext'; i jsonb:=cc->'intent'; stamp numeric; now_at timestamptz; prior jsonb;
begin
  if jsonb_array_length(c->'proofs')<>2 then raise exception using errcode='42501',message='reward_payment_approvals_required'; end if;
  if cc#>>'{reviewContext,reviewState}' is distinct from 'reviewed'
    or cc#>>'{reviewContext,latestReview,reviewId}' is distinct from i->>'treasuryReviewId'
    or cc#>>'{reviewContext,identityFingerprintSha256}' is distinct from cc#>>'{review,identityFingerprintSha256}' then
    raise exception using errcode='42501',message='reward_claim_readiness_required'; end if;
  perform app_private.assert_reward_allocation_source_current((cc#>>'{lifecycleContext,upload,allocationId}')::uuid,(c->>'operatorUserId')::uuid);
  perform app_private.require_reward_club_claim_witness(w,cc);
  stamp:=(w#>>'{observation,finalizedBlock,timestamp}')::numeric; now_at:=clock_timestamp();
  if w#>>'{award,nonce}' is distinct from i->>'nonce' or stamp<(i->>'issuedAt')::numeric
    or stamp>=(i->>'expiresAt')::numeric then raise exception using errcode='42501',message='reward_claim_not_live'; end if;
  if w#>'{treasury,executionNonce}' is distinct from i#>'{chainWitness,treasury,executionNonce}' then
    raise exception using errcode='42501',message='reward_club_execution_changed_since_review'; end if;
  if observed_at is null or observed_at>now_at+interval '5 seconds' or observed_at<now_at-interval '2 minutes'
    or (cc#>>'{lifecycleContext,upload,body,sourceReviewEndsAt}')::numeric>extract(epoch from now_at)
    or ((cc#>>'{lifecycleContext,upload,body,chainId}')::integer=10143 and (stamp>extract(epoch from now_at)+5 or stamp<extract(epoch from now_at)-120
      or (i->>'expiresAt')::numeric<=extract(epoch from now_at))) then
    raise exception using errcode='42501',message='reward_claim_observation_stale'; end if;
  for prior in select i#>'{chainWitness,observation,finalizedBlock}' union all
    select value#>'{chainWitness,observation,finalizedBlock}' from jsonb_array_elements(c->'proofs') loop
    if (w#>>'{observation,finalizedBlock,number}')::numeric<(prior->>'number')::numeric or stamp<(prior->>'timestamp')::numeric
      or ((w#>>'{observation,finalizedBlock,number}')::numeric=(prior->>'number')::numeric and w#>'{observation,finalizedBlock}' is distinct from prior) then
      raise exception using errcode='22023',message='reward_claim_observation_regressed'; end if;
  end loop;
end $$;

create function public.service_reserve_reward_club_payment(p_actor_user_id uuid,p_actor_session_id uuid,p_claim_intent_id uuid,
  p_relayer_address text,p_idempotency_key text,p_observed_chain_id integer,p_pending_nonce text,p_witness jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c jsonb; cc jsonb; i app_private.reward_club_payment_intents%rowtype; next_nonce numeric; chain integer;
begin
  c:=public.service_read_reward_club_claim_proofs(p_actor_user_id,p_actor_session_id,p_claim_intent_id,'operator'); cc:=c->'claimContext';
  chain:=(cc#>>'{lifecycleContext,upload,body,chainId}')::integer;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or p_relayer_address is null or p_relayer_address !~ '^0x[0-9a-f]{40}$' or p_relayer_address in('0x'||repeat('0',40),'0x'||repeat('0',39)||'1')
    or p_observed_chain_id is distinct from chain or p_pending_nonce is null or p_pending_nonce !~ '^(0|[1-9][0-9]{0,15})$'
    or p_pending_nonce::numeric>9007199254740991 then raise exception using errcode='22023',message='invalid_reward_payment_request'; end if;
  if p_relayer_address in(cc#>>'{lifecycleContext,upload,body,operatorAddress}',cc#>>'{lifecycleContext,upload,body,treasuryAddress}',
    cc#>>'{intent,recipientAddress}',cc#>>'{lifecycleContext,checkpoint,deployment,contractAddress}') then
    raise exception using errcode='22023',message='reward_separate_relayer_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||chain::text||':'||p_relayer_address,0));
  c:=app_private.lock_reward_club_payment_context(p_actor_user_id,p_actor_session_id,p_claim_intent_id);
  select * into i from app_private.reward_club_payment_intents where claim_intent_id=p_claim_intent_id;
  if found then
    if i.idempotency_key<>p_idempotency_key or i.relayer_address<>p_relayer_address or i.prepared_by_user_id<>p_actor_user_id then
      raise exception using errcode='22023',message='reward_payment_already_planned'; end if;
    return public.service_read_reward_club_payment_context(p_actor_user_id,p_actor_session_id,p_claim_intent_id);
  end if;
  perform app_private.require_reward_club_payment_ready(c,p_witness,p_observed_at);
  select greatest(p_pending_nonce::numeric,coalesce(max(nonce)+1,0)) into next_nonce from app_private.reward_relayer_nonce_slots
    where chain_id=chain and relayer_address=p_relayer_address;
  if next_nonce>9007199254740991 then raise exception using errcode='22023',message='reward_payment_nonce_exhausted'; end if;
  insert into app_private.reward_club_payment_intents(claim_intent_id,chain_id,relayer_address,nonce,recipient_proof_id,operator_proof_id,
    prepared_by_user_id,prepared_session_id,idempotency_key,chain_witness)
    values(p_claim_intent_id,chain,p_relayer_address,next_nonce,
      (select (value->>'proofId')::uuid from jsonb_array_elements(c->'proofs') where value->>'role'='recipient'),
      (select (value->>'proofId')::uuid from jsonb_array_elements(c->'proofs') where value->>'role'='operator'),
      p_actor_user_id,p_actor_session_id,p_idempotency_key,p_witness);
  return public.service_read_reward_club_payment_context(p_actor_user_id,p_actor_session_id,p_claim_intent_id);
end $$;

revoke all on function app_private.record_reward_club_relayer_nonce_slot(),
  app_private.reward_club_payment_document(app_private.reward_club_payment_intents),
  app_private.lock_reward_club_payment_context(uuid,uuid,uuid),app_private.require_reward_club_payment_ready(jsonb,jsonb,timestamptz),
  public.service_read_reward_club_payment_context(uuid,uuid,uuid),
  public.service_reserve_reward_club_payment(uuid,uuid,uuid,text,text,integer,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function app_private.record_reward_club_relayer_nonce_slot(),
  app_private.reward_club_payment_document(app_private.reward_club_payment_intents),
  app_private.lock_reward_club_payment_context(uuid,uuid,uuid),app_private.require_reward_club_payment_ready(jsonb,jsonb,timestamptz),
  public.service_read_reward_club_payment_context(uuid,uuid,uuid),
  public.service_reserve_reward_club_payment(uuid,uuid,uuid,text,text,integer,text,jsonb,timestamptz) to service_role;
commit;
