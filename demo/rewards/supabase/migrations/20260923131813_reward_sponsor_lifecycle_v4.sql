-- Isolated demo only. Immutable official-publication binding and finalized wallet receipts.
begin;
create table app_private.reward_sponsor_lifecycle_v4 (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'),
 approval_id uuid not null references app_private.reward_sponsor_allocation_approvals_v4(id),
 kind text not null check(kind in('publication','receipt')),
 body_text text not null check(octet_length(body_text)<=131072),
 body_hash text not null check(body_hash ~ '^[0-9a-f]{64}$'),
 source_stamp text not null,
 actor_user_id uuid not null references public.user_profiles(user_id),
 created_at timestamptz not null default clock_timestamp()
);
create unique index sponsor_one_publication_v4 on app_private.reward_sponsor_lifecycle_v4(approval_id) where kind='publication';
create unique index sponsor_one_receipt_v4 on app_private.reward_sponsor_lifecycle_v4((body_text::jsonb->>'transactionHash')) where kind='receipt';
alter table app_private.reward_sponsor_lifecycle_v4 enable row level security;
revoke all on app_private.reward_sponsor_lifecycle_v4 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_sponsor_lifecycle_v4 to service_role;
create policy sponsor_lifecycle_select_v4 on app_private.reward_sponsor_lifecycle_v4 for select to service_role using(true);
create policy sponsor_lifecycle_insert_v4 on app_private.reward_sponsor_lifecycle_v4 for insert to service_role with check(true);
create trigger sponsor_lifecycle_immutable_v4 before update or delete on app_private.reward_sponsor_lifecycle_v4
 for each row execute function app_private.reward_result_review_immutable_v3();

-- Secondary conservative freshness fence for recipient-owned reads. No source data
-- leaves this helper. Native review holds/publication changes are included, as are
-- native result/registration facts, catalogue/mapping and all sporting decisions.
create function app_private.reward_sponsor_source_stamp_v4(p_approval_id uuid)
returns text language sql stable security invoker set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object(
 'draft',to_jsonb(d),'mapping',to_jsonb(m),'source',s.source_hash,
 'catalogue',app_private.reward_planning_catalogue_v3(d.id),
 'historical',(select jsonb_agg(to_jsonb(h) order by h.sequence) from app_private.reward_historical_source_reviews_v3 h where h.draft_id=d.id),
 'native',case when a.slot in(0,5) then app_private.reward_native_finale_document_v3(d.id,null) end,
 'continuity',(select jsonb_agg(to_jsonb(c) order by c.sequence) from app_private.reward_native_continuity_reviews_v3 c where c.draft_id=d.id),
 'policy',(select jsonb_agg(to_jsonb(c) order by c.sequence) from app_private.reward_league_policy_reviews_v3 c where c.draft_id=d.id),
 'league',(select jsonb_agg(to_jsonb(c) order by c.sequence) from app_private.reward_league_publications_v3 c where c.draft_id=d.id),
 'reviews',(select jsonb_agg(jsonb_build_object('race',pair->>'raceId','held',app_private.reward_result_review_held_v3((pair->>'raceId')::uuid),
  'policy',(select jsonb_agg(to_jsonb(p) order by p.revision) from app_private.reward_result_review_policies_v3 p where p.event_category_id=(pair->>'raceId')::uuid),
  'clock',(select to_jsonb(c) from app_private.reward_result_review_clocks_v3 c where c.event_category_id=(pair->>'raceId')::uuid),
  'final',(select jsonb_agg(to_jsonb(f) order by f.publication_id) from app_private.reward_final_publication_evidence_v3 f where f.event_category_id=(pair->>'raceId')::uuid)) order by pair->>'raceId')
  from jsonb_array_elements(b.races) pair),
 'latest',(select x.id from app_private.reward_sponsor_allocation_approvals_v4 x where x.setup_id=a.setup_id and x.slot=a.slot order by x.sequence desc limit 1),
 'archived',setup.archived_at,'execution',to_jsonb(e),
 'authority',app_private.reward_planning_authorized(a.actor_user_id,d.organization_id),
 'active',exists(select 1 from public.user_profiles where user_id=a.actor_user_id and status='active')
 )::text,'UTF8')),'hex')
 from app_private.reward_sponsor_allocation_approvals_v4 a
 join app_private.reward_distribution_setups setup on setup.id=a.setup_id
 join app_private.reward_sponsor_executions e on e.setup_id=a.setup_id
 join app_private.reward_planning_drafts d on d.id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid
 left join app_private.reward_source_mappings_v2 m on m.draft_id=d.id
 left join app_private.reward_public_snapshots_v2 s on s.season_id=d.season_id and s.organization_id=d.organization_id
 left join lateral(select * from app_private.reward_finale_bindings_v3 where draft_id=d.id order by sequence desc limit 1)b on true
 where a.id=p_approval_id
