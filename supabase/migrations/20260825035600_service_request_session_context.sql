begin;

create or replace function public.service_request_auth_user(
  target_user_id uuid,
  target_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'email', auth_user.email,
    'email_confirmed_at', auth_user.email_confirmed_at,
    'raw_app_meta_data', auth_user.raw_app_meta_data,
    'raw_user_meta_data', auth_user.raw_user_meta_data
  )
  from auth.users auth_user
  join auth.sessions auth_session
    on auth_session.user_id = auth_user.id
   and auth_session.id = target_session_id
  where auth_user.id = target_user_id
    and auth_user.deleted_at is null
    and (
      auth_user.banned_until is null
      or auth_user.banned_until <= now()
    )
    and (
      auth_session.not_after is null
      or auth_session.not_after > now()
    )
  limit 1;
$$;

revoke all on function public.service_request_auth_user(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.service_request_account_context(
  target_user_id uuid,
  target_session_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with auth_user as materialized (
    select public.service_request_auth_user(
      target_user_id,
      target_session_id
    ) as value
  ),
  account_context as materialized (
    select public.service_request_account_context(target_user_id) as value
  )
  select account_context.value || jsonb_build_object(
    'auth_user', auth_user.value
  )
  from auth_user
  cross join account_context
  where auth_user.value is not null;
$$;

revoke all on function public.service_request_account_context(uuid, uuid)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.service_request_auth_user(uuid, uuid)
      to service_role;
    grant execute on function public.service_request_account_context(uuid, uuid)
      to service_role;
  end if;
end;
$$;

commit;
