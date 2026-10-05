begin;
do $$ declare fn regprocedure; name text; begin
  foreach fn in array array[
    'public.service_read_reward_deployment_context(uuid,uuid,uuid)'::regprocedure,
    'public.service_reserve_reward_deployment(uuid,uuid,text,integer,text)'::regprocedure,
    'public.service_record_reward_deployment_attempt(uuid,uuid,uuid,text,jsonb)'::regprocedure,
    'public.service_read_reward_deployment_attempt(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.service_read_reward_campaign_checkpoint(uuid,uuid,text)'::regprocedure,
    'public.service_record_reward_campaign_checkpoint(uuid,uuid,uuid,uuid,text,jsonb,jsonb)'::regprocedure,
    'app_private.require_reward_campaign_accounting(jsonb,integer)'::regprocedure,
    'public.service_queue_reward_deployment_job(uuid,uuid,uuid,uuid,text)'::regprocedure,
    'public.service_read_reward_deployment_job(uuid,uuid)'::regprocedure,
    'public.service_step_reward_deployment_job(uuid,uuid,uuid,uuid,text)'::regprocedure,
    'app_private.reward_deployment_job_document(app_private.reward_deployment_jobs)'::regprocedure,
    'app_private.protect_reward_deployment_job()'::regprocedure,
    'app_private.record_reward_operator_nonce_slot()'::regprocedure,
    'public.service_read_reward_funding_context(uuid,uuid,uuid)'::regprocedure,
    'public.service_reserve_reward_funding(uuid,uuid,text,uuid,integer,text)'::regprocedure,
    'public.service_record_reward_funding_attempt(uuid,uuid,uuid,text,jsonb)'::regprocedure,
    'public.service_read_reward_funding_attempt(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.service_queue_reward_funding_job(uuid,uuid,uuid,uuid,text)'::regprocedure,
    'public.service_read_reward_funding_job(uuid,uuid)'::regprocedure,
    'public.service_step_reward_funding_job(uuid,uuid,uuid,uuid,text)'::regprocedure,
    'public.service_confirm_reward_funding_job(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure,
    'app_private.protect_reward_funding_job()'::regprocedure,
    'app_private.reward_funding_job_document(app_private.reward_funding_jobs)'::regprocedure,
    'app_private.reward_operator_job_busy(integer,text,text,uuid)'::regprocedure,
    'public.service_read_reward_lifecycle_context(uuid,uuid,uuid,uuid,text)'::regprocedure,
    'public.service_reserve_reward_lifecycle(uuid,uuid,uuid,text,text,uuid,integer,text)'::regprocedure,
    'public.service_record_reward_lifecycle_attempt(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure,
    'public.service_read_reward_lifecycle_attempt(uuid,uuid,uuid,uuid,uuid)'::regprocedure,
    'app_private.protect_reward_lifecycle_job()'::regprocedure,
    'app_private.reward_lifecycle_job_document(app_private.reward_lifecycle_jobs)'::regprocedure,
    'app_private.reward_lifecycle_predecessor(uuid)'::regprocedure,
    'public.service_queue_reward_lifecycle_job(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure,
    'public.service_read_reward_lifecycle_job(uuid,uuid)'::regprocedure,
    'public.service_step_reward_lifecycle_job(uuid,uuid,uuid,uuid,text)'::regprocedure,
    'public.service_confirm_reward_lifecycle_job(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    if exists(select 1 from pg_proc where oid=fn and (prosecdef or not coalesce('search_path=""'=any(proconfig),false)))
      or not has_function_privilege('service_role',fn,'execute') or has_function_privilege('anon',fn,'execute')
      or has_function_privilege('authenticated',fn,'execute') then raise exception 'deployment RPC privacy regression'; end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid='app_private.reward_deployment_jobs'::regclass)
    or not (select relrowsecurity from pg_class where oid='app_private.reward_deployment_job_events'::regclass)
    or has_table_privilege('anon','app_private.reward_deployment_jobs','select,insert,update,delete')
    or has_table_privilege('authenticated','app_private.reward_deployment_jobs','select,insert,update,delete')
    or has_table_privilege('anon','app_private.reward_deployment_job_events','select,insert,update,delete')
    or has_table_privilege('authenticated','app_private.reward_deployment_job_events','select,insert,update,delete')
    or has_table_privilege('service_role','app_private.reward_deployment_jobs','delete')
    or has_column_privilege('service_role','app_private.reward_deployment_jobs','attempt_id','update')
    or has_column_privilege('service_role','app_private.reward_deployment_jobs','transaction_hash','update')
    or not has_column_privilege('service_role','app_private.reward_deployment_jobs','lease_token','update')
    or has_table_privilege('service_role','app_private.reward_deployment_job_events','update,delete') then
    raise exception 'deployment job grants regression'; end if;
  foreach name in array array['reward_deployment_intents','reward_deployment_attempts','reward_verified_deployments','reward_campaign_observations',
    'reward_operator_nonce_slots','reward_funding_intents','reward_funding_attempts','reward_funding_confirmations','reward_funding_job_events',
    'reward_campaign_upload_bindings','reward_lifecycle_intents','reward_lifecycle_attempts','reward_lifecycle_job_events','reward_lifecycle_confirmations'] loop
    if not (select relrowsecurity from pg_class where oid=('app_private.'||name)::regclass)
      or has_table_privilege('anon','app_private.'||name,'select,insert,update,delete')
      or has_table_privilege('authenticated','app_private.'||name,'select,insert,update,delete')
      or has_table_privilege('service_role','app_private.'||name,'update,delete')
      or not has_table_privilege('service_role','app_private.'||name,'select')
      or not has_table_privilege('service_role','app_private.'||name,'insert') then raise exception 'deployment table privacy regression'; end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid='app_private.reward_funding_jobs'::regclass)
    or has_table_privilege('anon','app_private.reward_funding_jobs','select,insert,update,delete')
    or has_table_privilege('authenticated','app_private.reward_funding_jobs','select,insert,update,delete')
    or has_table_privilege('service_role','app_private.reward_funding_jobs','delete')
    or has_column_privilege('service_role','app_private.reward_funding_jobs','attempt_id','update')
    or has_column_privilege('service_role','app_private.reward_funding_jobs','transaction_hash','update')
    or not has_column_privilege('service_role','app_private.reward_funding_jobs','lease_token','update') then
    raise exception 'funding job grants regression'; end if;
  if not (select relrowsecurity from pg_class where oid='app_private.reward_lifecycle_jobs'::regclass)
    or has_table_privilege('anon','app_private.reward_lifecycle_jobs','select,insert,update,delete')
    or has_table_privilege('authenticated','app_private.reward_lifecycle_jobs','select,insert,update,delete')
    or has_table_privilege('service_role','app_private.reward_lifecycle_jobs','delete')
    or has_column_privilege('service_role','app_private.reward_lifecycle_jobs','attempt_id','update')
    or has_column_privilege('service_role','app_private.reward_lifecycle_jobs','upload_id','update')
    or has_column_privilege('service_role','app_private.reward_lifecycle_jobs','predecessor_lifecycle_job_id','update')
    or has_column_privilege('service_role','app_private.reward_lifecycle_jobs','transaction_hash','update')
    or not has_column_privilege('service_role','app_private.reward_lifecycle_jobs','lease_token','update') then
    raise exception 'lifecycle job grants regression'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform public.service_queue_reward_lifecycle_job(null,null,null,null,null,'synthetic'); raise exception 'anonymous lifecycle queue allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_lifecycle_job(null,null); raise exception 'anonymous lifecycle job allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_step_reward_lifecycle_job(null,null,null,null,'lease'); raise exception 'anonymous lifecycle step allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_confirm_reward_lifecycle_job(null,null,null,null,'{}','{}','{}'); raise exception 'anonymous lifecycle confirmation allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_lifecycle_context(null,null,null,null,null); raise exception 'anonymous lifecycle context allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_reserve_reward_lifecycle(null,null,null,'activate','synthetic',null,31337,'0'); raise exception 'anonymous lifecycle reserve allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_record_reward_lifecycle_attempt(null,null,null,null,'synthetic','{}'); raise exception 'anonymous lifecycle attempt allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_lifecycle_attempt(null,null,null,null,null); raise exception 'anonymous lifecycle bytes allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_queue_reward_funding_job(null,null,null,null,'synthetic'); raise exception 'anonymous funding queue allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_funding_job(null,null); raise exception 'anonymous funding job allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_step_reward_funding_job(null,null,null,null,'lease'); raise exception 'anonymous funding lease allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_confirm_reward_funding_job(null,null,null,null,'{}','{}','{}'); raise exception 'anonymous funding confirmation allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_deployment_context(null,null,null); raise exception 'anonymous read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_reserve_reward_deployment(null,null,'synthetic',31337,'0'); raise exception 'anonymous reserve allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_record_reward_deployment_attempt(null,null,null,'synthetic','{}'); raise exception 'anonymous attempt allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_deployment_attempt(null,null,null,null); raise exception 'anonymous signed bytes allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_campaign_checkpoint(null,null,null); raise exception 'anonymous checkpoint read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_record_reward_campaign_checkpoint(null,null,null,null,'synthetic','{}','{}'); raise exception 'anonymous checkpoint write allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_queue_reward_deployment_job(null,null,null,null,'synthetic'); raise exception 'anonymous queue allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_deployment_job(null,null); raise exception 'anonymous job read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_step_reward_deployment_job(null,null,null,null,'lease'); raise exception 'anonymous job lease allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_funding_context(null,null,null); raise exception 'anonymous funding read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_reserve_reward_funding(null,null,'synthetic',null,31337,'0'); raise exception 'anonymous funding reservation allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_record_reward_funding_attempt(null,null,null,'synthetic','{}'); raise exception 'anonymous funding attempt allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_funding_attempt(null,null,null,null); raise exception 'anonymous funding bytes allowed'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
