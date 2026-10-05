-- Isolated rewards demo only. Reuse durable jobs/nonces for exact final
-- packages, without sharing historical publication semantics or enabling claims.
begin;
alter table app_private.reward_programme_lifecycle_intents_v3
  drop constraint reward_programme_lifecycle_intents_v3_slot_check;
alter table app_private.reward_programme_lifecycle_intents_v3
  add constraint reward_programme_lifecycle_intents_v3_slot_check check(slot between 1 and 6),
  add constraint reward_final_execution_upload_only_v3 check(slot<=4 or
    (body->>'action' is not null and body->>'action' in ('complete_funding','upload_awards')));

-- Do not widen either versioned source reader. Auth, organization locks, exact
-- saved bytes and stale/history semantics remain owned by those readers.
create function app_private.read_reward_execution_upload_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare u jsonb;
begin
  if p_slot between 1 and 4 then
    u:=public.service_read_reward_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
    if u#>>'{document,schema}' is distinct from 'raceson-allocation-document-v3.1' then
      raise exception 'invalid_reward_programme_lifecycle'; end if;
  elsif p_slot in (5,6) then
    u:=public.service_read_reward_final_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
    if u#>>'{document,schema}' is distinct from 'raceson-allocation-document-v3.2' then
      raise exception 'invalid_reward_programme_lifecycle'; end if;
  else raise exception 'invalid_reward_programme_lifecycle';
  end if;
  return u;
