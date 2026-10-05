begin;

-- A private service bundle, not a browser/public reward projection. STABLE keeps
-- the programme, exact historical review and source on one statement snapshot.
-- This is a read, not source-freshness approval; each write rechecks current data.
create function public.service_read_reward_calculation_context(
  p_campaign_id uuid, p_actor_user_id uuid,
  p_source_snapshot_id uuid default null, p_review_id uuid default null
)
returns jsonb language plpgsql stable security invoker set search_path = '' set timezone = 'UTC' as $$
declare
  campaign app_private.reward_campaigns%rowtype;
  programme app_private.reward_programmes%rowtype;
  review app_private.reward_sporting_reviews%rowtype;
  snapshot app_private.reward_source_snapshots%rowtype;
  snapshot_id uuid;
begin
  select * into campaign from app_private.reward_campaigns where id = p_campaign_id;
  perform app_private.require_reward_operator(campaign.programme_id, p_actor_user_id);
  select * into programme from app_private.reward_programmes where id = campaign.programme_id;
  if (p_source_snapshot_id is null) = (p_review_id is null) then
    raise exception using errcode = '22023', message = 'invalid_reward_calculation_reference';
  end if;
  if p_review_id is not null then
    select * into review from app_private.reward_sporting_reviews
      where id = p_review_id and campaign_id = campaign.id;
    if review.id is null then
      raise exception using errcode = '22023', message = 'reward_calculation_reference_mismatch';
    end if;
    snapshot_id := review.source_snapshot_id;
  else
    snapshot_id := p_source_snapshot_id;
  end if;
  select * into snapshot from app_private.reward_source_snapshots where id = snapshot_id;
  if snapshot.id is null or snapshot.organization_id <> programme.organization_id
    or snapshot.league_season_id <> programme.league_season_id or snapshot.round_ids <> campaign.round_ids then
    raise exception using errcode = '22023', message = 'reward_calculation_reference_mismatch';
  end if;
  return jsonb_build_object('schemaVersion', 1,
    'programme', jsonb_build_object('id', programme.id, 'organizationId', programme.organization_id,
      'seasonId', programme.league_season_id, 'operatorUserId', programme.operator_user_id,
      'environment', programme.environment, 'chainId', programme.chain_id,
      'budgetWei', programme.budget_wei::text, 'configuration', programme.configuration),
    'campaign', jsonb_build_object('id', campaign.id, 'scopeKey', campaign.scope_key, 'pot', campaign.pot,
      'roundIds', campaign.round_ids, 'budgetWei', campaign.budget_wei::text),
    'snapshot', jsonb_build_object('snapshotId', snapshot.id, 'capturedAt', snapshot.captured_at,
      'sourceFingerprintSha256', snapshot.source_fingerprint_sha256, 'source', snapshot.source_body),
    'review', case when review.id is null then 'null'::jsonb else jsonb_build_object(
      'id', review.id, 'revision', review.revision, 'reviewedAt', review.reviewed_at,
      'reviewedByUserId', review.reviewed_by_user_id, 'body', review.review_body) end);
end
$$;
revoke all on function public.service_read_reward_calculation_context(uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.service_read_reward_calculation_context(uuid,uuid,uuid,uuid) to service_role;

commit;
