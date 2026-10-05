begin;

-- A mapped race must point at an immutable publication selection. Without this
-- layer, standings can silently change inputs merely because a newer result
-- publication exists.
create table public.league_round_mapping_source_versions (
  id uuid primary key default gen_random_uuid(),
  league_round_race_mapping_id uuid not null
    references public.league_round_race_mappings (id) on delete restrict,
  version_number integer not null check (version_number > 0),
  result_publication_id uuid not null
    references public.result_publications (id) on delete restrict,
  publication_state public.publication_state not null
    check (publication_state in ('official', 'corrected')),
  publication_digest_sha256 text not null
    check (publication_digest_sha256 ~ '^[0-9a-f]{64}$'),
  source_digest_sha256 text not null
    check (source_digest_sha256 ~ '^[0-9a-f]{64}$'),
  change_note text not null check (nullif(trim(change_note), '') is not null),
  selected_by_user_id uuid,
  causation_domain_event_id uuid
    references public.domain_events (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (league_round_race_mapping_id, version_number),
  unique (league_round_race_mapping_id, result_publication_id)
);

alter table public.league_round_race_mappings
  add column current_source_version_id uuid
    references public.league_round_mapping_source_versions (id) on delete restrict,
  add column current_result_publication_id uuid
    references public.result_publications (id) on delete restrict;

create index league_round_mapping_sources_publication_idx
  on public.league_round_mapping_source_versions (result_publication_id);
create index league_round_mapping_sources_mapping_idx
  on public.league_round_mapping_source_versions
  (league_round_race_mapping_id, version_number desc);
create index league_round_race_mappings_current_source_idx
  on public.league_round_race_mappings (current_source_version_id)
  where current_source_version_id is not null;

create or replace function public.protect_league_mapping_source_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'league_mapping_source_version_is_immutable';
end;
$$;

create trigger league_round_mapping_source_versions_immutable
before update or delete on public.league_round_mapping_source_versions
for each row execute function public.protect_league_mapping_source_version();

-- Repair historical mappings once, selecting the latest eligible publication.
-- Subsequent changes can only be made through a new immutable source version.
with selected_publications as (
  select
    mapping.id as mapping_id,
    publication.id as publication_id,
    publication.publication_state,
    publication.published_by_user_id,
    coalesce(
      publication.manifest_digest_sha256,
      encode(
        public.digest(
          convert_to(
            jsonb_build_object(
              'publicationId', publication.id,
              'resultRunId', publication.result_run_id,
              'publicationState', publication.publication_state,
              'publishedAt', publication.published_at
            )::text,
            'utf8'
          ),
          'sha256'
        ),
        'hex'
      )
    ) as publication_digest
  from public.league_round_race_mappings mapping
  join lateral (
    select candidate.*
    from public.result_publications candidate
    where candidate.event_category_id = mapping.event_category_id
      and candidate.publication_state in ('official', 'corrected')
    order by candidate.published_at desc, candidate.created_at desc, candidate.id desc
    limit 1
  ) publication on true
), inserted_sources as (
  insert into public.league_round_mapping_source_versions (
    league_round_race_mapping_id,
    version_number,
    result_publication_id,
    publication_state,
    publication_digest_sha256,
    source_digest_sha256,
    change_note,
    selected_by_user_id
  )
  select
    selected.mapping_id,
    1,
    selected.publication_id,
    selected.publication_state,
    selected.publication_digest,
    encode(
      public.digest(
        convert_to(
          jsonb_build_object(
            'leagueRoundRaceMappingId', selected.mapping_id,
            'versionNumber', 1,
            'resultPublicationId', selected.publication_id,
            'publicationDigestSha256', selected.publication_digest
          )::text,
          'utf8'
        ),
        'sha256'
      ),
      'hex'
    ),
    'Migration backfill from the latest eligible result publication.',
    selected.published_by_user_id
  from selected_publications selected
  on conflict (league_round_race_mapping_id, result_publication_id) do nothing
  returning id, league_round_race_mapping_id, result_publication_id
)
update public.league_round_race_mappings mapping
set
  current_source_version_id = source.id,
  current_result_publication_id = source.result_publication_id,
  updated_at = clock_timestamp()
from public.league_round_mapping_source_versions source
where source.league_round_race_mapping_id = mapping.id
  and source.version_number = (
    select max(candidate.version_number)
    from public.league_round_mapping_source_versions candidate
    where candidate.league_round_race_mapping_id = mapping.id
  );

-- Keep the compatibility round model usable while individual standings still
-- read it. Prefer an existing source; otherwise backfill from the latest result.
update public.league_rounds round
set
  current_source_version_id = source.id,
  current_result_publication_id = source.result_publication_id,
  status = 'completed',
  updated_at = clock_timestamp()
from public.league_round_source_versions source
where round.current_source_version_id is null
  and source.league_round_id = round.id
  and source.version_number = (
    select max(candidate.version_number)
    from public.league_round_source_versions candidate
    where candidate.league_round_id = round.id
  );

with selected_publications as (
  select
    round.id as league_round_id,
    publication.id as publication_id,
    publication.publication_state,
    publication.published_by_user_id,
    coalesce(
      publication.manifest_digest_sha256,
      encode(
        public.digest(
          convert_to(
            jsonb_build_object(
              'publicationId', publication.id,
              'resultRunId', publication.result_run_id,
              'publicationState', publication.publication_state,
              'publishedAt', publication.published_at
            )::text,
            'utf8'
          ),
          'sha256'
        ),
        'hex'
      )
    ) as publication_digest
  from public.league_rounds round
  join lateral (
    select candidate.*
    from public.result_publications candidate
    where candidate.event_category_id = round.event_category_id
      and candidate.publication_state in ('official', 'corrected')
    order by candidate.published_at desc, candidate.created_at desc, candidate.id desc
    limit 1
  ) publication on true
  where round.current_source_version_id is null
    and publication.published_by_user_id is not null
), inserted_sources as (
  insert into public.league_round_source_versions (
    league_round_id,
    version_number,
    result_publication_id,
    publication_state,
    publication_digest_sha256,
    source_digest_sha256,
    change_note,
    selected_by_user_id,
    client_event_id
  )
  select
    selected.league_round_id,
    coalesce((
      select max(candidate.version_number)
      from public.league_round_source_versions candidate
      where candidate.league_round_id = selected.league_round_id
    ), 0) + 1,
    selected.publication_id,
    selected.publication_state,
    selected.publication_digest,
    encode(
      public.digest(
        convert_to(
          jsonb_build_object(
            'leagueRoundId', selected.league_round_id,
            'resultPublicationId', selected.publication_id,
            'publicationDigestSha256', selected.publication_digest
          )::text,
          'utf8'
        ),
        'sha256'
      ),
      'hex'
    ),
    'Migration backfill from the latest eligible result publication.',
    selected.published_by_user_id,
    gen_random_uuid()
  from selected_publications selected
  on conflict (league_round_id, result_publication_id) do nothing
  returning id, league_round_id, result_publication_id
)
update public.league_rounds round
set
  current_source_version_id = source.id,
  current_result_publication_id = source.result_publication_id,
  status = 'completed',
  updated_at = clock_timestamp()
from public.league_round_source_versions source
where round.current_source_version_id is null
  and source.league_round_id = round.id
  and source.version_number = (
    select max(candidate.version_number)
    from public.league_round_source_versions candidate
    where candidate.league_round_id = round.id
  );

update public.league_round_events round_event
set status = 'completed', updated_at = clock_timestamp()
where round_event.status <> 'cancelled'
  and exists (
    select 1
    from public.league_round_race_mappings mapping
    where mapping.league_round_event_id = round_event.id
      and mapping.status = 'mapped'
  )
  and not exists (
    select 1
    from public.league_round_race_mappings mapping
    where mapping.league_round_event_id = round_event.id
      and mapping.status = 'mapped'
      and mapping.current_source_version_id is null
  );

create or replace function public.service_publish_result_run_with_workflows(
  p_event_category_id uuid,
  p_result_run_id uuid,
  p_publication_state public.publication_state,
  p_published_by_user_id uuid,
  p_change_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  edition_is_practice boolean;
  resolved_organization_id uuid;
  existing_event public.domain_events%rowtype;
  command_event public.domain_events%rowtype;
  publication_id uuid;
  league_job public.workflow_jobs%rowtype;
begin
  if p_event_category_id is null
     or p_result_run_id is null
     or p_publication_state is null
     or p_published_by_user_id is null
     or p_client_event_id is null then
    raise exception using errcode = '22023', message = 'result_publication_input_invalid';
  end if;

  perform 1
  from public.event_categories category
  where category.id = p_event_category_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;

  select event.*
  into existing_event
  from public.domain_events event
  where event.event_type = 'result.publication.committed'
    and event.idempotency_key = p_client_event_id::text;
  if found then
    if existing_event.aggregate_type <> 'result_publication'
       or existing_event.payload_json ->> 'eventCategoryId' <> p_event_category_id::text
       or existing_event.payload_json ->> 'resultRunId' <> p_result_run_id::text
       or existing_event.payload_json ->> 'publicationState' <> p_publication_state::text then
      raise exception using errcode = '22023', message = 'result_publication_idempotency_conflict';
    end if;

    select job.*
    into league_job
    from public.workflow_jobs job
    where job.domain_event_id = existing_event.id
      and job.handler_key = 'league.publication.propagate'
      and job.handler_version = 1;

    return jsonb_build_object(
      'publicationId', existing_event.aggregate_id,
      'domainEventId', existing_event.id,
      'leagueJobId', league_job.id,
      'leagueJobState', league_job.state,
      'leagueJobResult', coalesce(league_job.result_json, '{}'::jsonb),
      'replayed', true
    );
  end if;

  select edition.is_practice, series.organization_id
  into edition_is_practice, resolved_organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = p_event_category_id;

  if edition_is_practice then
    publication_id := public.publish_result_run_atomically(
      p_event_category_id,
      p_result_run_id,
      p_publication_state,
      p_published_by_user_id,
      p_change_note
    );
  else
    publication_id := public.service_publish_result_run_guarded(
      p_event_category_id,
      p_result_run_id,
      p_publication_state,
      p_published_by_user_id,
      p_change_note
    );
  end if;

  insert into public.domain_events (
    organization_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload_json,
    actor_user_id,
    correlation_id,
    idempotency_key
  )
  values (
    resolved_organization_id,
    'result.publication.committed',
    'result_publication',
    publication_id,
    jsonb_build_object(
      'publicationId', publication_id,
      'eventCategoryId', p_event_category_id,
      'resultRunId', p_result_run_id,
      'publicationState', p_publication_state,
      'changeNote', nullif(trim(coalesce(p_change_note, '')), '')
    ),
    p_published_by_user_id,
    p_client_event_id,
    p_client_event_id::text
  )
  returning * into command_event;

  if p_publication_state in ('official', 'corrected') then
    insert into public.workflow_jobs (
      domain_event_id,
      organization_id,
      handler_key,
      handler_version,
      priority,
      result_json
    )
    values (
      command_event.id,
      resolved_organization_id,
      'league.publication.propagate',
      1,
      20,
      jsonb_build_object('eventCategoryId', p_event_category_id)
    )
    returning * into league_job;
  end if;

  return jsonb_build_object(
    'publicationId', publication_id,
    'domainEventId', command_event.id,
    'leagueJobId', league_job.id,
    'leagueJobState', league_job.state,
    'leagueJobResult', coalesce(league_job.result_json, '{}'::jsonb),
    'replayed', false
  );
end;
$$;

create or replace function public.service_process_result_publication_leagues(
  p_workflow_job_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.workflow_jobs%rowtype;
  publication_event public.domain_events%rowtype;
  publication_row public.result_publications%rowtype;
  mapping_row record;
  legacy_round record;
  source_row public.league_round_mapping_source_versions%rowtype;
  legacy_source public.league_round_source_versions%rowtype;
  publication_digest text;
  source_digest text;
  next_version integer;
  affected_season_ids uuid[] := '{}'::uuid[];
  season_id uuid;
  source_count integer := 0;
  standings_jobs jsonb := '[]'::jsonb;
  result_payload jsonb;
begin
  if p_workflow_job_id is null or p_actor_user_id is null then
    raise exception using errcode = '22023', message = 'league_publication_workflow_input_invalid';
  end if;

  select job.*
  into job_row
  from public.workflow_jobs job
  where job.id = p_workflow_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workflow_job_not_found';
  end if;
  if job_row.handler_key <> 'league.publication.propagate' then
    raise exception using errcode = 'P0001', message = 'workflow_job_handler_mismatch';
  end if;
  if job_row.state = 'succeeded' then
    return jsonb_build_object(
      'jobId', job_row.id,
      'state', job_row.state,
      'result', job_row.result_json,
      'replayed', true
    );
  end if;
  if job_row.state in ('dead_letter', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'workflow_job_not_processable';
  end if;

  select event.*
  into publication_event
  from public.domain_events event
  where event.id = job_row.domain_event_id;
  if publication_event.event_type <> 'result.publication.committed'
     or publication_event.aggregate_type <> 'result_publication' then
    raise exception using errcode = 'P0001', message = 'result_publication_event_required';
  end if;

  select publication.*
  into publication_row
  from public.result_publications publication
  where publication.id = publication_event.aggregate_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'result_publication_not_found';
  end if;
  if publication_row.publication_state not in ('official', 'corrected') then
    raise exception using errcode = '22023', message = 'league_publication_state_invalid';
  end if;

  update public.workflow_jobs job
  set state = 'running', locked_at = clock_timestamp(), lease_owner = p_actor_user_id
  where job.id = job_row.id;

  publication_digest := coalesce(
    publication_row.manifest_digest_sha256,
    encode(
      public.digest(
        convert_to(
          jsonb_build_object(
            'publicationId', publication_row.id,
            'resultRunId', publication_row.result_run_id,
            'publicationState', publication_row.publication_state,
            'publishedAt', publication_row.published_at
          )::text,
          'utf8'
        ),
        'sha256'
      ),
      'hex'
    )
  );

  for mapping_row in
    select
      mapping.*,
      round_event.league_season_id,
      round_event.id as round_event_id,
      league.organization_id as league_organization_id
    from public.league_round_race_mappings mapping
    join public.league_round_events round_event
      on round_event.id = mapping.league_round_event_id
    join public.league_seasons season on season.id = round_event.league_season_id
    join public.leagues league on league.id = season.league_id
    where mapping.event_category_id = publication_row.event_category_id
      and mapping.status = 'mapped'
    order by round_event.league_season_id, mapping.id
    for update of mapping
  loop
    if mapping_row.league_organization_id is distinct from job_row.organization_id then
      raise exception using errcode = '42501', message = 'league_publication_organization_mismatch';
    end if;

    select source.*
    into source_row
    from public.league_round_mapping_source_versions source
    where source.league_round_race_mapping_id = mapping_row.id
      and source.result_publication_id = publication_row.id;

    if not found then
      select coalesce(max(source.version_number), 0) + 1
      into next_version
      from public.league_round_mapping_source_versions source
      where source.league_round_race_mapping_id = mapping_row.id;

      source_digest := encode(
        public.digest(
          convert_to(
            jsonb_build_object(
              'leagueRoundRaceMappingId', mapping_row.id,
              'versionNumber', next_version,
              'resultPublicationId', publication_row.id,
              'publicationDigestSha256', publication_digest
            )::text,
            'utf8'
          ),
          'sha256'
        ),
        'hex'
      );

      insert into public.league_round_mapping_source_versions (
        league_round_race_mapping_id,
        version_number,
        result_publication_id,
        publication_state,
        publication_digest_sha256,
        source_digest_sha256,
        change_note,
        selected_by_user_id,
        causation_domain_event_id
      )
      values (
        mapping_row.id,
        next_version,
        publication_row.id,
        publication_row.publication_state,
        publication_digest,
        coalesce(source_digest, repeat('0', 64)),
        coalesce(
          nullif(trim(coalesce(publication_row.change_note, '')), ''),
          'Automatically selected from an official result publication.'
        ),
        p_actor_user_id,
        publication_event.id
      )
      returning * into source_row;
      source_count := source_count + 1;
    end if;

    update public.league_round_race_mappings mapping
    set
      current_source_version_id = source_row.id,
      current_result_publication_id = publication_row.id,
      updated_at = clock_timestamp()
    where mapping.id = mapping_row.id;

    update public.league_round_events round_event
    set
      status = case
        when round_event.status = 'cancelled' then round_event.status
        when not exists (
          select 1
          from public.league_round_race_mappings sibling
          where sibling.league_round_event_id = round_event.id
            and sibling.status = 'mapped'
            and sibling.current_source_version_id is null
        ) then 'completed'
        else round_event.status
      end,
      updated_at = clock_timestamp()
    where round_event.id = mapping_row.round_event_id;

    insert into public.domain_events (
      organization_id,
      event_type,
      aggregate_type,
      aggregate_id,
      payload_json,
      actor_user_id,
      correlation_id,
      causation_event_id,
      idempotency_key
    )
    values (
      job_row.organization_id,
      'league.round.source_changed',
      'league_round_race_mapping',
      mapping_row.id,
      jsonb_build_object(
        'leagueSeasonId', mapping_row.league_season_id,
        'leagueRoundEventId', mapping_row.round_event_id,
        'eventCategoryId', mapping_row.event_category_id,
        'sourceVersionId', source_row.id,
        'sourceVersionNumber', source_row.version_number,
        'resultPublicationId', publication_row.id
      ),
      p_actor_user_id,
      publication_event.correlation_id,
      publication_event.id,
      job_row.id::text || ':' || mapping_row.id::text
    )
    on conflict (event_type, idempotency_key) do nothing;

    if not mapping_row.league_season_id = any(affected_season_ids) then
      affected_season_ids := array_append(affected_season_ids, mapping_row.league_season_id);
    end if;
  end loop;

  -- Synchronize only the matching compatibility round. It remains the source
  -- for individual standings until those rows become competition-scoped.
  for legacy_round in
    select round.*
    from public.league_rounds round
    where round.event_category_id = publication_row.event_category_id
      and round.league_season_id = any(affected_season_ids)
    order by round.id
    for update
  loop
    select source.*
    into legacy_source
    from public.league_round_source_versions source
    where source.league_round_id = legacy_round.id
      and source.result_publication_id = publication_row.id;

    if not found then
      select coalesce(max(source.version_number), 0) + 1
      into next_version
      from public.league_round_source_versions source
      where source.league_round_id = legacy_round.id;

      source_digest := encode(
        public.digest(
          convert_to(
            jsonb_build_object(
              'leagueRoundId', legacy_round.id,
              'versionNumber', next_version,
              'resultPublicationId', publication_row.id,
              'publicationDigestSha256', publication_digest
            )::text,
            'utf8'
          ),
          'sha256'
        ),
        'hex'
      );

      insert into public.league_round_source_versions (
        league_round_id,
        version_number,
        result_publication_id,
        publication_state,
        publication_digest_sha256,
        source_digest_sha256,
        change_note,
        selected_by_user_id,
        client_event_id
      )
      values (
        legacy_round.id,
        next_version,
        publication_row.id,
        publication_row.publication_state,
        publication_digest,
        source_digest,
        coalesce(
          nullif(trim(coalesce(publication_row.change_note, '')), ''),
          'Automatically selected from an official result publication.'
        ),
        p_actor_user_id,
        gen_random_uuid()
      )
      returning * into legacy_source;
    end if;

    update public.league_rounds round
    set
      current_source_version_id = legacy_source.id,
      current_result_publication_id = publication_row.id,
      status = 'completed',
      updated_at = clock_timestamp()
    where round.id = legacy_round.id;
  end loop;

  foreach season_id in array affected_season_ids
  loop
    update public.league_seasons season
    set standings_stale_since = coalesce(season.standings_stale_since, clock_timestamp()),
        updated_at = clock_timestamp()
    where season.id = season_id;

    with created_event as (
      insert into public.domain_events (
        organization_id,
        event_type,
        aggregate_type,
        aggregate_id,
        payload_json,
        actor_user_id,
        correlation_id,
        causation_event_id,
        idempotency_key
      )
      values (
        job_row.organization_id,
        'league.standings.compute.requested',
        'league_season',
        season_id,
        jsonb_build_object(
          'leagueSeasonId', season_id,
          'resultPublicationId', publication_row.id,
          'publicationWorkflowJobId', job_row.id
        ),
        p_actor_user_id,
        publication_event.correlation_id,
        publication_event.id,
        job_row.id::text || ':' || season_id::text
      )
      on conflict (event_type, idempotency_key) do update
        set idempotency_key = excluded.idempotency_key
      returning id
    ), created_job as (
      insert into public.workflow_jobs (
        domain_event_id,
        organization_id,
        handler_key,
        handler_version,
        priority,
        result_json
      )
      select
        event.id,
        job_row.organization_id,
        'league.standings.compute',
        1,
        30,
        jsonb_build_object('leagueSeasonId', season_id)
      from created_event event
      on conflict (domain_event_id, handler_key, handler_version) do update
        set handler_key = excluded.handler_key
      returning id, state
    )
    select standings_jobs || jsonb_build_array(
      jsonb_build_object(
        'jobId', created_job.id,
        'leagueSeasonId', season_id,
        'state', created_job.state
      )
    )
    into standings_jobs
    from created_job;
  end loop;

  result_payload := jsonb_build_object(
    'publicationId', publication_row.id,
    'sourceVersionCount', source_count,
    'affectedSeasonIds', to_jsonb(affected_season_ids),
    'standingsJobs', standings_jobs,
    'leagueState', case when cardinality(affected_season_ids) = 0 then 'not_applicable' else 'pending' end
  );

  update public.workflow_jobs job
  set
    state = 'succeeded',
    attempt_count = greatest(job.attempt_count, 1),
    result_json = result_payload,
    last_error_code = null,
    locked_at = null,
    lease_owner = null,
    completed_at = clock_timestamp()
  where job.id = job_row.id;

  return jsonb_build_object(
    'jobId', job_row.id,
    'state', 'succeeded',
    'result', result_payload,
    'replayed', false
  );
end;
$$;

create or replace function public.service_process_league_standings_job(
  p_workflow_job_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.workflow_jobs%rowtype;
  request_event public.domain_events%rowtype;
  season_row public.league_seasons%rowtype;
  resolved_organization_id uuid;
  standings_result jsonb;
  result_payload jsonb;
  ready boolean := true;
begin
  if p_workflow_job_id is null or p_actor_user_id is null then
    raise exception using errcode = '22023', message = 'league_standings_workflow_input_invalid';
  end if;

  select job.*
  into job_row
  from public.workflow_jobs job
  where job.id = p_workflow_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workflow_job_not_found';
  end if;
  if job_row.handler_key <> 'league.standings.compute' then
    raise exception using errcode = 'P0001', message = 'workflow_job_handler_mismatch';
  end if;
  if job_row.state = 'succeeded' then
    return jsonb_build_object(
      'jobId', job_row.id,
      'state', job_row.state,
      'result', job_row.result_json,
      'replayed', true
    );
  end if;
  if job_row.state in ('dead_letter', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'workflow_job_not_processable';
  end if;

  select event.*
  into request_event
  from public.domain_events event
  where event.id = job_row.domain_event_id;
  if request_event.event_type <> 'league.standings.compute.requested'
     or request_event.aggregate_type <> 'league_season' then
    raise exception using errcode = 'P0001', message = 'league_standings_event_required';
  end if;

  select season.*
  into season_row
  from public.league_seasons season
  where season.id = request_event.aggregate_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'league_season_not_found';
  end if;

  select league.organization_id
  into resolved_organization_id
  from public.leagues league
  where league.id = season_row.league_id;
  if resolved_organization_id is distinct from job_row.organization_id then
    raise exception using errcode = '42501', message = 'league_standings_organization_mismatch';
  end if;

  update public.workflow_jobs job
  set state = 'running', locked_at = clock_timestamp(), lease_owner = p_actor_user_id
  where job.id = job_row.id;

  ready := season_row.current_scoring_rule_version_id is not null
    and exists (
      select 1 from public.league_rounds round
      where round.league_season_id = season_row.id
    )
    and not exists (
      select 1 from public.league_rounds round
      where round.league_season_id = season_row.id
        and round.current_source_version_id is null
    )
    and not exists (
      select 1
      from public.league_round_events round_event
      join public.league_round_race_mappings mapping
        on mapping.league_round_event_id = round_event.id
       and mapping.status = 'mapped'
      join public.league_competitions competition
        on competition.id = mapping.league_competition_id
       and competition.status <> 'archived'
      where round_event.league_season_id = season_row.id
        and (
          mapping.current_source_version_id is null
          or competition.current_scoring_policy_version_id is null
        )
    );

  if ready then
    begin
      standings_result := public.service_compute_league_standings(
        resolved_organization_id,
        season_row.id,
        p_actor_user_id,
        'Automatically recomputed after result publication.',
        job_row.id
      );
      result_payload := jsonb_build_object(
        'state', 'ready',
        'leagueSeasonId', season_row.id,
        'standingsVersionId', standings_result ->> 'standingsVersionId',
        'standings', standings_result
      );
    exception
      when unique_violation then
        if sqlerrm <> 'league_standings_inputs_unchanged' then
          raise;
        end if;
        result_payload := jsonb_build_object(
          'state', 'ready',
          'leagueSeasonId', season_row.id,
          'standingsVersionId', season_row.current_standings_version_id,
          'unchanged', true
        );
    end;

    insert into public.domain_events (
      organization_id,
      event_type,
      aggregate_type,
      aggregate_id,
      payload_json,
      actor_user_id,
      correlation_id,
      causation_event_id,
      idempotency_key
    )
    values (
      resolved_organization_id,
      'league.standings.published',
      'league_season',
      season_row.id,
      result_payload,
      p_actor_user_id,
      request_event.correlation_id,
      request_event.id,
      job_row.id::text
    )
    on conflict (event_type, idempotency_key) do nothing;
  else
    result_payload := jsonb_build_object(
      'state', 'waiting_for_sources',
      'leagueSeasonId', season_row.id,
      'standingsVersionId', season_row.current_standings_version_id
    );
  end if;

  update public.workflow_jobs job
  set
    state = 'succeeded',
    attempt_count = greatest(job.attempt_count, 1),
    result_json = result_payload,
    last_error_code = null,
    locked_at = null,
    lease_owner = null,
    completed_at = clock_timestamp()
  where job.id = job_row.id;

  return jsonb_build_object(
    'jobId', job_row.id,
    'state', 'succeeded',
    'result', result_payload,
    'replayed', false
  );
end;
$$;

-- Allow the internal standings job to use the existing computation function,
-- require pinned mapped sources, and record those exact sources in the digest.
do $migration$
declare
  compute_definition text;
  permission_old text := $old$  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'leagues.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'league_manage_permission_required';
  end if;$old$;
  permission_new text := $new$  if not exists (
    select 1
    from public.workflow_jobs workflow_job
    join public.domain_events workflow_event
      on workflow_event.id = workflow_job.domain_event_id
    where workflow_job.id = p_client_event_id
      and workflow_job.handler_key = 'league.standings.compute'
      and workflow_event.event_type = 'league.standings.compute.requested'
      and workflow_event.aggregate_type = 'league_season'
      and workflow_event.aggregate_id = p_league_season_id
      and workflow_event.actor_user_id = p_actor_user_id
      and workflow_job.organization_id = p_organization_id
  ) and not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'leagues.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'league_manage_permission_required';
  end if;$new$;
  source_guard_old text := $old$  if exists (
    select 1
    from public.league_round_events round_event
    join public.league_round_race_mappings mapping
      on mapping.league_round_event_id = round_event.id
     and mapping.status = 'mapped'
    join public.league_competitions competition
      on competition.id = mapping.league_competition_id
     and competition.status <> 'archived'
    where round_event.league_season_id = p_league_season_id
      and not exists (
        select 1
        from public.result_publications publication
        where publication.event_category_id = mapping.event_category_id
          and publication.publication_state in ('official', 'corrected')
      )
  ) then
    raise exception using errcode = 'P0001', message = 'league_mapped_result_publications_incomplete';
  end if;$old$;
  source_guard_new text := $new$  if exists (
    select 1
    from public.league_round_events round_event
    join public.league_round_race_mappings mapping
      on mapping.league_round_event_id = round_event.id
     and mapping.status = 'mapped'
    join public.league_competitions competition
      on competition.id = mapping.league_competition_id
     and competition.status <> 'archived'
    where round_event.league_season_id = p_league_season_id
      and mapping.current_source_version_id is null
  ) then
    raise exception using errcode = 'P0001', message = 'league_mapped_source_versions_incomplete';
  end if;$new$;
  mapped_manifest_old text := $old$          'eventCategoryId', mapping.event_category_id,
          'resultPublicationId', publication.id,
          'resultRunId', publication.result_run_id,
          'pointsMultiplier', round_event.points_multiplier * coalesce(mapping.points_multiplier_override, 1)
        )
        order by round_event.round_number, competition.display_order, competition.id
      )
      from public.league_round_events round_event
      join public.league_round_race_mappings mapping
        on mapping.league_round_event_id = round_event.id
       and mapping.status = 'mapped'
      join public.league_competitions competition
        on competition.id = mapping.league_competition_id
       and competition.status <> 'archived'
      join public.league_scoring_policy_versions policy
        on policy.id = competition.current_scoring_policy_version_id
      join lateral (
        select candidate.*
        from public.result_publications candidate
        where candidate.event_category_id = mapping.event_category_id
          and candidate.publication_state in ('official', 'corrected')
        order by candidate.published_at desc, candidate.id desc
        limit 1
      ) publication on true$old$;
  mapped_manifest_new text := $new$          'eventCategoryId', mapping.event_category_id,
          'sourceVersionId', mapping_source.id,
          'sourceVersionNumber', mapping_source.version_number,
          'sourceDigestSha256', mapping_source.source_digest_sha256,
          'publicationDigestSha256', mapping_source.publication_digest_sha256,
          'resultPublicationId', publication.id,
          'resultRunId', publication.result_run_id,
          'pointsMultiplier', round_event.points_multiplier * coalesce(mapping.points_multiplier_override, 1)
        )
        order by round_event.round_number, competition.display_order, competition.id
      )
      from public.league_round_events round_event
      join public.league_round_race_mappings mapping
        on mapping.league_round_event_id = round_event.id
       and mapping.status = 'mapped'
      join public.league_competitions competition
        on competition.id = mapping.league_competition_id
       and competition.status <> 'archived'
      join public.league_scoring_policy_versions policy
        on policy.id = competition.current_scoring_policy_version_id
      join public.league_round_mapping_source_versions mapping_source
        on mapping_source.id = mapping.current_source_version_id
      join public.result_publications publication
        on publication.id = mapping_source.result_publication_id$new$;
  club_source_old text := $old$    join lateral (
      select candidate.*
      from public.result_publications candidate
      where candidate.event_category_id = mapping.event_category_id
        and candidate.publication_state in ('official', 'corrected')
      order by candidate.published_at desc, candidate.id desc
      limit 1
    ) publication on true
    join public.result_rows result
      on result.result_run_id = publication.result_run_id$old$;
  club_source_new text := $new$    join public.league_round_mapping_source_versions mapping_source
      on mapping_source.id = mapping.current_source_version_id
    join public.result_publications publication
      on publication.id = mapping_source.result_publication_id
    join public.result_rows result
      on result.result_run_id = publication.result_run_id$new$;
  replacement_count integer;
begin
  select pg_get_functiondef(
    'public.service_compute_league_standings(uuid,uuid,uuid,text,uuid)'::regprocedure
  ) into compute_definition;

  replacement_count := (
    length(compute_definition) - length(replace(compute_definition, permission_old, ''))
  ) / length(permission_old);
  if replacement_count <> 1 then
    raise exception 'Expected one standings permission anchor, found %', replacement_count;
  end if;
  compute_definition := replace(compute_definition, permission_old, permission_new);

  replacement_count := (
    length(compute_definition) - length(replace(compute_definition, source_guard_old, ''))
  ) / length(source_guard_old);
  if replacement_count <> 1 then
    raise exception 'Expected one mapped source guard, found %', replacement_count;
  end if;
  compute_definition := replace(compute_definition, source_guard_old, source_guard_new);

  replacement_count := (
    length(compute_definition) - length(replace(compute_definition, mapped_manifest_old, ''))
  ) / length(mapped_manifest_old);
  if replacement_count <> 1 then
    raise exception 'Expected one mapped source manifest, found %', replacement_count;
  end if;
  compute_definition := replace(compute_definition, mapped_manifest_old, mapped_manifest_new);

  replacement_count := (
    length(compute_definition) - length(replace(compute_definition, club_source_old, ''))
  ) / length(club_source_old);
  if replacement_count <> 1 then
    raise exception 'Expected one mapped club source, found %', replacement_count;
  end if;
  compute_definition := replace(compute_definition, club_source_old, club_source_new);

  execute compute_definition;
end
$migration$;

alter table public.league_round_mapping_source_versions enable row level security;

revoke all on table public.league_round_mapping_source_versions
  from public, anon, authenticated;
grant select, insert on table public.league_round_mapping_source_versions to service_role;

revoke all on function public.protect_league_mapping_source_version()
  from public, anon, authenticated;
revoke all on function public.service_publish_result_run_with_workflows(
  uuid,uuid,public.publication_state,uuid,text,uuid
) from public, anon, authenticated;
revoke all on function public.service_process_result_publication_leagues(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.service_process_league_standings_job(uuid,uuid)
  from public, anon, authenticated;

grant execute on function public.service_publish_result_run_with_workflows(
  uuid,uuid,public.publication_state,uuid,text,uuid
) to service_role;
grant execute on function public.service_process_result_publication_leagues(uuid,uuid)
  to service_role;
grant execute on function public.service_process_league_standings_job(uuid,uuid)
  to service_role;

comment on table public.league_round_mapping_source_versions is
  'Append-only result-publication selections for mapped league races.';
comment on function public.service_publish_result_run_with_workflows(
  uuid,uuid,public.publication_state,uuid,text,uuid
) is 'Idempotently publishes a result run and commits its league propagation job in the same transaction.';
comment on function public.service_process_result_publication_leagues(uuid,uuid) is
  'Pins a publication into every mapped league race and enqueues versioned standings recomputation.';
comment on function public.service_process_league_standings_job(uuid,uuid) is
  'Computes standings from pinned source versions or records a deterministic waiting state.';

commit;
