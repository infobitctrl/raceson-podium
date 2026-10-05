-- Isolated rewards demo only. No raw record packet is an HTTP response.
begin;

create function app_private.require_reward_record_workspace(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,p_campaign_id uuid,p_source_snapshot_id uuid
) returns void language plpgsql volatile security invoker set search_path='' as $$
begin
  perform app_private.require_reward_preparation_scope(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id);
  if not exists(select 1 from app_private.reward_campaigns c join app_private.reward_programmes p on p.id=c.programme_id
    join app_private.reward_source_snapshots s on s.id=p_source_snapshot_id
    where c.id=p_campaign_id and c.pot='race' and s.organization_id=p.organization_id
      and s.league_season_id=p.league_season_id and s.round_ids=c.round_ids) then
    raise exception using errcode='22023',message='reward_record_source_scope_mismatch'; end if;
end $$;

create function public.service_list_reward_operator_record_races(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,p_campaign_id uuid,p_source_snapshot_id uuid,p_after_id uuid default null
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare body jsonb;
begin
  perform app_private.require_reward_record_workspace(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id,p_source_snapshot_id);
  with candidates as (
    select c.id,c.name,e.id edition_id,e.name edition_name,c.start_at,c.distance_km,
      (select s.id from app_private.reward_record_source_snapshots s where s.campaign_id=p_campaign_id
        and s.target_snapshot_id=p_source_snapshot_id and s.prior_race_id=c.id order by s.captured_at desc,s.id desc limit 1) capture_id
    from public.event_categories c join public.event_editions e on e.id=c.event_edition_id
      join public.event_series es on es.id=e.event_series_id join app_private.reward_programmes p on p.id=p_programme_id
    where es.organization_id=p.organization_id and c.status='completed' and e.status='completed' and not e.is_practice
      and c.organizer_deleted_at is null and e.organizer_deleted_at is null and c.results_mode='standard'
      and (p_after_id is null or c.id>p_after_id)
      and not exists(select 1 from app_private.reward_source_snapshots s,jsonb_array_elements(s.source_body->'mappings') m
        where s.id=p_source_snapshot_id and m->>'raceEditionId'=e.id::text)
      and exists(select 1 from public.result_publications pub join public.result_runs run on run.id=pub.result_run_id
        where pub.event_category_id=c.id and pub.publication_state in ('official','corrected') and run.status='succeeded')
    order by c.id limit 26
  ), page as(select * from candidates order by id limit 25)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('raceId',id,'raceName',left(nullif(btrim(name),''),256),
    'eventEditionId',edition_id,'eventName',left(nullif(btrim(edition_name),''),256),'startAt',start_at,
    'distanceMetres',(distance_km*1000)::text,'latestCaptureId',capture_id) order by id) from page),'[]'::jsonb),
    'nextCursor',case when (select count(*) from candidates)>25 then (select id from page order by id desc limit 1) else null end) into body;
  perform app_private.require_reward_record_workspace(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id,p_source_snapshot_id);
  return body||jsonb_build_object('programmeId',p_programme_id,'chainId',p_chain_id,'campaignId',p_campaign_id,'snapshotId',p_source_snapshot_id);
end $$;

