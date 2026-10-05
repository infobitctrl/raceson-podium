begin;
-- Approval of an exact historical prize calculation. No wallet creation,
-- review-clock fabrication, stage/activation capability or paid-state write.
create table app_private.reward_allocation_approvals_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  draft_id uuid not null references app_private.reward_planning_drafts(id),
  slot integer not null check(slot between 1 and 4),
  previous_approval_id uuid,
  context_hash text not null check(context_hash ~ '^[0-9a-f]{64}$'),
  document_text text not null check(octet_length(document_text)<=4194304),
  document jsonb generated always as (document_text::jsonb) stored,
  document_hash text not null check(document_hash=encode(sha256(convert_to(document_text,'UTF8')),'hex')),
  funding_observation jsonb not null check(jsonb_typeof(funding_observation)='object'),
  snapshot_salt app_private.reward_bytes32 not null default public.gen_random_bytes(32) unique,
  approved_at timestamptz not null default clock_timestamp(),
  approved_by_user_id uuid not null references public.user_profiles(user_id),
  sequence bigint generated always as identity unique,
  unique(draft_id,slot,id),
  foreign key(draft_id,slot,previous_approval_id) references app_private.reward_allocation_approvals_v3(draft_id,slot,id),
  check(previous_approval_id is null or previous_approval_id<>id)
);
create index reward_allocation_approvals_v3_latest on app_private.reward_allocation_approvals_v3(draft_id,slot,sequence desc);
create table app_private.reward_allocation_recipients_v3 (
  approval_id uuid not null references app_private.reward_allocation_approvals_v3(id),
  beneficiary_kind text not null check(beneficiary_kind in ('athlete','club')),
  source_beneficiary_id uuid not null check(source_beneficiary_id<>'00000000-0000-0000-0000-000000000000'::uuid),
  amount_wei numeric(78,0) not null check(amount_wei>0 and amount_wei<power(2::numeric,256)),
  entitlement_id app_private.reward_bytes32 not null default public.gen_random_bytes(32) unique,
  opaque_beneficiary_id app_private.reward_bytes32 not null default public.gen_random_bytes(32) unique,
  explanation_salt app_private.reward_bytes32 not null default public.gen_random_bytes(32) unique,
  primary key(approval_id,beneficiary_kind,source_beneficiary_id)
);
alter table app_private.reward_allocation_approvals_v3 enable row level security;
alter table app_private.reward_allocation_recipients_v3 enable row level security;
revoke all on app_private.reward_allocation_approvals_v3,app_private.reward_allocation_recipients_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_allocation_approvals_v3,app_private.reward_allocation_recipients_v3 to service_role;
create policy reward_allocation_approvals_v3_read on app_private.reward_allocation_approvals_v3 for select to service_role using(true);
create policy reward_allocation_approvals_v3_write on app_private.reward_allocation_approvals_v3 for insert to service_role with check(true);
create policy reward_allocation_recipients_v3_read on app_private.reward_allocation_recipients_v3 for select to service_role using(true);
create policy reward_allocation_recipients_v3_write on app_private.reward_allocation_recipients_v3 for insert to service_role with check(true);
revoke all on sequence app_private.reward_allocation_approvals_v3_sequence_seq from public,anon,authenticated;
grant usage on sequence app_private.reward_allocation_approvals_v3_sequence_seq to service_role;
create trigger reward_allocation_approvals_v3_immutable before update or delete on app_private.reward_allocation_approvals_v3
  for each row execute function app_private.reject_reward_ledger_mutation();
create trigger reward_allocation_recipients_v3_immutable before update or delete on app_private.reward_allocation_recipients_v3
  for each row execute function app_private.reject_reward_ledger_mutation();

create function app_private.reward_allocation_approval_view_v3(p app_private.reward_allocation_approvals_v3,p_hash text)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('id',p.id,'previousApprovalId',p.previous_approval_id,'contextHash',p.context_hash,
    'documentHash',p.document_hash,'document',p.document,'approvedAt',p.approved_at,
    'approvedByUserId',p.approved_by_user_id,'current',p.context_hash=p_hash)
