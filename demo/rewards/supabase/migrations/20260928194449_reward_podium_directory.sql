-- Isolated Podium demo: only explicitly completed public campaigns. No writes.
begin;
create function public.service_reward_public_directory(p_chain_id integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_chain_id is null or p_chain_id not in (10143,31337) then raise exception 'invalid_public_directory'; end if;
 with eligible as (
  select p.setup_id,p.campaign,p.completed_at,x.plan,x.deployment_hash,x.funding_hash,d.owner_user_id,
   r.configuration->'sponsorSelection' as selection
  from app_private.reward_public_campaigns p
  join app_private.reward_sponsor_executions x on x.setup_id=p.setup_id and x.launch_id=p.launch_id
  join app_private.reward_distribution_setups d on d.id=p.setup_id and d.chain_id=p_chain_id
  join app_private.reward_sponsor_launches l on l.id=p.launch_id
  join app_private.reward_setup_revisions r on r.setup_id=p.setup_id and r.revision=l.setup_revision
  where (x.plan->>'chainId')::integer=p_chain_id and x.funding_hash is not null and x.deployment_hash is not null
 ) select jsonb_build_object('sponsors',count(distinct owner_user_id),'items',coalesce(jsonb_agg(jsonb_build_object(
  'campaign',campaign,'selection',selection,'publishedAt',to_char(completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'record',jsonb_build_object('plan',plan,'deploymentHash',deployment_hash,'fundingHash',funding_hash)) order by completed_at desc,setup_id),'[]'::jsonb))
 into result from eligible;
 return result;
end $$;
revoke all on function public.service_reward_public_directory(integer) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_public_directory(integer) to service_role;
commit;
