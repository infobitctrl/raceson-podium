begin;
-- Ordinary readiness/recipient consent and native operator approval are separate
-- immutable authorities. No native DID is replaced by a fictitious user UUID.
create table app_private.reward_demo_copy_native_claim_events (
 claim_id uuid not null references app_private.reward_sponsor_claims_v4(id),
 kind text not null check(kind in('operator','receipt')),
 body_text text not null check(octet_length(body_text)<=32768),
 privy_subject text not null check(privy_subject ~ '^did:privy:[a-zA-Z0-9_-]{1,100}$'),
 operator text not null check(operator ~ '^0x[0-9a-f]{40}$'),
 created_at timestamptz not null default clock_timestamp(),primary key(claim_id,kind)
);
alter table app_private.reward_demo_copy_native_claim_events enable row level security;
revoke all on app_private.reward_demo_copy_native_claim_events from public,anon,authenticated,service_role;
create trigger immutable before update or delete on app_private.reward_demo_copy_native_claim_events
 for each row execute function app_private.reward_result_review_immutable_v3();
create view app_private.reward_demo_copy_claim_events as
 select claim_id,kind,body_text,actor_user_id,null::text privy_subject,null::text operator,created_at
 from app_private.reward_sponsor_claim_events_v4 where kind in('intent','recipient','revoked')
 union all select claim_id,kind,body_text,null::uuid,privy_subject,operator,created_at from app_private.reward_demo_copy_native_claim_events;
revoke all on app_private.reward_demo_copy_claim_events from public,anon,authenticated,service_role;
create function app_private.reward_demo_copy_claim_reviewer_current(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join public.user_profiles p on p.user_id=u.id
  join public.account_login_identifiers i on i.user_id=u.id
  join public.leagues league on league.id='ba81ced7-b2c5-4d51-95b6-d95d8c04fa36'
  where u.id=p_user_id and u.deleted_at is null and p.status='active'
  and u.raw_app_meta_data->>'podium_role_setup'='20261005-owner-request'
  and u.raw_app_meta_data->>'trail_credential_mode'='username'
  and (u.raw_app_meta_data->>'podium_requested_role'='reviewer' and i.username='demo.review'
   or u.raw_app_meta_data->>'podium_requested_role'='platform_admin' and i.username='demo.master')
  and public.service_user_has_organization_permission(league.organization_id,u.id,'results.manage'))
$$;
create function app_private.reward_demo_copy_claim(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_claim_id uuid,
 p_role text,p_action text default null,p_body_text text default null,p_subject text default null,p_operator text default null)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare c app_private.reward_sponsor_claims_v4%rowtype; a app_private.reward_sponsor_allocation_approvals_v4%rowtype;
 r app_private.reward_sponsor_recipients_v4%rowtype; n app_private.reward_athlete_destination_requests%rowtype; athlete public.athlete_profiles%rowtype;
 pub app_private.reward_sponsor_lifecycle_v4%rowtype; u app_private.reward_sponsor_uploads_v4%rowtype;
 ch app_private.reward_wallet_challenges%rowtype; execution app_private.reward_sponsor_executions%rowtype;
 b jsonb; old app_private.reward_demo_copy_claim_events%rowtype; account jsonb; events jsonb; source_stamp text; fingerprint text; current boolean; destination jsonb;
 today date:=(clock_timestamp() at time zone 'Europe/Zagreb')::date; before_stamp text; fresh jsonb;
