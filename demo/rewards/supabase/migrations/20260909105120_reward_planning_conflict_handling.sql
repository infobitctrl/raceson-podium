begin;

-- Optimistic revision conflict is a domain outcome, not a transient SQL
-- serialization failure. SQLSTATE 40001 causes PostgREST transaction retries.
-- Keep already-applied demo history immutable and return the safe API 409.
create or replace function public.service_save_reward_planning_draft(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_expected_revision integer,p_rules jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select * into d from app_private.reward_planning_drafts where id=p_draft_id and chain_id=p_chain_id;
  if not found or not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then
    raise exception using errcode='42501',message='reward_planning_not_found';
  end if;
  -- Lock the current role and organization, not a JWT role or browser claim.
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=d.organization_id for share;
  perform 1 from public.organizations where id=d.organization_id for share;
  select * into d from app_private.reward_planning_drafts where id=p_draft_id for update;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then
    raise exception using errcode='42501',message='reward_planning_not_found';
  end if;
  if p_expected_revision is null or d.revision<>p_expected_revision then
    raise exception using errcode='P0001',message='reward_planning_revision_changed';
  end if;
  if p_rules is null or jsonb_typeof(p_rules)<>'object' or octet_length(p_rules::text)>16384
    or p_rules->>'version' is distinct from '2' or p_rules->>'network' is distinct from 'monad-testnet'
    or p_rules->>'reviewSeconds' is distinct from '86400' then
    raise exception 'invalid_reward_planning_request';
  end if;
  -- Identical saves do not inflate revisions. Stale writes still conflict.
  if d.rules=p_rules then return app_private.reward_planning_document(d); end if;
  insert into app_private.reward_planning_revisions(draft_id,revision,rules,saved_at,saved_by_user_id)
    values(d.id,d.revision,d.rules,d.updated_at,d.updated_by_user_id) on conflict do nothing;
  update app_private.reward_planning_drafts set rules=p_rules,revision=revision+1,
    updated_at=clock_timestamp(),updated_by_user_id=p_actor_user_id where id=d.id returning * into d;
  insert into app_private.reward_planning_revisions(draft_id,revision,rules,saved_at,saved_by_user_id)
    values(d.id,d.revision,d.rules,d.updated_at,d.updated_by_user_id);
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return app_private.reward_planning_document(d);
end $$;

alter table app_private.reward_planning_drafts add constraint reward_planning_rules_envelope
  check (coalesce(rules->>'version'='2' and rules->>'network'='monad-testnet'
    and rules->>'reviewSeconds'='86400',false));

commit;
