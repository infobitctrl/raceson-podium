create function public.expect_denied(u uuid,s uuid,code text) returns void language plpgsql as $$ begin
 begin perform app_private.reward_demo_copy_account_context(u,s); exception when others then
 if sqlerrm=code then return; end if; raise; end;
 raise exception 'expected_denial_%',code;
end $$;
do $$ declare u uuid; begin
 for u in select id from auth.users where id<>'00000000-0000-0000-0000-000000000004' loop
 if app_private.reward_demo_copy_account_context(u,u)->>'userId'<>u::text then raise exception 'wrong_identity'; end if;
 end loop;
 perform public.expect_denied('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004','reward_demo_account_required');
 perform public.expect_denied('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','reward_account_session_required');
 perform public.expect_denied(null,null,'reward_account_session_required');
 perform set_config('test.uid','00000000-0000-0000-0000-000000000002',true);
 perform public.expect_denied('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','reward_account_session_required');
 perform set_config('test.uid','',true);
 update public.account_login_identifiers set username=null where user_id='00000000-0000-0000-0000-000000000001';
 perform public.expect_denied('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','reward_demo_account_required');
 update public.account_login_identifiers set username='demo.club42' where user_id='00000000-0000-0000-0000-000000000003';
 perform public.expect_denied('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003','reward_demo_account_required');
 update public.user_profiles set status='inactive' where user_id='00000000-0000-0000-0000-000000000002';
 perform public.expect_denied('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','reward_account_session_required');
 delete from app_private.reward_demo_copy_batches;
 perform public.expect_denied('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000005','reward_demo_account_required');
 if has_function_privilege('anon','app_private.reward_demo_web_session(uuid,uuid)','execute') or has_function_privilege('authenticated','app_private.reward_demo_web_session(uuid,uuid)','execute') or has_function_privilege('service_role','app_private.reward_demo_web_session(uuid,uuid)','execute') then raise exception 'private_helper_exposed'; end if;
 raise notice '14 hosted account/session boundary checks passed';
end $$;