do $$ begin
  begin perform public.service_queue_reward_lifecycle_job(null,null,null,null,null,'synthetic'); raise exception 'athlete lifecycle queue allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_lifecycle_job(null,null); raise exception 'athlete lifecycle job allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_step_reward_lifecycle_job(null,null,null,null,'lease'); raise exception 'athlete lifecycle step allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_confirm_reward_lifecycle_job(null,null,null,null,'{}','{}','{}'); raise exception 'athlete lifecycle confirmation allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_lifecycle_context(null,null,null,null,null); raise exception 'athlete lifecycle context allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_reserve_reward_lifecycle(null,null,null,'activate','synthetic',null,31337,'0'); raise exception 'athlete lifecycle reserve allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_record_reward_lifecycle_attempt(null,null,null,null,'synthetic','{}'); raise exception 'athlete lifecycle attempt allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_lifecycle_attempt(null,null,null,null,null); raise exception 'athlete lifecycle bytes allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_queue_reward_funding_job(null,null,null,null,'synthetic'); raise exception 'athlete funding queue allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_funding_job(null,null); raise exception 'athlete funding job allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_step_reward_funding_job(null,null,null,null,'lease'); raise exception 'athlete funding lease allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_confirm_reward_funding_job(null,null,null,null,'{}','{}','{}'); raise exception 'athlete funding confirmation allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_deployment_context(null,null,null); raise exception 'athlete read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_reserve_reward_deployment(null,null,'synthetic',31337,'0'); raise exception 'athlete reserve allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_record_reward_deployment_attempt(null,null,null,'synthetic','{}'); raise exception 'athlete attempt allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_deployment_attempt(null,null,null,null); raise exception 'athlete signed bytes allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_campaign_checkpoint(null,null,null); raise exception 'athlete checkpoint read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_record_reward_campaign_checkpoint(null,null,null,null,'synthetic','{}','{}'); raise exception 'athlete checkpoint write allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_queue_reward_deployment_job(null,null,null,null,'synthetic'); raise exception 'athlete queue allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_deployment_job(null,null); raise exception 'athlete job read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_step_reward_deployment_job(null,null,null,null,'lease'); raise exception 'athlete job lease allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_funding_context(null,null,null); raise exception 'athlete funding read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_reserve_reward_funding(null,null,'synthetic',null,31337,'0'); raise exception 'athlete funding reservation allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_record_reward_funding_attempt(null,null,null,'synthetic','{}'); raise exception 'athlete funding attempt allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_funding_attempt(null,null,null,null); raise exception 'athlete funding bytes allowed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
