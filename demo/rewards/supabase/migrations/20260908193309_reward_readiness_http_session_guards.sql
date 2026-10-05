begin;

-- Demo-only HTTP readiness boundary. Preserve locked review/retry semantics,
-- then recheck the actual session and programme authority after every read or
-- write, including table-lock waits. A failed final check rolls back the write.

create or replace function public.service_read_reward_athlete_review_context(p_programme_id uuid,p_actor_user_id uuid,p_actor_session_id uuid,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  result:=app_private.reward_athlete_review_context(p_programme_id,p_request_id);
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  return result;
end $$;

create or replace function public.service_record_reward_athlete_review(p_programme_id uuid,p_actor_user_id uuid,p_actor_session_id uuid,
  p_request_id uuid,p_expected_profile_fingerprint text,p_expected_revision integer,p_attestation jsonb,p_idempotency_key text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare d app_private.reward_athlete_destination_requests%rowtype; r app_private.reward_athlete_readiness_reviews%rowtype;
  context jsonb; result jsonb; field text; revision integer;
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
    result:=app_private.reward_athlete_review_document(r);
    perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
    perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
    return result;
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
  result:=app_private.reward_athlete_review_document(r);
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  return result;
end $$;

create or replace function public.service_revoke_reward_athlete_review(p_programme_id uuid,p_actor_user_id uuid,p_actor_session_id uuid,p_review_id uuid,p_reason text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare r app_private.reward_athlete_readiness_reviews%rowtype; recipient uuid; prior text; result jsonb;
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
  result:=app_private.reward_athlete_review_document(r);
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  return result;
end $$;

revoke all on function public.service_read_reward_athlete_review_context(uuid,uuid,uuid,uuid),
  public.service_record_reward_athlete_review(uuid,uuid,uuid,uuid,text,integer,jsonb,text),
  public.service_revoke_reward_athlete_review(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_read_reward_athlete_review_context(uuid,uuid,uuid,uuid),
  public.service_record_reward_athlete_review(uuid,uuid,uuid,uuid,text,integer,jsonb,text),
  public.service_revoke_reward_athlete_review(uuid,uuid,uuid,uuid,text) to service_role;
commit;
