begin;

-- V4 club claims keep Safe nominations and human treasury review separate from athlete wallets.
create table app_private.reward_sponsor_club_claims_v4 (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'),
 approval_id uuid not null references app_private.reward_sponsor_allocation_approvals_v4(id),
 entitlement_id bytea not null references app_private.reward_sponsor_recipients_v4(entitlement_id),
 request_id uuid not null references app_private.reward_club_treasury_requests(id),
 recipient_user_id uuid not null references public.user_profiles(user_id),
 created_at timestamptz not null default clock_timestamp()
);
create table app_private.reward_sponsor_club_claim_events_v4 (
 claim_id uuid not null references app_private.reward_sponsor_club_claims_v4(id),
 kind text not null check(kind in('intent','recipient','operator','receipt','revoked')),
 body_text text not null check(octet_length(body_text)<=32768),
 actor_user_id uuid not null references public.user_profiles(user_id),
 created_at timestamptz not null default clock_timestamp(),primary key(claim_id,kind)
);
do $$ declare n text; begin
 foreach n in array array['reward_sponsor_club_claims_v4','reward_sponsor_club_claim_events_v4'] loop
 execute format('alter table app_private.%I enable row level security',n);
 execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',n);
 execute format('grant select,insert on app_private.%I to service_role',n);
 execute format('create policy service_read on app_private.%I for select to service_role using(true)',n);
 execute format('create policy service_insert on app_private.%I for insert to service_role with check(true)',n);
 execute format('create trigger immutable before update or delete on app_private.%I for each row execute function app_private.reward_result_review_immutable_v3()',n);
 end loop;
end $$;

