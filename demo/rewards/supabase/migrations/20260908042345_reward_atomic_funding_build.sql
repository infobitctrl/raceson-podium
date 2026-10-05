begin;

-- This is a new non-upgradeable build, not a rewrite of stored signed attempts
-- or historical deployment identity. Keep the old exact pair readable; new
-- reservations select funding-v1. Current TypeScript rejects old build contexts
-- for execution. A legacy deployment needs an explicit reviewed migration path.
alter table app_private.reward_deployment_intents
  drop constraint reward_deployment_intents_build_id_check,
  drop constraint reward_deployment_intents_creation_code_hash_check,
  add constraint reward_deployment_intents_build_pair_check check (
    (build_id = 'raceson-reward-campaign-v2-solc-0.8.36-cancun-ir-200'
      and creation_code_hash = decode('8195f9fe8d307325596d3610f12e8627c42748cc55d0755c0da9b4e47d0314b3','hex'))
    or (build_id = 'raceson-reward-campaign-v2-funding-v1-solc-0.8.36-cancun-ir-200'
      and creation_code_hash = decode('57486b6aee9c3f6cc7182982b67243919bea1e2ca05dd034501450bc6d22641e','hex'))
  );

create or replace function public.service_reserve_reward_deployment(p_campaign_id uuid,p_actor_user_id uuid,p_idempotency_key text,
  p_observed_chain_id integer,p_pending_nonce text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_campaigns%rowtype; p app_private.reward_programmes%rowtype; i app_private.reward_deployment_intents%rowtype; next_nonce numeric;
begin
  select * into c from app_private.reward_campaigns where id=p_campaign_id;
  perform app_private.require_reward_operator(c.programme_id,p_actor_user_id);
  select * into p from app_private.reward_programmes where id=c.programme_id;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or p_observed_chain_id is distinct from p.chain_id or p_pending_nonce is null or p_pending_nonce !~ '^(0|[1-9][0-9]{0,15})$'
    or p_pending_nonce::numeric>9007199254740991 then
    raise exception using errcode='22023',message='invalid_reward_deployment_request';
  end if;
  -- Preserve the existing lock order and post-lock authorization. No RPC or
  -- signing occurs in SQL. This reservation still covers DEPLOYMENTS only;
  -- funding jobs must share a global nonce book before any runner is enabled.
  perform pg_advisory_xact_lock(hashtextextended('reward-deployment-nonce:'||p.chain_id::text||':'||p.operator_address,0));
  perform id from app_private.reward_programmes where id=p.id for update;
  perform app_private.require_reward_operator(p.id,p_actor_user_id);
  select * into i from app_private.reward_deployment_intents where campaign_id=c.id;
  if found then
    if i.created_by_user_id<>p_actor_user_id or i.idempotency_key<>p_idempotency_key then
      raise exception using errcode='22023',message='reward_deployment_already_planned';
    end if;
  else
    select greatest(p_pending_nonce::numeric,coalesce(max(nonce)+1,0)) into next_nonce
      from app_private.reward_deployment_intents where chain_id=p.chain_id and operator_address=p.operator_address;
    if next_nonce>9007199254740991 then raise exception using errcode='22023',message='reward_deployment_nonce_exhausted'; end if;
    insert into app_private.reward_deployment_intents(campaign_id,chain_id,operator_address,nonce,build_id,creation_code_hash,created_by_user_id,idempotency_key)
      values(c.id,p.chain_id,p.operator_address,next_nonce,'raceson-reward-campaign-v2-funding-v1-solc-0.8.36-cancun-ir-200',
        decode('57486b6aee9c3f6cc7182982b67243919bea1e2ca05dd034501450bc6d22641e','hex'),p_actor_user_id,p_idempotency_key) returning * into i;
  end if;
  return public.service_read_reward_deployment_context(c.id,p_actor_user_id,i.id);
end $$;

revoke all on function public.service_reserve_reward_deployment(uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.service_reserve_reward_deployment(uuid,uuid,text,integer,text) to service_role;

commit;
