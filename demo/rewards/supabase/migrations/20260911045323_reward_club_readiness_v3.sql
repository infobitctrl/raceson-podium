begin;
-- Isolated V3 uploads reuse club+chain nominations, never a fabricated V1
-- programme. Chain evidence is verified by the private service, not by SQL.
create table app_private.reward_club_readiness_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  upload_id uuid not null references app_private.reward_allocation_uploads_v3(id),
  request_id uuid not null references app_private.reward_club_treasury_requests(id),
  previous_review_id uuid,
  source_guard_hash text not null check(source_guard_hash~'^[0-9a-f]{64}$'),
  identity_fingerprint text not null check(identity_fingerprint~'^[0-9a-f]{64}$'),
  evidence jsonb not null check(app_private.valid_reward_club_review_evidence(evidence)),
  reviewed_by_user_id uuid not null references public.user_profiles(user_id),
  reviewed_session_id uuid not null,
  reviewed_at timestamptz not null default clock_timestamp(),
  sequence bigint generated always as identity unique,
  unique(upload_id,request_id,id),
  foreign key(upload_id,request_id,previous_review_id) references app_private.reward_club_readiness_v3(upload_id,request_id,id),
  check(previous_review_id is null or previous_review_id<>id)
);
create index reward_club_readiness_v3_latest on app_private.reward_club_readiness_v3(upload_id,request_id,sequence desc);
create index reward_club_readiness_v3_previous on app_private.reward_club_readiness_v3(upload_id,request_id,previous_review_id);
create index reward_club_readiness_v3_request on app_private.reward_club_readiness_v3(request_id);
create index reward_club_readiness_v3_actor on app_private.reward_club_readiness_v3(reviewed_by_user_id);
create table app_private.reward_club_readiness_revocations_v3 (
  review_id uuid primary key references app_private.reward_club_readiness_v3(id),
  revoked_by_user_id uuid not null references public.user_profiles(user_id),
  revoked_session_id uuid not null,
  reason text not null check(reason in('authority_uncertain','key_control_changed','wallet_history_uncertain','operator_correction')),
  revoked_at timestamptz not null default clock_timestamp()
);
create index reward_club_readiness_revocations_v3_actor on app_private.reward_club_readiness_revocations_v3(revoked_by_user_id);
do $$ declare name text; begin
  foreach name in array array['reward_club_readiness_v3','reward_club_readiness_revocations_v3'] loop
    execute format('alter table app_private.%I enable row level security',name);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',name);
    execute format('grant select,insert on app_private.%I to service_role',name);
    execute format('create policy %I on app_private.%I for select to service_role using(true)',name||'_select',name);
    execute format('create policy %I on app_private.%I for insert to service_role with check(true)',name||'_insert',name);
    execute format('create trigger reward_club_readiness_immutable before update or delete on app_private.%I for each row execute function app_private.reject_reward_ledger_mutation()',name);
  end loop;
end $$;
revoke all on sequence app_private.reward_club_readiness_v3_sequence_seq from public,anon,authenticated;
grant usage on sequence app_private.reward_club_readiness_v3_sequence_seq to service_role;

create function app_private.reward_club_readiness_document_v3(r app_private.reward_club_readiness_v3)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select case when r.id is null then null else jsonb_build_object('id',r.id,'uploadId',r.upload_id,'requestId',r.request_id,
    'previousReviewId',r.previous_review_id,'sourceGuardHash',r.source_guard_hash,'identityFingerprint',r.identity_fingerprint,
    'evidence',r.evidence,'reviewedByUserId',r.reviewed_by_user_id,'reviewedSessionId',r.reviewed_session_id,'reviewedAt',r.reviewed_at,
    'revocation',(select jsonb_build_object('reason',v.reason,'revokedAt',v.revoked_at,'revokedByUserId',v.revoked_by_user_id)
      from app_private.reward_club_readiness_revocations_v3 v where v.review_id=r.id)) end
$$;

