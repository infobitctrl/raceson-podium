-- Isolated demo only. Preparation commits approved prize rows, NOT a final
-- publication, stage lease, wallet binding, signed transaction or payment.
begin;
create table app_private.reward_allocation_uploads_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  approval_id uuid not null unique references app_private.reward_allocation_approvals_v3(id),
  context_hash text not null check(context_hash~'^[0-9a-f]{64}$'),
  document_hash text not null check(document_hash~'^[0-9a-f]{64}$'),
  package_text text not null check(octet_length(package_text)<=4194304),
  package jsonb generated always as (package_text::jsonb) stored,
  package_hash text not null check(package_hash=encode(sha256(convert_to(package_text,'UTF8')),'hex')),
  prepared_at timestamptz not null default clock_timestamp(),
  prepared_by_user_id uuid not null references public.user_profiles(user_id)
);
create index reward_allocation_uploads_v3_actor on app_private.reward_allocation_uploads_v3(prepared_by_user_id);
alter table app_private.reward_allocation_uploads_v3 enable row level security;
revoke all on app_private.reward_allocation_uploads_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_allocation_uploads_v3 to service_role;
create policy reward_allocation_uploads_v3_read on app_private.reward_allocation_uploads_v3 for select to service_role using(true);
create policy reward_allocation_uploads_v3_insert on app_private.reward_allocation_uploads_v3 for insert to service_role with check(true);
create trigger reward_allocation_uploads_v3_immutable before update or delete on app_private.reward_allocation_uploads_v3
  for each row execute function app_private.reject_reward_ledger_mutation();

-- Sensitive service-only export. Salts and source-profile mappings never go to
-- HTTP. Read-back of an obsolete package is history, not current authority.
create function public.service_read_reward_allocation_upload_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; after_read jsonb; d jsonb; a app_private.reward_allocation_approvals_v3%rowtype;
  u app_private.reward_allocation_uploads_v3%rowtype; recipients jsonb;
