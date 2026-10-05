begin;

-- Prepared exact messages, not signed approval, payout jobs or payment records.
create table app_private.reward_club_claim_intents (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app_private.reward_campaigns(id) on delete restrict,
  entitlement_id uuid not null references app_private.reward_entitlements(id) on delete restrict,
  treasury_review_id uuid not null references app_private.reward_club_treasury_reviews(id) on delete restrict,
  upload_id uuid not null references app_private.reward_upload_packages(id) on delete restrict,
  recipient_user_id uuid not null,
  club_id uuid not null references public.clubs(id) on delete restrict,
  recipient_address app_private.reward_address not null,
  nonce app_private.reward_uint256 not null,
  issued_at numeric not null check(issued_at=trunc(issued_at) and issued_at>0 and issued_at<18446744073709551616),
  expires_at numeric not null check(expires_at=trunc(expires_at) and expires_at<18446744073709551616),
  prepared_by_user_id uuid not null,
  prepared_session_id uuid not null,
  prepared_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  chain_witness jsonb not null check(jsonb_typeof(chain_witness)='object' and octet_length(chain_witness::text)<32768),
  check(expires_at>issued_at and expires_at-issued_at<=86400),
  unique(campaign_id,prepared_by_user_id,idempotency_key)
);
create index reward_club_claim_entitlement on app_private.reward_club_claim_intents(entitlement_id,issued_at desc,id);
create index reward_club_claim_review on app_private.reward_club_claim_intents(treasury_review_id);
create index reward_club_claim_upload on app_private.reward_club_claim_intents(upload_id);
create index reward_club_claim_recipient on app_private.reward_club_claim_intents(recipient_user_id,id);
create index reward_club_claim_club on app_private.reward_club_claim_intents(club_id,id);
alter table app_private.reward_club_claim_intents enable row level security;
revoke all on app_private.reward_club_claim_intents from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_club_claim_intents to service_role;
create policy reward_club_claim_select on app_private.reward_club_claim_intents for select to service_role using(true);
create policy reward_club_claim_insert on app_private.reward_club_claim_intents for insert to service_role with check(true);
create trigger reward_claim_immutable before update or delete on app_private.reward_club_claim_intents
  for each row execute function app_private.reject_reward_ledger_mutation();

create function app_private.reward_club_claim_document(i app_private.reward_club_claim_intents)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('intentId',i.id,'campaignId',i.campaign_id,'entitlementId',i.entitlement_id,
    'treasuryReviewId',i.treasury_review_id,'uploadId',i.upload_id,'recipientUserId',i.recipient_user_id,
    'clubId',i.club_id,'recipientAddress',i.recipient_address,'nonce',i.nonce::text,'issuedAt',i.issued_at::text,'expiresAt',i.expires_at::text,
    'preparedByUserId',i.prepared_by_user_id,'preparedSessionId',i.prepared_session_id,'preparedAt',i.prepared_at,
    'idempotencyKey',i.idempotency_key,'chainWitness',i.chain_witness);
$$;

