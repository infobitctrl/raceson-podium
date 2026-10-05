begin;
-- V3.1 changes only unexposed allocation documents and the source context.
-- Existing append-only reviews remain intact and become stale once; never
-- relabel their original full-workspace context as approval of this new scope.
-- Funding already commits structural race/category mappings, not live counters.
create or replace function app_private.reward_historical_source_context_v3(p_view jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('schema','raceson-historical-source-context-v3.1',
    'record',p_view->'record',
    'scope',app_private.reward_programme_context_v3(p_view->'record',p_view->'workspace'),
    'sourceHash',p_view->'sourceHash')
$$;

create or replace function public.service_review_reward_historical_source_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_slot integer,p_request_id uuid,p_expected_review_id uuid,p_context_hash text,p_decision text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d jsonb; v jsonb; r jsonb; race jsonb; row_count integer; old app_private.reward_historical_source_reviews_v3%rowtype;
  saved app_private.reward_historical_source_reviews_v3%rowtype;
begin
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(d->>'organizationId')::uuid for share;
  perform 1 from public.organizations where id=(d->>'organizationId')::uuid for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  v:=public.service_read_reward_historical_source_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if p_slot is null or p_slot not between 1 and 4 or p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid
    or p_context_hash is null or p_context_hash !~ '^[0-9a-f]{64}$'
    or p_decision is null or p_decision not in ('confirmed_final','held') then raise exception 'invalid_reward_historical_source'; end if;
  select * into saved from app_private.reward_historical_source_reviews_v3 where id=p_request_id;
  if found then
    if saved.draft_id<>p_draft_id or saved.slot<>p_slot or saved.reviewed_by_user_id<>p_actor_user_id
      or saved.context_hash<>p_context_hash or saved.decision<>p_decision or saved.previous_review_id is distinct from p_expected_review_id
      then raise exception 'reward_historical_review_conflict'; end if;
    -- Recover exactly the old acknowledgement, even if a later hold superseded
    -- it. The current decisions remain separate; retry can never undo that hold.
    return v || jsonb_build_object('recordedDecision',app_private.reward_historical_source_decision_v3(saved,v->>'contextHash'));
  end if;
  if v->>'contextHash' is distinct from p_context_hash then raise exception 'reward_planning_revision_changed'; end if;
  select * into old from app_private.reward_historical_source_reviews_v3 where draft_id=p_draft_id and slot=p_slot order by sequence desc limit 1;
  if old.id is distinct from p_expected_review_id then raise exception 'reward_historical_review_conflict'; end if;
  if (v#>>'{workspace,catalogueHash}' is distinct from v#>>'{workspace,boundCatalogueHash}'
      and coalesce(public.service_read_reward_programme_approval_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id)#>>'{approval,current}','false')<>'true')
    or (v#>>'{workspace,revision}')::integer<1 then raise exception 'reward_planning_revision_changed'; end if;
  select value into r from jsonb_array_elements(v#>'{snapshot,catalogue,rounds}') c
    where c->>'slot'=p_slot::text and c->>'status'='completed'
      and c->>'id'=v#>>array['workspace','mapping','rounds',(p_slot-1)::text,'roundId'];
  if r is null or jsonb_array_length(r->'races')=0 then raise exception 'reward_historical_source_missing'; end if;
  -- A hold may be recorded on problematic evidence. Confirmation cannot upgrade
  -- a generic published flag or an incomplete import to an official publication.
  if p_decision='confirmed_final' then
    for race in select value from jsonb_array_elements(r->'races') loop
      if race->>'publicationId' is null or coalesce(race->>'publicationState','') not in ('official','corrected') then
        raise exception 'invalid_reward_historical_source'; end if;
      select count(*) into row_count from jsonb_array_elements(v#>'{snapshot,results}') rr where rr->>'raceId'=race->>'id'
        and rr->>'publicationId'=race->>'publicationId' and rr->>'publicationState'=race->>'publicationState';
      if row_count=0 or row_count is distinct from (race->>'resultCount')::integer then raise exception 'invalid_reward_historical_source'; end if;
    end loop;
  end if;
  insert into app_private.reward_historical_source_reviews_v3(id,draft_id,slot,previous_review_id,context_hash,context,decision,reviewed_by_user_id)
    values(p_request_id,p_draft_id,p_slot,p_expected_review_id,p_context_hash,app_private.reward_historical_source_context_v3(v),p_decision,p_actor_user_id)
    returning * into saved;
  v:=public.service_read_reward_historical_source_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if v->>'contextHash' is distinct from p_context_hash then raise exception 'reward_planning_revision_changed'; end if;
  return v || jsonb_build_object('recordedDecision',app_private.reward_historical_source_decision_v3(saved,v->>'contextHash'));
end $$;

create or replace function public.service_read_reward_allocation_approval_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare h jsonb; r jsonb; decision jsonb; c jsonb; hash text; latest app_private.reward_allocation_approvals_v3%rowtype;
  recorded app_private.reward_allocation_approvals_v3%rowtype;
begin
  if p_slot is null or p_slot not between 1 and 4 then raise exception 'invalid_reward_allocation_approval'; end if;
  h:=public.service_read_reward_historical_source_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  r:=public.service_read_reward_programme_registry_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select value into decision from jsonb_array_elements(h->'decisions') d where d->>'slot'=p_slot::text;
  c:=jsonb_build_object('schema','raceson-allocation-context-v3.1','sourceContextHash',h->'contextHash',
    'decision',decision,'intent',r#>'{context,intent}','registry',r->'registry');
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

create or replace function public.service_approve_reward_allocation_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
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
  if d->>'schema' is distinct from 'raceson-allocation-document-v3.1' or d->>'slot' is distinct from p_slot::text
    or d->'record' is distinct from source->'record'
    or d->'mapping' is distinct from source#>'{workspace,mapping}'
    or d->>'mappingRevision' is distinct from source#>>'{workspace,revision}'
    or d->>'sourceHash' is distinct from source->>'sourceHash' or d->>'sourceContextHash' is distinct from v->>'sourceContextHash'
    or d#>>'{decision,id}' is distinct from v#>>'{decision,id}'
    or d#>>'{binding,intentId}' is distinct from v#>>'{registry,registry,intentId}'
    or d#>>'{binding,fundingContextHash}' is distinct from v#>>'{registry,context,intent,contextHash}'
    or d#>>'{binding,reviewSeconds}' is distinct from v#>>array['registry','context','intent','terms','reviewPeriods',(p_slot-1)::text]
    or d#>>'{binding,fundingApprovalId}' is distinct from v#>>'{registry,context,intent,approvalId}'
    or d#>>'{binding,programmeAddress}' is distinct from v#>>'{registry,registry,provenance,contractAddress}'
    or d#>>'{binding,deploymentTransactionHash}' is distinct from v#>>'{registry,registry,provenance,transactionHash}'
    or d#>>'{binding,programmeId}' is distinct from v#>>'{registry,registry,provenance,programmeId}'
    or d#>>'{binding,programmeManifestHash}' is distinct from v#>>'{registry,registry,provenance,programmeManifestHash}'
    then raise exception 'invalid_reward_allocation_approval'; end if;
  if jsonb_typeof(d->'calculation') is distinct from 'object'
    or coalesce(d#>>'{calculation,budgetWei}','') !~ '^[1-9][0-9]{0,77}$'
    or coalesce(d#>>'{calculation,proposedWei}','') !~ '^(0|[1-9][0-9]{0,77})$'
    or coalesce(d#>>'{calculation,retainedWei}','') !~ '^(0|[1-9][0-9]{0,77})$'
    or jsonb_typeof(d#>'{calculation,families}') is distinct from 'array'
    then raise exception 'invalid_reward_allocation_approval'; end if;
  budget:=(d#>>'{calculation,budgetWei}')::numeric;
  if budget is distinct from (d#>>'{record,rules,budgetMon}')::numeric*power(10::numeric,18)/10
    or budget>=power(2::numeric,256) then raise exception 'invalid_reward_allocation_approval'; end if;
  if budget<=0 or budget<>(d#>>'{calculation,proposedWei}')::numeric+(d#>>'{calculation,retainedWei}')::numeric
    or exists(select 1 from jsonb_array_elements(d#>'{calculation,families}') f,
      jsonb_array_elements(f->'categories') c where c->'hold'<>'null'::jsonb)
    or coalesce(jsonb_typeof(d->'recipients'),'')<>'array' or jsonb_array_length(d->'recipients')>10000
    then raise exception 'reward_allocation_not_ready'; end if;
  -- These are trusted server observations, never request-body balances. The
  -- execution worker must recheck them and this exact latest approval before IO.
  if p_funding->>'address' is distinct from d#>>'{binding,campaignAddress}' or p_funding->>'routed' is distinct from 'true'
    or coalesce(p_funding->>'state','') not in ('0','1') or p_funding->>'paused' is distinct from 'false'
    or (p_funding->>'accountedFundingWei')::numeric is distinct from budget
    or (p_funding->>'capWei')::numeric is distinct from budget
    or p_funding->>'allocatedWei' is distinct from '0' or p_funding->>'paidWei' is distinct from '0'
    or p_funding->>'treasuryReturnedWei' is distinct from '0' then raise exception 'reward_allocation_not_ready'; end if;
  if jsonb_typeof(p_funding) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_funding))<>16
    or p_funding->'slot' is distinct from to_jsonb(p_slot-1)
    or coalesce(p_funding->>'blockNumber','') !~ '^[1-9][0-9]{0,19}$'
    or coalesce(p_funding->>'blockTimestamp','') !~ '^[1-9][0-9]{0,19}$'
    or coalesce(p_funding->>'blockHash','') !~ '^0x[0-9a-f]{64}$'
    or p_funding->>'blockHash'='0x0000000000000000000000000000000000000000000000000000000000000000'
    or p_funding->>'remainingWei' is distinct from budget::text
    or coalesce(p_funding->>'balanceWei','') !~ '^(0|[1-9][0-9]{0,77})$'
    or (p_funding->>'balanceWei')::numeric<budget
    or p_funding->>'returnedToProgrammeWei' is distinct from '0'
    then raise exception 'reward_allocation_not_ready'; end if;
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

-- CREATE OR REPLACE preserves the existing service-only ACL; no new public grant.
commit;
