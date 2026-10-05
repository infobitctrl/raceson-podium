create schema auth;
create schema app_private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create table auth.users(id uuid primary key,raw_app_meta_data jsonb,raw_user_meta_data jsonb,deleted_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid);
create table public.user_profiles(user_id uuid,status text);
create table public.account_login_identifiers(user_id uuid,username text);
create table app_private.reward_demo_copy_batches(target_project_ref text,file_sha256 text);
create table app_private.reward_demo_copy_accounts(user_id uuid,active boolean);
create function public.service_request_auth_user(u uuid,s uuid) returns jsonb language sql stable as $$
 select jsonb_build_object('is_anonymous',false) from auth.sessions where id=s and user_id=u
$$;
create function app_private.reward_demo_copy_session(u uuid,s uuid) returns jsonb language plpgsql stable as $$ begin
 if public.service_request_auth_user(u,s) is null then raise exception 'reward_account_session_required'; end if;
 return jsonb_build_object('userId',u,'kind','athlete'); end $$;
create function public.service_request_account_context(u uuid,s uuid) returns jsonb language sql stable as $$
 select jsonb_build_object('userId',u,'sessionId',s) where public.service_request_auth_user(u,s) is not null
$$;
insert into app_private.reward_demo_copy_batches values('niklhlmljiikwbkrmapw','073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644');
insert into auth.users values
 ('00000000-0000-0000-0000-000000000001','{"podium_role_setup":"20261005-owner-request","trail_credential_mode":"username","podium_requested_role":"reviewer"}','{}',null),
 ('00000000-0000-0000-0000-000000000002','{"podium_role_setup":"20261005-owner-request","trail_credential_mode":"username","podium_requested_role":"platform_admin"}','{}',null),
 ('00000000-0000-0000-0000-000000000003','{"podium_role_setup":"20261005-owner-request","trail_credential_mode":"username","podium_requested_role":"club_representative"}','{}',null),
 ('00000000-0000-0000-0000-000000000004','{}','{"podium_role_setup":"20261005-owner-request","trail_credential_mode":"username","podium_requested_role":"reviewer"}',null),
 ('00000000-0000-0000-0000-000000000005','{}','{}',null);
insert into auth.sessions select id,id from auth.users;
insert into public.user_profiles select id,'active' from auth.users;
insert into public.account_login_identifiers values
 ('00000000-0000-0000-0000-000000000001','demo.review'),
 ('00000000-0000-0000-0000-000000000002','demo.master'),
 ('00000000-0000-0000-0000-000000000003','demo.club41'),
 ('00000000-0000-0000-0000-000000000004','demo.review');
insert into app_private.reward_demo_copy_accounts values('00000000-0000-0000-0000-000000000005',true);
