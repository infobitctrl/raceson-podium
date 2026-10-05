-- Isolated rewards demo only. Preserve historical policies and immutable execution plans.
begin;
create or replace function app_private.validate_reward_setup_configuration_v3(c jsonb)
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
  (p->'fewerFinishers' is distinct from '"raceson_main_treasury"'::jsonb and p->'fewerFinishers' is distinct from '"selected_return"'::jsonb) or p->'multipleAwards' is distinct from '"allow"'::jsonb or
  p->'securityPausesExtendWindow' is distinct from 'true'::jsonb or p->'ties' is distinct from '"split_occupied_places"'::jsonb or
  jsonb_typeof(p->'treasuryReturn') is distinct from 'string' or p->>'treasuryReturn' not in('original_sender','raceson_default') or
  jsonb_typeof(p->'claimWindowDays') is distinct from 'number' or p->>'claimWindowDays' !~ '^[0-9]+$' then raise exception 'invalid_reward_setup';end if;
 if (p->>'claimWindowDays')::numeric not between 1 and 3650 then raise exception 'invalid_reward_setup';end if;
 return app_private.validate_reward_setup_configuration_v2((c-'policy')||'{"version":2}'::jsonb);
end $$;

commit;