-- Internal bundle: target context + optional frozen prior packet + latest
-- division status, including approvals for older target captures. Never infer
-- current source validity or revive an older approval after a withdrawal.
create function public.service_read_reward_operator_record_context(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,p_campaign_id uuid,p_source_snapshot_id uuid,p_prior_snapshot_id uuid default null
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare context jsonb; prior jsonb; approvals jsonb; names jsonb; body jsonb;
begin
  perform app_private.require_reward_record_workspace(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id,p_source_snapshot_id);
  context:=public.service_read_reward_calculation_context(p_campaign_id,p_actor_user_id,p_source_snapshot_id,null);
  if p_prior_snapshot_id is not null then
    prior:=public.service_read_reward_record_snapshot(p_campaign_id,p_actor_user_id,p_prior_snapshot_id);
    if prior->>'targetSnapshotId' is distinct from p_source_snapshot_id::text then
      raise exception using errcode='22023',message='reward_record_source_scope_mismatch'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',left(nullif(btrim(display_name),''),256)) order by id),'[]'::jsonb) into names
      from public.athlete_profiles where id in(select (r->>'canonicalAthleteId')::uuid from jsonb_array_elements(prior#>'{source,rows}') r);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('approvalId',a.id,'snapshotId',a.target_snapshot_id,'priorSnapshotId',a.prior_snapshot_id,
    'raceId',a.target_race_id,'gender',a.gender,'revision',a.revision,'approvedAt',a.approved_at,
    'withdrawnAt',(select w.withdrawn_at from app_private.reward_record_withdrawals w where w.approval_id=a.id)) order by a.target_race_id,a.gender),'[]'::jsonb)
    into approvals from (select distinct on(target_race_id,gender) * from app_private.reward_record_approvals
      where campaign_id=p_campaign_id order by target_race_id,gender,revision desc) a;
  body:=jsonb_build_object('context',context,'priorSnapshot',prior,'names',coalesce(names,'[]'::jsonb),'latestApprovals',approvals,
    'allocationId',(select id from app_private.reward_allocations where campaign_id=p_campaign_id));
  perform app_private.require_reward_record_workspace(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id,p_source_snapshot_id);
  return body;
end $$;

