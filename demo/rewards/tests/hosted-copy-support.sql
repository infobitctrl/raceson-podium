-- Owned disposable copied-demo replay only. No provider call or chain payment.
begin;
create role podium_execution_service_test_20261005 nologin bypassrls;
grant service_role to podium_execution_service_test_20261005;
insert into auth.users(id,email,role,aud,is_anonymous,raw_app_meta_data,raw_user_meta_data) values
('7c000000-0000-4000-8000-000000000001','podium.sponsor@accounts.sitrail.invalid','authenticated','authenticated',false,'{"trail_credential_mode":"username","podium_copy_batch":"073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644","podium_demo_kind":"sponsor"}','{}'),
('7c000000-0000-4000-8000-000000000002','racesmon1@accounts.sitrail.invalid','authenticated','authenticated',false,'{"trail_credential_mode":"username","podium_copy_batch":"073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644","podium_demo_kind":"athlete","podium_demo_ordinal":1}','{}'),
('7c000000-0000-4000-8000-000000000003','disposable.master@accounts.sitrail.invalid','authenticated','authenticated',false,'{"trail_credential_mode":"username","podium_role_setup":"20261005-owner-request","podium_requested_role":"platform_admin"}','{}');
select app_private.bind_reward_demo_copy_accounts();
insert into public.user_profiles(user_id,display_name,status) values ('7c000000-0000-4000-8000-000000000003','Disposable master','active') on conflict(user_id) do update set status='active';
insert into public.account_login_identifiers(user_id,username) values ('7c000000-0000-4000-8000-000000000003','demo.master');
insert into public.platform_administrators(user_id,platform_role,is_active) values ('7c000000-0000-4000-8000-000000000003','super_admin',true);
insert into auth.sessions(id,user_id,not_after) values
('7c000000-0000-4000-8000-000000000101','7c000000-0000-4000-8000-000000000001',now()+interval '1 hour'),
('7c000000-0000-4000-8000-000000000102','7c000000-0000-4000-8000-000000000002',now()+interval '1 hour'),
('7c000000-0000-4000-8000-000000000103','7c000000-0000-4000-8000-000000000003',now()+interval '1 hour');
create function pg_temp.must_fail(query text,expected text) returns void language plpgsql as $$
declare failed boolean:=false;begin
 begin execute query;exception when others then if sqlerrm not like expected then raise exception 'Unexpected failure: %',sqlerrm;end if;failed:=true;end;
 if not failed then raise exception 'Expected failure missing: %',expected;end if;
end $$;
set local role podium_execution_service_test_20261005;
do $$
declare u uuid:='7c000000-0000-4000-8000-000000000003'; sid uuid:='7c000000-0000-4000-8000-000000000103';
 v jsonb; c jsonb; rpc text;
begin
 rpc:=format('select public.service_reward_demo_copy_support_settings(%L,%L,',u,sid);
 v:=public.service_reward_demo_copy_support_settings(u,sid);
 if v->>'revision'<>'0' or v#>>'{settings,supportLimitWei}'<>'0' then raise exception 'Unexpected initial settings'; end if;
 c:=jsonb_build_object('requestId',gen_random_uuid(),'expectedRevision',0,'reason','Owned disposable support verification',
 'settings','{"gasAlertWei":"2000000000000000000","supportWallet":null,"supportLimitWei":"0"}'::jsonb);
 v:=public.service_reward_demo_copy_support_settings(u,sid,c);
 if v->>'revision'<>'1' or jsonb_array_length(v->'history')<>1 then raise exception 'Audit/save mismatch';end if;
 if v<>public.service_reward_demo_copy_support_settings(u,sid,c) then raise exception 'Exact retry changed settings';end if;
 perform pg_temp.must_fail(rpc||format('%L::jsonb)',jsonb_set(c,'{settings,gasAlertWei}','"1"')),'reward_support_settings_conflict');
 perform pg_temp.must_fail(rpc||format('%L::jsonb)',jsonb_set(c,'{requestId}',to_jsonb(gen_random_uuid()))),'reward_support_settings_conflict');
 perform pg_temp.must_fail(rpc||format('%L::jsonb)',c||'{"signedTransaction":"0x1234"}'::jsonb),'invalid_reward_support_settings');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_support_settings(%L,%L)',u,gen_random_uuid()),'reward_account_session_required');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_support_settings(%L,%L)','7c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000101'),'reward_master_admin_required');
 perform pg_temp.must_fail('select * from app_private.reward_support_changes','permission denied%');
 perform pg_temp.must_fail(format('select public.service_reward_support_settings(%L,%L)',u,sid),'permission denied%');
end $$;
reset role;
update public.platform_administrators set is_active=false where user_id='7c000000-0000-4000-8000-000000000003';
set local role podium_execution_service_test_20261005;
select pg_temp.must_fail('select public.service_reward_demo_copy_support_settings(''7c000000-0000-4000-8000-000000000003'',''7c000000-0000-4000-8000-000000000103'')','reward_master_admin_required');
reset role;
do $$ begin
 if has_function_privilege('anon','public.service_reward_demo_copy_support_settings(uuid,uuid,jsonb)','execute')
  or has_function_privilege('authenticated','public.service_reward_demo_copy_support_settings(uuid,uuid,jsonb)','execute') then raise exception 'Client settings grant'; end if;
 if (select count(*) from app_private.reward_support_changes)<>1 then raise exception 'Duplicate audit write';end if;
 if exists(select 1 from app_private.reward_wallet_changes) or exists(select 1 from app_private.reward_sponsor_executions) then raise exception 'Support settings changed financial authority';end if;
end $$;
rollback;
select 'Hosted support master/session, exact retry, CAS, audit, revoked authority and private transport checks passed' as result;
