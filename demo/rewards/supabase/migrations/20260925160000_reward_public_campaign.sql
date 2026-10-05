-- Completing setup publishes a restricted snapshot, never an allocation or chain action.
begin;
create table app_private.reward_public_campaigns (
 setup_id uuid primary key references app_private.reward_distribution_setups(id),
 launch_id uuid not null references app_private.reward_sponsor_launches(id),
 campaign jsonb not null check(jsonb_typeof(campaign)='object' and octet_length(campaign::text)<131072),
 completed_at timestamptz not null default clock_timestamp()
);
alter table app_private.reward_public_campaigns enable row level security;
revoke all on app_private.reward_public_campaigns from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_public_campaigns to service_role;
create policy public_campaign_read on app_private.reward_public_campaigns for select to service_role using(true);
create policy public_campaign_insert on app_private.reward_public_campaigns for insert to service_role with check(true);
create function public.service_reward_public_campaign(p_chain_id integer,p_setup_id uuid,
 p_actor_user_id uuid default null,p_actor_session_id uuid default null,p_campaign jsonb default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare e app_private.reward_sponsor_executions%rowtype; d app_private.reward_distribution_setups%rowtype;
begin
 if p_chain_id is null or p_chain_id not in(10143,31337) or p_setup_id is null then raise exception 'invalid_public_campaign'; end if;
 if p_campaign is not null then
  -- The existing journal enforces current session, owner and chain before publication.
  perform public.service_reward_sponsor_execution(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id);
  select * into strict e from app_private.reward_sponsor_executions where setup_id=p_setup_id;
  select * into strict d from app_private.reward_distribution_setups where id=p_setup_id;
  if e.funding_hash is null or e.deployment_hash is null then raise exception 'campaign_funding_required'; end if;
  if (e.plan->>'setupRevision')::integer<>d.revision then raise exception 'reward_setup_conflict'; end if;
  if p_campaign->>'id' is distinct from p_setup_id::text or p_campaign->>'chainId' is distinct from p_chain_id::text
   or p_campaign->>'fundingHash' is distinct from e.funding_hash or p_campaign->>'budgetWei' is distinct from e.plan->>'budgetWei'
   then raise exception 'invalid_public_campaign'; end if;
  insert into app_private.reward_public_campaigns(setup_id,launch_id,campaign) values(p_setup_id,e.launch_id,p_campaign)
   on conflict(setup_id) do nothing;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 end if;
 -- Internal service envelope. HTTP projects only campaign; the plan never reaches a public client.
 return (select jsonb_build_object('campaign',p.campaign,'record',jsonb_build_object('plan',x.plan,'deploymentHash',x.deployment_hash,'fundingHash',x.funding_hash))
  from app_private.reward_public_campaigns p join app_private.reward_sponsor_executions x on x.setup_id=p.setup_id and x.launch_id=p.launch_id
  where p.setup_id=p_setup_id and (x.plan->>'chainId')::integer=p_chain_id and x.funding_hash is not null);
end $$;
revoke all on function public.service_reward_public_campaign(integer,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_public_campaign(integer,uuid,uuid,uuid,jsonb) to service_role;
commit;
