begin;
-- Private preparation for an athlete-facing review. Returns the same internal
-- context as proof storage, NEVER a browser response. Historical recorded
-- consent stays readable; offering new consent needs current source/readiness.
create function public.service_read_reward_athlete_consent_context(
  p_actor_user_id uuid,p_actor_session_id uuid,p_intent_id uuid
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare context jsonb; review_context jsonb;
begin
  context:=public.service_read_reward_athlete_claim_proofs(p_actor_user_id,p_actor_session_id,p_intent_id,'recipient');
  if not exists(select 1 from app_private.reward_athlete_claim_proofs where claim_intent_id=p_intent_id and proof_role='recipient') then
    perform id from app_private.reward_programmes where id=(context->>'programmeId')::uuid for share;
    perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||p_actor_user_id::text,0));
    perform user_id from public.user_profiles where user_id in (p_actor_user_id,(context->>'operatorUserId')::uuid) order by user_id for share;
    perform id from public.athlete_profiles where id=(context#>>'{entitlement,athleteProfileId}')::uuid for share;
    context:=public.service_read_reward_athlete_claim_proofs(p_actor_user_id,p_actor_session_id,p_intent_id,'recipient');
    if not exists(select 1 from app_private.reward_athlete_claim_proofs where claim_intent_id=p_intent_id and proof_role='recipient') then
      review_context:=context->'reviewContext';
      if review_context->>'reviewState' is distinct from 'reviewed'
        or review_context#>>'{latestReview,reviewId}' is distinct from context#>>'{intent,readinessReviewId}'
        or review_context->>'profileFingerprintSha256' is distinct from review_context#>>'{latestReview,profileFingerprintSha256}' then
        raise exception using errcode='42501',message='reward_claim_readiness_required'; end if;
      perform app_private.assert_reward_allocation_source_current((context#>>'{upload,allocationId}')::uuid,(context->>'operatorUserId')::uuid);
      if (context#>>'{upload,body,sourceReviewEndsAt}')::numeric>extract(epoch from clock_timestamp()) then
        raise exception using errcode='42501',message='reward_claim_observation_stale'; end if;
    end if;
  end if;
  -- No borrowed operator session: original recipient authenticates every read.
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return context;
end $$;
revoke all on function public.service_read_reward_athlete_consent_context(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_read_reward_athlete_consent_context(uuid,uuid,uuid) to service_role;
commit;
