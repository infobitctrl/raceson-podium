-- New setups retain explicit, versioned reward and treasury-return policy.
-- This stores planning choices only; it never edits a deployed treasury or moves funds.
begin;
create function app_private.validate_reward_setup_configuration_v2(c jsonb)
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

revoke all on function app_private.validate_reward_setup_configuration_v2(jsonb) from public,anon,authenticated;
grant execute on function app_private.validate_reward_setup_configuration_v2(jsonb) to service_role;
create or replace function app_private.validate_reward_setup_configuration(c jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare p jsonb;
begin
 if c->'version' in ('1'::jsonb,'2'::jsonb) then return app_private.validate_reward_setup_configuration_v2(c);end if;
 if c is null or jsonb_typeof(c) is distinct from 'object' or pg_column_size(c)>262144 or c->'version' is distinct from '3'::jsonb then raise exception 'invalid_reward_setup';end if;
 if (select array_agg(key order by key) from jsonb_object_keys(c) key) is distinct from array['budgetMon','context','name','policy','root','stage','version'] then raise exception 'invalid_reward_setup';end if;
 p:=c->'policy';
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'invalid_reward_setup';end if;
 if (select array_agg(key order by key) from jsonb_object_keys(p) key) is distinct from array['claimStartsAt','claimWindowDays','expiredClaims','fewerFinishers','multipleAwards','securityPausesExtendWindow','ties','treasuryReturn'] then raise exception 'invalid_reward_setup';end if;
 if p->'claimStartsAt' is distinct from '"claims_open"'::jsonb or p->'expiredClaims' is distinct from '"fixed_treasury"'::jsonb or
  p->'fewerFinishers' is distinct from '"raceson_main_treasury"'::jsonb or p->'multipleAwards' is distinct from '"allow"'::jsonb or
  p->'securityPausesExtendWindow' is distinct from 'true'::jsonb or p->'ties' is distinct from '"split_occupied_places"'::jsonb or
  jsonb_typeof(p->'treasuryReturn') is distinct from 'string' or p->>'treasuryReturn' not in('original_sender','raceson_default') or
  jsonb_typeof(p->'claimWindowDays') is distinct from 'number' or p->>'claimWindowDays' !~ '^[0-9]+$' then raise exception 'invalid_reward_setup';end if;
 if (p->>'claimWindowDays')::numeric not between 1 and 3650 then raise exception 'invalid_reward_setup';end if;
 return app_private.validate_reward_setup_configuration_v2((c-'policy')||'{"version":2}'::jsonb);
end $$;
comment on function app_private.validate_reward_setup_configuration(jsonb) is 'Versioned planning only. Expiry and treasury choices require matching immutable funding configuration before execution.';
commit;
