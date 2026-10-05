begin;

-- This is an immutable prepared upload, not a deployment/funding/activation row.
create table app_private.reward_upload_packages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app_private.reward_campaigns(id),
  allocation_id uuid not null references app_private.reward_allocations(id) unique,
  prepared_by_user_id uuid not null,
  prepared_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  upload_body jsonb not null check (jsonb_typeof(upload_body) = 'object' and octet_length(upload_body::text) <= 8388608),
  evidence_body jsonb not null check (jsonb_typeof(evidence_body) = 'object' and octet_length(evidence_body::text) <= 8388608),
  unique (campaign_id, prepared_by_user_id, idempotency_key)
);
alter table app_private.reward_upload_packages enable row level security;
revoke all on app_private.reward_upload_packages from public, anon, authenticated, service_role;
grant select, insert on app_private.reward_upload_packages to service_role;
create policy reward_upload_packages_select on app_private.reward_upload_packages for select to service_role using (true);
create policy reward_upload_packages_insert on app_private.reward_upload_packages for insert to service_role with check (true);
create trigger reward_upload_immutable before update or delete on app_private.reward_upload_packages
  for each row execute function app_private.reject_reward_ledger_mutation();

-- Full raw source packets remain separately immutable. Their private SHA256
-- references enter this SALTED envelope, never a public unsalted source hash.
create function app_private.reward_allocation_evidence(p_allocation_id uuid)
returns jsonb language sql stable security invoker set search_path = '' set timezone = 'UTC' as $$
  select jsonb_build_object('schemaVersion',1,'kind','raceson-allocation-evidence-v1',
    'programmeId',p.id,'campaignId',c.id,'allocationId',a.id,'configuration',p.configuration,
    'targetSnapshot',jsonb_build_object('snapshotId',s.id,'sourceFingerprintSha256',s.source_fingerprint_sha256),
    'sportingReview',jsonb_build_object('id',r.id,'revision',r.revision,'reviewedAt',r.reviewed_at,
      'reviewedByUserId',r.reviewed_by_user_id,'body',r.review_body),
    'calculation',a.allocation_body->'calculation',
    'recordApprovals',coalesce((select jsonb_agg(jsonb_build_object('approvalId',ap.id,
        'targetSnapshotId',ap.target_snapshot_id,'priorSnapshotId',ap.prior_snapshot_id,
        'priorSourceFingerprintSha256',ps.source_fingerprint_sha256,'body',ap.request_body) order by ap.id)
      from jsonb_array_elements(r.review_body->'roundReviews') rr,
        jsonb_array_elements(rr->'records') rec
      join app_private.reward_record_approvals ap on ap.id::text = rec#>>'{baseline,approvalId}'
      join app_private.reward_record_source_snapshots ps on ps.id = ap.prior_snapshot_id),'[]'::jsonb))
  from app_private.reward_allocations a join app_private.reward_campaigns c on c.id=a.campaign_id
    join app_private.reward_programmes p on p.id=c.programme_id join app_private.reward_sporting_reviews r on r.id=a.review_id
    join app_private.reward_source_snapshots s on s.id=r.source_snapshot_id where a.id=p_allocation_id;
$$;

