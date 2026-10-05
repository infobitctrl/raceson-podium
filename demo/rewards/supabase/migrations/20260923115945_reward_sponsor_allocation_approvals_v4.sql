-- Isolated demo only. Exact award decisions, not upload, wallet consent or payment authority.
begin;
create table app_private.reward_sponsor_allocation_approvals_v4 (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
 setup_id uuid not null references app_private.reward_distribution_setups(id),
 launch_id uuid not null references app_private.reward_sponsor_launches(id),
 slot integer not null check(slot between 0 and 5),
 previous_approval_id uuid,
 context_hash text not null check(context_hash ~ '^[0-9a-f]{64}$'),
 document_text text not null check(octet_length(document_text)<=4194304),
 document_hash text not null check(document_hash ~ '^[0-9a-f]{64}$'),
 decision text not null check(decision in('approved','held')),
 actor_user_id uuid not null references public.user_profiles(user_id),
 created_at timestamptz not null default clock_timestamp(),
 sequence bigint generated always as identity unique,
 snapshot_salt bytea not null default public.gen_random_bytes(32) check(octet_length(snapshot_salt)=32),
 unique(setup_id,slot,id),
 foreign key(setup_id,slot,previous_approval_id) references app_private.reward_sponsor_allocation_approvals_v4(setup_id,slot,id),
 check(previous_approval_id is null or previous_approval_id<>id)
);
create index sponsor_allocation_latest_v4 on app_private.reward_sponsor_allocation_approvals_v4(setup_id,slot,sequence desc);
create table app_private.reward_sponsor_recipients_v4 (
 approval_id uuid not null references app_private.reward_sponsor_allocation_approvals_v4(id),
 beneficiary_kind text not null check(beneficiary_kind in('athlete','club')),
 beneficiary_id uuid not null check(beneficiary_id<>'00000000-0000-0000-0000-000000000000'::uuid),
 amount_wei numeric(78,0) not null check(amount_wei>0),
 entitlement_id bytea not null unique default public.gen_random_bytes(32) check(octet_length(entitlement_id)=32),
 opaque_beneficiary_id bytea not null unique default public.gen_random_bytes(32) check(octet_length(opaque_beneficiary_id)=32),
 explanation_salt bytea not null default public.gen_random_bytes(32) check(octet_length(explanation_salt)=32),
 primary key(approval_id,beneficiary_kind,beneficiary_id)
);
alter table app_private.reward_sponsor_allocation_approvals_v4 enable row level security;
alter table app_private.reward_sponsor_recipients_v4 enable row level security;
revoke all on app_private.reward_sponsor_allocation_approvals_v4,app_private.reward_sponsor_recipients_v4 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_sponsor_allocation_approvals_v4,app_private.reward_sponsor_recipients_v4 to service_role;
create policy sponsor_approval_read_v4 on app_private.reward_sponsor_allocation_approvals_v4 for select to service_role using(true);
create policy sponsor_approval_insert_v4 on app_private.reward_sponsor_allocation_approvals_v4 for insert to service_role with check(true);
create policy sponsor_recipients_read_v4 on app_private.reward_sponsor_recipients_v4 for select to service_role using(true);
create policy sponsor_recipients_insert_v4 on app_private.reward_sponsor_recipients_v4 for insert to service_role with check(true);
revoke all on sequence app_private.reward_sponsor_allocation_approvals_v4_sequence_seq from public,anon,authenticated;
grant usage on sequence app_private.reward_sponsor_allocation_approvals_v4_sequence_seq to service_role;
create trigger sponsor_approval_immutable_v4 before update or delete on app_private.reward_sponsor_allocation_approvals_v4
 for each row execute function app_private.reward_result_review_immutable_v3();
create trigger sponsor_recipients_immutable_v4 before update or delete on app_private.reward_sponsor_recipients_v4
 for each row execute function app_private.reward_result_review_immutable_v3();

create function app_private.reward_sponsor_approval_document_v4(p app_private.reward_sponsor_allocation_approvals_v4,p_guard text)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('id',p.id,'previousApprovalId',p.previous_approval_id,'contextHash',p.context_hash,
  'documentHash',p.document_hash,'decision',p.decision,'actorUserId',p.actor_user_id,'createdAt',p.created_at,'current',p.context_hash=p_guard)
$$;

