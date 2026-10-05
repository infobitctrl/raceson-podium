begin;

-- Current owner may inspect immutable earned shares without a wallet/review.
-- A merge requires explicit reward mapping; it must not transfer private data.
create function public.service_list_reward_club_awards(p_user_id uuid,p_session_id uuid,p_chain_id integer,p_club_id uuid,p_after_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare identity_before jsonb; items jsonb;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in(31337,10143) or p_club_id is null then
    raise exception using errcode='22023',message='invalid_reward_club_portal_request'; end if;
  identity_before:=app_private.reward_club_owner_identity(p_club_id,p_user_id);
  if identity_before is null then raise exception using errcode='42501',message='reward_club_owner_required'; end if;
  select coalesce(jsonb_agg(body order by id),'[]'::jsonb) into items from (
    select e.id,jsonb_build_object('entitlementId',e.id,'programmeId',p.id,'campaignId',c.id,'clubId',b.entity_id,
      'clubName',left(nullif(btrim(cl.name),''),256),'scopeKey',c.scope_key,'pot',c.pot,'chainId',p.chain_id,
      'amountWei',e.amount_wei::text,'roundNumber',(r.config->>'number')::integer,
      'raceName',left(nullif(btrim(ed.name),''),256)) body
    from app_private.reward_beneficiaries b
    join app_private.reward_entitlements e on e.beneficiary_id=b.id
    join app_private.reward_campaigns c on c.id=b.campaign_id
    join app_private.reward_allocations a on a.id=e.allocation_id and a.campaign_id=c.id
    join app_private.reward_programmes p on p.id=c.programme_id and p.chain_id=p_chain_id
    join public.clubs cl on cl.id=b.entity_id
    left join lateral (select value config from jsonb_array_elements(p.configuration->'rounds') where value->>'id'=c.scope_key) r on true
    left join public.event_editions ed on ed.id=(r.config->>'eventEditionId')::uuid
    where b.kind='club' and b.entity_id=p_club_id and (p_after_id is null or e.id>p_after_id)
    order by e.id limit 26
  ) page;
  if app_private.reward_club_owner_identity(p_club_id,p_user_id) is distinct from identity_before then
    raise exception using errcode='42501',message='reward_club_owner_required'; end if;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  return jsonb_build_object('items',case when jsonb_array_length(items)>25 then items-25 else items end,
    'nextCursor',case when jsonb_array_length(items)>25 then items->24->>'entitlementId' else null end);
end $$;

-- Minimal original-nominee history, not current consent or payment authority.
create function app_private.reward_club_claim_history_item(i app_private.reward_club_claim_intents)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('intentId',i.id,'programmeId',p.id,'campaignId',c.id,'entitlementId',e.id,
    'clubId',i.club_id,'clubName',left(nullif(btrim(cl.name),''),256),'scopeKey',c.scope_key,'pot',c.pot,'chainId',p.chain_id,
    'amountWei',e.amount_wei::text,'roundNumber',(r.config->>'number')::integer,'raceName',left(nullif(btrim(ed.name),''),256),
    'recipientAddress',i.recipient_address,'issuedAt',i.issued_at::text,'expiresAt',i.expires_at::text,'preparedAt',i.prepared_at,
    'recipientConsentRecordedAt',(select pr.recorded_at from app_private.reward_club_claim_proofs pr where pr.claim_intent_id=i.id and pr.proof_role='recipient'),
    'operatorApprovalRecordedAt',(select pr.recorded_at from app_private.reward_club_claim_proofs pr where pr.claim_intent_id=i.id and pr.proof_role='operator'))
  from app_private.reward_campaigns c join app_private.reward_programmes p on p.id=c.programme_id
  join app_private.reward_entitlements e on e.id=i.entitlement_id
  join app_private.reward_beneficiaries b on b.id=e.beneficiary_id and b.campaign_id=c.id and b.kind='club' and b.entity_id=i.club_id
  left join public.clubs cl on cl.id=i.club_id
  left join lateral (select value config from jsonb_array_elements(p.configuration->'rounds') where value->>'id'=c.scope_key) r on true
  left join public.event_editions ed on ed.id=(r.config->>'eventEditionId')::uuid
  where c.id=i.campaign_id;
$$;
create function public.service_list_reward_club_claims(p_user_id uuid,p_session_id uuid,p_chain_id integer,p_after_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare items jsonb;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in(31337,10143) then raise exception using errcode='22023',message='invalid_reward_club_portal_request'; end if;
  select coalesce(jsonb_agg(body order by id),'[]'::jsonb) into items from (
    select i.id,app_private.reward_club_claim_history_item(i) body from app_private.reward_club_claim_intents i
    join app_private.reward_campaigns c on c.id=i.campaign_id
    join app_private.reward_programmes p on p.id=c.programme_id and p.chain_id=p_chain_id
    where i.recipient_user_id=p_user_id and (p_after_id is null or i.id>p_after_id) order by i.id limit 26
  ) page;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  return jsonb_build_object('items',case when jsonb_array_length(items)>25 then items-25 else items end,
    'nextCursor',case when jsonb_array_length(items)>25 then items->24->>'intentId' else null end);
end $$;

-- One statement snapshot of the worker's atomically committed evidence. Missing
-- confirmation is not unpaid. No raw proof/attempt/lease is returned to a browser.
create function public.service_read_reward_club_payment_status(p_user_id uuid,p_session_id uuid,p_chain_id integer,p_intent_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in(31337,10143) or p_intent_id is null then raise exception using errcode='22023',message='invalid_reward_club_portal_request'; end if;
  select jsonb_build_object('claim',app_private.reward_club_claim_history_item(i),
    'chainEntitlementId','0x'||encode(e.on_chain_id,'hex'),'authorizationNonce',i.nonce::text,'allocationDigest',u.upload_body->'allocationDigest',
    'status',case when jobs.confirmed then 'confirmed' when jobs.may_have_broadcast then 'submission_unconfirmed'
      when jobs.processing then 'processing' when jobs.queued then 'queued' else 'no_confirmation' end,
    'confirmation',case when f.id is null then null else jsonb_build_object('recordedAt',f.confirmed_at,
      'transactionHash','0x'||encode(j.transaction_hash,'hex'),'payment',f.payment_body,
      'deployment',d.identity_body,'observation',o.observation_body,'observedAt',o.observed_at) end) into result
  from app_private.reward_club_claim_intents i
  join app_private.reward_campaigns c on c.id=i.campaign_id
  join app_private.reward_programmes p on p.id=c.programme_id and p.chain_id=p_chain_id
  join app_private.reward_entitlements e on e.id=i.entitlement_id
  join app_private.reward_upload_packages u on u.id=i.upload_id and u.campaign_id=c.id and u.allocation_id=e.allocation_id
  left join lateral (select bool_or(state='confirmed') confirmed,bool_or(may_have_broadcast) may_have_broadcast,
    bool_or(state='leased') processing,bool_or(state='queued') queued from app_private.reward_club_payment_jobs where claim_intent_id=i.id) jobs on true
  left join app_private.reward_club_payment_confirmations f on f.entitlement_id=e.id
    and exists(select 1 from app_private.reward_club_payment_jobs own_job where own_job.id=f.job_id and own_job.claim_intent_id=i.id)
  left join app_private.reward_club_payment_jobs j on j.id=f.job_id and j.state='confirmed' and j.confirmation_observation_id=f.observation_id
  left join app_private.reward_verified_deployments d on d.campaign_id=c.id and d.chain_id=p.chain_id
  left join app_private.reward_campaign_observations o on o.id=f.observation_id and o.campaign_id=c.id
  where i.id=p_intent_id and i.recipient_user_id=p_user_id;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if result is null then raise exception using errcode='42501',message='reward_payment_status_not_found'; end if;
  if (result->>'status'='confirmed') is distinct from (result->'confirmation'<>'null'::jsonb) then
    raise exception using errcode='22023',message='invalid_reward_payment_status_document'; end if;
  return result;
end $$;
revoke all on function public.service_list_reward_club_awards(uuid,uuid,integer,uuid,uuid),
  app_private.reward_club_claim_history_item(app_private.reward_club_claim_intents),public.service_list_reward_club_claims(uuid,uuid,integer,uuid),
  public.service_read_reward_club_payment_status(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_list_reward_club_awards(uuid,uuid,integer,uuid,uuid),
  app_private.reward_club_claim_history_item(app_private.reward_club_claim_intents),public.service_list_reward_club_claims(uuid,uuid,integer,uuid),
  public.service_read_reward_club_payment_status(uuid,uuid,integer,uuid) to service_role;
commit;