-- Operator-private context. A historical intent remains readable after a hold;
-- this read never grants fresh approval or changes current readiness.
create function public.service_read_reward_club_claim_context(p_actor_user_id uuid,p_actor_session_id uuid,
  p_review_id uuid,p_entitlement_id uuid,p_idempotency_key text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare r app_private.reward_club_treasury_reviews%rowtype; e app_private.reward_entitlements%rowtype;
  b app_private.reward_beneficiaries%rowtype; c app_private.reward_campaigns%rowtype;
  u app_private.reward_upload_packages%rowtype; i app_private.reward_club_claim_intents%rowtype;
  review_context jsonb; lifecycle_context jsonb; result jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select * into r from app_private.reward_club_treasury_reviews where id=p_review_id;
  if not found then raise exception using errcode='42501',message='reward_claim_scope_required'; end if;
  perform app_private.require_reward_operator(r.programme_id,p_actor_user_id);
  select * into e from app_private.reward_entitlements where id=p_entitlement_id;
  select * into b from app_private.reward_beneficiaries where id=e.beneficiary_id;
  select * into c from app_private.reward_campaigns where id=b.campaign_id;
  if c.programme_id is distinct from r.programme_id or b.kind is distinct from 'club' then
    raise exception using errcode='42501',message='reward_claim_scope_required'; end if;
  review_context:=public.service_read_reward_club_review_context(r.programme_id,p_actor_user_id,p_actor_session_id,r.request_id);
  -- Retain merged awards; do not infer a new canonical payment mapping.
  if b.entity_id::text is distinct from review_context#>>'{nomination,clubId}' then
    raise exception using errcode='42501',message='reward_claim_identity_mapping_required'; end if;
  select * into u from app_private.reward_upload_packages where allocation_id=e.allocation_id and campaign_id=c.id;
  if not found then raise exception using errcode='42501',message='reward_claim_campaign_not_ready'; end if;
  lifecycle_context:=public.service_read_reward_lifecycle_context(c.id,p_actor_user_id,u.id,null,null);
  if p_idempotency_key is not null then
    if length(p_idempotency_key) not between 8 and 128 then
      raise exception using errcode='22023',message='invalid_reward_claim_request'; end if;
    select * into i from app_private.reward_club_claim_intents where campaign_id=c.id
      and prepared_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
    if found and (i.entitlement_id<>e.id or i.treasury_review_id<>r.id) then
      raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
  end if;
  result:=jsonb_build_object('reviewContext',review_context,'review',app_private.reward_club_review_document(r),'lifecycleContext',lifecycle_context,
    'entitlement',jsonb_build_object('id',e.id,'onChainId','0x'||encode(e.on_chain_id,'hex'),
      'beneficiaryId','0x'||encode(b.on_chain_id,'hex'),'clubId',b.entity_id,'amountWei',e.amount_wei::text),
    'intent',case when i.id is null then null else app_private.reward_club_claim_document(i) end);
  if app_private.reward_club_review_fingerprint(r.request_id) is distinct from review_context->>'identityFingerprintSha256' then
    raise exception using errcode='22023',message='reward_club_review_identity_changed'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(r.programme_id,p_actor_user_id);
  return result;
end $$;

-- Structural defence in depth. Only a service that verified the exact deployed
-- code, complete package and same-block unpaid club award and exact reviewed original Safe may supply this witness.
create function app_private.require_reward_club_claim_witness(p_witness jsonb,p_context jsonb)
returns void language plpgsql stable security invoker set search_path='' as $$
declare f jsonb; a jsonb; award jsonb; expected jsonb; u jsonb; d jsonb; field text; pot integer; prior jsonb; treasury jsonb; evidence jsonb;
begin
  u:=p_context#>'{lifecycleContext,upload,body}'; d:=p_context#>'{lifecycleContext,checkpoint,deployment}';
  if d is null or jsonb_typeof(d) is distinct from 'object' then
    raise exception using errcode='42501',message='reward_claim_campaign_not_ready'; end if;
  if jsonb_typeof(p_witness) is distinct from 'object' or octet_length(p_witness::text)>=32768
    or (select count(*) from jsonb_object_keys(p_witness))<>5
    or not p_witness ?& array['deployment','observation','award','recipient','treasury']
    or p_witness->'deployment' is distinct from d
    or p_witness->>'recipient' is distinct from p_context#>>'{review,evidence,candidate,safeAddress}'
    or jsonb_typeof(p_witness->'observation') is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_witness->'observation'))<>3
    or p_witness#>'{observation,schemaVersion}' is distinct from '1'::jsonb then
    raise exception using errcode='22023',message='invalid_reward_claim_witness'; end if;
  f:=p_witness#>'{observation,finalizedBlock}'; a:=p_witness#>'{observation,accounting}'; award:=p_witness->'award';
  if jsonb_typeof(f) is distinct from 'object' or (select count(*) from jsonb_object_keys(f))<>3
    or not f ?& array['number','hash','timestamp'] or coalesce(f->>'hash','') !~ '^0x[0-9a-f]{64}$'
    or f->>'hash'='0x'||repeat('0',64) then raise exception using errcode='22023',message='invalid_reward_claim_witness'; end if;
  foreach field in array array['number','timestamp'] loop
    if jsonb_typeof(f->field) is distinct from 'string' or f->>field !~ '^(0|[1-9][0-9]{0,77})$' then
      raise exception using errcode='22023',message='invalid_reward_claim_witness'; end if;
    perform (f->>field)::app_private.reward_uint256;
  end loop;
  if (f->>'timestamp')::numeric=0 or (f->>'timestamp')::numeric>=18446744073709465216 then
    raise exception using errcode='22023',message='invalid_reward_claim_witness'; end if;
  prior:=p_context#>'{lifecycleContext,checkpoint,observation,finalizedBlock}';
  if (f->>'number')::numeric<(prior->>'number')::numeric
    or (f->>'timestamp')::numeric<(prior->>'timestamp')::numeric
    or ((f->>'number')::numeric=(prior->>'number')::numeric and f is distinct from prior) then
    raise exception using errcode='22023',message='reward_claim_observation_regressed'; end if;
  pot:=(u->>'enabledPot')::integer;
  perform app_private.require_reward_campaign_accounting(a,pot);
  if a->'state' is distinct from '3'::jsonb or a->'paused' is distinct from 'false'::jsonb
    or (a->>'claimDeadline')::numeric<=(f->>'timestamp')::numeric
    or (a->>'activationNotBefore')::numeric>(f->>'timestamp')::numeric then
    raise exception using errcode='42501',message='reward_claim_campaign_not_ready'; end if;
  foreach field in array array['budgets','allocated','entitlementCount','uploadDigest','snapshotDigest','allocationDigest'] loop
    if a->field is distinct from u->field then raise exception using errcode='22023',message='invalid_reward_claim_witness'; end if;
  end loop;
  if (a->>'activationNotBefore')::numeric<(u->>'sourceReviewEndsAt')::numeric then
    raise exception using errcode='22023',message='invalid_reward_claim_witness'; end if;
  select value into expected from jsonb_array_elements(u->'awards') where value->>'entitlementId'=p_context#>>'{entitlement,onChainId}';
  if expected is null or expected->'beneficiaryKind' is distinct from '1'::jsonb
    or expected->>'amount' is distinct from p_context#>>'{entitlement,amountWei}'
    or expected->>'beneficiaryId' is distinct from p_context#>>'{entitlement,beneficiaryId}'
    or jsonb_typeof(award) is distinct from 'object' or (award-array['nonce','paid']) is distinct from expected
    or award->'paid' is distinct from 'false'::jsonb or jsonb_typeof(award->'nonce') is distinct from 'string'
    or award->>'nonce' !~ '^(0|[1-9][0-9]{0,77})$' then
    raise exception using errcode='22023',message='invalid_reward_claim_witness'; end if;
  perform (award->>'nonce')::app_private.reward_uint256;
  if (award->>'nonce')::numeric=115792089237316195423570985008687907853269984665640564039457584007913129639935 then
    raise exception using errcode='22023',message='reward_claim_nonce_exhausted'; end if;
  treasury:=p_witness->'treasury'; evidence:=p_context#>'{review,evidence}';
  if jsonb_typeof(treasury) is distinct from 'object' then raise exception using errcode='22023',message='invalid_reward_claim_witness'; end if;
  if (select array_agg(x order by x) from jsonb_object_keys(treasury) x) is distinct from
    array['buildId','deploymentBlock','deploymentTransactionHash','executionHistoryReviewRequired','executionNonce','factoryAddress',
      'fallbackHandlerAddress','finalizedBlock','initializerHash','owners','provenanceId','reviewedBlock','safeAddress','schemaVersion','scope','singletonAddress']::text[]
    or treasury->'schemaVersion' is distinct from '1'::jsonb
    or treasury->>'buildId' is distinct from 'safe-1.4.1-original-2-of-3-v1'
    or treasury->>'provenanceId' is distinct from 'safe-1.4.1-original-direct-initialization-v1'
    or treasury->>'scope' is distinct from 'initialization_only'
    or treasury->'executionHistoryReviewRequired' is distinct from 'true'::jsonb
    or treasury->'finalizedBlock' is distinct from f
    or jsonb_typeof(treasury->'executionNonce') is distinct from 'string'
    or (treasury->>'executionNonce' ~ '^(0|[1-9][0-9]{0,77})$') is not true then
    raise exception using errcode='22023',message='invalid_reward_claim_witness'; end if;
  perform (treasury->>'executionNonce')::app_private.reward_uint256;
  foreach field in array array['safeAddress','singletonAddress','fallbackHandlerAddress','owners'] loop
    if treasury->field is distinct from evidence->'candidate'->field then
      raise exception using errcode='22023',message='invalid_reward_claim_witness'; end if;
  end loop;
  foreach field in array array['factoryAddress','deploymentTransactionHash','initializerHash','deploymentBlock','reviewedBlock'] loop
    if treasury->field is distinct from evidence->field then raise exception using errcode='22023',message='invalid_reward_claim_witness'; end if;
  end loop;
  if (evidence->'reviewedBlock'->>'number')::numeric>(f->>'number')::numeric
    or (evidence->'reviewedBlock'->>'timestamp')::numeric>(f->>'timestamp')::numeric
    or (evidence->'reviewedBlock'->>'number'=f->>'number' and evidence->'reviewedBlock' is distinct from f) then
    raise exception using errcode='22023',message='invalid_reward_claim_witness'; end if;
