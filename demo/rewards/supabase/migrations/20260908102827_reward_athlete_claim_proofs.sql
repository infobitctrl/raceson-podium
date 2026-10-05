begin;

-- Each signature is an exact award capability, not a wallet key. Keep both
-- signatures and their identity/security evidence private to the service.
create table app_private.reward_athlete_claim_proofs (
  id uuid primary key default gen_random_uuid(),
  claim_intent_id uuid not null references app_private.reward_athlete_claim_intents(id) on delete restrict,
  proof_role text not null check(proof_role in ('recipient','operator')),
  signer_address app_private.reward_address not null,
  message_digest app_private.reward_bytes32 not null,
  signature text not null check(signature ~ '^0x[0-9a-f]{130}$'),
  recorded_by_user_id uuid not null,
  recorded_session_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  chain_witness jsonb not null check(jsonb_typeof(chain_witness)='object' and octet_length(chain_witness::text)<32768),
  unique(claim_intent_id,proof_role)
);
create index reward_claim_proof_actor on app_private.reward_athlete_claim_proofs(recorded_by_user_id,id);
alter table app_private.reward_athlete_claim_proofs enable row level security;
revoke all on app_private.reward_athlete_claim_proofs from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_athlete_claim_proofs to service_role;
create policy reward_claim_proof_select on app_private.reward_athlete_claim_proofs for select to service_role using(true);
create policy reward_claim_proof_insert on app_private.reward_athlete_claim_proofs for insert to service_role with check(true);
create trigger reward_claim_proof_immutable before update or delete on app_private.reward_athlete_claim_proofs
  for each row execute function app_private.reject_reward_ledger_mutation();

create function app_private.reward_athlete_claim_proof_document(p app_private.reward_athlete_claim_proofs)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('proofId',p.id,'intentId',p.claim_intent_id,'role',p.proof_role,
    'signer',p.signer_address,'digest','0x'||encode(p.message_digest,'hex'),'signature',p.signature,
    'recordedByUserId',p.recorded_by_user_id,'recordedSessionId',p.recorded_session_id,
    'recordedAt',p.recorded_at,'idempotencyKey',p.idempotency_key,'chainWitness',p.chain_witness);
$$;

