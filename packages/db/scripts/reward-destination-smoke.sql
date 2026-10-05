begin;
do $$ declare fn regprocedure; name text; begin
  foreach fn in array array[
    'app_private.reward_athlete_destination_document(app_private.reward_athlete_destination_requests)'::regprocedure,
    'public.service_request_reward_athlete_destination(uuid,uuid,uuid,uuid,text)'::regprocedure,
    'public.service_read_reward_athlete_destination(uuid,uuid,uuid)'::regprocedure,
    'public.service_list_reward_athlete_destinations(uuid,uuid,uuid)'::regprocedure,
    'public.service_withdraw_reward_athlete_destination(uuid,uuid,uuid)'::regprocedure
  ] loop
    if exists(select 1 from pg_proc where oid=fn and prosecdef) then raise exception 'Destination RPC must be invoker: %',fn; end if;
    if has_function_privilege('anon',fn,'execute') or has_function_privilege('authenticated',fn,'execute')
      or not has_function_privilege('service_role',fn,'execute') then raise exception 'Incorrect destination RPC grants: %',fn; end if;
  end loop;
  foreach name in array array['reward_athlete_destination_requests','reward_athlete_destination_withdrawals'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app_private' and c.relname=name and c.relrowsecurity) then raise exception 'Destination RLS missing: %',name; end if;
    if has_table_privilege('anon','app_private.'||name,'select,insert,update,delete')
      or has_table_privilege('authenticated','app_private.'||name,'select,insert,update,delete')
      or has_table_privilege('service_role','app_private.'||name,'update,delete')
      or not has_table_privilege('service_role','app_private.'||name,'select,insert') then raise exception 'Incorrect destination grants: %',name; end if;
  end loop;
end $$;
set local role anon;
do $$ begin
  begin perform public.service_list_reward_athlete_destinations(null,null,null);raise exception 'Anonymous destination listing';exception when insufficient_privilege then null;end;
  begin perform public.service_read_reward_athlete_destination(null,null,null);raise exception 'Anonymous destination access';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform public.service_list_reward_athlete_destinations(null,null,null);raise exception 'Browser destination listing';exception when insufficient_privilege then null;end;
  begin perform public.service_request_reward_athlete_destination(null,null,null,null,null);raise exception 'Browser destination creation';exception when insufficient_privilege then null;end;
  begin perform public.service_withdraw_reward_athlete_destination(null,null,null);raise exception 'Browser withdrawal';exception when insufficient_privilege then null;end;
end $$;
rollback;