begin
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(d->>'organizationId')::uuid for share;
  perform 1 from public.organizations where id=(d->>'organizationId')::uuid for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for share;
  v:=public.service_read_reward_allocation_approval_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,null);
  select * into a from app_private.reward_allocation_approvals_v3 where id=p_approval_id and draft_id=p_draft_id and slot=p_slot;
  if a.id is null then raise exception 'reward_allocation_upload_not_found'; end if;
  select * into u from app_private.reward_allocation_uploads_v3 where approval_id=a.id;
  select coalesce(jsonb_agg(jsonb_build_object('beneficiaryKind',r.beneficiary_kind,'sourceBeneficiaryId',r.source_beneficiary_id,
    'amountWei',r.amount_wei::text,'entitlementId','0x'||encode(r.entitlement_id,'hex'),'opaqueBeneficiaryId','0x'||encode(r.opaque_beneficiary_id,'hex'),
    'explanationSalt','0x'||encode(r.explanation_salt,'hex')) order by r.entitlement_id),'[]'::jsonb) into recipients
    from app_private.reward_allocation_recipients_v3 r where approval_id=a.id;
  after_read:=public.service_read_reward_allocation_approval_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,null);
  if after_read->>'contextHash' is distinct from v->>'contextHash' or after_read->'approval' is distinct from v->'approval'
    then raise exception 'reward_planning_revision_changed'; end if;
  return jsonb_build_object('schema','raceson-allocation-upload-private-v3','approvalId',a.id,'contextHash',v->>'contextHash',
    'current',coalesce(v#>>'{approval,id}'=a.id::text and (v#>>'{approval,current}')::boolean,false),
    'documentHash',a.document_hash,'document',a.document,'snapshotSalt','0x'||encode(a.snapshot_salt,'hex'),'recipients',recipients,
    'prepared',case when u.id is null then null else jsonb_build_object('id',u.id,'contextHash',u.context_hash,
      'documentHash',u.document_hash,'packageHash',u.package_hash,'package',u.package,'preparedAt',u.prepared_at,
      'preparedByUserId',u.prepared_by_user_id) end);
end $$;

create function public.service_prepare_reward_allocation_upload_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid,p_request_id uuid,p_context_hash text,p_document_hash text,p_package_text text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; d jsonb; p jsonb; r jsonb; saved app_private.reward_allocation_uploads_v3%rowtype;
  previous text:='0x'||repeat('0',64); amount numeric; total numeric:=0; rows_count integer:=0;
begin
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(d->>'organizationId')::uuid for share;
  perform 1 from public.organizations where id=(d->>'organizationId')::uuid for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  v:=public.service_read_reward_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid or p_package_text is null
    or octet_length(p_package_text)>4194304 then raise exception 'invalid_reward_allocation_upload'; end if;
  p:=p_package_text::jsonb;
  select * into saved from app_private.reward_allocation_uploads_v3 where id=p_request_id or approval_id=p_approval_id;
  if saved.id is not null then
    if saved.id is distinct from p_request_id or saved.approval_id is distinct from p_approval_id
      or saved.prepared_by_user_id is distinct from p_actor_user_id or saved.context_hash is distinct from p_context_hash
      or saved.document_hash is distinct from p_document_hash or saved.package_text is distinct from p_package_text
      then raise exception 'reward_allocation_upload_conflict'; end if;
    return v;
  end if;
  if v->>'contextHash' is distinct from p_context_hash or v->>'documentHash' is distinct from p_document_hash
    then raise exception 'reward_planning_revision_changed'; end if;
  if v->>'current' is distinct from 'true' then raise exception 'reward_allocation_not_ready'; end if;
  d:=v->'document';
  if jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>18
    or p->>'schema' is distinct from 'raceson-award-upload-v3' or p->>'protocolVersion' is distinct from '3'
    or p->>'chainId' is distinct from p_chain_id::text or p->>'enabledPot' is distinct from '0'
    or p->>'programmeAddress' is distinct from d#>>'{binding,programmeAddress}'
    or p->>'campaignAddress' is distinct from d#>>'{binding,campaignAddress}'
    or p->>'deploymentTransactionHash' is distinct from d#>>'{binding,deploymentTransactionHash}'
    or p->>'programmeId' is distinct from d#>>'{binding,programmeId}'
    or p->>'campaignId' is distinct from d#>>'{binding,campaignId}'
    or p->>'programmeManifestHash' is distinct from d#>>'{binding,programmeManifestHash}'
    or p->>'reviewPeriod' is distinct from d#>>'{binding,reviewSeconds}'
    or p->>'budgetWei' is distinct from d#>>'{calculation,budgetWei}'
    or p->>'allocatedWei' is distinct from d#>>'{calculation,proposedWei}'
    or p->>'unallocatedWei' is distinct from d#>>'{calculation,retainedWei}'
    or coalesce(p->>'snapshotDigest','') !~ '^0x[0-9a-f]{64}$' or p->>'snapshotDigest'='0x'||repeat('0',64)
    or coalesce(p->>'uploadDigest','') !~ '^0x[0-9a-f]{64}$'
    or jsonb_typeof(p->'awards') is distinct from 'array' or jsonb_array_length(p->'awards')>10000
    or p->>'entitlementCount' is distinct from jsonb_array_length(v->'recipients')::text
    then raise exception 'invalid_reward_allocation_upload'; end if;
  for r in select value from jsonb_array_elements(p->'awards') loop
    if jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>6
      or coalesce(r->>'entitlementId','') !~ '^0x[0-9a-f]{64}$' or r->>'entitlementId'<=previous
      or r->>'pot' is distinct from '0' or r->>'beneficiaryKind' not in ('0','1')
      or coalesce(r->>'amount','') !~ '^[1-9][0-9]{0,77}$'
      or coalesce(r->>'explanationHash','') !~ '^0x[0-9a-f]{64}$' or r->>'explanationHash'='0x'||repeat('0',64)
      then raise exception 'invalid_reward_allocation_upload'; end if;
    amount:=(r->>'amount')::numeric;
    if not exists(select 1 from app_private.reward_allocation_recipients_v3 b where b.approval_id=p_approval_id
      and '0x'||encode(b.entitlement_id,'hex')=r->>'entitlementId' and '0x'||encode(b.opaque_beneficiary_id,'hex')=r->>'beneficiaryId' and b.amount_wei=amount
      and (case b.beneficiary_kind when 'athlete' then '0' else '1' end)=r->>'beneficiaryKind')
      then raise exception 'invalid_reward_allocation_upload'; end if;
    previous:=r->>'entitlementId'; total:=total+amount; rows_count:=rows_count+1;
  end loop;
  if total::text is distinct from p->>'allocatedWei' or rows_count::text is distinct from p->>'entitlementCount'
    then raise exception 'invalid_reward_allocation_upload'; end if;
  -- Keccak/salted hashes are recomputed by the service on both save and reload;
  -- SQL independently enforces the exact persisted recipient/amount set.
  insert into app_private.reward_allocation_uploads_v3(id,approval_id,context_hash,document_hash,package_text,package_hash,prepared_by_user_id)
    values(p_request_id,p_approval_id,p_context_hash,p_document_hash,p_package_text,encode(sha256(convert_to(p_package_text,'UTF8')),'hex'),p_actor_user_id);
  v:=public.service_read_reward_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if v->>'contextHash' is distinct from p_context_hash or v->>'current' is distinct from 'true'
    then raise exception 'reward_planning_revision_changed'; end if;
  return v;
end $$;

revoke all on function public.service_read_reward_allocation_upload_v3(uuid,uuid,integer,uuid,integer,uuid) from public,anon,authenticated;
revoke all on function public.service_prepare_reward_allocation_upload_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.service_read_reward_allocation_upload_v3(uuid,uuid,integer,uuid,integer,uuid) to service_role;
grant execute on function public.service_prepare_reward_allocation_upload_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text) to service_role;
commit;
