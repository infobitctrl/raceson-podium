-- Isolated demo only: current club-owner discovery, never execution authority.
begin;
create index reward_club_allocations_v3_discovery
  on app_private.reward_allocation_recipients_v3(source_beneficiary_id,entitlement_id) where beneficiary_kind='club';

create function public.service_list_reward_club_allocations_v3(
  p_user_id uuid,p_session_id uuid,p_chain_id integer,p_club_id uuid,p_after_id text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare owner_before jsonb; result jsonb;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in(31337,10143) or p_club_id is null
    or (p_after_id is not null and p_after_id!~'^0x[0-9a-f]{64}$') then raise exception 'invalid_reward_club_allocation_query'; end if;
  -- No source/claim execution locks: this read never establishes readiness.
  -- Match nomination's identity lock order, and recheck Auth after all waits.
  perform 1 from public.user_profiles where user_id=p_user_id for share;
  perform 1 from public.clubs where id=p_club_id for share;
  perform 1 from public.athlete_profiles where claimed_by_user_id=p_user_id order by id for share;
  perform 1 from public.club_memberships where club_id=p_club_id order by id for share;
  perform 1 from public.club_roles where club_id=p_club_id order by id for share;
  owner_before:=app_private.reward_club_owner_identity(p_club_id,p_user_id);
  if owner_before is null then raise exception using errcode='42501',message='reward_club_owner_required'; end if;
  with selected as (
    select r.*,a.draft_id,a.slot,a.document,a.approved_at,a.sequence,u.id upload_id,
      not exists(select 1 from app_private.reward_allocation_approvals_v3 newer
        where newer.draft_id=a.draft_id and newer.slot=a.slot and newer.sequence>a.sequence) latest_revision
    from app_private.reward_allocation_recipients_v3 r
    join app_private.reward_allocation_approvals_v3 a on a.id=r.approval_id
    left join app_private.reward_allocation_uploads_v3 u on u.approval_id=a.id
    where r.beneficiary_kind='club' and r.source_beneficiary_id=p_club_id
      and ((a.slot between 1 and 4 and a.document->>'schema'='raceson-allocation-document-v3.1')
        or (a.slot in(5,6) and a.document->>'schema'='raceson-allocation-document-v3.2'))
      and (a.document#>>'{record,chainId}')::integer=p_chain_id
      and (p_after_id is null or r.entitlement_id>decode(substr(p_after_id,3),'hex'))
    order by r.entitlement_id limit 51
  ), page as (select * from selected order by entitlement_id limit 50), items as (
    select p.entitlement_id,jsonb_build_object(
      'entitlementId','0x'||encode(p.entitlement_id,'hex'),'approvalId',p.approval_id,'draftId',p.draft_id,'slot',p.slot,
      'sourceKind',case when p.slot=5 then 'native_finale' when p.slot=6 then 'final_league' else p.document#>>'{source,kind}' end,
      'amountWei',p.amount_wei::text,'campaignAddress',p.document#>>'{binding,campaignAddress}',
      'recordedAt',to_char(p.approved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'allocationRevision',case when p.latest_revision then 'latest' else 'superseded' end,'uploadId',p.upload_id,
      'claimAccess',case when c.id is null then 'not_prepared' when c.recipient_user_id=p_user_id then 'available' else 'organizer_required' end,
      'claim',case when c.recipient_user_id=p_user_id then jsonb_build_object('claimId',c.id,'requestId',c.request_id,
        'recipientAddress',c.recipient_address,
        'recipientConsented',exists(select 1 from app_private.reward_club_claim_proofs_v3 pr where pr.claim_id=c.id and pr.role='recipient'),
        'operatorApproved',exists(select 1 from app_private.reward_club_claim_proofs_v3 pr where pr.claim_id=c.id and pr.role='operator')) end,
      'payment',case when payment.id is not null or receipt.job_id is not null then jsonb_build_object(
        'state',case when receipt.job_id is not null then 'confirmed' else coalesce(job.state,case when attempt.id is not null then 'signed' else 'prepared' end) end,
        'recipientAddress',coalesce(paid_claim.recipient_address,c.recipient_address),
        'transactionHash',case when receipt.job_id is not null then '0x'||encode(receipt.transaction_hash,'hex')
          when attempt.id is not null then '0x'||encode(attempt.transaction_hash,'hex') end,
        'confirmed',receipt.job_id is not null,'blockNumber',receipt.body#>'{payment,blockNumber}','blockHash',receipt.body#>'{payment,blockHash}') end) body
    from page p
    left join lateral (select c.* from app_private.reward_club_claims_v3 c where c.entitlement_id=p.entitlement_id
      and c.upload_id=p.upload_id and c.chain_id=p_chain_id and c.campaign_address=p.document#>>'{binding,campaignAddress}'
      order by c.sequence desc limit 1) c on true
    left join app_private.reward_club_payments_v3 payment on payment.claim_id=c.id and payment.chain_id=p_chain_id
    left join app_private.reward_club_payment_attempts_v3 attempt on attempt.payment_id=payment.id
    left join app_private.reward_club_payment_jobs_v3 job on job.payment_id=payment.id
    left join app_private.reward_club_payment_receipts_v3 receipt on receipt.entitlement_id=p.entitlement_id
      and receipt.chain_id=p_chain_id and receipt.campaign_address=p.document#>>'{binding,campaignAddress}'
    left join app_private.reward_club_payments_v3 paid_payment on paid_payment.id=receipt.payment_id
    left join app_private.reward_club_claims_v3 paid_claim on paid_claim.id=paid_payment.claim_id
  ) select jsonb_build_object('schema','raceson-club-allocations-v3','chainId',p_chain_id,'clubId',p_club_id,
    'items',coalesce((select jsonb_agg(body order by entitlement_id) from items),'[]'::jsonb),
    'nextCursor',case when (select count(*) from selected)>50 then
      (select '0x'||encode(entitlement_id,'hex') from page order by entitlement_id desc limit 1) end) into result;
  if app_private.reward_club_owner_identity(p_club_id,p_user_id) is distinct from owner_before then
    raise exception using errcode='42501',message='reward_club_owner_required'; end if;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  return result;
end $$;
revoke all on function public.service_list_reward_club_allocations_v3(uuid,uuid,integer,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_list_reward_club_allocations_v3(uuid,uuid,integer,uuid,text) to service_role;
comment on function public.service_list_reward_club_allocations_v3(uuid,uuid,integer,uuid,text) is
  'Isolated demo: current club-owner allocation/receipt discovery only; no source readiness, consent renewal or execution capability.';
commit;
