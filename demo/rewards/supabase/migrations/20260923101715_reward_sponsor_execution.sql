-- Isolated demo sponsor V4 execution journal. Hashes are submitted hints until
-- independently verified by the server chain reader; never paid/funded assertions.
begin;
create table app_private.reward_sponsor_executions (
 setup_id uuid primary key references app_private.reward_distribution_setups(id),
 launch_id uuid not null unique references app_private.reward_sponsor_launches(id),
 plan jsonb not null check(jsonb_typeof(plan)='object' and octet_length(plan::text)<8192),
 deployment_hash text check(deployment_hash ~ '^0x[0-9a-f]{64}$' and deployment_hash <> '0x'||repeat('0',64)),
 funding_hash text check(funding_hash ~ '^0x[0-9a-f]{64}$' and funding_hash <> '0x'||repeat('0',64)),
 created_at timestamptz not null default clock_timestamp(),
 check(funding_hash is null or deployment_hash is not null)
);
alter table app_private.reward_sponsor_executions enable row level security;
revoke all on app_private.reward_sponsor_executions from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_sponsor_executions to service_role;
grant update(deployment_hash,funding_hash) on app_private.reward_sponsor_executions to service_role;
create policy sponsor_execution_read on app_private.reward_sponsor_executions for select to service_role using(true);
create policy sponsor_execution_insert on app_private.reward_sponsor_executions for insert to service_role with check(true);
create policy sponsor_execution_update on app_private.reward_sponsor_executions for update to service_role using(true) with check(true);
create function public.service_reward_sponsor_execution(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_setup_id uuid,p_plan jsonb default null,p_deployment_hash text default null,p_funding_hash text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_distribution_setups%rowtype; l app_private.reward_sponsor_launches%rowtype;
 e app_private.reward_sponsor_executions%rowtype; total numeric; entry jsonb;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(10143,31337) or p_setup_id is null then raise exception 'invalid_sponsor_execution'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_setup_id::text,0));
 select * into d from app_private.reward_distribution_setups where id=p_setup_id and owner_user_id=p_actor_user_id
  and chain_id=p_chain_id and archived_at is null for share;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if d.id is null then raise exception 'reward_setup_not_found'; end if;
 select * into e from app_private.reward_sponsor_executions where setup_id=d.id for update;
 if p_plan is not null then
  if jsonb_typeof(p_plan)<>'object' or octet_length(p_plan::text)>=8192 or (select count(*) from jsonb_object_keys(p_plan))<>13
   or not(p_plan ?& array['version','launchId','setupRevision','configurationHash','chainId','funder','operator','unallocatedTreasury','expiredTreasury','claimLifetime','reviewPeriods','caps','budgetWei'])
   then raise exception 'invalid_sponsor_execution'; end if;
  if p_plan->>'version'<>'4' or (p_plan->>'chainId')::integer<>p_chain_id then raise exception 'invalid_sponsor_execution'; end if;
  select * into l from app_private.reward_sponsor_launches where id=(p_plan->>'launchId')::uuid and setup_id=d.id;
  if l.id is null or p_plan->>'configurationHash'<>l.configuration_hash or (p_plan->>'setupRevision')::integer<>l.setup_revision then raise exception 'invalid_sponsor_execution'; end if;
  if e.setup_id is null then
   if l.setup_revision<>d.revision then raise exception 'reward_setup_conflict'; end if;
   foreach entry in array array[p_plan->'funder',p_plan->'operator',p_plan->'unallocatedTreasury',p_plan->'expiredTreasury'] loop
    if entry#>>'{}' !~ '^0x[0-9a-f]{40}$' or entry#>>'{}' = '0x'||repeat('0',40) then raise exception 'invalid_sponsor_execution'; end if;
   end loop;
   if p_plan->>'funder'=p_plan->>'operator' or (p_plan->>'claimLifetime')::integer not between 86400 and 315360000
    or (p_plan->>'claimLifetime')::integer%86400<>0 or jsonb_array_length(p_plan->'caps')<>6 or jsonb_array_length(p_plan->'reviewPeriods')<>6
    or p_plan->>'budgetWei' !~ '^[1-9][0-9]{0,24}$' then raise exception 'invalid_sponsor_execution'; end if;
   for entry in select value from jsonb_array_elements(p_plan->'reviewPeriods') loop
    if entry::text !~ '^[0-9]+$' or entry::text::numeric>2592000 then raise exception 'invalid_sponsor_execution'; end if;
   end loop;
   total:=0;
   for entry in select value from jsonb_array_elements(p_plan->'caps') loop
    if entry#>>'{}' !~ '^(0|[1-9][0-9]{0,24})$' then raise exception 'invalid_sponsor_execution'; end if;
    total:=total+(entry#>>'{}')::numeric;
   end loop;
   if total<>(p_plan->>'budgetWei')::numeric then raise exception 'invalid_sponsor_execution'; end if;
   insert into app_private.reward_sponsor_executions(setup_id,launch_id,plan) values(d.id,l.id,p_plan) returning * into e;
  elsif e.plan<>p_plan then raise exception 'reward_setup_conflict'; end if;
 end if;
 if p_deployment_hash is not null or p_funding_hash is not null then
  if e.setup_id is null then raise exception 'invalid_sponsor_execution'; end if;
  if p_deployment_hash is not null then
   if e.deployment_hash is not null and e.deployment_hash<>p_deployment_hash then raise exception 'reward_setup_conflict'; end if;
   update app_private.reward_sponsor_executions set deployment_hash=p_deployment_hash where setup_id=d.id returning * into e;
  end if;
  if p_funding_hash is not null then
   if e.deployment_hash is null or e.funding_hash is not null and e.funding_hash<>p_funding_hash then raise exception 'reward_setup_conflict'; end if;
   update app_private.reward_sponsor_executions set funding_hash=p_funding_hash where setup_id=d.id returning * into e;
  end if;
 end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if e.setup_id is null then return 'null'::jsonb; end if;
 return jsonb_build_object('plan',e.plan,'deploymentHash',e.deployment_hash,'fundingHash',e.funding_hash);
end $$;
revoke all on function public.service_reward_sponsor_execution(uuid,uuid,integer,uuid,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_sponsor_execution(uuid,uuid,integer,uuid,jsonb,text,text) to service_role;
commit;
