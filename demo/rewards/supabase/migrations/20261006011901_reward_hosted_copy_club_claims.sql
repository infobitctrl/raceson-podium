begin;
-- Ordinary readiness/recipient consent and native operator approval are separate
-- immutable authorities. No native DID is replaced by a fictitious user UUID.
create table app_private.reward_demo_copy_native_club_claim_events (
 claim_id uuid not null references app_private.reward_sponsor_club_claims_v4(id),
 kind text not null check(kind in('operator','receipt')),
 body_text text not null check(octet_length(body_text)<=32768),
 privy_subject text not null check(privy_subject ~ '^did:privy:[a-zA-Z0-9_-]{1,100}$'),
 operator text not null check(operator ~ '^0x[0-9a-f]{40}$'),
 created_at timestamptz not null default clock_timestamp(),primary key(claim_id,kind)
);
alter table app_private.reward_demo_copy_native_club_claim_events enable row level security;
revoke all on app_private.reward_demo_copy_native_club_claim_events from public,anon,authenticated,service_role;
create trigger immutable before update or delete on app_private.reward_demo_copy_native_club_claim_events
 for each row execute function app_private.reward_result_review_immutable_v3();
create view app_private.reward_demo_copy_club_claim_events as
 select claim_id,kind,body_text,actor_user_id,null::text privy_subject,null::text operator,created_at
 from app_private.reward_sponsor_club_claim_events_v4 where kind in('intent','recipient','revoked')
 union all select claim_id,kind,body_text,null::uuid,privy_subject,operator,created_at from app_private.reward_demo_copy_native_club_claim_events;
revoke all on app_private.reward_demo_copy_club_claim_events from public,anon,authenticated,service_role;
create function app_private.reward_demo_copy_club_claim(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_claim_id uuid,
 p_role text,p_action text default null,p_body_text text default null,p_subject text default null,p_operator text default null)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare c app_private.reward_sponsor_club_claims_v4%rowtype; a app_private.reward_sponsor_allocation_approvals_v4%rowtype;
 r app_private.reward_sponsor_recipients_v4%rowtype; n app_private.reward_club_treasury_requests%rowtype; owner_now jsonb; clubs jsonb;
 pub app_private.reward_sponsor_lifecycle_v4%rowtype; u app_private.reward_sponsor_uploads_v4%rowtype;
 execution app_private.reward_sponsor_executions%rowtype;
 b jsonb; old app_private.reward_demo_copy_club_claim_events%rowtype; account jsonb; events jsonb; source_stamp text; fingerprint text; current boolean; destination jsonb;

