begin;
-- Exact copied-source awards reuse immutable approvals and walletless entitlements.
-- The bounded service transport does not grant clients or service users table access.
create function app_private.read_reward_demo_copy_allocation(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_setup_id uuid,p_slot integer,p_request_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v jsonb; item jsonb; guard text;
 latest app_private.reward_sponsor_allocation_approvals_v4%rowtype; saved app_private.reward_sponsor_allocation_approvals_v4%rowtype;
begin
 perform app_private.require_reward_demo_copy_reviewer(p_actor_user_id,p_actor_session_id);
 if p_chain_id is distinct from 10143 or p_slot is null or p_slot not between 0 and 5 or p_setup_id is null then raise exception 'invalid_sponsor_allocation'; end if;
 -- Retain permission rows during the decision; the final authorization check also
 -- observes existing active custom role and platform administrator requirements.
 perform 1 from public.organization_memberships where user_id=p_actor_user_id for share;
 perform 1 from public.platform_administrators where user_id=p_actor_user_id for share;
 perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_setup_id::text,0));
 v:=public.service_reward_demo_copy_review_sources(p_actor_user_id,p_actor_session_id,p_setup_id);
 item:=v#>'{items,0}';
 if item is null then raise exception 'reward_setup_not_found'; end if;
 if item->'execution' is null or item->'execution'='null'::jsonb then raise exception 'reward_sponsor_source_not_ready'; end if;
 guard:=encode(sha256(convert_to(jsonb_build_object('launch',item->'launch','plan',item#>'{execution,plan}',
  'slot',p_slot,'source',item->'source','combined','owner-combined-selection-20261005-v1',
  'unaffiliated','owner-unaffiliated-selection-20261005-v1')::text,'UTF8')),'hex');
 select * into latest from app_private.reward_sponsor_allocation_approvals_v4 where setup_id=p_setup_id and slot=p_slot order by sequence desc limit 1;
 select * into saved from app_private.reward_sponsor_allocation_approvals_v4 where id=p_request_id and setup_id=p_setup_id and slot=p_slot and actor_user_id=p_actor_user_id;
 perform app_private.require_reward_demo_copy_reviewer(p_actor_user_id,p_actor_session_id);
 return jsonb_build_object('launch',item->'launch','execution',item->'execution','sourceFacts',item->'source','contextHash',guard,
  'approval',case when latest.id is null then null else app_private.reward_sponsor_approval_document_v4(latest,guard) end,
  'recorded',case when saved.id is null then null else app_private.reward_sponsor_approval_document_v4(saved,guard) end);
