begin;

-- Owner-approved 2026-09-13, isolated demo only. This never manufactures MFA
-- evidence or changes V1 review policy, age/profile/source checks or consent.
create function app_private.require_reward_readiness_attestation_v3(a jsonb, chain_id integer)
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
  else raise exception 'invalid_reward_readiness_review';
  end if;
  if (select count(*) from jsonb_object_keys(a))<>cardinality(expected) or not a ?& expected
    or jsonb_typeof(a->'verifiedDateOfBirth') is distinct from 'string'
    or a->>'verifiedDateOfBirth'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    then raise exception 'invalid_reward_readiness_review'; end if;
  foreach field in array fields loop
    if jsonb_typeof(a->field) is distinct from 'string'
      or coalesce(a->>field,'')!~'^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$'
      or a->>field='00000000-0000-0000-0000-000000000000'
      then raise exception 'invalid_reward_readiness_review'; end if;
  end loop;
end $$;
revoke all on function app_private.require_reward_readiness_attestation_v3(jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function app_private.require_reward_readiness_attestation_v3(jsonb,integer) to service_role;

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
  if p_attestation->>'verifiedDateOfBirth' is distinct from v->>'dateOfBirth' then raise exception 'invalid_reward_readiness_review'; end if;
  insert into app_private.reward_athlete_readiness_v3(id,upload_id,destination_id,previous_review_id,source_guard_hash,profile_fingerprint,
    attestation,reviewed_by_user_id,reviewed_session_id) values(p_review_id,p_upload_id,p_destination_id,p_previous_review_id,
    p_source_guard_hash,p_profile_fingerprint,p_attestation,p_actor_user_id,p_actor_session_id) returning * into old;
  return app_private.reward_readiness_document_v3(old);
end $$;
-- CREATE OR REPLACE retains grants; explicitly restate the service-only boundary.
revoke all on function public.service_record_reward_readiness_v3(uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_record_reward_readiness_v3(uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text,jsonb) to service_role;

commit;