end $$;

create function public.service_prepare_reward_club_claim(p_actor_user_id uuid,p_actor_session_id uuid,
  p_review_id uuid,p_entitlement_id uuid,p_idempotency_key text,p_witness jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare context jsonb; r app_private.reward_club_treasury_reviews%rowtype; d app_private.reward_club_treasury_requests%rowtype;
  i app_private.reward_club_claim_intents%rowtype; prior app_private.reward_club_claim_intents%rowtype;
  campaign uuid; upload uuid; now_at timestamptz; issued numeric; expires numeric; nonce numeric; block_number numeric;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select * into r from app_private.reward_club_treasury_reviews where id=p_review_id;
  if not found then raise exception using errcode='42501',message='reward_claim_scope_required'; end if;
  perform app_private.require_reward_operator(r.programme_id,p_actor_user_id);
  perform id from app_private.reward_programmes where id=r.programme_id for update;
  select * into d from app_private.reward_club_treasury_requests where id=r.request_id;
  perform pg_advisory_xact_lock(hashtextextended('reward-club-account:'||d.user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('reward-club-treasury:'||d.club_id::text||':'||d.chain_id::text,0));
  perform user_id from public.user_profiles where user_id in(p_actor_user_id,d.user_id) order by user_id for share;
  perform id from public.clubs where id=d.club_id for share;
  perform id from public.athlete_profiles where claimed_by_user_id=d.user_id or id=(d.owner_identity->>'athleteProfileId')::uuid order by id for share;
  perform id from public.club_memberships where club_id=d.club_id order by id for share;
  perform id from public.club_roles where club_id=d.club_id order by id for share;
  context:=public.service_read_reward_club_claim_context(p_actor_user_id,p_actor_session_id,p_review_id,p_entitlement_id,p_idempotency_key);
  if p_idempotency_key is null then raise exception using errcode='22023',message='invalid_reward_claim_request'; end if;
  -- Exact retry is history, including expired/held claims. It is not permission
  -- to sign, extend a window or submit the old claim to a relayer.
  if context->'intent' is distinct from 'null'::jsonb then return context; end if;
  if context#>>'{reviewContext,reviewState}' is distinct from 'reviewed'
    or context#>>'{reviewContext,latestReview,reviewId}' is distinct from r.id::text
    or context#>>'{reviewContext,identityFingerprintSha256}' is distinct from r.identity_fingerprint_sha256 then
    raise exception using errcode='42501',message='reward_claim_readiness_required'; end if;
  campaign:=(context#>>'{lifecycleContext,deploymentContext,campaignId}')::uuid;
  upload:=(context#>>'{lifecycleContext,upload,id}')::uuid;
  perform app_private.assert_reward_allocation_source_current((context#>>'{lifecycleContext,upload,allocationId}')::uuid,p_actor_user_id);
  perform app_private.require_reward_club_claim_witness(p_witness,context);
  now_at:=clock_timestamp(); issued:=(p_witness#>>'{observation,finalizedBlock,timestamp}')::numeric;
  expires:=least(issued+86400,(p_witness#>>'{observation,accounting,claimDeadline}')::numeric);
  nonce:=(p_witness#>>'{award,nonce}')::numeric; block_number:=(p_witness#>>'{observation,finalizedBlock,number}')::numeric;
  if p_observed_at is null or p_observed_at>now_at+interval '5 seconds' or p_observed_at<now_at-interval '2 minutes'
    or (context#>>'{lifecycleContext,upload,body,sourceReviewEndsAt}')::numeric>extract(epoch from now_at)
    or ((context#>>'{lifecycleContext,deploymentContext,chainId}')::integer=10143
      and (issued>extract(epoch from now_at)+5 or issued<extract(epoch from now_at)-120 or expires<=extract(epoch from now_at))) then
    raise exception using errcode='42501',message='reward_claim_observation_stale'; end if;
  for prior in select * from app_private.reward_club_claim_intents where entitlement_id=p_entitlement_id loop
    if prior.nonce>nonce or (prior.chain_witness#>>'{observation,finalizedBlock,number}')::numeric>block_number
      or ((prior.chain_witness#>>'{observation,finalizedBlock,number}')::numeric=block_number
        and prior.chain_witness#>'{observation,finalizedBlock}' is distinct from p_witness#>'{observation,finalizedBlock}') then
      raise exception using errcode='22023',message='reward_claim_observation_regressed'; end if;
    -- Until old proofs expire ON CHAIN, a changed address/review cannot replace
    -- a claim with the same nonce. Local withdrawal alone cannot revoke it.
    if prior.nonce=nonce and prior.expires_at>issued then
      raise exception using errcode='55000',message='reward_claim_already_prepared'; end if;
  end loop;
  insert into app_private.reward_club_claim_intents(campaign_id,entitlement_id,treasury_review_id,upload_id,recipient_user_id,
    recipient_address,club_id,nonce,issued_at,expires_at,prepared_by_user_id,prepared_session_id,idempotency_key,chain_witness)
    values(campaign,p_entitlement_id,r.id,upload,d.user_id,context#>>'{review,evidence,candidate,safeAddress}',d.club_id,nonce,issued,expires,p_actor_user_id,p_actor_session_id,p_idempotency_key,p_witness)
    returning * into i;
  -- Repeat all scope/session checks after insertion waits; failure rolls back it.
  return public.service_read_reward_club_claim_context(p_actor_user_id,p_actor_session_id,p_review_id,p_entitlement_id,p_idempotency_key);
end $$;

revoke all on function app_private.reward_club_claim_document(app_private.reward_club_claim_intents),
  app_private.require_reward_club_claim_witness(jsonb,jsonb),
  public.service_read_reward_club_claim_context(uuid,uuid,uuid,uuid,text),
  public.service_prepare_reward_club_claim(uuid,uuid,uuid,uuid,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_club_claim_document(app_private.reward_club_claim_intents),
  app_private.require_reward_club_claim_witness(jsonb,jsonb),
  public.service_read_reward_club_claim_context(uuid,uuid,uuid,uuid,text),
  public.service_prepare_reward_club_claim(uuid,uuid,uuid,uuid,text,jsonb,timestamptz) to service_role;
commit;
