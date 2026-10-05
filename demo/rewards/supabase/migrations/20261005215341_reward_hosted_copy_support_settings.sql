begin;
-- Hosted copy predates the optional local support overlay. Install only its
-- existing policy/audit component if absent; do not expose source-review RPCs.
do $bootstrap$ begin
 if to_regclass('app_private.reward_support_changes') is null then
  execute $support_ddl$create table app_private.reward_support_changes (
 revision integer primary key check(revision>0),
 request_id uuid unique not null check(request_id<>'00000000-0000-0000-0000-000000000000'::uuid),
 expected_revision integer not null,
 settings jsonb not null,
 changed_by uuid not null references public.user_profiles(user_id),
 reason text not null check(length(reason) between 8 and 500),
 changed_at timestamptz not null default clock_timestamp()
);
alter table app_private.reward_support_changes enable row level security;
revoke all on app_private.reward_support_changes from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_support_changes to service_role;
create policy reward_support_read on app_private.reward_support_changes for select to service_role using(true);
create policy reward_support_insert on app_private.reward_support_changes for insert to service_role with check(true);
create trigger reward_support_immutable before update or delete on app_private.reward_support_changes
 for each row execute function app_private.reward_result_review_immutable_v3();

create function public.service_reward_support_settings(p_actor_user_id uuid,p_actor_session_id uuid,p_change jsonb default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare rev integer; settings jsonb; saved app_private.reward_support_changes%rowtype; rid uuid; expected integer; reason text; candidate jsonb;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 perform 1 from public.platform_administrators where user_id=p_actor_user_id and is_active and platform_role='super_admin' for share;
 if not found then raise exception 'reward_master_admin_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-support-settings',0));
 select revision,s.settings into rev,settings from app_private.reward_support_changes s order by revision desc limit 1;
 rev:=coalesce(rev,0);
 settings:=coalesce(settings,'{"gasAlertWei":null,"supportWallet":null,"supportLimitWei":"0"}'::jsonb);
 if p_change is not null then
  if jsonb_typeof(p_change) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_change))<>4
   or not(p_change ?& array['requestId','expectedRevision','settings','reason'])
   or coalesce(p_change->>'requestId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or p_change->>'requestId'='00000000-0000-0000-0000-000000000000'
   or jsonb_typeof(p_change->'expectedRevision') is distinct from 'number' or coalesce(p_change->>'expectedRevision','') !~ '^[0-9]{1,9}$'
   or jsonb_typeof(p_change->'reason') is distinct from 'string' or length(btrim(p_change->>'reason')) not between 8 and 500
  then raise exception 'invalid_reward_support_settings'; end if;
  candidate:=p_change->'settings'; rid:=(p_change->>'requestId')::uuid; expected:=(p_change->>'expectedRevision')::integer; reason:=btrim(p_change->>'reason');
  if jsonb_typeof(candidate) is distinct from 'object' or (select count(*) from jsonb_object_keys(candidate))<>3
   or not(candidate ?& array['gasAlertWei','supportWallet','supportLimitWei'])
   or not(candidate->'gasAlertWei'='null'::jsonb or jsonb_typeof(candidate->'gasAlertWei')='string' and candidate->>'gasAlertWei' ~ '^(0|[1-9][0-9]{0,24})$')
   or jsonb_typeof(candidate->'supportLimitWei') is distinct from 'string' or coalesce(candidate->>'supportLimitWei','') !~ '^(0|[1-9][0-9]{0,24})$'
   or not(candidate->'supportWallet'='null'::jsonb or jsonb_typeof(candidate->'supportWallet')='string' and candidate->>'supportWallet' ~ '^0x[0-9a-f]{40}$' and candidate->>'supportWallet'<>'0x'||repeat('0',40))
   or candidate->'supportWallet'='null'::jsonb and candidate->>'supportLimitWei'<>'0'
  then raise exception 'invalid_reward_support_settings'; end if;
  select * into saved from app_private.reward_support_changes where request_id=rid;
  if found then
   if saved.changed_by<>p_actor_user_id or saved.expected_revision<>expected or saved.settings<>candidate or saved.reason<>reason then raise exception 'reward_support_settings_conflict'; end if;
  else
   if rev<>expected then raise exception 'reward_support_settings_conflict'; end if;
   perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
   rev:=rev+1; settings:=candidate;
   insert into app_private.reward_support_changes(revision,request_id,expected_revision,settings,changed_by,reason) values(rev,rid,expected,candidate,p_actor_user_id,reason);
  end if;
 end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 return jsonb_build_object('revision',rev,'settings',settings,'history',(select coalesce(jsonb_agg(jsonb_build_object('revision',h.revision,'settings',h.settings,'changedBy',h.changed_by,'changedAt',h.changed_at,'reason',h.reason) order by h.revision desc),'[]'::jsonb) from (select * from app_private.reward_support_changes order by revision desc limit 50) h));
end $$;

$support_ddl$;
 end if;
end $bootstrap$;
revoke all on app_private.reward_support_changes from public,anon,authenticated,service_role;
revoke all on function public.service_reward_support_settings(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
-- Isolated hosted administration only. The existing CAS/audit policy remains
-- authoritative. This adapter grants no wallet, signing or transfer capability.
create function public.service_reward_demo_copy_support_settings(p_actor_user_id uuid,p_actor_session_id uuid,p_change jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare account jsonb; result jsonb;
begin
 if not exists(select 1 from app_private.reward_demo_copy_batches
  where file_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644'
   and target_project_ref='niklhlmljiikwbkrmapw') then raise exception 'reward_demo_account_required'; end if;
 account:=app_private.reward_demo_web_session(p_actor_user_id,p_actor_session_id);
 if account->>'kind' is distinct from 'platform_admin' then raise exception 'reward_master_admin_required'; end if;
 if p_change is not null and (jsonb_typeof(p_change) is distinct from 'object' or octet_length(p_change::text)>20000) then
  raise exception 'invalid_reward_support_settings';
 end if;
 result:=public.service_reward_support_settings(p_actor_user_id,p_actor_session_id,p_change);
 perform app_private.reward_demo_web_session(p_actor_user_id,p_actor_session_id);
 return result;
end $$;
revoke all on function public.service_reward_demo_copy_support_settings(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_support_settings(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
