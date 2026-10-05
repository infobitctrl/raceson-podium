begin;
-- Fresh test identities are bindings to demo aliases, never original athletes.
create table app_private.reward_demo_copy_accounts (
 user_id uuid primary key references auth.users(id),
 batch_sha256 text not null references app_private.reward_demo_copy_batches(file_sha256),
 kind text not null check(kind in ('athlete','sponsor')),
 athlete_id uuid unique references app_private.reward_demo_copy_athletes(athlete_id),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 check((kind='athlete')=(athlete_id is not null))
);
alter table app_private.reward_demo_copy_accounts enable row level security;
revoke all on app_private.reward_demo_copy_accounts from public,anon,authenticated,service_role;

-- The server uses ordinary Auth and the existing account projection. No client
-- table access, sporting writes, bootstrap, administration or rewards execution.
grant select(user_id,username,email,username_changed_at) on public.account_login_identifiers to service_role;
grant insert on public.auth_security_events to service_role;
grant execute on function public.service_consume_public_auth_rate_limit(text,integer,integer) to service_role;

-- SECURITY DEFINER is a deliberate projection boundary: no service/client grants
-- on sporting tables or private membership maps are needed. Every call rechecks
-- the live session and the operator-provisioned demo binding before any read.
create function app_private.reward_demo_copy_session(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare binding app_private.reward_demo_copy_accounts; actor jsonb;
begin
 if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'reward_account_session_required'; end if;
 actor:=public.service_request_auth_user(p_user_id,p_session_id);
 if p_user_id is null or p_session_id is null or actor is null
  or actor->>'is_anonymous' is distinct from 'false'
  or not exists(select 1 from public.user_profiles where user_id=p_user_id and status='active')
 then raise exception 'reward_account_session_required'; end if;
 select * into binding from app_private.reward_demo_copy_accounts where user_id=p_user_id and active;
 if not found then raise exception 'reward_demo_account_required'; end if;
 return jsonb_build_object('userId',binding.user_id,'kind',binding.kind,'athleteId',binding.athlete_id,'batchSha256',binding.batch_sha256);
end $$;
create function app_private.reward_demo_copy_authenticated_preview(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare account jsonb; projection jsonb;
begin
 account:=app_private.reward_demo_copy_session(p_user_id,p_session_id);
 projection:=public.operator_read_reward_five_round_copy_v1(account->>'batchSha256');
 return jsonb_build_object('account',account,'source',projection);
end $$;
create function app_private.reward_demo_copy_account_context(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform app_private.reward_demo_copy_session(p_user_id,p_session_id);
 return public.service_request_account_context(p_user_id,p_session_id);
end $$;
create function public.service_reward_demo_copy_account_context(target_user_id uuid,target_session_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select app_private.reward_demo_copy_account_context(target_user_id,target_session_id);
$$;
create function public.service_reward_demo_copy_preview(p_actor_user_id uuid,p_actor_session_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select app_private.reward_demo_copy_authenticated_preview(p_actor_user_id,p_actor_session_id);
$$;
revoke all on function app_private.reward_demo_copy_session(uuid,uuid),
 app_private.reward_demo_copy_authenticated_preview(uuid,uuid),public.service_reward_demo_copy_preview(uuid,uuid),
 app_private.reward_demo_copy_account_context(uuid,uuid),public.service_reward_demo_copy_account_context(uuid,uuid)
 from public,anon,authenticated,service_role;
grant usage on schema app_private to service_role;
grant execute on function app_private.reward_demo_copy_authenticated_preview(uuid,uuid),
 public.service_reward_demo_copy_preview(uuid,uuid),app_private.reward_demo_copy_account_context(uuid,uuid),
 public.service_reward_demo_copy_account_context(uuid,uuid) to service_role;

-- Operator-only, idempotent binding of users created via the supported Auth API.
-- Explicitly assigns only fresh demo-alias UUIDs to fresh test accounts. This is
-- not imported source ownership, real-athlete verification or wallet consent.
create function app_private.bind_reward_demo_copy_accounts()
returns integer language plpgsql security invoker set search_path='' as $$
declare u record; athlete app_private.reward_demo_copy_athletes; v_kind text; v_username text; v_display_name text; bound integer:=0; batch text;
begin
 select file_sha256 into strict batch from app_private.reward_demo_copy_batches
 where target_project_ref='niklhlmljiikwbkrmapw';
 for u in select id,email,raw_app_meta_data from auth.users
  where raw_app_meta_data->>'podium_copy_batch'=batch and deleted_at is null loop
  v_kind:=u.raw_app_meta_data->>'podium_demo_kind';
  if u.raw_app_meta_data->>'trail_credential_mode' is distinct from 'username' then raise exception 'invalid_demo_auth_mode'; end if;
  if v_kind='athlete' then
   select * into strict athlete from app_private.reward_demo_copy_athletes
    where ordinal=(u.raw_app_meta_data->>'podium_demo_ordinal')::integer and batch_sha256=batch;
   v_username:=athlete.username;v_display_name:='Races Mon'||athlete.ordinal;
  elsif v_kind='sponsor' then
   athlete:=null;v_username:='podium.sponsor';v_display_name:='Podium Demo Sponsor';
  else raise exception 'invalid_demo_auth_kind'; end if;
  if u.email is distinct from v_username||'@accounts.sitrail.invalid' then raise exception 'invalid_demo_auth_email'; end if;
  if exists(select 1 from app_private.reward_demo_copy_accounts a where a.user_id=u.id and
   (a.batch_sha256<>batch or a.kind<>v_kind or a.athlete_id is distinct from athlete.athlete_id or not a.active))
   or exists(select 1 from public.user_profiles p where p.user_id=u.id and
    ((p.primary_athlete_profile_id is not null and p.primary_athlete_profile_id is distinct from athlete.athlete_id) or p.status<>'active'))
   or exists(select 1 from public.account_login_identifiers i where i.username=v_username and i.user_id<>u.id)
  then raise exception 'demo_account_binding_conflict'; end if;
  if v_kind='athlete' then
   if exists(select 1 from public.athlete_profiles p where p.id=athlete.athlete_id
    and (p.claimed_by_user_id is not null and p.claimed_by_user_id<>u.id))
   then raise exception 'demo_alias_already_owned'; end if;
   update public.athlete_profiles set is_claimed=true,claimed_by_user_id=u.id
    where id=athlete.athlete_id and claimed_by_user_id is null and not is_claimed;
  end if;
  insert into public.user_profiles(user_id,display_name,first_name,last_name,primary_athlete_profile_id,locale,timezone,status,preferences_json)
  values(u.id,v_display_name,case when v_kind='athlete' then 'Races' else 'Podium' end,
   case when v_kind='athlete' then 'Mon'||athlete.ordinal else 'Demo Sponsor' end,athlete.athlete_id,'en','Europe/Zagreb','active',
   jsonb_build_object('default_role',v_kind,'requested_roles',jsonb_build_array(v_kind),'workspace_roles',jsonb_build_array(v_kind)))
  on conflict(user_id) do update set display_name=excluded.display_name,first_name=excluded.first_name,last_name=excluded.last_name,
   primary_athlete_profile_id=excluded.primary_athlete_profile_id,locale=excluded.locale,timezone=excluded.timezone,preferences_json=excluded.preferences_json
  where public.user_profiles.primary_athlete_profile_id is null
   and not exists(select 1 from app_private.reward_demo_copy_accounts a where a.user_id=u.id);
  insert into public.account_login_identifiers(user_id,username,email) values(u.id,v_username,null) on conflict(user_id) do nothing;
  insert into app_private.reward_demo_copy_accounts(user_id,batch_sha256,kind,athlete_id) values(u.id,batch,v_kind,athlete.athlete_id)
   on conflict(user_id) do nothing;
  bound:=bound+1;
 end loop;
 return bound;
end $$;
revoke all on function app_private.bind_reward_demo_copy_accounts() from public,anon,authenticated,service_role;
commit;
