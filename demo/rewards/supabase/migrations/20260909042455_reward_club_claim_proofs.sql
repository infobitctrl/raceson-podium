begin;

-- Exact payout capabilities, not keys. Only verified private services store
-- these; SQL checks scope/shape/current authority, not signature cryptography.
create table app_private.reward_club_claim_proofs (
  id uuid primary key default gen_random_uuid(),
  claim_intent_id uuid not null references app_private.reward_club_claim_intents(id) on delete restrict,
  proof_role text not null check(proof_role in ('recipient','operator')),
  signer_address app_private.reward_address not null,
  message_digest app_private.reward_bytes32 not null,
  wrapped_digest app_private.reward_bytes32,
  signature text not null,
  recorded_by_user_id uuid not null,
  recorded_session_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  chain_witness jsonb not null check(jsonb_typeof(chain_witness)='object' and octet_length(chain_witness::text)<32768),
  check((proof_role='operator' and wrapped_digest is null and signature ~ '^0x[0-9a-f]{130}$')
    or (proof_role='recipient' and wrapped_digest is not null and length(signature)<=16386 and signature ~ '^0x([0-9a-f]{2})+$')),
  unique(claim_intent_id,proof_role)
);
create index reward_club_claim_proof_actor on app_private.reward_club_claim_proofs(recorded_by_user_id,id);
alter table app_private.reward_club_claim_proofs enable row level security;
revoke all on app_private.reward_club_claim_proofs from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_club_claim_proofs to service_role;
create policy reward_club_claim_proof_select on app_private.reward_club_claim_proofs for select to service_role using(true);
create policy reward_club_claim_proof_insert on app_private.reward_club_claim_proofs for insert to service_role with check(true);
create trigger reward_club_claim_proof_immutable before update or delete on app_private.reward_club_claim_proofs
  for each row execute function app_private.reject_reward_ledger_mutation();

create function app_private.reward_club_claim_proof_document(p app_private.reward_club_claim_proofs)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('proofId',p.id,'intentId',p.claim_intent_id,'role',p.proof_role,
    'signer',p.signer_address,'digest','0x'||encode(p.message_digest,'hex'),
    'wrappedDigest',case when p.wrapped_digest is null then null else '0x'||encode(p.wrapped_digest,'hex') end,
    'signature',p.signature,'recordedByUserId',p.recorded_by_user_id,'recordedSessionId',p.recorded_session_id,
    'recordedAt',p.recorded_at,'idempotencyKey',p.idempotency_key,'chainWitness',p.chain_witness);
$$;

create function public.service_read_reward_club_claim_proofs(p_actor_user_id uuid,p_actor_session_id uuid,p_intent_id uuid,p_role text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare i app_private.reward_club_claim_intents%rowtype; c app_private.reward_campaigns%rowtype;
  p app_private.reward_programmes%rowtype; r app_private.reward_club_treasury_reviews%rowtype;
  e app_private.reward_entitlements%rowtype; b app_private.reward_beneficiaries%rowtype;
  u app_private.reward_upload_packages%rowtype; review_context jsonb; claim_context jsonb; result jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select * into i from app_private.reward_club_claim_intents where id=p_intent_id;
  if not found then raise exception using errcode='42501',message='reward_claim_proof_scope_required'; end if;
  select * into c from app_private.reward_campaigns where id=i.campaign_id;
  select * into p from app_private.reward_programmes where id=c.programme_id;
  if p_role is null or p_role not in ('recipient','operator')
    or (p_role='recipient' and p_actor_user_id<>i.recipient_user_id)
    or (p_role='operator' and p_actor_user_id<>p.operator_user_id) then
    raise exception using errcode='42501',message='reward_claim_proof_scope_required'; end if;
  -- Current programme subject authority, not an operator Auth session borrowed
  -- by the recipient. The actual caller session is checked before/after reads.
  perform app_private.require_reward_operator(p.id,p.operator_user_id);
  select * into r from app_private.reward_club_treasury_reviews where id=i.treasury_review_id;
  review_context:=app_private.reward_club_review_context(p.id,r.request_id)||jsonb_build_object('retryReview',null);
  select * into e from app_private.reward_entitlements where id=i.entitlement_id;
  select * into b from app_private.reward_beneficiaries where id=e.beneficiary_id;
  select * into u from app_private.reward_upload_packages where id=i.upload_id;
  if r.programme_id is distinct from p.id or b.kind is distinct from 'club' or b.campaign_id is distinct from c.id
    or b.entity_id is distinct from i.club_id or b.entity_id::text is distinct from review_context#>>'{nomination,clubId}'
    or u.allocation_id is distinct from e.allocation_id or u.campaign_id is distinct from c.id
    or i.recipient_user_id::text is distinct from review_context#>>'{nomination,userId}'
    or i.recipient_address is distinct from r.evidence#>>'{candidate,safeAddress}'
    or p.operator_user_id is distinct from i.prepared_by_user_id then
    raise exception using errcode='42501',message='reward_claim_proof_scope_required'; end if;
  claim_context:=jsonb_build_object('reviewContext',review_context,'review',app_private.reward_club_review_document(r),
    'lifecycleContext',public.service_read_reward_lifecycle_context(c.id,p.operator_user_id,u.id,null,null),
    'entitlement',jsonb_build_object('id',e.id,'onChainId','0x'||encode(e.on_chain_id,'hex'),
      'beneficiaryId','0x'||encode(b.on_chain_id,'hex'),'clubId',b.entity_id,'amountWei',e.amount_wei::text),
    'intent',app_private.reward_club_claim_document(i));
  result:=jsonb_build_object('actorUserId',p_actor_user_id,'role',p_role,'programmeId',p.id,'operatorUserId',p.operator_user_id,
    'claimContext',claim_context,'proofs',coalesce((select jsonb_agg(app_private.reward_club_claim_proof_document(proof) order by proof.proof_role)
      from app_private.reward_club_claim_proofs proof where proof.claim_intent_id=i.id),'[]'::jsonb));
  if app_private.reward_club_review_fingerprint(r.request_id) is distinct from review_context->>'identityFingerprintSha256' then
    raise exception using errcode='22023',message='reward_club_review_identity_changed'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p.id,p.operator_user_id);
  return result;
