begin;
-- Demo-only V3/domain-4 claims. No browser grants, generated keys or payouts.
create table app_private.reward_athlete_claims_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  upload_id uuid not null references app_private.reward_allocation_uploads_v3(id),
  destination_id uuid not null references app_private.reward_athlete_destination_requests(id),
  review_id uuid not null,
  entitlement_id app_private.reward_bytes32 not null references app_private.reward_allocation_recipients_v3(entitlement_id),
  chain_id integer not null check(chain_id in(31337,10143)),
  campaign_address app_private.reward_address not null,
  recipient_user_id uuid not null references public.user_profiles(user_id),
  recipient_address app_private.reward_address not null,
  source_guard_hash text not null check(source_guard_hash~'^[0-9a-f]{64}$'),
  profile_fingerprint text not null check(profile_fingerprint~'^[0-9a-f]{64}$'),
  witness jsonb not null check(jsonb_typeof(witness)='object' and octet_length(witness::text)<4096),
  nonce app_private.reward_uint256 not null,
  issued_at bigint not null check(issued_at>0),
  expires_at bigint not null check(expires_at>issued_at and expires_at<=issued_at+86400),
  prepared_by_user_id uuid not null references public.user_profiles(user_id),
  prepared_session_id uuid not null,
  prepared_at timestamptz not null default clock_timestamp(),
  sequence bigint generated always as identity unique,
  foreign key(upload_id,destination_id,review_id) references app_private.reward_athlete_readiness_v3(upload_id,destination_id,id)
);
create index reward_athlete_claims_v3_award on app_private.reward_athlete_claims_v3(chain_id,campaign_address,entitlement_id,sequence desc);
create index reward_athlete_claims_v3_upload on app_private.reward_athlete_claims_v3(upload_id,destination_id,review_id);
create index reward_athlete_claims_v3_destination on app_private.reward_athlete_claims_v3(destination_id);
create index reward_athlete_claims_v3_recipient on app_private.reward_athlete_claims_v3(recipient_user_id,id);
create index reward_athlete_claims_v3_operator on app_private.reward_athlete_claims_v3(prepared_by_user_id);
create index reward_athlete_claims_v3_entitlement on app_private.reward_athlete_claims_v3(entitlement_id);
create table app_private.reward_athlete_claim_proofs_v3 (
  claim_id uuid not null references app_private.reward_athlete_claims_v3(id),
  role text not null check(role in('recipient','operator')),
  proof jsonb not null check(jsonb_typeof(proof)='object' and octet_length(proof::text)<1024),
  witness jsonb not null check(jsonb_typeof(witness)='object' and octet_length(witness::text)<4096),
  recorded_by_user_id uuid not null references public.user_profiles(user_id),
  recorded_session_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(claim_id,role)
);
create index reward_athlete_claim_proofs_v3_actor on app_private.reward_athlete_claim_proofs_v3(recorded_by_user_id);
alter table app_private.reward_athlete_claims_v3 enable row level security;
alter table app_private.reward_athlete_claim_proofs_v3 enable row level security;
revoke all on app_private.reward_athlete_claims_v3,app_private.reward_athlete_claim_proofs_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_athlete_claims_v3,app_private.reward_athlete_claim_proofs_v3 to service_role;
create policy reward_claims_v3_read on app_private.reward_athlete_claims_v3 for select to service_role using(true);
create policy reward_claims_v3_insert on app_private.reward_athlete_claims_v3 for insert to service_role with check(true);
create policy reward_claim_proofs_v3_read on app_private.reward_athlete_claim_proofs_v3 for select to service_role using(true);
create policy reward_claim_proofs_v3_insert on app_private.reward_athlete_claim_proofs_v3 for insert to service_role with check(true);
revoke all on sequence app_private.reward_athlete_claims_v3_sequence_seq from public,anon,authenticated;
grant usage on sequence app_private.reward_athlete_claims_v3_sequence_seq to service_role;
create trigger reward_claims_v3_immutable before update or delete on app_private.reward_athlete_claims_v3
  for each row execute function app_private.reject_reward_ledger_mutation();
create trigger reward_claim_proofs_v3_immutable before update or delete on app_private.reward_athlete_claim_proofs_v3
  for each row execute function app_private.reject_reward_ledger_mutation();

