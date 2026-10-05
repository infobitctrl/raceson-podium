-- Independent demo: capture source and record sporting decisions, never payouts.
begin;

create function public.service_read_reward_operator_sporting_context(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,p_campaign_id uuid,
  p_source_snapshot_id uuid default null,p_record_approval_ids uuid[] default array[]::uuid[]
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare campaign app_private.reward_campaigns%rowtype; programme app_private.reward_programmes%rowtype;
  selected_id uuid; latest_id uuid; latest_revision integer; context jsonb; names jsonb; records jsonb; body jsonb;
begin
  perform app_private.require_reward_preparation_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id);
  if p_record_approval_ids is null or cardinality(p_record_approval_ids)>4
    or array_position(p_record_approval_ids,null) is not null
    or cardinality(p_record_approval_ids)<>(select count(distinct id) from unnest(p_record_approval_ids) id) then
    raise exception using errcode='22023',message='invalid_reward_sporting_request'; end if;
  select * into campaign from app_private.reward_campaigns where id=p_campaign_id;
  select * into programme from app_private.reward_programmes where id=p_programme_id;
  select id,revision into latest_id,latest_revision from app_private.reward_sporting_reviews
    where campaign_id=p_campaign_id order by revision desc limit 1;
  selected_id:=p_source_snapshot_id;
  if selected_id is null then
    select id into selected_id from app_private.reward_source_snapshots
      where organization_id=programme.organization_id and league_season_id=programme.league_season_id
        and round_ids=campaign.round_ids order by captured_at desc,id desc limit 1;
  end if;
  if selected_id is not null then
    context:=public.service_read_reward_calculation_context(p_campaign_id,p_actor_user_id,selected_id,null);
    select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'name',left(nullif(btrim(name),''),256)) order by kind,id),'[]'::jsonb)
      into names from (
        select distinct 'athlete' kind,a.id,a.display_name name from jsonb_array_elements(context#>'{snapshot,source,rows}') r
          join public.athlete_profiles a on a.id=(r->>'canonicalAthleteId')::uuid
        union
        select distinct 'club' kind,c.id,c.name from jsonb_array_elements(context#>'{snapshot,source,rows}') r
          join public.clubs c on c.id=(r->>'canonicalClubId')::uuid
      ) labels;
  end if;
  select coalesce(jsonb_agg(public.service_read_reward_record_approval(p_campaign_id,p_actor_user_id,id) order by id),'[]'::jsonb)
    into records from unnest(p_record_approval_ids) id;
  body:=jsonb_build_object('programmeId',p_programme_id,'chainId',p_chain_id,'campaignId',p_campaign_id,
    'latestReviewId',latest_id,'latestRevision',coalesce(latest_revision,0),
    'allocationId',(select id from app_private.reward_allocations where campaign_id=p_campaign_id),
    'context',context,'names',coalesce(names,'[]'::jsonb),'recordApprovals',records);
  perform app_private.require_reward_preparation_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id);
  return body;
end $$;

create function public.service_capture_reward_operator_source(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,p_campaign_id uuid,p_idempotency_key text
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare campaign app_private.reward_campaigns%rowtype; programme app_private.reward_programmes%rowtype; captured jsonb;
begin
  perform app_private.require_reward_preparation_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id);
  select * into programme from app_private.reward_programmes where id=p_programme_id for update;
  select * into campaign from app_private.reward_campaigns where id=p_campaign_id for update;
  perform app_private.require_reward_preparation_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id);
  if exists(select 1 from app_private.reward_allocations where campaign_id=p_campaign_id)
    and not exists(select 1 from app_private.reward_source_snapshots where organization_id=programme.organization_id
      and captured_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key
      and league_season_id=programme.league_season_id and round_ids=campaign.round_ids) then
    raise exception using errcode='55000',message='reward_campaign_allocation_already_reserved'; end if;
  captured:=public.service_capture_reward_source(programme.organization_id,programme.league_season_id,campaign.round_ids,p_actor_user_id,p_idempotency_key);
  perform app_private.require_reward_preparation_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id);
  return jsonb_build_object('programmeId',p_programme_id,'chainId',p_chain_id,'campaignId',p_campaign_id,
    'snapshotId',captured->'snapshotId','capturedAt',captured->'capturedAt');
end $$;

create function public.service_record_reward_operator_sporting_review(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,p_campaign_id uuid,
  p_source_snapshot_id uuid,p_expected_revision integer,p_idempotency_key text,p_review jsonb
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare body jsonb;
begin
  perform app_private.require_reward_preparation_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id);
  perform 1 from app_private.reward_programmes where id=p_programme_id for update;
  perform 1 from app_private.reward_campaigns where id=p_campaign_id for update;
  perform app_private.require_reward_preparation_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id);
  if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>2147483645 then
    raise exception using errcode='22023',message='invalid_reward_sporting_request'; end if;
  -- An exact retry returns its original review even after a later review or
  -- allocation. A NEW decision must match the latest revision seen by the user.
  if not exists(select 1 from app_private.reward_sporting_reviews where campaign_id=p_campaign_id
    and reviewed_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key)
    and p_expected_revision<>coalesce((select max(revision) from app_private.reward_sporting_reviews where campaign_id=p_campaign_id),0) then
    raise exception using errcode='55000',message='reward_sporting_revision_changed'; end if;
  body:=public.service_record_reward_sporting_review(p_campaign_id,p_source_snapshot_id,p_actor_user_id,p_idempotency_key,p_review);
  perform app_private.require_reward_preparation_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id);
  return body||jsonb_build_object('programmeId',p_programme_id,'chainId',p_chain_id);
end $$;

revoke all on function public.service_read_reward_operator_sporting_context(uuid,uuid,uuid,integer,uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
revoke all on function public.service_capture_reward_operator_source(uuid,uuid,uuid,integer,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.service_record_reward_operator_sporting_review(uuid,uuid,uuid,integer,uuid,uuid,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_read_reward_operator_sporting_context(uuid,uuid,uuid,integer,uuid,uuid,uuid[]) to service_role;
grant execute on function public.service_capture_reward_operator_source(uuid,uuid,uuid,integer,uuid,text) to service_role;
grant execute on function public.service_record_reward_operator_sporting_review(uuid,uuid,uuid,integer,uuid,uuid,integer,text,jsonb) to service_role;
commit;
