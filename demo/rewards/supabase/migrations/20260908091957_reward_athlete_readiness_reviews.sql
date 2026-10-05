begin;

-- Programme-scoped operator attestations, not payment consent. Evidence refs
-- identify the operator's private audit records; SQL cannot verify their truth.
-- Never store identity-document images, recovery phrases or MFA secrets here.
create table app_private.reward_athlete_readiness_reviews (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references app_private.reward_programmes(id) on delete restrict,
  request_id uuid not null references app_private.reward_athlete_destination_requests(id) on delete restrict,
  revision integer not null check(revision>0),
  reviewed_by_user_id uuid not null,
  reviewed_session_id uuid not null,
  reviewed_at timestamptz not null default clock_timestamp(),
  profile_fingerprint_sha256 text not null check(profile_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  attestation jsonb not null check(jsonb_typeof(attestation)='object' and octet_length(attestation::text)<2048),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  unique(programme_id,request_id,revision),
  unique(programme_id,reviewed_by_user_id,idempotency_key)
);
create index reward_readiness_request on app_private.reward_athlete_readiness_reviews(request_id);
create table app_private.reward_athlete_readiness_revocations (
  review_id uuid primary key references app_private.reward_athlete_readiness_reviews(id) on delete restrict,
  revoked_by_user_id uuid not null,
  revoked_session_id uuid not null,
  revoked_at timestamptz not null default clock_timestamp(),
  reason text not null check(reason in ('identity_uncertain','age_uncertain','wallet_security_changed','operator_correction'))
);
do $$ declare name text; begin
  foreach name in array array['reward_athlete_readiness_reviews','reward_athlete_readiness_revocations'] loop
    execute format('alter table app_private.%I enable row level security',name);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',name);
    execute format('grant select,insert on app_private.%I to service_role',name);
    execute format('create policy %I on app_private.%I for select to service_role using(true)',name||'_service_select',name);
    execute format('create policy %I on app_private.%I for insert to service_role with check(true)',name||'_service_insert',name);
    execute format('create trigger reward_readiness_immutable before update or delete on app_private.%I for each row execute function app_private.reject_reward_ledger_mutation()',name);
  end loop;
end $$;

-- Version plus fields prevents change-and-change-back from reviving a review.
-- Any profile update conservatively requires review again; no public version
-- column, trigger, new Auth grant or security-definer function is introduced.
create function app_private.reward_athlete_profile_fingerprint(p_profile_id uuid)
returns text language sql volatile security invoker set search_path='' set timezone='UTC' as $$
  select encode(sha256(convert_to(jsonb_build_object('id',a.id,'version',a.xmin::text,
    'updatedAt',a.updated_at,'userId',a.claimed_by_user_id,'claimed',a.is_claimed,
    'status',a.status,'mergedInto',a.merged_into_athlete_profile_id,
    'dateOfBirth',a.date_of_birth,'birthYear',a.birth_year)::text,'UTF8')),'hex')
  from public.athlete_profiles a where a.id=p_profile_id;
$$;

create function app_private.reward_athlete_review_document(r app_private.reward_athlete_readiness_reviews)
returns jsonb language sql volatile security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('reviewId',r.id,'programmeId',r.programme_id,'requestId',r.request_id,
    'revision',r.revision,'reviewedByUserId',r.reviewed_by_user_id,'reviewedSessionId',r.reviewed_session_id,
    'reviewedAt',r.reviewed_at,'profileFingerprintSha256',r.profile_fingerprint_sha256,
    'attestation',r.attestation,'idempotencyKey',r.idempotency_key,
    'revokedAt',v.revoked_at,'revocationReason',v.reason)
  from (select 1) stub left join app_private.reward_athlete_readiness_revocations v on v.review_id=r.id;
$$;

-- Private subject projection; callers must authorize the actual actor first.
-- Shared by operator review and later recipient consent, never a browser RPC.
create function app_private.reward_athlete_review_context(p_programme_id uuid,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare d app_private.reward_athlete_destination_requests%rowtype; c app_private.reward_wallet_challenges%rowtype;
  a public.athlete_profiles%rowtype; r app_private.reward_athlete_readiness_reviews%rowtype;
  fingerprint text; state text; destination jsonb; programme app_private.reward_programmes%rowtype;
begin
  select * into programme from app_private.reward_programmes where id=p_programme_id;
  if not found then raise exception using errcode='42501',message='reward_readiness_scope_required'; end if;
  select * into d from app_private.reward_athlete_destination_requests where id=p_request_id;
  if not found then raise exception using errcode='42501',message='reward_readiness_scope_required'; end if;
  -- Scope is earned programme participation, including reverse merge aliases.
  -- This does not itself approve a merged entitlement's payment mapping.
  if not exists(with recursive aliases(id) as (
    select d.athlete_profile_id union select p.id from public.athlete_profiles p join aliases x on p.merged_into_athlete_profile_id=x.id
  ) select 1 from aliases x join app_private.reward_beneficiaries b on b.entity_id=x.id and b.kind='athlete'
    join app_private.reward_campaigns campaign on campaign.id=b.campaign_id where campaign.programme_id=p_programme_id)
    and not exists(select 1 from app_private.reward_athlete_readiness_reviews where programme_id=p_programme_id and request_id=d.id) then
    raise exception using errcode='42501',message='reward_readiness_scope_required'; end if;
  select ch.* into c from app_private.reward_wallet_challenges ch join app_private.reward_wallet_proofs proof on proof.challenge_id=ch.id where proof.id=d.proof_id;
  if c.chain_id is distinct from programme.chain_id then raise exception using errcode='42501',message='reward_readiness_scope_required'; end if;
  select * into a from public.athlete_profiles where id=d.athlete_profile_id;
  fingerprint:=app_private.reward_athlete_profile_fingerprint(a.id);
  destination:=app_private.reward_athlete_destination_document(d);
  select * into r from app_private.reward_athlete_readiness_reviews where programme_id=p_programme_id and request_id=d.id order by revision desc limit 1;
  state:=case
    when destination->>'status'='withdrawn' then 'request_withdrawn'
    when destination->>'status'='identity_hold' or not exists(select 1 from public.user_profiles where user_id=d.user_id and status='active') then 'identity_hold'
    when a.date_of_birth is null or a.date_of_birth>(clock_timestamp() at time zone 'Europe/Zagreb')::date
      or (a.birth_year is not null and a.birth_year<>extract(year from a.date_of_birth)::integer)
      or a.date_of_birth>((clock_timestamp() at time zone 'Europe/Zagreb')::date-interval '18 years')::date then 'age_hold'
    when r.id is null then 'unreviewed'
    when exists(select 1 from app_private.reward_athlete_readiness_revocations where review_id=r.id) then 'revoked'
    when r.profile_fingerprint_sha256 is distinct from fingerprint then 'profile_changed'
    else 'reviewed' end;
  return jsonb_build_object('programmeId',programme.id,'operatorUserId',programme.operator_user_id,'chainId',programme.chain_id,
    'destination',destination,'challenge',app_private.reward_wallet_challenge_document(c),
    'profileFingerprintSha256',fingerprint,'dateOfBirth',a.date_of_birth,'birthYear',a.birth_year,
    'latestReview',case when r.id is null then null else app_private.reward_athlete_review_document(r) end,'reviewState',state);
end $$;

create function public.service_read_reward_athlete_review_context(p_programme_id uuid,p_actor_user_id uuid,p_actor_session_id uuid,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  return app_private.reward_athlete_review_context(p_programme_id,p_request_id);
end $$;

create function public.service_record_reward_athlete_review(p_programme_id uuid,p_actor_user_id uuid,p_actor_session_id uuid,
  p_request_id uuid,p_expected_profile_fingerprint text,p_expected_revision integer,p_attestation jsonb,p_idempotency_key text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare d app_private.reward_athlete_destination_requests%rowtype; r app_private.reward_athlete_readiness_reviews%rowtype;
  context jsonb; field text; revision integer;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  perform id from app_private.reward_programmes where id=p_programme_id for update;
  select * into d from app_private.reward_athlete_destination_requests where id=p_request_id;
  if not found then raise exception using errcode='42501',message='reward_readiness_scope_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||d.user_id::text,0));
  perform user_id from public.user_profiles where user_id in (p_actor_user_id,d.user_id) order by user_id for share;
  perform id from public.athlete_profiles where id=d.athlete_profile_id for share;
  context:=public.service_read_reward_athlete_review_context(p_programme_id,p_actor_user_id,p_actor_session_id,p_request_id);
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or p_expected_profile_fingerprint is null or p_expected_profile_fingerprint !~ '^[0-9a-f]{64}$'
    or p_expected_revision is null or p_expected_revision<0
    or p_attestation is null or jsonb_typeof(p_attestation) is distinct from 'object' then
    raise exception using errcode='22023',message='invalid_reward_readiness_review'; end if;
  if (select count(*) from jsonb_object_keys(p_attestation))<>7
    or p_attestation->'schemaVersion' is distinct from '1'::jsonb
    or p_attestation->>'policy' is distinct from 'operator-observed-external-wallet-v1'
    or coalesce(p_attestation->>'verifiedDateOfBirth','') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception using errcode='22023',message='invalid_reward_readiness_review'; end if;
  foreach field in array array['identityEvidenceRef','adultEvidenceRef','walletMfaEvidenceRef','walletRecoveryEvidenceRef'] loop
    if coalesce(p_attestation->>field,'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or p_attestation->>field='00000000-0000-0000-0000-000000000000' then
      raise exception using errcode='22023',message='invalid_reward_readiness_review'; end if;
  end loop;
  select * into r from app_private.reward_athlete_readiness_reviews where programme_id=p_programme_id
    and reviewed_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    if r.request_id is distinct from p_request_id or r.profile_fingerprint_sha256 is distinct from p_expected_profile_fingerprint
      or r.revision<>p_expected_revision+1 or r.attestation is distinct from p_attestation then
      raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
    -- Historical retry never renews readiness, freshness or a revoked review.
    return app_private.reward_athlete_review_document(r);
  end if;
  revision:=coalesce((context->'latestReview'->>'revision')::integer,0);
  if revision<>p_expected_revision then raise exception using errcode='22023',message='reward_readiness_revision_changed'; end if;
  if context->>'profileFingerprintSha256' is distinct from p_expected_profile_fingerprint then
    raise exception using errcode='22023',message='reward_readiness_profile_changed'; end if;
  if context->>'reviewState' in ('request_withdrawn','identity_hold','age_hold') then
    raise exception using errcode='42501',message='reward_readiness_hold'; end if;
  if context->>'dateOfBirth' is distinct from p_attestation->>'verifiedDateOfBirth' then
    raise exception using errcode='22023',message='reward_readiness_profile_changed'; end if;
  insert into app_private.reward_athlete_readiness_reviews(programme_id,request_id,revision,reviewed_by_user_id,reviewed_session_id,
    profile_fingerprint_sha256,attestation,idempotency_key)
    values(p_programme_id,p_request_id,revision+1,p_actor_user_id,p_actor_session_id,p_expected_profile_fingerprint,p_attestation,p_idempotency_key)
    returning * into r;
  return app_private.reward_athlete_review_document(r);
end $$;

create function public.service_revoke_reward_athlete_review(p_programme_id uuid,p_actor_user_id uuid,p_actor_session_id uuid,p_review_id uuid,p_reason text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare r app_private.reward_athlete_readiness_reviews%rowtype; recipient uuid; prior text;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  perform id from app_private.reward_programmes where id=p_programme_id for update;
  select * into r from app_private.reward_athlete_readiness_reviews where id=p_review_id and programme_id=p_programme_id;
  if not found then raise exception using errcode='42501',message='reward_readiness_scope_required'; end if;
  select user_id into recipient from app_private.reward_athlete_destination_requests where id=r.request_id;
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||recipient::text,0));
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  if p_reason is null or p_reason not in ('identity_uncertain','age_uncertain','wallet_security_changed','operator_correction') then
    raise exception using errcode='22023',message='invalid_reward_readiness_review'; end if;
  select reason into prior from app_private.reward_athlete_readiness_revocations where review_id=r.id;
  if found and prior<>p_reason then raise exception using errcode='22023',message='reward_ledger_idempotency_conflict'; end if;
  insert into app_private.reward_athlete_readiness_revocations(review_id,revoked_by_user_id,revoked_session_id,reason)
    values(r.id,p_actor_user_id,p_actor_session_id,p_reason) on conflict(review_id) do nothing;
  return app_private.reward_athlete_review_document(r);
end $$;

revoke all on function app_private.reward_athlete_profile_fingerprint(uuid),
  app_private.reward_athlete_review_context(uuid,uuid),
  app_private.reward_athlete_review_document(app_private.reward_athlete_readiness_reviews),
  public.service_read_reward_athlete_review_context(uuid,uuid,uuid,uuid),
  public.service_record_reward_athlete_review(uuid,uuid,uuid,uuid,text,integer,jsonb,text),
  public.service_revoke_reward_athlete_review(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_athlete_profile_fingerprint(uuid),
  app_private.reward_athlete_review_context(uuid,uuid),
  app_private.reward_athlete_review_document(app_private.reward_athlete_readiness_reviews),
  public.service_read_reward_athlete_review_context(uuid,uuid,uuid,uuid),
  public.service_record_reward_athlete_review(uuid,uuid,uuid,uuid,text,integer,jsonb,text),
  public.service_revoke_reward_athlete_review(uuid,uuid,uuid,uuid,text) to service_role;
commit;
