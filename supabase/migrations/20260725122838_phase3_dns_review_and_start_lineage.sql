create table public.dns_review_batches (
  id uuid primary key default gen_random_uuid(),
  event_category_id uuid not null references public.event_categories (id) on delete cascade,
  race_start_event_id uuid not null references public.race_start_events (id) on delete restrict,
  start_list_manifest_id uuid not null references public.start_list_manifests (id) on delete restrict,
  review_state text not null default 'open',
  candidate_count integer not null default 0,
  note text,
  client_event_id uuid not null unique,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  committed_by_user_id uuid,
  committed_at timestamptz,
  check (review_state in ('open', 'committed', 'superseded')),
  check (candidate_count >= 0),
  check (
    (review_state = 'committed' and committed_at is not null)
    or (review_state <> 'committed' and committed_at is null)
  )
);

create index dns_review_batches_category_state_idx
  on public.dns_review_batches (event_category_id, review_state, created_at desc);

create table public.dns_review_entries (
  id uuid primary key default gen_random_uuid(),
  dns_review_batch_id uuid not null references public.dns_review_batches (id) on delete cascade,
  registration_id uuid not null references public.registrations (id) on delete cascade,
  captured_participation_status text not null,
  captured_bib_number text,
  created_at timestamptz not null default now(),
  unique (dns_review_batch_id, registration_id),
  check (captured_participation_status in ('not_started', 'checked_in'))
);

create index dns_review_entries_registration_idx
  on public.dns_review_entries (registration_id, dns_review_batch_id);

create or replace function public.service_create_dns_review(
  p_event_category_id uuid,
  p_actor_user_id uuid,
  p_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest_start public.race_start_events%rowtype;
  existing_batch public.dns_review_batches%rowtype;
  created_batch public.dns_review_batches%rowtype;
  v_candidate_count integer;
  organization_id uuid;
begin
  if p_client_event_id is null then
    raise exception using errcode = '22023', message = 'dns_review_input_invalid';
  end if;

  select batch.*
  into existing_batch
  from public.dns_review_batches batch
  where batch.client_event_id = p_client_event_id;
  if found then
    if existing_batch.event_category_id <> p_event_category_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_batch.id,
      'reviewState', existing_batch.review_state,
      'candidateCount', existing_batch.candidate_count,
      'replayed', true
    );
  end if;

  perform 1
  from public.event_categories category
  where category.id = p_event_category_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;

  select start_event.*
  into latest_start
  from public.race_start_events start_event
  where start_event.event_category_id = p_event_category_id
    and start_event.event_type in ('actual_start', 'restart')
  order by start_event.sequence_number desc
  limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = 'dns_review_start_required';
  end if;

  if exists (
    select 1
    from public.punch_events punch
    join public.checkpoints checkpoint on checkpoint.id = punch.checkpoint_id
    where punch.event_category_id = p_event_category_id
      and checkpoint.checkpoint_type = 'start'
      and not punch.is_voided
      and punch.registration_id is null
  ) then
    raise exception using errcode = 'P0001', message = 'dns_review_unresolved_start_events';
  end if;

  update public.dns_review_batches
  set review_state = 'superseded'
  where event_category_id = p_event_category_id
    and review_state = 'open';

  insert into public.dns_review_batches (
    event_category_id,
    race_start_event_id,
    start_list_manifest_id,
    note,
    client_event_id,
    created_by_user_id
  )
  values (
    p_event_category_id,
    latest_start.id,
    latest_start.start_list_manifest_id,
    nullif(trim(p_note), ''),
    p_client_event_id,
    p_actor_user_id
  )
  returning * into created_batch;

  insert into public.dns_review_entries (
    dns_review_batch_id,
    registration_id,
    captured_participation_status,
    captured_bib_number
  )
  select
    created_batch.id,
    registration.id,
    registration.participation_status::text,
    manifest_entry.bib_number
  from public.start_list_manifest_entries manifest_entry
  join public.registrations registration on registration.id = manifest_entry.registration_id
  where manifest_entry.manifest_id = latest_start.start_list_manifest_id
    and manifest_entry.event_category_id = p_event_category_id
    and registration.status = 'confirmed'
    and registration.participation_status in ('not_started', 'checked_in');
  get diagnostics v_candidate_count = row_count;

  update public.dns_review_batches
  set candidate_count = v_candidate_count
  where id = created_batch.id
  returning * into created_batch;

  select series.organization_id
  into organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = p_event_category_id;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    organization_id,
    p_actor_user_id,
    'dns_review_batch',
    created_batch.id,
    'race.dns_review_created',
    jsonb_build_object('candidateCount', v_candidate_count, 'raceStartEventId', latest_start.id)
  );

  return jsonb_build_object(
    'id', created_batch.id,
    'reviewState', created_batch.review_state,
    'candidateCount', created_batch.candidate_count,
    'raceStartEventId', created_batch.race_start_event_id,
    'replayed', false
  );