begin
 if p_role='recipient' then
  clubs:=app_private.require_reward_demo_copy_club(p_actor_user_id,p_actor_session_id);
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
  if p_action='request' and (not(b ?& array['approvalId','entitlementId','requestId']) or (select count(*) from jsonb_object_keys(b))<>3)
   or p_action='intent' and (not(b ?& array['sourceStamp','profileFingerprint','attestation','claim','witness']) or (select count(*) from jsonb_object_keys(b))<>5)
   or p_action='revoked' and b is distinct from '{"reason":"operator_hold"}'::jsonb
   then raise exception 'invalid_sponsor_claim';end if;
  if p_action in('recipient','operator') then
   if not(b ?& array['protocolVersion','role','signer','digest','signature'])
    or (select count(*) from jsonb_object_keys(b))<>(case when p_action='recipient' then 6 else 5 end)
    or p_action='recipient' and (not(b?'wrappedDigest') or coalesce(b->>'wrappedDigest','') !~ '^0x[0-9a-f]{64}$')
    or b->'protocolVersion' is distinct from '4'::jsonb or b->>'role' is distinct from p_action
    or coalesce(b->>'digest','') !~ '^0x[0-9a-f]{64}$' or coalesce(b->>'signature','') !~ (case when p_action='recipient' then '^0x[0-9a-f]{130}[0-9a-f]{130}$' else '^0x[0-9a-f]{130}$' end)
    then raise exception 'invalid_sponsor_claim';end if;
  elsif p_action='receipt' then
   if not(b ?& array['transactionHash','amountWei','recipient','blockNumber','blockHash']) or (select count(*) from jsonb_object_keys(b))<>5
    or coalesce(b->>'transactionHash','') !~ '^0x[0-9a-f]{64}$' or coalesce(b->>'blockHash','') !~ '^0x[0-9a-f]{64}$'
    or coalesce(b->>'blockNumber','') !~ '^[0-9]+$' then raise exception 'invalid_sponsor_claim';end if;
  end if;
 end if;
 if p_action='request' then
  if p_role<>'recipient' or b is null or jsonb_typeof(b)<>'object' or (select count(*) from jsonb_object_keys(b))<>3 then raise exception 'invalid_sponsor_claim'; end if;
  select * into n from app_private.reward_club_treasury_requests where id=(b->>'requestId')::uuid and user_id=p_actor_user_id;
  select * into r from app_private.reward_sponsor_recipients_v4 where approval_id=(b->>'approvalId')::uuid and entitlement_id=decode(substr(b->>'entitlementId',3),'hex')
   and beneficiary_kind='club' and beneficiary_id=n.club_id;
  if n.id is null or r.entitlement_id is null then raise exception 'reward_claim_scope_required'; end if;
  select * into c from app_private.reward_sponsor_club_claims_v4 where id=p_claim_id;
  if c.id is not null and (c.recipient_user_id<>p_actor_user_id or c.request_id<>n.id or c.approval_id<>r.approval_id or c.entitlement_id<>r.entitlement_id) then raise exception 'reward_sponsor_claim_conflict'; end if;
 else
  select * into c from app_private.reward_sponsor_club_claims_v4 where id=p_claim_id;
  if c.id is null then raise exception 'reward_claim_scope_required'; end if;
  select * into n from app_private.reward_club_treasury_requests where id=c.request_id;
  select * into r from app_private.reward_sponsor_recipients_v4 where entitlement_id=c.entitlement_id and approval_id=c.approval_id;
 end if;
 select * into a from app_private.reward_sponsor_allocation_approvals_v4 where id=r.approval_id;
 select * into pub from app_private.reward_sponsor_lifecycle_v4 where approval_id=a.id and kind='publication';
 select * into u from app_private.reward_sponsor_uploads_v4 where approval_id=a.id;
 select * into execution from app_private.reward_sponsor_executions where setup_id=a.setup_id;
 if pub.id is null or u.id is null or execution.plan->>'chainId'<>p_chain_id::text or n.chain_id is distinct from 10143 or r.beneficiary_kind is distinct from 'club' or r.beneficiary_id is distinct from n.club_id
  or a.document_text::jsonb->>'schema' is distinct from 'podium-copy-allocation-document-v1'
  or not exists(select 1 from app_private.reward_demo_copy_launch_sources b where b.launch_id=execution.launch_id and b.launch_id=a.launch_id and b.batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644')
  or (p_role='recipient' and (p_actor_user_id<>n.user_id or not exists(select 1 from jsonb_array_elements(clubs) x where (x->>'id')::uuid=n.club_id)))
  or (p_role='operator' and execution.plan->>'operator' is distinct from p_operator) then raise exception 'reward_claim_scope_required'; end if;
 -- Real copied organization/reviewer authority precedes setup/profile locks.
 perform 1 from public.organization_memberships where user_id=pub.actor_user_id and organization_id='cdaebab4-2961-4cfa-87e0-d075cc43e29b' for share;
 perform 1 from public.organizations where id='cdaebab4-2961-4cfa-87e0-d075cc43e29b' for share;
 perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||a.setup_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('reward-club-account:'||n.user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('reward-club-treasury:'||n.club_id::text||':'||n.chain_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('sponsor-club-claim:'||p_claim_id::text,0));
 perform user_id from public.user_profiles where user_id in(pub.actor_user_id,n.user_id) order by user_id for share;
 perform id from public.clubs where id=n.club_id for share;
 perform id from public.athlete_profiles where claimed_by_user_id=n.user_id or id=(n.owner_identity->>'athleteProfileId')::uuid order by id for share;
 perform id from public.club_memberships where club_id=n.club_id order by id for share;
 perform id from public.club_roles where club_id=n.club_id order by id for share;
 owner_now:=app_private.reward_club_owner_identity(n.club_id,n.user_id);
 if p_role='recipient' and owner_now is null then raise exception 'reward_claim_scope_required';end if;
 destination:=app_private.reward_club_treasury_document(n);
 source_stamp:=coalesce(app_private.reward_demo_copy_source_stamp(a.id),repeat('0',64));fingerprint:=app_private.reward_club_review_fingerprint(n.id);
 current:=coalesce(exists(select 1 from public.user_profiles where user_id=n.user_id and status='active')
  and exists(select 1 from public.user_profiles where user_id=pub.actor_user_id and status='active')
  and app_private.reward_demo_copy_claim_reviewer_current(pub.actor_user_id)
  and source_stamp<>repeat('0',64) and source_stamp=pub.source_stamp and a.decision='approved'
  and not exists(select 1 from app_private.reward_distribution_setups d where d.id=a.setup_id and d.archived_at is not null) and destination->>'status'='pending_review'
  and not exists(select 1 from app_private.reward_sponsor_club_claim_events_v4 ce where ce.claim_id=p_claim_id and ce.kind='intent' and not app_private.reward_demo_copy_claim_reviewer_current(ce.actor_user_id))
  and owner_now is not null,false);
 if p_action='request' then
  select * into c from app_private.reward_sponsor_club_claims_v4 where id=p_claim_id;
  if c.id is not null and (c.recipient_user_id<>p_actor_user_id or c.request_id<>n.id or c.approval_id<>r.approval_id or c.entitlement_id<>r.entitlement_id) then raise exception 'reward_sponsor_claim_conflict'; end if;
 end if;
 if p_action='request' and c.id is null then
  -- A request records the representative's choice, not Safe-owner consent.
  if not current then raise exception 'reward_sponsor_claim_not_ready';end if;
  if (select count(*) from app_private.reward_sponsor_club_claims_v4 x where x.recipient_user_id=n.user_id and x.created_at>clock_timestamp()-interval '1 hour')>=12
   or (select count(*) from app_private.reward_sponsor_club_claims_v4 x where x.recipient_user_id=n.user_id and x.created_at>clock_timestamp()-interval '1 day')>=30
   then raise exception 'reward_sponsor_claim_conflict';end if;
  insert into app_private.reward_sponsor_club_claims_v4(id,approval_id,entitlement_id,request_id,recipient_user_id)
   values(p_claim_id,a.id,r.entitlement_id,n.id,n.user_id) returning * into c;
 elsif p_action is not null and p_action<>'request' then
  if p_action not in('intent','recipient','operator','receipt','revoked') or b is null or octet_length(p_body_text)>32768 then raise exception 'invalid_sponsor_claim'; end if;
  if (p_action='recipient' and p_role<>'recipient') or (p_action in('intent','revoked') and p_role<>'reviewer') or (p_action in('operator','receipt') and p_role<>'operator') then raise exception 'reward_claim_scope_required'; end if;
  if p_action in('recipient','operator') and b->>'signer' is distinct from (case when p_action='operator' then execution.plan->>'operator' else destination#>>'{candidate,safeAddress}' end)
   or p_action='receipt' and (b->>'recipient' is distinct from destination#>>'{candidate,safeAddress}' or b->>'amountWei' is distinct from r.amount_wei::text)
   then raise exception 'invalid_sponsor_claim';end if;
  select * into old from app_private.reward_demo_copy_club_claim_events where claim_id=c.id and kind=p_action;
  if found then
   if old.body_text<>p_body_text or old.actor_user_id is distinct from p_actor_user_id or old.privy_subject is distinct from p_subject or old.operator is distinct from p_operator then raise exception 'reward_sponsor_claim_conflict'; end if;
  else
   if not current or exists(select 1 from app_private.reward_demo_copy_club_claim_events where claim_id=c.id and kind='revoked') then raise exception 'reward_sponsor_claim_not_ready'; end if;
   if p_action='intent' then
    if b->>'sourceStamp' is distinct from source_stamp or b->>'profileFingerprint' is distinct from fingerprint
     or b#>>'{claim,recipient}' is distinct from destination#>>'{candidate,safeAddress}' or b#>>'{claim,entitlementId}' is distinct from '0x'||encode(r.entitlement_id,'hex')
     or b#>>'{claim,amount}' is distinct from r.amount_wei::text or not app_private.valid_reward_club_review_evidence(b->'attestation')
     or b#>'{attestation,candidate}' is distinct from n.candidate or b#>>'{attestation,chainId}' is distinct from p_chain_id::text
     or b#>>'{claim,pot}' is distinct from (case when a.slot=0 then 'league' else 'race' end)
     or coalesce(b#>>'{claim,nonce}','') !~ '^[0-9]+$' or coalesce(b#>>'{claim,issuedAt}','') !~ '^[1-9][0-9]+$'
     or coalesce(b#>>'{claim,expiresAt}','') !~ '^[1-9][0-9]+$'
     or (b#>>'{claim,expiresAt}')::numeric<=(b#>>'{claim,issuedAt}')::numeric
     or (b#>>'{claim,expiresAt}')::numeric>(b#>>'{claim,issuedAt}')::numeric+86400 then raise exception 'invalid_sponsor_claim'; end if;
    -- Another still-live intent for this entitlement cannot choose a competing destination.
    if exists(select 1 from app_private.reward_demo_copy_club_claim_events e join app_private.reward_sponsor_club_claims_v4 x on x.id=e.claim_id
      where x.entitlement_id=c.entitlement_id and e.kind='intent' and (e.body_text::jsonb#>>'{claim,expiresAt}')::numeric>(b#>>'{claim,issuedAt}')::numeric)
      then raise exception 'reward_sponsor_claim_conflict'; end if;
   elsif p_action in('recipient','operator','receipt') then
    select body_text::jsonb into events from app_private.reward_demo_copy_club_claim_events where claim_id=c.id and kind='intent';
    if events is null or events->>'sourceStamp'<>source_stamp or events->>'profileFingerprint'<>fingerprint then raise exception 'reward_sponsor_claim_not_ready'; end if;
    if p_action in('operator','receipt') and not exists(select 1 from app_private.reward_demo_copy_club_claim_events where claim_id=c.id and kind='recipient') then raise exception 'reward_recipient_consent_required'; end if;
    if p_action='receipt' and not exists(select 1 from app_private.reward_demo_copy_club_claim_events where claim_id=c.id and kind='operator') then raise exception 'reward_sponsor_claim_not_ready'; end if;
   end if;
   if p_role='operator' then
    insert into app_private.reward_demo_copy_native_club_claim_events(claim_id,kind,body_text,privy_subject,operator) values(c.id,p_action,p_body_text,p_subject,p_operator);
   else insert into app_private.reward_sponsor_club_claim_events_v4(claim_id,kind,body_text,actor_user_id) values(c.id,p_action,p_body_text,p_actor_user_id);end if;
  end if;
 end if;
 select coalesce(jsonb_object_agg(kind,body_text::jsonb),'{}'::jsonb) into events from app_private.reward_demo_copy_club_claim_events where claim_id=c.id;
 if events?'revoked' or (events?'intent' and (events#>>'{intent,sourceStamp}'<>source_stamp or events#>>'{intent,profileFingerprint}'<>fingerprint)) then current:=false; end if;
 if p_role='recipient' then
  clubs:=app_private.require_reward_demo_copy_club(p_actor_user_id,p_actor_session_id);
 elsif p_role='reviewer' then perform app_private.require_reward_demo_copy_reviewer(p_actor_user_id,p_actor_session_id);
 elsif p_role='operator' then
  if p_actor_user_id is not null or p_actor_session_id is not null then raise exception 'reward_claim_scope_required';end if;
  perform app_private.require_reward_demo_copy_controller(p_operator,p_subject);
 else raise exception 'reward_claim_scope_required';end if;
 if coalesce(app_private.reward_demo_copy_source_stamp(a.id),repeat('0',64)) is distinct from source_stamp or app_private.reward_club_review_fingerprint(n.id) is distinct from fingerprint
  or app_private.reward_club_treasury_document(n) is distinct from destination then raise exception 'reward_planning_revision_changed'; end if;
 return jsonb_build_object('claimId',c.id,'entitlementId','0x'||encode(c.entitlement_id,'hex'),'approvalId',a.id,'setupId',a.setup_id,'slot',a.slot,'current',current,'sourceStamp',source_stamp,'profileFingerprint',fingerprint,
  'nomination',destination,'package',u.package_text::jsonb,'packageHash',u.package_hash,
  'plan',execution.plan,'publication',pub.body_text::jsonb,'events',events);
end $$;


create function public.service_reward_demo_copy_club_claim(p_actor_user_id uuid,p_actor_session_id uuid,p_claim_id uuid,p_role text,
 p_action text default null,p_body_text text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 if p_role is null or p_role not in('recipient','reviewer') or (p_action is null)<>(p_body_text is null)
  or p_action is not null and not (p_role='recipient' and p_action in('request','recipient') or p_role='reviewer' and p_action in('intent','revoked'))
 then raise exception 'invalid_sponsor_claim';end if;
 return app_private.reward_demo_copy_club_claim(p_actor_user_id,p_actor_session_id,10143,p_claim_id,p_role,p_action,p_body_text);
end $$;
create function public.service_reward_demo_copy_native_club_claim(p_subject text,p_operator text,p_claim_id uuid,
 p_action text default null,p_body_text text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 if (p_action is null)<>(p_body_text is null) or p_action is not null and p_action not in('operator','receipt') then raise exception 'invalid_sponsor_claim';end if;
 return app_private.reward_demo_copy_club_claim(null,null,10143,p_claim_id,'operator',p_action,p_body_text,p_subject,p_operator);
end $$;
-- Deterministic keyset page, never a silently truncated aggregate of awards.
create function public.service_reward_demo_copy_club_awards(p_user_id uuid,p_session_id uuid,p_after text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare clubs jsonb; result jsonb; row jsonb;
begin
 clubs:=app_private.require_reward_demo_copy_club(p_user_id,p_session_id);
 if p_after is not null and p_after !~ '^0x[0-9a-f]{64}$' then raise exception 'invalid_sponsor_claim';end if;
 with eligible as (
 select r.entitlement_id,a.id approval_id,a.slot,r.amount_wei,r.beneficiary_id
 from app_private.reward_sponsor_recipients_v4 r join app_private.reward_sponsor_allocation_approvals_v4 a on a.id=r.approval_id
 join app_private.reward_sponsor_executions e on e.setup_id=a.setup_id and e.plan->>'chainId'='10143'
 join app_private.reward_demo_copy_launch_sources b on b.launch_id=e.launch_id and b.launch_id=a.launch_id
  and b.batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644'
 join public.clubs club on club.id=r.beneficiary_id
 where r.beneficiary_kind='club' and app_private.reward_club_owner_identity(club.id,p_user_id) is not null
  and exists(select 1 from jsonb_array_elements(clubs) x where (x->>'id')::uuid=club.id)
  and a.document_text::jsonb->>'schema'='podium-copy-allocation-document-v1'
  and exists(select 1 from app_private.reward_sponsor_lifecycle_v4 where approval_id=a.id and kind='publication')
  and (p_after is null or r.entitlement_id>decode(substr(p_after,3),'hex'))
 order by r.entitlement_id limit 51
 ), page as (select * from eligible order by entitlement_id limit 50), rows as (
 select entitlement_id,jsonb_build_object('approvalId',approval_id,'slot',slot,'entitlementId','0x'||encode(entitlement_id,'hex'),
  'amountWei',amount_wei::text,'clubId',beneficiary_id,'claims',coalesce((select jsonb_agg(jsonb_build_object(
   'id',c.id,'prepared',exists(select 1 from app_private.reward_demo_copy_club_claim_events x where x.claim_id=c.id and kind='intent'),
   'consented',exists(select 1 from app_private.reward_demo_copy_club_claim_events x where x.claim_id=c.id and kind='recipient'),
   'approved',exists(select 1 from app_private.reward_demo_copy_club_claim_events x where x.claim_id=c.id and kind='operator'),
   'paid',exists(select 1 from app_private.reward_demo_copy_club_claim_events x where x.claim_id=c.id and kind='receipt')) order by c.created_at,c.id)
   from app_private.reward_sponsor_club_claims_v4 c where c.entitlement_id=page.entitlement_id and c.recipient_user_id=p_user_id),'[]'::jsonb)) item from page
 ) select jsonb_build_object('items',coalesce(jsonb_agg(item order by entitlement_id),'[]'::jsonb),
  'nextCursor',case when (select count(*) from eligible)>50 then (select '0x'||encode(entitlement_id,'hex') from page order by entitlement_id desc limit 1) end) into result from rows;
 perform app_private.require_reward_demo_copy_club(p_user_id,p_session_id);
 for row in select value from jsonb_array_elements(result->'items') loop
  if app_private.reward_club_owner_identity((row->>'clubId')::uuid,p_user_id) is null then raise exception 'reward_club_owner_required';end if;
 end loop;
 return result;
end $$;
-- Only an exact reviewed copied approval can reveal its recipient requests.
create function app_private.reward_demo_copy_club_claim_queue(p_approval_id uuid,p_after uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 with eligible as (
  select c.id,c.entitlement_id,r.amount_wei,app_private.reward_club_treasury_document(n)#>>'{candidate,safeAddress}' address,a.slot
  from app_private.reward_sponsor_club_claims_v4 c join app_private.reward_sponsor_recipients_v4 r
   on r.approval_id=c.approval_id and r.entitlement_id=c.entitlement_id and r.beneficiary_kind='club'
  join app_private.reward_club_treasury_requests n on n.id=c.request_id
  join app_private.reward_sponsor_allocation_approvals_v4 a on a.id=c.approval_id
  where c.approval_id=p_approval_id and (p_after is null or c.id>p_after)
   and a.document_text::jsonb->>'schema'='podium-copy-allocation-document-v1'
  order by c.id limit 51
 ), page as (select * from eligible order by id limit 50), rows as (
  select p.id,jsonb_build_object('id',p.id,'approvalId',p_approval_id,'slot',p.slot,'entitlementId','0x'||encode(p.entitlement_id,'hex'),
   'amountWei',p.amount_wei::text,'address',p.address,
   'prepared',exists(select 1 from app_private.reward_demo_copy_club_claim_events e where e.claim_id=p.id and kind='intent'),
   'consented',exists(select 1 from app_private.reward_demo_copy_club_claim_events e where e.claim_id=p.id and kind='recipient'),
   'approved',exists(select 1 from app_private.reward_demo_copy_club_claim_events e where e.claim_id=p.id and kind='operator'),
   'paid',exists(select 1 from app_private.reward_demo_copy_club_claim_events e where e.claim_id=p.id and kind='receipt')) item from page p
 ) select jsonb_build_object('items',coalesce(jsonb_agg(item order by id),'[]'::jsonb),
  'nextCursor',case when (select count(*) from eligible)>50 then (select id from page order by id desc limit 1) end) from rows
$$;
create function public.service_reward_demo_copy_club_claim_reviews(p_user_id uuid,p_session_id uuid,p_approval_id uuid,p_after uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a app_private.reward_sponsor_allocation_approvals_v4%rowtype; result jsonb;
begin
 perform app_private.require_reward_demo_copy_reviewer(p_user_id,p_session_id);
 select * into a from app_private.reward_sponsor_allocation_approvals_v4 where id=p_approval_id;
 if a.id is null then raise exception 'reward_claim_scope_required';end if;
 perform app_private.read_reward_demo_copy_upload(p_user_id,p_session_id,10143,a.setup_id,a.slot,a.id);
 result:=app_private.reward_demo_copy_club_claim_queue(a.id,p_after);
 perform app_private.require_reward_demo_copy_reviewer(p_user_id,p_session_id);
 return result;
end $$;
create function public.service_reward_demo_copy_native_club_claims(p_subject text,p_operator text,p_approval_id uuid,p_after uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a app_private.reward_sponsor_allocation_approvals_v4%rowtype; result jsonb;
begin
 perform app_private.require_reward_demo_copy_controller(p_operator,p_subject);
 select * into a from app_private.reward_sponsor_allocation_approvals_v4 where id=p_approval_id;
 if a.id is null then raise exception 'reward_claim_scope_required';end if;
 perform app_private.reward_demo_copy_controller(p_operator,p_subject,10143,a.setup_id,a.id);
 result:=app_private.reward_demo_copy_club_claim_queue(a.id,p_after);
 perform app_private.require_reward_demo_copy_controller(p_operator,p_subject);
 return result;
end $$;
revoke all on function app_private.reward_demo_copy_club_claim_queue(uuid,uuid),
 public.service_reward_demo_copy_club_claim_reviews(uuid,uuid,uuid,uuid),
 public.service_reward_demo_copy_native_club_claims(text,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_club_claim_reviews(uuid,uuid,uuid,uuid),
 public.service_reward_demo_copy_native_club_claims(text,text,uuid,uuid) to service_role;
revoke all on function app_private.reward_demo_copy_claim_reviewer_current(uuid),
 app_private.reward_demo_copy_club_claim(uuid,uuid,integer,uuid,text,text,text,text,text),
 public.service_reward_demo_copy_club_claim(uuid,uuid,uuid,text,text,text),
 public.service_reward_demo_copy_native_club_claim(text,text,uuid,text,text),
 public.service_reward_demo_copy_club_awards(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_club_claim(uuid,uuid,uuid,text,text,text),
 public.service_reward_demo_copy_native_club_claim(text,text,uuid,text,text),
 public.service_reward_demo_copy_club_awards(uuid,uuid,text) to service_role;
create or replace function app_private.reward_demo_copy_controller_transaction(p_subject text,p_sender text,p_action text,
 p_id uuid default null,p_context jsonb default null,p_transaction jsonb default null,p_signed text default null,p_hash text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare j app_private.reward_controller_transactions%rowtype; n bigint; ctx jsonb; facts jsonb; source jsonb;
begin
 perform app_private.require_reward_demo_copy_controller(p_sender,p_subject);
 if p_subject is null or p_subject not like 'did:privy:%' or p_sender is null or p_sender !~ '^0x[0-9a-f]{40}$'
  or p_action is null or p_action not in('read','reserve','signed','confirm') then raise exception 'controller_transaction_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-auto-creation',0));
 if p_id is null then
  select * into j from app_private.reward_controller_transactions where sender=p_sender and subject=p_subject and not confirmed order by nonce limit 1;
 else select * into j from app_private.reward_controller_transactions where id=p_id and sender=p_sender and subject=p_subject for update; end if;
 if p_action='read' then
  if p_context is not null or p_transaction is not null or p_signed is not null or p_hash is not null then raise exception 'controller_transaction_invalid';end if;
  if j.id is not null then
   if coalesce(j.context->>'kind','') not in('distribution','claim','clubClaim') then return 'null'::jsonb;end if;
   -- A stale decision must not hide a pending nonce. Read diagnostics only;
   -- signed/confirm/reserve still require the current exact approved handoff.
   perform app_private.reward_demo_copy_controller(p_sender,p_subject,10143,(j.context->>'setupId')::uuid);
  end if;
 else
  if p_action='reserve' then
   if p_signed is not null or p_hash is not null or p_context is null or jsonb_typeof(p_context) is distinct from 'object'
    or jsonb_typeof(p_context->'source') is distinct from 'string' or octet_length(p_context::text)>8388608
    then raise exception 'controller_transaction_invalid';end if;
   if p_context->>'kind'='distribution' then
    if (select count(*) from jsonb_object_keys(p_context))<>7 or not(p_context ?& array['kind','setupId','approvalId','action','start','end','source'])
     or coalesce(p_context->>'action','') not in('upload','stage','activate')
     or coalesce(p_context->>'start','') !~ '^(0|[1-9][0-9]{0,4})$' or coalesce(p_context->>'end','') !~ '^(0|[1-9][0-9]{0,4})$'
     or (p_context->>'start')::integer>(p_context->>'end')::integer then raise exception 'controller_transaction_invalid';end if;
   elsif p_context->>'kind' in('claim','clubClaim') then
    if (select count(*) from jsonb_object_keys(p_context))<>5 or not(p_context ?& array['kind','claimId','setupId','approvalId','source'])
     then raise exception 'controller_transaction_invalid';end if;
   else raise exception 'controller_transaction_invalid';end if;
   if j.id is not null and (j.context is distinct from p_context or j.transaction-'nonce' is distinct from p_transaction-'nonce') then raise exception 'controller_transaction_invalid';end if;
   ctx:=p_context;
  else
   if p_context is not null or p_transaction is not null then raise exception 'controller_transaction_invalid';end if;
   ctx:=j.context;
  end if;
  if ctx->>'kind'='distribution' then
   facts:=app_private.reward_demo_copy_controller(p_sender,p_subject,10143,(ctx->>'setupId')::uuid,(ctx->>'approvalId')::uuid);
   source:=(ctx->>'source')::jsonb;
   if source#>>'{upload,documentHash}' is distinct from facts#>>'{upload,documentHash}'
    or source#>>'{upload,prepared,packageHash}' is distinct from facts#>>'{upload,prepared,packageHash}'
    or source#>>'{publication,bodyHash}' is distinct from facts#>>'{publication,bodyHash}'
    then raise exception 'controller_source_not_ready';end if;
  elsif ctx->>'kind' in('claim','clubClaim') then
   if ctx->>'kind'='clubClaim' then
    facts:=app_private.reward_demo_copy_club_claim(null,null,10143,(ctx->>'claimId')::uuid,'operator',null,null,p_subject,p_sender);
   else facts:=app_private.reward_demo_copy_claim(null,null,10143,(ctx->>'claimId')::uuid,'operator',null,null,p_subject,p_sender);end if;
   source:=(ctx->>'source')::jsonb;
   if facts->'current' is distinct from 'true'::jsonb or facts->>'setupId' is distinct from ctx->>'setupId'
    or facts->>'approvalId' is distinct from ctx->>'approvalId' or facts#>>'{plan,operator}' is distinct from p_sender
    or not(facts->'events' ?& array['intent','recipient','operator']) or facts->'events' ? 'revoked'
    or source is distinct from jsonb_build_object('claimId',facts->'claimId','setupId',facts->'setupId','approvalId',facts->'approvalId',
     'sourceStamp',facts->'sourceStamp','profileFingerprint',facts->'profileFingerprint','packageHash',facts->'packageHash',
     'claim',facts#>'{events,intent,claim}',
     'recipient',jsonb_build_object('digest',facts#>'{events,recipient,digest}','signer',facts#>'{events,recipient,signer}'),
     'operator',jsonb_build_object('digest',facts#>'{events,operator,digest}','signer',facts#>'{events,operator,signer}'))
    then raise exception 'controller_source_not_ready';end if;
   if p_action='confirm' then
    if facts#>>'{events,receipt,transactionHash}' is distinct from p_hash then raise exception 'controller_receipt_invalid';end if;
   elsif facts->'events' ? 'receipt' then raise exception 'controller_source_not_ready';end if;
  else raise exception 'controller_transaction_invalid';end if;

 end if;
 if p_action='reserve' and j.id is null then
  if p_id is null or p_context is null or p_transaction is null or jsonb_typeof(p_transaction)<>'object'
   or p_transaction->'chainId' is distinct from '10143'::jsonb or p_transaction->'value' is distinct from '"0"'::jsonb
   or not(p_transaction ?& array['chainId','data','value','nonce','gas','gasPrice'])
   or (select count(*) from jsonb_object_keys(p_transaction))<>(case when p_transaction?'to' then 7 else 6 end)
   or exists(select 1 from jsonb_each(p_transaction) kv where kv.key<>'chainId' and jsonb_typeof(kv.value)<>'string')
   or p_transaction?'to' and p_transaction->>'to' !~ '^0x[0-9a-f]{40}$'
   or p_transaction->>'data' !~ '^0x[0-9a-f]+$' or octet_length(p_transaction::text)>200000
   or p_transaction->>'nonce' !~ '^[0-9]{1,12}$' or p_transaction->>'gas' !~ '^[0-9]{1,8}$' or p_transaction->>'gasPrice' !~ '^[0-9]{1,15}$'
   or (p_transaction->>'gas')::numeric not between 1 and 30000000 or (p_transaction->>'gasPrice')::numeric<=0
   or (p_transaction->>'gas')::numeric*(p_transaction->>'gasPrice')::numeric>500000000000000000
   then raise exception 'controller_transaction_invalid'; end if;
  if exists(select 1 from app_private.reward_controller_transactions where sender=p_sender and not confirmed)
   or exists(select 1 from app_private.reward_sponsor_auto_deployments where sender=p_sender and not confirmed)
   then raise exception 'controller_transaction_pending'; end if;
  select greatest((p_transaction->>'nonce')::bigint,coalesce(max(q.nonce)+1,0)) into n from (
   select nonce from app_private.reward_controller_transactions where sender=p_sender union all
   select nonce from app_private.reward_sponsor_auto_deployments where sender=p_sender) q;
  insert into app_private.reward_controller_transactions(id,subject,sender,nonce,context,transaction)
   values(p_id,p_subject,p_sender,n,p_context,jsonb_set(p_transaction,'{nonce}',to_jsonb(n::text))) returning * into j;
 elsif p_action in('signed','confirm') then
  if j.id is null then raise exception 'controller_transaction_invalid'; end if;
  if p_action='signed' then
   if p_signed is null or p_hash is null or j.signed_transaction is not null and (j.signed_transaction<>p_signed or j.transaction_hash<>p_hash) then raise exception 'controller_transaction_invalid'; end if;
   update app_private.reward_controller_transactions set signed_transaction=p_signed,transaction_hash=p_hash where id=j.id returning * into j;
  else
   if j.transaction_hash is null or p_hash is distinct from j.transaction_hash then raise exception 'controller_transaction_invalid'; end if;
   update app_private.reward_controller_transactions set confirmed=true where id=j.id returning * into j;
  end if;
 end if;
 perform app_private.require_reward_demo_copy_controller(p_sender,p_subject);
 if j.id is null then return 'null'::jsonb; end if;
 return jsonb_build_object('id',j.id,'subject',j.subject,'sender',j.sender,'context',j.context,'transaction',j.transaction,
  'signedTransaction',j.signed_transaction,'hash',j.transaction_hash,'confirmed',j.confirmed);
end $$;

revoke all on function app_private.reward_demo_copy_controller_transaction(text,text,text,uuid,jsonb,jsonb,text,text) from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
