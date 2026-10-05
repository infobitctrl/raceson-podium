begin;

-- Independently captured prior-race evidence. This is NOT a record approval,
-- an entitlement or an assertion that every historical course record is known.
create table app_private.reward_record_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app_private.reward_campaigns(id),
  target_snapshot_id uuid not null references app_private.reward_source_snapshots(id),
  prior_race_id uuid not null,
  captured_by_user_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  captured_at timestamptz not null default clock_timestamp(),
  source_body jsonb not null check (jsonb_typeof(source_body) = 'object' and octet_length(source_body::text) <= 8388608),
  source_fingerprint_sha256 text not null check
    (source_fingerprint_sha256 = encode(sha256(convert_to(source_body::text, 'UTF8')), 'hex')),
  unique (campaign_id, captured_by_user_id, idempotency_key)
);
alter table app_private.reward_record_source_snapshots enable row level security;
revoke all on app_private.reward_record_source_snapshots from public, anon, authenticated, service_role;
grant select, insert on app_private.reward_record_source_snapshots to service_role;
create policy reward_record_source_service_select on app_private.reward_record_source_snapshots for select to service_role using (true);
create policy reward_record_source_service_insert on app_private.reward_record_source_snapshots for insert to service_role with check (true);
create trigger reward_record_source_immutable before update or delete on app_private.reward_record_source_snapshots
  for each row execute function app_private.reject_reward_source_snapshot_mutation();

-- Read any prior race of THIS programme's organization, including older seasons
-- outside the five reward rounds. No account, wallet, exact age or club data.
-- The explicit operator boundary is additional to the service-only RPC grant.
create function public.service_read_reward_record_source(p_campaign_id uuid, p_actor_user_id uuid, p_prior_race_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' set timezone = 'UTC' as $$
declare
  campaign app_private.reward_campaigns%rowtype;
  programme app_private.reward_programmes%rowtype;
  body jsonb;
begin
  select * into campaign from app_private.reward_campaigns where id = p_campaign_id;
  perform app_private.require_reward_operator(campaign.programme_id, p_actor_user_id);
  select * into programme from app_private.reward_programmes where id = campaign.programme_id;
  if campaign.pot <> 'race' or p_prior_race_id is null or not exists (
    select 1 from public.event_categories c join public.event_editions e on e.id = c.event_edition_id
      join public.event_series s on s.id = e.event_series_id
    where c.id = p_prior_race_id and s.organization_id = programme.organization_id
  ) then
    raise exception using errcode = '22023', message = 'reward_record_source_scope_mismatch';
  end if;
  with recursive latest as (
    select p.* from public.result_publications p where p.event_category_id = p_prior_race_id
      and p.publication_state in ('official', 'corrected')
    order by p.published_at desc, p.created_at desc, p.id desc limit 1
  ), selected_rows as (
    select r.* from public.result_rows r join latest p on p.result_run_id = r.result_run_id order by r.id limit 20001
  ), identities as (
    select distinct r.athlete_profile_id source_id, a.id, a.merged_into_athlete_profile_id next_id,
      array[a.id] path, false cycle, 0 depth from selected_rows r join public.athlete_profiles a on a.id = r.athlete_profile_id
    union all
    select i.source_id, a.id, a.merged_into_athlete_profile_id, i.path || a.id, a.id = any(i.path), i.depth + 1
    from identities i join public.athlete_profiles a on a.id = i.next_id where not i.cycle and i.depth < 16
  ), canonical as (select distinct on (source_id) * from identities order by source_id, depth desc)
  select jsonb_build_object('schemaVersion', 1, 'organizationId', programme.organization_id,
    'race', jsonb_build_object('id', c.id, 'eventEditionId', e.id, 'status', c.status, 'eventStatus', e.status,
      'isPractice', e.is_practice, 'organizerDeletedAt', c.organizer_deleted_at, 'editionDeletedAt', e.organizer_deleted_at,
      'resultsMode', c.results_mode, 'startAt', c.start_at, 'distanceMetres', (c.distance_km * 1000)::text,
      'courseFormat', c.course_format, 'lapCount', c.lap_count),
    'track', jsonb_build_object('snapshotId', t.id, 'templateId', t.track_template_id, 'versionId', t.track_version_id,
      'distanceMetres', (t.distance_km * 1000)::text),
    'latestPublicationId', p.id,
    'publication', jsonb_build_object('id', p.id, 'raceId', p.event_category_id, 'runId', p.result_run_id,
      'state', p.publication_state, 'publishedAt', p.published_at, 'createdAt', p.created_at,
      'supersedesId', p.supersedes_publication_id, 'manifestDigest', p.manifest_digest_sha256,
      'signatureState', p.signature_state, 'signedDigest', p.signed_digest_sha256),
    'run', jsonb_build_object('id', run.id, 'raceId', run.event_category_id, 'status', run.status, 'completedAt', run.completed_at),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'raceId', r.event_category_id,
      'publicationId', p.id, 'resultRunId', r.result_run_id, 'registrationId', r.registration_id,
      'sourceAthleteId', r.athlete_profile_id, 'canonicalAthleteId', i.id, 'identityPath', i.path,
      'identityCycle', i.cycle, 'unresolvedMergeId', i.next_id, 'gender', a.gender,
      'registrationAthleteId', reg.athlete_profile_id, 'registrationRaceId', reg.event_category_id,
      'participationStatus', reg.participation_status, 'resultStatus', r.result_status, 'finishTimeMs', r.finish_time_ms::text) order by r.id)
      from selected_rows r left join canonical i on i.source_id = r.athlete_profile_id
      left join public.athlete_profiles a on a.id = i.id left join public.registrations reg on reg.id = r.registration_id), '[]'::jsonb),
    'adjudicationCases', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'raceId', a.event_category_id,
      'state', a.case_state, 'recomputeRequired', a.recompute_required, 'outcome', a.decision_outcome,
      'decidedAt', a.decided_at, 'closedAt', a.closed_at) order by a.id)
      from (select * from public.result_adjudication_cases where event_category_id = c.id order by id limit 20001) a), '[]'::jsonb)) into body
  from public.event_categories c join public.event_editions e on e.id = c.event_edition_id
    left join public.event_category_track_snapshots t on t.event_category_id = c.id
    left join latest p on true left join public.result_runs run on run.id = p.result_run_id where c.id = p_prior_race_id;
  if body is null or body->'race'->>'status' is distinct from 'completed' or body->'race'->>'eventStatus' is distinct from 'completed'
    or body->'race'->>'isPractice' is distinct from 'false' or body->'race'->>'organizerDeletedAt' is not null
    or body->'race'->>'editionDeletedAt' is not null or body->'race'->>'resultsMode' is distinct from 'standard'
    or body->'publication'->>'id' is null or body->'run'->>'status' is distinct from 'succeeded'
    or body->'run'->>'raceId' is distinct from p_prior_race_id::text then
    raise exception using errcode = '55000', message = 'reward_record_source_not_ready';
  end if;
  if jsonb_array_length(body->'rows') > 20000 or jsonb_array_length(body->'adjudicationCases') > 20000
    or octet_length(body::text) > 8388608 then
    raise exception using errcode = '54000', message = 'reward_source_too_large';
  end if;
  return body;
