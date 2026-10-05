begin;

-- Private historical read for the ORIGINAL recipient of this exact claim.
-- It does not reassign receipts when profile ownership changes, borrow operator
-- authority, assert current payability, or initiate/retry a payment. All joined
-- evidence is read in one statement snapshot. Absent confirmation is NOT unpaid.
create function public.service_read_reward_athlete_payment_status(
  p_user_id uuid,p_session_id uuid,p_chain_id integer,p_intent_id uuid
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in (10143,31337) or p_intent_id is null then
    raise exception using errcode='22023',message='invalid_reward_payment_status_request';
  end if;
  select jsonb_build_object(
    'claim',jsonb_build_object('intentId',i.id,'programmeId',c.programme_id,'campaignId',c.id,
      'entitlementId',e.id,'scopeKey',c.scope_key,'pot',c.pot,'chainId',p.chain_id,
      'amountWei',e.amount_wei::text,'recipientAddress',i.recipient_address,
      'issuedAt',i.issued_at::text,'expiresAt',i.expires_at::text,'preparedAt',i.prepared_at,
      'recipientConsentRecordedAt',(select pr.recorded_at from app_private.reward_athlete_claim_proofs pr
        where pr.claim_intent_id=i.id and pr.proof_role='recipient'),
      'operatorApprovalRecordedAt',(select pr.recorded_at from app_private.reward_athlete_claim_proofs pr
        where pr.claim_intent_id=i.id and pr.proof_role='operator')),
    'chainEntitlementId','0x'||encode(e.on_chain_id,'hex'),'authorizationNonce',i.nonce::text,
    'allocationDigest',u.upload_body->'allocationDigest',
    'status',case when jobs.confirmed then 'confirmed' when jobs.may_have_broadcast then 'submission_unconfirmed'
      when jobs.processing then 'processing' when jobs.queued then 'queued' else 'no_confirmation' end,
    'confirmation',case when f.id is null then null else jsonb_build_object(
      'recordedAt',f.confirmed_at,'transactionHash','0x'||encode(j.transaction_hash,'hex'),
      'payment',f.payment_body,'deployment',d.identity_body,'observation',o.observation_body,'observedAt',o.observed_at) end
  ) into result
  from app_private.reward_athlete_claim_intents i
  join app_private.reward_campaigns c on c.id=i.campaign_id
  join app_private.reward_programmes p on p.id=c.programme_id and p.chain_id=p_chain_id
  join app_private.reward_entitlements e on e.id=i.entitlement_id
  join app_private.reward_beneficiaries b on b.id=e.beneficiary_id and b.campaign_id=c.id and b.kind='athlete'
  join app_private.reward_upload_packages u on u.id=i.upload_id and u.campaign_id=c.id and u.allocation_id=e.allocation_id
  left join lateral (
    select bool_or(state='confirmed') confirmed,bool_or(may_have_broadcast) may_have_broadcast,
      bool_or(state='leased') processing,bool_or(state='queued') queued
    from app_private.reward_athlete_payment_jobs where claim_intent_id=i.id
  ) jobs on true
  left join app_private.reward_athlete_payment_confirmations f on f.entitlement_id=e.id
    and exists(select 1 from app_private.reward_athlete_payment_jobs own_job
      where own_job.id=f.job_id and own_job.claim_intent_id=i.id)
  left join app_private.reward_athlete_payment_jobs j on j.id=f.job_id and j.state='confirmed'
    and j.confirmation_observation_id=f.observation_id
  left join app_private.reward_verified_deployments d on d.campaign_id=c.id and d.chain_id=p.chain_id
  left join app_private.reward_campaign_observations o on o.id=f.observation_id and o.campaign_id=c.id
  where i.id=p_intent_id and i.recipient_user_id=p_user_id;

  -- A session may be revoked while the SELECT waits. A stale JWT is not enough.
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if result is null then
    raise exception using errcode='42501',message='reward_payment_status_not_found';
  end if;
  if (result->>'status'='confirmed') is distinct from (result->'confirmation'<>'null'::jsonb) then
    raise exception using errcode='22023',message='invalid_reward_payment_status_document';
  end if;
  return result;
end $$;
revoke all on function public.service_read_reward_athlete_payment_status(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_read_reward_athlete_payment_status(uuid,uuid,integer,uuid) to service_role;
commit;
