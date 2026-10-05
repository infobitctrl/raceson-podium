begin;

-- Signed bytes are private broadcast capabilities, not browser projections.
-- Exactly one attempt per intent; replacements require a separate future policy.
create table app_private.reward_programme_attempts_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  intent_id uuid not null unique,
  chain_id integer not null,
  operator_address app_private.reward_address not null,
  nonce app_private.reward_uint256 not null,
  transaction_hash app_private.reward_bytes32 not null,
  body jsonb not null check(jsonb_typeof(body)='object'),
  recorded_by_user_id uuid not null references public.user_profiles(user_id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key(intent_id,chain_id,operator_address,nonce)
    references app_private.reward_programme_deployment_intents_v3(id,chain_id,operator_address,nonce),
  unique(chain_id,transaction_hash),
  unique(id,intent_id,transaction_hash)
);
alter table app_private.reward_programme_attempts_v3 enable row level security;
revoke all on app_private.reward_programme_attempts_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_programme_attempts_v3 to service_role;
create policy reward_programme_attempt_v3_select on app_private.reward_programme_attempts_v3 for select to service_role using(true);
create policy reward_programme_attempt_v3_insert on app_private.reward_programme_attempts_v3 for insert to service_role with check(true);
create trigger reward_programme_attempt_v3_immutable before update or delete on app_private.reward_programme_attempts_v3
  for each row execute function app_private.reject_reward_ledger_mutation();

