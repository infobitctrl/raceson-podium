-- Private salts/export never become a browser API. Synthetic local validation.
begin;
do $$ declare fn regprocedure; begin
  foreach fn in array array[
    'public.service_read_reward_allocation_export(uuid,uuid,uuid)'::regprocedure,
    'public.service_save_reward_upload(uuid,uuid,uuid,text,jsonb,jsonb)'::regprocedure,
    'public.service_check_reward_upload_evidence(uuid,uuid,uuid)'::regprocedure,
    'app_private.reward_allocation_evidence(uuid)'::regprocedure,
    'app_private.reward_allocation_publication_time(uuid)'::regprocedure,
    'app_private.assert_reward_allocation_source_current(uuid,uuid)'::regprocedure
  ] loop
    if exists (select 1 from pg_proc where oid=fn and (prosecdef or not coalesce('search_path=""'=any(proconfig),false)))
      or not has_function_privilege('service_role',fn,'execute') or has_function_privilege('anon',fn,'execute')
      or has_function_privilege('authenticated',fn,'execute') then raise exception 'reward upload function privacy regression'; end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid='app_private.reward_upload_packages'::regclass)
    or has_table_privilege('anon','app_private.reward_upload_packages','select,insert,update,delete')
    or has_table_privilege('authenticated','app_private.reward_upload_packages','select,insert,update,delete')
    or has_table_privilege('service_role','app_private.reward_upload_packages','update,delete')
    or not has_table_privilege('service_role','app_private.reward_upload_packages','select')
    or not has_table_privilege('service_role','app_private.reward_upload_packages','insert') then
    raise exception 'reward upload table privacy regression'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform public.service_read_reward_allocation_export(null,null,null); raise exception 'anonymous export allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_save_reward_upload(null,null,null,'synthetic','{}','{}'); raise exception 'anonymous upload allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_check_reward_upload_evidence(null,null,null); raise exception 'anonymous evidence allowed'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
do $$ begin
  begin perform public.service_read_reward_allocation_export(null,null,null); raise exception 'athlete export allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_save_reward_upload(null,null,null,'synthetic','{}','{}'); raise exception 'athlete upload allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_check_reward_upload_evidence(null,null,null); raise exception 'athlete evidence allowed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