end;
$$;

create or replace function public.service_commit_dns_review(
  p_dns_review_batch_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_row public.dns_review_batches%rowtype;
  latest_start_id uuid;
  applied_count integer;
  organization_id uuid;
begin
  select batch.*
  into batch_row
  from public.dns_review_batches batch
  where batch.id = p_dns_review_batch_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'dns_review_not_found';
  end if;
  if batch_row.review_state = 'committed' then
    return jsonb_build_object(
      'id', batch_row.id,
      'reviewState', batch_row.review_state,
      'appliedCount', batch_row.candidate_count,
      'replayed', true
    );
  end if;
  if batch_row.review_state <> 'open' then
    raise exception using errcode = 'P0001', message = 'dns_review_not_open';
  end if;

  select start_event.id
  into latest_start_id
  from public.race_start_events start_event
  where start_event.event_category_id = batch_row.event_category_id
    and start_event.event_type in ('actual_start', 'restart')
  order by start_event.sequence_number desc
  limit 1;
  if latest_start_id is distinct from batch_row.race_start_event_id then
    raise exception using errcode = 'P0001', message = 'dns_review_start_changed';
  end if;

  if exists (
    select 1
    from public.punch_events punch
    join public.checkpoints checkpoint on checkpoint.id = punch.checkpoint_id
    where punch.event_category_id = batch_row.event_category_id
      and checkpoint.checkpoint_type = 'start'
      and not punch.is_voided
      and punch.registration_id is null
  ) then
    raise exception using errcode = 'P0001', message = 'dns_review_unresolved_start_events';
  end if;

  if exists (
    select 1
    from public.dns_review_entries entry
    join public.registrations registration on registration.id = entry.registration_id
    where entry.dns_review_batch_id = batch_row.id
      and (
        registration.status <> 'confirmed'
        or registration.participation_status::text <> entry.captured_participation_status
      )
  ) then
    raise exception using errcode = 'P0001', message = 'dns_review_stale';
  end if;

  insert into public.participant_statuses (
    registration_id,
    status,
    effective_at,
    reason,
    created_by_user_id,
    client_event_id,
    supersedes_status_id,
    source,
    metadata_json
  )
  select
    entry.registration_id,
    'dns',
    clock_timestamp(),
    coalesce(nullif(trim(batch_row.note), ''), 'reviewed_dns_after_start_window'),
    p_actor_user_id,
    gen_random_uuid(),
    previous_status.id,
    'dns_review',
    jsonb_build_object(
      'dnsReviewBatchId', batch_row.id,
      'raceStartEventId', batch_row.race_start_event_id,
      'capturedBibNumber', entry.captured_bib_number
    )
  from public.dns_review_entries entry
  left join lateral (
    select status_event.id
    from public.participant_statuses status_event
    where status_event.registration_id = entry.registration_id
    order by status_event.sequence_number desc
    limit 1
  ) previous_status on true
  where entry.dns_review_batch_id = batch_row.id;
  get diagnostics applied_count = row_count;

  update public.registrations registration
  set participation_status = 'dns'
  from public.dns_review_entries entry
  where entry.dns_review_batch_id = batch_row.id
    and registration.id = entry.registration_id;

  update public.dns_review_batches
  set
    review_state = 'committed',
    committed_by_user_id = p_actor_user_id,
    committed_at = clock_timestamp()
  where id = batch_row.id
  returning * into batch_row;

  select series.organization_id
  into organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = batch_row.event_category_id;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    organization_id,
    p_actor_user_id,
    'dns_review_batch',
    batch_row.id,
    'race.dns_review_committed',
    jsonb_build_object('appliedCount', applied_count, 'raceStartEventId', batch_row.race_start_event_id)
  );

  return jsonb_build_object(
    'id', batch_row.id,
    'reviewState', batch_row.review_state,
    'appliedCount', applied_count,
    'committedAt', batch_row.committed_at,
    'replayed', false
  );
