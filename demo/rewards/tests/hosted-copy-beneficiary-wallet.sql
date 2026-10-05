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
-- All SQL signatures below are synthetic transport shapes. Actual EIP191
-- signature validation is covered in the API service tests; no provider called.
set local role podium_execution_service_test_20261005;
do $$
declare u uuid:='7c000000-0000-4000-8000-000000000002'; sid uuid:='7c000000-0000-4000-8000-000000000102';
 profile uuid; c jsonb; proof jsonb; d jsonb; page jsonb; input jsonb; rpc text;
begin
 select (public.service_reward_demo_copy_account_context(u,sid)#>>'{user_profile,primary_athlete_profile_id}')::uuid into profile;
 if profile is null then raise exception 'Missing copied alias profile';end if;
 rpc:=format('select public.service_reward_demo_copy_beneficiary_wallet(%L,%L,',u,sid);
 input:=jsonb_build_object('p_chain_id',10143,'p_address','0x'||repeat('a',40),'p_origin','https://podium.raceson.com','p_idempotency_key','owned-rollback-challenge');
 c:=public.service_reward_demo_copy_beneficiary_wallet(u,sid,'challenge',input);
 if c->>'origin'<>'https://podium.raceson.com' or c->'chainId'<>'10143'::jsonb or c->>'userId'<>u::text or c->>'sessionId'<>sid::text then raise exception 'Incorrect proof context';end if;
 if c-'checkedAt'<>public.service_reward_demo_copy_beneficiary_wallet(u,sid,'challenge',input)-'checkedAt' then raise exception 'Challenge retry changed';end if;
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','challenge',jsonb_set(input,'{p_chain_id}','31337')),'invalid_reward_wallet_request');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','challenge',jsonb_set(input,'{p_origin}','"https://www.raceson.com"')),'invalid_reward_wallet_request');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','challenge',input||'{"p_amount_wei":"100"}'::jsonb),'invalid_reward_wallet_request');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','claims','{}'),'invalid_reward_wallet_request');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_beneficiary_wallet(%L,%L,%L,%L::jsonb)',u,'7c000000-0000-4000-8000-000000000101','readChallenge',jsonb_build_object('p_challenge_id',c->>'challengeId')),'reward_account_session_required');
 input:=jsonb_build_object('p_challenge_id',c->>'challengeId','p_message_hash','0x'||repeat('b',64),'p_signature','0x'||repeat('c',130));
 proof:=public.service_reward_demo_copy_beneficiary_wallet(u,sid,'proof',input);
 if proof#>>'{proof,proofId}' is null then raise exception 'Proof missing';end if;
 if proof-'checkedAt'<>public.service_reward_demo_copy_beneficiary_wallet(u,sid,'proof',input)-'checkedAt' then raise exception 'Proof retry changed';end if;
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','proof',jsonb_set(input,'{p_signature}',to_jsonb('0x'||repeat('d',130)))),'reward_ledger_idempotency_conflict');
 input:=jsonb_build_object('p_athlete_profile_id',profile,'p_proof_id',proof#>>'{proof,proofId}','p_idempotency_key','owned-rollback-destination');
 d:=public.service_reward_demo_copy_beneficiary_wallet(u,sid,'destination',input);
 if d->>'status'<>'pending_review' then raise exception 'Destination does not remain pending';end if;
 if d<>public.service_reward_demo_copy_beneficiary_wallet(u,sid,'destination',input) then raise exception 'Destination retry changed';end if;
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','destination',jsonb_set(input,'{p_athlete_profile_id}',to_jsonb('7c000000-0000-4000-8000-000000009999'::text))),'reward_destination_profile_required');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_beneficiary_wallet(%L,%L,%L,%L::jsonb)','7c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000101','destination',input),'reward_destination_profile_required');
 page:=public.service_reward_demo_copy_beneficiary_wallet(u,sid,'listDestinations','{"p_after_id":null}');
 if jsonb_array_length(page->'items')<>1 or page#>>'{items,0,requestId}'<>d->>'requestId' then raise exception 'Own destination history missing';end if;
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_beneficiary_wallet(%L,%L,%L,%L::jsonb)','7c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000101','readDestination',jsonb_build_object('p_request_id',d->>'requestId')),'reward_destination_not_found');
 perform pg_temp.must_fail('select * from app_private.reward_wallet_proofs','permission denied%');
 perform pg_temp.must_fail(format('select app_private.hosted_copy_service_read_reward_wallet_challenge(%L,%L,%L)',u,sid,c->>'challengeId'),'permission denied%');
 perform pg_temp.must_fail(format('select public.service_create_reward_wallet_challenge(%L,%L,10143,%L,%L,%L)',u,sid,'0x'||repeat('a',40),'https://podium.raceson.com','unbounded-original-call'),'permission denied%');
end $$;
reset role;
-- Transfer/merge does not expose the prior account choice to a new owner and
-- does not prevent the original account from explicitly withdrawing its choice.
update public.athlete_profiles set claimed_by_user_id='7c000000-0000-4000-8000-000000000001' where id=(select athlete_id from app_private.reward_demo_copy_accounts where user_id='7c000000-0000-4000-8000-000000000002');
insert into auth.sessions(id,user_id,not_after) values('7c000000-0000-4000-8000-000000000112','7c000000-0000-4000-8000-000000000002',now()+interval '1 hour');
set local role podium_execution_service_test_20261005;
do $$ declare u uuid:='7c000000-0000-4000-8000-000000000002';sid uuid:='7c000000-0000-4000-8000-000000000112';page jsonb;d jsonb;begin
 page:=public.service_reward_demo_copy_beneficiary_wallet(u,sid,'listDestinations','{"p_after_id":null}');
 d:=page#>'{items,0}';if d->>'status'<>'identity_hold' then raise exception 'Transferred profile not held';end if;
 d:=public.service_reward_demo_copy_beneficiary_wallet(u,sid,'withdraw',jsonb_build_object('p_request_id',d->>'requestId'));
 if d->>'status'<>'withdrawn' or d->>'sessionId'='7c000000-0000-4000-8000-000000000112' then raise exception 'Withdrawal renewed old choice';end if;
 if d<>public.service_reward_demo_copy_beneficiary_wallet(u,sid,'withdraw',jsonb_build_object('p_request_id',d->>'requestId')) then raise exception 'Withdrawal retry changed';end if;
end $$;
reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='7c000000-0000-4000-8000-000000000112';
set local role podium_execution_service_test_20261005;
select pg_temp.must_fail($q$select public.service_reward_demo_copy_beneficiary_wallet('7c000000-0000-4000-8000-000000000002','7c000000-0000-4000-8000-000000000112','listDestinations','{"p_after_id":null}')$q$,'reward_account_session_required');
reset role;
do $$begin
 if has_function_privilege('authenticated','public.service_reward_demo_copy_beneficiary_wallet(uuid,uuid,text,jsonb)','execute') or has_function_privilege('anon','public.service_reward_demo_copy_beneficiary_wallet(uuid,uuid,text,jsonb)','execute') then raise exception 'Client wallet transport exposed';end if;
 if exists(select 1 from public.athlete_profiles where date_of_birth is not null) then raise exception 'Wallet path fabricated readiness';end if;
end $$;
rollback;
