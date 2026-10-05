begin;

-- A private, read-only cursor over existing durable jobs. Selection is NOT an
-- execution lease or renewed approval; each worker still reloads and fences its
-- exact attempt. Confirmed jobs leave the queue without deleting their history.
create function public.service_next_reward_operator_job(
  p_programme_id uuid,p_actor_user_id uuid,p_actor_session_id uuid,
  p_chain_id integer,p_excluded_signers text[]
)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare programme app_private.reward_programmes%rowtype; selected jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  select * into programme from app_private.reward_programmes where id=p_programme_id;
  if p_chain_id is null or p_chain_id not in (10143,31337) or programme.chain_id is distinct from p_chain_id
    or p_excluded_signers is null or cardinality(p_excluded_signers)>100
    or exists(select 1 from unnest(p_excluded_signers) a where a is null or a !~ '^0x[0-9a-f]{40}$'
      or a='0x0000000000000000000000000000000000000000')
    or (select count(distinct a) from unnest(p_excluded_signers) a)<>cardinality(p_excluded_signers) then
    raise exception using errcode='22023',message='invalid_reward_operator_queue';
  end if;
  with jobs as (
    select 'deployment'::text kind,j.id,j.campaign_id,j.intent_id,j.attempt_id,j.transaction_hash,j.state,
      i.chain_id,i.operator_address::text signer,i.nonce from app_private.reward_deployment_jobs j
      join app_private.reward_deployment_intents i on i.id=j.intent_id
    union all
    select 'funding',j.id,j.campaign_id,j.intent_id,j.attempt_id,j.transaction_hash,j.state,
      i.chain_id,i.operator_address::text,i.nonce from app_private.reward_funding_jobs j
      join app_private.reward_funding_intents i on i.id=j.intent_id
    union all
    select 'lifecycle',j.id,j.campaign_id,j.intent_id,j.attempt_id,j.transaction_hash,j.state,
      i.chain_id,i.operator_address::text,i.nonce from app_private.reward_lifecycle_jobs j
      join app_private.reward_lifecycle_intents i on i.id=j.intent_id
    union all
    select 'athlete_payment',j.id,j.campaign_id,j.payment_intent_id,j.attempt_id,j.transaction_hash,j.state,
      i.chain_id,i.relayer_address::text,i.nonce from app_private.reward_athlete_payment_jobs j
      join app_private.reward_athlete_payment_intents i on i.id=j.payment_intent_id
  )
  select jsonb_build_object('kind',j.kind,'jobId',j.id,'campaignId',j.campaign_id,'intentId',j.intent_id,
    'attemptId',j.attempt_id,'transactionHash','0x'||encode(j.transaction_hash,'hex'),
    'signerAddress',j.signer,'nonce',j.nonce::text,'state',j.state) into selected
  from jobs j join app_private.reward_campaigns c on c.id=j.campaign_id
  where c.programme_id=p_programme_id and j.chain_id=p_chain_id and j.state<>'confirmed'
    and not(j.signer=any(p_excluded_signers))
  order by j.signer,j.nonce,j.kind,j.id limit 1;
  -- A read could have waited for DDL. Recheck live identity before returning it.
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  return jsonb_build_object('schemaVersion',1,'programmeId',p_programme_id,'chainId',p_chain_id,'job',selected);
end $$;
revoke all on function public.service_next_reward_operator_job(uuid,uuid,uuid,integer,text[]) from public,anon,authenticated,service_role;
grant execute on function public.service_next_reward_operator_job(uuid,uuid,uuid,integer,text[]) to service_role;
commit;