end;
$$;

create or replace function public.service_publish_result_run_guarded(
  p_event_category_id uuid,
  p_result_run_id uuid,
  p_publication_state public.publication_state,
  p_published_by_user_id uuid,
  p_change_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  publication_id uuid;
  result_run_row public.result_runs%rowtype;
  latest_start_id uuid;
begin
  select result_run.*
  into result_run_row
  from public.result_runs result_run
  where result_run.id = p_result_run_id
    and result_run.event_category_id = p_event_category_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'successful_result_run_required';
  end if;

  select start_event.id
  into latest_start_id
  from public.race_start_events start_event
  where start_event.event_category_id = p_event_category_id
    and start_event.event_type in ('actual_start', 'restart')
  order by start_event.sequence_number desc
  limit 1;
  if latest_start_id is null
     or result_run_row.start_event_id is distinct from latest_start_id then
    raise exception using errcode = 'P0001', message = 'result_run_start_lineage_stale';
  end if;

  if exists (
    select 1
    from public.result_anomalies anomaly
    where anomaly.result_run_id = p_result_run_id
      and anomaly.state = 'open'
      and anomaly.severity in ('error', 'critical')
  ) then
    raise exception using errcode = 'P0001', message = 'blocking_result_anomalies_open';
  end if;

  if exists (
    select 1
    from public.punch_events punch
    where punch.event_category_id = p_event_category_id
      and not punch.is_voided
      and punch.registration_id is null
  ) then
    raise exception using errcode = 'P0001', message = 'unresolved_timing_events_open';
  end if;

  if p_publication_state in ('official', 'corrected') and not exists (
    select 1
    from public.field_accounting_signoffs signoff
    where signoff.event_category_id = p_event_category_id
      and signoff.sequence_number = (
        select max(latest_signoff.sequence_number)
        from public.field_accounting_signoffs latest_signoff
        where latest_signoff.event_category_id = p_event_category_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'field_accounting_signoff_required';
  end if;

  if p_publication_state in ('official', 'corrected') and exists (
    select 1
    from public.registrations registration
    where registration.event_category_id = p_event_category_id
      and registration.status = 'confirmed'
      and registration.participation_status in ('not_started', 'checked_in', 'started', 'missing')
  ) then
    raise exception using errcode = 'P0001', message = 'field_accounting_incomplete';
  end if;

  publication_id := public.publish_result_run_atomically(
    p_event_category_id,
    p_result_run_id,
    p_publication_state,
    p_published_by_user_id,
    p_change_note
  );
  return publication_id;
end;
$$;

alter table public.dns_review_batches enable row level security;
alter table public.dns_review_entries enable row level security;

revoke all on table public.dns_review_batches from public, anon, authenticated;
revoke all on table public.dns_review_entries from public, anon, authenticated;
grant all on table public.dns_review_batches to service_role;
grant all on table public.dns_review_entries to service_role;

revoke all on function public.service_create_dns_review(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.service_commit_dns_review(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_create_dns_review(uuid, uuid, text, uuid)
  to service_role;
grant execute on function public.service_commit_dns_review(uuid, uuid)
  to service_role;
