begin;
do $$ declare fn regprocedure;name text;field text;begin
  foreach fn in array array[
    'app_private.protect_reward_athlete_payment_job()'::regprocedure,
    'app_private.reward_athlete_payment_job_document(app_private.reward_athlete_payment_jobs)'::regprocedure,
    'app_private.reward_payment_activation(uuid)'::regprocedure,
    'app_private.lock_reward_athlete_payment_job(uuid,uuid,uuid)'::regprocedure,
    'app_private.require_reward_payment_execution(app_private.reward_athlete_payment_jobs,jsonb,jsonb,timestamptz)'::regprocedure,
    'public.service_read_reward_athlete_payment_job(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.service_queue_reward_athlete_payment_job(uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz)'::regprocedure,
    'public.service_step_reward_athlete_payment_job(uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz)'::regprocedure,
    'public.service_confirm_reward_athlete_payment_job(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    if exists(select 1 from pg_proc where oid=fn and (prosecdef or not 'search_path=""'=any(proconfig)))
      or has_function_privilege('anon',fn,'execute') or has_function_privilege('authenticated',fn,'execute')
      or not has_function_privilege('service_role',fn,'execute') then raise exception 'Incorrect payment job function boundary: %',fn;end if;
  end loop;
  foreach name in array array['reward_athlete_payment_jobs','reward_athlete_payment_job_events','reward_athlete_payment_confirmations'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and c.relname=name and c.relrowsecurity)
      or has_table_privilege('anon','app_private.'||name,'select,insert,update,delete')
      or has_table_privilege('authenticated','app_private.'||name,'select,insert,update,delete')
      or has_table_privilege('service_role','app_private.'||name,'update,delete')
      or not has_table_privilege('service_role','app_private.'||name,'select')
      or not has_table_privilege('service_role','app_private.'||name,'insert') then raise exception 'Incorrect payment job table boundary: %',name;end if;
  end loop;
  for field in select column_name from information_schema.columns where table_schema='app_private' and table_name='reward_athlete_payment_jobs' loop
    if has_column_privilege('service_role','app_private.reward_athlete_payment_jobs',field,'update') is distinct from
      (field in ('state','may_have_broadcast','lease_owner','lease_token','lease_expires_at','lease_generation','confirmation_observation_id')) then
      raise exception 'Incorrect payment job column privilege: %',field;end if;
  end loop;
end $$;
set local role anon;
do $$ begin
  begin perform public.service_read_reward_athlete_payment_job(null,null,null,null);raise exception 'Anonymous job read';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform public.service_queue_reward_athlete_payment_job(null,null,null,null,null,null,null,null);raise exception 'Browser job queue';exception when insufficient_privilege then null;end;
  begin perform public.service_step_reward_athlete_payment_job(null,null,null,null,null,null,null,null);raise exception 'Browser job step';exception when insufficient_privilege then null;end;
  begin perform public.service_confirm_reward_athlete_payment_job(null,null,null,null,null,null,null,null);raise exception 'Browser payment confirmation';exception when insufficient_privilege then null;end;
end $$;
rollback;