end $$;
create function app_private.review_reward_demo_copy_allocation(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_setup_id uuid,p_slot integer,p_request_id uuid,p_expected_approval_id uuid,p_context_hash text,p_document_text text,p_decision text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v jsonb; after_view jsonb; doc jsonb; calc jsonb; recipient jsonb; g jsonb; total numeric; cap numeric;
 saved app_private.reward_sponsor_allocation_approvals_v4%rowtype; h text;
begin
 v:=app_private.read_reward_demo_copy_allocation(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id,p_slot,p_request_id);
 if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid or p_context_hash is null or p_context_hash !~ '^[0-9a-f]{64}$'
  or p_document_text is null or octet_length(p_document_text)>4194304 or p_decision is null or p_decision not in('approved','held') then raise exception 'invalid_sponsor_allocation'; end if;
 h:=encode(sha256(convert_to(p_document_text,'UTF8')),'hex');
 select * into saved from app_private.reward_sponsor_allocation_approvals_v4 where id=p_request_id;
 if found then
  if saved.setup_id<>p_setup_id or saved.slot<>p_slot or saved.actor_user_id<>p_actor_user_id or saved.context_hash<>p_context_hash
   or saved.document_hash<>h or saved.document_text<>p_document_text or saved.decision<>p_decision or saved.previous_approval_id is distinct from p_expected_approval_id then raise exception 'reward_sponsor_approval_conflict'; end if;
  return v; -- Exact retry returns history; never overwrites a newer hold.
 end if;
 if v->>'contextHash'<>p_context_hash then raise exception 'reward_planning_revision_changed'; end if;
 if (v#>>'{approval,id}')::uuid is distinct from p_expected_approval_id then raise exception 'reward_sponsor_approval_conflict'; end if;
 doc:=p_document_text::jsonb;
 if jsonb_typeof(doc) is distinct from 'object' or (select count(*) from jsonb_object_keys(doc))<>8
  or not(doc ?& array['schema','launch','plan','binding','source','slot','contextHash','calculation'])
  or doc->>'schema' is distinct from 'podium-copy-allocation-document-v1' or doc->'launch' is distinct from v->'launch'
  or doc->'plan' is distinct from v#>'{execution,plan}' or doc->>'contextHash' is distinct from p_context_hash
  or doc->'slot' is distinct from to_jsonb(p_slot) then raise exception 'invalid_sponsor_allocation'; end if;
 if doc->'source' is distinct from v->'sourceFacts' or doc->'binding' is distinct from jsonb_build_object(
  'batchSha256','073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644',
  'projectionSha256','7043cf919edd4dc3bdf40d022c60d0fc40036f2e4093b33b57dfc040bda3975d',
  'leagueId','ba81ced7-b2c5-4d51-95b6-d95d8c04fa36','seasonId','323d55fc-a396-4ff4-a17e-eb7152c8f8f1',
  'combined','owner-combined-selection-20261005-v1','unaffiliated','owner-unaffiliated-selection-20261005-v1') then
  raise exception 'invalid_sponsor_allocation'; end if;
 calc:=doc->'calculation'; cap:=(v#>>array['execution','plan','caps',p_slot::text])::numeric;
 if jsonb_typeof(calc) is distinct from 'object' or calc->'slot' is distinct from to_jsonb(p_slot)
  or coalesce(calc->>'budgetWei','') !~ '^(0|[1-9][0-9]{0,24})$' or (calc->>'budgetWei')::numeric<>cap
  or coalesce(calc->>'proposedWei','') !~ '^(0|[1-9][0-9]{0,24})$' or coalesce(calc->>'retainedWei','') !~ '^(0|[1-9][0-9]{0,24})$'
  or (calc->>'proposedWei')::numeric+(calc->>'retainedWei')::numeric<>cap
  or jsonb_typeof(calc->'groups') is distinct from 'array' or jsonb_typeof(calc->'recipients') is distinct from 'array' then raise exception 'invalid_sponsor_allocation'; end if;
 total:=0;
 for g in select value from jsonb_array_elements(calc->'groups') loop
  if p_decision='approved' and g->'hold' is distinct from 'null'::jsonb then raise exception 'reward_sponsor_source_not_ready'; end if;
  if coalesce(g->>'budgetWei','') !~ '^(0|[1-9][0-9]{0,24})$' then raise exception 'invalid_sponsor_allocation'; end if;
  total:=total+(g->>'budgetWei')::numeric;
 end loop;
 if total<>cap or (p_decision='approved' and cap=0) then raise exception 'reward_sponsor_source_not_ready'; end if;
 total:=0;
 for recipient in select value from jsonb_array_elements(calc->'recipients') loop
  if coalesce(recipient->>'beneficiaryKind','') not in('athlete','club') or coalesce(recipient->>'amountWei','') !~ '^[1-9][0-9]{0,24}$'
   or recipient->>'beneficiaryId' is null then raise exception 'invalid_sponsor_allocation'; end if;
  total:=total+(recipient->>'amountWei')::numeric;
 end loop;
 if total<>(calc->>'proposedWei')::numeric then raise exception 'invalid_sponsor_allocation'; end if;
 insert into app_private.reward_sponsor_allocation_approvals_v4(id,setup_id,launch_id,slot,previous_approval_id,context_hash,document_text,document_hash,decision,actor_user_id)
  values(p_request_id,p_setup_id,(v#>>'{launch,id}')::uuid,p_slot,p_expected_approval_id,p_context_hash,p_document_text,h,p_decision,p_actor_user_id);
 if p_decision='approved' then
  insert into app_private.reward_sponsor_recipients_v4(approval_id,beneficiary_kind,beneficiary_id,amount_wei)
   select p_request_id,r->>'beneficiaryKind',(r->>'beneficiaryId')::uuid,(r->>'amountWei')::numeric from jsonb_array_elements(calc->'recipients') r;
 end if;
 after_view:=app_private.read_reward_demo_copy_allocation(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id,p_slot,p_request_id);
 if after_view->>'contextHash'<>p_context_hash then raise exception 'reward_planning_revision_changed'; end if;
 return after_view;
end $$;

create function public.service_reward_demo_copy_allocation(p_operation text,p_actor_user_id uuid,p_actor_session_id uuid,
 p_setup_id uuid,p_slot integer,p_request_id uuid default null,p_expected_approval_id uuid default null,
 p_context_hash text default null,p_document_text text default null,p_decision text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 if p_operation='read' and p_expected_approval_id is null and p_context_hash is null and p_document_text is null and p_decision is null then
  return app_private.read_reward_demo_copy_allocation(p_actor_user_id,p_actor_session_id,10143,p_setup_id,p_slot,p_request_id);
 elsif p_operation='review' then
  return app_private.review_reward_demo_copy_allocation(p_actor_user_id,p_actor_session_id,10143,p_setup_id,p_slot,p_request_id,
   p_expected_approval_id,p_context_hash,p_document_text,p_decision);
 end if;
 raise exception 'invalid_sponsor_allocation';
end $$;
revoke all on function app_private.read_reward_demo_copy_allocation(uuid,uuid,integer,uuid,integer,uuid),
 app_private.review_reward_demo_copy_allocation(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text),
 public.service_reward_demo_copy_allocation(text,uuid,uuid,uuid,integer,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_allocation(text,uuid,uuid,uuid,integer,uuid,uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
