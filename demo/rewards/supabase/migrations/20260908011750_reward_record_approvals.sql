begin;

create table app_private.reward_record_approvals (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app_private.reward_campaigns(id),
  target_snapshot_id uuid not null references app_private.reward_source_snapshots(id),
  prior_snapshot_id uuid not null references app_private.reward_record_source_snapshots(id),
  target_race_id uuid not null,
  gender text not null check (gender in ('M','F')),
  revision integer not null check (revision > 0),
  approved_by_user_id uuid not null,
  approved_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  request_body jsonb not null check (jsonb_typeof(request_body) = 'object' and octet_length(request_body::text) <= 16384),
  unique (campaign_id, target_race_id, gender, revision),
  unique (campaign_id, approved_by_user_id, idempotency_key)
);
create index reward_record_approvals_target_idx on app_private.reward_record_approvals(target_snapshot_id);
create index reward_record_approvals_prior_idx on app_private.reward_record_approvals(prior_snapshot_id);
create table app_private.reward_record_withdrawals (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references app_private.reward_record_approvals(id) unique,
  campaign_id uuid not null references app_private.reward_campaigns(id),
  withdrawn_by_user_id uuid not null,
  withdrawn_at timestamptz not null default clock_timestamp(),
  reason text not null check (length(btrim(reason)) between 8 and 4000),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  unique (campaign_id, withdrawn_by_user_id, idempotency_key)
);
do $$ declare name text; begin
  foreach name in array array['reward_record_approvals','reward_record_withdrawals'] loop
    execute format('alter table app_private.%I enable row level security', name);
    execute format('revoke all on app_private.%I from public, anon, authenticated, service_role', name);
    execute format('grant select, insert on app_private.%I to service_role', name);
    execute format('create policy %I on app_private.%I for select to service_role using (true)', name || '_select', name);
    execute format('create policy %I on app_private.%I for insert to service_role with check (true)', name || '_insert', name);
    execute format('create trigger reward_ledger_immutable before update or delete on app_private.%I for each row execute function app_private.reject_reward_ledger_mutation()', name);
  end loop;
end $$;

