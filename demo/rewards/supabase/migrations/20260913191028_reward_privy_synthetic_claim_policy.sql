begin;
-- Owner-approved synthetic identity trial: no DOB, age or MFA evidence is invented.
-- Exact demo programme + claimed fixture profile only; private wallet proof and
-- recipient signatures remain mandatory. No production SQL or mainnet support.
create function app_private.reward_privy_synthetic_programme_v3(draft uuid, chain integer)
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce(chain=10143 and draft='9a000000-0000-4000-8000-000000000052'::uuid
    and exists(select 1 from app_private.reward_planning_drafts d
      join app_private.reward_public_snapshots_v2 s on s.season_id=d.season_id and s.organization_id=d.organization_id
      where d.id=draft and d.chain_id=10143 and d.season_id='9a000000-0000-4000-8000-000000000051'::uuid
      and s.payload->>'sourceOrigin'='urn:raceson:synthetic:privy-10:v3'
      and s.payload->>'sourceLeagueId'='9a000000-0000-4000-8000-000000000050'
      and s.payload->>'sourceSeasonId'=d.season_id::text),false)
$$;
create function app_private.reward_privy_synthetic_identity_v3(draft uuid, chain integer, profile uuid, actor uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select app_private.reward_privy_synthetic_programme_v3(draft,chain)
    and profile='9a000000-0000-4000-8000-000000001060'::uuid
    and exists(select 1 from public.athlete_profiles p where p.id=profile and p.claimed_by_user_id=actor
      and p.is_claimed and p.status='active' and p.merged_into_athlete_profile_id is null
      and p.date_of_birth is null and p.birth_year is null)
$$;
revoke all on function app_private.reward_privy_synthetic_programme_v3(uuid,integer),
  app_private.reward_privy_synthetic_identity_v3(uuid,integer,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_privy_synthetic_programme_v3(uuid,integer),
  app_private.reward_privy_synthetic_identity_v3(uuid,integer,uuid,uuid) to service_role;


create or replace function app_private.require_reward_readiness_attestation_v3(a jsonb, chain_id integer)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare fields text[]; expected text[]; field text;
begin
  if jsonb_typeof(a) is distinct from 'object' then raise exception 'invalid_reward_readiness_review'; end if;
  if a->>'policy'='operator-observed-external-wallet-v1' then
    expected:=array['schemaVersion','policy','verifiedDateOfBirth','identityEvidenceRef','adultEvidenceRef','walletMfaEvidenceRef','walletRecoveryEvidenceRef'];
    fields:=array['identityEvidenceRef','adultEvidenceRef','walletMfaEvidenceRef','walletRecoveryEvidenceRef'];
    if a->'schemaVersion' is distinct from '1'::jsonb then raise exception 'invalid_reward_readiness_review'; end if;
  elsif a->>'policy'='operator-observed-privy-testnet-no-mfa-v1' then
    expected:=array['schemaVersion','policy','chainId','privyAppId','verifiedDateOfBirth','identityEvidenceRef','adultEvidenceRef','walletProviderEvidenceRef','walletRecoveryEvidenceRef'];
    fields:=array['identityEvidenceRef','adultEvidenceRef','walletProviderEvidenceRef','walletRecoveryEvidenceRef'];
    if chain_id is distinct from 10143 or a->'chainId' is distinct from '10143'::jsonb
      or a->'schemaVersion' is distinct from '2'::jsonb
      or a->>'privyAppId' is distinct from 'cmtx921we00fu0cifaab7exez'
      then raise exception 'invalid_reward_readiness_review'; end if;
  elsif a->>'policy'='operator-observed-privy-synthetic-test-v1' then
    expected:=array['schemaVersion','policy','chainId','privyAppId','draftId','athleteProfileId','syntheticIdentityEvidenceRef','walletProviderEvidenceRef','walletRecoveryEvidenceRef'];
    fields:=array['syntheticIdentityEvidenceRef','walletProviderEvidenceRef','walletRecoveryEvidenceRef'];
    if chain_id is distinct from 10143 or a->'chainId' is distinct from '10143'::jsonb
      or a->'schemaVersion' is distinct from '3'::jsonb
      or a->>'privyAppId' is distinct from 'cmtx921we00fu0cifaab7exez'
      or a->>'draftId' is distinct from '9a000000-0000-4000-8000-000000000052'
      or a->>'athleteProfileId' is distinct from '9a000000-0000-4000-8000-000000001060'
      then raise exception 'invalid_reward_readiness_review'; end if;
  else raise exception 'invalid_reward_readiness_review';
  end if;
  if (select count(*) from jsonb_object_keys(a))<>cardinality(expected) or not a ?& expected
    or (a->>'policy'<>'operator-observed-privy-synthetic-test-v1' and (
      jsonb_typeof(a->'verifiedDateOfBirth') is distinct from 'string'
      or a->>'verifiedDateOfBirth'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
    then raise exception 'invalid_reward_readiness_review'; end if;
  foreach field in array fields loop
    if jsonb_typeof(a->field) is distinct from 'string'
      or coalesce(a->>field,'')!~'^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$'
      or a->>field='00000000-0000-0000-0000-000000000000'
      then raise exception 'invalid_reward_readiness_review'; end if;
  end loop;
end $$;

create or replace function public.service_read_reward_readiness_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
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
  if a.slot in (5,6) then perform 1 from app_private.reward_planning_drafts where id=d.id for update;
  else perform 1 from app_private.reward_planning_drafts where id=d.id for share; end if;
  source:=app_private.reward_recipient_source_v3(p_upload_id);
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||n.user_id::text,0));
  perform 1 from public.user_profiles where user_id in (i.created_by_user_id,n.user_id) order by user_id for share;
  select * into p from public.athlete_profiles where id=n.athlete_profile_id for share;
  if p_role='recipient' and (p.claimed_by_user_id is distinct from n.user_id or not p.is_claimed or p.status<>'active'
    or p.merged_into_athlete_profile_id is not null) then raise exception 'reward_readiness_scope_required'; end if;
  destination:=app_private.reward_athlete_destination_document(n);
  select ch.* into c from app_private.reward_wallet_challenges ch join app_private.reward_wallet_proofs proof on proof.challenge_id=ch.id where proof.id=n.proof_id;
  if c.chain_id is distinct from p_chain_id or c.user_id is distinct from n.user_id or c.session_id is distinct from n.session_id
    then raise exception 'reward_readiness_scope_required'; end if;
  fingerprint:=app_private.reward_athlete_profile_fingerprint(p.id);
  select * into r from app_private.reward_athlete_readiness_v3 where upload_id=p_upload_id and destination_id=p_destination_id order by sequence desc limit 1;
  today:=(clock_timestamp() at time zone 'Europe/Zagreb')::date;
  state:=case when destination->>'status'='withdrawn' then 'request_withdrawn'
    when destination->>'status'='identity_hold' or not exists(select 1 from public.user_profiles where user_id=n.user_id and status='active') then 'identity_hold'
    when not app_private.reward_privy_synthetic_identity_v3(d.id,p_chain_id,p.id,n.user_id)
      and (p.date_of_birth is null or p.date_of_birth>today or p.date_of_birth>today-interval '18 years'
      or (p.birth_year is not null and p.birth_year<>extract(year from p.date_of_birth))) then 'age_hold'
    when source->>'current'<>'true' then 'source_hold'
    when r.id is null then 'unreviewed'
    when exists(select 1 from app_private.reward_athlete_readiness_revocations_v3 where review_id=r.id) then 'revoked'
    when r.profile_fingerprint is distinct from fingerprint then 'profile_changed'
    when r.source_guard_hash is distinct from source->>'sourceGuardHash' then 'source_hold'
    else 'reviewed' end;
  if source is distinct from app_private.reward_recipient_source_v3(p_upload_id) then raise exception 'reward_planning_revision_changed'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if p_role='operator' and not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then raise exception 'reward_readiness_scope_required'; end if;
  return jsonb_build_object('schema','raceson-athlete-readiness-private-v3','actorUserId',p_actor_user_id,'role',p_role,
    'source',source,'destination',destination,'challenge',app_private.reward_wallet_challenge_document(c),
    'profileFingerprint',fingerprint,'dateOfBirth',p.date_of_birth,'birthYear',p.birth_year,'state',state,
    'review',app_private.reward_readiness_document_v3(r));
end $$;

create or replace function public.service_record_reward_readiness_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_upload_id uuid,p_destination_id uuid,p_review_id uuid,p_previous_review_id uuid,p_source_guard_hash text,p_profile_fingerprint text,p_attestation jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; old app_private.reward_athlete_readiness_v3%rowtype;
begin
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
    return app_private.reward_readiness_document_v3(old);
  end if;
  if v#>>'{review,id}' is distinct from p_previous_review_id::text then raise exception 'reward_readiness_revision_changed'; end if;
  if v->>'profileFingerprint' is distinct from p_profile_fingerprint then raise exception 'reward_readiness_profile_changed'; end if;
  if v#>>'{source,sourceGuardHash}' is distinct from p_source_guard_hash then raise exception 'reward_planning_revision_changed'; end if;
  if v->>'state' not in ('unreviewed','reviewed','revoked','profile_changed') then raise exception 'reward_readiness_hold'; end if;
  perform app_private.require_reward_readiness_attestation_v3(p_attestation,p_chain_id);
  if p_attestation->>'policy'='operator-observed-privy-synthetic-test-v1' then
    if p_attestation->>'draftId' is distinct from v#>>'{source,draftId}'
      or p_attestation->>'athleteProfileId' is distinct from v#>>'{destination,athleteProfileId}'
      or not app_private.reward_privy_synthetic_identity_v3((v#>>'{source,draftId}')::uuid,p_chain_id,
        (v#>>'{destination,athleteProfileId}')::uuid,(v#>>'{destination,userId}')::uuid)
      then raise exception 'invalid_reward_readiness_review'; end if;
  elsif p_attestation->>'verifiedDateOfBirth' is distinct from v->>'dateOfBirth' then
    raise exception 'invalid_reward_readiness_review';
  end if;
  insert into app_private.reward_athlete_readiness_v3(id,upload_id,destination_id,previous_review_id,source_guard_hash,profile_fingerprint,
    attestation,reviewed_by_user_id,reviewed_session_id) values(p_review_id,p_upload_id,p_destination_id,p_previous_review_id,
    p_source_guard_hash,p_profile_fingerprint,p_attestation,p_actor_user_id,p_actor_session_id) returning * into old;
  return app_private.reward_readiness_document_v3(old);
end $$;

create or replace function public.service_reward_round_publication_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_slot integer,p_approval_id uuid,p_upload_id uuid,p_action text,p_request_id uuid,p_review_id uuid,p_package_hash text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d jsonb; v jsonb; fresh jsonb; r app_private.reward_round_reviews_v3%rowtype;
  f app_private.reward_round_publications_v3%rowtype; eligible boolean; seen timestamptz; stamp timestamptz;
begin
  if p_action not in ('read','start','publish') or p_action is null then raise exception 'invalid_reward_round_publication'; end if;
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(d->>'organizationId')::uuid for share;
  perform 1 from public.organizations where id=(d->>'organizationId')::uuid for share;
  if p_action='read' then
    perform 1 from app_private.reward_planning_drafts where id=p_draft_id for share;
  else
    perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  end if;
  v:=public.service_read_reward_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if v#>>'{prepared,id}' is distinct from p_upload_id::text or p_upload_id is null
    then raise exception 'reward_allocation_upload_not_found'; end if;
  eligible:=(p_chain_id=31337 or app_private.reward_privy_synthetic_programme_v3(p_draft_id,p_chain_id))
    and v#>>'{document,source,kind}'='synthetic_rehearsal';
  select * into r from app_private.reward_round_reviews_v3 where upload_id=p_upload_id;
  select * into f from app_private.reward_round_publications_v3 where review_id=r.id;
  if p_action='read' then
    if p_request_id is not null or p_review_id is not null or p_package_hash is not null
      then raise exception 'invalid_reward_round_publication'; end if;
  else
    if not coalesce(eligible,false) then raise exception 'reward_round_publication_unsupported'; end if;
    if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid
      or p_package_hash is distinct from v#>>'{prepared,packageHash}' then raise exception 'reward_round_publication_conflict'; end if;
    if p_action='start' and r.id is not null then
      if p_review_id is not null or r.id is distinct from p_request_id or r.started_by_user_id is distinct from p_actor_user_id
        then raise exception 'reward_round_publication_conflict'; end if;
    elsif p_action='publish' and f.id is not null then
      if p_review_id is distinct from r.id or f.id is distinct from p_request_id or f.published_by_user_id is distinct from p_actor_user_id
        then raise exception 'reward_round_publication_conflict'; end if;
    else
      if v->>'current' is distinct from 'true' then raise exception 'reward_allocation_not_ready'; end if;
      if p_action='start' then
        if p_review_id is not null then raise exception 'reward_round_publication_conflict'; end if;
        insert into app_private.reward_round_reviews_v3(id,upload_id,context_hash,package_hash,review_seconds,started_by_user_id)
          values(p_request_id,p_upload_id,v->>'contextHash',p_package_hash,(v#>>'{document,binding,reviewSeconds}')::integer,p_actor_user_id)
          returning * into r;
      else
        if r.id is null or p_review_id is distinct from r.id then raise exception 'reward_round_publication_conflict'; end if;
        stamp:=clock_timestamp();
        if stamp<r.started_at+make_interval(secs=>r.review_seconds) then raise exception 'reward_round_review_pending'; end if;
        -- Evidence binds this exact synthetic approval/package and genuine server
        -- clocks. No private sporting data or claimant identity goes on chain.
        insert into app_private.reward_round_publications_v3(id,review_id,published_at,published_by_user_id,evidence_hash)
          values(p_request_id,r.id,stamp,p_actor_user_id,'0x'||encode(sha256(convert_to(jsonb_build_object(
            'schema','raceson-synthetic-round-publication-v3','id',p_request_id,'reviewId',r.id,'packageHash',r.package_hash,
            'reviewSeconds',r.review_seconds,'startedAt',r.started_at,'publishedAt',stamp)::text,'UTF8')),'hex')) returning * into f;
      end if;
      fresh:=public.service_read_reward_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
      if fresh->>'current' is distinct from 'true' or fresh->>'contextHash' is distinct from v->>'contextHash'
        then raise exception 'reward_planning_revision_changed'; end if;
    end if;
  end if;
  fresh:=public.service_read_reward_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if fresh->>'contextHash' is distinct from v->>'contextHash' or fresh->>'current' is distinct from v->>'current'
    or fresh->'prepared' is distinct from v->'prepared' then raise exception 'reward_planning_revision_changed'; end if;
  if r.id is not null and (r.package_hash is distinct from v#>>'{prepared,packageHash}'
    or r.context_hash is distinct from v#>>'{prepared,contextHash}' or r.review_seconds<>(v#>>'{document,binding,reviewSeconds}')::integer)
    then raise exception 'reward_round_publication_conflict'; end if;
  seen:=clock_timestamp();
  return jsonb_build_object('schema','raceson-round-publication-view-v3','chainId',p_chain_id,'draftId',p_draft_id,'slot',p_slot,
    'approvalId',p_approval_id,'uploadId',p_upload_id,'packageHash',v#>>'{prepared,packageHash}',
    'supported',coalesce(eligible,false),'current',(fresh->>'current')::boolean,'observedAt',seen,
    'review',case when r.id is null then null else jsonb_build_object('id',r.id,'seconds',r.review_seconds,'startedAt',r.started_at,
      'endsAt',r.started_at+make_interval(secs=>r.review_seconds)) end,
    'publication',case when f.id is null then null else jsonb_build_object('id',f.id,'publishedAt',f.published_at,'evidenceHash',f.evidence_hash) end,
    'canPublish',coalesce(eligible and (fresh->>'current')::boolean and r.id is not null and f.id is null
      and seen>=r.started_at+make_interval(secs=>r.review_seconds),false));
end $$;

create or replace function app_private.reward_programme_publication_binding_v3(p_upload uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r app_private.reward_round_reviews_v3%rowtype; f app_private.reward_round_publications_v3%rowtype;
  u app_private.reward_allocation_uploads_v3%rowtype; document jsonb; f_final app_private.reward_final_publications_v3%rowtype;
begin
  select * into u from app_private.reward_allocation_uploads_v3 where id=p_upload;
  select a.document into document from app_private.reward_allocation_approvals_v3 a where a.id=u.approval_id;
  if document->>'schema'='raceson-allocation-document-v3.2' and document->>'slot' in ('5','6') then
    select * into f_final from app_private.reward_final_publications_v3 where upload_id=p_upload;
    if f_final.id is null or f_final.context_hash is distinct from u.context_hash or f_final.package_hash is distinct from u.package_hash
      or f_final.document->'sourceReview' is distinct from document->'sourceReview'
      or f_final.document->'reviewPeriod' is distinct from u.package->'reviewPeriod'
      or f_final.document->>'approvalId' is distinct from u.approval_id::text
      or f_final.document->>'documentHash' is distinct from u.document_hash
      or f_final.document->'slot' is distinct from document->'slot'
      then raise exception 'reward_final_publication_required'; end if;
    return jsonb_build_object('reviewId',f_final.id,'publicationId',f_final.id,
      'reviewPeriod',f_final.document->'reviewPeriod','reviewStartedAt',f_final.document->'reviewStartedAt',
      'officialPublishedAt',f_final.document->'officialPublishedAt','publicationEvidenceHash','0x'||f_final.evidence_hash);
  end if;
  select * into r from app_private.reward_round_reviews_v3 where upload_id=p_upload;
  select * into f from app_private.reward_round_publications_v3 where review_id=r.id;
  if f.id is null or r.package_hash is distinct from u.package_hash or r.context_hash is distinct from u.context_hash
    or not (u.package->>'chainId'='31337' or app_private.reward_privy_synthetic_programme_v3(
      (select a.draft_id from app_private.reward_allocation_approvals_v3 a where a.id=u.approval_id),(u.package->>'chainId')::integer))
    or document#>>'{source,kind}' is distinct from 'synthetic_rehearsal'
    or r.review_seconds::text is distinct from u.package->>'reviewPeriod' or extract(epoch from r.started_at)<1
    or f.published_at<r.started_at+make_interval(secs=>r.review_seconds)
    then raise exception 'reward_round_publication_required'; end if;
  return jsonb_build_object('reviewId',r.id,'publicationId',f.id,'reviewPeriod',r.review_seconds::text,
    'reviewStartedAt',floor(extract(epoch from r.started_at))::bigint::text,
    'officialPublishedAt',floor(extract(epoch from f.published_at))::bigint::text,'publicationEvidenceHash',f.evidence_hash);
end $$;

create or replace function app_private.guard_reward_programme_activation_intent_v3()
returns trigger language plpgsql security invoker set search_path='' as $$
declare previous app_private.reward_programme_lifecycle_intents_v3%rowtype; u jsonb; publication jsonb; n integer;
begin
  if new.body->>'action'='complete_funding' then return new; end if;
  select * into previous from app_private.reward_programme_lifecycle_intents_v3 where id=new.predecessor_id;
  if new.body->>'action'='upload_awards' then
    if previous.body->>'action' not in('complete_funding','upload_awards')
      then raise exception 'invalid_reward_programme_lifecycle'; end if;
    return new;
  end if;
  if new.body->>'action' not in('stage_allocation','activate') or new.body->>'action' is null
    then raise exception 'invalid_reward_programme_lifecycle'; end if;
  select package into u from app_private.reward_allocation_uploads_v3 where id=new.upload_id;
  publication:=app_private.reward_programme_publication_binding_v3(new.upload_id);
  if (new.slot<=4 and new.chain_id<>31337 and not app_private.reward_privy_synthetic_programme_v3(
    (select i.draft_id from app_private.reward_programme_deployment_intents_v3 i where i.id=new.programme_intent_id),new.chain_id)) or new.body->'publication' is distinct from publication
    or publication->'reviewPeriod' is distinct from u->'reviewPeriod'
    or previous.programme_intent_id is distinct from new.programme_intent_id
    or previous.upload_id is distinct from new.upload_id or previous.slot is distinct from new.slot
    or new.step<>previous.step+1 or new.body->'batchStart' is distinct from 'null'::jsonb
    or new.body->'batchSize' is distinct from 'null'::jsonb
    then raise exception 'reward_round_publication_conflict'; end if;
  if not exists(select 1 from app_private.reward_programme_lifecycle_jobs_v3 j
    join app_private.reward_programme_lifecycle_receipts_v3 c on c.job_id=j.id
    where j.intent_id=previous.id and j.state='confirmed')
    then raise exception 'reward_programme_lifecycle_predecessor_required'; end if;
  n:=jsonb_array_length(u->'awards');
  if new.body->>'action'='stage_allocation' then
    if not((n=0 and previous.body->>'action'='complete_funding')
      or (previous.body->>'action'='upload_awards' and (previous.body->>'batchStart')::integer+(previous.body->>'batchSize')::integer=n))
      then raise exception 'reward_programme_lifecycle_predecessor_required'; end if;
  elsif previous.body->>'action' is distinct from 'stage_allocation' or previous.body->'publication' is distinct from publication then
    raise exception 'reward_programme_lifecycle_predecessor_required';
  end if;
  return new;
end $$;

create or replace function public.service_read_own_reward_allocations_v3(
  p_user_id uuid,p_session_id uuid,p_chain_id integer,p_after_id text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare result jsonb; today date:=(clock_timestamp() at time zone 'Europe/Zagreb')::date;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in (31337,10143)
    or (p_after_id is not null and p_after_id !~ '^0x[0-9a-f]{64}$') then
    raise exception 'invalid_reward_allocation_query';
  end if;
  perform 1 from public.user_profiles where user_id=p_user_id for share;
  perform 1 from public.athlete_profiles where claimed_by_user_id=p_user_id order by id for share;
  with own as (
    select r.*,a.draft_id,a.slot,a.document,a.approved_at,p.date_of_birth,p.birth_year
    from public.athlete_profiles p
    join app_private.reward_allocation_recipients_v3 r on r.source_beneficiary_id=p.id and r.beneficiary_kind='athlete'
    join app_private.reward_allocation_approvals_v3 a on a.id=r.approval_id
    where p.claimed_by_user_id=p_user_id and p.is_claimed and p.status='active' and p.merged_into_athlete_profile_id is null
      and ((a.slot between 1 and 4 and a.document->>'schema'='raceson-allocation-document-v3.1')
        or (a.slot in (5,6) and a.document->>'schema'='raceson-allocation-document-v3.2'))
      and (a.document#>>'{record,chainId}')::integer=p_chain_id
      and (p_after_id is null or r.entitlement_id>decode(substr(p_after_id,3),'hex'))
      and not exists(select 1 from app_private.reward_allocation_approvals_v3 newer
        where newer.draft_id=a.draft_id and newer.slot=a.slot and newer.sequence>a.sequence)
    order by r.entitlement_id limit 51
  ), page as (select * from own order by entitlement_id limit 50)
  select jsonb_build_object('schema','raceson-own-allocations-v3','chainId',p_chain_id,'items',coalesce((select jsonb_agg(
    jsonb_build_object('entitlementId','0x'||encode(entitlement_id,'hex'),'approvalId',approval_id,
      'draftId',draft_id,'slot',slot,'athleteProfileId',source_beneficiary_id,'chainId',p_chain_id,
      'sourceKind',case when slot=5 then 'native_finale' when slot=6 then 'final_league' else document#>>'{source,kind}' end,'amountWei',amount_wei::text,
      'campaignAddress',document#>>'{binding,campaignAddress}',
      'recordedAt',to_char(approved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ageStatus',case
        when app_private.reward_privy_synthetic_identity_v3(draft_id,p_chain_id,source_beneficiary_id,p_user_id) then 'synthetic_test'
        when date_of_birth is not null and (date_of_birth>today or (birth_year is not null and birth_year<>extract(year from date_of_birth))) then 'unknown'
        when date_of_birth is not null and date_of_birth>today-interval '18 years' then 'minor'
        when date_of_birth is null then 'unknown' else 'unverified_adult' end)
    order by entitlement_id) from page),'[]'::jsonb),
    'nextCursor',case when (select count(*) from own)>50 then
      (select '0x'||encode(entitlement_id,'hex') from page order by entitlement_id desc limit 1) else null end) into result;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  return result;
end $$;

-- Existing service-only grants are retained by CREATE OR REPLACE.

commit;
