begin;
-- Automatic copied club authority and verified original treasury; no claim approval queue.
create function public.service_reward_demo_copy_club_direct_claim_v5(p_user_id uuid,p_session_id uuid,
 p_approval_id uuid,p_entitlement_id text,p_creation_id uuid,p_proof_id uuid default null,p_receipt jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare account jsonb; r app_private.reward_sponsor_recipients_v4%rowtype;
 a app_private.reward_sponsor_allocation_approvals_v4%rowtype; e app_private.reward_sponsor_executions%rowtype;
 u app_private.reward_sponsor_uploads_v4%rowtype; ch app_private.reward_wallet_challenges%rowtype;
 award jsonb; saved jsonb; owner_now jsonb; creation app_private.reward_demo_copy_club_creations%rowtype; treasury jsonb;
begin
 account:=app_private.require_reward_demo_copy_club(p_user_id,p_session_id);
 if p_approval_id is null or coalesce(p_entitlement_id,'') !~ '^0x[0-9a-f]{64}$' then raise exception 'reward_claim_scope_required';end if;
 select * into r from app_private.reward_sponsor_recipients_v4 where approval_id=p_approval_id
  and entitlement_id=decode(substr(p_entitlement_id,3),'hex') and beneficiary_kind='club';
 if r.entitlement_id is null or not exists(select 1 from jsonb_array_elements(account) x where(x->>'id')::uuid=r.beneficiary_id)
  then raise exception 'reward_claim_scope_required';end if;
 perform id from public.clubs where id=r.beneficiary_id for share;
 owner_now:=app_private.reward_club_owner_identity(r.beneficiary_id,p_user_id);
 if owner_now is null then raise exception 'reward_claim_scope_required';end if;
 select * into creation from app_private.reward_demo_copy_club_creations where id=p_creation_id
  and user_id=p_user_id and club_id=r.beneficiary_id and owner_identity=owner_now;
 select body into treasury from app_private.reward_demo_copy_club_creation_events where request_id=creation.id and kind='verified';
 if creation.id is null or treasury is null then raise exception 'reward_club_treasury_required';end if;
 select * into a from app_private.reward_sponsor_allocation_approvals_v4 where id=r.approval_id and decision='approved'
  and document_text::jsonb->>'schema'='podium-copy-allocation-document-v1';
 select * into e from app_private.reward_sponsor_executions where setup_id=a.setup_id and launch_id=a.launch_id
  and plan->>'chainId'='10143' and plan->>'version'='5';
 if e.setup_id is null or e.deployment_hash is null or e.funding_hash is null
  or not exists(select 1 from app_private.reward_demo_copy_launch_sources where launch_id=e.launch_id
   and batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644')
  or not exists(select 1 from app_private.reward_sponsor_lifecycle_v4 where approval_id=a.id and kind='publication')
  then raise exception 'reward_sponsor_claim_not_ready';end if;
 select * into u from app_private.reward_sponsor_uploads_v4 where approval_id=a.id;
 select value into award from jsonb_array_elements(u.package_text::jsonb->'awards') where value->>'entitlementId'=p_entitlement_id;
 if award is null or award->>'beneficiaryId'<>'0x'||encode(r.opaque_beneficiary_id,'hex')
  or award->>'amount'<>r.amount_wei::text or award->>'beneficiaryKind'<>'1' then raise exception 'invalid_sponsor_claim';end if;
 if p_proof_id is not null then
  select c.* into ch from app_private.reward_wallet_challenges c join app_private.reward_wallet_proofs proof on proof.challenge_id=c.id
   where proof.id=p_proof_id and c.user_id=p_user_id and c.session_id=p_session_id and c.chain_id=10143 and c.origin='https://podium.raceson.com';
  if ch.id is null or not(creation.owners ? ch.address) then raise exception 'reward_destination_proof_required';end if;
  if clock_timestamp()<ch.issued_at or clock_timestamp()>=ch.expires_at then raise exception 'reward_wallet_challenge_expired';end if;
 end if;
 select receipt into saved from app_private.reward_direct_claim_receipts_v5 where entitlement_id=r.entitlement_id;
 if p_receipt is not null then
  if jsonb_typeof(p_receipt)<>'object' or (select count(*) from jsonb_object_keys(p_receipt))<>5
   or not(p_receipt ?& array['transactionHash','amountWei','recipient','blockNumber','blockHash'])
   or coalesce(p_receipt->>'transactionHash','') !~ '^0x[0-9a-f]{64}$' or coalesce(p_receipt->>'blockHash','') !~ '^0x[0-9a-f]{64}$'
   or coalesce(p_receipt->>'blockNumber','') !~ '^[0-9]+$' or coalesce(p_receipt->>'recipient','') !~ '^0x[0-9a-f]{40}$'
   or p_receipt->>'recipient' is distinct from treasury->>'safeAddress' or p_receipt->>'amountWei' is distinct from r.amount_wei::text then raise exception 'invalid_sponsor_claim';end if;
  insert into app_private.reward_direct_claim_receipts_v5(entitlement_id,approval_id,recipient_user_id,receipt)
   values(r.entitlement_id,a.id,p_user_id,p_receipt) on conflict(entitlement_id) do nothing;
  select receipt into saved from app_private.reward_direct_claim_receipts_v5 where entitlement_id=r.entitlement_id;
  if saved is distinct from p_receipt then raise exception 'reward_sponsor_claim_conflict';end if;
 end if;
 perform app_private.require_reward_demo_copy_club(p_user_id,p_session_id);
 if app_private.reward_club_owner_identity(r.beneficiary_id,p_user_id) is distinct from owner_now then raise exception 'reward_claim_scope_required';end if;
 return jsonb_build_object('approvalId',a.id,'slot',a.slot,'plan',e.plan,'deploymentHash',e.deployment_hash,'fundingHash',e.funding_hash,
  'award',award,'challenge',case when ch.id is null then null else app_private.reward_wallet_challenge_document(ch) end,
  'treasury',jsonb_build_object('creationId',creation.id,'clubId',creation.club_id,'owners',creation.owners,'safeAddress',treasury->>'safeAddress','deploymentTransactionHash',treasury->>'transactionHash'),
  'receipt',saved,'rehearsalPolicy','podium-demo-alias-rehearsal-v1');
end $$;
revoke all on function public.service_reward_demo_copy_club_direct_claim_v5(uuid,uuid,uuid,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_club_direct_claim_v5(uuid,uuid,uuid,text,uuid,uuid,jsonb) to service_role;

-- List the new claim path explicitly; never fabricate readiness/approval flags.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.service_reward_demo_copy_club_awards(uuid,uuid,text)'::regprocedure);
 if strpos(definition,'a.slot,r.amount_wei,r.beneficiary_id')=0 or strpos(definition,
  $needle$),'[]'::jsonb)) item from page$needle$)=0 then raise exception 'unexpected_club_awards_definition';end if;
 definition:=replace(definition,'a.slot,r.amount_wei,r.beneficiary_id','a.slot,r.amount_wei,r.beneficiary_id,e.plan->>''version'' protocol_version');
 definition:=replace(definition,$needle$),'[]'::jsonb)) item from page$needle$,
  $code$),'[]'::jsonb)) || case when protocol_version='5' then jsonb_build_object('protocolVersion',5,'claims','[]'::jsonb,
   'directClaim',jsonb_build_object('paid',exists(select 1 from app_private.reward_direct_claim_receipts_v5 paid where paid.entitlement_id=page.entitlement_id)))
   else '{}'::jsonb end item from page$code$);
 execute definition;
end $migration$;
notify pgrst,'reload schema';
commit;
