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
insert into auth.users(id,email,role,aud,is_anonymous,raw_app_meta_data,raw_user_meta_data) values
('7c000000-0000-4000-8000-000000000004','disposable.review@accounts.sitrail.invalid','authenticated','authenticated',false,'{"trail_credential_mode":"username","podium_role_setup":"20261005-owner-request","podium_requested_role":"reviewer"}','{}');
insert into public.user_profiles(user_id,display_name,status) values ('7c000000-0000-4000-8000-000000000004','Disposable reviewer','active') on conflict(user_id) do update set status='active';
insert into public.account_login_identifiers(user_id,username) values ('7c000000-0000-4000-8000-000000000004','demo.review');
insert into auth.sessions(id,user_id,not_after) values ('7c000000-0000-4000-8000-000000000104','7c000000-0000-4000-8000-000000000004',now()+interval '1 hour');
insert into public.organization_custom_roles(id,organization_id,role_key,created_by_user_id)
 select '7c000000-0000-4000-8000-000000000410',organization_id,'disposable-copy-review','7c000000-0000-4000-8000-000000000003' from public.leagues where id='ba81ced7-b2c5-4d51-95b6-d95d8c04fa36';
insert into public.organization_custom_role_versions(id,organization_custom_role_id,version_number,title,description,permission_digest_sha256,created_by_user_id,client_event_id)
 values ('7c000000-0000-4000-8000-000000000420','7c000000-0000-4000-8000-000000000410',1,'Disposable reviewer','Owned rollback verification',repeat('f',64),'7c000000-0000-4000-8000-000000000003',gen_random_uuid());
insert into public.organization_custom_role_permissions(organization_custom_role_version_id,permission_code) values
 ('7c000000-0000-4000-8000-000000000420','results.manage'),('7c000000-0000-4000-8000-000000000420','events.manage');
insert into public.organization_memberships(organization_id,user_id,role,status,membership_type,custom_role_id,permission_keys)
 select organization_id,'7c000000-0000-4000-8000-000000000004','admin','active','permanent','7c000000-0000-4000-8000-000000000410',array['results.manage','events.manage'] from public.leagues where id='ba81ced7-b2c5-4d51-95b6-d95d8c04fa36';
set local role podium_execution_service_test_20261005;
do $$
declare u uuid:='7c000000-0000-4000-8000-000000000001'; sid uuid:='7c000000-0000-4000-8000-000000000101';
 id uuid:='7c000000-0000-4000-8000-000000000200'; launch uuid:='7c000000-0000-4000-8000-000000000201';
 t jsonb; c jsonb; payload jsonb; frozen jsonb; plan jsonb; record jsonb; job jsonb; i integer; rpc text;
