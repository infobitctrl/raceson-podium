begin;

-- One fixed six-child deployment per demo draft. A nonce reservation is not a
-- signing/send lease. Stale plans retain their nonce; never release/recycle it.
create table app_private.reward_programme_deployment_intents_v3 (
  id uuid primary key,
  draft_id uuid not null unique references app_private.reward_planning_drafts(id),
  approval_id uuid not null unique,
  chain_id integer not null check(chain_id in(31337,10143)),
  operator_address app_private.reward_address not null,
  nonce app_private.reward_uint256 not null check(nonce<=9007199254740991),
  maximum_gas_cost_wei app_private.reward_uint256 not null check(maximum_gas_cost_wei>0),
  creation_code_hash app_private.reward_bytes32 not null check(creation_code_hash=decode('224d0de436541933a7cd8c4967702e3ccde77bc3f01af5eb9f62f12269b066e4','hex')),
  created_by_user_id uuid not null references public.user_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(draft_id,approval_id) references app_private.reward_programme_approvals_v3(draft_id,id),
  unique(id,chain_id,operator_address,nonce)
);
alter table app_private.reward_programme_deployment_intents_v3 enable row level security;
revoke all on app_private.reward_programme_deployment_intents_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_programme_deployment_intents_v3 to service_role;
create policy reward_programme_deployment_v3_select on app_private.reward_programme_deployment_intents_v3 for select to service_role using(true);
create policy reward_programme_deployment_v3_insert on app_private.reward_programme_deployment_intents_v3 for insert to service_role with check(true);
create trigger reward_programme_deployment_v3_immutable before update or delete on app_private.reward_programme_deployment_intents_v3
  for each row execute function app_private.reject_reward_ledger_mutation();

-- Extend the existing typed nonce book. Historical campaign owners must still
-- have their campaign ID; only the new programme owner may omit it. Both FK
-- directions enforce an actual matching owner, not a polymorphic arbitrary ID.
alter table app_private.reward_operator_nonce_slots add column programme_deployment_intent_id uuid unique;
alter table app_private.reward_operator_nonce_slots alter column campaign_id drop not null;
alter table app_private.reward_operator_nonce_slots drop constraint reward_operator_nonce_slots_check;
alter table app_private.reward_operator_nonce_slots add constraint reward_operator_nonce_slots_check
  check(num_nonnulls(deployment_intent_id,funding_intent_id,lifecycle_intent_id,programme_deployment_intent_id)=1
    and ((programme_deployment_intent_id is null and campaign_id is not null)
      or (programme_deployment_intent_id is not null and campaign_id is null)));
alter table app_private.reward_operator_nonce_slots add constraint reward_programme_nonce_v3_key
  unique(chain_id,operator_address,nonce,programme_deployment_intent_id);
alter table app_private.reward_operator_nonce_slots add constraint reward_programme_nonce_v3_owner
  foreign key(programme_deployment_intent_id,chain_id,operator_address,nonce)
  references app_private.reward_programme_deployment_intents_v3(id,chain_id,operator_address,nonce);
alter table app_private.reward_programme_deployment_intents_v3 add constraint reward_programme_v3_requires_nonce
  foreign key(chain_id,operator_address,nonce,id)
  references app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,programme_deployment_intent_id)
  deferrable initially deferred;
create function app_private.record_reward_programme_nonce_v3()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  insert into app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,programme_deployment_intent_id)
    values(new.chain_id,new.operator_address,new.nonce,new.id);
  return new;
end $$;
create trigger reward_programme_v3_nonce after insert on app_private.reward_programme_deployment_intents_v3
  for each row execute function app_private.record_reward_programme_nonce_v3();

create function public.service_read_reward_programme_deployment_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare v jsonb; i app_private.reward_programme_deployment_intents_v3%rowtype; a app_private.reward_programme_approvals_v3%rowtype;
begin
  v:=public.service_read_reward_programme_approval_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select * into i from app_private.reward_programme_deployment_intents_v3 where draft_id=p_draft_id;
  if i.id is not null then
    select * into a from app_private.reward_programme_approvals_v3 where id=i.approval_id;
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,(v->'record'->>'organizationId')::uuid) then raise exception 'reward_planning_not_found'; end if;
  return jsonb_build_object('schema','raceson-programme-deployment-v3','approvalView',v,'intent',case when i.id is not null then
    jsonb_build_object('id',i.id,'approvalId',i.approval_id,'contextHash',a.context_hash,'rules',a.context->'rules','terms',a.terms,
      'chainId',i.chain_id,'operatorAddress',i.operator_address,'nonce',i.nonce::text,'maximumGasCostWei',i.maximum_gas_cost_wei::text,'creationCodeHash','0x'||encode(i.creation_code_hash,'hex'),
      'createdByUserId',i.created_by_user_id,'createdAt',i.created_at,
      'current',a.context_hash=v->>'contextHash' and v->'approval'->>'id'=a.id::text) end);