create function app_private.reward_claim_document_v3(i app_private.reward_athlete_claims_v3)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select case when i.id is null then null else jsonb_build_object('id',i.id,'uploadId',i.upload_id,'destinationId',i.destination_id,
    'reviewId',i.review_id,'entitlementId','0x'||encode(i.entitlement_id,'hex'),'chainId',i.chain_id,'campaignAddress',i.campaign_address,
    'recipientUserId',i.recipient_user_id,'recipientAddress',i.recipient_address,'sourceGuardHash',i.source_guard_hash,
    'profileFingerprint',i.profile_fingerprint,'witness',i.witness,'nonce',i.nonce::text,'issuedAt',i.issued_at::text,'expiresAt',i.expires_at::text,
    'preparedByUserId',i.prepared_by_user_id,'preparedSessionId',i.prepared_session_id,'preparedAt',i.prepared_at) end
$$;

create function public.service_read_reward_claim_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_upload_id uuid,p_destination_id uuid,p_entitlement_id text,p_claim_id uuid,p_role text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; u app_private.reward_allocation_uploads_v3%rowtype; e app_private.reward_allocation_recipients_v3%rowtype;
  i app_private.reward_athlete_claims_v3%rowtype; d app_private.reward_programme_deployment_intents_v3%rowtype;
  f app_private.reward_programme_approvals_v3%rowtype; stage jsonb; activation jsonb; proofs jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if p_entitlement_id is null or p_entitlement_id!~'^0x[0-9a-f]{64}$' or p_claim_id is null
    or p_claim_id='00000000-0000-0000-0000-000000000000'::uuid then raise exception 'invalid_reward_claim_v3'; end if;
  -- Shared by every destination/claim for this award; taken before readiness's
  -- account/profile locks. Prevent concurrent overlapping authorization windows.
  perform pg_advisory_xact_lock(hashtextextended('reward-claim-v3:'||p_entitlement_id,0));
  v:=public.service_read_reward_readiness_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_upload_id,p_destination_id,p_role);
  select * into u from app_private.reward_allocation_uploads_v3 where id=p_upload_id;
  select * into e from app_private.reward_allocation_recipients_v3 where entitlement_id=decode(substr(p_entitlement_id,3),'hex')
    and approval_id=u.approval_id and beneficiary_kind='athlete' and source_beneficiary_id=(v#>>'{destination,athleteProfileId}')::uuid;
  if e.entitlement_id is null then raise exception 'reward_claim_scope_required'; end if;
  select * into i from app_private.reward_athlete_claims_v3 where id=p_claim_id;
  if i.id is not null and (i.upload_id<>p_upload_id or i.destination_id<>p_destination_id or i.entitlement_id<>e.entitlement_id
    or i.chain_id<>p_chain_id or i.recipient_user_id::text<>v#>>'{destination,userId}'
    or i.prepared_by_user_id::text<>v#>>'{source,operatorUserId}') then raise exception 'reward_claim_scope_required'; end if;
  if p_role='recipient' and i.id is null then raise exception 'reward_claim_scope_required'; end if;
  select * into d from app_private.reward_programme_deployment_intents_v3 where draft_id=(v#>>'{source,draftId}')::uuid;
  select * into f from app_private.reward_programme_approvals_v3 where id=d.approval_id;
  select jsonb_build_object('id',l.id,'body',l.body,'receipt',r.receipt) into stage
    from app_private.reward_programme_lifecycle_intents_v3 l
    join app_private.reward_programme_lifecycle_jobs_v3 j on j.intent_id=l.id and j.state='confirmed'
    join app_private.reward_programme_lifecycle_receipts_v3 r on r.job_id=j.id
    where l.upload_id=p_upload_id and l.body->>'action'='stage_allocation' order by l.step desc limit 1;
  select jsonb_build_object('id',l.id,'receipt',r.receipt) into activation
    from app_private.reward_programme_lifecycle_intents_v3 l
    join app_private.reward_programme_lifecycle_jobs_v3 j on j.intent_id=l.id and j.state='confirmed'
    join app_private.reward_programme_lifecycle_receipts_v3 r on r.job_id=j.id
    where l.upload_id=p_upload_id and l.body->>'action'='activate' and l.predecessor_id=(stage->>'id')::uuid order by l.step desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('role',p.role,'proof',p.proof,'witness',p.witness,
    'recordedByUserId',p.recorded_by_user_id,'recordedSessionId',p.recorded_session_id,'recordedAt',p.recorded_at) order by p.role),'[]'::jsonb)
    into proofs from app_private.reward_athlete_claim_proofs_v3 p where p.claim_id=i.id;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return jsonb_build_object('schema','raceson-athlete-claim-private-v3','readiness',v,'package',u.package,
    'deployment',jsonb_build_object('nonce',d.nonce::text,'terms',f.terms),'stage',stage,'activation',activation,
    'intent',app_private.reward_claim_document_v3(i),'proofs',proofs);
end $$;

-- Compact fresh chain witness, verified cryptographically by the API before
-- this private RPC. SQL independently binds it to its immutable package/receipt.
create function app_private.require_reward_claim_witness_v3(v jsonb,w jsonb,p_observed_at timestamptz)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare field text; now_at timestamptz:=clock_timestamp(); a jsonb; f jsonb; receipt jsonb;
begin
  if p_observed_at is null or p_observed_at>now_at+interval '5 seconds' or p_observed_at<now_at-interval '2 minutes'
    then raise exception 'reward_claim_observation_stale'; end if;
  if v->'stage'='null'::jsonb or v->'activation'='null'::jsonb then raise exception 'reward_claim_campaign_not_ready'; end if;
  if jsonb_typeof(w) is distinct from 'object' or (select count(*) from jsonb_object_keys(w))<>11
    or w->'protocolVersion' is distinct from '3'::jsonb then raise exception 'invalid_reward_claim_witness'; end if;
  foreach field in array array['amountWei','nonce','claimDeadline'] loop
    if jsonb_typeof(w->field) is distinct from 'string' or w->>field!~'^(0|[1-9][0-9]{0,77})$'
      or (w->>field)::numeric>=power(2::numeric,256) then raise exception 'invalid_reward_claim_witness'; end if;
  end loop;
  f:=w->'finalizedBlock';
  if jsonb_typeof(f) is distinct from 'object' or (select count(*) from jsonb_object_keys(f))<>3
    or coalesce(f->>'hash','')!~'^0x[0-9a-f]{64}$' then raise exception 'invalid_reward_claim_witness'; end if;
  foreach field in array array['number','timestamp'] loop
    if jsonb_typeof(f->field) is distinct from 'string' or f->>field!~'^[1-9][0-9]{0,18}$'
      or (f->>field)::numeric>9223372036854775807 then raise exception 'invalid_reward_claim_witness'; end if;
  end loop;
  select value into a from jsonb_array_elements(v->'package'->'awards') where value->>'entitlementId'=w->>'entitlementId';
  receipt:=v#>'{activation,receipt}';
  if a is null or a->>'beneficiaryKind'<>'0' or w->'chainId' is distinct from v#>'{package,chainId}'
    or w->>'campaignAddress' is distinct from v#>>'{package,campaignAddress}'
    or w->>'recipientAddress' is distinct from v#>>'{readiness,destination,address}'
    or w->>'stageTransactionHash' is distinct from v#>>'{stage,receipt,transactionHash}'
    or w->>'allocationDigest' is distinct from receipt#>>'{accountingAtReceiptBlock,allocationDigest}'
    or w->>'amountWei' is distinct from a->>'amount' or (w->>'nonce')::numeric>=power(2::numeric,256)-1
    or (w->>'claimDeadline')::numeric>(9223372036854775807::numeric-86400)
    or (w->>'claimDeadline')::numeric<=(f->>'timestamp')::numeric
    or (f->>'number')::numeric<(receipt->>'blockNumber')::numeric
    or (f->>'timestamp')::numeric<(receipt->>'blockTimestamp')::numeric
    or (f->>'number'=receipt->>'blockNumber' and f->>'hash'<>receipt->>'blockHash')
    then raise exception 'invalid_reward_claim_witness'; end if;
end $$;

create function public.service_prepare_reward_claim_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_upload_id uuid,p_destination_id uuid,p_entitlement_id text,p_claim_id uuid,p_review_id uuid,p_source_guard_hash text,
  p_profile_fingerprint text,p_witness jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; old app_private.reward_athlete_claims_v3%rowtype; prior app_private.reward_athlete_claims_v3%rowtype;
  issued bigint; expires bigint;
begin
  v:=public.service_read_reward_claim_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_upload_id,p_destination_id,p_entitlement_id,p_claim_id,'operator');
  select * into old from app_private.reward_athlete_claims_v3 where id=p_claim_id;
  if found then
    if old.review_id is distinct from p_review_id or old.source_guard_hash is distinct from p_source_guard_hash
      or old.profile_fingerprint is distinct from p_profile_fingerprint or old.witness is distinct from p_witness
      then raise exception 'reward_ledger_idempotency_conflict'; end if;
    return v; -- Immutable history, not a refreshed signing window.
  end if;
  if v#>>'{readiness,state}'<>'reviewed' or v#>>'{readiness,review,id}' is distinct from p_review_id::text
    or v#>>'{readiness,source,sourceGuardHash}' is distinct from p_source_guard_hash
    or v#>>'{readiness,profileFingerprint}' is distinct from p_profile_fingerprint then raise exception 'reward_claim_readiness_required'; end if;
  perform app_private.require_reward_claim_witness_v3(v,p_witness,p_observed_at);
  if p_witness->>'entitlementId' is distinct from p_entitlement_id then raise exception 'invalid_reward_claim_witness'; end if;
  issued:=(p_witness#>>'{finalizedBlock,timestamp}')::bigint;
  expires:=least(issued+86400,(p_witness->>'claimDeadline')::bigint);
  select * into prior from app_private.reward_athlete_claims_v3 where entitlement_id=decode(substr(p_entitlement_id,3),'hex')
    and chain_id=p_chain_id and campaign_address=p_witness->>'campaignAddress' order by sequence desc limit 1;
  if found then
    if (p_witness#>>'{finalizedBlock,number}')::numeric<(prior.witness#>>'{finalizedBlock,number}')::numeric
      or issued<prior.issued_at or (p_witness->>'nonce')::numeric<prior.nonce
      or (p_witness#>>'{finalizedBlock,number}'=prior.witness#>>'{finalizedBlock,number}'
        and p_witness#>>'{finalizedBlock,hash}'<>prior.witness#>>'{finalizedBlock,hash}') then raise exception 'reward_claim_observation_regressed'; end if;
    if (p_witness->>'nonce')::numeric=prior.nonce and issued<prior.expires_at then raise exception 'reward_claim_already_prepared'; end if;
  end if;
  insert into app_private.reward_athlete_claims_v3(id,upload_id,destination_id,review_id,entitlement_id,chain_id,campaign_address,
    recipient_user_id,recipient_address,source_guard_hash,profile_fingerprint,witness,nonce,issued_at,expires_at,prepared_by_user_id,prepared_session_id)
    values(p_claim_id,p_upload_id,p_destination_id,p_review_id,decode(substr(p_entitlement_id,3),'hex'),p_chain_id,p_witness->>'campaignAddress',
      (v#>>'{readiness,destination,userId}')::uuid,p_witness->>'recipientAddress',p_source_guard_hash,p_profile_fingerprint,p_witness,
      (p_witness->>'nonce')::numeric,issued,expires,p_actor_user_id,p_actor_session_id);
  return public.service_read_reward_claim_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_upload_id,p_destination_id,p_entitlement_id,p_claim_id,'operator');
end $$;

create function public.service_record_reward_claim_proof_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_upload_id uuid,p_destination_id uuid,p_entitlement_id text,p_claim_id uuid,p_role text,p_proof jsonb,p_witness jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; i app_private.reward_athlete_claims_v3%rowtype; old app_private.reward_athlete_claim_proofs_v3%rowtype; stamp numeric;
begin
  v:=public.service_read_reward_claim_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_upload_id,p_destination_id,p_entitlement_id,p_claim_id,p_role);
  select * into i from app_private.reward_athlete_claims_v3 where id=p_claim_id;
  if i.id is null then raise exception 'reward_claim_scope_required'; end if;
  select * into old from app_private.reward_athlete_claim_proofs_v3 where claim_id=i.id and role=p_role;
  if found then
    if old.proof is distinct from p_proof or old.recorded_by_user_id<>p_actor_user_id then raise exception 'reward_ledger_idempotency_conflict'; end if;
    return v; -- Retrying a proof is never current execution authority.
  end if;
  if v#>>'{readiness,state}'<>'reviewed' or v#>>'{readiness,review,id}'<>i.review_id::text
    or v#>>'{readiness,profileFingerprint}'<>i.profile_fingerprint or v#>>'{readiness,source,sourceGuardHash}'<>i.source_guard_hash
    then raise exception 'reward_claim_readiness_required'; end if;
  perform app_private.require_reward_claim_witness_v3(v,p_witness,p_observed_at);
  stamp:=(p_witness#>>'{finalizedBlock,timestamp}')::numeric;
  if p_witness->>'entitlementId' is distinct from p_entitlement_id or (p_witness->>'nonce')::numeric<>i.nonce
    or stamp<i.issued_at or stamp>=i.expires_at
    or (p_witness#>>'{finalizedBlock,number}')::numeric<(i.witness#>>'{finalizedBlock,number}')::numeric
    or (p_witness#>>'{finalizedBlock,number}'=i.witness#>>'{finalizedBlock,number}'
      and p_witness#>>'{finalizedBlock,hash}'<>i.witness#>>'{finalizedBlock,hash}') then raise exception 'reward_claim_window_unavailable'; end if;
  if p_role='operator' and not exists(select 1 from app_private.reward_athlete_claim_proofs_v3 where claim_id=i.id and role='recipient')
    then raise exception 'reward_recipient_consent_required'; end if;
  if exists(select 1 from app_private.reward_athlete_claim_proofs_v3 p where p.claim_id=i.id and (
    (p_witness#>>'{finalizedBlock,number}')::numeric<(p.witness#>>'{finalizedBlock,number}')::numeric
    or stamp<(p.witness#>>'{finalizedBlock,timestamp}')::numeric
    or (p_witness#>>'{finalizedBlock,number}'=p.witness#>>'{finalizedBlock,number}'
      and p_witness#>>'{finalizedBlock,hash}'<>p.witness#>>'{finalizedBlock,hash}')))
    then raise exception 'reward_claim_observation_regressed'; end if;
  if jsonb_typeof(p_proof) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_proof))<>5
    or p_proof->'protocolVersion' is distinct from '3'::jsonb or p_proof->>'role' is distinct from p_role
    or p_proof->>'signer' is distinct from (case when p_role='recipient' then i.recipient_address else v#>>'{readiness,source,operatorAddress}' end)
    or coalesce(p_proof->>'digest','')!~'^0x[0-9a-f]{64}$' or coalesce(p_proof->>'signature','')!~'^0x[0-9a-f]{130}$'
    then raise exception 'invalid_reward_claim_proof'; end if;
  insert into app_private.reward_athlete_claim_proofs_v3(claim_id,role,proof,witness,recorded_by_user_id,recorded_session_id)
    values(i.id,p_role,p_proof,p_witness,p_actor_user_id,p_actor_session_id);
  return public.service_read_reward_claim_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_upload_id,p_destination_id,p_entitlement_id,p_claim_id,p_role);
end $$;
create function public.service_list_own_reward_claims_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_after_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare result jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if p_chain_id is null or p_chain_id not in(31337,10143) then raise exception 'invalid_reward_claim_v3'; end if;
  perform 1 from public.user_profiles where user_id=p_actor_user_id for share;
  perform 1 from public.athlete_profiles where claimed_by_user_id=p_actor_user_id order by id for share;
  with own as (
    select i.* from app_private.reward_athlete_claims_v3 i
    join app_private.reward_athlete_destination_requests n on n.id=i.destination_id and n.user_id=p_actor_user_id
    join public.athlete_profiles p on p.id=n.athlete_profile_id and p.claimed_by_user_id=p_actor_user_id
    where i.recipient_user_id=p_actor_user_id and i.chain_id=p_chain_id and p.is_claimed and p.status='active'
      and p.merged_into_athlete_profile_id is null and (p_after_id is null or i.id>p_after_id) order by i.id limit 51
  ), page as(select * from own order by id limit 50)
  select jsonb_build_object('schema','raceson-own-claims-v3','chainId',p_chain_id,'items',coalesce((select jsonb_agg(
    jsonb_build_object('schema','raceson-athlete-claim-record-v3','claimId',i.id,'uploadId',i.upload_id,'destinationId',i.destination_id,
      'entitlementId','0x'||encode(i.entitlement_id,'hex'),'chainId',i.chain_id,'recipientAddress',i.recipient_address,
      'amountWei',i.witness->>'amountWei','issuedAt',i.issued_at::text,'expiresAt',i.expires_at::text,
      'recipientConsented',exists(select 1 from app_private.reward_athlete_claim_proofs_v3 p where p.claim_id=i.id and p.role='recipient'),
      'operatorApproved',exists(select 1 from app_private.reward_athlete_claim_proofs_v3 p where p.claim_id=i.id and p.role='operator')) order by i.id) from page i),'[]'::jsonb),
    'nextCursor',case when (select count(*) from own)>50 then (select id from page order by id desc limit 1) else null end) into result;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return result;
end $$;
revoke all on function public.service_list_own_reward_claims_v3(uuid,uuid,integer,uuid),app_private.reward_claim_document_v3(app_private.reward_athlete_claims_v3),
  app_private.require_reward_claim_witness_v3(jsonb,jsonb,timestamptz),
  public.service_read_reward_claim_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text),
  public.service_prepare_reward_claim_v3(uuid,uuid,integer,uuid,uuid,text,uuid,uuid,text,text,jsonb,timestamptz),
  public.service_record_reward_claim_proof_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.service_list_own_reward_claims_v3(uuid,uuid,integer,uuid),app_private.reward_claim_document_v3(app_private.reward_athlete_claims_v3),
  app_private.require_reward_claim_witness_v3(jsonb,jsonb,timestamptz),
  public.service_read_reward_claim_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text),
  public.service_prepare_reward_claim_v3(uuid,uuid,integer,uuid,uuid,text,uuid,uuid,text,text,jsonb,timestamptz),
  public.service_record_reward_claim_proof_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamptz) to service_role;
commit;