$$;

create function public.service_reward_sponsor_lifecycle_v4(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_setup_id uuid,p_slot integer,p_approval_id uuid,p_request_id uuid default null,p_kind text default null,p_body_text text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare u jsonb; fresh jsonb; b jsonb; old app_private.reward_sponsor_lifecycle_v4%rowtype; stamp text; pub jsonb; receipts jsonb;
begin
 u:=public.service_read_reward_sponsor_upload_v4(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id,p_slot,p_approval_id);
 if u#>>'{prepared,id}' is null then raise exception 'reward_sponsor_upload_required'; end if;
 stamp:=app_private.reward_sponsor_source_stamp_v4(p_approval_id);
 if p_kind is not null then
  if p_kind not in('publication','receipt') or p_request_id is null or p_body_text is null or octet_length(p_body_text)>131072 then raise exception 'invalid_sponsor_lifecycle'; end if;
  b:=p_body_text::jsonb;
  if jsonb_typeof(b) is distinct from 'object' then raise exception 'invalid_sponsor_lifecycle'; end if;
  select * into old from app_private.reward_sponsor_lifecycle_v4 where id=p_request_id;
  if found then
   if old.approval_id<>p_approval_id or old.kind<>p_kind or old.actor_user_id<>p_actor_user_id or old.body_text<>p_body_text then raise exception 'reward_sponsor_lifecycle_conflict'; end if;
  else
   if u->'current' is distinct from 'true'::jsonb then raise exception 'reward_sponsor_source_not_ready'; end if;
   if p_kind='publication' then
    if b->>'schema' is distinct from 'raceson-sponsor-publication-v4' or b->>'approvalId' is distinct from p_approval_id::text
     or b->>'packageHash' is distinct from u#>>'{prepared,packageHash}' or b->>'contextHash' is distinct from u->>'contextHash'
     or b#>>'{timing,reviewPeriod}' is distinct from u#>>array['execution','plan','reviewPeriods',p_slot::text]
     or coalesce(b#>>'{timing,reviewStartedAt}','') !~ '^[1-9][0-9]{0,11}$'
     or coalesce(b#>>'{timing,officialPublishedAt}','') !~ '^[1-9][0-9]{0,11}$'
     or (b#>>'{timing,officialPublishedAt}')::bigint < (b#>>'{timing,reviewStartedAt}')::bigint+(b#>>'{timing,reviewPeriod}')::bigint
     or (b#>>'{timing,officialPublishedAt}')::bigint>extract(epoch from clock_timestamp())
     or coalesce(b#>>'{timing,publicationEvidenceHash}','') !~ '^0x[0-9a-f]{64}$' then raise exception 'invalid_sponsor_lifecycle'; end if;
   else
    if not exists(select 1 from app_private.reward_sponsor_lifecycle_v4 where approval_id=p_approval_id and kind='publication' and source_stamp=stamp)
     or coalesce(b->>'transactionHash','') !~ '^0x[0-9a-f]{64}$' or coalesce(b->>'blockHash','') !~ '^0x[0-9a-f]{64}$'
     or coalesce(b->>'blockNumber','') !~ '^[0-9]+$' or b->>'campaignAddress' is distinct from u#>>'{prepared,package,campaignAddress}'
     or coalesce(b->>'action','') not in('upload','stage','activate') then raise exception 'invalid_sponsor_lifecycle'; end if;
   end if;
   insert into app_private.reward_sponsor_lifecycle_v4(id,approval_id,kind,body_text,body_hash,source_stamp,actor_user_id)
   values(p_request_id,p_approval_id,p_kind,p_body_text,encode(sha256(convert_to(p_body_text,'UTF8')),'hex'),stamp,p_actor_user_id);
   fresh:=public.service_read_reward_sponsor_upload_v4(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id,p_slot,p_approval_id);
   if fresh->'current' is distinct from 'true'::jsonb or app_private.reward_sponsor_source_stamp_v4(p_approval_id) is distinct from stamp then raise exception 'reward_planning_revision_changed'; end if;
  end if;
 end if;
 select jsonb_build_object('id',id,'body',body_text::jsonb,'bodyHash',body_hash,'current',source_stamp=stamp,'createdAt',created_at) into pub
 from app_private.reward_sponsor_lifecycle_v4 where approval_id=p_approval_id and kind='publication';
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'body',body_text::jsonb) order by created_at,id),'[]'::jsonb) into receipts
 from app_private.reward_sponsor_lifecycle_v4 where approval_id=p_approval_id and kind='receipt';
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 return jsonb_build_object('upload',u,'publication',pub,'receipts',receipts);
end $$;
revoke all on function app_private.reward_sponsor_source_stamp_v4(uuid),
 public.service_reward_sponsor_lifecycle_v4(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_sponsor_source_stamp_v4(uuid),
 public.service_reward_sponsor_lifecycle_v4(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text) to service_role;
-- Recipient nominations and proofs are separate immutable records. No wallet creation.
create table app_private.reward_sponsor_claims_v4 (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'),
 approval_id uuid not null references app_private.reward_sponsor_allocation_approvals_v4(id),
 entitlement_id bytea not null references app_private.reward_sponsor_recipients_v4(entitlement_id),
 destination_id uuid not null references app_private.reward_athlete_destination_requests(id),
 recipient_user_id uuid not null references public.user_profiles(user_id),
 created_at timestamptz not null default clock_timestamp()
);
create table app_private.reward_sponsor_claim_events_v4 (
 claim_id uuid not null references app_private.reward_sponsor_claims_v4(id),
 kind text not null check(kind in('intent','recipient','operator','receipt','revoked')),
 body_text text not null check(octet_length(body_text)<=32768),
 actor_user_id uuid not null references public.user_profiles(user_id),
 created_at timestamptz not null default clock_timestamp(),primary key(claim_id,kind)
);
do $$ declare n text; begin
 foreach n in array array['reward_sponsor_claims_v4','reward_sponsor_claim_events_v4'] loop
 execute format('alter table app_private.%I enable row level security',n);
 execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',n);
 execute format('grant select,insert on app_private.%I to service_role',n);
 execute format('create policy service_read on app_private.%I for select to service_role using(true)',n);
 execute format('create policy service_insert on app_private.%I for insert to service_role with check(true)',n);
 execute format('create trigger immutable before update or delete on app_private.%I for each row execute function app_private.reward_result_review_immutable_v3()',n);
 end loop;
end $$;

create function public.service_sponsor_claim_v4(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_claim_id uuid,
 p_role text,p_action text default null,p_body_text text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare c app_private.reward_sponsor_claims_v4%rowtype; a app_private.reward_sponsor_allocation_approvals_v4%rowtype;
 r app_private.reward_sponsor_recipients_v4%rowtype; n app_private.reward_athlete_destination_requests%rowtype; athlete public.athlete_profiles%rowtype;
 pub app_private.reward_sponsor_lifecycle_v4%rowtype; u app_private.reward_sponsor_uploads_v4%rowtype;
 ch app_private.reward_wallet_challenges%rowtype; execution app_private.reward_sponsor_executions%rowtype;
 b jsonb; old app_private.reward_sponsor_claim_events_v4%rowtype; events jsonb; source_stamp text; fingerprint text; current boolean; destination jsonb;
 today date:=(clock_timestamp() at time zone 'Europe/Zagreb')::date; before_stamp text; fresh jsonb;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(31337,10143) or p_role is null or p_role not in('recipient','operator') then raise exception 'reward_claim_scope_required'; end if;
 b:=p_body_text::jsonb;
 if p_action='request' then
  if p_role<>'recipient' or b is null or jsonb_typeof(b)<>'object' or (select count(*) from jsonb_object_keys(b))<>3 then raise exception 'invalid_sponsor_claim'; end if;
  select * into n from app_private.reward_athlete_destination_requests where id=(b->>'destinationId')::uuid and user_id=p_actor_user_id;
  select * into r from app_private.reward_sponsor_recipients_v4 where approval_id=(b->>'approvalId')::uuid and entitlement_id=decode(substr(b->>'entitlementId',3),'hex')
   and beneficiary_kind='athlete' and beneficiary_id=n.athlete_profile_id;
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
  or (p_role='recipient' and p_actor_user_id<>n.user_id) or (p_role='operator' and p_actor_user_id<>pub.actor_user_id) then raise exception 'reward_claim_scope_required'; end if;
 -- Established organization -> draft -> wallet/profile lock order.
 perform 1 from public.organization_memberships where user_id=pub.actor_user_id and organization_id=(select organization_id from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid) for share;
 perform 1 from public.organizations where id=(select organization_id from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid) for share;
 if p_role='operator' then
  fresh:=public.service_read_reward_sponsor_upload_v4(p_actor_user_id,p_actor_session_id,p_chain_id,a.setup_id,a.slot,a.id);
 else
  perform 1 from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid for update;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||n.user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('sponsor-claim:'||p_claim_id::text,0));
 select * into athlete from public.athlete_profiles where id=r.beneficiary_id for share;
 if athlete.claimed_by_user_id is distinct from n.user_id or not athlete.is_claimed or athlete.status<>'active' or athlete.merged_into_athlete_profile_id is not null then raise exception 'reward_claim_scope_required'; end if;
 destination:=app_private.reward_athlete_destination_document(n);
 select w.* into ch from app_private.reward_wallet_challenges w join app_private.reward_wallet_proofs p on p.challenge_id=w.id where p.id=n.proof_id;
 if ch.user_id is distinct from n.user_id or ch.chain_id is distinct from p_chain_id or ch.session_id is distinct from n.session_id then raise exception 'reward_claim_scope_required'; end if;
 source_stamp:=app_private.reward_sponsor_source_stamp_v4(a.id);fingerprint:=app_private.reward_athlete_profile_fingerprint(athlete.id);
 current:=coalesce(exists(select 1 from public.user_profiles where user_id=n.user_id and status='active')
  and exists(select 1 from public.user_profiles where user_id=pub.actor_user_id and status='active')
  and app_private.reward_planning_authorized(pub.actor_user_id,(select organization_id from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid))
  and source_stamp=pub.source_stamp and (p_role<>'operator' or fresh->>'current'='true') and destination->>'status'='pending_review'
  and athlete.date_of_birth<=today-interval '18 years' and (athlete.birth_year is null or athlete.birth_year=extract(year from athlete.date_of_birth)),false);
 if p_action='request' then
  select * into c from app_private.reward_sponsor_claims_v4 where id=p_claim_id;
  if c.id is not null and (c.recipient_user_id<>p_actor_user_id or c.destination_id<>n.id or c.approval_id<>r.approval_id or c.entitlement_id<>r.entitlement_id) then raise exception 'reward_sponsor_claim_conflict'; end if;
 end if;
 if p_action='request' and c.id is null then
  if not current then raise exception 'reward_sponsor_claim_not_ready'; end if;
  insert into app_private.reward_sponsor_claims_v4(id,approval_id,entitlement_id,destination_id,recipient_user_id)
   values(p_claim_id,a.id,r.entitlement_id,n.id,n.user_id) returning * into c;
 elsif p_action is not null and p_action<>'request' then
  if p_action not in('intent','recipient','operator','receipt','revoked') or b is null or octet_length(p_body_text)>32768 then raise exception 'invalid_sponsor_claim'; end if;
  if (p_action='recipient' and p_role<>'recipient') or (p_action<>'recipient' and p_role<>'operator') then raise exception 'reward_claim_scope_required'; end if;
  select * into old from app_private.reward_sponsor_claim_events_v4 where claim_id=c.id and kind=p_action;
  if found then
   if old.body_text<>p_body_text or old.actor_user_id<>p_actor_user_id then raise exception 'reward_sponsor_claim_conflict'; end if;
  else
   if not current or exists(select 1 from app_private.reward_sponsor_claim_events_v4 where claim_id=c.id and kind='revoked') then raise exception 'reward_sponsor_claim_not_ready'; end if;
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
    if exists(select 1 from app_private.reward_sponsor_claim_events_v4 e join app_private.reward_sponsor_claims_v4 x on x.id=e.claim_id
      where x.entitlement_id=c.entitlement_id and e.kind='intent' and (e.body_text::jsonb#>>'{claim,expiresAt}')::numeric>(b#>>'{claim,issuedAt}')::numeric)
      then raise exception 'reward_sponsor_claim_conflict'; end if;
   elsif p_action in('recipient','operator','receipt') then
    select body_text::jsonb into events from app_private.reward_sponsor_claim_events_v4 where claim_id=c.id and kind='intent';
    if events is null or events->>'sourceStamp'<>source_stamp or events->>'profileFingerprint'<>fingerprint then raise exception 'reward_sponsor_claim_not_ready'; end if;
    if p_action in('operator','receipt') and not exists(select 1 from app_private.reward_sponsor_claim_events_v4 where claim_id=c.id and kind='recipient') then raise exception 'reward_recipient_consent_required'; end if;
    if p_action='receipt' and not exists(select 1 from app_private.reward_sponsor_claim_events_v4 where claim_id=c.id and kind='operator') then raise exception 'reward_sponsor_claim_not_ready'; end if;
   end if;
   insert into app_private.reward_sponsor_claim_events_v4(claim_id,kind,body_text,actor_user_id) values(c.id,p_action,p_body_text,p_actor_user_id);
  end if;
 end if;
 select coalesce(jsonb_object_agg(kind,body_text::jsonb),'{}'::jsonb) into events from app_private.reward_sponsor_claim_events_v4 where claim_id=c.id;
 if events?'revoked' or (events?'intent' and (events#>>'{intent,sourceStamp}'<>source_stamp or events#>>'{intent,profileFingerprint}'<>fingerprint)) then current:=false; end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if app_private.reward_sponsor_source_stamp_v4(a.id) is distinct from source_stamp or app_private.reward_athlete_profile_fingerprint(athlete.id) is distinct from fingerprint
  or app_private.reward_athlete_destination_document(n) is distinct from destination then raise exception 'reward_planning_revision_changed'; end if;
 return jsonb_build_object('claimId',c.id,'entitlementId','0x'||encode(c.entitlement_id,'hex'),'approvalId',a.id,'setupId',a.setup_id,'slot',a.slot,'current',current,'sourceStamp',source_stamp,'profileFingerprint',fingerprint,
  'destination',destination,'challenge',app_private.reward_wallet_challenge_document(ch),'package',u.package_text::jsonb,'packageHash',u.package_hash,
  'plan',execution.plan,'publication',pub.body_text::jsonb,'events',events);
end $$;

create function public.service_list_sponsor_claims_v4(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_approval_id uuid default null)
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
 'athleteProfileId',case when p_approval_id is null then r.beneficiary_id else null end,
 'claims',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'prepared',exists(select 1 from app_private.reward_sponsor_claim_events_v4 e where e.claim_id=c.id and e.kind='intent'),
  'consented',exists(select 1 from app_private.reward_sponsor_claim_events_v4 e where e.claim_id=c.id and e.kind='recipient'),
  'approved',exists(select 1 from app_private.reward_sponsor_claim_events_v4 e where e.claim_id=c.id and e.kind='operator'),
  'paid',exists(select 1 from app_private.reward_sponsor_claim_events_v4 e where e.claim_id=c.id and e.kind='receipt')) order by c.created_at desc)
  from app_private.reward_sponsor_claims_v4 c where c.entitlement_id=r.entitlement_id and (p_approval_id is not null or c.recipient_user_id=p_actor_user_id)),'[]'::jsonb)) row
 from app_private.reward_sponsor_recipients_v4 r join app_private.reward_sponsor_allocation_approvals_v4 a on a.id=r.approval_id
 join app_private.reward_sponsor_executions e on e.setup_id=a.setup_id
 join public.athlete_profiles athlete on athlete.id=r.beneficiary_id and r.beneficiary_kind='athlete'
 where e.plan->>'chainId'=p_chain_id::text and exists(select 1 from app_private.reward_sponsor_lifecycle_v4 where approval_id=a.id and kind='publication')
 and ((p_approval_id is not null and a.id=p_approval_id) or (p_approval_id is null and athlete.claimed_by_user_id=p_actor_user_id and athlete.is_claimed and athlete.status='active' and athlete.merged_into_athlete_profile_id is null))
 limit 500) rows;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 return result;
end $$;
revoke all on function public.service_sponsor_claim_v4(uuid,uuid,integer,uuid,text,text,text),public.service_list_sponsor_claims_v4(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_sponsor_claim_v4(uuid,uuid,integer,uuid,text,text,text),public.service_list_sponsor_claims_v4(uuid,uuid,integer,uuid) to service_role;

commit;