end
$$;

create function public.service_capture_reward_record_source(
  p_campaign_id uuid, p_source_snapshot_id uuid, p_actor_user_id uuid, p_prior_race_id uuid, p_idempotency_key text
)
returns jsonb language plpgsql security invoker set search_path = '' set timezone = 'UTC' as $$
declare
  campaign app_private.reward_campaigns%rowtype;
  programme app_private.reward_programmes%rowtype;
  target app_private.reward_source_snapshots%rowtype;
  captured app_private.reward_record_source_snapshots%rowtype;
  body jsonb;
begin
  select * into campaign from app_private.reward_campaigns where id = p_campaign_id;
  perform app_private.require_reward_operator(campaign.programme_id, p_actor_user_id);
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 or p_prior_race_id is null then
    raise exception using errcode = '22023', message = 'invalid_reward_record_capture';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-record:' || p_campaign_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key, 0));
  perform app_private.require_reward_operator(campaign.programme_id, p_actor_user_id);
  select * into programme from app_private.reward_programmes where id = campaign.programme_id;
  select * into target from app_private.reward_source_snapshots where id = p_source_snapshot_id;
  if campaign.pot <> 'race' or target.id is null or target.organization_id <> programme.organization_id
    or target.league_season_id <> programme.league_season_id or target.round_ids <> campaign.round_ids
    or exists (select 1 from jsonb_array_elements(target.source_body->'mappings') m where m->>'raceId' = p_prior_race_id::text) then
    raise exception using errcode = '22023', message = 'reward_record_source_scope_mismatch';
  end if;
  select * into captured from app_private.reward_record_source_snapshots where campaign_id = p_campaign_id
    and captured_by_user_id = p_actor_user_id and idempotency_key = p_idempotency_key;
  if found then
    if captured.target_snapshot_id <> p_source_snapshot_id or captured.prior_race_id <> p_prior_race_id then
      raise exception using errcode = '22023', message = 'reward_record_capture_idempotency_conflict';
    end if;
  else
    body := public.service_read_reward_record_source(p_campaign_id, p_actor_user_id, p_prior_race_id);
    insert into app_private.reward_record_source_snapshots(campaign_id, target_snapshot_id, prior_race_id, captured_by_user_id,
      idempotency_key, source_body, source_fingerprint_sha256)
    values (p_campaign_id, p_source_snapshot_id, p_prior_race_id, p_actor_user_id, p_idempotency_key, body,
      encode(sha256(convert_to(body::text, 'UTF8')), 'hex')) returning * into captured;
  end if;
  return jsonb_build_object('snapshotId', captured.id, 'campaignId', captured.campaign_id,
    'targetSnapshotId', captured.target_snapshot_id, 'priorRaceId', captured.prior_race_id,
    'capturedAt', captured.captured_at, 'sourceFingerprintSha256', captured.source_fingerprint_sha256, 'source', captured.source_body);
end
$$;
revoke all on function public.service_read_reward_record_source(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.service_capture_reward_record_source(uuid,uuid,uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.service_read_reward_record_source(uuid,uuid,uuid) to service_role;
grant execute on function public.service_capture_reward_record_source(uuid,uuid,uuid,uuid,text) to service_role;
comment on table app_private.reward_record_source_snapshots is 'Private prior sporting evidence. Capture and local candidate verification do not approve a baseline or authorize a prize.';

commit;
