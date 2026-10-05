begin;
-- Demo-only soft deletion. Keep immutable revisions and all execution history.
create or replace function public.service_delete_reward_draft(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_setup_id uuid,p_expected_revision integer)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_distribution_setups%rowtype;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(10143,31337) or p_setup_id is null
  or p_setup_id='00000000-0000-0000-0000-000000000000'::uuid
  or p_expected_revision is null or p_expected_revision not between 1 and 2147483645
  then raise exception 'invalid_reward_setup'; end if;
 -- Same ordering as saves; launch preparation also takes the setup lock.
 perform pg_advisory_xact_lock(hashtextextended('reward-setup-owner:'||p_actor_user_id::text||':'||p_chain_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_setup_id::text,0));
 perform 1 from public.user_profiles where user_id=p_actor_user_id for share;
 select * into d from app_private.reward_distribution_setups where id=p_setup_id for update;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if d.id is null or d.owner_user_id<>p_actor_user_id or d.chain_id<>p_chain_id then raise exception 'reward_setup_not_found'; end if;
 if d.revision<>p_expected_revision then raise exception 'reward_setup_conflict'; end if;
 if exists(select 1 from app_private.reward_sponsor_executions where setup_id=d.id)
  or exists(select 1 from app_private.reward_sponsor_auto_deployments where setup_id=d.id)
  then raise exception 'reward_setup_not_deletable'; end if;
 -- Exact retries after a lost response are safe; no economic revision is added.
 if d.archived_at is null then
  update app_private.reward_distribution_setups set archived_at=clock_timestamp() where id=d.id;
 end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 return jsonb_build_object('id',d.id,'deleted',true);
end $$;
revoke all on function public.service_delete_reward_draft(uuid,uuid,integer,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.service_delete_reward_draft(uuid,uuid,integer,uuid,integer) to service_role;


-- List archiving is reversible and never disables campaign or receipt access.
-- It is deliberately separate from archived_at, which soft-deletes a draft.
alter table app_private.reward_distribution_setups add column list_archived_at timestamptz;
create or replace function app_private.reward_setup_document(d app_private.reward_distribution_setups)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',d.id,'chainId',d.chain_id,'revision',d.revision,'configuration',d.configuration,
 'updatedAt',to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'lifecycle',jsonb_build_object(
   'state',case when e.funding_hash is not null then 'funded'
     when e.deployment_hash is not null then 'deposit'
     when e.setup_id is not null or exists(select 1 from app_private.reward_sponsor_launches where setup_id=d.id) then 'saved'
     else 'draft' end,
   'archived',d.list_archived_at is not null,
   'canDelete',d.archived_at is null and e.setup_id is null
     and not exists(select 1 from app_private.reward_sponsor_auto_deployments where setup_id=d.id)))
 from (select 1) seed left join app_private.reward_sponsor_executions e on e.setup_id=d.id;
$$;
revoke all on function app_private.reward_setup_document(app_private.reward_distribution_setups) from public,anon,authenticated;
grant execute on function app_private.reward_setup_document(app_private.reward_distribution_setups) to service_role;

create function public.service_archive_reward_setup(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_setup_id uuid,p_expected_revision integer,p_archived boolean)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_distribution_setups%rowtype;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(10143,31337) or p_setup_id is null
  or p_setup_id='00000000-0000-0000-0000-000000000000'::uuid
  or p_expected_revision is null or p_expected_revision not between 1 and 2147483645 or p_archived is null
  then raise exception 'invalid_reward_setup'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-setup-owner:'||p_actor_user_id::text||':'||p_chain_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_setup_id::text,0));
 perform 1 from public.user_profiles where user_id=p_actor_user_id for share;
 select * into d from app_private.reward_distribution_setups where id=p_setup_id and archived_at is null for update;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if d.id is null or d.owner_user_id<>p_actor_user_id or d.chain_id<>p_chain_id then raise exception 'reward_setup_not_found'; end if;
 if d.revision<>p_expected_revision then raise exception 'reward_setup_conflict'; end if;
 -- A lost response is retryable even if a funding receipt was saved afterward.
 -- Restoring access to the active list is always permitted for this owner.
 if p_archived and d.list_archived_at is null and exists(
  select 1 from app_private.reward_sponsor_executions where setup_id=d.id and funding_hash is not null)
  then raise exception 'reward_setup_not_archivable'; end if;
 if p_archived is distinct from (d.list_archived_at is not null) then
  update app_private.reward_distribution_setups
   set list_archived_at=case when p_archived then clock_timestamp() else null end
   where id=d.id returning * into d;
 end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 return app_private.reward_setup_document(d);
end $$;
revoke all on function public.service_archive_reward_setup(uuid,uuid,integer,uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.service_archive_reward_setup(uuid,uuid,integer,uuid,integer,boolean) to service_role;
commit;