$$;
create function public.service_read_reward_allocation_approval_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare h jsonb; r jsonb; decision jsonb; c jsonb; hash text; latest app_private.reward_allocation_approvals_v3%rowtype;
  recorded app_private.reward_allocation_approvals_v3%rowtype;
begin
  if p_slot is null or p_slot not between 1 and 4 then raise exception 'invalid_reward_allocation_approval'; end if;
  h:=public.service_read_reward_historical_source_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  r:=public.service_read_reward_programme_registry_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select value into decision from jsonb_array_elements(h->'decisions') d where d->>'slot'=p_slot::text;
  c:=jsonb_build_object('sourceContextHash',h->'contextHash','decision',decision,'registry',r);
  hash:=encode(sha256(convert_to(c::text,'UTF8')),'hex');
  select * into latest from app_private.reward_allocation_approvals_v3 where draft_id=p_draft_id and slot=p_slot order by sequence desc limit 1;
  if p_request_id is not null then
    select * into recorded from app_private.reward_allocation_approvals_v3 where id=p_request_id;
    if found and (recorded.draft_id<>p_draft_id or recorded.slot<>p_slot or recorded.approved_by_user_id<>p_actor_user_id)
      then raise exception 'reward_allocation_approval_conflict'; end if;
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,(h#>>'{record,organizationId}')::uuid) then raise exception 'reward_planning_not_found'; end if;
  return jsonb_build_object('contextHash',hash,'sourceContextHash',h->'contextHash','decision',decision,'registry',r,
    'approval',case when latest.id is null then null else app_private.reward_allocation_approval_view_v3(latest,hash) end,
    'recorded',case when recorded.id is null then null else app_private.reward_allocation_approval_view_v3(recorded,hash) end);
end $$;

create function public.service_approve_reward_allocation_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_slot integer,p_request_id uuid,p_expected_approval_id uuid,p_context_hash text,p_document_text text,p_funding jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; d jsonb; source jsonb; saved app_private.reward_allocation_approvals_v3%rowtype; row jsonb; total numeric:=0; budget numeric;
begin
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(d->>'organizationId')::uuid for share;
  perform 1 from public.organizations where id=(d->>'organizationId')::uuid for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  v:=public.service_read_reward_allocation_approval_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_request_id);
  if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid then raise exception 'invalid_reward_allocation_approval'; end if;
  if v->'recorded'<>'null'::jsonb then
    if v#>>'{recorded,contextHash}' is distinct from p_context_hash or v#>>'{recorded,previousApprovalId}' is distinct from p_expected_approval_id::text
      or v#>'{recorded,document}' is distinct from p_document_text::jsonb then raise exception 'reward_allocation_approval_conflict'; end if;
    return v;
  end if;
  if v->>'contextHash' is distinct from p_context_hash then raise exception 'reward_planning_revision_changed'; end if;
  if v#>>'{approval,id}' is distinct from p_expected_approval_id::text then raise exception 'reward_allocation_approval_conflict'; end if;
  if coalesce(v#>>'{decision,current}','false')<>'true' or v#>>'{decision,decision}' is distinct from 'confirmed_final'
    or coalesce(v#>>'{registry,context,intent,current}','false')<>'true' or v#>>'{registry,registry,intentId}' is null
    then raise exception 'reward_allocation_not_ready'; end if;
  d:=p_document_text::jsonb;
  source:=public.service_read_reward_historical_source_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if d->>'schema' is distinct from 'raceson-allocation-document-v3' or d->>'slot' is distinct from p_slot::text
    or d->'record' is distinct from source->'record' or d->'workspace' is distinct from source->'workspace'
    or d->>'sourceHash' is distinct from source->>'sourceHash' or d->>'sourceContextHash' is distinct from v->>'sourceContextHash'
    or d#>>'{decision,id}' is distinct from v#>>'{decision,id}'
    or d#>>'{binding,intentId}' is distinct from v#>>'{registry,registry,intentId}'
    or d#>>'{binding,fundingApprovalId}' is distinct from v#>>'{registry,context,intent,approvalId}'
    or d#>>'{binding,programmeAddress}' is distinct from v#>>'{registry,registry,provenance,contractAddress}'
    or d#>>'{binding,deploymentTransactionHash}' is distinct from v#>>'{registry,registry,provenance,transactionHash}'
    or d#>>'{binding,programmeId}' is distinct from v#>>'{registry,registry,provenance,programmeId}'
    or d#>>'{binding,programmeManifestHash}' is distinct from v#>>'{registry,registry,provenance,programmeManifestHash}'
    then raise exception 'invalid_reward_allocation_approval'; end if;
  budget:=(d#>>'{calculation,budgetWei}')::numeric;
  if budget<=0 or budget<>(d#>>'{calculation,proposedWei}')::numeric+(d#>>'{calculation,retainedWei}')::numeric
    or exists(select 1 from jsonb_array_elements(d#>'{calculation,families}') f,
      jsonb_array_elements(f->'categories') c where c->'hold'<>'null'::jsonb)
    or coalesce(jsonb_typeof(d->'recipients'),'')<>'array' or jsonb_array_length(d->'recipients')>10000
    then raise exception 'reward_allocation_not_ready'; end if;
  -- These are trusted server observations, never request-body balances. The
  -- execution worker must recheck them and this exact latest approval before IO.
  if p_funding->>'address' is distinct from d#>>'{binding,campaignAddress}' or p_funding->>'routed' is distinct from 'true'
    or p_funding->>'state' not in ('0','1') or p_funding->>'paused' is distinct from 'false'
    or (p_funding->>'accountedFundingWei')::numeric is distinct from budget
    or (p_funding->>'capWei')::numeric is distinct from budget
    or p_funding->>'allocatedWei' is distinct from '0' or p_funding->>'paidWei' is distinct from '0'
    or p_funding->>'treasuryReturnedWei' is distinct from '0' then raise exception 'reward_allocation_not_ready'; end if;
  insert into app_private.reward_allocation_approvals_v3(id,draft_id,slot,previous_approval_id,context_hash,document_text,document_hash,funding_observation,approved_by_user_id)
    values(p_request_id,p_draft_id,p_slot,p_expected_approval_id,p_context_hash,p_document_text,
      encode(sha256(convert_to(p_document_text,'UTF8')),'hex'),p_funding,p_actor_user_id) returning * into saved;
  for row in select value from jsonb_array_elements(d->'recipients') loop
    insert into app_private.reward_allocation_recipients_v3(approval_id,beneficiary_kind,source_beneficiary_id,amount_wei)
      values(saved.id,row->>'beneficiaryKind',(row->>'beneficiaryId')::uuid,(row->>'amountWei')::numeric);
    total:=total+(row->>'amountWei')::numeric;
  end loop;
  if total<>(d#>>'{calculation,proposedWei}')::numeric then raise exception 'invalid_reward_allocation_approval'; end if;
  v:=public.service_read_reward_allocation_approval_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_request_id);
  if v->>'contextHash' is distinct from p_context_hash then raise exception 'reward_planning_revision_changed'; end if;
  return v;
end $$;
revoke all on function app_private.reward_allocation_approval_view_v3(app_private.reward_allocation_approvals_v3,text),
  public.service_read_reward_allocation_approval_v3(uuid,uuid,integer,uuid,integer,uuid),
  public.service_approve_reward_allocation_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_allocation_approval_view_v3(app_private.reward_allocation_approvals_v3,text),
  public.service_read_reward_allocation_approval_v3(uuid,uuid,integer,uuid,integer,uuid),
  public.service_approve_reward_allocation_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,jsonb) to service_role;
commit;
