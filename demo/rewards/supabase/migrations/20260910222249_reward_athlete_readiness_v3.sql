begin;
-- V3 readiness is bound to the real upload and existing wallet nomination,
-- never a second V1 programme or an athlete key created by the server.
create table app_private.reward_athlete_readiness_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  upload_id uuid not null references app_private.reward_allocation_uploads_v3(id),
  destination_id uuid not null references app_private.reward_athlete_destination_requests(id),
  previous_review_id uuid,
  source_guard_hash text not null check(source_guard_hash~'^[0-9a-f]{64}$'),
  profile_fingerprint text not null check(profile_fingerprint~'^[0-9a-f]{64}$'),
  attestation jsonb not null check(jsonb_typeof(attestation)='object' and octet_length(attestation::text)<2048),
  reviewed_by_user_id uuid not null references public.user_profiles(user_id),
  reviewed_session_id uuid not null,
  reviewed_at timestamptz not null default clock_timestamp(),
  sequence bigint generated always as identity unique,
  unique(upload_id,destination_id,id),
  foreign key(upload_id,destination_id,previous_review_id) references app_private.reward_athlete_readiness_v3(upload_id,destination_id,id),
  check(previous_review_id is null or previous_review_id<>id)
);
create index reward_athlete_readiness_v3_latest on app_private.reward_athlete_readiness_v3(upload_id,destination_id,sequence desc);
create index reward_athlete_readiness_v3_destination on app_private.reward_athlete_readiness_v3(destination_id);
create index reward_athlete_readiness_v3_actor on app_private.reward_athlete_readiness_v3(reviewed_by_user_id);
create table app_private.reward_athlete_readiness_revocations_v3 (
  review_id uuid primary key references app_private.reward_athlete_readiness_v3(id),
  revoked_by_user_id uuid not null references public.user_profiles(user_id),
  revoked_session_id uuid not null,
  reason text not null check(reason in ('identity_uncertain','age_uncertain','wallet_security_changed','operator_correction')),
  revoked_at timestamptz not null default clock_timestamp()
);
create index reward_athlete_readiness_revocations_v3_actor on app_private.reward_athlete_readiness_revocations_v3(revoked_by_user_id);
alter table app_private.reward_athlete_readiness_v3 enable row level security;
alter table app_private.reward_athlete_readiness_revocations_v3 enable row level security;
revoke all on app_private.reward_athlete_readiness_v3,app_private.reward_athlete_readiness_revocations_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_athlete_readiness_v3,app_private.reward_athlete_readiness_revocations_v3 to service_role;
create policy reward_athlete_readiness_v3_read on app_private.reward_athlete_readiness_v3 for select to service_role using(true);
create policy reward_athlete_readiness_v3_write on app_private.reward_athlete_readiness_v3 for insert to service_role with check(true);
create policy reward_athlete_readiness_revocations_v3_read on app_private.reward_athlete_readiness_revocations_v3 for select to service_role using(true);
create policy reward_athlete_readiness_revocations_v3_write on app_private.reward_athlete_readiness_revocations_v3 for insert to service_role with check(true);
revoke all on sequence app_private.reward_athlete_readiness_v3_sequence_seq from public,anon,authenticated;
grant usage on sequence app_private.reward_athlete_readiness_v3_sequence_seq to service_role;
create trigger reward_athlete_readiness_v3_immutable before update or delete on app_private.reward_athlete_readiness_v3
  for each row execute function app_private.reject_reward_ledger_mutation();
create trigger reward_athlete_readiness_revocations_v3_immutable before update or delete on app_private.reward_athlete_readiness_revocations_v3
  for each row execute function app_private.reject_reward_ledger_mutation();

