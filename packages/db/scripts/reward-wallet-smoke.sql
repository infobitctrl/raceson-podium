begin;
do $$ declare fn regprocedure; name text; begin
  if has_function_privilege('anon','public.service_request_auth_user(uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.service_request_auth_user(uuid,uuid)','execute')
    or not has_function_privilege('service_role','public.service_request_auth_user(uuid,uuid)','execute') then
    raise exception 'Existing privileged Auth bridge grants changed'; end if;
  foreach fn in array array[
    'app_private.require_reward_account(uuid,uuid)'::regprocedure,
    'app_private.reward_wallet_challenge_document(app_private.reward_wallet_challenges)'::regprocedure,
    'public.service_create_reward_wallet_challenge(uuid,uuid,integer,text,text,text)'::regprocedure,
    'public.service_read_reward_wallet_challenge(uuid,uuid,uuid)'::regprocedure,
    'public.service_confirm_reward_wallet_proof(uuid,uuid,uuid,text,text)'::regprocedure,
    'public.service_read_own_reward_awards(uuid,uuid,uuid)'::regprocedure
  ] loop
    if exists(select 1 from pg_proc where oid=fn and prosecdef) then raise exception 'Reward wallet RPC must be invoker: %',fn; end if;
    if has_function_privilege('anon',fn,'execute') or has_function_privilege('authenticated',fn,'execute')
      or not has_function_privilege('service_role',fn,'execute') then raise exception 'Incorrect wallet RPC grants: %',fn; end if;
  end loop;
  foreach name in array array['reward_wallet_challenges','reward_wallet_proofs'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app_private' and c.relname=name and c.relrowsecurity) then raise exception 'Wallet RLS missing: %',name; end if;
    if has_table_privilege('anon','app_private.'||name,'select,insert,update,delete')
      or has_table_privilege('authenticated','app_private.'||name,'select,insert,update,delete')
      or has_table_privilege('service_role','app_private.'||name,'update,delete')
      or not has_table_privilege('service_role','app_private.'||name,'select,insert') then raise exception 'Incorrect wallet table grants: %',name; end if;
    if not exists(select 1 from pg_trigger where tgrelid=('app_private.'||name)::regclass and tgname='reward_wallet_immutable') then
      raise exception 'Wallet mutation trigger missing: %',name; end if;
  end loop;
end $$;
set local role anon;
do $$ begin
  begin perform public.service_read_own_reward_awards(null,null,null);raise exception 'Anonymous own-award access';exception when insufficient_privilege then null;end;
  begin perform public.service_read_reward_wallet_challenge(null,null,null);raise exception 'Anonymous wallet access';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform public.service_create_reward_wallet_challenge(null,null,10143,null,null,null);raise exception 'Browser wallet creation';exception when insufficient_privilege then null;end;
  begin perform public.service_confirm_reward_wallet_proof(null,null,null,null,null);raise exception 'Browser wallet verification';exception when insufficient_privilege then null;end;
  begin perform public.service_read_own_reward_awards(null,null,null);raise exception 'Browser private awards';exception when insufficient_privilege then null;end;
end $$;
rollback;