create function public.service_sponsor_club_claim_v4(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_claim_id uuid,
 p_role text,p_action text default null,p_body_text text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_sponsor_club_claims_v4%rowtype; a app_private.reward_sponsor_allocation_approvals_v4%rowtype;
 r app_private.reward_sponsor_recipients_v4%rowtype; n app_private.reward_club_treasury_requests%rowtype; owner_now jsonb;
 pub app_private.reward_sponsor_lifecycle_v4%rowtype; u app_private.reward_sponsor_uploads_v4%rowtype;
 execution app_private.reward_sponsor_executions%rowtype;
 b jsonb; old app_private.reward_sponsor_club_claim_events_v4%rowtype; events jsonb; source_stamp text; fingerprint text; current boolean; destination jsonb;
 fresh jsonb;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(31337,10143) or p_role is null or p_role not in('recipient','operator') then raise exception 'reward_claim_scope_required'; end if;
 b:=p_body_text::jsonb;
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
 if pub.id is null or u.id is null or execution.plan->>'chainId'<>p_chain_id::text or n.chain_id is distinct from p_chain_id
  or (p_role='recipient' and p_actor_user_id<>n.user_id) or (p_role='operator' and p_actor_user_id<>pub.actor_user_id) then raise exception 'reward_claim_scope_required'; end if;
 -- Established organization -> draft -> wallet/profile lock order.
 perform 1 from public.organization_memberships where user_id=pub.actor_user_id and organization_id=(select organization_id from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid) for share;
 perform 1 from public.organizations where id=(select organization_id from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid) for share;
 if p_role='operator' then
  fresh:=public.service_read_reward_sponsor_upload_v4(p_actor_user_id,p_actor_session_id,p_chain_id,a.setup_id,a.slot,a.id);
 else
  perform 1 from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid for update;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-club-account:'||n.user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('reward-club-treasury:'||n.club_id::text||':'||n.chain_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('sponsor-club-claim:'||p_claim_id::text,0));
 perform user_id from public.user_profiles where user_id in(pub.actor_user_id,n.user_id) order by user_id for share;
 perform id from public.clubs where id=n.club_id for share;
 perform id from public.athlete_profiles where claimed_by_user_id=n.user_id or id=(n.owner_identity->>'athleteProfileId')::uuid order by id for share;
 perform id from public.club_memberships where club_id=n.club_id order by id for share;
 perform id from public.club_roles where club_id=n.club_id order by id for share;
 owner_now:=app_private.reward_club_owner_identity(n.club_id,n.user_id);
 if p_role='recipient' and owner_now is null then raise exception 'reward_claim_scope_required'; end if;
 destination:=app_private.reward_club_treasury_document(n);
 source_stamp:=app_private.reward_sponsor_source_stamp_v4(a.id);fingerprint:=app_private.reward_club_review_fingerprint(n.id);
 current:=coalesce(exists(select 1 from public.user_profiles where user_id=n.user_id and status='active')
  and exists(select 1 from public.user_profiles where user_id=pub.actor_user_id and status='active')
  and app_private.reward_planning_authorized(pub.actor_user_id,(select organization_id from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid))
  and source_stamp=pub.source_stamp and (p_role<>'operator' or fresh->>'current'='true') and destination->>'status'='pending_review'
  and owner_now is not null,false);
 if p_action='request' then
  select * into c from app_private.reward_sponsor_club_claims_v4 where id=p_claim_id;
  if c.id is not null and (c.recipient_user_id<>p_actor_user_id or c.request_id<>n.id or c.approval_id<>r.approval_id or c.entitlement_id<>r.entitlement_id) then raise exception 'reward_sponsor_claim_conflict'; end if;
 end if;
 if p_action='request' and c.id is null then
  if not current then raise exception 'reward_sponsor_claim_not_ready'; end if;
  insert into app_private.reward_sponsor_club_claims_v4(id,approval_id,entitlement_id,request_id,recipient_user_id)
   values(p_claim_id,a.id,r.entitlement_id,n.id,n.user_id) returning * into c;
 elsif p_action is not null and p_action<>'request' then
  if p_action not in('intent','recipient','operator','receipt','revoked') or b is null or octet_length(p_body_text)>32768 then raise exception 'invalid_sponsor_claim'; end if;
  if (p_action='recipient' and p_role<>'recipient') or (p_action<>'recipient' and p_role<>'operator') then raise exception 'reward_claim_scope_required'; end if;
  select * into old from app_private.reward_sponsor_club_claim_events_v4 where claim_id=c.id and kind=p_action;
  if found then
   if old.body_text<>p_body_text or old.actor_user_id<>p_actor_user_id then raise exception 'reward_sponsor_claim_conflict'; end if;
  else
   if not current or exists(select 1 from app_private.reward_sponsor_club_claim_events_v4 where claim_id=c.id and kind='revoked') then raise exception 'reward_sponsor_claim_not_ready'; end if;
   if p_action='intent' then
    if b->>'sourceStamp' is distinct from source_stamp or b->>'profileFingerprint' is distinct from fingerprint
     or b#>>'{claim,recipient}' is distinct from destination#>>'{candidate,safeAddress}' or b#>>'{claim,entitlementId}' is distinct from '0x'||encode(r.entitlement_id,'hex')
     or b#>>'{claim,amount}' is distinct from r.amount_wei::text
     or not app_private.valid_reward_club_review_evidence(b->'attestation')
     or b#>'{attestation,candidate}' is distinct from n.candidate or b#>>'{attestation,chainId}' is distinct from p_chain_id::text
     or b#>>'{claim,pot}' is distinct from (case when a.slot=0 then 'league' else 'race' end)
     or coalesce(b#>>'{claim,nonce}','') !~ '^[0-9]+$' or coalesce(b#>>'{claim,issuedAt}','') !~ '^[1-9][0-9]+$'
     or coalesce(b#>>'{claim,expiresAt}','') !~ '^[1-9][0-9]+$'
     or (b#>>'{claim,expiresAt}')::numeric<=(b#>>'{claim,issuedAt}')::numeric
     or (b#>>'{claim,expiresAt}')::numeric>(b#>>'{claim,issuedAt}')::numeric+86400 then raise exception 'invalid_sponsor_claim'; end if;
    -- Another still-live intent for this entitlement cannot choose a competing destination.
    if exists(select 1 from app_private.reward_sponsor_club_claim_events_v4 e join app_private.reward_sponsor_club_claims_v4 x on x.id=e.claim_id
      where x.entitlement_id=c.entitlement_id and e.kind='intent' and (e.body_text::jsonb#>>'{claim,expiresAt}')::numeric>(b#>>'{claim,issuedAt}')::numeric)
      then raise exception 'reward_sponsor_claim_conflict'; end if;
   elsif p_action in('recipient','operator','receipt') then
    select body_text::jsonb into events from app_private.reward_sponsor_club_claim_events_v4 where claim_id=c.id and kind='intent';
    if events is null or events->>'sourceStamp'<>source_stamp or events->>'profileFingerprint'<>fingerprint then raise exception 'reward_sponsor_claim_not_ready'; end if;
    if p_action in('operator','receipt') and not exists(select 1 from app_private.reward_sponsor_club_claim_events_v4 where claim_id=c.id and kind='recipient') then raise exception 'reward_recipient_consent_required'; end if;
    if p_action='receipt' and not exists(select 1 from app_private.reward_sponsor_club_claim_events_v4 where claim_id=c.id and kind='operator') then raise exception 'reward_sponsor_claim_not_ready'; end if;
   end if;
   insert into app_private.reward_sponsor_club_claim_events_v4(claim_id,kind,body_text,actor_user_id) values(c.id,p_action,p_body_text,p_actor_user_id);
  end if;
 end if;
 select coalesce(jsonb_object_agg(kind,body_text::jsonb),'{}'::jsonb) into events from app_private.reward_sponsor_club_claim_events_v4 where claim_id=c.id;
 if events?'revoked' or (events?'intent' and (events#>>'{intent,sourceStamp}'<>source_stamp or events#>>'{intent,profileFingerprint}'<>fingerprint)) then current:=false; end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if app_private.reward_sponsor_source_stamp_v4(a.id) is distinct from source_stamp or app_private.reward_club_review_fingerprint(n.id) is distinct from fingerprint
  or app_private.reward_club_treasury_document(n) is distinct from destination then raise exception 'reward_planning_revision_changed'; end if;
 return jsonb_build_object('claimId',c.id,'entitlementId','0x'||encode(c.entitlement_id,'hex'),'approvalId',a.id,'setupId',a.setup_id,'slot',a.slot,'current',current,'sourceStamp',source_stamp,'profileFingerprint',fingerprint,
  'nomination',destination,'package',u.package_text::jsonb,'packageHash',u.package_hash,
  'plan',execution.plan,'publication',pub.body_text::jsonb,'events',events);
end $$;

create function public.service_list_sponsor_club_claims_v4(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_approval_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare selected_approval app_private.reward_sponsor_allocation_approvals_v4%rowtype; result jsonb;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(31337,10143) then raise exception 'reward_claim_scope_required'; end if;
 if p_approval_id is not null then
  select * into selected_approval from app_private.reward_sponsor_allocation_approvals_v4 where id=p_approval_id;
  perform public.service_read_reward_sponsor_upload_v4(p_actor_user_id,p_actor_session_id,p_chain_id,selected_approval.setup_id,selected_approval.slot,selected_approval.id);
  if not exists(select 1 from app_private.reward_sponsor_lifecycle_v4 where approval_id=selected_approval.id and kind='publication' and actor_user_id=p_actor_user_id) then raise exception 'reward_claim_scope_required'; end if;
 end if;
 select coalesce(jsonb_agg(row order by row->>'entitlementId'),'[]'::jsonb) into result from (
 select jsonb_build_object('approvalId',a.id,'slot',a.slot,'entitlementId','0x'||encode(r.entitlement_id,'hex'),'amountWei',r.amount_wei::text,
 'clubId',case when p_approval_id is null then r.beneficiary_id else null end,
 'claims',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'prepared',exists(select 1 from app_private.reward_sponsor_club_claim_events_v4 e where e.claim_id=c.id and e.kind='intent'),
  'consented',exists(select 1 from app_private.reward_sponsor_club_claim_events_v4 e where e.claim_id=c.id and e.kind='recipient'),
  'approved',exists(select 1 from app_private.reward_sponsor_club_claim_events_v4 e where e.claim_id=c.id and e.kind='operator'),
  'paid',exists(select 1 from app_private.reward_sponsor_club_claim_events_v4 e where e.claim_id=c.id and e.kind='receipt')) order by c.created_at desc)
  from app_private.reward_sponsor_club_claims_v4 c where c.entitlement_id=r.entitlement_id and (p_approval_id is not null or c.recipient_user_id=p_actor_user_id)),'[]'::jsonb)) row
 from app_private.reward_sponsor_recipients_v4 r join app_private.reward_sponsor_allocation_approvals_v4 a on a.id=r.approval_id
 join app_private.reward_sponsor_executions e on e.setup_id=a.setup_id
 join public.clubs club on club.id=r.beneficiary_id and r.beneficiary_kind='club'
 where e.plan->>'chainId'=p_chain_id::text and exists(select 1 from app_private.reward_sponsor_lifecycle_v4 where approval_id=a.id and kind='publication')
 and ((p_approval_id is not null and a.id=p_approval_id) or (p_approval_id is null and app_private.reward_club_owner_identity(club.id,p_actor_user_id) is not null))
 limit 500) rows;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 return result;
end $$;
revoke all on function public.service_sponsor_club_claim_v4(uuid,uuid,integer,uuid,text,text,text),public.service_list_sponsor_club_claims_v4(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_sponsor_club_claim_v4(uuid,uuid,integer,uuid,text,text,text),public.service_list_sponsor_club_claims_v4(uuid,uuid,integer,uuid) to service_role;

commit;
