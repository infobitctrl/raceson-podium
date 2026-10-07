begin;
-- Read-only server gate for new hosted campaigns. A native controller, personal
-- sponsor wallet or service-owned wallet cannot replace the assigned reviewer.
create function public.service_reward_demo_copy_reviewer_operator(p_user_id uuid,p_operator text,p_subject text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from app_private.reward_wallet_settings s
 join auth.users u on u.id=p_user_id
 join public.leagues l on l.id='ba81ced7-b2c5-4d51-95b6-d95d8c04fa36'
 where s.singleton and s.revision>0 and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
 and s.settings#>>'{controller,reviewerUserId}'=p_user_id::text
 and s.settings#>>'{controller,wallet}'=p_operator and s.settings#>>'{controller,subject}'=p_subject
 and s.settings#>>'{deployment,address}'<>p_operator
 and public.service_user_has_organization_permission(l.organization_id,p_user_id,'results.manage'));
$$;
revoke all on function public.service_reward_demo_copy_reviewer_operator(uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_reward_demo_copy_reviewer_operator(uuid,text,text) to service_role;
commit;