create function public.service_read_reward_record_snapshot(p_campaign_id uuid, p_actor_user_id uuid, p_snapshot_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' set timezone = 'UTC' as $$
declare campaign app_private.reward_campaigns%rowtype; captured app_private.reward_record_source_snapshots%rowtype;
begin
  select * into campaign from app_private.reward_campaigns where id = p_campaign_id;
  perform app_private.require_reward_operator(campaign.programme_id, p_actor_user_id);
  select * into captured from app_private.reward_record_source_snapshots where id = p_snapshot_id and campaign_id = p_campaign_id;
  if captured.id is null then raise exception using errcode = '22023', message = 'reward_record_source_scope_mismatch'; end if;
  return jsonb_build_object('snapshotId', captured.id, 'campaignId', captured.campaign_id, 'targetSnapshotId', captured.target_snapshot_id,
    'priorRaceId', captured.prior_race_id, 'capturedAt', captured.captured_at, 'sourceFingerprintSha256', captured.source_fingerprint_sha256,
    'source', captured.source_body);
end $$;

-- Historical read for exact retries/audit. The current-source/revocation gate is
-- separate; a readable old approval is not renewed authority to allocate or pay.
create function public.service_read_reward_record_approval(p_campaign_id uuid, p_actor_user_id uuid, p_approval_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' set timezone = 'UTC' as $$
declare campaign app_private.reward_campaigns%rowtype; approved app_private.reward_record_approvals%rowtype;
begin
  select * into campaign from app_private.reward_campaigns where id = p_campaign_id;
  perform app_private.require_reward_operator(campaign.programme_id, p_actor_user_id);
  select * into approved from app_private.reward_record_approvals where id = p_approval_id and campaign_id = p_campaign_id;
  if approved.id is null then raise exception using errcode = '22023', message = 'reward_record_approval_required'; end if;
  return jsonb_build_object('approvalId', approved.id, 'campaignId', approved.campaign_id, 'targetSnapshotId', approved.target_snapshot_id,
    'priorSnapshotId', approved.prior_snapshot_id, 'revision', approved.revision, 'approvedByUserId', approved.approved_by_user_id,
    'approvedAt', approved.approved_at, 'body', approved.request_body,
    'priorSnapshot', public.service_read_reward_record_snapshot(p_campaign_id, p_actor_user_id, approved.prior_snapshot_id));
end $$;

-- Application code derives/validates this body from BOTH stored source packets,
-- never a browser-supplied derived baseline. SQL binds facts and independently
-- checks current source/authority while programme mutations are serialized.
create function public.service_approve_reward_record(p_campaign_id uuid, p_actor_user_id uuid,
  p_prior_snapshot_id uuid, p_idempotency_key text, p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = '' set timezone = 'UTC' as $$
declare
  campaign app_private.reward_campaigns%rowtype; programme app_private.reward_programmes%rowtype;
  prior app_private.reward_record_source_snapshots%rowtype; target app_private.reward_source_snapshots%rowtype;
  approved app_private.reward_record_approvals%rowtype; target_race jsonb; source_row jsonb;
begin
  select * into campaign from app_private.reward_campaigns where id = p_campaign_id;
  perform app_private.require_reward_operator(campaign.programme_id, p_actor_user_id);
  select * into programme from app_private.reward_programmes where id = campaign.programme_id for update;
  perform app_private.require_reward_operator(programme.id, p_actor_user_id);
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 or jsonb_typeof(p_request) is distinct from 'object'
    or octet_length(p_request::text) > 16384 or p_request->'schemaVersion' is distinct from '1'::jsonb then
    raise exception using errcode = '22023', message = 'invalid_reward_record_approval';
  end if;
  select * into approved from app_private.reward_record_approvals where campaign_id = p_campaign_id
    and approved_by_user_id = p_actor_user_id and idempotency_key = p_idempotency_key;
  if found then
    if approved.prior_snapshot_id is distinct from p_prior_snapshot_id or approved.request_body is distinct from p_request then
      raise exception using errcode = '22023', message = 'reward_ledger_idempotency_conflict';
    end if;
  else
    if exists (select 1 from app_private.reward_allocations where campaign_id = p_campaign_id) then
      raise exception using errcode = '55000', message = 'reward_campaign_allocation_already_reserved';
    end if;
    select * into prior from app_private.reward_record_source_snapshots where id = p_prior_snapshot_id and campaign_id = p_campaign_id;
    select * into target from app_private.reward_source_snapshots where id = prior.target_snapshot_id;
    if campaign.pot <> 'race' or prior.id is null or target.id is null or target.organization_id <> programme.organization_id
      or target.league_season_id <> programme.league_season_id or target.round_ids <> campaign.round_ids then
      raise exception using errcode = '22023', message = 'reward_record_source_scope_mismatch';
    end if;
    select r into target_race from jsonb_array_elements(programme.configuration->'rounds') round,
      jsonb_array_elements(round->'races') r where round->>'id' = campaign.scope_key and r->>'id' = p_request->>'targetRaceId';
    select r into source_row from jsonb_array_elements(prior.source_body->'rows') r where r->>'id' = p_request->>'baselineSourceId';
    if target_race is null or source_row is null or p_request->>'gender' not in ('M','F') or p_request->>'gender' is null
      or p_request#>>'{comparison,courseEquivalent}' is distinct from 'true'
      or p_request#>>'{comparison,historyReviewed}' is distinct from 'true' or p_request#>>'{comparison,exceptionsReviewed}' is distinct from 'true'
      or p_request#>>'{baseline,publicationId}' is distinct from prior.source_body#>>'{publication,id}'
      or jsonb_typeof(p_request#>'{baseline,finishTimeMs}') is distinct from 'string'
      or p_request#>>'{baseline,finishTimeMs}' is distinct from source_row->>'finishTimeMs'
      or p_request#>>'{baseline,courseComparisonKey}' is distinct from ('course:' || (target_race->>'trackVersionId') || ':' || (target_race->>'courseFormat')
        || ':' || (target_race->>'lapCount') || ':' || (target_race->>'distanceMetres')) then
      raise exception using errcode = '22023', message = 'invalid_reward_record_approval';
    end if;
    if public.service_read_reward_source(programme.organization_id, programme.league_season_id, campaign.round_ids, p_actor_user_id)
      is distinct from target.source_body then raise exception using errcode = '55000', message = 'reward_review_source_changed'; end if;
    if public.service_read_reward_record_source(p_campaign_id, p_actor_user_id, prior.prior_race_id) is distinct from prior.source_body then
      raise exception using errcode = '55000', message = 'reward_record_source_changed';
    end if;
    insert into app_private.reward_record_approvals(campaign_id, target_snapshot_id, prior_snapshot_id, target_race_id, gender, revision,
      approved_by_user_id, idempotency_key, request_body)
    select p_campaign_id, target.id, prior.id, (p_request->>'targetRaceId')::uuid, p_request->>'gender', coalesce(max(revision),0)+1,
      p_actor_user_id, p_idempotency_key, p_request from app_private.reward_record_approvals
      where campaign_id = p_campaign_id and target_race_id = (p_request->>'targetRaceId')::uuid and gender = p_request->>'gender'
    returning * into approved;
  end if;
  return public.service_read_reward_record_approval(p_campaign_id, p_actor_user_id, approved.id);
end $$;

create function public.service_withdraw_reward_record(p_campaign_id uuid, p_actor_user_id uuid,
  p_approval_id uuid, p_idempotency_key text, p_reason text)
returns jsonb language plpgsql security invoker set search_path = '' set timezone = 'UTC' as $$
declare campaign app_private.reward_campaigns%rowtype; withdrawn app_private.reward_record_withdrawals%rowtype;
begin
  select * into campaign from app_private.reward_campaigns where id = p_campaign_id;
  perform app_private.require_reward_operator(campaign.programme_id, p_actor_user_id);
  perform 1 from app_private.reward_programmes where id = campaign.programme_id for update;
  perform app_private.require_reward_operator(campaign.programme_id, p_actor_user_id);
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 or p_reason is null or length(btrim(p_reason)) not between 8 and 4000 then
    raise exception using errcode = '22023', message = 'invalid_reward_record_withdrawal';
  end if;
  if not exists (select 1 from app_private.reward_record_approvals where id = p_approval_id and campaign_id = p_campaign_id) then
    raise exception using errcode = '22023', message = 'reward_record_approval_required';
  end if;
  select * into withdrawn from app_private.reward_record_withdrawals where campaign_id = p_campaign_id
    and withdrawn_by_user_id = p_actor_user_id and idempotency_key = p_idempotency_key;
  if found then
    if withdrawn.approval_id <> p_approval_id or withdrawn.reason <> btrim(p_reason) then
      raise exception using errcode = '22023', message = 'reward_ledger_idempotency_conflict';
    end if;
  else
    if exists (select 1 from app_private.reward_record_withdrawals where approval_id = p_approval_id) then
      raise exception using errcode = '55000', message = 'reward_record_approval_already_withdrawn';
    end if;
    insert into app_private.reward_record_withdrawals(approval_id, campaign_id, withdrawn_by_user_id, reason, idempotency_key)
      values(p_approval_id,p_campaign_id,p_actor_user_id,btrim(p_reason),p_idempotency_key) returning * into withdrawn;
  end if;
  return jsonb_build_object('withdrawalId', withdrawn.id, 'approvalId', withdrawn.approval_id, 'campaignId', withdrawn.campaign_id,
    'withdrawnByUserId', withdrawn.withdrawn_by_user_id, 'withdrawnAt', withdrawn.withdrawn_at, 'reason', withdrawn.reason);
end $$;

-- Caller must hold the programme row lock. New approval/withdrawal and new
-- review/reservation therefore have one order; withdrawal never erases history.
create function app_private.assert_reward_record_review_current(p_campaign_id uuid, p_snapshot_id uuid, p_actor_user_id uuid, p_review jsonb)
returns void language plpgsql stable security invoker set search_path = '' as $$
declare approved app_private.reward_record_approvals%rowtype; prior app_private.reward_record_source_snapshots%rowtype;
  record_body jsonb; baselines jsonb;
begin
  select coalesce(jsonb_agg(r), '[]'::jsonb) into baselines from jsonb_array_elements(coalesce(p_review->'roundReviews','[]'::jsonb)) round,
    jsonb_array_elements(coalesce(round->'records','[]'::jsonb)) r;
  for record_body in select r from jsonb_array_elements(baselines) r where r->'baseline' is distinct from 'null'::jsonb loop
    select * into approved from app_private.reward_record_approvals where id::text = record_body#>>'{baseline,approvalId}';
    if approved.id is null or approved.campaign_id <> p_campaign_id or approved.target_snapshot_id <> p_snapshot_id
      or approved.target_race_id::text is distinct from record_body->>'raceId' or approved.gender is distinct from record_body->>'gender'
      or ((record_body->'baseline') - 'approvalId') is distinct from approved.request_body->'baseline' then
      raise exception using errcode = '22023', message = 'reward_record_approval_mismatch';
    end if;
    if exists (select 1 from app_private.reward_record_withdrawals where approval_id = approved.id) then
      raise exception using errcode = '55000', message = 'reward_record_approval_withdrawn';
    end if;
    if exists (select 1 from app_private.reward_record_approvals where campaign_id = p_campaign_id
      and target_race_id = approved.target_race_id and gender = approved.gender and revision > approved.revision) then
      raise exception using errcode = '55000', message = 'reward_record_approval_superseded';
    end if;
    select * into prior from app_private.reward_record_source_snapshots where id = approved.prior_snapshot_id;
    if public.service_read_reward_record_source(p_campaign_id, p_actor_user_id, prior.prior_race_id) is distinct from prior.source_body then
      raise exception using errcode = '55000', message = 'reward_record_source_changed';
    end if;
  end loop;
  -- An existing current approval cannot be hidden by omitting the division or
  -- changing its baseline to null. Withdraw it explicitly or review its successor.
  for approved in select distinct on (target_race_id, gender) * from app_private.reward_record_approvals
    where campaign_id = p_campaign_id order by target_race_id, gender, revision desc loop
    if not exists (select 1 from app_private.reward_record_withdrawals where approval_id = approved.id)
      and not exists (select 1 from jsonb_array_elements(baselines) r where r#>>'{baseline,approvalId}' = approved.id::text) then
      raise exception using errcode = '55000', message = 'reward_record_approval_omitted';
    end if;
  end loop;
end $$;

-- New-row triggers cover the actual insertion inside the existing atomic RPCs.
-- Exact idempotent replays never insert, and so keep their immutable old result.
create function app_private.guard_reward_record_review_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare campaign app_private.reward_campaigns%rowtype; reviewed app_private.reward_sporting_reviews%rowtype; actor uuid;
begin
  select * into campaign from app_private.reward_campaigns where id = new.campaign_id;
  if tg_table_name = 'reward_sporting_reviews' then actor := new.reviewed_by_user_id; else actor := new.reserved_by_user_id; end if;
  perform 1 from app_private.reward_programmes where id = campaign.programme_id for update;
  perform app_private.require_reward_operator(campaign.programme_id, actor);
  if tg_table_name = 'reward_sporting_reviews' then
    perform app_private.assert_reward_record_review_current(new.campaign_id, new.source_snapshot_id, actor, new.review_body);
  else
    select * into reviewed from app_private.reward_sporting_reviews where id = new.review_id and campaign_id = new.campaign_id;
    perform app_private.assert_reward_record_review_current(new.campaign_id, reviewed.source_snapshot_id, actor, reviewed.review_body);
  end if;
  return new;
end $$;
create trigger reward_record_review_insert before insert on app_private.reward_sporting_reviews
  for each row execute function app_private.guard_reward_record_review_insert();
create trigger reward_record_allocation_insert before insert on app_private.reward_allocations
  for each row execute function app_private.guard_reward_record_review_insert();

revoke all on function app_private.assert_reward_record_review_current(uuid,uuid,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function app_private.guard_reward_record_review_insert() from public, anon, authenticated, service_role;
grant execute on function app_private.assert_reward_record_review_current(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.service_read_reward_record_snapshot(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.service_read_reward_record_approval(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.service_approve_reward_record(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.service_withdraw_reward_record(uuid,uuid,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.service_read_reward_record_snapshot(uuid,uuid,uuid) to service_role;
grant execute on function public.service_read_reward_record_approval(uuid,uuid,uuid) to service_role;
grant execute on function public.service_approve_reward_record(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.service_withdraw_reward_record(uuid,uuid,uuid,text,text) to service_role;

commit;