create function app_private.reward_allocation_publication_time(p_allocation_id uuid)
returns bigint language sql stable security invoker set search_path = '' as $$
  with source as (select s.source_body, r.review_body from app_private.reward_allocations a
    join app_private.reward_sporting_reviews r on r.id=a.review_id
    join app_private.reward_source_snapshots s on s.id=r.source_snapshot_id where a.id=p_allocation_id),
  instants as (
    select (m#>>'{publication,publishedAt}')::timestamptz as at from source, jsonb_array_elements(source_body->'mappings') m
    union all
    select (ps.source_body#>>'{publication,publishedAt}')::timestamptz from source,
      jsonb_array_elements(review_body->'roundReviews') rr, jsonb_array_elements(rr->'records') rec
      join app_private.reward_record_approvals ap on ap.id::text=rec#>>'{baseline,approvalId}'
      join app_private.reward_record_source_snapshots ps on ps.id=ap.prior_snapshot_id
  ) select ceil(max(extract(epoch from at)))::bigint from instants;
$$;

-- Caller holds the programme lock; this is evidence currentness only. It cannot
-- prove deployment, funding, chain finality or the separate 24-hour staging clock.
create function app_private.assert_reward_allocation_source_current(p_allocation_id uuid, p_actor_user_id uuid)
returns void language plpgsql stable security invoker set search_path = '' as $$
declare a app_private.reward_allocations%rowtype; c app_private.reward_campaigns%rowtype;
  p app_private.reward_programmes%rowtype; r app_private.reward_sporting_reviews%rowtype; s app_private.reward_source_snapshots%rowtype;
begin
  select * into a from app_private.reward_allocations where id=p_allocation_id;
  select * into c from app_private.reward_campaigns where id=a.campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into p from app_private.reward_programmes where id=c.programme_id;
  select * into r from app_private.reward_sporting_reviews where id=a.review_id;
  select * into s from app_private.reward_source_snapshots where id=r.source_snapshot_id;
  if r.revision <> (select max(revision) from app_private.reward_sporting_reviews where campaign_id=c.id) then
    raise exception using errcode='55000',message='reward_review_superseded'; end if;
  if public.service_read_reward_source(p.organization_id,p.league_season_id,c.round_ids,p_actor_user_id) is distinct from s.source_body then
    raise exception using errcode='55000',message='reward_review_source_changed'; end if;
  if exists (select 1 from jsonb_array_elements(s.source_body->'adjudicationCases') x
    where x->>'state' not in ('closed','withdrawn') or (x->>'recomputeRequired')::boolean) then
    raise exception using errcode='55000',message='reward_round_has_unresolved_adjudication'; end if;
  perform app_private.assert_reward_record_review_current(c.id,s.id,p_actor_user_id,r.review_body);
end $$;

-- Sensitive server-only bundle: includes private salts, never return from HTTP.
create function public.service_read_reward_allocation_export(p_campaign_id uuid,p_actor_user_id uuid,p_allocation_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' set timezone = 'UTC' as $$
declare a app_private.reward_allocations%rowtype; c app_private.reward_campaigns%rowtype; p app_private.reward_programmes%rowtype;
begin
  select * into c from app_private.reward_campaigns where id=p_campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into p from app_private.reward_programmes where id=c.programme_id;
  select * into a from app_private.reward_allocations where id=p_allocation_id and campaign_id=c.id;
  if a.id is null then raise exception using errcode='22023',message='reward_allocation_reference_mismatch'; end if;
  return jsonb_build_object('schemaVersion',1,
    'context',public.service_read_reward_calculation_context(c.id,p_actor_user_id,null,a.review_id),
    'chain',jsonb_build_object('programmeId','0x'||encode(p.on_chain_id,'hex'),'campaignId','0x'||encode(c.on_chain_id,'hex'),
      'programmeManifestHash','0x'||encode(p.manifest_hash,'hex'),'operatorAddress',p.operator_address,'treasuryAddress',p.treasury_address),
    'allocation',jsonb_build_object('id',a.id,'reviewId',a.review_id,'snapshotSalt','0x'||encode(a.snapshot_salt,'hex'),'body',a.allocation_body,
      'entitlements',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'entitlementId','0x'||encode(e.on_chain_id,'hex'),
        'beneficiaryId',b.entity_id,'beneficiaryKind',b.kind,'opaqueBeneficiaryId','0x'||encode(b.on_chain_id,'hex'),
        'amountWei',e.amount_wei::text,'explanation',e.explanation,'explanationSalt','0x'||encode(e.explanation_salt,'hex')) order by e.on_chain_id)
        from app_private.reward_entitlements e join app_private.reward_beneficiaries b on b.id=e.beneficiary_id where e.allocation_id=a.id),'[]'::jsonb)),
    'evidenceDocument',app_private.reward_allocation_evidence(a.id));
end $$;

create function public.service_save_reward_upload(p_campaign_id uuid,p_actor_user_id uuid,p_allocation_id uuid,
  p_idempotency_key text,p_upload jsonb,p_evidence jsonb)
