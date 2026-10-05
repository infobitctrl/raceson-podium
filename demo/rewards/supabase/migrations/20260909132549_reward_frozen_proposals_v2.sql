begin;
-- Immutable UNAPPROVED planning evidence. No ledger awards or review clocks.
create table app_private.reward_frozen_proposals_v2 (
  draft_id uuid not null references app_private.reward_planning_drafts(id),
  slot integer not null check(slot between 1 and 5),
  revision integer not null check(revision>0),
  document jsonb not null check(jsonb_typeof(document)='object' and octet_length(document::text)<=2097152),
  proposal_hash text not null check(proposal_hash ~ '^[0-9a-f]{64}$'),
  frozen_at timestamptz not null default clock_timestamp(),
  frozen_by_user_id uuid not null references public.user_profiles(user_id),
  primary key(draft_id,slot,revision)
);
alter table app_private.reward_frozen_proposals_v2 enable row level security;
revoke all on app_private.reward_frozen_proposals_v2 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_frozen_proposals_v2 to service_role;
create function app_private.seal_reward_proposal_v2() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
  if tg_op<>'INSERT' then raise exception 'reward_proposal_immutable'; end if;
  new.proposal_hash:=encode(sha256(convert_to(new.document::text,'UTF8')),'hex');
  new.frozen_at:=clock_timestamp(); return new;
end $$;
create trigger reward_frozen_proposal_immutable_v2 before insert or update or delete on app_private.reward_frozen_proposals_v2
  for each row execute function app_private.seal_reward_proposal_v2();
revoke all on function app_private.seal_reward_proposal_v2() from public,anon,authenticated,service_role;

create function app_private.reward_frozen_proposal_document_v2(p app_private.reward_frozen_proposals_v2)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('revision',p.revision,'frozenAt',p.frozen_at,'proposalHash',p.proposal_hash,'document',p.document)
$$;
create function public.service_list_reward_proposals_v2(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,p_slot integer)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare result jsonb; d jsonb;
begin
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if p_slot is null or p_slot not between 1 and 5 then raise exception 'invalid_reward_planning_request'; end if;
  select coalesce(jsonb_agg(app_private.reward_frozen_proposal_document_v2(p) order by p.revision desc),'[]'::jsonb) into result
    from (select * from app_private.reward_frozen_proposals_v2 where draft_id=p_draft_id and slot=p_slot order by revision desc limit 10) p;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,(d->>'organizationId')::uuid) then raise exception 'reward_planning_not_found'; end if;
  return result;
end $$;
create function public.service_freeze_reward_proposal_v2(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,p_slot integer,
  p_rules_revision integer,p_mapping_revision integer,p_catalogue_hash text,p_source_hash text,p_calculation jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d jsonb; context jsonb; proposal jsonb; old app_private.reward_frozen_proposals_v2%rowtype; saved app_private.reward_frozen_proposals_v2%rowtype;
begin
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  -- Same role/org -> draft locking order as planning writes. All revisions and
  -- source hashes are rechecked after the lock; waiting never grants stale Auth.
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(d->>'organizationId')::uuid for share;
  perform 1 from public.organizations where id=(d->>'organizationId')::uuid for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  context:=public.service_read_reward_published_preview_v2(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if p_slot is null or p_slot not between 1 and 5 or context->'snapshot'='null'::jsonb then raise exception 'invalid_reward_planning_request'; end if;
  if p_rules_revision is distinct from (context#>>'{record,revision}')::integer
    or p_mapping_revision is distinct from (context#>>'{workspace,revision}')::integer
    or p_catalogue_hash is distinct from context#>>'{workspace,catalogueHash}'
    or p_catalogue_hash is distinct from context#>>'{workspace,boundCatalogueHash}'
    or p_source_hash is distinct from context->>'sourceHash' then raise exception 'reward_planning_revision_changed'; end if;
  -- Calculation comes only from the demo server's deterministic calculator.
  -- The HTTP input accepts expectations, never a client calculation or clock.
  if p_calculation is null or jsonb_typeof(p_calculation)<>'object' or octet_length(p_calculation::text)>1048576
    or p_calculation->>'slot' is distinct from p_slot::text
    or (select count(*) from jsonb_object_keys(p_calculation))<>6
    or not (p_calculation ?& array['slot','sourceName','budgetWei','proposedWei','retainedWei','categories'])
    then raise exception 'invalid_reward_planning_request'; end if;
  if coalesce(p_calculation->>'budgetWei','') !~ '^(0|[1-9][0-9]{0,77})$'
    or coalesce(p_calculation->>'proposedWei','') !~ '^(0|[1-9][0-9]{0,77})$'
    or coalesce(p_calculation->>'retainedWei','') !~ '^(0|[1-9][0-9]{0,77})$'
    or jsonb_typeof(p_calculation->'categories') is distinct from 'array' then raise exception 'invalid_reward_planning_request'; end if;
  if (p_calculation->>'budgetWei')::numeric<>(p_calculation->>'proposedWei')::numeric+(p_calculation->>'retainedWei')::numeric
    then raise exception 'invalid_reward_planning_request'; end if;
  proposal:=jsonb_build_object('version',2,'slot',p_slot,'record',context->'record','workspace',context->'workspace',
    'sourceHash',p_source_hash,'calculation',p_calculation);
  select * into old from app_private.reward_frozen_proposals_v2 where draft_id=p_draft_id and slot=p_slot order by revision desc limit 1;
  if found and old.document=proposal then return app_private.reward_frozen_proposal_document_v2(old); end if;
  insert into app_private.reward_frozen_proposals_v2(draft_id,slot,revision,document,proposal_hash,frozen_by_user_id)
    values(p_draft_id,p_slot,coalesce(old.revision,0)+1,proposal,repeat('0',64),p_actor_user_id) returning * into saved;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,(d->>'organizationId')::uuid) then raise exception 'reward_planning_not_found'; end if;
  return app_private.reward_frozen_proposal_document_v2(saved);
end $$;
revoke all on function app_private.reward_frozen_proposal_document_v2(app_private.reward_frozen_proposals_v2),
  public.service_list_reward_proposals_v2(uuid,uuid,integer,uuid,integer),
  public.service_freeze_reward_proposal_v2(uuid,uuid,integer,uuid,integer,integer,integer,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_frozen_proposal_document_v2(app_private.reward_frozen_proposals_v2),
  public.service_list_reward_proposals_v2(uuid,uuid,integer,uuid,integer),
  public.service_freeze_reward_proposal_v2(uuid,uuid,integer,uuid,integer,integer,integer,text,text,jsonb) to service_role;
commit;