create function public.service_capture_reward_operator_record(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,p_campaign_id uuid,p_source_snapshot_id uuid,p_prior_race_id uuid,p_idempotency_key text
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare captured jsonb;
begin
  perform app_private.require_reward_record_workspace(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id,p_source_snapshot_id);
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 or p_prior_race_id is null then
    raise exception using errcode='22023',message='invalid_reward_record_capture'; end if;
  -- Match the existing capture's lock order. Locking the campaign first can
  -- deadlock an older same-key caller's INSERT foreign-key check while this
  -- caller waits for its advisory lock. The nested capture reacquires our lock.
  perform pg_advisory_xact_lock(hashtextextended('reward-record:'||p_campaign_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key,0));
  perform 1 from app_private.reward_programmes where id=p_programme_id for update;
  perform 1 from app_private.reward_campaigns where id=p_campaign_id for update;
  perform app_private.require_reward_record_workspace(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id,p_source_snapshot_id);
  if exists(select 1 from app_private.reward_allocations where campaign_id=p_campaign_id)
    and not exists(select 1 from app_private.reward_record_source_snapshots where campaign_id=p_campaign_id
      and captured_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key) then
    raise exception using errcode='55000',message='reward_campaign_allocation_already_reserved'; end if;
  captured:=public.service_capture_reward_record_source(p_campaign_id,p_source_snapshot_id,p_actor_user_id,p_prior_race_id,p_idempotency_key);
  perform app_private.require_reward_record_workspace(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id,p_source_snapshot_id);
  return jsonb_build_object('programmeId',p_programme_id,'chainId',p_chain_id,'campaignId',p_campaign_id,'snapshotId',p_source_snapshot_id,
    'priorSnapshotId',captured->'snapshotId','priorRaceId',captured->'priorRaceId','capturedAt',captured->'capturedAt');
end $$;

create function public.service_approve_reward_operator_record(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,p_campaign_id uuid,p_source_snapshot_id uuid,
  p_prior_snapshot_id uuid,p_expected_revision integer,p_idempotency_key text,p_request jsonb
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare body jsonb;
begin
  perform app_private.require_reward_record_workspace(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id,p_source_snapshot_id);
  perform 1 from app_private.reward_programmes where id=p_programme_id for update;
  perform 1 from app_private.reward_campaigns where id=p_campaign_id for update;
  perform app_private.require_reward_record_workspace(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id,p_source_snapshot_id);
  if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>2147483645 then
    raise exception using errcode='22023',message='invalid_reward_record_request'; end if;
  if not exists(select 1 from app_private.reward_record_source_snapshots where id=p_prior_snapshot_id
    and campaign_id=p_campaign_id and target_snapshot_id=p_source_snapshot_id) then
    raise exception using errcode='22023',message='reward_record_source_scope_mismatch'; end if;
  if not exists(select 1 from app_private.reward_record_approvals where campaign_id=p_campaign_id
      and approved_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key)
    and p_expected_revision<>coalesce((select max(revision) from app_private.reward_record_approvals where campaign_id=p_campaign_id
      and target_race_id::text=p_request->>'targetRaceId' and gender=p_request->>'gender'),0) then
    raise exception using errcode='55000',message='reward_record_revision_changed'; end if;
  body:=public.service_approve_reward_record(p_campaign_id,p_actor_user_id,p_prior_snapshot_id,p_idempotency_key,p_request);
  perform app_private.require_reward_record_workspace(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id,p_source_snapshot_id);
  return body;
end $$;

create function public.service_withdraw_reward_operator_record(
  p_actor_user_id uuid,p_actor_session_id uuid,p_programme_id uuid,p_chain_id integer,p_campaign_id uuid,p_source_snapshot_id uuid,
  p_approval_id uuid,p_expected_revision integer,p_idempotency_key text,p_reason text
) returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare approved app_private.reward_record_approvals%rowtype; body jsonb;
begin
  perform app_private.require_reward_record_workspace(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id,p_source_snapshot_id);
  perform 1 from app_private.reward_programmes where id=p_programme_id for update;
  perform 1 from app_private.reward_campaigns where id=p_campaign_id for update;
  perform app_private.require_reward_record_workspace(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id,p_source_snapshot_id);
  select * into approved from app_private.reward_record_approvals where id=p_approval_id and campaign_id=p_campaign_id;
  if approved.id is null then raise exception using errcode='22023',message='reward_record_approval_required'; end if;
  if p_expected_revision is null or p_expected_revision<1 or p_expected_revision>2147483646 then
    raise exception using errcode='22023',message='invalid_reward_record_request'; end if;
  if not exists(select 1 from app_private.reward_record_withdrawals where campaign_id=p_campaign_id
      and withdrawn_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key)
    and (approved.revision<>p_expected_revision or approved.revision<>(select max(revision) from app_private.reward_record_approvals
      where campaign_id=p_campaign_id and target_race_id=approved.target_race_id and gender=approved.gender)) then
    raise exception using errcode='55000',message='reward_record_revision_changed'; end if;
  body:=public.service_withdraw_reward_record(p_campaign_id,p_actor_user_id,p_approval_id,p_idempotency_key,p_reason);
  perform app_private.require_reward_record_workspace(p_actor_user_id,p_actor_session_id,p_programme_id,p_chain_id,p_campaign_id,p_source_snapshot_id);
  return body;
end $$;

revoke all on function app_private.require_reward_record_workspace(uuid,uuid,uuid,integer,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.require_reward_record_workspace(uuid,uuid,uuid,integer,uuid,uuid) to service_role;
revoke all on function public.service_list_reward_operator_record_races(uuid,uuid,uuid,integer,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.service_read_reward_operator_record_context(uuid,uuid,uuid,integer,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.service_capture_reward_operator_record(uuid,uuid,uuid,integer,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.service_approve_reward_operator_record(uuid,uuid,uuid,integer,uuid,uuid,uuid,integer,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.service_withdraw_reward_operator_record(uuid,uuid,uuid,integer,uuid,uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.service_list_reward_operator_record_races(uuid,uuid,uuid,integer,uuid,uuid,uuid) to service_role;
grant execute on function public.service_read_reward_operator_record_context(uuid,uuid,uuid,integer,uuid,uuid,uuid) to service_role;
grant execute on function public.service_capture_reward_operator_record(uuid,uuid,uuid,integer,uuid,uuid,uuid,text) to service_role;
grant execute on function public.service_approve_reward_operator_record(uuid,uuid,uuid,integer,uuid,uuid,uuid,integer,text,jsonb) to service_role;
grant execute on function public.service_withdraw_reward_operator_record(uuid,uuid,uuid,integer,uuid,uuid,uuid,integer,text,text) to service_role;
commit;