returns jsonb language plpgsql security invoker set search_path = '' set timezone = 'UTC' as $$
declare a app_private.reward_allocations%rowtype; c app_private.reward_campaigns%rowtype; p app_private.reward_programmes%rowtype;
  saved app_private.reward_upload_packages%rowtype; expected_pot integer; publication_at bigint; award jsonb;
  previous_id text := '0x'||repeat('0',64); actual_count integer; expected_budget jsonb; expected_allocated jsonb;
begin
  select * into c from app_private.reward_campaigns where id=p_campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into p from app_private.reward_programmes where id=c.programme_id for update;
  perform app_private.require_reward_operator(p.id,p_actor_user_id);
  select * into a from app_private.reward_allocations where id=p_allocation_id and campaign_id=c.id;
  if a.id is null then raise exception using errcode='22023',message='reward_allocation_reference_mismatch'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or jsonb_typeof(p_upload) is distinct from 'object' or octet_length(p_upload::text)>8388608
    or jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>8388608 then
    raise exception using errcode='22023',message='invalid_reward_upload'; end if;
  select * into saved from app_private.reward_upload_packages where allocation_id=a.id;
  if found then
    if saved.prepared_by_user_id<>p_actor_user_id or saved.idempotency_key<>p_idempotency_key
      or saved.upload_body is distinct from p_upload or saved.evidence_body is distinct from p_evidence then
      raise exception using errcode='55000',message='reward_upload_already_prepared'; end if;
  else
    perform app_private.assert_reward_allocation_source_current(a.id,p_actor_user_id);
    expected_pot := case when c.pot='race' then 0 else 1 end;
    expected_budget := case when expected_pot=0 then jsonb_build_array(c.budget_wei::text,'0') else jsonb_build_array('0',c.budget_wei::text) end;
    expected_allocated := case when expected_pot=0 then jsonb_build_array(a.allocated_wei::text,'0') else jsonb_build_array('0',a.allocated_wei::text) end;
    publication_at := app_private.reward_allocation_publication_time(a.id);
    select count(*) into actual_count from app_private.reward_entitlements where allocation_id=a.id;
    if (select count(*) from jsonb_object_keys(p_upload))<>18 or p_upload->'schemaVersion' is distinct from '1'::jsonb
      or p_upload->'chainId' is distinct from to_jsonb(p.chain_id)
      or p_upload->>'programmeId' is distinct from '0x'||encode(p.on_chain_id,'hex')
      or p_upload->>'campaignId' is distinct from '0x'||encode(c.on_chain_id,'hex')
      or p_upload->>'programmeManifestHash' is distinct from '0x'||encode(p.manifest_hash,'hex')
      or p_upload->>'operatorAddress' is distinct from p.operator_address or p_upload->>'treasuryAddress' is distinct from p.treasury_address
      or p_upload->'enabledPot' is distinct from to_jsonb(expected_pot)
      or p_upload->'budgets' is distinct from expected_budget or p_upload->'allocated' is distinct from expected_allocated
      or p_upload->'unallocated' is distinct from to_jsonb(a.unallocated_wei::text)
      or p_upload->'entitlementCount' is distinct from to_jsonb(actual_count::text)
      or publication_at is null or publication_at<=0 or p_upload->'latestPublicationAt' is distinct from to_jsonb(publication_at::text)
      or p_upload->'sourceReviewEndsAt' is distinct from to_jsonb((publication_at+259200)::text)
      or jsonb_typeof(p_upload->'awards') is distinct from 'array' or jsonb_array_length(p_upload->'awards')<>actual_count
      or p_evidence is distinct from app_private.reward_allocation_evidence(a.id) then
      raise exception using errcode='22023',message='invalid_reward_upload'; end if;
    if coalesce(p_upload->>'snapshotDigest','') !~ '^0x[0-9a-f]{64}$' or (p_upload->>'snapshotDigest')='0x'||repeat('0',64)
      or coalesce(p_upload->>'allocationDigest','') !~ '^0x[0-9a-f]{64}$' or (p_upload->>'allocationDigest')='0x'||repeat('0',64)
      or coalesce(p_upload->>'uploadDigest','') !~ '^0x[0-9a-f]{64}$' then
      raise exception using errcode='22023',message='invalid_reward_upload'; end if;
    for award in select value from jsonb_array_elements(p_upload->'awards') loop
      if jsonb_typeof(award) is distinct from 'object' or (select count(*) from jsonb_object_keys(award))<>6
        or (award->>'entitlementId') is null or (award->>'entitlementId')<=previous_id
        or award->'pot' is distinct from to_jsonb(expected_pot)
        or coalesce(award->>'explanationHash','') !~ '^0x[0-9a-f]{64}$' or (award->>'explanationHash')='0x'||repeat('0',64)
        or not exists (select 1 from app_private.reward_entitlements e join app_private.reward_beneficiaries b on b.id=e.beneficiary_id
          where e.allocation_id=a.id and award->>'entitlementId'='0x'||encode(e.on_chain_id,'hex')
            and award->>'beneficiaryId'='0x'||encode(b.on_chain_id,'hex') and award->'amount'=to_jsonb(e.amount_wei::text)
            and award->'beneficiaryKind'=to_jsonb(case when b.kind='athlete' then 0 else 1 end)) then
        raise exception using errcode='22023',message='invalid_reward_upload'; end if;
      previous_id:=award->>'entitlementId';
    end loop;
    insert into app_private.reward_upload_packages(campaign_id,allocation_id,prepared_by_user_id,idempotency_key,upload_body,evidence_body)
      values(c.id,a.id,p_actor_user_id,p_idempotency_key,p_upload,p_evidence) returning * into saved;
  end if;
  return jsonb_build_object('uploadId',saved.id,'campaignId',saved.campaign_id,'allocationId',saved.allocation_id,
    'preparedByUserId',saved.prepared_by_user_id,'preparedAt',saved.prepared_at,'upload',saved.upload_body);
