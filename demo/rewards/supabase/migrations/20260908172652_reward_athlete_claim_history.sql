begin;

-- Original-recipient history, not a current eligibility decision or proof of
-- payment. Never join current profile ownership to transfer another account's
-- consent history. Index reward_claim_recipient bounds each account's scan.
create function public.service_list_reward_athlete_claims(
  p_user_id uuid,p_session_id uuid,p_chain_id integer,p_after_id uuid default null
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare items jsonb;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in (10143,31337) then
    raise exception using errcode='22023',message='invalid_reward_claim_history_request';
  end if;
  select coalesce(jsonb_agg(body order by id),'[]'::jsonb) into items from (
    select i.id,jsonb_build_object(
      'intentId',i.id,'programmeId',c.programme_id,'campaignId',c.id,
      'entitlementId',e.id,'scopeKey',c.scope_key,'pot',c.pot,'chainId',p.chain_id,
      'amountWei',e.amount_wei::text,'recipientAddress',i.recipient_address,
      'issuedAt',i.issued_at::text,'expiresAt',i.expires_at::text,'preparedAt',i.prepared_at,
      'recipientConsentRecordedAt',(select pr.recorded_at from app_private.reward_athlete_claim_proofs pr
        where pr.claim_intent_id=i.id and pr.proof_role='recipient'),
      'operatorApprovalRecordedAt',(select pr.recorded_at from app_private.reward_athlete_claim_proofs pr
        where pr.claim_intent_id=i.id and pr.proof_role='operator')
    ) body
    from app_private.reward_athlete_claim_intents i
    join app_private.reward_campaigns c on c.id=i.campaign_id
    join app_private.reward_programmes p on p.id=c.programme_id and p.chain_id=p_chain_id
    join app_private.reward_entitlements e on e.id=i.entitlement_id
    join app_private.reward_beneficiaries b on b.id=e.beneficiary_id and b.campaign_id=c.id and b.kind='athlete'
    where i.recipient_user_id=p_user_id and (p_after_id is null or i.id>p_after_id)
    order by i.id limit 51
  ) page;
  -- A valid JWT alone is insufficient after sign-out or account revocation.
  -- Repeat under a fresh READ COMMITTED snapshot before returning private data.
  perform app_private.require_reward_account(p_user_id,p_session_id);
  return jsonb_build_object('items',case when jsonb_array_length(items)>50 then items-50 else items end,
    'nextCursor',case when jsonb_array_length(items)>50 then items->49->>'intentId' else null end);
end $$;
revoke all on function public.service_list_reward_athlete_claims(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_list_reward_athlete_claims(uuid,uuid,integer,uuid) to service_role;
commit;
