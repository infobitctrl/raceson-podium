-- Owned rollback fixture. No Safe deployment, keys, consent or payment.
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
do $$ declare u uuid:='7d100000-0000-4000-8000-000000000001';s uuid:='7d100000-0000-4000-8000-000000000101';
 v jsonb; club uuid; p jsonb; saved jsonb; changed jsonb;rpc text;
begin
 v:=public.service_reward_demo_copy_club_wallet(u,s,'clubs','{"p_after_id":null}');
 if jsonb_array_length(v->'items')<>1 or v->>'chainId'<>'10143' or v#>>'{items,0,name}'<>'Races Club1' then raise exception 'Ownership missing';end if;
 club:=(v#>>'{items,0,clubId}')::uuid;
 p:=jsonb_build_object('p_club_id',club,'p_idempotency_key','owned-disposable-club-choice',
 'p_candidate',jsonb_build_object('safeAddress','0x'||repeat('4',40),'singletonAddress','0x'||repeat('5',40),'fallbackHandlerAddress','0x'||repeat('6',40),
 'owners',jsonb_build_array('0x'||repeat('1',40),'0x'||repeat('2',40),'0x'||repeat('3',40))));
 rpc:=format('select public.service_reward_demo_copy_club_wallet(%L,%L,',u,s);
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','nominate',p||'{"approved":true}'::jsonb),'invalid_reward_club_treasury_request');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','nominate',jsonb_set(p,'{p_club_id}',to_jsonb(gen_random_uuid()))),'reward_club_owner_required');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_club_wallet(%L,%L,%L,%L::jsonb)',u,gen_random_uuid(),'clubs','{"p_after_id":null}'),'reward_account_session_required');
 saved:=public.service_reward_demo_copy_club_wallet(u,s,'nominate',p);
 if saved->>'status'<>'pending_review' or saved->'candidate'<>p->'p_candidate' then raise exception 'Nomination mismatch';end if;
 if saved<>public.service_reward_demo_copy_club_wallet(u,'7d100000-0000-4000-8000-000000000102','nominate',p) then raise exception 'New-session retry mismatch';end if;
 changed:=jsonb_set(p,'{p_candidate,safeAddress}',to_jsonb('0x'||repeat('7',40)));
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','nominate',changed),'reward_ledger_idempotency_conflict');
 perform pg_temp.must_fail(rpc||format('%L,%L::jsonb)','nominate',jsonb_set(p,'{p_idempotency_key}','"second-choice"')),'reward_club_treasury_withdraw_first');
 p:=jsonb_build_object('p_request_id',saved->'requestId');
 if saved<>public.service_reward_demo_copy_club_wallet(u,s,'read',p) then raise exception 'Read mismatch';end if;
 if jsonb_array_length(public.service_reward_demo_copy_club_wallet(u,s,'history','{"p_after_id":null}')->'items')<>1 then raise exception 'History missing';end if;
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_club_wallet(%L,%L,%L,%L::jsonb)','7d100000-0000-4000-8000-000000000002','7d100000-0000-4000-8000-000000000103','read',p),'reward_club_treasury_not_found');
 if public.service_reward_demo_copy_club_wallet(u,s,'withdraw',p)->>'status'<>'withdrawn' then raise exception 'Withdrawal missing';end if;
 if public.service_reward_demo_copy_club_wallet(u,s,'withdraw',p)<>public.service_reward_demo_copy_club_wallet(u,s,'withdraw',p) then raise exception 'Withdrawal retry';end if;
 perform pg_temp.must_fail('select * from app_private.reward_club_treasury_requests','permission denied%');
 perform pg_temp.must_fail(format('select public.service_list_reward_owned_clubs(%L,%L,10143)',u,s),'permission denied%');
 if has_function_privilege('anon','public.service_reward_demo_copy_club_wallet(uuid,uuid,text,jsonb)','execute') or has_function_privilege('authenticated','public.service_reward_demo_copy_club_wallet(uuid,uuid,text,jsonb)','execute') then raise exception 'Client club grant';end if;
end $$;
reset role;
update public.athlete_profiles set claimed_by_user_id='7d100000-0000-4000-8000-000000000002' where id='7d100000-0000-4000-8000-000000000201';
set local role podium_club_fixture_20261006;
do $$ declare v jsonb;begin
 if jsonb_array_length(public.service_reward_demo_copy_club_wallet('7d100000-0000-4000-8000-000000000001','7d100000-0000-4000-8000-000000000101','clubs','{"p_after_id":null}')->'items')<>0 then raise exception 'Lost ownership retained';end if;
 v:=public.service_reward_demo_copy_club_wallet('7d100000-0000-4000-8000-000000000001','7d100000-0000-4000-8000-000000000101','history','{"p_after_id":null}');
 if jsonb_array_length(v->'items')<>1 then raise exception 'Own historical nomination lost';end if;
end $$;
reset role;
rollback;
select 'Copied club nomination scope, immutable retry, ownership and withdrawal passed' result;
