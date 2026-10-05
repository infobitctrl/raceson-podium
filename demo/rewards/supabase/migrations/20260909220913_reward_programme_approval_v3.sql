begin;

-- Demo-only funding specifications. Approval is not a deployment/send lease,
-- sporting approval, wallet-control proof or beneficiary consent.
create table app_private.reward_programme_approvals_v3 (
  id uuid primary key,
  draft_id uuid not null references app_private.reward_planning_drafts(id),
  previous_approval_id uuid,
  rules_revision integer not null check (rules_revision > 0),
  mapping_revision integer not null check (mapping_revision > 0),
  context_hash text not null check (context_hash ~ '^[0-9a-f]{64}$'),
  context jsonb not null check (jsonb_typeof(context)='object' and octet_length(context::text)<=262144),
  terms jsonb not null check (jsonb_typeof(terms)='object' and octet_length(terms::text)<=1024),
  approved_at timestamptz not null default clock_timestamp(),
  approved_by_user_id uuid not null references public.user_profiles(user_id),
  sequence bigint generated always as identity unique,
  unique(draft_id,id),
  foreign key(draft_id,previous_approval_id) references app_private.reward_programme_approvals_v3(draft_id,id),
  check(previous_approval_id is null or previous_approval_id<>id)
);
create index reward_programme_approvals_v3_draft_idx on app_private.reward_programme_approvals_v3(draft_id,sequence desc);
alter table app_private.reward_programme_approvals_v3 enable row level security;
revoke all on app_private.reward_programme_approvals_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_programme_approvals_v3 to service_role;
revoke all on sequence app_private.reward_programme_approvals_v3_sequence_seq from public,anon,authenticated;
grant usage on sequence app_private.reward_programme_approvals_v3_sequence_seq to service_role;
create trigger reward_programme_approvals_v3_immutable before update or delete on app_private.reward_programme_approvals_v3
  for each row execute function app_private.reward_result_review_immutable_v3();

