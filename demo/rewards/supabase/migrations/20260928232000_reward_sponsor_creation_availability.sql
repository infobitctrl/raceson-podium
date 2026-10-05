begin;
-- Availability only: never reserves, changes a nonce, returns another campaign,
-- or authorizes creation. Reservation repeats the check under its existing lock.
create function public.service_reward_sponsor_creation_available(
 p_actor_user_id uuid,p_actor_session_id uuid,p_setup_id uuid,p_sender text)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare owned uuid;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 select d.id into owned from app_private.reward_distribution_setups d
 join app_private.reward_sponsor_executions e on e.setup_id=d.id
 where d.id=p_setup_id and d.owner_user_id=p_actor_user_id
 and d.chain_id=10143 and d.archived_at is null;
 if owned is null then raise exception 'reward_setup_not_found'; end if;
 if p_sender is null or p_sender !~ '^0x[0-9a-f]{40}$' or p_sender='0x'||repeat('0',40)
 then raise exception 'invalid_sponsor_creation'; end if;
 return not exists(select 1 from app_private.reward_controller_transactions
 where sender=p_sender and not confirmed);
end $$;
revoke all on function public.service_reward_sponsor_creation_available(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.service_reward_sponsor_creation_available(uuid,uuid,uuid,text) to service_role;
commit;
