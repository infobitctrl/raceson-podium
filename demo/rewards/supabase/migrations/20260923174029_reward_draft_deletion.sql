begin;
-- Demo-only soft deletion. Keep immutable revisions and all execution history.
create function public.service_delete_reward_draft(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
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
 if d.configuration->>'stage' is distinct from 'draft'
  or exists(select 1 from app_private.reward_sponsor_launches where setup_id=d.id)
  or exists(select 1 from app_private.reward_sponsor_executions where setup_id=d.id)
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
commit;