create function public.service_read_reward_club_readiness_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_upload_id uuid,p_request_id uuid,p_role text,p_review_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype; n app_private.reward_club_treasury_requests%rowtype;
  i app_private.reward_programme_deployment_intents_v3%rowtype; a app_private.reward_allocation_approvals_v3%rowtype;
  r app_private.reward_club_readiness_v3%rowtype; retry app_private.reward_club_readiness_v3%rowtype;
  source jsonb; nomination jsonb; fingerprint text; state text; owner_now jsonb; document jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select ap.* into a from app_private.reward_allocation_approvals_v3 ap join app_private.reward_allocation_uploads_v3 u on u.approval_id=ap.id where u.id=p_upload_id;
  select * into d from app_private.reward_planning_drafts where id=a.draft_id;
  select * into i from app_private.reward_programme_deployment_intents_v3 where draft_id=d.id;
  select * into n from app_private.reward_club_treasury_requests where id=p_request_id;
  if d.chain_id is distinct from p_chain_id or p_chain_id not in(31337,10143) or n.id is null or i.id is null
    or n.chain_id is distinct from p_chain_id or p_role is null or p_role not in('recipient','operator')
    or (p_role='operator' and (p_actor_user_id<>i.created_by_user_id or not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id)))
    or (p_role='recipient' and p_actor_user_id<>n.user_id)
    or not exists(select 1 from app_private.reward_allocation_recipients_v3 where approval_id=a.id
      and beneficiary_kind='club' and source_beneficiary_id=n.club_id)
    then raise exception 'reward_club_readiness_scope_required'; end if;
  perform 1 from public.organization_memberships where organization_id=d.organization_id and user_id=i.created_by_user_id for share;
  perform 1 from public.organizations where id=d.organization_id for share;
  if a.slot in(5,6) then perform 1 from app_private.reward_planning_drafts where id=d.id for update;
  else perform 1 from app_private.reward_planning_drafts where id=d.id for share; end if;
  -- Native source/category locks precede account/treasury locks, matching final
  -- athlete and organizer workflows. Nomination withdrawal uses these same keys.
  source:=app_private.reward_recipient_source_v3(p_upload_id);
  perform pg_advisory_xact_lock(hashtextextended('reward-club-account:'||n.user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('reward-club-treasury:'||n.club_id::text||':'||n.chain_id::text,0));
  perform user_id from public.user_profiles where user_id in(i.created_by_user_id,n.user_id) order by user_id for share;
  perform id from public.clubs where id=n.club_id for share;
  perform id from public.athlete_profiles where claimed_by_user_id=n.user_id or id=(n.owner_identity->>'athleteProfileId')::uuid order by id for share;
  perform id from public.club_memberships where club_id=n.club_id order by id for share;
  perform id from public.club_roles where club_id=n.club_id order by id for share;
  owner_now:=app_private.reward_club_owner_identity(n.club_id,n.user_id);
  if p_role='recipient' and owner_now is null then raise exception 'reward_club_readiness_scope_required'; end if;
  nomination:=app_private.reward_club_treasury_document(n);
  fingerprint:=app_private.reward_club_review_fingerprint(n.id);
  select * into r from app_private.reward_club_readiness_v3 where upload_id=p_upload_id and request_id=p_request_id order by sequence desc limit 1;
  select * into retry from app_private.reward_club_readiness_v3 where id=p_review_id and upload_id=p_upload_id and request_id=p_request_id;
  state:=case when nomination->>'status'='withdrawn' then 'request_withdrawn'
    when nomination->>'status'='identity_hold' or not exists(select 1 from public.user_profiles where user_id=n.user_id and status='active') then 'identity_hold'
    when source->>'current'<>'true' then 'source_hold'
    when r.id is null then 'unreviewed'
    when exists(select 1 from app_private.reward_club_readiness_revocations_v3 where review_id=r.id) then 'revoked'
    when r.identity_fingerprint is distinct from fingerprint then 'identity_changed'
    when r.source_guard_hash is distinct from source->>'sourceGuardHash' then 'source_hold'
    else 'reviewed' end;
  if source is distinct from app_private.reward_recipient_source_v3(p_upload_id) then raise exception 'reward_planning_revision_changed'; end if;
  if fingerprint is distinct from app_private.reward_club_review_fingerprint(n.id) then raise exception 'reward_club_readiness_identity_changed'; end if;
  document:=jsonb_build_object('schema','raceson-club-readiness-private-v3','actorUserId',p_actor_user_id,'role',p_role,
    'source',source,'nomination',nomination,'identityFingerprint',fingerprint,'state',state,
    'review',app_private.reward_club_readiness_document_v3(r),'retryReview',app_private.reward_club_readiness_document_v3(retry));
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(i.created_by_user_id,d.organization_id) and p_role='operator'
    then raise exception 'reward_club_readiness_scope_required'; end if;
  return document;
end $$;

create function public.service_record_reward_club_readiness_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_upload_id uuid,p_request_id uuid,p_review_id uuid,p_previous_review_id uuid,p_source_guard_hash text,p_identity_fingerprint text,p_evidence jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; document jsonb; old app_private.reward_club_readiness_v3%rowtype;
begin
  v:=public.service_read_reward_club_readiness_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_upload_id,p_request_id,'operator',p_review_id);
  if p_review_id is null or p_review_id='00000000-0000-0000-0000-000000000000'::uuid
    or p_source_guard_hash is null or p_source_guard_hash!~'^[0-9a-f]{64}$'
    or p_identity_fingerprint is null or p_identity_fingerprint!~'^[0-9a-f]{64}$'
    or not app_private.valid_reward_club_review_evidence(p_evidence) then raise exception 'invalid_reward_club_readiness'; end if;
  select * into old from app_private.reward_club_readiness_v3 where id=p_review_id;
  if found then
    if old.upload_id<>p_upload_id or old.request_id<>p_request_id or old.previous_review_id is distinct from p_previous_review_id
      or old.reviewed_by_user_id<>p_actor_user_id or old.identity_fingerprint<>p_identity_fingerprint
      or old.source_guard_hash<>p_source_guard_hash or old.evidence<>p_evidence then raise exception 'reward_ledger_idempotency_conflict'; end if;
    document:=app_private.reward_club_readiness_document_v3(old);
    perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
    return document; -- Exact history, no renewal or new chain reads.
  end if;
  if v#>>'{review,id}' is distinct from p_previous_review_id::text then raise exception 'reward_club_readiness_revision_changed'; end if;
  if v->>'identityFingerprint' is distinct from p_identity_fingerprint then raise exception 'reward_club_readiness_identity_changed'; end if;
  if v#>>'{source,sourceGuardHash}' is distinct from p_source_guard_hash then raise exception 'reward_planning_revision_changed'; end if;
  if v->>'state' not in('unreviewed','reviewed','revoked','identity_changed') then raise exception 'reward_club_readiness_hold'; end if;
  if p_evidence->'candidate' is distinct from v#>'{nomination,candidate}' or p_evidence->'chainId' is distinct from v#>'{source,chainId}'
    then raise exception 'invalid_reward_club_readiness'; end if;
  insert into app_private.reward_club_readiness_v3(id,upload_id,request_id,previous_review_id,source_guard_hash,identity_fingerprint,
    evidence,reviewed_by_user_id,reviewed_session_id) values(p_review_id,p_upload_id,p_request_id,p_previous_review_id,
    p_source_guard_hash,p_identity_fingerprint,p_evidence,p_actor_user_id,p_actor_session_id) returning * into old;
  document:=app_private.reward_club_readiness_document_v3(old);
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return document;
end $$;

