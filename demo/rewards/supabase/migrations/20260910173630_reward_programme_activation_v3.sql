-- Isolated demo only. Saved final publication is authority for staging, not
-- recipient consent. Existing uploaded packages, nonces and V2 clocks survive.
begin;

create function app_private.reward_programme_publication_binding_v3(p_upload uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r app_private.reward_round_reviews_v3%rowtype; f app_private.reward_round_publications_v3%rowtype;
  u app_private.reward_allocation_uploads_v3%rowtype; document jsonb;
begin
  select * into u from app_private.reward_allocation_uploads_v3 where id=p_upload;
  select a.document into document from app_private.reward_allocation_approvals_v3 a where a.id=u.approval_id;
  select * into r from app_private.reward_round_reviews_v3 where upload_id=p_upload;
  select * into f from app_private.reward_round_publications_v3 where review_id=r.id;
  if f.id is null or r.package_hash is distinct from u.package_hash or r.context_hash is distinct from u.context_hash
    or u.package->>'chainId' is distinct from '31337' or document#>>'{source,kind}' is distinct from 'synthetic_rehearsal'
    or r.review_seconds::text is distinct from u.package->>'reviewPeriod' or extract(epoch from r.started_at)<1
    or f.published_at<r.started_at+make_interval(secs=>r.review_seconds)
    then raise exception 'reward_round_publication_required'; end if;
  return jsonb_build_object('reviewId',r.id,'publicationId',f.id,'reviewPeriod',r.review_seconds::text,
    'reviewStartedAt',floor(extract(epoch from r.started_at))::bigint::text,
    'officialPublishedAt',floor(extract(epoch from f.published_at))::bigint::text,'publicationEvidenceHash',f.evidence_hash);
end $$;

-- Also guard direct service inserts and prevent a new upload after staging.
create function app_private.guard_reward_programme_activation_intent_v3()
returns trigger language plpgsql security invoker set search_path='' as $$
declare previous app_private.reward_programme_lifecycle_intents_v3%rowtype; u jsonb; publication jsonb; n integer;
begin
  if new.body->>'action'='complete_funding' then return new; end if;
  select * into previous from app_private.reward_programme_lifecycle_intents_v3 where id=new.predecessor_id;
  if new.body->>'action'='upload_awards' then
    if previous.body->>'action' not in('complete_funding','upload_awards')
      then raise exception 'invalid_reward_programme_lifecycle'; end if;
    return new;
  end if;
  if new.body->>'action' not in('stage_allocation','activate') or new.body->>'action' is null
    then raise exception 'invalid_reward_programme_lifecycle'; end if;
  select package into u from app_private.reward_allocation_uploads_v3 where id=new.upload_id;
  publication:=app_private.reward_programme_publication_binding_v3(new.upload_id);
  if new.chain_id<>31337 or new.body->'publication' is distinct from publication
    or publication->'reviewPeriod' is distinct from u->'reviewPeriod'
    or previous.programme_intent_id is distinct from new.programme_intent_id
    or previous.upload_id is distinct from new.upload_id or previous.slot is distinct from new.slot
    or new.step<>previous.step+1 or new.body->'batchStart' is distinct from 'null'::jsonb
    or new.body->'batchSize' is distinct from 'null'::jsonb
    then raise exception 'reward_round_publication_conflict'; end if;
  if not exists(select 1 from app_private.reward_programme_lifecycle_jobs_v3 j
    join app_private.reward_programme_lifecycle_receipts_v3 c on c.job_id=j.id
    where j.intent_id=previous.id and j.state='confirmed')
    then raise exception 'reward_programme_lifecycle_predecessor_required'; end if;
  n:=jsonb_array_length(u->'awards');
  if new.body->>'action'='stage_allocation' then
    if not((n=0 and previous.body->>'action'='complete_funding')
      or (previous.body->>'action'='upload_awards' and (previous.body->>'batchStart')::integer+(previous.body->>'batchSize')::integer=n))
      then raise exception 'reward_programme_lifecycle_predecessor_required'; end if;
  elsif previous.body->>'action' is distinct from 'stage_allocation' or previous.body->'publication' is distinct from publication then
    raise exception 'reward_programme_lifecycle_predecessor_required';
  end if;
  return new;
end $$;
create trigger reward_programme_activation_intent_v3_guard before insert on app_private.reward_programme_lifecycle_intents_v3
  for each row execute function app_private.guard_reward_programme_activation_intent_v3();

-- The older closure/upload reservation stays unchanged. This separate service
-- composes only the two publication-bound actions, into the same ordered ledger.
create function public.service_reserve_reward_programme_activation_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid,p_upload_id uuid,p_intent_id uuid,p_predecessor_id uuid,p_pending_nonce text,p_body jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; u jsonb; r jsonb; previous app_private.reward_programme_lifecycle_intents_v3%rowtype;
  old app_private.reward_programme_lifecycle_intents_v3%rowtype; parent uuid; signer text; next_nonce numeric; k text;
  keys text[]:=array['action','batchStart','batchSize','packageHash','gasLimit','maxFeePerGas','maxPriorityFeePerGas','maxGasCostWei','publication'];
begin
  perform app_private.lock_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  v:=public.service_read_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id,p_upload_id,p_intent_id);
  u:=v->'upload'; r:=v->'registry'; parent:=(r#>>'{registry,intentId}')::uuid; signer:=r#>>'{context,intent,operatorAddress}';
  if p_body is null or jsonb_typeof(p_body)<>'object' or not(p_body ?& keys) or p_body-keys<>'{}'::jsonb
    or p_body->>'action' is null or p_body->>'action' not in('stage_allocation','activate')
    or p_body->'packageHash' is distinct from u#>'{prepared,packageHash}'
    or p_body->'batchStart' is distinct from 'null'::jsonb or p_body->'batchSize' is distinct from 'null'::jsonb
    or p_pending_nonce is null or p_pending_nonce !~ '^(0|[1-9][0-9]{0,15})$' or p_pending_nonce::numeric>9007199254740991
    then raise exception 'invalid_reward_programme_lifecycle'; end if;
  foreach k in array keys[5:8] loop
    if jsonb_typeof(p_body->k)<>'string' or p_body->>k !~ '^(0|[1-9][0-9]{0,77})$' then raise exception 'invalid_reward_programme_lifecycle'; end if;
    perform (p_body->>k)::app_private.reward_uint256;
  end loop;
  if (p_body->>'gasLimit')::numeric not between 1 and 30000000 or (p_body->>'maxFeePerGas')::numeric=0
    or (p_body->>'maxGasCostWei')::numeric=0 or (p_body->>'maxPriorityFeePerGas')::numeric>(p_body->>'maxFeePerGas')::numeric
    or (p_body->>'gasLimit')::numeric*(p_body->>'maxFeePerGas')::numeric>(p_body->>'maxGasCostWei')::numeric
    then raise exception 'invalid_reward_programme_lifecycle'; end if;
  if p_body->'publication' is distinct from app_private.reward_programme_publication_binding_v3(p_upload_id)
    then raise exception 'reward_round_publication_conflict'; end if;
  select * into old from app_private.reward_programme_lifecycle_intents_v3 where id=p_intent_id;
  if found then
    if old.body<>p_body or old.predecessor_id is distinct from p_predecessor_id then raise exception 'reward_programme_lifecycle_conflict'; end if;
    return v; -- Exact immutable history remains inspectable after a source hold.
  end if;
  if u->'current' is distinct from 'true'::jsonb or r#>'{context,intent,current}' is distinct from 'true'::jsonb
    then raise exception 'reward_allocation_not_ready'; end if;
  select * into previous from app_private.reward_programme_lifecycle_intents_v3 where id=p_predecessor_id and programme_intent_id=parent
    and upload_id=p_upload_id and slot=p_slot and created_by_user_id=p_actor_user_id;
  if not found then raise exception 'reward_programme_lifecycle_predecessor_required'; end if;
  if exists(select 1 from app_private.reward_programme_lifecycle_intents_v3 where programme_intent_id=parent and slot=p_slot and step=previous.step+1)
    then raise exception 'reward_programme_lifecycle_conflict'; end if;
  select greatest(p_pending_nonce::numeric,coalesce(max(s.nonce)+1,0)) into next_nonce
    from app_private.reward_operator_nonce_slots s where s.chain_id=p_chain_id and s.operator_address=signer;
  if next_nonce>9007199254740991 then raise exception 'reward_deployment_nonce_exhausted'; end if;
  insert into app_private.reward_programme_lifecycle_intents_v3(id,programme_intent_id,upload_id,slot,step,predecessor_id,chain_id,operator_address,nonce,body,created_by_user_id)
    values(p_intent_id,parent,p_upload_id,p_slot,previous.step+1,p_predecessor_id,p_chain_id,signer,next_nonce,p_body,p_actor_user_id);
  v:=public.service_read_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id,p_upload_id,p_intent_id);
  if v->'upload'->'current' is distinct from 'true'::jsonb or v#>'{registry,context,intent,current}' is distinct from 'true'::jsonb
    then raise exception 'reward_allocation_not_ready'; end if;
  return v;