create function public.service_read_reward_sponsor_allocation_v4(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_setup_id uuid,p_slot integer,p_request_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_distribution_setups%rowtype; e app_private.reward_sponsor_executions%rowtype;
 l app_private.reward_sponsor_launches%rowtype; r app_private.reward_setup_revisions%rowtype;
 draft uuid; organizer jsonb; facts jsonb; launch jsonb; execution jsonb; guard text; stable_source jsonb;
 latest app_private.reward_sponsor_allocation_approvals_v4%rowtype; saved app_private.reward_sponsor_allocation_approvals_v4%rowtype;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(10143,31337) or p_slot is null or p_slot not between 0 and 5 or p_setup_id is null then raise exception 'invalid_sponsor_allocation'; end if;
 -- Source authority, NOT sponsor ownership, determines who may review awards.
 select * into d from app_private.reward_distribution_setups where id=p_setup_id and chain_id=p_chain_id and archived_at is null;
 if d.id is null then raise exception 'reward_setup_not_found'; end if;
 select * into e from app_private.reward_sponsor_executions where setup_id=d.id;
 if e.setup_id is null then raise exception 'reward_sponsor_source_not_ready'; end if;
 select * into strict l from app_private.reward_sponsor_launches where id=e.launch_id;
 select * into strict r from app_private.reward_setup_revisions where setup_id=d.id and revision=l.setup_revision;
 draft:=(r.configuration#>>'{context,draftId}')::uuid;
 if draft is null then raise exception 'reward_sponsor_source_not_ready'; end if;
 organizer:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,draft);
 perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(organizer->>'organizationId')::uuid for share;
 perform 1 from public.organizations where id=(organizer->>'organizationId')::uuid for share;
 -- All source review writers also serialize on this draft. Lock before setup to avoid reversed source/setup waits.
 perform 1 from app_private.reward_planning_drafts where id=draft for update;
 perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_setup_id::text,0));
 perform 1 from app_private.reward_distribution_setups where id=d.id and archived_at is null for share;
 if not found then raise exception 'reward_setup_not_found'; end if;
 if p_slot between 1 and 4 then
  facts:=public.service_read_reward_historical_source_v3(p_actor_user_id,p_actor_session_id,p_chain_id,draft);
  stable_source:=jsonb_build_object('contextHash',facts->'contextHash','decisions',facts->'decisions');
 else
  facts:=public.service_reward_league_publication_v3(p_actor_user_id,p_actor_session_id,p_chain_id,draft,null,null,null,null,null);
  stable_source:=jsonb_build_object('guardHash',facts->'guardHash','publication',facts->'publication');
 end if;
 launch:=jsonb_build_object('id',l.id,'state','prepared','configurationHash',l.configuration_hash,
  'createdAt',to_char(l.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'setup',jsonb_build_object('id',d.id,'chainId',d.chain_id,'revision',r.revision,'configuration',r.configuration,
   'updatedAt',to_char(r.saved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 -- Transaction hashes are not source decisions and do not change an award calculation.
 execution:=jsonb_build_object('plan',e.plan,'deploymentHash',e.deployment_hash,'fundingHash',e.funding_hash);
 guard:=encode(sha256(convert_to(jsonb_build_object('launch',launch,'plan',e.plan,'slot',p_slot,'source',stable_source)::text,'UTF8')),'hex');
 select * into latest from app_private.reward_sponsor_allocation_approvals_v4 where setup_id=d.id and slot=p_slot order by sequence desc limit 1;
 select * into saved from app_private.reward_sponsor_allocation_approvals_v4 where id=p_request_id and setup_id=d.id and slot=p_slot and actor_user_id=p_actor_user_id;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if not app_private.reward_planning_authorized(p_actor_user_id,(organizer->>'organizationId')::uuid) then raise exception 'reward_planning_not_found'; end if;
 return jsonb_build_object('launch',launch,'execution',execution,'sourceFacts',facts,'contextHash',guard,
  'approval',case when latest.id is null then null else app_private.reward_sponsor_approval_document_v4(latest,guard) end,
  'recorded',case when saved.id is null then null else app_private.reward_sponsor_approval_document_v4(saved,guard) end);
end $$;

create function public.service_review_reward_sponsor_allocation_v4(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_setup_id uuid,p_slot integer,p_request_id uuid,p_expected_approval_id uuid,p_context_hash text,p_document_text text,p_decision text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; after_view jsonb; doc jsonb; calc jsonb; recipient jsonb; g jsonb; total numeric; cap numeric;
 saved app_private.reward_sponsor_allocation_approvals_v4%rowtype; h text;
begin
 v:=public.service_read_reward_sponsor_allocation_v4(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id,p_slot,p_request_id);
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
  or doc->>'schema' is distinct from 'raceson-sponsor-allocation-document-v4' or doc->'launch' is distinct from v->'launch'
  or doc->'plan' is distinct from v#>'{execution,plan}' or doc->>'contextHash' is distinct from p_context_hash
  or doc->'slot' is distinct from to_jsonb(p_slot) then raise exception 'invalid_sponsor_allocation'; end if;
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
 after_view:=public.service_read_reward_sponsor_allocation_v4(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id,p_slot,p_request_id);
 if after_view->>'contextHash'<>p_context_hash then raise exception 'reward_planning_revision_changed'; end if;
 return after_view;
end $$;
revoke all on function app_private.reward_sponsor_approval_document_v4(app_private.reward_sponsor_allocation_approvals_v4,text),
 public.service_read_reward_sponsor_allocation_v4(uuid,uuid,integer,uuid,integer,uuid),
 public.service_review_reward_sponsor_allocation_v4(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_sponsor_approval_document_v4(app_private.reward_sponsor_allocation_approvals_v4,text),
 public.service_read_reward_sponsor_allocation_v4(uuid,uuid,integer,uuid,integer,uuid),
 public.service_review_reward_sponsor_allocation_v4(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text) to service_role;
commit;