create function public.service_revoke_reward_club_readiness_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_upload_id uuid,p_request_id uuid,p_review_id uuid,p_reason text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; document jsonb; r app_private.reward_club_readiness_v3%rowtype; old app_private.reward_club_readiness_revocations_v3%rowtype;
begin
  v:=public.service_read_reward_club_readiness_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_upload_id,p_request_id,'operator');
  select * into r from app_private.reward_club_readiness_v3 where id=p_review_id and upload_id=p_upload_id and request_id=p_request_id;
  if not found then raise exception 'reward_club_readiness_scope_required'; end if;
  if p_reason is null or p_reason not in('authority_uncertain','key_control_changed','wallet_history_uncertain','operator_correction')
    then raise exception 'invalid_reward_club_readiness'; end if;
  select * into old from app_private.reward_club_readiness_revocations_v3 where review_id=r.id;
  if found then
    if old.reason<>p_reason or old.revoked_by_user_id<>p_actor_user_id then raise exception 'reward_ledger_idempotency_conflict'; end if;
  else
    insert into app_private.reward_club_readiness_revocations_v3(review_id,revoked_by_user_id,revoked_session_id,reason)
      values(r.id,p_actor_user_id,p_actor_session_id,p_reason);
  end if;
  document:=app_private.reward_club_readiness_document_v3(r);
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return document;
end $$;
revoke all on function app_private.reward_club_readiness_document_v3(app_private.reward_club_readiness_v3),
  public.service_read_reward_club_readiness_v3(uuid,uuid,integer,uuid,uuid,text,uuid),
  public.service_record_reward_club_readiness_v3(uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text,jsonb),
  public.service_revoke_reward_club_readiness_v3(uuid,uuid,integer,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_club_readiness_document_v3(app_private.reward_club_readiness_v3),
  public.service_read_reward_club_readiness_v3(uuid,uuid,integer,uuid,uuid,text,uuid),
  public.service_record_reward_club_readiness_v3(uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text,jsonb),
  public.service_revoke_reward_club_readiness_v3(uuid,uuid,integer,uuid,uuid,uuid,text) to service_role;
commit;
