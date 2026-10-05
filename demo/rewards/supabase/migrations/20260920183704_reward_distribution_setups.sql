-- Private planning drafts only. No award, approval, funding or payout authority.
begin;
create function app_private.validate_reward_setup_configuration(c jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare n jsonb; r jsonb; s jsonb; v jsonb; seen text[]:='{}'; item record; total integer:=0;
begin
 if c is null or jsonb_typeof(c)<>'object' or pg_column_size(c)>262144 or
   (select array_agg(key order by key) from jsonb_object_keys(c) key)<>array['budgetMon','name','root','version']
   or c->'version'<>'1'::jsonb or jsonb_typeof(c->'name')<>'string' or length(btrim(c->>'name')) not between 1 and 100
   or (c->>'name') ~ '[[:cntrl:]]' or jsonb_typeof(c->'budgetMon')<>'string'
   or (c->>'budgetMon') !~ '^(0|[1-9][0-9]*)([.][0-9]{1,18})?$' or length(c->>'budgetMon')>26 then raise exception 'invalid_reward_setup'; end if;
 if (c->>'budgetMon')::numeric<=0 or (c->>'budgetMon')::numeric>1000000 then raise exception 'invalid_reward_setup'; end if;
 for item in
  with recursive tree(node,depth) as (
   select c->'root',0 union all
   select child,depth+1 from tree cross join lateral jsonb_array_elements(case when jsonb_typeof(node->'children')='array' then node->'children' else '[]'::jsonb end) child where depth<9
  ) select * from tree
 loop
  total:=total+1; n:=item.node;
  if total>1000 or item.depth>8 or jsonb_typeof(n)<>'object' or
   (select array_agg(key order by key) from jsonb_object_keys(n) key)<>array['children','id','locked','name','rule','shareBps'] then raise exception 'invalid_reward_setup'; end if;
  if jsonb_typeof(n->'id')<>'string' or (n->>'id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or n->>'id'='00000000-0000-0000-0000-000000000000' or n->>'id'=any(seen)
   or jsonb_typeof(n->'name')<>'string' or length(n->>'name')>100 or length(btrim(n->>'name'))<1 or n->>'name' ~ '[[:cntrl:]]'
   or jsonb_typeof(n->'locked')<>'boolean' or jsonb_typeof(n->'children')<>'array'
   or jsonb_typeof(n->'shareBps')<>'number' or (n->>'shareBps') !~ '^[0-9]+$' then raise exception 'invalid_reward_setup'; end if;
  if jsonb_array_length(n->'children')>50 or (n->>'shareBps')::numeric>10000 then raise exception 'invalid_reward_setup'; end if;
  seen:=array_append(seen,n->>'id');
  if item.depth=0 and (n->'shareBps'<>'10000'::jsonb or n->'locked'<>'false'::jsonb or n->'rule'<>'null'::jsonb) then raise exception 'invalid_reward_setup'; end if;
  r:=n->'rule';
  if r<>'null'::jsonb then
   if item.depth=0 or jsonb_array_length(n->'children')<>0 or jsonb_typeof(r)<>'object' or
    (select array_agg(key order by key) from jsonb_object_keys(r) key)<>array['basis','sharesBps','source'] then raise exception 'invalid_reward_setup'; end if;
   if jsonb_typeof(r->'basis')<>'string' or r->>'basis' not in('race_position','club_points','league_position','participation','manual')
    or jsonb_typeof(r->'sharesBps')<>'array' then raise exception 'invalid_reward_setup'; end if;
   if jsonb_array_length(r->'sharesBps') not between 1 and 100 then raise exception 'invalid_reward_setup'; end if;
   for v in select value from jsonb_array_elements(r->'sharesBps') loop
    if jsonb_typeof(v)<>'number' or v::text !~ '^[0-9]+$' then raise exception 'invalid_reward_setup'; end if;
    if v::text::numeric>10000 then raise exception 'invalid_reward_setup'; end if;
   end loop;
   s:=r->'source';
   if s<>'null'::jsonb then
    if jsonb_typeof(s)<>'object' or (select array_agg(key order by key) from jsonb_object_keys(s) key)<>array['catalogueHash','categoryId','draftId','roundId'] then raise exception 'invalid_reward_setup'; end if;
    for v in select value from jsonb_each(s) where key in('draftId','categoryId','roundId') loop
     if v='null'::jsonb and s->'roundId'=v then continue; end if;
     if jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or v#>>'{}'='00000000-0000-0000-0000-000000000000' then raise exception 'invalid_reward_setup'; end if;
    end loop;
    if s->'draftId'='null'::jsonb or s->'categoryId'='null'::jsonb or jsonb_typeof(s->'catalogueHash')<>'string' or s->>'catalogueHash' !~ '^[0-9a-f]{64}$' then raise exception 'invalid_reward_setup'; end if;
   end if;
  end if;
 end loop;
 return true;
end $$;

create table app_private.reward_distribution_setups (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
 owner_user_id uuid not null references public.user_profiles(user_id),
 chain_id integer not null check(chain_id in(31337,10143)),
 revision integer not null check(revision between 1 and 2147483645),
 configuration jsonb not null check(app_private.validate_reward_setup_configuration(configuration)),
 last_request_id uuid not null check(last_request_id<>'00000000-0000-0000-0000-000000000000'::uuid),
 last_expected_revision integer not null check(last_expected_revision>=0),
 updated_at timestamptz not null default clock_timestamp()
);
create index reward_distribution_setups_owner on app_private.reward_distribution_setups(owner_user_id,chain_id,updated_at desc,id);
alter table app_private.reward_distribution_setups enable row level security;
revoke all on app_private.reward_distribution_setups from public,anon,authenticated,service_role;
grant select,insert,update on app_private.reward_distribution_setups to service_role;
create policy reward_distribution_setups_service_read on app_private.reward_distribution_setups for select to service_role using(true);
create policy reward_distribution_setups_service_insert on app_private.reward_distribution_setups for insert to service_role with check(true);
create policy reward_distribution_setups_service_update on app_private.reward_distribution_setups for update to service_role using(true) with check(true);

create function app_private.reward_setup_document(d app_private.reward_distribution_setups)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',d.id,'chainId',d.chain_id,'revision',d.revision,'configuration',d.configuration,
 'updatedAt',to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;
create function public.service_reward_distribution_setups(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_programme_id uuid default null,p_request_id uuid default null,p_expected_revision integer default null,p_configuration jsonb default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_distribution_setups%rowtype; result jsonb;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(10143,31337) or p_programme_id='00000000-0000-0000-0000-000000000000'::uuid
  then raise exception 'invalid_reward_setup'; end if;
 if p_request_id is null then
  if p_expected_revision is not null or p_configuration is not null then raise exception 'invalid_reward_setup'; end if;
  if p_programme_id is null then
   select coalesce(jsonb_agg(app_private.reward_setup_document(t) order by updated_at desc,id),'[]'::jsonb) into result
    from (select * from app_private.reward_distribution_setups where owner_user_id=p_actor_user_id and chain_id=p_chain_id order by updated_at desc,id limit 100) t;
  else
   select * into d from app_private.reward_distribution_setups where id=p_programme_id and owner_user_id=p_actor_user_id and chain_id=p_chain_id;
   if not found then raise exception 'reward_setup_not_found'; end if;
   result:=app_private.reward_setup_document(d);
  end if;
 else
  if p_programme_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid or p_expected_revision is null or p_expected_revision not between 0 and 2147483644
   then raise exception 'invalid_reward_setup'; end if;
  perform app_private.validate_reward_setup_configuration(p_configuration);
  -- Serialize owner limits and same-ID creation; recheck live account/session after waits.
  perform pg_advisory_xact_lock(hashtextextended('reward-setup-owner:'||p_actor_user_id::text||':'||p_chain_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_programme_id::text,0));
  perform 1 from public.user_profiles where user_id=p_actor_user_id for share;
  select * into d from app_private.reward_distribution_setups where id=p_programme_id for update;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if d.id is not null then
   if d.owner_user_id<>p_actor_user_id or d.chain_id<>p_chain_id then raise exception 'reward_setup_not_found'; end if;
   if d.last_request_id=p_request_id then
    if d.last_expected_revision<>p_expected_revision or d.configuration<>p_configuration then raise exception 'reward_setup_conflict'; end if;
    return app_private.reward_setup_document(d);
   end if;
   if d.revision<>p_expected_revision then raise exception 'reward_setup_conflict'; end if;
   update app_private.reward_distribution_setups set configuration=p_configuration,revision=revision+1,last_request_id=p_request_id,
    last_expected_revision=p_expected_revision,updated_at=clock_timestamp() where id=d.id returning * into d;
  else
   if p_expected_revision<>0 then raise exception 'reward_setup_not_found'; end if;
   if (select count(*) from app_private.reward_distribution_setups where owner_user_id=p_actor_user_id and chain_id=p_chain_id)>=100 then raise exception 'reward_setup_limit'; end if;
   insert into app_private.reward_distribution_setups(id,owner_user_id,chain_id,revision,configuration,last_request_id,last_expected_revision)
    values(p_programme_id,p_actor_user_id,p_chain_id,1,p_configuration,p_request_id,0) returning * into d;
  end if;
  result:=app_private.reward_setup_document(d);
 end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 return result;
end $$;
revoke all on function app_private.validate_reward_setup_configuration(jsonb),app_private.reward_setup_document(app_private.reward_distribution_setups),
 public.service_reward_distribution_setups(uuid,uuid,integer,uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.validate_reward_setup_configuration(jsonb),app_private.reward_setup_document(app_private.reward_distribution_setups),
 public.service_reward_distribution_setups(uuid,uuid,integer,uuid,uuid,integer,jsonb) to service_role;
commit;