end $$;

create function public.service_record_reward_club_claim_proof(p_actor_user_id uuid,p_actor_session_id uuid,p_intent_id uuid,p_role text,
  p_idempotency_key text,p_proof jsonb,p_witness jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare i app_private.reward_club_claim_intents%rowtype; prior app_private.reward_club_claim_proofs%rowtype;
  p app_private.reward_programmes%rowtype; r app_private.reward_club_treasury_reviews%rowtype;
  d app_private.reward_club_treasury_requests%rowtype; context jsonb; cc jsonb; expected_signer text;
  stamp numeric; now_at timestamptz; previous_block jsonb;
begin
  context:=public.service_read_reward_club_claim_proofs(p_actor_user_id,p_actor_session_id,p_intent_id,p_role);
  select * into i from app_private.reward_club_claim_intents where id=p_intent_id;
  select * into p from app_private.reward_programmes where id=(context->>'programmeId')::uuid for update;
  select * into r from app_private.reward_club_treasury_reviews where id=i.treasury_review_id;
  select * into d from app_private.reward_club_treasury_requests where id=r.request_id;
  perform pg_advisory_xact_lock(hashtextextended('reward-club-account:'||i.recipient_user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('reward-club-treasury:'||i.club_id::text||':'||p.chain_id::text,0));
  perform user_id from public.user_profiles where user_id in(p.operator_user_id,i.recipient_user_id) order by user_id for share;
  perform id from public.clubs where id=i.club_id for share;
  perform id from public.athlete_profiles where claimed_by_user_id=i.recipient_user_id or id=(d.owner_identity->>'athleteProfileId')::uuid order by id for share;
  perform id from public.club_memberships where club_id=i.club_id order by id for share;
  perform id from public.club_roles where club_id=i.club_id order by id for share;
  context:=public.service_read_reward_club_claim_proofs(p_actor_user_id,p_actor_session_id,p_intent_id,p_role);
  cc:=context->'claimContext'; expected_signer:=case when p_role='operator' then p.operator_address else i.recipient_address end;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or jsonb_typeof(p_proof) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_proof))<>5
    or not p_proof ?& array['role','signer','digest','wrappedDigest','signature'] or p_proof->>'role' is distinct from p_role
    or p_proof->>'signer' is distinct from expected_signer
    or coalesce(p_proof->>'digest','') !~ '^0x[0-9a-f]{64}$' or p_proof->>'digest'='0x'||repeat('0',64)
    or (p_role='operator' and (p_proof->'wrappedDigest' is distinct from 'null'::jsonb or coalesce(p_proof->>'signature','') !~ '^0x[0-9a-f]{130}$'))
    or (p_role='recipient' and (coalesce(p_proof->>'wrappedDigest','') !~ '^0x[0-9a-f]{64}$'
      or p_proof->>'wrappedDigest'='0x'||repeat('0',64) or length(p_proof->>'signature')>16386
      or coalesce(p_proof->>'signature','') !~ '^0x([0-9a-f]{2})+$')) then
    raise exception using errcode='22023',message='invalid_reward_claim_proof'; end if;
  select * into prior from app_private.reward_club_claim_proofs where claim_intent_id=i.id and proof_role=p_role;
  if found then
    if prior.idempotency_key<>p_idempotency_key or prior.recorded_by_user_id<>p_actor_user_id
      or prior.signer_address<>expected_signer or prior.message_digest<>decode(substr(p_proof->>'digest',3),'hex')
      or prior.wrapped_digest is distinct from decode(substr(p_proof->>'wrappedDigest',3),'hex') or prior.signature<>p_proof->>'signature' then
      raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
    return context; -- Exact history only. No fresh approval or refreshed window.
  end if;
  if cc#>>'{reviewContext,reviewState}' is distinct from 'reviewed'
    or cc#>>'{reviewContext,latestReview,reviewId}' is distinct from r.id::text
    or cc#>>'{reviewContext,identityFingerprintSha256}' is distinct from r.identity_fingerprint_sha256 then
    raise exception using errcode='42501',message='reward_claim_readiness_required'; end if;
  if p_role='operator' and not exists(select 1 from app_private.reward_club_claim_proofs where claim_intent_id=i.id and proof_role='recipient') then
    raise exception using errcode='42501',message='reward_claim_recipient_consent_required'; end if;
  perform app_private.assert_reward_allocation_source_current((cc#>>'{lifecycleContext,upload,allocationId}')::uuid,p.operator_user_id);
  perform app_private.require_reward_club_claim_witness(p_witness,cc);
  stamp:=(p_witness#>>'{observation,finalizedBlock,timestamp}')::numeric; now_at:=clock_timestamp();
  if (p_witness#>>'{award,nonce}')::numeric<>i.nonce or stamp<i.issued_at or stamp>=i.expires_at then
    raise exception using errcode='42501',message='reward_claim_not_live'; end if;
  if p_observed_at is null or p_observed_at>now_at+interval '5 seconds' or p_observed_at<now_at-interval '2 minutes'
    or (cc#>>'{lifecycleContext,upload,body,sourceReviewEndsAt}')::numeric>extract(epoch from now_at)
    or (p.chain_id=10143 and (stamp>extract(epoch from now_at)+5 or stamp<extract(epoch from now_at)-120 or i.expires_at<=extract(epoch from now_at))) then
    raise exception using errcode='42501',message='reward_claim_observation_stale'; end if;
  if p_witness#>'{treasury,executionNonce}' is distinct from i.chain_witness#>'{treasury,executionNonce}' then
    raise exception using errcode='42501',message='reward_club_execution_changed_since_review'; end if;
  for previous_block in select i.chain_witness#>'{observation,finalizedBlock}' union all
    select proof.chain_witness#>'{observation,finalizedBlock}' from app_private.reward_club_claim_proofs proof where proof.claim_intent_id=i.id loop
    if (p_witness#>>'{observation,finalizedBlock,number}')::numeric<(previous_block->>'number')::numeric
      or stamp<(previous_block->>'timestamp')::numeric
      or ((p_witness#>>'{observation,finalizedBlock,number}')::numeric=(previous_block->>'number')::numeric
        and p_witness#>'{observation,finalizedBlock}' is distinct from previous_block) then
      raise exception using errcode='22023',message='reward_claim_observation_regressed'; end if;
  end loop;
  insert into app_private.reward_club_claim_proofs(claim_intent_id,proof_role,signer_address,message_digest,wrapped_digest,signature,
    recorded_by_user_id,recorded_session_id,idempotency_key,chain_witness)
    values(i.id,p_role,expected_signer,decode(substr(p_proof->>'digest',3),'hex'),decode(substr(p_proof->>'wrappedDigest',3),'hex'),p_proof->>'signature',
      p_actor_user_id,p_actor_session_id,p_idempotency_key,p_witness);
  return public.service_read_reward_club_claim_proofs(p_actor_user_id,p_actor_session_id,p_intent_id,p_role);
end $$;

revoke all on function app_private.reward_club_claim_proof_document(app_private.reward_club_claim_proofs),
  public.service_read_reward_club_claim_proofs(uuid,uuid,uuid,text),
  public.service_record_reward_club_claim_proof(uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_club_claim_proof_document(app_private.reward_club_claim_proofs),
  public.service_read_reward_club_claim_proofs(uuid,uuid,uuid,text),
  public.service_record_reward_club_claim_proof(uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz) to service_role;
commit;