end $$;

-- Read-only evidence check under serialization. Not a durable permission token:
-- job creation/broadcast must recheck in their own authority/chain boundary.
create function public.service_check_reward_upload_evidence(p_campaign_id uuid,p_actor_user_id uuid,p_upload_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' set timezone = 'UTC' as $$
declare c app_private.reward_campaigns%rowtype; saved app_private.reward_upload_packages%rowtype;
begin
  select * into c from app_private.reward_campaigns where id=p_campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  perform 1 from app_private.reward_programmes where id=c.programme_id for update;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into saved from app_private.reward_upload_packages where id=p_upload_id and campaign_id=c.id;
  if saved.id is null then raise exception using errcode='22023',message='reward_upload_reference_mismatch'; end if;
  perform app_private.assert_reward_allocation_source_current(saved.allocation_id,p_actor_user_id);
  if saved.evidence_body is distinct from app_private.reward_allocation_evidence(saved.allocation_id) then
    raise exception using errcode='55000',message='reward_upload_evidence_changed'; end if;
  return jsonb_build_object('uploadId',saved.id,'allocationId',saved.allocation_id,'campaignId',c.id,
    'sourceReviewEndsAt',saved.upload_body->'sourceReviewEndsAt','checkedAt',clock_timestamp());
end $$;

revoke all on function app_private.reward_allocation_evidence(uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.reward_allocation_publication_time(uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.assert_reward_allocation_source_current(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_allocation_evidence(uuid) to service_role;
grant execute on function app_private.reward_allocation_publication_time(uuid) to service_role;
grant execute on function app_private.assert_reward_allocation_source_current(uuid,uuid) to service_role;
revoke all on function public.service_read_reward_allocation_export(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.service_save_reward_upload(uuid,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.service_check_reward_upload_evidence(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_read_reward_allocation_export(uuid,uuid,uuid) to service_role;
grant execute on function public.service_save_reward_upload(uuid,uuid,uuid,text,jsonb,jsonb) to service_role;
grant execute on function public.service_check_reward_upload_evidence(uuid,uuid,uuid) to service_role;

commit;
