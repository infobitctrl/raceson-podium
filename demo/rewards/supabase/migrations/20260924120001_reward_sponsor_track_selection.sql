-- Optional track identity extends draft metadata; no stored rows or launches are rewritten.
begin;
create or replace function app_private.validate_reward_setup_configuration(c jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare g jsonb; p jsonb; n jsonb; r jsonb; src jsonb; ctx jsonb; transformed jsonb;
 pot_index integer; leaf_index integer; item record; pitem record;
 pot_ids text[]:='{}'; slots integer[]:='{}'; round_ids text[]:='{}'; group_ids text[]:='{}'; targets text[]:='{}';
 target text; leaves integer:=0; participation boolean; total numeric;
begin
 -- Preserve the selected public identity even before its catalogue is published.
 -- This metadata never supplies source context, sporting approval or execution authority.
 if c ? 'sponsorSelection' then
  if c->'version' is distinct from '5'::jsonb or pg_column_size(c)>262144 or
   jsonb_typeof(c->'sponsorSelection') is distinct from 'object' then raise exception 'invalid_reward_setup';end if;
  if (select array_agg(key order by key) from jsonb_object_keys(c->'sponsorSelection') key)
    is distinct from (case when c->'sponsorSelection' ? 'raceId' then array['eventEditionId','raceId','sourceLeagueId','sourceSeasonId']
      else array['eventEditionId','sourceLeagueId','sourceSeasonId'] end) then raise exception 'invalid_reward_setup';end if;
  if c->'sponsorSelection' ? 'raceId' and c->'sponsorSelection'->'eventEditionId'='null'::jsonb then raise exception 'invalid_reward_setup';end if;
  for item in select key,value from jsonb_each(c->'sponsorSelection') loop
   if item.key='eventEditionId' and item.value='null'::jsonb then continue;end if;
   if jsonb_typeof(item.value) is distinct from 'string' or item.value#>>'{}' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
     or item.value#>>'{}'='00000000-0000-0000-0000-000000000000' then raise exception 'invalid_reward_setup';end if;
  end loop;
  return app_private.validate_reward_setup_configuration(c-'sponsorSelection');
 end if;
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