-- All context comes from authenticated server reads. The funding specification
-- deliberately excludes result rows, athlete data and mutable result counters.
-- Names are retained for human inspection. Later final-publication changes do
-- not rewrite this funding snapshot or constitute approval of an award package.
create function app_private.reward_programme_context_v3(p_record jsonb,p_workspace jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('draftId',p_record->'draftId','organizationId',p_record->'organizationId',
    'seasonId',p_record->'seasonId','chainId',p_record->'chainId','rulesRevision',p_record->'revision','rules',p_record->'rules',
    'mappingRevision',p_workspace->'revision','mapping',p_workspace->'mapping',
    'catalogue',jsonb_build_object('categories',p_workspace->'catalogue'->'categories',
      'rounds',coalesce((select jsonb_agg((r-'races'-'status') || jsonb_build_object('cancelled',r->>'status'='cancelled','races',coalesce((select jsonb_agg(
        race-'publicationId'-'publicationState'-'resultCount' order by race->>'competitionId')
        from jsonb_array_elements(r->'races') race),'[]'::jsonb)) order by (r->>'slot')::integer,r->>'id')
        from jsonb_array_elements(p_workspace->'catalogue'->'rounds') r),'[]'::jsonb)))
$$;

create function public.service_read_reward_programme_approval_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare d jsonb; w jsonb; context jsonb; context_hash text; a app_private.reward_programme_approvals_v3%rowtype;
begin
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for share;
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  w:=public.service_read_reward_mapping_v2(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  context:=app_private.reward_programme_context_v3(d,w);
  context_hash:=encode(sha256(convert_to(context::text,'UTF8')),'hex');
  select * into a from app_private.reward_programme_approvals_v3 where draft_id=p_draft_id order by sequence desc limit 1;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,(d->>'organizationId')::uuid) then raise exception 'reward_planning_not_found'; end if;
  return jsonb_build_object('schema','raceson-programme-approval-v3','record',d,'workspace',w,'contextHash',context_hash,
    'approval',case when a.id is not null then jsonb_build_object('id',a.id,'rulesRevision',a.rules_revision,
      'mappingRevision',a.mapping_revision,'contextHash',a.context_hash,'terms',a.terms,'approvedAt',a.approved_at,
      'current',a.context_hash=context_hash) end,'operationsEnabled',false);
end $$;

create function public.service_approve_reward_programme_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_request_id uuid,p_expected_approval_id uuid,p_context_hash text,p_terms jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype; view jsonb; context jsonb;
  a app_private.reward_programme_approvals_v3%rowtype; r jsonb; source jsonb; t jsonb;
begin
  perform public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select * into d from app_private.reward_planning_drafts where id=p_draft_id;
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=d.organization_id for share;
  perform 1 from public.organizations where id=d.organization_id for share;
  select * into d from app_private.reward_planning_drafts where id=p_draft_id for update;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then raise exception 'reward_planning_not_found'; end if;
  if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid
    or p_context_hash is null or p_context_hash !~ '^[0-9a-f]{64}$'
    or p_terms is null or jsonb_typeof(p_terms)<>'object' or (select count(*) from jsonb_object_keys(p_terms))<>3
    or coalesce(p_terms->>'funderAddress','') !~ '^0x[0-9a-f]{40}$'
    or coalesce(p_terms->>'operatorAddress','') !~ '^0x[0-9a-f]{40}$'
    or p_terms->>'funderAddress'='0x0000000000000000000000000000000000000000'
    or p_terms->>'operatorAddress'='0x0000000000000000000000000000000000000000'
    or p_terms->>'funderAddress'=p_terms->>'operatorAddress'
    or jsonb_typeof(p_terms->'reviewPeriods') is distinct from 'array' or jsonb_array_length(p_terms->'reviewPeriods')<>6
    then raise exception 'invalid_reward_programme_approval'; end if;
  for t in select value from jsonb_array_elements(p_terms->'reviewPeriods') loop
    if jsonb_typeof(t)<>'number' or t::text !~ '^[0-9]{1,7}$' or t::integer>2592000 then raise exception 'invalid_reward_programme_approval'; end if;
  end loop;
  view:=public.service_read_reward_programme_approval_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  -- Same request is recovered without creating a second approval, even if a
  -- later revision made it stale. Foreign/reused keys never change its meaning.
  select * into a from app_private.reward_programme_approvals_v3 where id=p_request_id;
  if found then
    if a.draft_id<>p_draft_id or a.approved_by_user_id<>p_actor_user_id or a.context_hash<>p_context_hash or a.terms<>p_terms
      or a.previous_approval_id is distinct from p_expected_approval_id
      then raise exception 'reward_programme_request_conflict'; end if;
    return view;
  end if;
  if view->>'contextHash' is distinct from p_context_hash then raise exception 'reward_planning_revision_changed'; end if;
  if (view->'approval'->>'id')::uuid is distinct from p_expected_approval_id then raise exception 'reward_programme_request_conflict'; end if;
  if (view->'workspace'->>'revision')::integer=0 then raise exception 'reward_programme_scope_incomplete'; end if;
  -- No once-only pending-scope protocol has been implemented: all five race
  -- scopes must therefore exist before the programme funding plan is approved.
  for r in select value from jsonb_array_elements(view->'workspace'->'mapping'->'rounds') loop
    select value into source from jsonb_array_elements(view->'workspace'->'catalogue'->'rounds') c
      where c->>'id'=r->>'roundId' and c->>'slot'=r->>'slot' and c->>'status'<>'cancelled';
    if source is null or jsonb_array_length(source->'races')=0 then raise exception 'reward_programme_scope_incomplete'; end if;
  end loop;
  if jsonb_array_length(view->'workspace'->'mapping'->'rounds')<>5 then raise exception 'reward_programme_scope_incomplete'; end if;
  context:=app_private.reward_programme_context_v3(view->'record',view->'workspace');
  insert into app_private.reward_programme_approvals_v3(id,draft_id,previous_approval_id,rules_revision,mapping_revision,context_hash,context,terms,approved_by_user_id)
    values(p_request_id,p_draft_id,p_expected_approval_id,d.revision,(view->'workspace'->>'revision')::integer,p_context_hash,context,p_terms,p_actor_user_id);
  -- A context can move independently of the draft. Recompute after the insert;
  -- authorization/context drift rolls back the complete approval transaction.
  view:=public.service_read_reward_programme_approval_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if view->>'contextHash' is distinct from p_context_hash then raise exception 'reward_planning_revision_changed'; end if;
  return view;
end $$;
revoke all on function app_private.reward_programme_context_v3(jsonb,jsonb),
  public.service_read_reward_programme_approval_v3(uuid,uuid,integer,uuid),
  public.service_approve_reward_programme_v3(uuid,uuid,integer,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_programme_context_v3(jsonb,jsonb),
  public.service_read_reward_programme_approval_v3(uuid,uuid,integer,uuid),
  public.service_approve_reward_programme_v3(uuid,uuid,integer,uuid,uuid,uuid,text,jsonb) to service_role;
commit;
