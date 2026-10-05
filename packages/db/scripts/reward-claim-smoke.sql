begin;
do $$ declare fn regprocedure; begin
  foreach fn in array array[
    'app_private.reward_athlete_claim_document(app_private.reward_athlete_claim_intents)'::regprocedure,
    'app_private.require_reward_athlete_claim_witness(jsonb,jsonb)'::regprocedure,
    'public.service_read_reward_athlete_claim_context(uuid,uuid,uuid,uuid,text)'::regprocedure,
    'public.service_prepare_reward_athlete_claim(uuid,uuid,uuid,uuid,text,jsonb,timestamptz)'::regprocedure
  ] loop
    if exists(select 1 from pg_proc where oid=fn and prosecdef) then raise exception 'Claim function must be invoker: %',fn; end if;
    if has_function_privilege('anon',fn,'execute') or has_function_privilege('authenticated',fn,'execute')
      or not has_function_privilege('service_role',fn,'execute') then raise exception 'Incorrect claim grants: %',fn; end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid='app_private.reward_athlete_claim_intents'::regclass)
    or has_table_privilege('anon','app_private.reward_athlete_claim_intents','select,insert,update,delete')
    or has_table_privilege('authenticated','app_private.reward_athlete_claim_intents','select,insert,update,delete')
    or has_table_privilege('service_role','app_private.reward_athlete_claim_intents','update,delete')
    or not has_table_privilege('service_role','app_private.reward_athlete_claim_intents','select,insert') then
    raise exception 'Incorrect claim table grants/RLS'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform public.service_read_reward_athlete_claim_context(null,null,null,null,null);raise exception 'Anonymous claim read';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform public.service_prepare_reward_athlete_claim(null,null,null,null,null,null,null);raise exception 'Browser claim write';exception when insufficient_privilege then null;end;
end $$;
rollback;
