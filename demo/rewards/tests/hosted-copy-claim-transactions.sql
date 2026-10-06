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
-- Disposable transport documents below are deliberately synthetic. Domain/API
-- tests independently reconstruct real award documents; no chain observation occurs.
do $$ declare u uuid:='7c000000-0000-4000-8000-000000000004'; sid uuid:='7c000000-0000-4000-8000-000000000104';
 id uuid:='7c000000-0000-4000-8000-000000000200'; first uuid:='7c000000-0000-4000-8000-000000000600'; second uuid:='7c000000-0000-4000-8000-000000000601';
 v jsonb; doc jsonb; held jsonb; saved jsonb; rpc text;
begin
 v:=public.service_reward_demo_copy_allocation('read',u,sid,id,0);
 doc:=jsonb_build_object('schema','podium-copy-allocation-document-v1','launch',v->'launch','plan',v#>'{execution,plan}','source',v->'sourceFacts',
  'slot',0,'contextHash',v->'contextHash','binding',jsonb_build_object(
  'batchSha256','073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644',
  'projectionSha256','7043cf919edd4dc3bdf40d022c60d0fc40036f2e4093b33b57dfc040bda3975d',
  'leagueId','ba81ced7-b2c5-4d51-95b6-d95d8c04fa36','seasonId','323d55fc-a396-4ff4-a17e-eb7152c8f8f1',
  'combined','owner-combined-selection-20261005-v1','unaffiliated','owner-unaffiliated-selection-20261005-v1'),
  'calculation','{"slot":0,"budgetWei":"101","proposedWei":"101","retainedWei":"0","groups":[{"budgetWei":"101","hold":null}],"recipients":[{"beneficiaryKind":"athlete","beneficiaryId":"7c000000-0000-4000-8000-000000000002","amountWei":"101"}]}'::jsonb);
 saved:=public.service_reward_demo_copy_allocation('review',u,sid,id,0,first,null,v->>'contextHash',doc::text,'approved');
 if saved#>>'{recorded,id}'<>first::text or saved#>>'{recorded,decision}'<>'approved' then raise exception 'Exact approval missing';end if;
 rpc:=format('select public.service_reward_demo_copy_allocation(%L,%L,%L,%L,0,%L,null,%L,','review',u,sid,id,first,v->>'contextHash');
 perform pg_temp.must_fail(rpc||format('%L,%L)',doc::text,'held'),'reward_sponsor_approval_conflict');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_allocation(%L,%L,%L,%L,0,%L,null,%L,%L,%L)','review',u,sid,id,gen_random_uuid(),v->>'contextHash',doc::text,'approved'),'reward_sponsor_approval_conflict');
 held:=jsonb_set(doc,'{calculation,groups,0,hold}','"synthetic_hold"');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_allocation(%L,%L,%L,%L,0,%L,%L,%L,%L,%L)','review',u,sid,id,second,first,v->>'contextHash',held::text,'approved'),'reward_sponsor_source_not_ready');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_allocation(%L,%L,%L,%L,0,%L,%L,%L,%L,%L)','review',u,sid,id,second,first,v->>'contextHash',jsonb_set(doc,'{source,sportingSha256}',to_jsonb(repeat('f',64)))::text,'held'),'invalid_sponsor_allocation');
 perform public.service_reward_demo_copy_allocation('review',u,sid,id,0,second,first,v->>'contextHash',held::text,'held');
 saved:=public.service_reward_demo_copy_allocation('review',u,sid,id,0,first,null,v->>'contextHash',doc::text,'approved');
 if saved#>>'{approval,id}'<>second::text or saved#>>'{recorded,id}'<>first::text then raise exception 'Historical retry replaced hold';end if;
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_allocation(%L,%L,%L,%L,0)','read',u,gen_random_uuid(),id),'reward_account_session_required');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_allocation(%L,%L,%L,%L,0)','arbitrary',u,sid,id),'invalid_sponsor_allocation');
 perform pg_temp.must_fail('select * from app_private.reward_sponsor_allocation_approvals_v4','permission denied%');
 if has_function_privilege('authenticated','public.service_reward_demo_copy_allocation(text,uuid,uuid,uuid,integer,uuid,uuid,text,text,text)','execute')
  or has_function_privilege('anon','public.service_reward_demo_copy_allocation(text,uuid,uuid,uuid,integer,uuid,uuid,text,text,text)','execute') then raise exception 'Client award grant';end if;