end $$;
revoke all on function app_private.read_reward_execution_upload_v3(uuid,uuid,integer,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.read_reward_execution_upload_v3(uuid,uuid,integer,uuid,integer,uuid) to service_role;

-- Also protect direct private service inserts, not just transport decoders.
create function app_private.guard_reward_execution_source_v3()
returns trigger language plpgsql security invoker set search_path='' as $$
declare d jsonb; p jsonb; slot integer;
begin
  select a.document,u.package,a.slot into d,p,slot from app_private.reward_allocation_uploads_v3 u
    join app_private.reward_allocation_approvals_v3 a on a.id=u.approval_id where u.id=new.upload_id;
  if slot is distinct from new.slot or d->>'slot' is distinct from new.slot::text
    or d->>'schema' is distinct from (case when new.slot<=4 then 'raceson-allocation-document-v3.1' else 'raceson-allocation-document-v3.2' end)
    or p->>'enabledPot' is distinct from (case when new.slot=6 then '1' else '0' end)
    or (new.slot>=5 and (new.body->>'action' is null or new.body->>'action' not in ('complete_funding','upload_awards')))
    then raise exception 'invalid_reward_programme_lifecycle'; end if;
  return new;
end $$;
revoke all on function app_private.guard_reward_execution_source_v3() from public,anon,authenticated,service_role;
grant execute on function app_private.guard_reward_execution_source_v3() to service_role;
create trigger reward_execution_source_v3_guard before insert on app_private.reward_programme_lifecycle_intents_v3
  for each row execute function app_private.guard_reward_execution_source_v3();

create or replace function public.service_read_reward_programme_lifecycle_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid,p_upload_id uuid,p_intent_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare r jsonb; u jsonb; fresh jsonb; i app_private.reward_programme_lifecycle_intents_v3%rowtype;
  a app_private.reward_programme_lifecycle_attempts_v3%rowtype;
begin
  -- Final upload readers need the draft UPDATE lock. Acquire the established
  -- signer -> membership -> draft order before registry reads can take SHARE;
  -- two concurrent reads must not deadlock while upgrading the same draft.
  if p_slot in (5,6) then
    perform app_private.lock_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  end if;
  r:=public.service_read_reward_programme_registry_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if r->'registry'->>'intentId' is null or r->'context'->'intent'->>'createdByUserId' is distinct from p_actor_user_id::text
    then raise exception 'reward_programme_not_verified'; end if;
  u:=app_private.read_reward_execution_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if p_upload_id is null or u->'prepared'->>'id' is distinct from p_upload_id::text
    or p_intent_id is null or p_intent_id='00000000-0000-0000-0000-000000000000'::uuid
    then raise exception 'reward_allocation_upload_not_found'; end if;
  select * into i from app_private.reward_programme_lifecycle_intents_v3 where id=p_intent_id;
  if i.id is not null and (i.programme_intent_id::text<>r->'registry'->>'intentId' or i.upload_id<>p_upload_id or i.slot<>p_slot
    or i.chain_id<>p_chain_id or i.created_by_user_id<>p_actor_user_id) then raise exception 'reward_programme_lifecycle_conflict'; end if;
  select * into a from app_private.reward_programme_lifecycle_attempts_v3 where intent_id=i.id;
  fresh:=app_private.read_reward_execution_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if fresh is distinct from u then raise exception 'reward_planning_revision_changed'; end if;
  r:=public.service_read_reward_programme_registry_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  return jsonb_build_object('schema','raceson-programme-lifecycle-private-v3','registry',r,'upload',u,
    'intent',case when i.id is not null then jsonb_build_object('id',i.id,'programmeIntentId',i.programme_intent_id,'uploadId',i.upload_id,
      'slot',i.slot,'step',i.step,'predecessorId',i.predecessor_id,'chainId',i.chain_id,'operatorAddress',i.operator_address,
      'nonce',i.nonce::text,'body',i.body,'createdByUserId',i.created_by_user_id,'createdAt',i.created_at) end,
    'attempt',case when a.id is not null then jsonb_build_object('id',a.id,'intentId',a.intent_id,'body',a.body,
      'recordedByUserId',a.recorded_by_user_id,'recordedAt',a.recorded_at) end);
end $$;

create or replace function app_private.require_reward_programme_lifecycle_receipt_v3(p jsonb,v jsonb,j app_private.reward_programme_lifecycle_jobs_v3)
returns void language plpgsql security invoker set search_path='' as $$
declare i app_private.reward_programme_lifecycle_intents_v3%rowtype; signed jsonb; u jsonb; a jsonb; f jsonb; publication jsonb;
  prior jsonb; k text; count_uploaded integer; enabled_pot integer; prefix_total numeric; zero_hash text:='0x'||repeat('0',64);
  keys text[]:=array['protocolVersion','provenance','action','campaignAddress','transactionHash','nonce','blockNumber','blockHash','blockTimestamp',
    'gasUsed','effectiveGasPrice','feeWei','finalizedBlock','accountingAtReceiptBlock','publicationAtReceiptBlock'];
begin
  select * into strict i from app_private.reward_programme_lifecycle_intents_v3 where id=j.intent_id;
  select body into strict signed from app_private.reward_programme_lifecycle_attempts_v3 where id=j.attempt_id;
  u:=v->'upload'->'prepared'->'package'; a:=p->'accountingAtReceiptBlock'; f:=p->'finalizedBlock'; publication:=p->'publicationAtReceiptBlock';
  if p is null or jsonb_typeof(p)<>'object' or not(p ?& keys) or p-keys<>'{}'::jsonb or p->'protocolVersion' is distinct from '3'::jsonb
    or p->'action' is distinct from i.body->'action' or p->'campaignAddress' is distinct from u->'campaignAddress'
    or p->>'transactionHash' is distinct from '0x'||encode(j.transaction_hash,'hex') or p->>'nonce' is distinct from i.nonce::text
    or p->'provenance' is distinct from jsonb_build_object('kind','programme-child','programmeAddress',u->'programmeAddress',
      'deploymentTransactionHash',u->'deploymentTransactionHash','slot',i.slot-1)
    or jsonb_typeof(f) is distinct from 'object' or not(f ?& array['number','hash','timestamp']) or f-array['number','hash','timestamp']<>'{}'::jsonb
    or jsonb_typeof(publication) is distinct from 'object' or not(publication ?& array['reviewPeriod','reviewStartedAt','officialPublishedAt','publicationEvidenceHash'])
    or publication-array['reviewPeriod','reviewStartedAt','officialPublishedAt','publicationEvidenceHash']<>'{}'::jsonb
    then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
  foreach k in array array['nonce','blockNumber','blockTimestamp','gasUsed','effectiveGasPrice','feeWei'] loop
    if jsonb_typeof(p->k) is distinct from 'string' or p->>k !~ '^(0|[1-9][0-9]{0,77})$' then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
    perform (p->>k)::app_private.reward_uint256;
  end loop;
  foreach k in array array['number','timestamp'] loop
    if jsonb_typeof(f->k) is distinct from 'string' or f->>k !~ '^[1-9][0-9]{0,77}$' then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
    perform (f->>k)::app_private.reward_uint256;
  end loop;
  foreach k in array array['reviewPeriod','reviewStartedAt','officialPublishedAt'] loop
    if jsonb_typeof(publication->k) is distinct from 'string' or publication->>k !~ '^(0|[1-9][0-9]{0,19})$'
      or (publication->>k)::numeric>18446744073709551615 then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
  end loop;
  if jsonb_typeof(p->'blockHash') is distinct from 'string' or p->>'blockHash' !~ '^0x[0-9a-f]{64}$' or p->>'blockHash'=zero_hash
    or jsonb_typeof(f->'hash') is distinct from 'string' or f->>'hash' !~ '^0x[0-9a-f]{64}$' or f->>'hash'=zero_hash
    or jsonb_typeof(publication->'publicationEvidenceHash') is distinct from 'string' or publication->>'publicationEvidenceHash' !~ '^0x[0-9a-f]{64}$'
    or publication->'reviewPeriod' is distinct from u->'reviewPeriod'
    or (p->>'gasUsed')::numeric=0 or (p->>'effectiveGasPrice')::numeric=0
    or (p->>'gasUsed')::numeric>(signed->>'gasLimit')::numeric or (p->>'effectiveGasPrice')::numeric>(signed->>'maxFeePerGas')::numeric
    or (p->>'feeWei')::numeric<>(p->>'gasUsed')::numeric*(p->>'effectiveGasPrice')::numeric
    or (p->>'feeWei')::numeric>(i.body->>'maxGasCostWei')::numeric
    or (p->>'blockNumber')::numeric<(v#>>'{registry,registry,provenance,deploymentBlockNumber}')::numeric
    or (p->>'blockNumber')::numeric>(f->>'number')::numeric or (p->>'blockTimestamp')::numeric=0
    or (p->>'blockTimestamp')::numeric>(f->>'timestamp')::numeric
    or ((p->>'blockNumber')::numeric=(f->>'number')::numeric and (p->>'blockHash'<>f->>'hash' or p->>'blockTimestamp'<>f->>'timestamp'))
    then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
  if i.predecessor_id is not null then
    select r.receipt into prior from app_private.reward_programme_lifecycle_receipts_v3 r
      join app_private.reward_programme_lifecycle_jobs_v3 previous on previous.id=r.job_id
      where r.intent_id=i.predecessor_id and previous.state='confirmed';
    if prior is null then raise exception 'reward_programme_lifecycle_predecessor_required'; end if;
    if (p->>'blockNumber')::numeric<(prior->>'blockNumber')::numeric or (p->>'blockTimestamp')::numeric<(prior->>'blockTimestamp')::numeric
      or (p->>'blockNumber'=prior->>'blockNumber' and p->>'blockHash'<>prior->>'blockHash') then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
  end if;
  enabled_pot:=case when i.slot=6 then 1 else 0 end;
  if u->>'enabledPot' is distinct from enabled_pot::text then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
  perform app_private.require_reward_campaign_accounting(a,enabled_pot);
  if a->>'state'='0' or a->'accountedFunding' is distinct from u->'budgetWei' or a->'budgets'->enabled_pot is distinct from u->'budgetWei'
    or (a->>'entitlementCount')::numeric>jsonb_array_length(u->'awards') then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
  count_uploaded:=(a->>'entitlementCount')::integer;
  select coalesce(sum((award->>'amount')::numeric),0) into prefix_total from jsonb_array_elements(u->'awards') with ordinality x(award,n) where n<=count_uploaded;
  if (a->'allocated'->>enabled_pot)::numeric<>prefix_total or (count_uploaded=jsonb_array_length(u->'awards') and a->'uploadDigest' is distinct from u->'uploadDigest')
    or (i.body->>'action'='upload_awards' and count_uploaded<(i.body->>'batchStart')::integer+(i.body->>'batchSize')::integer)
    or (a->>'snapshotDigest'<>zero_hash and a->'snapshotDigest' is distinct from u->'snapshotDigest')
    or (a->>'activationNotBefore'='0' and (publication->>'reviewStartedAt'<>'0' or publication->>'officialPublishedAt'<>'0' or publication->>'publicationEvidenceHash'<>zero_hash))
    or (a->>'activationNotBefore'<>'0' and ((publication->>'reviewStartedAt')::numeric=0 or publication->>'publicationEvidenceHash'=zero_hash
      or (publication->>'officialPublishedAt')::numeric<(publication->>'reviewStartedAt')::numeric+(publication->>'reviewPeriod')::numeric
      or (publication->>'officialPublishedAt')::numeric>(a->>'activationNotBefore')::numeric))
    then raise exception 'invalid_reward_programme_lifecycle_receipt'; end if;
end $$;

create or replace function public.service_read_reward_programme_execution_status_v3(
  p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_slot integer,p_approval_id uuid,p_upload_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare u jsonb; r jsonb; fresh jsonb; rows jsonb; package jsonb;
begin
  u:=app_private.read_reward_execution_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
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
  fresh:=app_private.read_reward_execution_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if fresh is distinct from u then raise exception 'reward_planning_revision_changed'; end if;
  fresh:=public.service_read_reward_programme_registry_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if fresh is distinct from r then raise exception 'reward_planning_revision_changed'; end if;
  return jsonb_build_object('schema','raceson-programme-execution-status-v3',
    'chainId',p_chain_id,'draftId',p_draft_id,'slot',p_slot,'approvalId',p_approval_id,'uploadId',p_upload_id,
    'packageHash',u->'prepared'->>'packageHash','documentHash',u->>'documentHash',
    'current',coalesce((u->>'current')::boolean and (r->'context'->'intent'->>'current')::boolean,false),
    'campaignAddress',package->>'campaignAddress','entitlementCount',package->>'entitlementCount','steps',rows);
end $$;

commit;