begin
 t:=public.service_reward_demo_copy_sponsor(u,sid,'template',id);c:=t->'result';
 for i in 0..5 loop c:=jsonb_set(c,array['root','children',i::text,'children','0','shareBps'],'10000');end loop;
 perform public.service_reward_demo_copy_sponsor(u,sid,'save',id,gen_random_uuid(),0,c,t->>'sourceFingerprint');
 payload:=jsonb_build_object('requestId',launch,'expectedRevision',1,'sourceFingerprint',t->>'sourceFingerprint');
 rpc:=format('select public.service_reward_demo_copy_sponsor_operation(%L,%L,%L,',u,sid,id);
 frozen:=public.service_reward_demo_copy_sponsor_operation(u,sid,id,'launch',payload);
 if frozen#>>'{launch,id}'<>launch::text then raise exception 'Launch mismatch';end if;
 if frozen<>public.service_reward_demo_copy_sponsor_operation(u,sid,id,'launch',payload) then raise exception 'Freeze retry mismatch';end if;
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','launch',jsonb_set(payload,'{sourceFingerprint}',to_jsonb(repeat('f',64)))),'copy_scope_changed');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','launch',jsonb_set(payload,'{expectedRevision}','2')),'reward_setup_conflict');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','arbitrary','{}'),'invalid_sponsor_execution');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','execution','{"plan":null,"deploymentHash":null,"fundingHash":null,"funded":true}'),'invalid_sponsor_execution');
 plan:=jsonb_build_object('version',4,'launchId',launch,'setupRevision',1,'configurationHash',frozen#>>'{launch,configurationHash}',
  'chainId',10143,'funder','0x'||repeat('1',40),'operator','0x'||repeat('2',40),'unallocatedTreasury','0x'||repeat('3',40),
  'expiredTreasury','0x'||repeat('3',40),'claimLifetime',31536000,'reviewPeriods','[0,0,0,0,0,0]'::jsonb,
  'caps','["101","0","0","0","0","0"]'::jsonb,'budgetWei','101');
 payload:=jsonb_build_object('plan',plan,'deploymentHash',null,'fundingHash',null);
 record:=public.service_reward_demo_copy_sponsor_operation(u,sid,id,'execution',payload);
 if record->'plan'<>plan or record->'deploymentHash'<>'null'::jsonb or record->'fundingHash'<>'null'::jsonb then raise exception 'Execution mismatch';end if;
 if record<>public.service_reward_demo_copy_sponsor_operation(u,sid,id,'execution',payload) then raise exception 'Plan retry mismatch';end if;
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','execution',jsonb_set(payload,'{plan,launchId}',to_jsonb(gen_random_uuid()))),'reward_launch_sources_required');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','execution',jsonb_set(payload,'{plan,chainId}','1')),'invalid_sponsor_execution');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','execution',jsonb_set(payload,'{plan,budgetWei}','"102"')),'reward_setup_conflict');
 payload:=jsonb_build_object('action','reserve','leaseId',gen_random_uuid(),'sender','0x'||repeat('4',40),'transaction',
  jsonb_build_object('chainId',10143,'to','0x'||repeat('5',40),'value','0','data','0x1234','nonce','0','gas','3000000','gasPrice','2000000000'),
  'signedTransaction',null,'hash',null,'chainId',10143);
 job:=public.service_reward_demo_copy_sponsor_operation(u,sid,id,'creation',payload);
 if job->>'sender'<>'0x'||repeat('4',40) or job->'confirmed'<>'false'::jsonb then raise exception 'Creation mismatch';end if;
 if job-'leaseUntil'<>public.service_reward_demo_copy_sponsor_operation(u,sid,id,'creation',payload)-'leaseUntil' then raise exception 'Creation retry mismatch';end if;
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','creation',jsonb_set(payload,'{chainId}','1')),'invalid_sponsor_creation');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_sponsor_operation(%L,%L,%L,%L,%L::jsonb)',u,gen_random_uuid(),id,'creation',payload),'reward_account_session_required');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_sponsor_operation(%L,%L,%L,%L,%L::jsonb)','7c000000-0000-4000-8000-000000000002','7c000000-0000-4000-8000-000000000102',id,'creation',payload),'reward_demo_sponsor_required');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','availability','{"sender":null,"extra":true}'),'invalid_sponsor_creation');
 perform pg_temp.must_fail('select * from app_private.reward_sponsor_auto_deployments','permission denied%');
 perform pg_temp.must_fail('select * from app_private.reward_demo_copy_launch_sources','permission denied%');
 perform pg_temp.must_fail(format('select public.service_reward_sponsor_execution(%L,%L,10143,%L)',u,sid,id),'permission denied%');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_wallet_operation(%L,%L,%L,%L::jsonb)','settings',u,sid,'{"expectedRevision":null,"settings":null,"reason":null,"previousSettings":null}'),'reward_master_admin_required');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_wallet_operation(%L,%L,%L,%L::jsonb)','runtime',u,sid,'{}'),'invalid_reward_wallet_settings');
 if public.service_reward_demo_copy_wallet_operation('runtime')->>'revision'<>'0' then raise exception 'Unexpected runtime';end if;
 if public.service_reward_demo_copy_wallet_operation('settings','7c000000-0000-4000-8000-000000000003','7c000000-0000-4000-8000-000000000103',
  '{"expectedRevision":null,"settings":null,"reason":null,"previousSettings":null}')->>'revision'<>'0' then raise exception 'Master read failed';end if;
 -- Later editable rules do not replace the contract's source-bound revision.
 c:=jsonb_set(c,'{name}','"Edited later draft"');
 perform public.service_reward_demo_copy_sponsor(u,sid,'save',id,gen_random_uuid(),1,c,t->>'sourceFingerprint');
 if public.service_reward_demo_copy_frozen_setup(u,sid,id,1)#>'{result,configuration}' is distinct from frozen#>'{launch,setup,configuration}' then raise exception 'Frozen economics changed';end if;
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_frozen_setup(%L,%L,%L,2)',u,sid,id),'reward_setup_conflict');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_frozen_setup(%L,%L,%L,1)',u,gen_random_uuid(),id),'reward_account_session_required');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_frozen_setup(%L,%L,%L,1)','7c000000-0000-4000-8000-000000000002','7c000000-0000-4000-8000-000000000102',id),'reward_demo_sponsor_required');
end $$;
reset role;
do $$ begin
 if (select count(*) from app_private.reward_demo_copy_launch_sources)<>1 or (select count(*) from app_private.reward_sponsor_auto_deployments)<>1 then raise exception 'Duplicate retry';end if;
 if exists(select 1 from app_private.reward_sponsor_executions where deployment_hash is not null or funding_hash is not null) then raise exception 'No confirmed receipt expected';end if;
 if exists(select 1 from app_private.reward_wallet_changes) then raise exception 'Unexpected wallet activation';end if;
 if has_function_privilege('anon','public.service_reward_demo_copy_sponsor_operation(uuid,uuid,uuid,text,jsonb)','execute')
  or has_function_privilege('authenticated','public.service_reward_demo_copy_sponsor_operation(uuid,uuid,uuid,text,jsonb)','execute')
  or has_function_privilege('authenticated','public.service_reward_demo_copy_wallet_operation(text,uuid,uuid,jsonb)','execute') then raise exception 'Client execution grant';end if;
 if has_function_privilege('anon','public.service_reward_demo_copy_frozen_setup(uuid,uuid,uuid,integer)','execute')
  or has_function_privilege('authenticated','public.service_reward_demo_copy_frozen_setup(uuid,uuid,uuid,integer)','execute') then raise exception 'Client frozen setup grant';end if;
