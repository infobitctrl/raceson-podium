begin;
-- Owner-approved 2026-09-14 second synthetic persona. Preserve the first
-- policy's meaning and all old review/payment records. No funds or accounts
-- are created here; wallet proof, current ownership and actual consent remain.
create or replace function app_private.reward_privy_synthetic_identity_v3(draft uuid, chain integer, profile uuid, actor uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select app_private.reward_privy_synthetic_programme_v3(draft,chain)
    and profile in ('9a000000-0000-4000-8000-000000001060'::uuid,'9a000000-0000-4000-8000-000000001061'::uuid)
    and exists(select 1 from public.athlete_profiles p where p.id=profile and p.claimed_by_user_id=actor
      and p.is_claimed and p.status='active' and p.merged_into_athlete_profile_id is null
      and p.date_of_birth is null and p.birth_year is null)
$$;

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
  elsif a->>'policy' in ('operator-observed-privy-synthetic-test-v1','operator-observed-privy-synthetic-test-v2') then
    expected:=array['schemaVersion','policy','chainId','privyAppId','draftId','athleteProfileId','syntheticIdentityEvidenceRef','walletProviderEvidenceRef','walletRecoveryEvidenceRef'];
    fields:=array['syntheticIdentityEvidenceRef','walletProviderEvidenceRef','walletRecoveryEvidenceRef'];
    if chain_id is distinct from 10143 or a->'chainId' is distinct from '10143'::jsonb
      or a->'schemaVersion' is distinct from '3'::jsonb
      or a->>'privyAppId' is distinct from 'cmtx921we00fu0cifaab7exez'
      or a->>'draftId' is distinct from '9a000000-0000-4000-8000-000000000052'
      or a->>'athleteProfileId' is distinct from (case a->>'policy'
        when 'operator-observed-privy-synthetic-test-v1' then '9a000000-0000-4000-8000-000000001060'
        else '9a000000-0000-4000-8000-000000001061' end)
      then raise exception 'invalid_reward_readiness_review'; end if;
  else raise exception 'invalid_reward_readiness_review';
  end if;
  if (select count(*) from jsonb_object_keys(a))<>cardinality(expected) or not a ?& expected
    or (a->>'policy' not in ('operator-observed-privy-synthetic-test-v1','operator-observed-privy-synthetic-test-v2') and (
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
  if p_attestation->>'policy' in ('operator-observed-privy-synthetic-test-v1','operator-observed-privy-synthetic-test-v2') then
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
-- CREATE OR REPLACE preserves the original private service-only grants.
commit;
