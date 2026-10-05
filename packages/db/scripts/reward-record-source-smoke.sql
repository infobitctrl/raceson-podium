-- Catalog and real browser-role denials; valid operator/service invocation is
-- additionally tested against the full synthetic programme in the Node runner.
begin;
do $$
declare fn regprocedure; tbl regclass;
begin
  foreach fn in array array[
    'public.service_read_reward_record_source(uuid,uuid,uuid)'::regprocedure,
    'public.service_capture_reward_record_source(uuid,uuid,uuid,uuid,text)'::regprocedure,
    'public.service_read_reward_record_snapshot(uuid,uuid,uuid)'::regprocedure,
    'public.service_read_reward_record_approval(uuid,uuid,uuid)'::regprocedure,
    'public.service_approve_reward_record(uuid,uuid,uuid,text,jsonb)'::regprocedure,
    'public.service_withdraw_reward_record(uuid,uuid,uuid,text,text)'::regprocedure,
    'app_private.assert_reward_record_review_current(uuid,uuid,uuid,jsonb)'::regprocedure
  ] loop
    if exists (select 1 from pg_proc where oid = fn and (prosecdef or not coalesce('search_path=""' = any(proconfig), false)))
      or not has_function_privilege('service_role', fn, 'execute')
      or has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'reward prior-evidence function privacy regression';
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'app_private.reward_record_source_snapshots'::regclass)
    or has_table_privilege('anon', 'app_private.reward_record_source_snapshots', 'select')
    or has_table_privilege('authenticated', 'app_private.reward_record_source_snapshots', 'select')
    or has_table_privilege('service_role', 'app_private.reward_record_source_snapshots', 'update,delete')
    or not has_table_privilege('service_role', 'app_private.reward_record_source_snapshots', 'select')
    or not has_table_privilege('service_role', 'app_private.reward_record_source_snapshots', 'insert') then
    raise exception 'reward prior-evidence table privacy regression';
  end if;
  foreach tbl in array array['app_private.reward_record_approvals'::regclass, 'app_private.reward_record_withdrawals'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = tbl)
      or has_table_privilege('anon', tbl, 'select,insert,update,delete')
      or has_table_privilege('authenticated', tbl, 'select,insert,update,delete')
      or has_table_privilege('service_role', tbl, 'update,delete')
      or not has_table_privilege('service_role', tbl, 'select') or not has_table_privilege('service_role', tbl, 'insert') then
      raise exception 'reward record-approval table privilege regression';
    end if;
  end loop;
end
$$;
set local role anon;
do $$ begin
  begin perform public.service_read_reward_record_source(null,null,null); raise exception 'anon read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_capture_reward_record_source(null,null,null,null,'synthetic'); raise exception 'anon capture allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_record_snapshot(null,null,null); raise exception 'anon snapshot allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_record_approval(null,null,null); raise exception 'anon approval read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_approve_reward_record(null,null,null,'synthetic','{}'); raise exception 'anon approval allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_withdraw_reward_record(null,null,null,'synthetic','synthetic reason'); raise exception 'anon withdrawal allowed'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
do $$ begin
  begin perform public.service_read_reward_record_source(null,null,null); raise exception 'athlete read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_capture_reward_record_source(null,null,null,null,'synthetic'); raise exception 'athlete capture allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_record_snapshot(null,null,null); raise exception 'athlete snapshot allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_read_reward_record_approval(null,null,null); raise exception 'athlete approval read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_approve_reward_record(null,null,null,'synthetic','{}'); raise exception 'athlete approval allowed'; exception when insufficient_privilege then null; end;
  begin perform public.service_withdraw_reward_record(null,null,null,'synthetic','synthetic reason'); raise exception 'athlete withdrawal allowed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
