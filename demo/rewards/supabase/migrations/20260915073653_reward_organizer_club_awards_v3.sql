-- Isolated demo only. Discovery never establishes readiness or payout authority.
begin;
create function public.service_list_reward_organizer_club_awards_v3(
  p_user_id uuid,p_session_id uuid,p_chain_id integer,p_upload_id uuid,p_after_id text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare a app_private.reward_allocation_approvals_v3%rowtype;
  d app_private.reward_planning_drafts%rowtype;
  i app_private.reward_programme_deployment_intents_v3%rowtype;
  result jsonb;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in(31337,10143) or p_upload_id is null
    or (p_after_id is not null and p_after_id!~'^0x[0-9a-f]{64}$') then raise exception 'invalid_reward_organizer_club_query'; end if;
  select ap.* into a from app_private.reward_allocation_approvals_v3 ap
    join app_private.reward_allocation_uploads_v3 u on u.approval_id=ap.id where u.id=p_upload_id;
  select * into d from app_private.reward_planning_drafts where id=a.draft_id;
  select * into i from app_private.reward_programme_deployment_intents_v3 where draft_id=d.id;
  if d.id is null or i.id is null or d.chain_id is distinct from p_chain_id
    or p_user_id is distinct from i.created_by_user_id
    or not app_private.reward_planning_authorized(p_user_id,d.organization_id)
    then raise exception 'reward_club_readiness_scope_required'; end if;
  -- Same organizer lock order as V3 readiness. No nomination/chain/source
  -- execution locks: each selected action must acquire and recheck its own.
  perform 1 from public.organization_memberships where organization_id=d.organization_id and user_id=p_user_id for share;
  perform 1 from public.organizations where id=d.organization_id for share;
  perform 1 from app_private.reward_planning_drafts where id=d.id for share;
  with selected as (
    select r.* from app_private.reward_allocation_recipients_v3 r
    where r.approval_id=a.id and r.beneficiary_kind='club'
      and (p_after_id is null or r.entitlement_id>decode(substr(p_after_id,3),'hex'))
    order by r.entitlement_id limit 51
  ), page as (select * from selected order by entitlement_id limit 50), items as (
    select p.entitlement_id,jsonb_build_object(
      'entitlementId','0x'||encode(p.entitlement_id,'hex'),'clubId',p.source_beneficiary_id,
      'clubName',nullif(left(btrim(club.name),256),''),'amountWei',p.amount_wei::text,
      'nomination',case when n.id is not null then jsonb_build_object('requestId',n.id,
        'address',n.candidate->>'safeAddress','status',app_private.reward_club_treasury_document(n)->>'status') end,
      'claim',case when c.id is not null then jsonb_build_object('claimId',c.id,'requestId',c.request_id,
        'recipientAddress',c.recipient_address,
        'recipientConsented',exists(select 1 from app_private.reward_club_claim_proofs_v3 pr where pr.claim_id=c.id and pr.role='recipient'),
        'operatorApproved',exists(select 1 from app_private.reward_club_claim_proofs_v3 pr where pr.claim_id=c.id and pr.role='operator')) end) body
    from page p left join public.clubs club on club.id=p.source_beneficiary_id
    left join lateral(select n.* from app_private.reward_club_treasury_requests n
      where n.club_id=p.source_beneficiary_id and n.chain_id=p_chain_id
      order by n.requested_at desc,n.id desc limit 1) n on true
    left join lateral(select c.* from app_private.reward_club_claims_v3 c where c.upload_id=p_upload_id
      and c.entitlement_id=p.entitlement_id and c.chain_id=p_chain_id
      and c.campaign_address=a.document#>>'{binding,campaignAddress}' order by c.sequence desc limit 1) c on true
  ) select jsonb_build_object('schema','raceson-organizer-club-awards-v3','chainId',p_chain_id,
    'uploadId',p_upload_id,'draftId',d.id,'approvalId',a.id,'slot',a.slot,
    'campaignAddress',a.document#>>'{binding,campaignAddress}',
    'allocationRevision',case when exists(select 1 from app_private.reward_allocation_approvals_v3 newer
      where newer.draft_id=d.id and newer.slot=a.slot and newer.sequence>a.sequence) then 'superseded' else 'latest' end,
    'items',coalesce((select jsonb_agg(body order by entitlement_id) from items),'[]'::jsonb),
    'nextCursor',case when (select count(*) from selected)>50 then
      (select '0x'||encode(entitlement_id,'hex') from page order by entitlement_id desc limit 1) end) into result;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if not app_private.reward_planning_authorized(p_user_id,d.organization_id)
    then raise exception 'reward_club_readiness_scope_required'; end if;
  return result;
end $$;
revoke all on function public.service_list_reward_organizer_club_awards_v3(uuid,uuid,integer,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_list_reward_organizer_club_awards_v3(uuid,uuid,integer,uuid,text) to service_role;
comment on function public.service_list_reward_organizer_club_awards_v3(uuid,uuid,integer,uuid,text) is
  'Isolated demo operator-only upload club discovery; never a source, identity, consent or payment approval.';
commit;
