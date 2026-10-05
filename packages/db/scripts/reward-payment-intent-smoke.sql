begin;
do $$ declare fn regprocedure; name text; begin
  foreach fn in array array[
    'app_private.require_reward_nonce_role_separation()'::regprocedure,
    'app_private.record_reward_relayer_nonce_slot()'::regprocedure,
    'app_private.reward_athlete_payment_document(app_private.reward_athlete_payment_intents)'::regprocedure,
    'app_private.lock_reward_athlete_payment_context(uuid,uuid,uuid)'::regprocedure,
    'app_private.require_reward_athlete_payment_ready(jsonb,jsonb,timestamptz)'::regprocedure,
    'public.service_read_reward_athlete_payment_context(uuid,uuid,uuid)'::regprocedure,
    'public.service_reserve_reward_athlete_payment(uuid,uuid,uuid,text,text,integer,text,jsonb,timestamptz)'::regprocedure,
    'public.service_record_reward_athlete_payment_attempt(uuid,uuid,uuid,uuid,text,jsonb,jsonb,timestamptz)'::regprocedure,
    'public.service_read_reward_athlete_payment_attempt(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure
  ] loop
    if exists(select 1 from pg_proc where oid=fn and prosecdef) or has_function_privilege('anon',fn,'execute')
      or has_function_privilege('authenticated',fn,'execute') or not has_function_privilege('service_role',fn,'execute') then
      raise exception 'Incorrect reward payment grants: %',fn; end if;
  end loop;
  foreach name in array array['reward_athlete_payment_intents','reward_relayer_nonce_slots','reward_athlete_payment_attempts'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and c.relname=name and c.relrowsecurity)
      or has_table_privilege('anon','app_private.'||name,'select,insert,update,delete')
      or has_table_privilege('authenticated','app_private.'||name,'select,insert,update,delete')
      or has_table_privilege('service_role','app_private.'||name,'update,delete')
      or not has_table_privilege('service_role','app_private.'||name,'select')
      or not has_table_privilege('service_role','app_private.'||name,'insert') then raise exception 'Incorrect reward payment table grants: %',name; end if;
  end loop;
end $$;
set local role anon;
do $$ begin
  begin perform public.service_read_reward_athlete_payment_context(null,null,null);raise exception 'Anonymous payment read';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform public.service_reserve_reward_athlete_payment(null,null,null,null,null,null,null,null,null);raise exception 'Browser payment reserve';exception when insufficient_privilege then null;end;
  begin perform public.service_record_reward_athlete_payment_attempt(null,null,null,null,null,null,null,null);raise exception 'Browser payment write';exception when insufficient_privilege then null;end;
  begin perform public.service_read_reward_athlete_payment_attempt(null,null,null,null,null,null);raise exception 'Browser payment capability read';exception when insufficient_privilege then null;end;
end $$;
rollback;