-- Private subject only. The caller must authorize its actual actor first.
-- Same source-context/funding-context functions as the organizer workflow; no
-- borrowed operator session and no reimplementation of the sporting calculator.
create function app_private.reward_recipient_source_v3(p_upload_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare u app_private.reward_allocation_uploads_v3%rowtype; a app_private.reward_allocation_approvals_v3%rowtype;
  d app_private.reward_planning_drafts%rowtype; m app_private.reward_source_mappings_v2%rowtype;
  i app_private.reward_programme_deployment_intents_v3%rowtype; f app_private.reward_programme_approvals_v3%rowtype;
  h app_private.reward_historical_source_reviews_v3%rowtype; record jsonb; workspace jsonb; catalogue jsonb;
  source_hash text; source_context text; funding_context text; guard jsonb; current boolean;
begin
  select * into u from app_private.reward_allocation_uploads_v3 where id=p_upload_id;
  select * into a from app_private.reward_allocation_approvals_v3 where id=u.approval_id;
  select * into d from app_private.reward_planning_drafts where id=a.draft_id;
  select * into m from app_private.reward_source_mappings_v2 where draft_id=d.id;
  select * into i from app_private.reward_programme_deployment_intents_v3 where draft_id=d.id;
  select * into f from app_private.reward_programme_approvals_v3 where draft_id=d.id order by sequence desc limit 1;
  select * into h from app_private.reward_historical_source_reviews_v3 where draft_id=d.id and slot=a.slot order by sequence desc limit 1;
  if d.id is null or i.id is null or m.draft_id is null then raise exception 'reward_readiness_scope_required'; end if;
  record:=app_private.reward_planning_document(d);
  catalogue:=app_private.reward_planning_catalogue_v3(d.id);
  workspace:=jsonb_build_object('draftId',d.id,'revision',m.revision,'rulesRevision',d.revision,
    'catalogueHash',encode(sha256(convert_to(catalogue::text,'UTF8')),'hex'),'boundCatalogueHash',m.catalogue_hash,
    'mapping',m.mapping,'catalogue',catalogue);
  select s.source_hash into source_hash from app_private.reward_public_snapshots_v2 s where s.season_id=d.season_id and s.organization_id=d.organization_id;
  source_context:=encode(sha256(convert_to(app_private.reward_historical_source_context_v3(
    jsonb_build_object('record',record,'workspace',workspace,'sourceHash',source_hash))::text,'UTF8')),'hex');
  funding_context:=encode(sha256(convert_to(app_private.reward_programme_context_v3(record,workspace)::text,'UTF8')),'hex');
  current:=coalesce(source_hash is not null and h.context_hash=source_context and h.decision='confirmed_final'
    and a.document->>'sourceContextHash'=source_context and a.document#>>'{decision,id}'=h.id::text
    and f.id=i.approval_id and f.context_hash=funding_context and u.context_hash=a.context_hash
    and a.document#>>'{binding,intentId}'=i.id::text and a.document#>>'{binding,fundingApprovalId}'=i.approval_id::text
    and exists(select 1 from app_private.reward_programme_registry_v3 r where r.intent_id=i.id
      and r.provenance->>'contractAddress'=a.document#>>'{binding,programmeAddress}')
    and not exists(select 1 from app_private.reward_allocation_approvals_v3 newer where newer.draft_id=d.id and newer.slot=a.slot and newer.sequence>a.sequence)
    and app_private.reward_planning_authorized(i.created_by_user_id,d.organization_id)
    and exists(select 1 from public.user_profiles where user_id=i.created_by_user_id and status='active'),false);
  guard:=jsonb_build_object('sourceContextHash',source_context,'sourceDecisionId',h.id,'fundingContextHash',funding_context,
    'fundingApprovalId',f.id,'programmeIntentId',i.id,'approvalId',a.id,'uploadId',u.id,'packageHash',u.package_hash);
  return jsonb_build_object('draftId',d.id,'chainId',d.chain_id,'uploadId',u.id,'approvalId',a.id,'slot',a.slot,
    'operatorUserId',i.created_by_user_id,'operatorAddress',i.operator_address,'current',current,
    'sourceGuardHash',encode(sha256(convert_to(guard::text,'UTF8')),'hex'));
end $$;

create function app_private.reward_readiness_document_v3(r app_private.reward_athlete_readiness_v3)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select case when r.id is null then null else jsonb_build_object('id',r.id,'uploadId',r.upload_id,'destinationId',r.destination_id,
    'previousReviewId',r.previous_review_id,'sourceGuardHash',r.source_guard_hash,'profileFingerprint',r.profile_fingerprint,
    'attestation',r.attestation,'reviewedByUserId',r.reviewed_by_user_id,'reviewedSessionId',r.reviewed_session_id,'reviewedAt',r.reviewed_at,
    'revocation',(select jsonb_build_object('reason',v.reason,'revokedAt',v.revoked_at,'revokedByUserId',v.revoked_by_user_id)
      from app_private.reward_athlete_readiness_revocations_v3 v where v.review_id=r.id)) end
$$;

create function public.service_read_reward_readiness_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_upload_id uuid,p_destination_id uuid,p_role text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype; n app_private.reward_athlete_destination_requests%rowtype;
  i app_private.reward_programme_deployment_intents_v3%rowtype; a app_private.reward_allocation_approvals_v3%rowtype;
  c app_private.reward_wallet_challenges%rowtype; p public.athlete_profiles%rowtype;
  r app_private.reward_athlete_readiness_v3%rowtype; source jsonb; destination jsonb; fingerprint text; state text; today date;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select ap.* into a from app_private.reward_allocation_approvals_v3 ap join app_private.reward_allocation_uploads_v3 u on u.approval_id=ap.id where u.id=p_upload_id;
  select * into d from app_private.reward_planning_drafts where id=a.draft_id;
  select * into i from app_private.reward_programme_deployment_intents_v3 where draft_id=d.id;
  select * into n from app_private.reward_athlete_destination_requests where id=p_destination_id;
  if d.chain_id is distinct from p_chain_id or p_chain_id not in (31337,10143) or n.id is null or i.id is null
    or p_role is null or p_role not in ('recipient','operator')
    or (p_role='operator' and (p_actor_user_id<>i.created_by_user_id or not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id)))
    or (p_role='recipient' and p_actor_user_id<>n.user_id)
    or not exists(select 1 from app_private.reward_allocation_recipients_v3 where approval_id=a.id
      and beneficiary_kind='athlete' and source_beneficiary_id=n.athlete_profile_id) then raise exception 'reward_readiness_scope_required'; end if;
  perform 1 from public.organization_memberships where organization_id=d.organization_id and user_id=i.created_by_user_id for share;
  perform 1 from public.organizations where id=d.organization_id for share;
  perform 1 from app_private.reward_planning_drafts where id=d.id for share;
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||n.user_id::text,0));
  perform 1 from public.user_profiles where user_id in (i.created_by_user_id,n.user_id) order by user_id for share;
  select * into p from public.athlete_profiles where id=n.athlete_profile_id for share;
  if p_role='recipient' and (p.claimed_by_user_id is distinct from n.user_id or not p.is_claimed or p.status<>'active'
    or p.merged_into_athlete_profile_id is not null) then raise exception 'reward_readiness_scope_required'; end if;
  source:=app_private.reward_recipient_source_v3(p_upload_id);
  destination:=app_private.reward_athlete_destination_document(n);
  select ch.* into c from app_private.reward_wallet_challenges ch join app_private.reward_wallet_proofs proof on proof.challenge_id=ch.id where proof.id=n.proof_id;
  if c.chain_id is distinct from p_chain_id or c.user_id is distinct from n.user_id or c.session_id is distinct from n.session_id
    then raise exception 'reward_readiness_scope_required'; end if;
  fingerprint:=app_private.reward_athlete_profile_fingerprint(p.id);
  select * into r from app_private.reward_athlete_readiness_v3 where upload_id=p_upload_id and destination_id=p_destination_id order by sequence desc limit 1;
  today:=(clock_timestamp() at time zone 'Europe/Zagreb')::date;
  state:=case when destination->>'status'='withdrawn' then 'request_withdrawn'
    when destination->>'status'='identity_hold' or not exists(select 1 from public.user_profiles where user_id=n.user_id and status='active') then 'identity_hold'
    when p.date_of_birth is null or p.date_of_birth>today or p.date_of_birth>today-interval '18 years'
      or (p.birth_year is not null and p.birth_year<>extract(year from p.date_of_birth)) then 'age_hold'
    when source->>'current'<>'true' then 'source_hold'
    when r.id is null then 'unreviewed'
    when exists(select 1 from app_private.reward_athlete_readiness_revocations_v3 where review_id=r.id) then 'revoked'
    when r.profile_fingerprint is distinct from fingerprint then 'profile_changed'
    when r.source_guard_hash is distinct from source->>'sourceGuardHash' then 'source_hold'
    else 'reviewed' end;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if p_role='operator' and not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then raise exception 'reward_readiness_scope_required'; end if;
  return jsonb_build_object('schema','raceson-athlete-readiness-private-v3','actorUserId',p_actor_user_id,'role',p_role,
    'source',source,'destination',destination,'challenge',app_private.reward_wallet_challenge_document(c),
    'profileFingerprint',fingerprint,'dateOfBirth',p.date_of_birth,'birthYear',p.birth_year,'state',state,
    'review',app_private.reward_readiness_document_v3(r));