end $$;

-- The existing receipt checker validates transport, fees, prefix and the chain
-- worker verifies code/signatures/events/finality. Additionally bind publication
-- and the staged/active accounting to the exact original server decision.
create function app_private.guard_reward_programme_activation_receipt_v3()
returns trigger language plpgsql security invoker set search_path='' as $$
declare i app_private.reward_programme_lifecycle_intents_v3%rowtype; u jsonb; a jsonb; p jsonb; previous jsonb;
begin
  select * into strict i from app_private.reward_programme_lifecycle_intents_v3 where id=new.intent_id;
  if i.body->>'action' not in('stage_allocation','activate') then return new; end if;
  select package into u from app_private.reward_allocation_uploads_v3 where id=i.upload_id;
  a:=new.receipt->'accountingAtReceiptBlock'; p:=i.body->'publication';
  if p is distinct from app_private.reward_programme_publication_binding_v3(i.upload_id)
    or new.receipt->'publicationAtReceiptBlock' is distinct from p-array['reviewId','publicationId']
    or a->'entitlementCount' is distinct from u->'entitlementCount' or a->'uploadDigest' is distinct from u->'uploadDigest'
    or a->'snapshotDigest' is distinct from u->'snapshotDigest' or a->>'allocationDigest'='0x'||repeat('0',64)
    then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
  if i.body->>'action'='stage_allocation' then
    if (a->>'state')::integer<2 or a->'activationNotBefore' is distinct from new.receipt->'blockTimestamp'
      then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
  else
    select receipt into previous from app_private.reward_programme_lifecycle_receipts_v3 where intent_id=i.predecessor_id;
    if previous is null or (a->>'state')::integer<3
      or a->'activationNotBefore' is distinct from previous#>'{accountingAtReceiptBlock,activationNotBefore}'
      or a->'allocationDigest' is distinct from previous#>'{accountingAtReceiptBlock,allocationDigest}'
      or (a->>'claimDeadline')::numeric<(new.receipt->>'blockTimestamp')::numeric+31536000
      then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
  end if;
  return new;
end $$;
create trigger reward_programme_activation_receipt_v3_guard before insert on app_private.reward_programme_lifecycle_receipts_v3
  for each row execute function app_private.guard_reward_programme_activation_receipt_v3();

revoke all on function app_private.reward_programme_publication_binding_v3(uuid),app_private.guard_reward_programme_activation_intent_v3(),
  app_private.guard_reward_programme_activation_receipt_v3(),
  public.service_reserve_reward_programme_activation_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_programme_publication_binding_v3(uuid),app_private.guard_reward_programme_activation_intent_v3(),
  app_private.guard_reward_programme_activation_receipt_v3(),
  public.service_reserve_reward_programme_activation_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,uuid,text,jsonb) to service_role;
commit;