begin
 if p_role='recipient' then
  account:=app_private.require_reward_demo_web_wallet_account(p_actor_user_id,p_actor_session_id);
  if account->>'kind' is distinct from 'athlete' then raise exception 'reward_claim_scope_required';end if;
 elsif p_role='reviewer' then perform app_private.require_reward_demo_copy_reviewer(p_actor_user_id,p_actor_session_id);
 elsif p_role='operator' then
  if p_actor_user_id is not null or p_actor_session_id is not null then raise exception 'reward_claim_scope_required';end if;
  perform app_private.require_reward_demo_copy_controller(p_operator,p_subject);
 else raise exception 'reward_claim_scope_required';end if;
 if p_claim_id is null or p_claim_id='00000000-0000-0000-0000-000000000000' or p_chain_id is null or p_chain_id<>10143 or p_role is null or p_role not in('recipient','reviewer','operator') then raise exception 'reward_claim_scope_required'; end if;
 if p_action is not null and (p_body_text is null or octet_length(p_body_text)>32768) then raise exception 'invalid_sponsor_claim';end if;
 b:=p_body_text::jsonb;
 if p_action is not null then
  if jsonb_typeof(b) is distinct from 'object' then raise exception 'invalid_sponsor_claim';end if;
  if p_action='request' and (not(b ?& array['approvalId','entitlementId','destinationId']) or (select count(*) from jsonb_object_keys(b))<>3)
   or p_action='intent' and (not(b ?& array['sourceStamp','profileFingerprint','attestation','claim','witness']) or (select count(*) from jsonb_object_keys(b))<>5)
   or p_action='revoked' and b is distinct from '{"reason":"operator_hold"}'::jsonb
   then raise exception 'invalid_sponsor_claim';end if;
  if p_action in('recipient','operator') then
   if not(b ?& array['protocolVersion','role','signer','digest','signature']) or (select count(*) from jsonb_object_keys(b))<>5
    or b->'protocolVersion' is distinct from '4'::jsonb or b->>'role' is distinct from p_action
    or coalesce(b->>'digest','') !~ '^0x[0-9a-f]{64}$' or coalesce(b->>'signature','') !~ '^0x[0-9a-f]{130}$'
    then raise exception 'invalid_sponsor_claim';end if;
  elsif p_action='receipt' then
   if not(b ?& array['transactionHash','amountWei','recipient','blockNumber','blockHash']) or (select count(*) from jsonb_object_keys(b))<>5
    or coalesce(b->>'transactionHash','') !~ '^0x[0-9a-f]{64}$' or coalesce(b->>'blockHash','') !~ '^0x[0-9a-f]{64}$'
    or coalesce(b->>'blockNumber','') !~ '^[0-9]+$' then raise exception 'invalid_sponsor_claim';end if;
  end if;
 end if;
 if p_action='request' then
  if p_role<>'recipient' or b is null or jsonb_typeof(b)<>'object' or (select count(*) from jsonb_object_keys(b))<>3 then raise exception 'invalid_sponsor_claim'; end if;
  select * into n from app_private.reward_athlete_destination_requests where id=(b->>'destinationId')::uuid and user_id=p_actor_user_id;
  select * into r from app_private.reward_sponsor_recipients_v4 where approval_id=(b->>'approvalId')::uuid and entitlement_id=decode(substr(b->>'entitlementId',3),'hex')
   and beneficiary_kind='athlete' and beneficiary_id=n.athlete_profile_id and beneficiary_id=(account->>'athleteId')::uuid;
  if n.id is null or r.entitlement_id is null then raise exception 'reward_claim_scope_required'; end if;
  select * into c from app_private.reward_sponsor_claims_v4 where id=p_claim_id;
  if c.id is not null and (c.recipient_user_id<>p_actor_user_id or c.destination_id<>n.id or c.approval_id<>r.approval_id or c.entitlement_id<>r.entitlement_id) then raise exception 'reward_sponsor_claim_conflict'; end if;
 else
  select * into c from app_private.reward_sponsor_claims_v4 where id=p_claim_id;
  if c.id is null then raise exception 'reward_claim_scope_required'; end if;
  select * into n from app_private.reward_athlete_destination_requests where id=c.destination_id;
  select * into r from app_private.reward_sponsor_recipients_v4 where entitlement_id=c.entitlement_id and approval_id=c.approval_id;
 end if;
 select * into a from app_private.reward_sponsor_allocation_approvals_v4 where id=r.approval_id;
 select * into pub from app_private.reward_sponsor_lifecycle_v4 where approval_id=a.id and kind='publication';
 select * into u from app_private.reward_sponsor_uploads_v4 where approval_id=a.id;
 select * into execution from app_private.reward_sponsor_executions where setup_id=a.setup_id;
 if pub.id is null or u.id is null or execution.plan->>'chainId'<>p_chain_id::text
  or a.document_text::jsonb->>'schema' is distinct from 'podium-copy-allocation-document-v1'
  or not exists(select 1 from app_private.reward_demo_copy_launch_sources b where b.launch_id=execution.launch_id and b.launch_id=a.launch_id and b.batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644')
  or (p_role='recipient' and (p_actor_user_id<>n.user_id or r.beneficiary_id is distinct from (account->>'athleteId')::uuid))
  or (p_role='operator' and execution.plan->>'operator' is distinct from p_operator) then raise exception 'reward_claim_scope_required'; end if;
 -- Real copied organization/reviewer authority precedes setup/profile locks.
 perform 1 from public.organization_memberships where user_id=pub.actor_user_id and organization_id='cdaebab4-2961-4cfa-87e0-d075cc43e29b' for share;
 perform 1 from public.organizations where id='cdaebab4-2961-4cfa-87e0-d075cc43e29b' for share;
 perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||a.setup_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||n.user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('sponsor-claim:'||p_claim_id::text,0));
 select * into athlete from public.athlete_profiles where id=r.beneficiary_id for share;
 if athlete.claimed_by_user_id is distinct from n.user_id or not athlete.is_claimed or athlete.status<>'active' or athlete.merged_into_athlete_profile_id is not null then raise exception 'reward_claim_scope_required'; end if;
 destination:=app_private.reward_athlete_destination_document(n);
 select w.* into ch from app_private.reward_wallet_challenges w join app_private.reward_wallet_proofs p on p.challenge_id=w.id where p.id=n.proof_id;
 if ch.user_id is distinct from n.user_id or ch.chain_id is distinct from p_chain_id or ch.session_id is distinct from n.session_id or ch.origin is distinct from 'https://podium.raceson.com' then raise exception 'reward_claim_scope_required'; end if;
 source_stamp:=coalesce(app_private.reward_demo_copy_source_stamp(a.id),repeat('0',64));fingerprint:=app_private.reward_athlete_profile_fingerprint(athlete.id);
 current:=coalesce(exists(select 1 from public.user_profiles where user_id=n.user_id and status='active')
  and exists(select 1 from public.user_profiles where user_id=pub.actor_user_id and status='active')
  and app_private.reward_demo_copy_claim_reviewer_current(pub.actor_user_id)
  and source_stamp<>repeat('0',64) and source_stamp=pub.source_stamp and a.decision='approved'
  and not exists(select 1 from app_private.reward_distribution_setups d where d.id=a.setup_id and d.archived_at is not null) and destination->>'status'='pending_review'
  and not exists(select 1 from app_private.reward_sponsor_claim_events_v4 ce where ce.claim_id=p_claim_id and ce.kind='intent' and not app_private.reward_demo_copy_claim_reviewer_current(ce.actor_user_id))
  and athlete.date_of_birth<=today-interval '18 years' and (athlete.birth_year is null or athlete.birth_year=extract(year from athlete.date_of_birth)),false);
 if p_action='request' then
  select * into c from app_private.reward_sponsor_claims_v4 where id=p_claim_id;
  if c.id is not null and (c.recipient_user_id<>p_actor_user_id or c.destination_id<>n.id or c.approval_id<>r.approval_id or c.entitlement_id<>r.entitlement_id) then raise exception 'reward_sponsor_claim_conflict'; end if;
 end if;
 if p_action='request' and c.id is null then
  -- A request records the athlete's choice, not readiness or payment consent.
  if source_stamp=repeat('0',64) or source_stamp is distinct from pub.source_stamp or destination->>'status' is distinct from 'pending_review' then raise exception 'reward_sponsor_claim_not_ready';end if;
  if (select count(*) from app_private.reward_sponsor_claims_v4 x where x.recipient_user_id=n.user_id and x.created_at>clock_timestamp()-interval '1 hour')>=12
   or (select count(*) from app_private.reward_sponsor_claims_v4 x where x.recipient_user_id=n.user_id and x.created_at>clock_timestamp()-interval '1 day')>=30
   then raise exception 'reward_sponsor_claim_conflict';end if;
  insert into app_private.reward_sponsor_claims_v4(id,approval_id,entitlement_id,destination_id,recipient_user_id)
   values(p_claim_id,a.id,r.entitlement_id,n.id,n.user_id) returning * into c;
 elsif p_action is not null and p_action<>'request' then
  if p_action not in('intent','recipient','operator','receipt','revoked') or b is null or octet_length(p_body_text)>32768 then raise exception 'invalid_sponsor_claim'; end if;
  if (p_action='recipient' and p_role<>'recipient') or (p_action in('intent','revoked') and p_role<>'reviewer') or (p_action in('operator','receipt') and p_role<>'operator') then raise exception 'reward_claim_scope_required'; end if;
  if p_action in('recipient','operator') and b->>'signer' is distinct from (case when p_action='operator' then execution.plan->>'operator' else destination->>'address' end)
   or p_action='receipt' and (b->>'recipient' is distinct from destination->>'address' or b->>'amountWei' is distinct from r.amount_wei::text)
   then raise exception 'invalid_sponsor_claim';end if;
  select * into old from app_private.reward_demo_copy_claim_events where claim_id=c.id and kind=p_action;
  if found then
   if old.body_text<>p_body_text or old.actor_user_id is distinct from p_actor_user_id or old.privy_subject is distinct from p_subject or old.operator is distinct from p_operator then raise exception 'reward_sponsor_claim_conflict'; end if;
  else
   if not current or exists(select 1 from app_private.reward_demo_copy_claim_events where claim_id=c.id and kind='revoked') then raise exception 'reward_sponsor_claim_not_ready'; end if;
   if p_action='intent' then
    if b->>'sourceStamp' is distinct from source_stamp or b->>'profileFingerprint' is distinct from fingerprint
     or b#>>'{claim,recipient}' is distinct from destination->>'address' or b#>>'{claim,entitlementId}' is distinct from '0x'||encode(r.entitlement_id,'hex')
     or b#>>'{claim,amount}' is distinct from r.amount_wei::text or b#>>'{attestation,verifiedDateOfBirth}' is distinct from athlete.date_of_birth::text
     or b#>>'{claim,pot}' is distinct from (case when a.slot=0 then 'league' else 'race' end)
     or coalesce(b#>>'{claim,nonce}','') !~ '^[0-9]+$' or coalesce(b#>>'{claim,issuedAt}','') !~ '^[1-9][0-9]+$'
     or coalesce(b#>>'{claim,expiresAt}','') !~ '^[1-9][0-9]+$'
     or (b#>>'{claim,expiresAt}')::numeric<=(b#>>'{claim,issuedAt}')::numeric
     or (b#>>'{claim,expiresAt}')::numeric>(b#>>'{claim,issuedAt}')::numeric+86400 then raise exception 'invalid_sponsor_claim'; end if;
    -- Another still-live intent for this entitlement cannot choose a competing destination.
    if exists(select 1 from app_private.reward_demo_copy_claim_events e join app_private.reward_sponsor_claims_v4 x on x.id=e.claim_id
      where x.entitlement_id=c.entitlement_id and e.kind='intent' and (e.body_text::jsonb#>>'{claim,expiresAt}')::numeric>(b#>>'{claim,issuedAt}')::numeric)
      then raise exception 'reward_sponsor_claim_conflict'; end if;
   elsif p_action in('recipient','operator','receipt') then
    select body_text::jsonb into events from app_private.reward_demo_copy_claim_events where claim_id=c.id and kind='intent';
    if events is null or events->>'sourceStamp'<>source_stamp or events->>'profileFingerprint'<>fingerprint then raise exception 'reward_sponsor_claim_not_ready'; end if;
    if p_action in('operator','receipt') and not exists(select 1 from app_private.reward_demo_copy_claim_events where claim_id=c.id and kind='recipient') then raise exception 'reward_recipient_consent_required'; end if;
    if p_action='receipt' and not exists(select 1 from app_private.reward_demo_copy_claim_events where claim_id=c.id and kind='operator') then raise exception 'reward_sponsor_claim_not_ready'; end if;
   end if;
   if p_role='operator' then
    insert into app_private.reward_demo_copy_native_claim_events(claim_id,kind,body_text,privy_subject,operator) values(c.id,p_action,p_body_text,p_subject,p_operator);
   else insert into app_private.reward_sponsor_claim_events_v4(claim_id,kind,body_text,actor_user_id) values(c.id,p_action,p_body_text,p_actor_user_id);end if;
  end if;
 end if;
 select coalesce(jsonb_object_agg(kind,body_text::jsonb),'{}'::jsonb) into events from app_private.reward_demo_copy_claim_events where claim_id=c.id;
 if events?'revoked' or (events?'intent' and (events#>>'{intent,sourceStamp}'<>source_stamp or events#>>'{intent,profileFingerprint}'<>fingerprint)) then current:=false; end if;
 if p_role='recipient' then
  account:=app_private.require_reward_demo_web_wallet_account(p_actor_user_id,p_actor_session_id);
  if account->>'kind' is distinct from 'athlete' then raise exception 'reward_claim_scope_required';end if;
 elsif p_role='reviewer' then perform app_private.require_reward_demo_copy_reviewer(p_actor_user_id,p_actor_session_id);
 elsif p_role='operator' then
  if p_actor_user_id is not null or p_actor_session_id is not null then raise exception 'reward_claim_scope_required';end if;
  perform app_private.require_reward_demo_copy_controller(p_operator,p_subject);
 else raise exception 'reward_claim_scope_required';end if;
 if coalesce(app_private.reward_demo_copy_source_stamp(a.id),repeat('0',64)) is distinct from source_stamp or app_private.reward_athlete_profile_fingerprint(athlete.id) is distinct from fingerprint
  or app_private.reward_athlete_destination_document(n) is distinct from destination then raise exception 'reward_planning_revision_changed'; end if;
 return jsonb_build_object('claimId',c.id,'entitlementId','0x'||encode(c.entitlement_id,'hex'),'approvalId',a.id,'setupId',a.setup_id,'slot',a.slot,'current',current,'sourceStamp',source_stamp,'profileFingerprint',fingerprint,
  'destination',destination,'challenge',app_private.reward_wallet_challenge_document(ch),'package',u.package_text::jsonb,'packageHash',u.package_hash,
  'plan',execution.plan,'publication',pub.body_text::jsonb,'events',events);
end $$;


create function public.service_reward_demo_copy_claim(p_actor_user_id uuid,p_actor_session_id uuid,p_claim_id uuid,p_role text,
 p_action text default null,p_body_text text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 if p_role is null or p_role not in('recipient','reviewer') or (p_action is null)<>(p_body_text is null)
  or p_action is not null and not (p_role='recipient' and p_action in('request','recipient') or p_role='reviewer' and p_action in('intent','revoked'))
 then raise exception 'invalid_sponsor_claim';end if;
 return app_private.reward_demo_copy_claim(p_actor_user_id,p_actor_session_id,10143,p_claim_id,p_role,p_action,p_body_text);
end $$;
create function public.service_reward_demo_copy_native_claim(p_subject text,p_operator text,p_claim_id uuid,
 p_action text default null,p_body_text text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 if (p_action is null)<>(p_body_text is null) or p_action is not null and p_action not in('operator','receipt') then raise exception 'invalid_sponsor_claim';end if;
 return app_private.reward_demo_copy_claim(null,null,10143,p_claim_id,'operator',p_action,p_body_text,p_subject,p_operator);
end $$;
-- Deterministic keyset page, never a silently truncated aggregate of awards.
create function public.service_reward_demo_copy_athlete_awards(p_user_id uuid,p_session_id uuid,p_after text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare account jsonb; result jsonb;
begin
 account:=app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
 if account->>'kind' is distinct from 'athlete' then raise exception 'reward_claim_scope_required';end if;
 if p_after is not null and p_after !~ '^0x[0-9a-f]{64}$' then raise exception 'invalid_sponsor_claim';end if;
 with eligible as (
 select r.entitlement_id,a.id approval_id,a.slot,r.amount_wei,r.beneficiary_id
 from app_private.reward_sponsor_recipients_v4 r join app_private.reward_sponsor_allocation_approvals_v4 a on a.id=r.approval_id
 join app_private.reward_sponsor_executions e on e.setup_id=a.setup_id and e.plan->>'chainId'='10143'
 join app_private.reward_demo_copy_launch_sources b on b.launch_id=e.launch_id and b.launch_id=a.launch_id
  and b.batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644'
 join public.athlete_profiles athlete on athlete.id=r.beneficiary_id
 where r.beneficiary_kind='athlete' and athlete.id=(account->>'athleteId')::uuid
  and athlete.claimed_by_user_id=p_user_id and athlete.is_claimed and athlete.status='active' and athlete.merged_into_athlete_profile_id is null
  and a.document_text::jsonb->>'schema'='podium-copy-allocation-document-v1'
  and exists(select 1 from app_private.reward_sponsor_lifecycle_v4 where approval_id=a.id and kind='publication')
  and (p_after is null or r.entitlement_id>decode(substr(p_after,3),'hex'))
 order by r.entitlement_id limit 51
 ), page as (select * from eligible order by entitlement_id limit 50), rows as (
 select entitlement_id,jsonb_build_object('approvalId',approval_id,'slot',slot,'entitlementId','0x'||encode(entitlement_id,'hex'),
  'amountWei',amount_wei::text,'athleteProfileId',beneficiary_id,'claims',coalesce((select jsonb_agg(jsonb_build_object(
   'id',c.id,'prepared',exists(select 1 from app_private.reward_demo_copy_claim_events x where x.claim_id=c.id and kind='intent'),
   'consented',exists(select 1 from app_private.reward_demo_copy_claim_events x where x.claim_id=c.id and kind='recipient'),
   'approved',exists(select 1 from app_private.reward_demo_copy_claim_events x where x.claim_id=c.id and kind='operator'),
   'paid',exists(select 1 from app_private.reward_demo_copy_claim_events x where x.claim_id=c.id and kind='receipt')) order by c.created_at,c.id)
   from app_private.reward_sponsor_claims_v4 c where c.entitlement_id=page.entitlement_id and c.recipient_user_id=p_user_id),'[]'::jsonb)) item from page
 ) select jsonb_build_object('items',coalesce(jsonb_agg(item order by entitlement_id),'[]'::jsonb),
  'nextCursor',case when (select count(*) from eligible)>50 then (select '0x'||encode(entitlement_id,'hex') from page order by entitlement_id desc limit 1) end) into result from rows;
 perform app_private.require_reward_demo_web_wallet_account(p_user_id,p_session_id);
 return result;
end $$;
-- Only an exact reviewed copied approval can reveal its recipient requests.
create function app_private.reward_demo_copy_claim_queue(p_approval_id uuid,p_after uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 with eligible as (
  select c.id,c.entitlement_id,r.amount_wei,app_private.reward_athlete_destination_document(n)->>'address' address,a.slot
  from app_private.reward_sponsor_claims_v4 c join app_private.reward_sponsor_recipients_v4 r
   on r.approval_id=c.approval_id and r.entitlement_id=c.entitlement_id and r.beneficiary_kind='athlete'
  join app_private.reward_athlete_destination_requests n on n.id=c.destination_id
  join app_private.reward_sponsor_allocation_approvals_v4 a on a.id=c.approval_id
  where c.approval_id=p_approval_id and (p_after is null or c.id>p_after)
   and a.document_text::jsonb->>'schema'='podium-copy-allocation-document-v1'
  order by c.id limit 51
 ), page as (select * from eligible order by id limit 50), rows as (
  select p.id,jsonb_build_object('id',p.id,'approvalId',p_approval_id,'slot',p.slot,'entitlementId','0x'||encode(p.entitlement_id,'hex'),
   'amountWei',p.amount_wei::text,'address',p.address,
   'prepared',exists(select 1 from app_private.reward_demo_copy_claim_events e where e.claim_id=p.id and kind='intent'),
   'consented',exists(select 1 from app_private.reward_demo_copy_claim_events e where e.claim_id=p.id and kind='recipient'),
   'approved',exists(select 1 from app_private.reward_demo_copy_claim_events e where e.claim_id=p.id and kind='operator'),
   'paid',exists(select 1 from app_private.reward_demo_copy_claim_events e where e.claim_id=p.id and kind='receipt')) item from page p
 ) select jsonb_build_object('items',coalesce(jsonb_agg(item order by id),'[]'::jsonb),
  'nextCursor',case when (select count(*) from eligible)>50 then (select id from page order by id desc limit 1) end) from rows
$$;
create function public.service_reward_demo_copy_claim_reviews(p_user_id uuid,p_session_id uuid,p_approval_id uuid,p_after uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a app_private.reward_sponsor_allocation_approvals_v4%rowtype; result jsonb;
begin
 perform app_private.require_reward_demo_copy_reviewer(p_user_id,p_session_id);
 select * into a from app_private.reward_sponsor_allocation_approvals_v4 where id=p_approval_id;
 if a.id is null then raise exception 'reward_claim_scope_required';end if;
 perform app_private.read_reward_demo_copy_upload(p_user_id,p_session_id,10143,a.setup_id,a.slot,a.id);
 result:=app_private.reward_demo_copy_claim_queue(a.id,p_after);
 perform app_private.require_reward_demo_copy_reviewer(p_user_id,p_session_id);
 return result;
end $$;
create function public.service_reward_demo_copy_native_claims(p_subject text,p_operator text,p_approval_id uuid,p_after uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a app_private.reward_sponsor_allocation_approvals_v4%rowtype; result jsonb;
begin
 perform app_private.require_reward_demo_copy_controller(p_operator,p_subject);
 select * into a from app_private.reward_sponsor_allocation_approvals_v4 where id=p_approval_id;
 if a.id is null then raise exception 'reward_claim_scope_required';end if;
 perform app_private.reward_demo_copy_controller(p_operator,p_subject,10143,a.setup_id,a.id);
 result:=app_private.reward_demo_copy_claim_queue(a.id,p_after);
 perform app_private.require_reward_demo_copy_controller(p_operator,p_subject);
 return result;
end $$;
revoke all on function app_private.reward_demo_copy_claim_queue(uuid,uuid),
 public.service_reward_demo_copy_claim_reviews(uuid,uuid,uuid,uuid),
 public.service_reward_demo_copy_native_claims(text,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_claim_reviews(uuid,uuid,uuid,uuid),
 public.service_reward_demo_copy_native_claims(text,text,uuid,uuid) to service_role;
revoke all on function app_private.reward_demo_copy_claim_reviewer_current(uuid),
 app_private.reward_demo_copy_claim(uuid,uuid,integer,uuid,text,text,text,text,text),
 public.service_reward_demo_copy_claim(uuid,uuid,uuid,text,text,text),
 public.service_reward_demo_copy_native_claim(text,text,uuid,text,text),
 public.service_reward_demo_copy_athlete_awards(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_claim(uuid,uuid,uuid,text,text,text),
 public.service_reward_demo_copy_native_claim(text,text,uuid,text,text),
 public.service_reward_demo_copy_athlete_awards(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