create function public.service_read_reward_programme_attempt_v3(p_actor_user_id uuid,p_actor_session_id uuid,
  p_chain_id integer,p_draft_id uuid,p_intent_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare v jsonb; a app_private.reward_programme_attempts_v3%rowtype;
begin
  v:=public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if p_intent_id is null or v->'intent'->>'id' is distinct from p_intent_id::text
    or v->'intent'->>'createdByUserId' is distinct from p_actor_user_id::text then raise exception 'reward_programme_deployment_required'; end if;
  select * into a from app_private.reward_programme_attempts_v3 where intent_id=p_intent_id;
  -- Revalidate after any table wait; signed history remains private even when stale.
  v:=public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  return jsonb_build_object('schema','raceson-programme-attempt-v3','context',v,'attempt',case when a.id is not null then
    jsonb_build_object('id',a.id,'intentId',a.intent_id,'body',a.body,'recordedByUserId',a.recorded_by_user_id,'recordedAt',a.recorded_at) end);
end $$;

create function public.service_record_reward_programme_attempt_v3(p_actor_user_id uuid,p_actor_session_id uuid,
  p_chain_id integer,p_draft_id uuid,p_intent_id uuid,p_attempt_id uuid,p_body jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare v jsonb; i app_private.reward_programme_deployment_intents_v3%rowtype;
  a app_private.reward_programme_attempts_v3%rowtype; org uuid; k text;
  keys text[]:=array['schemaVersion','chainId','operatorAddress','nonce','contractAddress','transactionHash','signedTransaction',
    'creationCodeHash','calldataHash','gasLimit','maxFeePerGas','maxPriorityFeePerGas','maximumGasCostWei'];
begin
  v:=public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if p_intent_id is null or v->'intent'->>'id' is distinct from p_intent_id::text
    or v->'intent'->>'createdByUserId' is distinct from p_actor_user_id::text then raise exception 'reward_programme_deployment_required'; end if;
  select * into strict i from app_private.reward_programme_deployment_intents_v3 where id=p_intent_id;
  org:=(v->'approvalView'->'record'->>'organizationId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||p_chain_id::text||':'||i.operator_address,0));
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=org for share;
  perform 1 from public.organizations where id=org for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  v:=public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);

  -- SQL validates transport/scope; the trusted service verifies the signature,
  -- exact pinned constructor and keccak hashes before recording AND on reload.
  if p_attempt_id is null or p_attempt_id='00000000-0000-0000-0000-000000000000'::uuid or p_body is null
    or jsonb_typeof(p_body)<>'object' or not(p_body ?& keys) or p_body-keys<>'{}'::jsonb
    or p_body->'schemaVersion' is distinct from '3'::jsonb or p_body->'chainId' is distinct from to_jsonb(p_chain_id)
    then raise exception 'invalid_reward_programme_attempt'; end if;
  foreach k in array keys[3:13] loop
    if jsonb_typeof(p_body->k)<>'string' then raise exception 'invalid_reward_programme_attempt'; end if;
  end loop;
  foreach k in array array['nonce','gasLimit','maxFeePerGas','maxPriorityFeePerGas','maximumGasCostWei'] loop
    if p_body->>k !~ '^(0|[1-9][0-9]{0,77})$' then raise exception 'invalid_reward_programme_attempt'; end if;
    perform (p_body->>k)::app_private.reward_uint256;
  end loop;
  foreach k in array array['transactionHash','creationCodeHash','calldataHash'] loop
    if p_body->>k !~ '^0x[0-9a-f]{64}$' or p_body->>k='0x'||repeat('0',64) then raise exception 'invalid_reward_programme_attempt'; end if;
  end loop;
  if p_body->>'operatorAddress'<>i.operator_address or p_body->>'nonce'<>i.nonce::text
    or p_body->>'maximumGasCostWei'<>i.maximum_gas_cost_wei::text
    or p_body->>'creationCodeHash'<>'0x'||encode(i.creation_code_hash,'hex')
    or p_body->>'contractAddress' !~ '^0x[0-9a-f]{40}$' or p_body->>'contractAddress'='0x'||repeat('0',40)
    or length(p_body->>'signedTransaction')>131074 or p_body->>'signedTransaction' !~ '^0x02([0-9a-f]{2})+$'
    or (p_body->>'gasLimit')::numeric not between 1 and 30000000
    or (p_body->>'maxFeePerGas')::numeric=0
    or (p_body->>'maxPriorityFeePerGas')::numeric>(p_body->>'maxFeePerGas')::numeric
    or (p_body->>'gasLimit')::numeric*(p_body->>'maxFeePerGas')::numeric>i.maximum_gas_cost_wei
    then raise exception 'invalid_reward_programme_attempt'; end if;
  select * into a from app_private.reward_programme_attempts_v3 where intent_id=p_intent_id or id=p_attempt_id;
  if found then
    if a.id<>p_attempt_id or a.intent_id<>p_intent_id or a.body<>p_body or a.recorded_by_user_id<>p_actor_user_id
      then raise exception 'reward_programme_attempt_conflict'; end if;
  else
    if v->'intent'->'current' is distinct from 'true'::jsonb then raise exception 'reward_programme_approval_required'; end if;
    insert into app_private.reward_programme_attempts_v3(id,intent_id,chain_id,operator_address,nonce,transaction_hash,body,recorded_by_user_id)
      values(p_attempt_id,i.id,i.chain_id,i.operator_address,i.nonce,decode(substr(p_body->>'transactionHash',3),'hex'),p_body,p_actor_user_id) returning * into a;
    v:=public.service_read_reward_programme_deployment_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
    if v->'intent'->'current' is distinct from 'true'::jsonb then raise exception 'reward_programme_approval_required'; end if;
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,org) then raise exception 'reward_planning_not_found'; end if;
  -- No signed bytes in the recording acknowledgement.
  return jsonb_build_object('attemptId',a.id,'intentId',a.intent_id,'transactionHash','0x'||encode(a.transaction_hash,'hex'),
    'recordedByUserId',a.recorded_by_user_id,'recordedAt',a.recorded_at);
end $$;
revoke all on function public.service_read_reward_programme_attempt_v3(uuid,uuid,integer,uuid,uuid),
  public.service_record_reward_programme_attempt_v3(uuid,uuid,integer,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_read_reward_programme_attempt_v3(uuid,uuid,integer,uuid,uuid),
  public.service_record_reward_programme_attempt_v3(uuid,uuid,integer,uuid,uuid,uuid,jsonb) to service_role;
commit;
