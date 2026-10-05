-- Isolated reward demo. Semantic guided configuration; no sporting approval or payout authority.
begin;
create function app_private.validate_reward_setup_configuration_v4(c jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare e jsonb; choice jsonb; n jsonb; item record; total numeric; seen text[]:='{}';
begin
 if c->'version' is distinct from '4'::jsonb then return app_private.validate_reward_setup_configuration_v3(c);end if;
 if jsonb_typeof(c) is distinct from 'object' or pg_column_size(c)>262144 or
 (select array_agg(key order by key) from jsonb_object_keys(c) key) is distinct from array['budgetMon','context','event','name','policy','programmeKind','root','stage','version'] or
 c->>'programmeKind' not in ('event','league') or c->>'stage' not in ('draft','ready') then raise exception 'invalid_reward_setup';end if;
 perform app_private.validate_reward_setup_configuration_v3((c-'event'-'programmeKind')||jsonb_build_object('version',3,'stage',case when c->>'programmeKind'='event' then 'draft' else c->>'stage' end));
 e:=c->'event';
 if c->>'programmeKind'='league' then
  if e is distinct from 'null'::jsonb then raise exception 'invalid_reward_setup';end if;
  return true;
 end if;
 if c->'context' is distinct from 'null'::jsonb then raise exception 'invalid_reward_setup';end if;
 if e<>'null'::jsonb then
  if jsonb_typeof(e) is distinct from 'object' or (select array_agg(key order by key) from jsonb_object_keys(e) key) is distinct from array['catalogueHash','choices','date','editionId','name'] then raise exception 'invalid_reward_setup';end if;
  if jsonb_typeof(e->'editionId') is distinct from 'string' or e->>'editionId' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or e->>'editionId'='00000000-0000-0000-0000-000000000000' or
  jsonb_typeof(e->'name') is distinct from 'string' or length(btrim(e->>'name')) not between 1 and 100 or e->>'name' ~ '[[:cntrl:]]' or
  jsonb_typeof(e->'date') is distinct from 'string' or e->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
  jsonb_typeof(e->'catalogueHash') is distinct from 'string' or e->>'catalogueHash' !~ '^[0-9a-f]{64}$' or
  jsonb_typeof(e->'choices') is distinct from 'array' then raise exception 'invalid_reward_setup';end if;
  perform (e->>'date')::date;
  if jsonb_array_length(e->'choices')>1000 then raise exception 'invalid_reward_setup';end if;
  for choice in select value from jsonb_array_elements(e->'choices') loop
   if jsonb_typeof(choice) is distinct from 'object' or (select array_agg(key order by key) from jsonb_object_keys(choice) key) is distinct from array['approved','groupKey','nodeId','raceId'] then raise exception 'invalid_reward_setup';end if;
   if jsonb_typeof(choice->'nodeId') is distinct from 'string' or jsonb_typeof(choice->'raceId') is distinct from 'string' or
   choice->>'nodeId' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or choice->>'raceId' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or
   choice->>'nodeId'='00000000-0000-0000-0000-000000000000' or choice->>'raceId'='00000000-0000-0000-0000-000000000000' or choice->>'nodeId'=any(seen) or
   jsonb_typeof(choice->'approved') is distinct from 'boolean' or jsonb_typeof(choice->'groupKey') is distinct from 'string' or choice->>'groupKey' !~ '^[a-zA-Z0-9_.:-]{1,100}$' then raise exception 'invalid_reward_setup';end if;
   seen:=array_append(seen,choice->>'nodeId');
  end loop;
 end if;
 if c->>'stage'='ready' then
  if e='null'::jsonb then raise exception 'invalid_reward_setup';end if;
  for item in with recursive tree(node) as (select c->'root' union all select child from tree cross join lateral jsonb_array_elements(node->'children') child) select * from tree loop
   n:=item.node;
   if n->'rule'='null'::jsonb then select sum((value->>'shareBps')::numeric) into total from jsonb_array_elements(n->'children');
   else
    select sum(value::text::numeric) into total from jsonb_array_elements(n->'rule'->'sharesBps');
    if n->'rule'->>'basis' not in ('race_position','club_points') or not exists(select 1 from jsonb_array_elements(e->'choices') ch where ch->'nodeId'=n->'id' and ch->'approved'='true'::jsonb and n->'rule'->>'basis'=case when ch->>'groupKey'='club' then 'club_points' else 'race_position' end) then raise exception 'invalid_reward_setup';end if;
   end if;
   if total is distinct from 10000::numeric then raise exception 'invalid_reward_setup';end if;
  end loop;
 end if;
 return true;
end $$;
revoke all on function app_private.validate_reward_setup_configuration_v4(jsonb) from public,anon,authenticated;
grant execute on function app_private.validate_reward_setup_configuration_v4(jsonb) to service_role;

create or replace function app_private.validate_reward_setup_configuration(c jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare g jsonb; p jsonb; n jsonb; r jsonb; src jsonb; ctx jsonb; transformed jsonb;
 pot_index integer; leaf_index integer; item record; pitem record;
 pot_ids text[]:='{}'; slots integer[]:='{}'; round_ids text[]:='{}'; group_ids text[]:='{}'; targets text[]:='{}';
 target text; leaves integer:=0; participation boolean; total numeric;
begin
 if c->'version' is distinct from '5'::jsonb then return app_private.validate_reward_setup_configuration_v4(c);end if;
 if jsonb_typeof(c) is distinct from 'object' or pg_column_size(c)>262144 or
  (select array_agg(key order by key) from jsonb_object_keys(c) key) is distinct from array['budgetMon','context','event','guided','name','policy','programmeKind','root','stage','version'] or
  c->'programmeKind' is distinct from '"league"'::jsonb or c->'event' is distinct from 'null'::jsonb or c->>'stage' not in ('draft','ready') or jsonb_typeof(c->'stage') is distinct from 'string'
  then raise exception 'invalid_reward_setup';end if;
 g:=c->'guided'; ctx:=c->'context';
 if jsonb_typeof(g) is distinct from 'object' or
  (select array_agg(key order by key) from jsonb_object_keys(g) key) is distinct from array['clubAttribution','counting','groups','pots','version'] or
  g->'version' is distinct from '1'::jsonb or g->'counting' is distinct from '"one_finish_per_round"'::jsonb or
  g->'clubAttribution' is distinct from '"represented_at_finish"'::jsonb or jsonb_typeof(g->'pots') is distinct from 'array' or jsonb_typeof(g->'groups') is distinct from 'array'
  then raise exception 'invalid_reward_setup';end if;
 if jsonb_array_length(g->'pots')<>6 or jsonb_array_length(g->'groups')>300 or
  jsonb_typeof(c->'root'->'children') is distinct from 'array' then raise exception 'invalid_reward_setup';end if;
 if jsonb_array_length(c->'root'->'children')<>6 or (ctx<>'null'::jsonb and ctx->'roundId' is distinct from 'null'::jsonb) then raise exception 'invalid_reward_setup';end if;

 -- Reuse all existing bounded tree, name, policy and source-shape validation.
 -- The transient compatibility document is never stored or executed.
 transformed:=(c-'guided')||'{"version":4,"stage":"draft"}'::jsonb;
 for pitem in select value,ordinality from jsonb_array_elements(c->'root'->'children') with ordinality loop
  p:=pitem.value;pot_index:=pitem.ordinality-1;
  if p->'rule' is distinct from 'null'::jsonb or jsonb_typeof(p->'children') is distinct from 'array' then raise exception 'invalid_reward_setup';end if;
  for item in select value,ordinality from jsonb_array_elements(p->'children') with ordinality loop
   n:=item.value;leaf_index:=item.ordinality-1;leaves:=leaves+1;
   if n->'children' is distinct from '[]'::jsonb or jsonb_typeof(n->'rule') is distinct from 'object' then raise exception 'invalid_reward_setup';end if;
   if n->'rule'->'basis'='"participation"'::jsonb and n->'rule'->'sharesBps'='[]'::jsonb then
    transformed:=jsonb_set(transformed,array['root','children',pot_index::text,'children',leaf_index::text,'rule','sharesBps'],'[10000]'::jsonb);
   end if;
  end loop;
 end loop;
 perform app_private.validate_reward_setup_configuration_v4(transformed);
 for p in select value from jsonb_array_elements(g->'pots') loop
  if jsonb_typeof(p) is distinct from 'object' or (select array_agg(key order by key) from jsonb_object_keys(p) key) is distinct from array['nodeId','roundId','slot'] or
   jsonb_typeof(p->'nodeId') is distinct from 'string' or p->>'nodeId'=any(pot_ids) or
   not exists(select 1 from jsonb_array_elements(c->'root'->'children') pot_node where pot_node->'id'=p->'nodeId') or
   jsonb_typeof(p->'slot') is distinct from 'number' or p->>'slot' !~ '^[0-5]$' then raise exception 'invalid_reward_setup';end if;
  if (p->>'slot')::integer=any(slots) then raise exception 'invalid_reward_setup';end if;
  if p->'slot'='0'::jsonb then
   if p->'roundId' is distinct from 'null'::jsonb then raise exception 'invalid_reward_setup';end if;
  elsif p->'roundId'<>'null'::jsonb then
   if jsonb_typeof(p->'roundId') is distinct from 'string' or p->>'roundId' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or
    p->>'roundId'='00000000-0000-0000-0000-000000000000' or p->>'roundId'=any(round_ids) then raise exception 'invalid_reward_setup';end if;
   round_ids:=array_append(round_ids,p->>'roundId');
  end if;
  pot_ids:=array_append(pot_ids,p->>'nodeId');slots:=array_append(slots,(p->>'slot')::integer);
 end loop;
 for r in select value from jsonb_array_elements(g->'groups') loop
  if jsonb_typeof(r) is distinct from 'object' or (select array_agg(key order by key) from jsonb_object_keys(r) key) is distinct from array['eligibilityApproved','method','minimumFinishes','nodeId','type'] or
   jsonb_typeof(r->'nodeId') is distinct from 'string' or r->>'nodeId'=any(group_ids) or
   jsonb_typeof(r->'type') is distinct from 'string' or r->>'type' not in ('athlete_standings','club_standings','athlete_finishes','athlete_metres','club_metres') or
   jsonb_typeof(r->'method') is distinct from 'string' or r->>'method' not in ('ranked','proportional') or
   jsonb_typeof(r->'minimumFinishes') is distinct from 'number' or r->>'minimumFinishes' !~ '^[1-5]$' or jsonb_typeof(r->'eligibilityApproved') is distinct from 'boolean'
   then raise exception 'invalid_reward_setup';end if;
  select child,pot into n,p from jsonb_array_elements(c->'root'->'children') parent
   cross join lateral jsonb_array_elements(parent->'children') child
   join jsonb_array_elements(g->'pots') pot on pot->'nodeId'=parent->'id' where child->'id'=r->'nodeId';
  if n is null then raise exception 'invalid_reward_setup';end if;
  participation:=r->>'type' in ('athlete_finishes','athlete_metres','club_metres');src:=n->'rule'->'source';
  if participation then
   if p->'slot'<>'0'::jsonb or n->'rule'->'basis'<>'"participation"'::jsonb or src<>'null'::jsonb then raise exception 'invalid_reward_setup';end if;
  elsif r->'method'<>'"ranked"'::jsonb or r->'minimumFinishes'<>'1'::jsonb or n->'rule'->>'basis'<>(case when r->>'type'='club_standings' then 'club_points' when p->'slot'='0'::jsonb then 'league_position' else 'race_position' end)
   then raise exception 'invalid_reward_setup';end if;
  if (r->>'method'='proportional' and n->'rule'->'sharesBps'<>'[]'::jsonb) or (r->>'method'='ranked' and jsonb_array_length(n->'rule'->'sharesBps')<1) then raise exception 'invalid_reward_setup';end if;
  if src<>'null'::jsonb and (ctx='null'::jsonb or src->'draftId' is distinct from ctx->'draftId' or src->'catalogueHash' is distinct from ctx->'catalogueHash' or src->'roundId' is distinct from p->'roundId') then raise exception 'invalid_reward_setup';end if;
  target:=(p->>'nodeId')||':'||(r->>'type')||':'||coalesce(src->>'categoryId','unbound');
  if participation or src<>'null'::jsonb then
   if target=any(targets) then raise exception 'invalid_reward_setup';end if;targets:=array_append(targets,target);
  end if;
  group_ids:=array_append(group_ids,r->>'nodeId');
 end loop;
 if cardinality(group_ids)<>leaves then raise exception 'invalid_reward_setup';end if;
 if c->>'stage'='ready' then
  if ctx='null'::jsonb or cardinality(round_ids)<>5 or leaves=0 then raise exception 'invalid_reward_setup';end if;
  for item in with recursive tree(node) as (select c->'root' union all select child from tree cross join lateral jsonb_array_elements(node->'children') child) select * from tree loop
   n:=item.node;
   if n->'rule'='null'::jsonb then select sum((value->>'shareBps')::numeric) into total from jsonb_array_elements(n->'children');
   else
    select value into r from jsonb_array_elements(g->'groups') where value->'nodeId'=n->'id';
    if r->'eligibilityApproved'<>'true'::jsonb or (r->>'type' in ('athlete_standings','club_standings') and n->'rule'->'source'='null'::jsonb) then raise exception 'invalid_reward_setup';end if;
    if r->>'method'='proportional' then total:=10000;else select sum(value::text::numeric) into total from jsonb_array_elements(n->'rule'->'sharesBps');end if;
   end if;
   if total is distinct from 10000::numeric then raise exception 'invalid_reward_setup';end if;
  end loop;
 end if;
 return true;
end $$;
commit;
