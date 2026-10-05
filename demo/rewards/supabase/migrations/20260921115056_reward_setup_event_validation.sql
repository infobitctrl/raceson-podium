-- Match the API decoder for nullable programme metadata. Private planning only.
begin;
create or replace function app_private.validate_reward_setup_configuration(c jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare e jsonb; choice jsonb; n jsonb; item record; total numeric; seen text[]:='{}';
begin
 if c->'version' is distinct from '4'::jsonb then return app_private.validate_reward_setup_configuration_v3(c);end if;
 if jsonb_typeof(c) is distinct from 'object' or pg_column_size(c)>262144 or
 (select array_agg(key order by key) from jsonb_object_keys(c) key) is distinct from array['budgetMon','context','event','name','policy','programmeKind','root','stage','version'] or
 jsonb_typeof(c->'programmeKind') is distinct from 'string' or jsonb_typeof(c->'stage') is distinct from 'string' or c->>'programmeKind' not in ('event','league') or c->>'stage' not in ('draft','ready') then raise exception 'invalid_reward_setup';end if;
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
  jsonb_typeof(e->'name') is distinct from 'string' or length(btrim(e->>'name')) not between 1 and 100 or length(e->>'name')>100 or e->>'name' ~ '[[:cntrl:]]' or
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
commit;