end $$;

create function public.service_reserve_reward_programme_deployment_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_request_id uuid,p_approval_id uuid,p_context_hash text,p_pending_nonce text,p_maximum_gas_cost_wei text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; i app_private.reward_programme_deployment_intents_v3%rowtype; a app_private.reward_programme_approvals_v3%rowtype;
  org uuid; signer_address text; next_nonce numeric;
begin
  -- This first read deliberately takes no draft lock. The shared order is
  -- chain/signer, organization authority, then draft, identical on every retry.
  perform public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid or p_approval_id is null
    or p_context_hash is null or p_context_hash !~ '^[0-9a-f]{64}$'
    or p_pending_nonce is null or p_pending_nonce !~ '^(0|[1-9][0-9]{0,15})$' or p_pending_nonce::numeric>9007199254740991
    or p_maximum_gas_cost_wei is null or p_maximum_gas_cost_wei !~ '^[1-9][0-9]{0,77}$'
    then raise exception 'invalid_reward_programme_deployment'; end if;
  perform p_maximum_gas_cost_wei::app_private.reward_uint256;
  select * into a from app_private.reward_programme_approvals_v3 where id=p_approval_id and draft_id=p_draft_id;
  if not found or a.approved_by_user_id<>p_actor_user_id or a.context_hash<>p_context_hash then raise exception 'reward_programme_approval_required'; end if;
  signer_address:=a.terms->>'operatorAddress'; org:=(a.context->>'organizationId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||p_chain_id::text||':'||signer_address,0));
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=org for share;
  perform 1 from public.organizations where id=org for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  v:=public.service_read_reward_programme_approval_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select * into i from app_private.reward_programme_deployment_intents_v3 where draft_id=p_draft_id or id=p_request_id;
  if found then
    if i.id<>p_request_id or i.draft_id<>p_draft_id or i.approval_id<>p_approval_id or i.created_by_user_id<>p_actor_user_id
      or i.maximum_gas_cost_wei<>p_maximum_gas_cost_wei::numeric then raise exception 'reward_programme_deployment_conflict'; end if;
    -- Recover history even when stale, never reinterpret it as executable.
    return public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  end if;
  if v->'approval'->>'id' is distinct from p_approval_id::text or v->>'contextHash' is distinct from p_context_hash
    or v->'approval'->'current' is distinct from 'true'::jsonb then raise exception 'reward_programme_approval_required'; end if;
  -- Own stored reservations are a lower bound in addition to the observed RPC
  -- pending count. The existing trigger rejects operator/relayer role overlap.
  select greatest(p_pending_nonce::numeric,coalesce(max(s.nonce)+1,0)) into next_nonce
    from app_private.reward_operator_nonce_slots s where s.chain_id=p_chain_id and s.operator_address=signer_address;
  if next_nonce>9007199254740991 then raise exception 'reward_deployment_nonce_exhausted'; end if;
  insert into app_private.reward_programme_deployment_intents_v3(id,draft_id,approval_id,chain_id,operator_address,nonce,
    maximum_gas_cost_wei,creation_code_hash,created_by_user_id)
    values(p_request_id,p_draft_id,p_approval_id,p_chain_id,signer_address,next_nonce,p_maximum_gas_cost_wei::numeric,
      decode('224d0de436541933a7cd8c4967702e3ccde77bc3f01af5eb9f62f12269b066e4','hex'),p_actor_user_id);
  v:=public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if v->'intent'->'current' is distinct from 'true'::jsonb then raise exception 'reward_programme_approval_required'; end if;
  return v;
end $$;
revoke all on function app_private.record_reward_programme_nonce_v3(),
  public.service_read_reward_programme_deployment_v3(uuid,uuid,integer,uuid),
  public.service_reserve_reward_programme_deployment_v3(uuid,uuid,integer,uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function app_private.record_reward_programme_nonce_v3(),
  public.service_read_reward_programme_deployment_v3(uuid,uuid,integer,uuid),
  public.service_reserve_reward_programme_deployment_v3(uuid,uuid,integer,uuid,uuid,uuid,text,text,text) to service_role;
commit;
