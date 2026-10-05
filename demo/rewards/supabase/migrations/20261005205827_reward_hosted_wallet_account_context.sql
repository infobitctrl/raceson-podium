begin;
-- Hosted Podium only. Account visibility is separate from execution authority:
-- every rewards operation still checks its existing scope/role/session predicate.
create or replace function app_private.reward_demo_web_session(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor jsonb; metadata jsonb; username text;
begin
 if auth.uid() is not null and auth.uid()<>p_user_id then
  raise exception 'reward_account_session_required';
 end if;
 if not exists(select 1 from app_private.reward_demo_copy_batches
  where target_project_ref='niklhlmljiikwbkrmapw'
   and file_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644') then
  raise exception 'reward_demo_account_required';
 end if;
 if exists(select 1 from app_private.reward_demo_copy_accounts where user_id=p_user_id and active) then
  return app_private.reward_demo_copy_session(p_user_id,p_session_id);
 end if;
 actor:=public.service_request_auth_user(p_user_id,p_session_id);
 if p_user_id is null or p_session_id is null or actor is null
  or actor->>'is_anonymous' is distinct from 'false'
  or not exists(select 1 from public.user_profiles where user_id=p_user_id and status='active') then
  raise exception 'reward_account_session_required';
 end if;
 select u.raw_app_meta_data,i.username::text into metadata,username
 from auth.users u join public.account_login_identifiers i on i.user_id=u.id
 where u.id=p_user_id and u.deleted_at is null;
 -- Server-owned provisioning metadata, never browser-editable user_metadata.
 if metadata->>'podium_role_setup' is distinct from '20261005-owner-request'
  or metadata->>'trail_credential_mode' is distinct from 'username'
  or (case metadata->>'podium_requested_role'
   when 'club_representative' then username='demo.club' or username ~ '^demo\.club([1-9]|[1-3][0-9]|4[01])$'
   when 'reviewer' then username='demo.review'
   when 'platform_admin' then username='demo.master'
   else false end) is distinct from true then raise exception 'reward_demo_account_required';
 end if;
 return jsonb_build_object('userId',p_user_id,'kind',metadata->>'podium_requested_role');
end $$;
revoke all on function app_private.reward_demo_web_session(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function app_private.reward_demo_copy_account_context(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform app_private.reward_demo_web_session(p_user_id,p_session_id);
 return public.service_request_account_context(p_user_id,p_session_id);
end $$;
-- Existing service-only context wrapper remains the sole exposed entry point.
-- No sporting/account table grants and no user creation, roles or wallet consent.
notify pgrst,'reload schema';
commit;
