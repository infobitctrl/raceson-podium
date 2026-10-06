-- Owned rollback transport fixture. Synthetic proof/receipt shapes only; no Safe deployment, keys, consent or payment.
begin;
create role podium_club_fixture_20261006 nologin bypassrls;
grant service_role to podium_club_fixture_20261006;
insert into auth.users(id,email,role,aud,is_anonymous,raw_app_meta_data,raw_user_meta_data) values
('7d100000-0000-4000-8000-000000000001','disposable.club@accounts.sitrail.invalid','authenticated','authenticated',false,'{"trail_credential_mode":"username","podium_role_setup":"20261005-owner-request","podium_requested_role":"club_representative"}','{}'),
('7d100000-0000-4000-8000-000000000002','disposable.club2@accounts.sitrail.invalid','authenticated','authenticated',false,'{"trail_credential_mode":"username","podium_role_setup":"20261005-owner-request","podium_requested_role":"club_representative"}','{}');
insert into public.user_profiles(user_id,display_name,status) values ('7d100000-0000-4000-8000-000000000001','Disposable club owner','active'),('7d100000-0000-4000-8000-000000000002','Disposable nonowner','active') on conflict(user_id) do update set status='active';
insert into public.account_login_identifiers(user_id,username) values ('7d100000-0000-4000-8000-000000000001','demo.club1'),('7d100000-0000-4000-8000-000000000002','demo.club2');
insert into auth.sessions(id,user_id,not_after) values
('7d100000-0000-4000-8000-000000000101','7d100000-0000-4000-8000-000000000001',now()+interval '1 hour'),
('7d100000-0000-4000-8000-000000000102','7d100000-0000-4000-8000-000000000001',now()+interval '1 hour'),
('7d100000-0000-4000-8000-000000000103','7d100000-0000-4000-8000-000000000002',now()+interval '1 hour');
insert into public.athlete_profiles(id,slug,first_name,last_name,display_name,is_claimed,claimed_by_user_id,status)
 values('7d100000-0000-4000-8000-000000000201','disposable-club-wallet-owner','Disposable','Owner','Disposable Owner',true,'7d100000-0000-4000-8000-000000000001','active');
insert into public.club_memberships(club_id,athlete_profile_id,membership_role,status,is_primary,club_role_id)
 select c.id,'7d100000-0000-4000-8000-000000000201','owner','active',false,r.id from public.clubs c join public.club_roles r on r.club_id=c.id and r.is_owner and r.status='active' where c.name='Races Club1';
create function pg_temp.must_fail(query text,expected text) returns void language plpgsql as $$ declare failed boolean:=false;begin
 begin execute query;exception when others then if sqlerrm not like expected then raise exception 'Unexpected failure: %',sqlerrm;end if;failed:=true;end;
 if not failed then raise exception 'Expected failure missing: %',expected;end if;
end $$;
set local role podium_club_fixture_20261006;
do $$declare u uuid:='7d100000-0000-4000-8000-000000000001';s uuid:='7d100000-0000-4000-8000-000000000101';
 club uuid;c jsonb;proof jsonb;p jsonb;r jsonb;receipt jsonb;rpc text;page jsonb;
