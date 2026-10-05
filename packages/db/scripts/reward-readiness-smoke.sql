begin;
do $$ declare fn regprocedure; name text; begin
  foreach fn in array array[
    'app_private.reward_athlete_profile_fingerprint(uuid)'::regprocedure,
    'app_private.reward_destination_has_programme_scope(uuid,uuid)'::regprocedure,
    'public.service_list_reward_operator_programmes(uuid,uuid,integer,uuid)'::regprocedure,
    'public.service_list_reward_operator_destinations(uuid,uuid,uuid,integer,uuid)'::regprocedure,
    'app_private.reward_athlete_review_document(app_private.reward_athlete_readiness_reviews)'::regprocedure,
    'app_private.reward_athlete_review_context(uuid,uuid)'::regprocedure,
    'public.service_read_reward_athlete_review_context(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.service_record_reward_athlete_review(uuid,uuid,uuid,uuid,text,integer,jsonb,text)'::regprocedure,
    'public.service_revoke_reward_athlete_review(uuid,uuid,uuid,uuid,text)'::regprocedure
  ] loop
    if exists(select 1 from pg_proc where oid=fn and prosecdef) then raise exception 'Readiness function must be invoker: %',fn; end if;
    if not exists(select 1 from pg_proc where oid=fn and proconfig @> array['search_path=""','TimeZone=UTC']) then
      raise exception 'Readiness function must retain empty search path and UTC: %',fn; end if;
    if has_function_privilege('anon',fn,'execute') or has_function_privilege('authenticated',fn,'execute')
      or not has_function_privilege('service_role',fn,'execute') then raise exception 'Incorrect readiness grants: %',fn; end if;
  end loop;
  foreach name in array array['reward_athlete_readiness_reviews','reward_athlete_readiness_revocations'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app_private' and c.relname=name and c.relrowsecurity) then raise exception 'Readiness RLS missing: %',name; end if;
    if has_table_privilege('anon','app_private.'||name,'select,insert,update,delete')
      or has_table_privilege('authenticated','app_private.'||name,'select,insert,update,delete')
      or has_table_privilege('service_role','app_private.'||name,'update,delete')
      or not has_table_privilege('service_role','app_private.'||name,'select,insert') then raise exception 'Incorrect readiness table grants: %',name; end if;
  end loop;
end $$;
set local role anon;
do $$ begin
  begin perform public.service_list_reward_operator_programmes(null,null,null,null);raise exception 'Anonymous programme discovery';exception when insufficient_privilege then null;end;
  begin perform public.service_read_reward_athlete_review_context(null,null,null,null);raise exception 'Anonymous readiness read';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform public.service_list_reward_operator_destinations(null,null,null,null,null);raise exception 'Browser destination discovery';exception when insufficient_privilege then null;end;
  begin perform public.service_record_reward_athlete_review(null,null,null,null,null,null,null,null);raise exception 'Browser review';exception when insufficient_privilege then null;end;
  begin perform public.service_revoke_reward_athlete_review(null,null,null,null,null);raise exception 'Browser revoke';exception when insufficient_privilege then null;end;
end $$;
rollback;
