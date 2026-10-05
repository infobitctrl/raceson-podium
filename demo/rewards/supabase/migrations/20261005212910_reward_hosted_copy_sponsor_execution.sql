begin;
-- A copied source pin is a separate immutable binding, never an invented
-- organizer publication or permission to approve results. Creation locks economics.
create table app_private.reward_demo_copy_launch_sources (
 launch_id uuid primary key references app_private.reward_sponsor_launches(id),
 batch_sha256 text not null references app_private.reward_demo_copy_batches(file_sha256),
 source_fingerprint text not null check(source_fingerprint ~ '^[0-9a-f]{64}$'),
 source_projection jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table app_private.reward_demo_copy_launch_sources enable row level security;
revoke all on app_private.reward_demo_copy_launch_sources from public,anon,authenticated,service_role;

create function app_private.require_reward_demo_copy_setup(p_actor_user_id uuid,p_actor_session_id uuid,p_setup_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
declare account jsonb;
begin
 account:=app_private.reward_demo_copy_session(p_actor_user_id,p_actor_session_id);
 if account->>'kind' is distinct from 'sponsor'
  or account->>'batchSha256' is distinct from '073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644' then
  raise exception 'reward_demo_sponsor_required';
 end if;
 if not exists(select 1 from app_private.reward_distribution_setups d
  join app_private.reward_demo_copy_setup_bindings b on b.setup_id=d.id
  where d.id=p_setup_id and d.owner_user_id=p_actor_user_id and d.chain_id=10143
   and d.archived_at is null and b.batch_sha256=account->>'batchSha256') then
  raise exception 'reward_setup_not_found';
 end if;
end $$;
revoke all on function app_private.require_reward_demo_copy_setup(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Bounded service adapter to existing launch/receipt/nonce journals. No arbitrary
-- RPC names, sporting writes, allocation approval or claim consent are accepted.
create function public.service_reward_demo_copy_sponsor_operation(p_actor_user_id uuid,p_actor_session_id uuid,
 p_setup_id uuid,p_operation text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare source jsonb; fingerprint text; result jsonb; v_launch_id uuid; binding app_private.reward_demo_copy_launch_sources;
begin
 perform app_private.require_reward_demo_copy_setup(p_actor_user_id,p_actor_session_id,p_setup_id);
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>250000 then
  raise exception 'invalid_sponsor_execution';
 end if;
 if p_operation='launch' then
  -- Creation owns auto-creation -> setup lock order. Only freezing adds the
  -- setup lock here; wrapping all operations would invert that order.
  perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_setup_id::text,0));
  perform app_private.require_reward_demo_copy_setup(p_actor_user_id,p_actor_session_id,p_setup_id);
  if (select count(*) from jsonb_object_keys(p_payload))<>3
   or not(p_payload ?& array['requestId','expectedRevision','sourceFingerprint']) then raise exception 'invalid_sponsor_launch'; end if;
  source:=public.operator_read_reward_five_round_copy_v1('073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644');
  fingerprint:=encode(sha256(convert_to(source::text,'UTF8')),'hex');
  if not exists(select 1 from app_private.reward_demo_copy_setup_bindings where setup_id=p_setup_id and source_fingerprint=fingerprint)
   or p_payload->>'sourceFingerprint' is distinct from fingerprint then raise exception 'copy_scope_changed'; end if;
  result:=public.service_reward_sponsor_launch(p_actor_user_id,p_actor_session_id,10143,p_setup_id,
   (p_payload->>'requestId')::uuid,(p_payload->>'expectedRevision')::integer);
  v_launch_id:=(result#>>'{launch,id}')::uuid;
  if v_launch_id is not null then
   select * into binding from app_private.reward_demo_copy_launch_sources where launch_id=v_launch_id;
   if found and (binding.source_fingerprint<>fingerprint or binding.source_projection<>source) then raise exception 'copy_scope_changed'; end if;
   insert into app_private.reward_demo_copy_launch_sources(launch_id,batch_sha256,source_fingerprint,source_projection)
    values(v_launch_id,'073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644',fingerprint,source)
    on conflict do nothing;
  end if;
 elsif p_operation='execution' then
  if (select count(*) from jsonb_object_keys(p_payload))<>3
   or not(p_payload ?& array['plan','deploymentHash','fundingHash']) then raise exception 'invalid_sponsor_execution'; end if;
  if p_payload->'plan'<>'null'::jsonb and not exists(select 1 from app_private.reward_demo_copy_launch_sources b
    join app_private.reward_sponsor_launches l on l.id=b.launch_id
    where l.id=(p_payload#>>'{plan,launchId}')::uuid and l.setup_id=p_setup_id) then raise exception 'reward_launch_sources_required'; end if;
  result:=public.service_reward_sponsor_execution(p_actor_user_id,p_actor_session_id,10143,p_setup_id,
   nullif(p_payload->'plan','null'::jsonb),p_payload->>'deploymentHash',p_payload->>'fundingHash');
 elsif p_operation='creation' then
  if (select count(*) from jsonb_object_keys(p_payload))<>7
   or not(p_payload ?& array['action','leaseId','sender','transaction','signedTransaction','hash','chainId'])
   or p_payload->'chainId' is distinct from '10143'::jsonb then raise exception 'invalid_sponsor_creation'; end if;
  if exists(select 1 from app_private.reward_sponsor_executions e where e.setup_id=p_setup_id
   and not exists(select 1 from app_private.reward_demo_copy_launch_sources b where b.launch_id=e.launch_id)) then
   raise exception 'reward_launch_sources_required';
  end if;
  result:=public.service_reward_sponsor_auto_deployment(p_actor_user_id,p_actor_session_id,p_setup_id,
   p_payload->>'action',(p_payload->>'leaseId')::uuid,p_payload->>'sender',nullif(p_payload->'transaction','null'::jsonb),
   p_payload->>'signedTransaction',p_payload->>'hash');
 elsif p_operation='availability' then
  if (select count(*) from jsonb_object_keys(p_payload))<>1 or not(p_payload ? 'sender') then raise exception 'invalid_sponsor_creation'; end if;
  result:=to_jsonb(public.service_reward_sponsor_creation_available(p_actor_user_id,p_actor_session_id,p_setup_id,p_payload->>'sender'));
 else raise exception 'invalid_sponsor_execution';
 end if;
 perform app_private.require_reward_demo_copy_setup(p_actor_user_id,p_actor_session_id,p_setup_id);
 return result;
end $$;
revoke all on function public.service_reward_demo_copy_sponsor_operation(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_sponsor_operation(uuid,uuid,uuid,text,jsonb) to service_role;

-- The platform administrator still reviews and activates distinct provider
-- wallets. Runtime reads are private server facts, never browser credentials.
create function public.service_reward_demo_copy_wallet_operation(p_operation text,p_actor_user_id uuid default null,
 p_actor_session_id uuid default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare account jsonb; result jsonb;
begin
 if not exists(select 1 from app_private.reward_demo_copy_batches where file_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644'
  and target_project_ref='niklhlmljiikwbkrmapw') then raise exception 'reward_demo_account_required'; end if;
 if p_operation='runtime' then
  if p_actor_user_id is not null or p_actor_session_id is not null or p_payload is distinct from '{}'::jsonb then raise exception 'invalid_reward_wallet_settings'; end if;
  return public.service_reward_wallet_runtime();
 end if;
 if p_operation is distinct from 'settings' or p_payload is null or jsonb_typeof(p_payload)<>'object'
  or octet_length(p_payload::text)>20000 or (select count(*) from jsonb_object_keys(p_payload))<>4
  or not(p_payload ?& array['expectedRevision','settings','reason','previousSettings']) then raise exception 'invalid_reward_wallet_settings'; end if;
 account:=app_private.reward_demo_web_session(p_actor_user_id,p_actor_session_id);
 if account->>'kind' is distinct from 'platform_admin' then raise exception 'reward_master_admin_required'; end if;
 result:=public.service_reward_wallet_settings(p_actor_user_id,p_actor_session_id,(p_payload->>'expectedRevision')::integer,
  nullif(p_payload->'settings','null'::jsonb),p_payload->>'reason',nullif(p_payload->'previousSettings','null'::jsonb));
 perform app_private.reward_demo_web_session(p_actor_user_id,p_actor_session_id);
 return result;
end $$;
revoke all on function public.service_reward_demo_copy_wallet_operation(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_wallet_operation(text,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