begin
 club:=(public.service_reward_demo_copy_club_wallet(u,s,'clubs','{"p_after_id":null}')#>>'{items,0,clubId}')::uuid;
 c:=public.service_reward_demo_copy_beneficiary_wallet(u,s,'challenge',jsonb_build_object('p_chain_id',10143,'p_address','0x'||repeat('a',40),'p_origin','https://podium.raceson.com','p_idempotency_key','owned-safe-creation-proof'));
 proof:=public.service_reward_demo_copy_beneficiary_wallet(u,s,'proof',jsonb_build_object('p_challenge_id',c->>'challengeId','p_message_hash','0x'||repeat('b',64),'p_signature','0x'||repeat('c',130)));
 p:=jsonb_build_object('requestId','7d100000-0000-4000-8000-000000000301','clubId',club,'proofId',proof#>>'{proof,proofId}','owners',jsonb_build_array('0x'||repeat('1',40),'0x'||repeat('2',40),'0x'||repeat('3',40)));
 rpc:=format('select public.service_reward_demo_copy_club_creation(%L,%L,',u,s);
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','request',p||'{"approved":true}'),'invalid_reward_club_creation');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','request',jsonb_set(p,'{owners,1}',p#>'{owners,0}')),'invalid_reward_club_creation');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','request',jsonb_set(p,'{clubId}',to_jsonb(gen_random_uuid()))),'reward_club_owner_required');
 r:=public.service_reward_demo_copy_club_creation(u,s,'request',p);
 if r->>'sender'<>'0x'||repeat('a',40) or r->'owners'<>p->'owners' or r->'current'<>'true'::jsonb or r->>'chainId'<>'10143'
  or r->>'saltNonce'<>'166236576222851343595710646170459046658' then raise exception 'Creation scope/salt mismatch: %',r;end if;
 if r<>public.service_reward_demo_copy_club_creation(u,'7d100000-0000-4000-8000-000000000102','request',p) then raise exception 'Retry changed';end if;
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_club_creation(%L,%L,%L,%L::jsonb)',u,'7d100000-0000-4000-8000-000000000102','request',jsonb_set(p,'{requestId}',to_jsonb('7d100000-0000-4000-8000-000000000399'::text))),'reward_wallet_challenge_expired');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','request',jsonb_set(p,'{owners,1}',to_jsonb('0x'||repeat('4',40)))),'reward_ledger_idempotency_conflict');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_club_creation(%L,%L,%L,%L::jsonb)','7d100000-0000-4000-8000-000000000002','7d100000-0000-4000-8000-000000000103','read',jsonb_build_object('requestId',r->'requestId')),'reward_club_creation_not_found');
 perform public.service_reward_demo_copy_club_creation(u,s,'authorize',jsonb_build_object('requestId',r->'requestId','proofId',proof#>>'{proof,proofId}'));
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_club_creation(%L,%L,%L,%L::jsonb)',u,'7d100000-0000-4000-8000-000000000102','authorize',jsonb_build_object('requestId',r->'requestId','proofId',proof#>>'{proof,proofId}')),'reward_destination_proof_required');
 receipt:=jsonb_build_object('transactionHash','0x'||repeat('d',64),'safeAddress','0x'||repeat('e',40),'blockNumber','100','blockHash','0x'||repeat('f',64),'initializerHash','0x'||repeat('a',64));
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','verified',jsonb_build_object('requestId',r->'requestId','body',receipt)),'invalid_reward_club_creation');
 perform public.service_reward_demo_copy_club_creation(u,s,'submitted',jsonb_build_object('requestId',r->'requestId','body',jsonb_build_object('transactionHash',receipt->'transactionHash')));
 r:=public.service_reward_demo_copy_club_creation(u,s,'verified',jsonb_build_object('requestId',r->'requestId','body',receipt));
 if r->'verified'<>receipt or jsonb_array_length(r->'transactions')<>1 then raise exception 'Receipt transport mismatch';end if;
 if r<>public.service_reward_demo_copy_club_creation(u,s,'verified',jsonb_build_object('requestId',r->'requestId','body',receipt)) then raise exception 'Receipt retry changed';end if;
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','verified',jsonb_build_object('requestId',r->'requestId','body',jsonb_set(receipt,'{safeAddress}',to_jsonb('0x'||repeat('b',40))))),'reward_ledger_idempotency_conflict');
 page:=public.service_reward_demo_copy_club_creation(u,s,'history','{"after":null}');if jsonb_array_length(page->'items')<>1 or page->'nextCursor'<>'null'::jsonb then raise exception 'History missing';end if;
 perform pg_temp.must_fail('select * from app_private.reward_demo_copy_club_creations','permission denied%');
 perform pg_temp.must_fail('select * from app_private.reward_demo_copy_club_creation_events','permission denied%');
 if has_function_privilege('anon','public.service_reward_demo_copy_club_creation(uuid,uuid,text,jsonb)','execute') or has_function_privilege('authenticated','public.service_reward_demo_copy_club_creation(uuid,uuid,text,jsonb)','execute') then raise exception 'Client creation grant';end if;
end $$;
reset role;
select set_config('podium.fixture_proof_id',proof_id::text,true) from app_private.reward_demo_copy_club_creations where id='7d100000-0000-4000-8000-000000000301';
-- Insert only rollback-owned older intent shapes to exercise stable 25-row paging.
insert into app_private.reward_demo_copy_club_creations(id,user_id,session_id,club_id,sender,owners,owner_identity,proof_id,salt_nonce,created_at)
 select ('7d100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,c.user_id,c.session_id,c.club_id,c.sender,c.owners,c.owner_identity,c.proof_id,n::text,clock_timestamp()-interval '2 hours'
 from app_private.reward_demo_copy_club_creations c cross join generate_series(302,326) n where c.id='7d100000-0000-4000-8000-000000000301';
set local role podium_club_fixture_20261006;
do $$declare first jsonb;second jsonb;begin
 first:=public.service_reward_demo_copy_club_creation('7d100000-0000-4000-8000-000000000001','7d100000-0000-4000-8000-000000000101','history','{"after":null}');
 if jsonb_array_length(first->'items')<>25 or first->>'nextCursor'<>'7d100000-0000-4000-8000-000000000325' then raise exception 'First page/cursor mismatch';end if;
 second:=public.service_reward_demo_copy_club_creation('7d100000-0000-4000-8000-000000000001','7d100000-0000-4000-8000-000000000101','history',jsonb_build_object('after',first->'nextCursor'));
 if jsonb_array_length(second->'items')<>1 or second#>>'{items,0,requestId}'<>'7d100000-0000-4000-8000-000000000326' or second->'nextCursor'<>'null'::jsonb then raise exception 'Second page/cursor mismatch';end if;
end $$;
reset role;
update public.athlete_profiles set claimed_by_user_id='7d100000-0000-4000-8000-000000000002' where id='7d100000-0000-4000-8000-000000000201';
set local role podium_club_fixture_20261006;
do $$declare r jsonb;begin
 r:=public.service_reward_demo_copy_club_creation('7d100000-0000-4000-8000-000000000001','7d100000-0000-4000-8000-000000000101','history','{"after":null}');
 if jsonb_array_length(r->'items')<>25 or r#>'{items,0,current}'<>'false'::jsonb then raise exception 'Lost-owner history/current mismatch';end if;
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_club_creation(%L,%L,%L,%L::jsonb)','7d100000-0000-4000-8000-000000000001','7d100000-0000-4000-8000-000000000101','authorize',jsonb_build_object('requestId','7d100000-0000-4000-8000-000000000301','proofId',current_setting('podium.fixture_proof_id'))),'reward_club_owner_required');
end $$;
reset role;
rollback;
select 'Copied Safe creation intent, own proof/current owner, immutable retry and receipt transport checks passed' result;
