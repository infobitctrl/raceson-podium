-- Isolated demo only: authenticated historical execution evidence, not a send
-- command. Never return signed attempts, recipient mappings or worker leases.
begin;
create function public.service_read_reward_programme_execution_status_v3(
  p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_slot integer,p_approval_id uuid,p_upload_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare u jsonb; r jsonb; fresh jsonb; rows jsonb; package jsonb;
begin
  u:=public.service_read_reward_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if p_upload_id is null or u->'prepared'->>'id' is distinct from p_upload_id::text
    then raise exception 'reward_allocation_upload_not_found'; end if;
  r:=public.service_read_reward_programme_registry_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if r->'registry'->>'intentId' is null then raise exception 'reward_programme_not_verified'; end if;
  package:=u->'prepared'->'package';
  select coalesce(jsonb_agg(jsonb_build_object(
    'intentId',i.id,'step',i.step,'action',i.body->>'action',
    'batchStart',i.body->'batchStart','batchSize',i.body->'batchSize',
    'state',coalesce(j.state,case when a.id is null then 'reserved' else 'signed' end),
    'transactionHash',case when a.id is not null then '0x'||encode(a.transaction_hash,'hex') end,
    'receipt',case when c.job_id is not null then jsonb_build_object(
      'blockNumber',c.receipt->>'blockNumber','blockHash',c.receipt->>'blockHash',
      'blockTimestamp',c.receipt->>'blockTimestamp','feeWei',c.receipt->>'feeWei',
      'recordedAt',c.recorded_at) end) order by i.step),'[]'::jsonb) into rows
    from app_private.reward_programme_lifecycle_intents_v3 i
    left join app_private.reward_programme_lifecycle_attempts_v3 a on a.intent_id=i.id
    left join app_private.reward_programme_lifecycle_jobs_v3 j on j.intent_id=i.id
    left join app_private.reward_programme_lifecycle_receipts_v3 c on c.job_id=j.id
    where i.programme_intent_id=(r->'registry'->>'intentId')::uuid
      and i.upload_id=p_upload_id and i.slot=p_slot and i.chain_id=p_chain_id;
  -- Source readers hold organization/draft scope and recheck the actual Auth
  -- session after IO. A table wait must not return evidence after revocation.
  fresh:=public.service_read_reward_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if fresh is distinct from u then raise exception 'reward_planning_revision_changed'; end if;
  fresh:=public.service_read_reward_programme_registry_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if fresh is distinct from r then raise exception 'reward_planning_revision_changed'; end if;
  return jsonb_build_object('schema','raceson-programme-execution-status-v3',
    'chainId',p_chain_id,'draftId',p_draft_id,'slot',p_slot,'approvalId',p_approval_id,'uploadId',p_upload_id,
    'packageHash',u->'prepared'->>'packageHash','documentHash',u->>'documentHash',
    'current',coalesce((u->>'current')::boolean and (r->'context'->'intent'->>'current')::boolean,false),
    'campaignAddress',package->>'campaignAddress','entitlementCount',package->>'entitlementCount','steps',rows);
end $$;
revoke all on function public.service_read_reward_programme_execution_status_v3(uuid,uuid,integer,uuid,integer,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_read_reward_programme_execution_status_v3(uuid,uuid,integer,uuid,integer,uuid,uuid) to service_role;
commit;
