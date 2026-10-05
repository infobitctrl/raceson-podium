begin;
-- Same immutable allocation/recipient/upload ledger; separate source authority
-- for native finale and final league. Historical functions and hashes stay intact.
alter table app_private.reward_allocation_approvals_v3 drop constraint reward_allocation_approvals_v3_slot_check;
alter table app_private.reward_allocation_approvals_v3 add constraint reward_allocation_approvals_v3_slot_check check(slot between 1 and 6);
alter table app_private.reward_allocation_approvals_v3 add constraint reward_final_allocation_document_v3_check
  check(slot<=4 or (document->>'schema'='raceson-allocation-document-v3.2'
    and document->>'slot'=slot::text and document->>'enabledPot'=(case slot when 5 then 0 else 1 end)::text) is true);

create function public.service_read_reward_final_allocation_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare s jsonb; r jsonb; c jsonb; h text; latest app_private.reward_allocation_approvals_v3%rowtype;
  recorded app_private.reward_allocation_approvals_v3%rowtype;
begin
  if p_slot is null or p_slot not in (5,6) then raise exception 'invalid_reward_final_allocation'; end if;
  -- The source reader holds current membership/org/draft and native race locks.
  -- Read history even when source is held, so retries can recover old acknowledgements.
  s:=public.service_reward_league_publication_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,null,null,null,null,null);
  r:=public.service_read_reward_programme_registry_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  c:=jsonb_build_object('schema','raceson-final-allocation-context-v3','slot',p_slot,'sourceGuardHash',s->'guardHash',
    'publication',case when p_slot=6 then (s->'publication')-'document' else 'null'::jsonb end,
    'intent',r#>'{context,intent}','registry',r->'registry');
  h:=encode(sha256(convert_to(c::text,'UTF8')),'hex');
  select * into latest from app_private.reward_allocation_approvals_v3 where draft_id=p_draft_id and slot=p_slot order by sequence desc limit 1;
  if p_request_id is not null then
    select * into recorded from app_private.reward_allocation_approvals_v3 where id=p_request_id;
    if found and (recorded.draft_id<>p_draft_id or recorded.slot<>p_slot or recorded.approved_by_user_id<>p_actor_user_id)
      then raise exception 'reward_allocation_approval_conflict'; end if;
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,(s#>>'{policy,facts,historical,record,organizationId}')::uuid)
    then raise exception 'reward_planning_not_found'; end if;
  return jsonb_build_object('contextHash',h,'source',s,'registry',r,
    'approval',case when latest.id is null then null else app_private.reward_allocation_approval_view_v3(latest,h) end,
    'recorded',case when recorded.id is null then null else app_private.reward_allocation_approval_view_v3(recorded,h)
      || jsonb_build_object('current',recorded.id=latest.id and recorded.context_hash=h) end);
end $$;

create function public.service_approve_reward_final_allocation_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_slot integer,p_request_id uuid,p_expected_approval_id uuid,p_context_hash text,p_document_text text,p_funding jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; d jsonb; s jsonb; f jsonb; sr jsonb; row jsonb; race jsonb; budget numeric; total numeric:=0;
  native_review app_private.reward_native_continuity_reviews_v3%rowtype;
  policy_review app_private.reward_league_policy_reviews_v3%rowtype;
begin
  v:=public.service_read_reward_final_allocation_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_request_id);
  if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid
    or p_document_text is null or octet_length(p_document_text)>4194304 or p_context_hash is null or p_context_hash !~ '^[0-9a-f]{64}$'
    then raise exception 'invalid_reward_final_allocation'; end if;
  d:=p_document_text::jsonb;
  if v->'recorded'<>'null'::jsonb then
    if v#>>'{recorded,contextHash}' is distinct from p_context_hash or v#>>'{recorded,previousApprovalId}' is distinct from p_expected_approval_id::text
      or v#>>'{recorded,documentHash}' is distinct from encode(sha256(convert_to(p_document_text,'UTF8')),'hex')
      then raise exception 'reward_allocation_approval_conflict'; end if;
    return v;
  end if;
  if v->>'contextHash'<>p_context_hash then raise exception 'reward_planning_revision_changed'; end if;
  if v#>>'{approval,id}' is distinct from p_expected_approval_id::text then raise exception 'reward_allocation_approval_conflict'; end if;
  -- Once any package is prepared, this child cannot accept a second recipient
  -- namespace. Corrections need an explicit cancellation/replacement workflow.
  if exists(select 1 from app_private.reward_allocation_uploads_v3 u join app_private.reward_allocation_approvals_v3 a on a.id=u.approval_id
    where a.draft_id=p_draft_id and a.slot=p_slot) then raise exception 'reward_allocation_not_ready'; end if;
  s:=v->'source';f:=s#>'{policy,facts}';sr:=d->'sourceReview';
  select * into native_review from app_private.reward_native_continuity_reviews_v3 where id=(f#>>'{review,id}')::uuid;
  select * into policy_review from app_private.reward_league_policy_reviews_v3 where id=(s#>>'{policy,review,id}')::uuid;
  if native_review.id is null or native_review.decision<>'confirmed' or native_review.source_guard_hash<>f->>'guardHash'
    or policy_review.id is null or policy_review.decision<>'selected'
    or policy_review.context_text::jsonb is distinct from app_private.reward_league_policy_context_v3(f)
    or coalesce(v#>>'{registry,context,intent,current}','false')<>'true' or v#>>'{registry,registry,intentId}' is null
    then raise exception 'reward_allocation_not_ready'; end if;
  if f#>>'{native,document,edition,status}' is distinct from 'completed' or jsonb_array_length(f#>'{native,document,races}')=0
    then raise exception 'reward_allocation_not_ready'; end if;
  for race in select value from jsonb_array_elements(f#>'{native,document,races}') loop
    if race->>'status' is distinct from 'completed' or race#>>'{review,state}' is distinct from 'final'
      or race#>>'{review,finalPublicationId}' is distinct from race#>>'{publication,id}'
      then raise exception 'reward_allocation_not_ready'; end if;
  end loop;
  if jsonb_typeof(d) is distinct from 'object' or (select count(*) from jsonb_object_keys(d))<>12
    or d->>'schema' is distinct from 'raceson-allocation-document-v3.2' or d->>'slot' is distinct from p_slot::text
    or d->>'enabledPot' is distinct from (case p_slot when 5 then 0 else 1 end)::text
    or d->'record' is distinct from f#>'{historical,record}' or d->'mapping' is distinct from f#>'{historical,workspace,mapping}'
    or d->>'mappingRevision' is distinct from f#>>'{historical,workspace,revision}'
    or sr->>'guardHash' is distinct from s->>'guardHash'
    or d#>>'{source,sourceLeagueId}' is distinct from f#>>'{historical,snapshot,sourceLeagueId}'
    or d#>>'{source,sourceSeasonId}' is distinct from f#>>'{historical,snapshot,sourceSeasonId}'
    or (d#>>'{source,capturedAt}')::timestamptz>clock_timestamp()
    or d#>>'{binding,intentId}' is distinct from v#>>'{registry,registry,intentId}'
    or d#>>'{binding,fundingContextHash}' is distinct from v#>>'{registry,context,intent,contextHash}'
    or d#>>'{binding,reviewSeconds}' is distinct from v#>>array['registry','context','intent','terms','reviewPeriods',(p_slot-1)::text]
    or d#>>'{binding,fundingApprovalId}' is distinct from v#>>'{registry,context,intent,approvalId}'
    or d#>>'{binding,programmeAddress}' is distinct from v#>>'{registry,registry,provenance,contractAddress}'
    or d#>>'{binding,deploymentTransactionHash}' is distinct from v#>>'{registry,registry,provenance,transactionHash}'
    or d#>>'{binding,programmeId}' is distinct from v#>>'{registry,registry,provenance,programmeId}'
    or d#>>'{binding,programmeManifestHash}' is distinct from v#>>'{registry,registry,provenance,programmeManifestHash}'
    then raise exception 'invalid_reward_final_allocation'; end if;
  if p_slot=5 then
    if sr->>'kind' is distinct from 'native_finale' or sr->>'continuityReviewId' is distinct from native_review.id::text
      or sr->>'continuityContextHash' is distinct from native_review.context_hash
      or sr->>'reviewedAt' is distinct from f#>>'{review,reviewedAt}' or sr->'policyReview' is distinct from s#>'{policy,review}'
      or d#>>'{source,rounds,4,evidence,digest}' is distinct from sr->>'continuityCommitment'
      or d#>'{source,rounds,4,evidence,held}' is distinct from 'false'::jsonb
      or d#>'{source,league}' is distinct from 'null'::jsonb
      then raise exception 'reward_allocation_not_ready'; end if;
  else
    if sr->>'kind' is distinct from 'published_league' or sr->>'publicationId' is distinct from s#>>'{publication,id}'
      or sr->>'publicationDocumentHash' is distinct from s#>>'{publication,documentHash}'
      or sr->>'evidenceHash' is distinct from s#>>'{publication,evidenceHash}'
      or (sr->>'publishedAt')::timestamptz is distinct from date_trunc('milliseconds',(s#>>'{publication,publishedAt}')::timestamptz)
      or s#>>'{publication,decision}' is distinct from 'published' or s#>>'{publication,sourceGuardHash}' is distinct from s->>'guardHash'
      or d#>>'{source,league,evidence,digest}' is distinct from sr->>'evidenceHash'
      or d#>'{source,league,evidence,held}' is distinct from 'false'::jsonb or d#>'{calculation,hold}' is distinct from 'null'::jsonb
      or ((d#>>'{calculation,participation,budgetWei}')::numeric>0 and d#>'{calculation,participation,hold}' is distinct from 'null'::jsonb)
      then raise exception 'reward_allocation_not_ready'; end if;
  end if;
  if jsonb_typeof(d->'calculation') is distinct from 'object'
    or coalesce(d#>>'{calculation,budgetWei}','') !~ '^[1-9][0-9]{0,77}$'
    or coalesce(d#>>'{calculation,proposedWei}','') !~ '^(0|[1-9][0-9]{0,77})$'
    or coalesce(d#>>'{calculation,retainedWei}','') !~ '^(0|[1-9][0-9]{0,77})$'
    or jsonb_typeof(d#>'{calculation,families}') is distinct from 'array'
    or jsonb_typeof(d->'recipients') is distinct from 'array' or jsonb_array_length(d->'recipients')>10000
    then raise exception 'invalid_reward_final_allocation'; end if;
  budget:=(d#>>'{calculation,budgetWei}')::numeric;
  if budget is distinct from (d#>>'{record,rules,budgetMon}')::numeric*power(10::numeric,18)/(case p_slot when 5 then 10 else 2 end)
    or budget>=power(2::numeric,256) or budget<>(d#>>'{calculation,proposedWei}')::numeric+(d#>>'{calculation,retainedWei}')::numeric
    or exists(select 1 from jsonb_array_elements(d#>'{calculation,families}') as families(value),
      jsonb_array_elements(families.value->'categories') as categories(value)
      where (categories.value->>'budgetWei')::numeric>0 and categories.value->'hold' is distinct from 'null'::jsonb)
    then raise exception 'reward_allocation_not_ready'; end if;
  -- Server-verified chain observation; the worker rechecks before execution.
  if jsonb_typeof(p_funding) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_funding))<>16
    or p_funding->'slot' is distinct from to_jsonb(p_slot-1)
    or p_funding->>'address' is distinct from d#>>'{binding,campaignAddress}' or p_funding->>'routed' is distinct from 'true'
    or coalesce(p_funding->>'state','') not in ('0','1') or p_funding->>'paused' is distinct from 'false'
    or (p_funding->>'accountedFundingWei')::numeric is distinct from budget or (p_funding->>'capWei')::numeric is distinct from budget
    or p_funding->>'allocatedWei' is distinct from '0' or p_funding->>'paidWei' is distinct from '0'
    or p_funding->>'treasuryReturnedWei' is distinct from '0' or p_funding->>'remainingWei' is distinct from budget::text
    or coalesce(p_funding->>'balanceWei','') !~ '^(0|[1-9][0-9]{0,77})$' or (p_funding->>'balanceWei')::numeric<budget
    or p_funding->>'returnedToProgrammeWei' is distinct from '0'
    or coalesce(p_funding->>'blockNumber','') !~ '^[1-9][0-9]{0,19}$' or coalesce(p_funding->>'blockTimestamp','') !~ '^[1-9][0-9]{0,19}$'
    or coalesce(p_funding->>'blockHash','') !~ '^0x[0-9a-f]{64}$' or p_funding->>'blockHash'='0x'||repeat('0',64)
    then raise exception 'reward_allocation_not_ready'; end if;
  insert into app_private.reward_allocation_approvals_v3(id,draft_id,slot,previous_approval_id,context_hash,document_text,document_hash,funding_observation,approved_by_user_id)
    values(p_request_id,p_draft_id,p_slot,p_expected_approval_id,p_context_hash,p_document_text,
      encode(sha256(convert_to(p_document_text,'UTF8')),'hex'),p_funding,p_actor_user_id);
  for row in select value from jsonb_array_elements(d->'recipients') loop
    if jsonb_typeof(row) is distinct from 'object' or (select count(*) from jsonb_object_keys(row))<>3
      or coalesce(row->>'amountWei','') !~ '^[1-9][0-9]{0,77}$' then raise exception 'invalid_reward_final_allocation'; end if;
    insert into app_private.reward_allocation_recipients_v3(approval_id,beneficiary_kind,source_beneficiary_id,amount_wei)
      values(p_request_id,row->>'beneficiaryKind',(row->>'beneficiaryId')::uuid,(row->>'amountWei')::numeric);
    total:=total+(row->>'amountWei')::numeric;
  end loop;
  if total<>(d#>>'{calculation,proposedWei}')::numeric then raise exception 'invalid_reward_final_allocation'; end if;
  v:=public.service_read_reward_final_allocation_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_request_id);
  if v->>'contextHash'<>p_context_hash then raise exception 'reward_planning_revision_changed'; end if;
  return v;
end $$;
revoke all on function public.service_read_reward_final_allocation_v3(uuid,uuid,integer,uuid,integer,uuid),
  public.service_approve_reward_final_allocation_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_read_reward_final_allocation_v3(uuid,uuid,integer,uuid,integer,uuid),
  public.service_approve_reward_final_allocation_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,jsonb) to service_role;
-- Final upload functions follow. They share the existing immutable rows/salts.
create function public.service_read_reward_final_allocation_upload_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; after_read jsonb; d jsonb; a app_private.reward_allocation_approvals_v3%rowtype;
  u app_private.reward_allocation_uploads_v3%rowtype; recipients jsonb;
begin
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(d->>'organizationId')::uuid for share;
  perform 1 from public.organizations where id=(d->>'organizationId')::uuid for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  v:=public.service_read_reward_final_allocation_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,null);
  select * into a from app_private.reward_allocation_approvals_v3 where id=p_approval_id and draft_id=p_draft_id and slot=p_slot;
  if a.id is null then raise exception 'reward_allocation_upload_not_found'; end if;
  select * into u from app_private.reward_allocation_uploads_v3 where approval_id=a.id;
  select coalesce(jsonb_agg(jsonb_build_object('beneficiaryKind',r.beneficiary_kind,'sourceBeneficiaryId',r.source_beneficiary_id,
    'amountWei',r.amount_wei::text,'entitlementId','0x'||encode(r.entitlement_id,'hex'),'opaqueBeneficiaryId','0x'||encode(r.opaque_beneficiary_id,'hex'),
    'explanationSalt','0x'||encode(r.explanation_salt,'hex')) order by r.entitlement_id),'[]'::jsonb) into recipients
    from app_private.reward_allocation_recipients_v3 r where approval_id=a.id;
  after_read:=public.service_read_reward_final_allocation_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,null);
  if after_read->>'contextHash' is distinct from v->>'contextHash' or after_read->'approval' is distinct from v->'approval'
    then raise exception 'reward_planning_revision_changed'; end if;
  return jsonb_build_object('schema','raceson-allocation-upload-private-v3','approvalId',a.id,'contextHash',v->>'contextHash',
    'current',coalesce(v#>>'{approval,id}'=a.id::text and (v#>>'{approval,current}')::boolean,false),
    'documentHash',a.document_hash,'document',a.document,'snapshotSalt','0x'||encode(a.snapshot_salt,'hex'),'recipients',recipients,
    'prepared',case when u.id is null then null else jsonb_build_object('id',u.id,'contextHash',u.context_hash,
      'documentHash',u.document_hash,'packageHash',u.package_hash,'package',u.package,'preparedAt',u.prepared_at,
      'preparedByUserId',u.prepared_by_user_id) end);
end $$;

create function public.service_prepare_reward_final_allocation_upload_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid,p_request_id uuid,p_context_hash text,p_document_hash text,p_package_text text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; d jsonb; p jsonb; r jsonb; saved app_private.reward_allocation_uploads_v3%rowtype;
  previous text:='0x'||repeat('0',64); amount numeric; total numeric:=0; rows_count integer:=0;
begin
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(d->>'organizationId')::uuid for share;
  perform 1 from public.organizations where id=(d->>'organizationId')::uuid for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  v:=public.service_read_reward_final_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
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
    or p->>'chainId' is distinct from p_chain_id::text or p->>'enabledPot' is distinct from (case p_slot when 5 then 0 else 1 end)::text
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
      or r->>'pot' is distinct from (case p_slot when 5 then 0 else 1 end)::text or r->>'beneficiaryKind' not in ('0','1')
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
  v:=public.service_read_reward_final_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if v->>'contextHash' is distinct from p_context_hash or v->>'current' is distinct from 'true'
    then raise exception 'reward_planning_revision_changed'; end if;
  return v;
end $$;

revoke all on function public.service_read_reward_final_allocation_upload_v3(uuid,uuid,integer,uuid,integer,uuid) from public,anon,authenticated;
revoke all on function public.service_prepare_reward_final_allocation_upload_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.service_read_reward_final_allocation_upload_v3(uuid,uuid,integer,uuid,integer,uuid) to service_role;
grant execute on function public.service_prepare_reward_final_allocation_upload_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text) to service_role;

-- The existing athlete projection/claim decoder is intentionally historical
-- only. Final-source readiness is a separate next increment: new ledger rows
-- must not poison pagination for otherwise valid historical awards.
create or replace function public.service_read_own_reward_allocations_v3(
  p_user_id uuid,p_session_id uuid,p_chain_id integer,p_after_id text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare result jsonb; today date:=(clock_timestamp() at time zone 'Europe/Zagreb')::date;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in (31337,10143)
    or (p_after_id is not null and p_after_id !~ '^0x[0-9a-f]{64}$') then
    raise exception 'invalid_reward_allocation_query';
  end if;
  perform 1 from public.user_profiles where user_id=p_user_id for share;
  perform 1 from public.athlete_profiles where claimed_by_user_id=p_user_id order by id for share;
  with own as (
    select r.*,a.draft_id,a.slot,a.document,a.approved_at,p.date_of_birth,p.birth_year
    from public.athlete_profiles p
    join app_private.reward_allocation_recipients_v3 r on r.source_beneficiary_id=p.id and r.beneficiary_kind='athlete'
    join app_private.reward_allocation_approvals_v3 a on a.id=r.approval_id
    where p.claimed_by_user_id=p_user_id and p.is_claimed and p.status='active' and p.merged_into_athlete_profile_id is null
      and a.slot between 1 and 4 and a.document->>'schema'='raceson-allocation-document-v3.1'
      and (a.document#>>'{record,chainId}')::integer=p_chain_id
      and (p_after_id is null or r.entitlement_id>decode(substr(p_after_id,3),'hex'))
      and not exists(select 1 from app_private.reward_allocation_approvals_v3 newer
        where newer.draft_id=a.draft_id and newer.slot=a.slot and newer.sequence>a.sequence)
    order by r.entitlement_id limit 51
  ), page as (select * from own order by entitlement_id limit 50)
  select jsonb_build_object('schema','raceson-own-allocations-v3','chainId',p_chain_id,'items',coalesce((select jsonb_agg(
    jsonb_build_object('entitlementId','0x'||encode(entitlement_id,'hex'),'approvalId',approval_id,
      'draftId',draft_id,'slot',slot,'athleteProfileId',source_beneficiary_id,'chainId',p_chain_id,
      'sourceKind',document#>>'{source,kind}','amountWei',amount_wei::text,
      'campaignAddress',document#>>'{binding,campaignAddress}',
      'recordedAt',to_char(approved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ageStatus',case
        when date_of_birth is not null and (date_of_birth>today or (birth_year is not null and birth_year<>extract(year from date_of_birth))) then 'unknown'
        when date_of_birth is not null and date_of_birth>today-interval '18 years' then 'minor'
        when date_of_birth is null then 'unknown' else 'unverified_adult' end)
    order by entitlement_id) from page),'[]'::jsonb),
    'nextCursor',case when (select count(*) from own)>50 then
      (select '0x'||encode(entitlement_id,'hex') from page order by entitlement_id desc limit 1) else null end) into result;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  return result;
end $$;
revoke all on function public.service_read_own_reward_allocations_v3(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.service_read_own_reward_allocations_v3(uuid,uuid,integer,text) to service_role;
commit;