end $$;

create function public.service_record_reward_readiness_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_upload_id uuid,p_destination_id uuid,p_review_id uuid,p_previous_review_id uuid,p_source_guard_hash text,p_profile_fingerprint text,p_attestation jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; old app_private.reward_athlete_readiness_v3%rowtype; field text;
begin
  -- A single nomination lock also serializes V1 destination withdrawals and V3
  -- readiness revisions. Different upload reviews cannot bypass that boundary.
  v:=public.service_read_reward_readiness_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_upload_id,p_destination_id,'operator');
  if p_review_id is null or p_review_id='00000000-0000-0000-0000-000000000000'::uuid
    or p_source_guard_hash is null or p_source_guard_hash!~'^[0-9a-f]{64}$'
    or p_profile_fingerprint is null or p_profile_fingerprint!~'^[0-9a-f]{64}$'
    or jsonb_typeof(p_attestation) is distinct from 'object' then raise exception 'invalid_reward_readiness_review'; end if;
  select * into old from app_private.reward_athlete_readiness_v3 where id=p_review_id;
  if found then
    if old.upload_id<>p_upload_id or old.destination_id<>p_destination_id or old.previous_review_id is distinct from p_previous_review_id
      or old.reviewed_by_user_id<>p_actor_user_id or old.profile_fingerprint<>p_profile_fingerprint
      or old.source_guard_hash<>p_source_guard_hash or old.attestation<>p_attestation then raise exception 'reward_ledger_idempotency_conflict'; end if;
    return app_private.reward_readiness_document_v3(old); -- Historical retry, never renewed authority.
  end if;
  if v#>>'{review,id}' is distinct from p_previous_review_id::text then raise exception 'reward_readiness_revision_changed'; end if;
  if v->>'profileFingerprint' is distinct from p_profile_fingerprint then raise exception 'reward_readiness_profile_changed'; end if;
  if v#>>'{source,sourceGuardHash}' is distinct from p_source_guard_hash then raise exception 'reward_planning_revision_changed'; end if;
  if v->>'state' not in ('unreviewed','reviewed','revoked','profile_changed') then raise exception 'reward_readiness_hold'; end if;
  if (select count(*) from jsonb_object_keys(p_attestation))<>7 or p_attestation->'schemaVersion' is distinct from '1'::jsonb
    or p_attestation->>'policy' is distinct from 'operator-observed-external-wallet-v1'
    or p_attestation->>'verifiedDateOfBirth' is distinct from v->>'dateOfBirth' then raise exception 'invalid_reward_readiness_review'; end if;
  foreach field in array array['identityEvidenceRef','adultEvidenceRef','walletMfaEvidenceRef','walletRecoveryEvidenceRef'] loop
    if coalesce(p_attestation->>field,'')!~'^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$'
      or p_attestation->>field='00000000-0000-0000-0000-000000000000' then raise exception 'invalid_reward_readiness_review'; end if;
  end loop;
  insert into app_private.reward_athlete_readiness_v3(id,upload_id,destination_id,previous_review_id,source_guard_hash,profile_fingerprint,
    attestation,reviewed_by_user_id,reviewed_session_id) values(p_review_id,p_upload_id,p_destination_id,p_previous_review_id,
    p_source_guard_hash,p_profile_fingerprint,p_attestation,p_actor_user_id,p_actor_session_id) returning * into old;
  return app_private.reward_readiness_document_v3(old);