end $$;
-- Synthetic transport replay only: these hashes are deliberately not receipts.
reset role;
update app_private.reward_sponsor_executions set deployment_hash='0x'||repeat('1',64),funding_hash='0x'||repeat('2',64)
 where setup_id='7c000000-0000-4000-8000-000000000200';
set local role podium_execution_service_test_20261005;
do $$ declare u uuid:='7c000000-0000-4000-8000-000000000004'; sid uuid:='7c000000-0000-4000-8000-000000000104';
 id uuid:='7c000000-0000-4000-8000-000000000200'; a uuid:='7c000000-0000-4000-8000-000000000602';
 req uuid:='7c000000-0000-4000-8000-000000000603'; pubid uuid:='7c000000-0000-4000-8000-000000000604';
 v jsonb; doc jsonb; pkg jsonb; f jsonb; p jsonb; recipient jsonb; stamp jsonb; official text; rpc text; publications jsonb;
begin
 v:=public.service_reward_demo_copy_allocation('read',u,sid,id,0);
 doc:=jsonb_build_object('schema','podium-copy-allocation-document-v1','launch',v->'launch','plan',v#>'{execution,plan}','source',v->'sourceFacts',
 'slot',0,'contextHash',v->'contextHash','binding',jsonb_build_object('batchSha256','073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644',
 'projectionSha256','7043cf919edd4dc3bdf40d022c60d0fc40036f2e4093b33b57dfc040bda3975d','leagueId','ba81ced7-b2c5-4d51-95b6-d95d8c04fa36','seasonId','323d55fc-a396-4ff4-a17e-eb7152c8f8f1',
 'combined','owner-combined-selection-20261005-v1','unaffiliated','owner-unaffiliated-selection-20261005-v1'),
 'calculation','{"slot":0,"budgetWei":"101","proposedWei":"101","retainedWei":"0","groups":[{"budgetWei":"101","hold":null}],"recipients":[{"beneficiaryKind":"athlete","beneficiaryId":"7c000000-0000-4000-8000-000000000002","amountWei":"101"}]}'::jsonb);
 doc:=jsonb_set(doc,'{calculation,recipients,0,beneficiaryId}',to_jsonb(public.service_reward_demo_copy_account_context('7c000000-0000-4000-8000-000000000002','7c000000-0000-4000-8000-000000000102')#>>'{user_profile,primary_athlete_profile_id}'));
 perform public.service_reward_demo_copy_allocation('review',u,sid,id,0,a,'7c000000-0000-4000-8000-000000000601',v->>'contextHash',doc::text,'approved');
 v:=public.service_reward_demo_copy_upload('read',u,sid,id,0,a);recipient:=v#>'{recipients,0}';
 pkg:=jsonb_build_object('schema','raceson-sponsor-upload-v4','protocolVersion',4,'chainId',10143,'slot',0,'approvalId',a,
 'documentHash',v->>'documentHash','programmeAddress','0x'||repeat('5',40),'campaignAddress','0x'||repeat('6',40),
 'deploymentHash',v#>>'{execution,deploymentHash}','fundingHash',v#>>'{execution,fundingHash}','programmeId','0x'||repeat('3',64),'campaignId','0x'||repeat('4',64),
 'programmeManifestHash','0x'||repeat('5',64),'reviewPeriod','0','claimLifetime',v#>>'{execution,plan,claimLifetime}',
 'unallocatedTreasury',v#>>'{execution,plan,unallocatedTreasury}','expiredTreasury',v#>>'{execution,plan,expiredTreasury}',
 'cancellationTreasury',v#>>'{execution,plan,funder}','budgetWei','101','allocatedWei','101','unallocatedWei','0',
 'snapshotDigest','0x'||repeat('6',64),'uploadDigest','0x'||repeat('7',64),'entitlementCount','1','awards',
 jsonb_build_array(jsonb_build_object('entitlementId',recipient->>'entitlementId','beneficiaryId',recipient->>'opaqueBeneficiaryId',
 'amount','101','pot',1,'beneficiaryKind',0,'explanationHash','0x'||repeat('8',64))));
 f:=jsonb_build_object('funded',true,'cancelled',false,'address',pkg->>'programmeAddress','deploymentHash',pkg->>'deploymentHash','fundingHash',pkg->>'fundingHash',
 'blockHash','0x'||repeat('9',64),'blockNumber','1','blockTimestamp','1','pots',jsonb_build_array(jsonb_build_object('slot',0,'address',pkg->>'campaignAddress',
 'amountWei','101','state',1,'paused',false,'allocatedWei','0','paidWei','0','returnedWei','0','entitlementCount','0','remainingWei','101')));
 rpc:=format('select public.service_reward_demo_copy_upload(%L,%L,%L,%L,0,%L,%L,%L,%L,','prepare',u,sid,id,a,req,v->>'contextHash',v->>'documentHash');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)',pkg::text,jsonb_set(f,'{pots,0,remainingWei}','"100"')),'reward_sponsor_funding_not_ready');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)',jsonb_set(pkg,'{awards,0,amount}','"102"')::text,f),'invalid_sponsor_upload');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)',pkg::text,jsonb_set(f,'{funded}','false')),'invalid_sponsor_upload');
 v:=public.service_reward_demo_copy_upload('prepare',u,sid,id,0,a,req,v->>'contextHash',v->>'documentHash',pkg::text,f);
 if v#>>'{prepared,id}'<>req::text then raise exception 'Prepared package missing';end if;
 if v is distinct from public.service_reward_demo_copy_upload('prepare',u,sid,id,0,a,req,v->>'contextHash',v->>'documentHash',pkg::text,f) then raise exception 'Package retry changed';end if;
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)',jsonb_set(pkg,'{allocatedWei}','"100"')::text,f),'reward_sponsor_upload_conflict');
 select max(floor(extract(epoch from (r->>'publishedAt')::timestamptz))::bigint)::text into official from jsonb_array_elements(doc#>'{source,races}') r;
 select jsonb_agg(jsonb_build_object('slot',r->'slot','raceId',r->'id','publicationId',r->'publicationId','runId',r->'runId','state',r->'publicationState','publishedAt',r->'publishedAt') order by n) into publications from jsonb_array_elements(doc#>'{source,races}') with ordinality rows(r,n);
 p:=jsonb_build_object('schema','raceson-sponsor-publication-v4','approvalId',a,'contextHash',v->>'contextHash','packageHash',v#>>'{prepared,packageHash}',
 'evidence',jsonb_build_object('schema','podium-copy-publication-evidence-v1','approvalId',a,'packageHash',v#>>'{prepared,packageHash}','documentHash',v->>'documentHash','binding',doc->'binding','sportingSha256',doc#>'{source,sportingSha256}','publications',publications),
 'timing',jsonb_build_object('reviewPeriod','0','reviewStartedAt',official,'officialPublishedAt',official,'publicationEvidenceHash','0x'||repeat('a',64)));
 rpc:=format('select public.service_reward_demo_copy_lifecycle(%L,%L,%L,0,%L,%L,%L,',u,sid,id,a,pubid,'publication');
 perform pg_temp.must_fail(rpc||format('%L)',jsonb_set(p,'{timing,reviewStartedAt}',to_jsonb((official::bigint-1)::text))::text),'invalid_sponsor_lifecycle');
 perform pg_temp.must_fail(rpc||format('%L)',jsonb_set(p,'{timing,officialPublishedAt}',to_jsonb((official::bigint+1)::text))::text),'invalid_sponsor_lifecycle');
 stamp:=public.service_reward_demo_copy_lifecycle(u,sid,id,0,a,pubid,'publication',p::text);
 if stamp#>>'{publication,current}'<>'true' then raise exception 'Publication not current';end if;
 if stamp is distinct from public.service_reward_demo_copy_lifecycle(u,sid,id,0,a,pubid,'publication',p::text) then raise exception 'Publication retry changed';end if;
 perform pg_temp.must_fail(rpc||format('%L)',jsonb_set(p,'{evidence}','{}')::text),'reward_sponsor_lifecycle_conflict');
 perform pg_temp.must_fail('select * from app_private.reward_sponsor_uploads_v4','permission denied%');
 perform pg_temp.must_fail(format('select app_private.reward_demo_copy_source_stamp(%L)',a),'permission denied%');
 if has_function_privilege('authenticated','public.service_reward_demo_copy_upload(text,uuid,uuid,uuid,integer,uuid,uuid,text,text,text,jsonb)','execute')
 or has_function_privilege('anon','public.service_reward_demo_copy_upload(text,uuid,uuid,uuid,integer,uuid,uuid,text,text,text,jsonb)','execute')
 or has_function_privilege('authenticated','public.service_reward_demo_copy_lifecycle(uuid,uuid,uuid,integer,uuid,uuid,text,text)','execute')
 then raise exception 'Client package/lifecycle access';end if;
end $$;

-- Synthetic wallet-control shapes are used only inside this rollback fixture.
-- API tests separately verify real EIP191/EIP712 signatures; no provider called.
do $$ declare u uuid:='7c000000-0000-4000-8000-000000000002';sid uuid:='7c000000-0000-4000-8000-000000000102';
 c jsonb;d jsonb;profile uuid;page jsonb;f jsonb;request jsonb;cid uuid:='7c000000-0000-4000-8000-000000000701';rpc text;
begin
 profile:=(public.service_reward_demo_copy_account_context(u,sid)#>>'{user_profile,primary_athlete_profile_id}')::uuid;
 page:=public.service_reward_demo_copy_athlete_awards(u,sid);
 if jsonb_array_length(page->'items')<>1 or page->'nextCursor'<>'null'::jsonb or page#>>'{items,0,athleteProfileId}'<>profile::text then raise exception 'Copied own award unavailable';end if;
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_athlete_awards(%L,%L)',u,gen_random_uuid()),'reward_account_session_required');
 perform pg_temp.must_fail('select public.service_reward_demo_copy_athlete_awards(''7c000000-0000-4000-8000-000000000001'',''7c000000-0000-4000-8000-000000000101'')','reward_claim_scope_required');
 c:=public.service_reward_demo_copy_beneficiary_wallet(u,sid,'challenge',jsonb_build_object('p_chain_id',10143,'p_address','0x'||repeat('a',40),'p_origin','https://podium.raceson.com','p_idempotency_key','owned-copy-claim-proof'));
 c:=public.service_reward_demo_copy_beneficiary_wallet(u,sid,'proof',jsonb_build_object('p_challenge_id',c->>'challengeId','p_message_hash','0x'||repeat('b',64),'p_signature','0x'||repeat('c',130)));
 d:=public.service_reward_demo_copy_beneficiary_wallet(u,sid,'destination',jsonb_build_object('p_athlete_profile_id',profile,'p_proof_id',c#>>'{proof,proofId}','p_idempotency_key','owned-copy-claim-choice'));
 request:=jsonb_build_object('approvalId',page#>>'{items,0,approvalId}','entitlementId',page#>>'{items,0,entitlementId}','destinationId',d->>'requestId');
 f:=public.service_reward_demo_copy_claim(u,sid,cid,'recipient','request',request::text);
 if f->'current'<>'false'::jsonb or f->'events'<>'{}'::jsonb then raise exception 'Unknown age claim not held';end if;
 if f#-'{challenge,checkedAt}' is distinct from public.service_reward_demo_copy_claim(u,sid,cid,'recipient','request',request::text)#-'{challenge,checkedAt}' then raise exception 'Held request retry changed';end if;
 rpc:=format('select public.service_reward_demo_copy_claim(%L,%L,%L,%L,',u,sid,cid,'recipient');
 perform pg_temp.must_fail(rpc||format('%L,%L)','request',(request||'{"amountWei":"102"}'::jsonb)::text),'invalid_sponsor_claim');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_claim(%L,%L,%L,%L)',u,gen_random_uuid(),cid,'recipient'),'reward_account_session_required');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_claim(%L,%L,%L,%L,%L,%L)',u,sid,cid,'operator','operator','{}'),'invalid_sponsor_claim');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_claim(%L,%L,%L,%L)',u,sid,cid,'reviewer'),'reward_demo_reviewer_required');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_claim(%L,%L,%L,%L)','7c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000101',cid,'recipient'),'reward_claim_scope_required');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_native_claim(%L,%L,%L)','did:privy:disposable_native_controller','0x'||repeat('2',40),cid),'controller_scope_required');
end $$;
reset role;
-- Disposable positive readiness only. Never imported into the hosted copy.
update public.athlete_profiles set date_of_birth='1990-01-01',birth_year=1990
 where id=(select athlete_id from app_private.reward_demo_copy_accounts where user_id='7c000000-0000-4000-8000-000000000002');
insert into app_private.reward_wallet_settings(singleton,revision,settings) values(true,1,
 '{"controller":{"wallet":"0x2222222222222222222222222222222222222222","subject":"did:privy:disposable_native_controller"}}')
 on conflict(singleton) do update set revision=excluded.revision,settings=excluded.settings;
set local role podium_execution_service_test_20261005;
do $$ declare u uuid:='7c000000-0000-4000-8000-000000000002';sid uuid:='7c000000-0000-4000-8000-000000000102';
 reviewer uuid:='7c000000-0000-4000-8000-000000000003';rsid uuid:='7c000000-0000-4000-8000-000000000103';
 cid uuid:='7c000000-0000-4000-8000-000000000701';f jsonb;b jsonb;proof jsonb;receipt jsonb;operator text:='0x'||repeat('2',40);subject text:='did:privy:disposable_native_controller';rpc text;journal jsonb;ctx jsonb;tx jsonb;src jsonb;jid uuid:='7c000000-0000-4000-8000-000000000702';
begin
 f:=public.service_reward_demo_copy_claim(reviewer,rsid,cid,'reviewer');
 if f->'current'<>'true'::jsonb then raise exception 'Disposable adult readiness not current';end if;
 b:=jsonb_build_object('sourceStamp',f->>'sourceStamp','profileFingerprint',f->>'profileFingerprint',
  'attestation',jsonb_build_object('verifiedDateOfBirth','1990-01-01'),
  'claim',jsonb_build_object('recipient',f#>>'{destination,address}','entitlementId',f->>'entitlementId','amount','101','pot','league','nonce','0','issuedAt','100','expiresAt','200','allocationDigest','0x'||repeat('e',64)),
  'witness',jsonb_build_object('finalizedBlock',jsonb_build_object('number','1','hash','0x'||repeat('f',64),'timestamp','100')));
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_claim(%L,%L,%L,%L,%L,%L)',reviewer,rsid,cid,'reviewer','intent',jsonb_set(b,'{attestation,verifiedDateOfBirth}','"1991-01-01"')::text),'invalid_sponsor_claim');
 f:=public.service_reward_demo_copy_claim(reviewer,rsid,cid,'reviewer','intent',b::text);
 if f#-'{challenge,checkedAt}' is distinct from public.service_reward_demo_copy_claim(reviewer,rsid,cid,'reviewer','intent',b::text)#-'{challenge,checkedAt}' then raise exception 'Readiness retry changed';end if;
 proof:=jsonb_build_object('protocolVersion',4,'role','operator','signer',operator,'digest','0x'||repeat('e',64),'signature','0x'||repeat('d',130));
 rpc:=format('select public.service_reward_demo_copy_native_claim(%L,%L,%L,',subject,operator,cid);
 perform pg_temp.must_fail(rpc||format('%L,%L)','operator',proof::text),'reward_recipient_consent_required');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_native_claim(%L,%L,%L)','did:privy:foreign',operator,cid),'controller_scope_required');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_claim(%L,%L,%L,%L,%L,%L)',reviewer,rsid,cid,'reviewer','operator',proof::text),'invalid_sponsor_claim');
 proof:=jsonb_set(jsonb_set(proof,'{role}','"recipient"'),'{signer}',f#>'{destination,address}');
 f:=public.service_reward_demo_copy_claim(u,sid,cid,'recipient','recipient',proof::text);
 if f#-'{challenge,checkedAt}' is distinct from public.service_reward_demo_copy_claim(u,sid,cid,'recipient','recipient',proof::text)#-'{challenge,checkedAt}' then raise exception 'Consent retry changed';end if;
 proof:=jsonb_set(jsonb_set(proof,'{role}','"operator"'),'{signer}',to_jsonb(operator));
 f:=public.service_reward_demo_copy_native_claim(subject,operator,cid,'operator',proof::text);
 if f#-'{challenge,checkedAt}' is distinct from public.service_reward_demo_copy_native_claim(subject,operator,cid,'operator',proof::text)#-'{challenge,checkedAt}' then raise exception 'Native authorization retry changed';end if;
 perform pg_temp.must_fail(rpc||format('%L,%L)','operator',jsonb_set(proof,'{signature}',to_jsonb('0x'||repeat('c',130)))::text),'reward_sponsor_claim_conflict');

 -- Synthetic SQL journal shapes only: API cryptography/chain checks are separate.
 src:=jsonb_build_object('claimId',f->'claimId','setupId',f->'setupId','approvalId',f->'approvalId','sourceStamp',f->'sourceStamp',
  'profileFingerprint',f->'profileFingerprint','packageHash',f->'packageHash','claim',f#>'{events,intent,claim}',
  'recipient',jsonb_build_object('digest',f#>'{events,recipient,digest}','signer',f#>'{events,recipient,signer}'),
  'operator',jsonb_build_object('digest',f#>'{events,operator,digest}','signer',f#>'{events,operator,signer}'));
 ctx:=jsonb_build_object('kind','claim','claimId',cid,'setupId',f->'setupId','approvalId',f->'approvalId','source',src::text);
 tx:=jsonb_build_object('chainId',10143,'to',f#>>'{package,campaignAddress}','data','0xaa','value','0','nonce','0','gas','200000','gasPrice','100000000000');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_controller_transaction(%L,%L,%L,%L,%L,%L)',subject,operator,'reserve',jid,jsonb_set(ctx,'{source}',to_jsonb('{}'::text)),tx),'controller_source_not_ready');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_controller_transaction(%L,%L,%L,%L,%L,%L)',subject,operator,'reserve',jid,jsonb_set(ctx,'{setupId}',to_jsonb('7c000000-0000-4000-8000-000000000999'::text)),tx),'controller_source_not_ready');
 journal:=public.service_reward_demo_copy_controller_transaction(subject,operator,'reserve',jid,ctx,tx);
 if journal->'confirmed'<>'false'::jsonb or journal#>>'{context,claimId}'<>cid::text then raise exception 'Exact claim reservation missing';end if;
 if journal is distinct from public.service_reward_demo_copy_controller_transaction(subject,operator,'reserve',jid,ctx,tx) then raise exception 'Exact reservation retry changed';end if;
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_controller_transaction(%L,%L,%L,%L,%L,%L)',subject,operator,'reserve','7c000000-0000-4000-8000-000000000703',ctx,tx),'controller_transaction_pending');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_controller_transaction(%L,%L,%L,%L,%L,%L,%L,%L)',subject,operator,'confirm',jid,null,null,null,'0x'||repeat('b',64)),'controller_receipt_invalid');
 journal:=public.service_reward_demo_copy_controller_transaction(subject,operator,'signed',jid,null,null,'0xaa','0x'||repeat('b',64));
 if journal->>'hash'<>'0x'||repeat('b',64) then raise exception 'Journal signature missing';end if;
 receipt:=jsonb_build_object('transactionHash','0x'||repeat('b',64),'blockNumber','2','blockHash','0x'||repeat('c',64),'amountWei','101','recipient',f#>>'{destination,address}');
 perform pg_temp.must_fail(rpc||format('%L,%L)','receipt',jsonb_set(receipt,'{amountWei}','"102"')::text),'invalid_sponsor_claim');
 f:=public.service_reward_demo_copy_native_claim(subject,operator,cid,'receipt',receipt::text);
 if f#-'{challenge,checkedAt}' is distinct from public.service_reward_demo_copy_native_claim(subject,operator,cid,'receipt',receipt::text)#-'{challenge,checkedAt}' then raise exception 'Native receipt retry changed';end if;
 if f#>>'{events,receipt,transactionHash}'<>receipt->>'transactionHash' then raise exception 'Merged native audit missing';end if;
 journal:=public.service_reward_demo_copy_controller_transaction(subject,operator,'confirm',jid,null,null,null,receipt->>'transactionHash');
 if journal->'confirmed'<>'true'::jsonb then raise exception 'Verified receipt did not confirm journal';end if;
 if journal is distinct from public.service_reward_demo_copy_controller_transaction(subject,operator,'read',jid) then raise exception 'Confirmed immutable journal disappeared';end if;
 f:=public.service_reward_demo_copy_claim_reviews(reviewer,rsid,'7c000000-0000-4000-8000-000000000602');
 if jsonb_array_length(f->'items')<>1 or f#>>'{items,0,id}'<>cid::text or f#>>'{items,0,paid}'<>'true' or f#>'{items,0}'?'userId' then raise exception 'Scoped reviewer request queue missing';end if;
 f:=public.service_reward_demo_copy_native_claims(subject,operator,'7c000000-0000-4000-8000-000000000602');
 if f#>>'{items,0,id}'<>cid::text then raise exception 'Native request queue mismatch';end if;
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_claim_reviews(%L,%L,%L)',u,sid,'7c000000-0000-4000-8000-000000000602'),'reward_demo_reviewer_required');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_native_claims(%L,%L,%L)','did:privy:foreign',operator,'7c000000-0000-4000-8000-000000000602'),'controller_scope_required');
 if jsonb_array_length(public.service_reward_demo_copy_claim_reviews(reviewer,rsid,'7c000000-0000-4000-8000-000000000602',cid)->'items')<>0 then raise exception 'Claim cursor repeated its last row';end if;
 perform pg_temp.must_fail('select * from app_private.reward_demo_copy_native_claim_events','permission denied%');
 perform pg_temp.must_fail('select * from app_private.reward_demo_copy_claim_events','permission denied%');
end $$;
reset role;
do $$begin
 if (select count(*) from app_private.reward_sponsor_claim_events_v4 where kind in('operator','receipt'))<>0
  or (select count(*) from app_private.reward_demo_copy_native_claim_events where privy_subject='did:privy:disposable_native_controller')<>2
  then raise exception 'Native authority attributed to ordinary UUID';end if;
 if has_function_privilege('authenticated','public.service_reward_demo_copy_native_claim(text,text,uuid,text,text)','execute')
  or has_function_privilege('anon','public.service_reward_demo_copy_claim(uuid,uuid,uuid,text,text,text)','execute')
  or has_function_privilege('service_role','app_private.reward_demo_copy_claim(uuid,uuid,integer,uuid,text,text,text,text,text)','execute') then raise exception 'Unbounded claim grant';end if;
end $$;
-- Synthetic private page fixture: 52 immutable approval/recipient rows, not
-- sporting-source approvals or packages. It only tests complete keyset paging.
do $$ declare old app_private.reward_sponsor_allocation_approvals_v4%rowtype; pid uuid; rid uuid;profile uuid;i integer;begin
 select * into old from app_private.reward_sponsor_allocation_approvals_v4 where id='7c000000-0000-4000-8000-000000000602';
 select athlete_id into profile from app_private.reward_demo_copy_accounts where user_id='7c000000-0000-4000-8000-000000000002';
 for i in 1..52 loop
  pid:=gen_random_uuid();rid:=gen_random_uuid();
  insert into app_private.reward_sponsor_allocation_approvals_v4(id,setup_id,launch_id,slot,context_hash,document_text,document_hash,decision,actor_user_id)
   values(pid,old.setup_id,old.launch_id,old.slot,old.context_hash,old.document_text,old.document_hash,'approved',old.actor_user_id);
  insert into app_private.reward_sponsor_recipients_v4(approval_id,beneficiary_kind,beneficiary_id,amount_wei,entitlement_id)
   values(pid,'athlete',profile,1,decode(lpad(to_hex(i),64,'0'),'hex'));
  insert into app_private.reward_sponsor_lifecycle_v4(id,approval_id,kind,body_text,body_hash,source_stamp,actor_user_id)
   values(rid,pid,'publication','{}',repeat('a',64),repeat('b',64),old.actor_user_id);
 end loop;
end $$;
set local role podium_execution_service_test_20261005;
do $$ declare page jsonb;next_page jsonb;u uuid:='7c000000-0000-4000-8000-000000000002';sid uuid:='7c000000-0000-4000-8000-000000000102';begin
 page:=public.service_reward_demo_copy_athlete_awards(u,sid);
 if jsonb_array_length(page->'items')<>50 or page->>'nextCursor' is null then raise exception 'Incomplete awards page silently truncated';end if;
 next_page:=public.service_reward_demo_copy_athlete_awards(u,sid,page->>'nextCursor');
 if jsonb_array_length(next_page->'items')<>3 or next_page->'nextCursor'<>'null'::jsonb then raise exception 'Award continuation lost rows';end if;
 if exists(select 1 from jsonb_array_elements(page->'items') a join jsonb_array_elements(next_page->'items') b on a->>'entitlementId'=b->>'entitlementId') then raise exception 'Award continuation duplicated rows';end if;
end $$;
reset role;
-- Revoking the separate intent reviewer holds payment even when the publication
-- reviewer and sporting stamp remain current.
update public.platform_administrators set is_active=false where user_id='7c000000-0000-4000-8000-000000000003';
set local role podium_execution_service_test_20261005;
do $$ declare f jsonb;begin
 f:=public.service_reward_demo_copy_claim('7c000000-0000-4000-8000-000000000002','7c000000-0000-4000-8000-000000000102','7c000000-0000-4000-8000-000000000701','recipient');
 if f->'current'<>'false'::jsonb then raise exception 'Revoked readiness authority retained';end if;
end $$;
reset role;
rollback;
select 'Copied claim native journal exact reservation/retry/nonce/source/receipt guards passed' as result;
