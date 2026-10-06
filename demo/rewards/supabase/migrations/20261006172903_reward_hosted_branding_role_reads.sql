begin;
-- Reuse presentation storage and its revision checks. Only the isolated copied
-- cohort is visible; generic RPC access remains revoked from the hosted service.
create or replace function public.service_reward_demo_copy_campaign_branding(p_actor_user_id uuid default null,
 p_actor_session_id uuid default null,p_setup_id uuid default null,p_change jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare account jsonb; rows jsonb; result jsonb; row jsonb;
begin
 if p_actor_user_id is not null or p_actor_session_id is not null or p_change is not null then
  account:=app_private.reward_demo_web_session(p_actor_user_id,p_actor_session_id);
  if account->>'kind' is distinct from 'sponsor' then
   if p_change is not null then raise exception 'reward_demo_sponsor_required'; end if;
   return '[]'::jsonb;
  end if;
  if p_setup_id is not null then
   perform app_private.require_reward_demo_copy_setup(p_actor_user_id,p_actor_session_id,p_setup_id);
  elsif p_change is not null then raise exception 'invalid_campaign_branding'; end if;
 end if;
 rows:=public.service_reward_campaign_branding(10143,p_actor_user_id,p_actor_session_id,p_setup_id,p_change);
 result:='[]'::jsonb;
 for row in select value from jsonb_array_elements(rows) loop
  if p_actor_user_id is not null then
   if exists(select 1 from app_private.reward_demo_copy_setup_bindings b
    join app_private.reward_distribution_setups d on d.id=b.setup_id
    where d.id=(row->>'id')::uuid and d.owner_user_id=p_actor_user_id and d.chain_id=10143 and d.archived_at is null
     and b.batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644') then
    perform app_private.require_reward_demo_copy_setup(p_actor_user_id,p_actor_session_id,(row->>'id')::uuid);
    result:=result||jsonb_build_array(row);
   end if;
  elsif app_private.reward_demo_copy_public_scope((row->>'id')::uuid) then
   result:=result||jsonb_build_array(row);
  end if;
 end loop;
 return result;
end $$;
revoke all on function public.service_reward_demo_copy_campaign_branding(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_campaign_branding(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