end $$;
set local role podium_execution_service_test_20261005;
do $$ declare v jsonb; reviewer uuid:='7c000000-0000-4000-8000-000000000004';sid uuid:='7c000000-0000-4000-8000-000000000104';begin
 v:=public.service_reward_demo_copy_review_sources(reviewer,sid);
 if jsonb_array_length(v->'items')<>1 or v#>>'{items,0,launch,setup,revision}'<>'1' or v#>'{items,0,source}'<>'null'::jsonb then raise exception 'Reviewer queue did not retain execution version';end if;
 v:=public.service_reward_demo_copy_review_sources(reviewer,sid,'7c000000-0000-4000-8000-000000000200');
 if v#>>'{items,0,source,version}'<>'raceson-five-round-copy-v1' then raise exception 'Frozen projection unavailable';end if;
 if jsonb_array_length(public.service_reward_demo_copy_review_sources(reviewer,sid,gen_random_uuid())->'items')<>0 then raise exception 'Unknown campaign returned';end if;
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_review_sources(%L,%L)',reviewer,gen_random_uuid()),'reward_account_session_required');
 perform pg_temp.must_fail('select public.service_reward_demo_copy_review_sources(''7c000000-0000-4000-8000-000000000001'',''7c000000-0000-4000-8000-000000000101'')','reward_demo_reviewer_required');
 if has_function_privilege('anon','public.service_reward_demo_copy_review_sources(uuid,uuid,uuid)','execute') or has_function_privilege('authenticated','public.service_reward_demo_copy_review_sources(uuid,uuid,uuid)','execute') then raise exception 'Client review grant';end if;
end $$;
reset role;
update public.organization_memberships set permission_keys=array['events.manage'] where user_id='7c000000-0000-4000-8000-000000000004';
set local role podium_execution_service_test_20261005;
select pg_temp.must_fail('select public.service_reward_demo_copy_review_sources(''7c000000-0000-4000-8000-000000000004'',''7c000000-0000-4000-8000-000000000104'')','reward_demo_reviewer_required');
reset role;

rollback;
select 'Copied review queue, immutable execution version, frozen source, wrong role/session, custom permission revocation and private transport checks passed' as result;
