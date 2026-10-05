-- Isolated demo only. Immutable preparation; no chain job, wallet or payment authority.
begin;
create table app_private.reward_sponsor_launches (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
 setup_id uuid not null,
 setup_revision integer not null,
 configuration_hash text not null check(configuration_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 unique(setup_id,setup_revision),
 foreign key(setup_id,setup_revision) references app_private.reward_setup_revisions(setup_id,revision)
);
alter table app_private.reward_sponsor_launches enable row level security;
revoke all on app_private.reward_sponsor_launches from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_sponsor_launches to service_role;
create policy reward_sponsor_launch_read on app_private.reward_sponsor_launches for select to service_role using(true);
create policy reward_sponsor_launch_insert on app_private.reward_sponsor_launches for insert to service_role with check(true);

create function public.service_reward_sponsor_launch(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_setup_id uuid,p_request_id uuid default null,p_expected_revision integer default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_distribution_setups%rowtype; l app_private.reward_sponsor_launches%rowtype;
 r app_private.reward_setup_revisions%rowtype; result jsonb; item record; n jsonb; shares numeric;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(10143,31337) or p_setup_id is null
  or p_setup_id='00000000-0000-0000-0000-000000000000'::uuid
  or (p_request_id is null)<>(p_expected_revision is null)
  or p_request_id='00000000-0000-0000-0000-000000000000'::uuid
  or p_expected_revision not between 1 and 2147483645 then raise exception 'invalid_sponsor_launch'; end if;
 -- Same lock as draft saves; freeze only a reviewed current revision.
 perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_setup_id::text,0));
 select * into d from app_private.reward_distribution_setups
  where id=p_setup_id and owner_user_id=p_actor_user_id and chain_id=p_chain_id and archived_at is null for share;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if d.id is null then raise exception 'reward_setup_not_found'; end if;
 if p_request_id is not null then
  select * into l from app_private.reward_sponsor_launches where id=p_request_id;
  if l.id is not null then
   if l.setup_id<>d.id or l.setup_revision<>p_expected_revision then raise exception 'reward_setup_conflict'; end if;
  else
   if d.revision<>p_expected_revision then raise exception 'reward_setup_conflict'; end if;
   if d.configuration->>'version'<>'5' or jsonb_array_length(d.configuration->'guided'->'groups')=0 then raise exception 'reward_launch_incomplete'; end if;
   -- Empty zero-budget branches are allowed; every funded split is exactly 100%.
   for item in with recursive tree(node,funded) as (
    select d.configuration->'root',true union all
    select child,tree.funded and (child->>'shareBps')::integer>0 from tree
      cross join lateral jsonb_array_elements(tree.node->'children') child
   ) select node from tree where funded loop
    n:=item.node;
    if exists(select 1 from jsonb_array_elements(d.configuration->'guided'->'groups') g where g->>'nodeId'=n->>'id' and g->>'method'='proportional') then continue; end if;
    if n->'rule'<>'null'::jsonb then
     select coalesce(sum(value::text::numeric),0) into shares from jsonb_array_elements(n->'rule'->'sharesBps');
    else
     select coalesce(sum((value->>'shareBps')::numeric),0) into shares from jsonb_array_elements(n->'children');
    end if;
    if shares<>10000 then raise exception 'reward_launch_incomplete'; end if;
   end loop;
   select * into l from app_private.reward_sponsor_launches where setup_id=d.id and setup_revision=d.revision;
   if l.id is null then
    insert into app_private.reward_sponsor_launches(id,setup_id,setup_revision,configuration_hash)
     values(p_request_id,d.id,d.revision,encode(pg_catalog.sha256(convert_to(d.configuration::text,'UTF8')),'hex')) returning * into l;
   end if;
  end if;
 else
  select * into l from app_private.reward_sponsor_launches where setup_id=d.id order by setup_revision desc limit 1;
 end if;
 result:=jsonb_build_object('setup',app_private.reward_setup_document(d),'launch',null);
 if l.id is not null then
  select * into strict r from app_private.reward_setup_revisions where setup_id=l.setup_id and revision=l.setup_revision;
  result:=jsonb_set(result,'{launch}',jsonb_build_object('id',l.id,'state','prepared','configurationHash',l.configuration_hash,
   'createdAt',to_char(l.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'setup',jsonb_build_object('id',d.id,'chainId',d.chain_id,'revision',r.revision,'configuration',r.configuration,
    'updatedAt',to_char(r.saved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));
 end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 return result;
end $$;
revoke all on function public.service_reward_sponsor_launch(uuid,uuid,integer,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_sponsor_launch(uuid,uuid,integer,uuid,uuid,integer) to service_role;
commit;
