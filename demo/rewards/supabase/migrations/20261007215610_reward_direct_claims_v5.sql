begin;
-- V4 remains immutable. V5 plans explicitly pin the separate identity registry
-- and its issuer. No runtime setting, wallet, deployment or campaign is changed.
do $migration$
declare definition text; replacement text; target regprocedure;
begin
 target:='public.service_reward_sponsor_execution(uuid,uuid,integer,uuid,jsonb,text,text)'::regprocedure;
 definition:=pg_get_functiondef(target);
 if strpos(definition,'(select count(*) from jsonb_object_keys(p_plan))<>13')=0
  or strpos(definition,'p_plan->>''version''<>''4''')=0 then raise exception 'unexpected_sponsor_execution_definition';end if;
 replacement:=replace(definition,'(select count(*) from jsonb_object_keys(p_plan))<>13',
  '(select count(*) from jsonb_object_keys(p_plan))<>(case when p_plan->>''version''=''5'' then 15 else 13 end)');
 replacement:=replace(replacement,'p_plan->>''version''<>''4''','coalesce(p_plan->>''version'','''') not in(''4'',''5'')');
 replacement:=replace(replacement,'  select * into l from app_private.reward_sponsor_launches',
 $code$  if p_plan->>'version'='5' and (not(p_plan ?& array['walletRegistry','identityIssuer'])
   or coalesce(p_plan->>'walletRegistry','') !~ '^0x[0-9a-f]{40}$' or p_plan->>'walletRegistry'='0x'||repeat('0',40)
   or coalesce(p_plan->>'identityIssuer','') !~ '^0x[0-9a-f]{40}$' or p_plan->>'identityIssuer'='0x'||repeat('0',40)
   or p_plan->>'identityIssuer' in(p_plan->>'operator',p_plan->>'funder',p_plan->>'walletRegistry')) then raise exception 'invalid_sponsor_execution';end if;
  select * into l from app_private.reward_sponsor_launches$code$);
 execute replacement;
 -- Uploaded amounts and opaque IDs remain bound to the same approved rows.
 for target in select unnest(array[
 'public.service_prepare_reward_sponsor_upload_v4(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text,jsonb)'::regprocedure,
 'app_private.prepare_reward_demo_copy_upload(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text,text,jsonb)'::regprocedure]) loop
  definition:=pg_get_functiondef(target);
  if strpos(definition,'package->''protocolVersion'' is distinct from ''4''::jsonb')=0 then raise exception 'unexpected_sponsor_upload_definition';end if;
  execute replace(definition,'package->''protocolVersion'' is distinct from ''4''::jsonb',
   'package->''protocolVersion'' is distinct from v#>''{execution,plan,version}'' or v#>>''{execution,plan,version}'' not in(''4'',''5'')');
 end loop;
end $migration$;

-- A V5 award must never acquire a legacy request/approval journal. Check the
-- immutable execution version before either legacy endpoint can write a row.
do $migration$
declare definition text; target regprocedure;
begin
 for target in select unnest(array[
  'app_private.reward_demo_copy_claim(uuid,uuid,integer,uuid,text,text,text,text,text)'::regprocedure,
  'app_private.reward_demo_copy_club_claim(uuid,uuid,integer,uuid,text,text,text,text,text)'::regprocedure]) loop
  definition:=pg_get_functiondef(target);
  if strpos(definition,'if pub.id is null or u.id is null or execution.plan->>''chainId''<>p_chain_id::text')=0
   then raise exception 'unexpected_legacy_claim_definition';end if;
  execute replace(definition,'if pub.id is null or u.id is null or execution.plan->>''chainId''<>p_chain_id::text',
   'if execution.plan->>''version'' is distinct from ''4'' or pub.id is null or u.id is null or execution.plan->>''chainId''<>p_chain_id::text');
 end loop;
end $migration$;

create table app_private.reward_direct_claim_receipts_v5 (
 entitlement_id bytea primary key references app_private.reward_sponsor_recipients_v4(entitlement_id),
 approval_id uuid not null references app_private.reward_sponsor_allocation_approvals_v4(id),
 recipient_user_id uuid not null references auth.users(id),
 receipt jsonb not null check(jsonb_typeof(receipt)='object' and octet_length(receipt::text)<4096),
 created_at timestamptz not null default clock_timestamp()
);
alter table app_private.reward_direct_claim_receipts_v5 enable row level security;
revoke all on app_private.reward_direct_claim_receipts_v5 from public,anon,authenticated,service_role;
create trigger immutable before update or delete on app_private.reward_direct_claim_receipts_v5
 for each row execute function app_private.reward_result_review_immutable_v3();

-- Session/profile ownership is automatic and freshly checked. This is confined
-- to the provisioned isolated rehearsal aliases, not proof of a real person's age.
-- There is no request, reviewer decision, operator signature or payment here.
create function public.service_reward_demo_copy_direct_claim_v5(p_user_id uuid,p_session_id uuid,
 p_approval_id uuid,p_entitlement_id text,p_proof_id uuid default null,p_receipt jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare account jsonb; r app_private.reward_sponsor_recipients_v4%rowtype;
 a app_private.reward_sponsor_allocation_approvals_v4%rowtype; e app_private.reward_sponsor_executions%rowtype;
 u app_private.reward_sponsor_uploads_v4%rowtype; ch app_private.reward_wallet_challenges%rowtype;
 award jsonb; saved jsonb; athlete public.athlete_profiles%rowtype;
begin
 account:=app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
 if account->>'kind' is distinct from 'athlete' or p_approval_id is null
  or coalesce(p_entitlement_id,'') !~ '^0x[0-9a-f]{64}$' then raise exception 'reward_claim_scope_required';end if;
 select * into r from app_private.reward_sponsor_recipients_v4 where approval_id=p_approval_id
  and entitlement_id=decode(substr(p_entitlement_id,3),'hex') and beneficiary_kind='athlete' and beneficiary_id=(account->>'athleteId')::uuid;
 if r.entitlement_id is null then raise exception 'reward_claim_scope_required';end if;
 select * into athlete from public.athlete_profiles where id=r.beneficiary_id and claimed_by_user_id=p_user_id
  and is_claimed and status='active' and merged_into_athlete_profile_id is null for share;
 if athlete.id is null or not app_private.reward_demo_rehearsal_alias(p_user_id,athlete.id,10143,
  '073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644') then raise exception 'reward_claim_scope_required';end if;
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
  or award->>'amount'<>r.amount_wei::text or award->>'beneficiaryKind'<>'0' then raise exception 'invalid_sponsor_claim';end if;
 if p_proof_id is not null then
  select c.* into ch from app_private.reward_wallet_challenges c join app_private.reward_wallet_proofs proof on proof.challenge_id=c.id
   where proof.id=p_proof_id and c.user_id=p_user_id and c.session_id=p_session_id and c.chain_id=10143 and c.origin='https://podium.raceson.com';
  if ch.id is null then raise exception 'reward_destination_proof_required';end if;
  if clock_timestamp()<ch.issued_at or clock_timestamp()>=ch.expires_at then raise exception 'reward_wallet_challenge_expired';end if;
 end if;
 select receipt into saved from app_private.reward_direct_claim_receipts_v5 where entitlement_id=r.entitlement_id;
 if p_receipt is not null then
  if jsonb_typeof(p_receipt)<>'object' or (select count(*) from jsonb_object_keys(p_receipt))<>5
   or not(p_receipt ?& array['transactionHash','amountWei','recipient','blockNumber','blockHash'])
   or coalesce(p_receipt->>'transactionHash','') !~ '^0x[0-9a-f]{64}$' or coalesce(p_receipt->>'blockHash','') !~ '^0x[0-9a-f]{64}$'
   or coalesce(p_receipt->>'blockNumber','') !~ '^[0-9]+$' or coalesce(p_receipt->>'recipient','') !~ '^0x[0-9a-f]{40}$'
   or p_receipt->>'amountWei' is distinct from r.amount_wei::text then raise exception 'invalid_sponsor_claim';end if;
  insert into app_private.reward_direct_claim_receipts_v5(entitlement_id,approval_id,recipient_user_id,receipt)
   values(r.entitlement_id,a.id,p_user_id,p_receipt) on conflict(entitlement_id) do nothing;
  select receipt into saved from app_private.reward_direct_claim_receipts_v5 where entitlement_id=r.entitlement_id;
  if saved is distinct from p_receipt then raise exception 'reward_sponsor_claim_conflict';end if;
 end if;
 perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
 return jsonb_build_object('approvalId',a.id,'slot',a.slot,'plan',e.plan,'deploymentHash',e.deployment_hash,'fundingHash',e.funding_hash,
  'award',award,'challenge',case when ch.id is null then null else app_private.reward_wallet_challenge_document(ch) end,
  'receipt',saved,'rehearsalPolicy','podium-demo-alias-rehearsal-v1');
end $$;
revoke all on function public.service_reward_demo_copy_direct_claim_v5(uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_direct_claim_v5(uuid,uuid,uuid,text,uuid,jsonb) to service_role;

-- List the new claim path explicitly; never fabricate readiness/approval flags.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.service_reward_demo_copy_athlete_awards(uuid,uuid,text)'::regprocedure);
 if strpos(definition,'a.slot,r.amount_wei,r.beneficiary_id')=0 or strpos(definition,
  $needle$),'[]'::jsonb)) item from page$needle$)=0 then raise exception 'unexpected_athlete_awards_definition';end if;
 definition:=replace(definition,'a.slot,r.amount_wei,r.beneficiary_id','a.slot,r.amount_wei,r.beneficiary_id,e.plan->>''version'' protocol_version');
 definition:=replace(definition,$needle$),'[]'::jsonb)) item from page$needle$,
  $code$),'[]'::jsonb)) || case when protocol_version='5' then jsonb_build_object('protocolVersion',5,'claims','[]'::jsonb,
   'directClaim',jsonb_build_object('paid',exists(select 1 from app_private.reward_direct_claim_receipts_v5 paid where paid.entitlement_id=page.entitlement_id)))
   else '{}'::jsonb end item from page$code$);
 execute definition;
end $migration$;
notify pgrst,'reload schema';
commit;
