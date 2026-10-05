begin;
-- Private pre-signing context. It contains capabilities/identity evidence and
-- must pass through a whitelisted service projection before reaching HTTP.
create function public.service_read_reward_club_signing_context(
  p_actor_user_id uuid,p_actor_session_id uuid,p_intent_id uuid,p_role text
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare context jsonb; cc jsonb; recipient uuid; club uuid; chain integer; nomination uuid;
begin
  context:=public.service_read_reward_club_claim_proofs(p_actor_user_id,p_actor_session_id,p_intent_id,p_role);
  if not exists(select 1 from app_private.reward_club_claim_proofs where claim_intent_id=p_intent_id and proof_role=p_role) then
    cc:=context->'claimContext'; recipient:=(cc#>>'{intent,recipientUserId}')::uuid;
    club:=(cc#>>'{intent,clubId}')::uuid; chain:=(cc#>>'{reviewContext,chainId}')::integer;
    nomination:=(cc#>>'{review,requestId}')::uuid;
    perform id from app_private.reward_programmes where id=(context->>'programmeId')::uuid for share;
    perform pg_advisory_xact_lock(hashtextextended('reward-club-account:'||recipient::text,0));
    perform pg_advisory_xact_lock(hashtextextended('reward-club-treasury:'||club::text||':'||chain::text,0));
    perform user_id from public.user_profiles where user_id in(recipient,(context->>'operatorUserId')::uuid) order by user_id for share;
    perform id from public.clubs where id=club for share;
    perform id from public.athlete_profiles where claimed_by_user_id=recipient or id=(select (owner_identity->>'athleteProfileId')::uuid
      from app_private.reward_club_treasury_requests where id=nomination) order by id for share;
    perform id from public.club_memberships where club_id=club order by id for share;
    perform id from public.club_roles where club_id=club order by id for share;
    context:=public.service_read_reward_club_claim_proofs(p_actor_user_id,p_actor_session_id,p_intent_id,p_role);
    if not exists(select 1 from app_private.reward_club_claim_proofs where claim_intent_id=p_intent_id and proof_role=p_role) then
      cc:=context->'claimContext';
      if cc#>>'{reviewContext,reviewState}' is distinct from 'reviewed'
        or cc#>>'{reviewContext,latestReview,reviewId}' is distinct from cc#>>'{intent,treasuryReviewId}'
        or cc#>>'{reviewContext,identityFingerprintSha256}' is distinct from cc#>>'{review,identityFingerprintSha256}' then
        raise exception using errcode='42501',message='reward_claim_readiness_required'; end if;
      if p_role='operator' and not exists(select 1 from app_private.reward_club_claim_proofs where claim_intent_id=p_intent_id and proof_role='recipient') then
        raise exception using errcode='42501',message='reward_claim_recipient_consent_required'; end if;
      perform app_private.assert_reward_allocation_source_current((cc#>>'{lifecycleContext,upload,allocationId}')::uuid,(context->>'operatorUserId')::uuid);
      if (cc#>>'{lifecycleContext,upload,body,sourceReviewEndsAt}')::numeric>extract(epoch from clock_timestamp()) then
        raise exception using errcode='42501',message='reward_claim_observation_stale'; end if;
    end if;
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator((context->>'programmeId')::uuid,(context->>'operatorUserId')::uuid);
  return context;
end $$;
revoke all on function public.service_read_reward_club_signing_context(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_read_reward_club_signing_context(uuid,uuid,uuid,text) to service_role;
commit;