end $$;

create function public.service_revoke_reward_readiness_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_upload_id uuid,p_destination_id uuid,p_review_id uuid,p_reason text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; r app_private.reward_athlete_readiness_v3%rowtype; old app_private.reward_athlete_readiness_revocations_v3%rowtype;
begin
  v:=public.service_read_reward_readiness_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_upload_id,p_destination_id,'operator');
  select * into r from app_private.reward_athlete_readiness_v3 where id=p_review_id and upload_id=p_upload_id and destination_id=p_destination_id;
  if not found then raise exception 'reward_readiness_scope_required'; end if;
  if p_reason is null or p_reason not in ('identity_uncertain','age_uncertain','wallet_security_changed','operator_correction') then raise exception 'invalid_reward_readiness_review'; end if;
  select * into old from app_private.reward_athlete_readiness_revocations_v3 where review_id=r.id;
  if found then
    if old.reason<>p_reason or old.revoked_by_user_id<>p_actor_user_id then raise exception 'reward_ledger_idempotency_conflict'; end if;
  else
    insert into app_private.reward_athlete_readiness_revocations_v3(review_id,revoked_by_user_id,revoked_session_id,reason)
      values(r.id,p_actor_user_id,p_actor_session_id,p_reason);
  end if;
  return app_private.reward_readiness_document_v3(r);
end $$;
revoke all on function app_private.reward_recipient_source_v3(uuid),app_private.reward_readiness_document_v3(app_private.reward_athlete_readiness_v3),
  public.service_read_reward_readiness_v3(uuid,uuid,integer,uuid,uuid,text),
  public.service_record_reward_readiness_v3(uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text,jsonb),
  public.service_revoke_reward_readiness_v3(uuid,uuid,integer,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_recipient_source_v3(uuid),app_private.reward_readiness_document_v3(app_private.reward_athlete_readiness_v3),
  public.service_read_reward_readiness_v3(uuid,uuid,integer,uuid,uuid,text),
  public.service_record_reward_readiness_v3(uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text,jsonb),
  public.service_revoke_reward_readiness_v3(uuid,uuid,integer,uuid,uuid,uuid,text) to service_role;
commit;
