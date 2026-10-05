-- Versioned private setup workflow. Ready means configuration complete, never published or payable.
begin;
create function app_private.validate_reward_setup_configuration_v1(c jsonb)
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


revoke all on function app_private.validate_reward_setup_configuration_v1(jsonb) from public,anon,authenticated;
grant execute on function app_private.validate_reward_setup_configuration_v1(jsonb) to service_role;
create or replace function app_private.validate_reward_setup_configuration(c jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare ctx jsonb; item record; n jsonb; src jsonb; shares numeric; v jsonb;
begin
 if c->'version'='1'::jsonb then return app_private.validate_reward_setup_configuration_v1(c); end if;
 if c is null or jsonb_typeof(c)<>'object' or pg_column_size(c)>262144 or c->'version'<>'2'::jsonb or
  (select array_agg(key order by key) from jsonb_object_keys(c) key)<>array['budgetMon','context','name','root','stage','version'] or
  jsonb_typeof(c->'stage')<>'string' or c->>'stage' not in ('draft','ready') then raise exception 'invalid_reward_setup';end if;
 perform app_private.validate_reward_setup_configuration_v1((c-'context'-'stage')||'{"version":1}'::jsonb);
 ctx:=c->'context';
 if ctx<>'null'::jsonb then
  if jsonb_typeof(ctx)<>'object' or (select array_agg(key order by key) from jsonb_object_keys(ctx) key)<>array['catalogueHash','draftId','editionId','eventName','programmeName','roundId'] then raise exception 'invalid_reward_setup';end if;
  for v in select value from jsonb_each(ctx) where key in ('draftId','roundId','editionId') loop
   if v='null'::jsonb then continue;end if;
   if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or v#>>'{}'='00000000-0000-0000-0000-000000000000' then raise exception 'invalid_reward_setup';end if;
  end loop;
  if ctx->'draftId'='null'::jsonb or (ctx->'roundId'='null'::jsonb)<>(ctx->'editionId'='null'::jsonb) or jsonb_typeof(ctx->'catalogueHash')<>'string' or ctx->>'catalogueHash' !~ '^[0-9a-f]{64}$' then raise exception 'invalid_reward_setup';end if;
  for v in select value from jsonb_each(ctx) where key in ('eventName','programmeName') loop
   if jsonb_typeof(v)<>'string' or length(v#>>'{}')>100 or length(btrim(v#>>'{}'))<1 or v#>>'{}' ~ '[[:cntrl:]]' then raise exception 'invalid_reward_setup';end if;
  end loop;
 end if;
 if c->>'stage'='ready' then
  if ctx='null'::jsonb then raise exception 'invalid_reward_setup';end if;
  for item in with recursive tree(node) as (select c->'root' union all select child from tree cross join lateral jsonb_array_elements(node->'children') child) select * from tree loop
   n:=item.node;
   if n->'rule'='null'::jsonb then
    select sum((value->>'shareBps')::numeric) into shares from jsonb_array_elements(n->'children');
   else
    select sum(value::text::numeric) into shares from jsonb_array_elements(n->'rule'->'sharesBps');
    src:=n->'rule'->'source';
    if src='null'::jsonb or src->'draftId'<>ctx->'draftId' or src->'catalogueHash'<>ctx->'catalogueHash' or (ctx->'roundId'<>'null'::jsonb and src->'roundId'<>ctx->'roundId') then raise exception 'invalid_reward_setup';end if;
   end if;
   if shares is distinct from 10000::numeric then raise exception 'invalid_reward_setup';end if;
  end loop;
 end if;
 return true;
end $$;
comment on function app_private.validate_reward_setup_configuration(jsonb) is 'Private versioned configuration only; ready state has no approval, publication or payout authority.';
commit;