create function public.service_read_reward_athlete_claim_proofs(p_actor_user_id uuid,p_actor_session_id uuid,p_intent_id uuid,p_role text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare i app_private.reward_athlete_claim_intents%rowtype; c app_private.reward_campaigns%rowtype;
  p app_private.reward_programmes%rowtype; r app_private.reward_athlete_readiness_reviews%rowtype;
  u app_private.reward_upload_packages%rowtype; e app_private.reward_entitlements%rowtype;
  b app_private.reward_beneficiaries%rowtype; d app_private.reward_verified_deployments%rowtype;
  o app_private.reward_campaign_observations%rowtype; review_context jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select * into i from app_private.reward_athlete_claim_intents where id=p_intent_id;
  if not found then raise exception using errcode='42501',message='reward_claim_proof_scope_required'; end if;
  select * into c from app_private.reward_campaigns where id=i.campaign_id;
  select * into p from app_private.reward_programmes where id=c.programme_id;
  if p_role is null or p_role not in ('recipient','operator')
    or (p_role='recipient' and p_actor_user_id<>i.recipient_user_id)
    or (p_role='operator' and p_actor_user_id<>p.operator_user_id) then
    raise exception using errcode='42501',message='reward_claim_proof_scope_required'; end if;
  -- Programme authority remains current even when the actor is its recipient.
  -- This is subject eligibility, not a borrowed operator Auth session.
  perform app_private.require_reward_operator(p.id,p.operator_user_id);
  select * into r from app_private.reward_athlete_readiness_reviews where id=i.readiness_review_id;
  review_context:=app_private.reward_athlete_review_context(p.id,r.request_id);
  select * into e from app_private.reward_entitlements where id=i.entitlement_id;
  select * into b from app_private.reward_beneficiaries where id=e.beneficiary_id;
  select * into u from app_private.reward_upload_packages where id=i.upload_id;
  select * into d from app_private.reward_verified_deployments where campaign_id=c.id;
  select * into o from app_private.reward_campaign_observations where campaign_id=c.id
    order by finalized_block_number desc,observed_at desc,id desc limit 1;
  if d.campaign_id is null or o.id is null or u.allocation_id<>e.allocation_id or u.campaign_id<>c.id
    or b.kind<>'athlete' or b.campaign_id<>c.id or b.entity_id::text is distinct from review_context#>>'{destination,athleteProfileId}'
    or p.operator_user_id<>i.prepared_by_user_id then
    raise exception using errcode='42501',message='reward_claim_proof_scope_required'; end if;
  return jsonb_build_object('actorUserId',p_actor_user_id,'role',p_role,'programmeId',p.id,'operatorUserId',p.operator_user_id,
    'intent',app_private.reward_athlete_claim_document(i),'reviewContext',review_context,
    'upload',jsonb_build_object('id',u.id,'allocationId',u.allocation_id,'body',u.upload_body),
    'entitlement',jsonb_build_object('id',e.id,'onChainId','0x'||encode(e.on_chain_id,'hex'),'beneficiaryId','0x'||encode(b.on_chain_id,'hex'),
      'athleteProfileId',b.entity_id,'amountWei',e.amount_wei::text),
    'checkpoint',jsonb_build_object('deployment',d.identity_body,'observation',o.observation_body),
    'proofs',coalesce((select jsonb_agg(app_private.reward_athlete_claim_proof_document(proof) order by proof.proof_role)
      from app_private.reward_athlete_claim_proofs proof where proof.claim_intent_id=i.id),'[]'::jsonb));
end $$;

create function public.service_record_reward_athlete_claim_proof(p_actor_user_id uuid,p_actor_session_id uuid,p_intent_id uuid,p_role text,
  p_idempotency_key text,p_proof jsonb,p_witness jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare i app_private.reward_athlete_claim_intents%rowtype; prior app_private.reward_athlete_claim_proofs%rowtype;
  p app_private.reward_programmes%rowtype; r app_private.reward_athlete_readiness_reviews%rowtype;
  context jsonb; expected_signer text; stamp numeric; now_at timestamptz; previous_block jsonb;
begin
  context:=public.service_read_reward_athlete_claim_proofs(p_actor_user_id,p_actor_session_id,p_intent_id,p_role);
  select * into i from app_private.reward_athlete_claim_intents where id=p_intent_id;
  select * into p from app_private.reward_programmes where id=(context->>'programmeId')::uuid for update;
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||i.recipient_user_id::text,0));
  perform user_id from public.user_profiles where user_id in (p.operator_user_id,i.recipient_user_id) order by user_id for share;
  perform id from public.athlete_profiles where id=(context#>>'{entitlement,athleteProfileId}')::uuid for share;
  context:=public.service_read_reward_athlete_claim_proofs(p_actor_user_id,p_actor_session_id,p_intent_id,p_role);
  expected_signer:=case when p_role='operator' then p.operator_address else i.recipient_address end;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or jsonb_typeof(p_proof) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_proof))<>4
    or not p_proof ?& array['role','signer','digest','signature'] or p_proof->>'role' is distinct from p_role
    or p_proof->>'signer' is distinct from expected_signer
    or coalesce(p_proof->>'digest','') !~ '^0x[0-9a-f]{64}$' or p_proof->>'digest'='0x'||repeat('0',64)
    or coalesce(p_proof->>'signature','') !~ '^0x[0-9a-f]{130}$' then
    raise exception using errcode='22023',message='invalid_reward_claim_proof'; end if;
  select * into prior from app_private.reward_athlete_claim_proofs where claim_intent_id=i.id and proof_role=p_role;
  if found then
    if prior.idempotency_key<>p_idempotency_key or prior.recorded_by_user_id<>p_actor_user_id
      or prior.signer_address<>expected_signer or prior.message_digest<>decode(substr(p_proof->>'digest',3),'hex')
      or prior.signature<>p_proof->>'signature' then
      raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
    return context; -- exact historical retry, never fresh permission to send
  end if;
  select * into r from app_private.reward_athlete_readiness_reviews where id=i.readiness_review_id;
  if context#>>'{reviewContext,reviewState}' is distinct from 'reviewed'
    or context#>>'{reviewContext,latestReview,reviewId}' is distinct from r.id::text
    or context#>>'{reviewContext,profileFingerprintSha256}' is distinct from r.profile_fingerprint_sha256 then
    raise exception using errcode='42501',message='reward_claim_readiness_required'; end if;
  if p_role='operator' and not exists(select 1 from app_private.reward_athlete_claim_proofs where claim_intent_id=i.id and proof_role='recipient') then
    raise exception using errcode='42501',message='reward_claim_recipient_consent_required'; end if;
  perform app_private.assert_reward_allocation_source_current((context#>>'{upload,allocationId}')::uuid,p.operator_user_id);
  perform app_private.require_reward_athlete_claim_witness(p_witness,jsonb_build_object(
    'lifecycleContext',jsonb_build_object('upload',context->'upload','checkpoint',context->'checkpoint'),
    'reviewContext',context->'reviewContext','entitlement',context->'entitlement'));
  stamp:=(p_witness#>>'{observation,finalizedBlock,timestamp}')::numeric;now_at:=clock_timestamp();
  if (p_witness#>>'{award,nonce}')::numeric<>i.nonce or stamp<i.issued_at or stamp>=i.expires_at then
    raise exception using errcode='42501',message='reward_claim_not_live'; end if;
  if p_observed_at is null or p_observed_at>now_at+interval '5 seconds' or p_observed_at<now_at-interval '2 minutes'
    or (context#>>'{upload,body,sourceReviewEndsAt}')::numeric>extract(epoch from now_at)
    or (p.chain_id=10143 and (stamp>extract(epoch from now_at)+5 or stamp<extract(epoch from now_at)-120
      or i.expires_at<=extract(epoch from now_at))) then
    raise exception using errcode='42501',message='reward_claim_observation_stale'; end if;
  -- The intent and both proofs are monotonic observations of this same nonce.
  for previous_block in select i.chain_witness#>'{observation,finalizedBlock}' union all
    select proof.chain_witness#>'{observation,finalizedBlock}' from app_private.reward_athlete_claim_proofs proof where proof.claim_intent_id=i.id loop
    if (p_witness#>>'{observation,finalizedBlock,number}')::numeric<(previous_block->>'number')::numeric
      or stamp<(previous_block->>'timestamp')::numeric
      or ((p_witness#>>'{observation,finalizedBlock,number}')::numeric=(previous_block->>'number')::numeric
        and p_witness#>'{observation,finalizedBlock}' is distinct from previous_block) then
      raise exception using errcode='22023',message='reward_claim_observation_regressed'; end if;
  end loop;
  insert into app_private.reward_athlete_claim_proofs(claim_intent_id,proof_role,signer_address,message_digest,signature,
    recorded_by_user_id,recorded_session_id,idempotency_key,chain_witness)
    values(i.id,p_role,expected_signer,decode(substr(p_proof->>'digest',3),'hex'),p_proof->>'signature',
      p_actor_user_id,p_actor_session_id,p_idempotency_key,p_witness);
  return public.service_read_reward_athlete_claim_proofs(p_actor_user_id,p_actor_session_id,p_intent_id,p_role);
end $$;

revoke all on function app_private.reward_athlete_claim_proof_document(app_private.reward_athlete_claim_proofs),
  public.service_read_reward_athlete_claim_proofs(uuid,uuid,uuid,text),
  public.service_record_reward_athlete_claim_proof(uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_athlete_claim_proof_document(app_private.reward_athlete_claim_proofs),
  public.service_read_reward_athlete_claim_proofs(uuid,uuid,uuid,text),
  public.service_record_reward_athlete_claim_proof(uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz) to service_role;
commit;
