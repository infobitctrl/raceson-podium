/*
 * Premium organizer analytics and governed exports.
 *
 * Metric definitions are versioned and source-aware. Analytical reads disclose
 * scope, freshness, finality, and official-publication lineage. Export requests
 * are queued independently of artifact generation, frozen at request time,
 * checksummed, expiring, revocable, and covered by append-only access evidence.
 */

create table public.analytics_metric_definitions (
  id uuid primary key default gen_random_uuid(),
  metric_code text not null,
  version_number integer not null,
  metric_state text not null default 'active',
  area text not null,
  title text not null,
  description text not null,
  unit text not null,
  calculation text not null,
  source_tables text[] not null,
  freshness_target_seconds integer not null,
  finality_rule text not null,
  sensitivity text not null default 'standard',
  minimum_group_size integer not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  unique (metric_code, version_number),
  check (metric_code ~ '^[a-z][a-z0-9_.:-]{2,119}$'),
  check (version_number > 0),
  check (metric_state in ('active', 'superseded', 'retired')),
  check (area in ('registration', 'finance', 'checkin', 'timing', 'race', 'safety', 'communications', 'retention')),
  check (unit in ('count', 'percent', 'seconds', 'minutes', 'currency_minor')),
  check (cardinality(source_tables) > 0),
  check (freshness_target_seconds between 1 and 86400),
  check (sensitivity in ('standard', 'elevated', 'restricted')),
  check (minimum_group_size between 1 and 100)
);
create unique index analytics_metric_definitions_active_idx
  on public.analytics_metric_definitions (metric_code)
  where metric_state = 'active';
insert into public.analytics_metric_definitions (
  metric_code, version_number, area, title, description, unit, calculation,
  source_tables, freshness_target_seconds, finality_rule, sensitivity, minimum_group_size
)
values
  ('registration.total', 1, 'registration', 'Registrations', 'All registration records in the selected edition.', 'count', 'count(registrations.id)', array['registrations', 'event_categories'], 60, 'Operational until the edition is archived.', 'standard', 1),
  ('registration.conversion_rate', 1, 'registration', 'Confirmation rate', 'Confirmed registrations divided by all non-draft registration records.', 'percent', 'confirmed / greatest(non_draft, 1) * 100', array['registrations'], 60, 'Operational until registration closes.', 'standard', 1),
  ('registration.capacity_utilization', 1, 'registration', 'Capacity utilization', 'Confirmed registrations divided by configured category capacity.', 'percent', 'confirmed / greatest(sum(category.capacity), 1) * 100', array['registrations', 'event_categories'], 60, 'Final when registration closes and pending entries are resolved.', 'standard', 1),
  ('finance.gross', 1, 'finance', 'Gross collected', 'Sum of positive charge ledger entries, grouped by currency.', 'currency_minor', 'sum(financial_ledger_entries.amount_cents) where entry_type = charge and amount_cents > 0', array['financial_ledger_entries', 'registrations'], 300, 'Final only against a reconciled append-only ledger.', 'restricted', 1),
  ('finance.net', 1, 'finance', 'Net ledger movement', 'Sum of all ledger entries, grouped by currency.', 'currency_minor', 'sum(financial_ledger_entries.amount_cents)', array['financial_ledger_entries', 'registrations'], 300, 'Final only against a reconciled append-only ledger.', 'restricted', 1),
  ('checkin.completed', 1, 'checkin', 'Checked in', 'Registrations with a check-in record.', 'count', 'count(checkins.id)', array['checkins', 'registrations'], 30, 'Final after check-in closes.', 'standard', 1),
  ('timing.capture_count', 1, 'timing', 'Timing captures', 'Non-voided and voided raw punch observations received for the edition.', 'count', 'count(punch_events.id)', array['punch_events', 'event_categories'], 15, 'Operational; raw observations remain append-only evidence.', 'elevated', 1),
  ('timing.unknown_bibs', 1, 'timing', 'Unknown bib captures', 'Punch observations that are not reconciled to a registration.', 'count', 'count(punch_events.id) where registration_id is null', array['punch_events'], 15, 'Final after timing reconciliation closes.', 'elevated', 1),
  ('timing.average_sync_delay', 1, 'timing', 'Average sync delay', 'Average seconds between observation time and platform ingestion.', 'seconds', 'avg(greatest(0, ingested_at - recorded_at))', array['punch_events'], 15, 'Operational estimate.', 'standard', 1),
  ('race.finishers', 1, 'race', 'Finishers', 'Registrations marked finished; official lineage is attached when an official or corrected publication exists.', 'count', 'count(registrations.id) where participation_status = finished', array['registrations', 'result_publications', 'result_runs'], 30, 'Final only when every race has an official or corrected publication.', 'standard', 1),
  ('race.completion_rate', 1, 'race', 'Completion rate', 'Finishers divided by starters plus terminal race statuses.', 'percent', 'finished / greatest(started + finished + dnf + dsq, 1) * 100', array['registrations', 'result_publications'], 30, 'Final only when every race has an official or corrected publication.', 'standard', 1),
  ('safety.open_incidents', 1, 'safety', 'Open incidents', 'Incidents not in resolved, reviewed, or closed state.', 'count', 'count(safety_incidents.id) where incident_state not in resolved, reviewed, closed', array['safety_incidents'], 15, 'Operational until safety command closes the edition.', 'restricted', 1),
  ('safety.average_acknowledgement', 1, 'safety', 'Average acknowledgement', 'Average minutes from incident report to acknowledgement.', 'minutes', 'avg(acknowledged_at - reported_at)', array['safety_incidents'], 15, 'Operational estimate.', 'restricted', 5),
  ('communications.delivery_rate', 1, 'communications', 'Delivery rate', 'Delivered messages divided by messages that were sent, delivered, or failed.', 'percent', 'delivered / greatest(sent + delivered + failed, 1) * 100', array['communication_deliveries', 'communication_campaigns'], 300, 'Final when all campaign deliveries reach a terminal state.', 'elevated', 5),
  ('retention.returning_athletes', 1, 'retention', 'Returning athletes', 'Athletes in the selected edition who registered in a prior edition owned by the organization.', 'count', 'count(distinct athlete_profile_id with an earlier registration)', array['registrations', 'event_editions', 'event_series'], 3600, 'Final after duplicate athlete identities are resolved.', 'elevated', 5);
create table public.analytics_export_dataset_definitions (
  dataset_code text primary key,
  title text not null,
  description text not null,
  sensitivity text not null,
  approval_required boolean not null default false,
  available_fields text[] not null,
  default_fields text[] not null,
  default_retention_days integer not null default 30,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  check (dataset_code ~ '^[a-z][a-z0-9_.:-]{2,119}$'),
  check (sensitivity in ('standard', 'elevated', 'restricted')),
  check (cardinality(available_fields) > 0),
  check (cardinality(default_fields) > 0),
  check (default_fields <@ available_fields),
  check (default_retention_days between 1 and 365)
);
insert into public.analytics_export_dataset_definitions (
  dataset_code, title, description, sensitivity, approval_required,
  available_fields, default_fields, default_retention_days
)
values
  ('participants', 'Participants', 'Registration lifecycle and athlete references.', 'restricted', true, array['registrationId','athleteProfileId','categoryId','categoryName','status','paymentStatus','participationStatus','source','registeredAt','confirmedAt'], array['registrationId','categoryName','status','paymentStatus','participationStatus','registeredAt'], 14),
  ('form_answers', 'Registration form answers', 'Submitted form answers linked to registration records.', 'restricted', true, array['registrationId','fieldKey','fieldLabel','value','submittedAt'], array['registrationId','fieldKey','fieldLabel','value'], 7),
  ('financial_ledger', 'Financial ledger', 'Append-only financial entries reconciled to registration scope.', 'restricted', true, array['ledgerEntryId','registrationId','entryType','amountCents','currency','externalReference','description','effectiveAt'], array['ledgerEntryId','entryType','amountCents','currency','description','effectiveAt'], 30),
  ('refunds', 'Refund register', 'Payment refund requests and terminal outcomes.', 'restricted', true, array['refundId','registrationId','status','amountCents','currency','reason','requestedAt','completedAt'], array['refundId','status','amountCents','currency','reason','requestedAt','completedAt'], 30),
  ('bibs', 'Bib assignments', 'Active and revoked bib allocation evidence.', 'standard', false, array['registrationId','categoryId','bibNumber','assignedAt','revokedAt'], array['registrationId','categoryId','bibNumber','assignedAt'], 30),
  ('checkins', 'Check-ins', 'Edition check-in throughput and station evidence.', 'elevated', false, array['registrationId','checkedInAt','locationLabel','notes'], array['registrationId','checkedInAt','locationLabel'], 14),
  ('raw_timing', 'Raw timing observations', 'Raw punch evidence including reconciliation and ingestion timing.', 'restricted', true, array['punchId','categoryId','checkpointId','registrationId','bibNumber','recordedAt','ingestedAt','isVoided','clientEventId'], array['punchId','categoryId','checkpointId','registrationId','bibNumber','recordedAt','ingestedAt','isVoided'], 14),
  ('participant_statuses', 'Participant statuses', 'Append-only participant status observations.', 'elevated', false, array['statusId','registrationId','status','effectiveAt','reason','createdAt'], array['registrationId','status','effectiveAt','reason'], 30),
  ('incidents', 'Safety incidents', 'Restricted incident command records without medical narrative.', 'restricted', true, array['incidentId','incidentCode','categoryId','registrationId','type','severity','state','title','locationLabel','effectiveAt','acknowledgedAt','resolvedAt'], array['incidentCode','type','severity','state','title','locationLabel','effectiveAt','acknowledgedAt','resolvedAt'], 7),
  ('official_results', 'Official results', 'Rows from the latest official or corrected result publication.', 'standard', false, array['publicationId','publicationState','publishedAt','categoryId','resultRunId','registrationId','athleteProfileId','finishTimeMs','rankOverall','rankGender','rankAgeCategory','resultStatus'], array['publicationId','publicationState','categoryId','registrationId','finishTimeMs','rankOverall','resultStatus'], 90),
  ('splits', 'Official result splits', 'Split rows attached to the latest official or corrected result publication.', 'standard', false, array['publicationId','resultRowId','checkpointId','sequenceNumber','elapsedTimeMs','splitTimeMs','rankAtCheckpoint'], array['publicationId','resultRowId','checkpointId','sequenceNumber','elapsedTimeMs','rankAtCheckpoint'], 90),
  ('communication_delivery', 'Communication delivery', 'Campaign delivery states and provider evidence without recipient addresses.', 'restricted', true, array['campaignId','campaignName','registrationId','channel','locale','state','attemptCount','sentAt','deliveredAt','failedAt','failureCode'], array['campaignName','channel','locale','state','attemptCount','sentAt','deliveredAt','failedAt','failureCode'], 14),
  ('audit_log', 'Organization audit log', 'Organizer command audit records and metadata.', 'restricted', true, array['auditId','entityType','entityId','action','metadata','actorUserId','createdAt'], array['auditId','entityType','entityId','action','actorUserId','createdAt'], 30),
  ('analytics_summary', 'Analytics summary', 'Versioned KPI values, scope, freshness, finality, filters, and lineage.', 'standard', false, array['metricCode','metricVersion','value','unit','scope','asOf','isFinal','sourceReferences'], array['metricCode','metricVersion','value','unit','scope','asOf','isFinal','sourceReferences'], 90);
create table public.organizer_saved_analytics_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  event_edition_id uuid references public.event_editions (id) on delete cascade,
  comparison_event_edition_id uuid references public.event_editions (id) on delete set null,
  timezone text not null,
  filters_json jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_by_user_id uuid not null,
  last_client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (length(trim(name)) between 1 and 160),
  check (jsonb_typeof(filters_json) = 'object'),
  check (event_edition_id is null or event_edition_id <> comparison_event_edition_id)
);
create unique index organizer_saved_analytics_views_default_idx
  on public.organizer_saved_analytics_views (organization_id)
  where is_default;
create table public.organizer_analytics_export_jobs (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  event_edition_id uuid references public.event_editions (id) on delete restrict,
  dataset_code text not null references public.analytics_export_dataset_definitions (dataset_code) on delete restrict,
  export_format text not null,
  export_state text not null default 'queued',
  selected_fields text[] not null,
  filters_json jsonb not null default '{}'::jsonb,
  timezone text not null,
  contains_sensitive_data boolean not null,
  approval_request_id uuid references public.approval_requests (id) on delete restrict,
  requested_by_user_id uuid not null,
  client_event_id uuid not null unique,
  requested_at timestamptz not null default clock_timestamp(),
  processing_started_at timestamptz,
  ready_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  revocation_reason text,
  row_count integer,
  object_reference text,
  checksum_sha256 text,
  artifact_content text,
  failure_code text,
  check (export_format in ('csv', 'json')),
  check (export_state in ('queued', 'processing', 'ready', 'failed', 'expired', 'revoked')),
  check (cardinality(selected_fields) > 0),
  check (jsonb_typeof(filters_json) = 'object'),
  check (row_count is null or row_count >= 0),
  check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  check (
    export_state <> 'ready'
    or (
      ready_at is not null
      and expires_at > ready_at
      and row_count is not null
      and object_reference is not null
      and checksum_sha256 is not null
      and artifact_content is not null
    )
  ),
  check (
    export_state <> 'revoked'
    or (
      revoked_at is not null
      and revoked_by_user_id is not null
      and length(trim(revocation_reason)) > 0
    )
  )
);
create index organizer_analytics_export_jobs_org_requested_idx
  on public.organizer_analytics_export_jobs (organization_id, requested_at desc);
create table public.organizer_analytics_export_events (
  id uuid primary key default gen_random_uuid(),
  analytics_export_job_id uuid not null references public.organizer_analytics_export_jobs (id) on delete restrict,
  sequence_number integer not null,
  action_type text not null,
  note text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  client_event_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (analytics_export_job_id, sequence_number),
  check (action_type in ('requested', 'processing', 'generated', 'failed', 'downloaded', 'expired', 'revoked')),
  check (length(trim(note)) > 0),
  check (jsonb_typeof(metadata_json) = 'object')
);
create or replace function public.prevent_analytics_definition_or_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'analytics_evidence_is_append_only';
end;
$$;
create trigger analytics_metric_definitions_immutable
before update or delete on public.analytics_metric_definitions
for each row execute function public.prevent_analytics_definition_or_event_change();
create trigger analytics_export_events_immutable
before update or delete on public.organizer_analytics_export_events
for each row execute function public.prevent_analytics_definition_or_event_change();
create or replace function public.protect_analytics_export_job()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'analytics_export_job_delete_forbidden';
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.event_edition_id is distinct from old.event_edition_id
     or new.dataset_code is distinct from old.dataset_code
     or new.export_format is distinct from old.export_format
     or new.selected_fields is distinct from old.selected_fields
     or new.filters_json is distinct from old.filters_json
     or new.timezone is distinct from old.timezone
     or new.contains_sensitive_data is distinct from old.contains_sensitive_data
     or new.approval_request_id is distinct from old.approval_request_id
     or new.requested_by_user_id is distinct from old.requested_by_user_id
     or new.client_event_id is distinct from old.client_event_id
     or new.requested_at is distinct from old.requested_at then
    raise exception using errcode = '55000', message = 'analytics_export_request_is_immutable';
  end if;
  if not (
    new.export_state = old.export_state
    or (old.export_state = 'queued' and new.export_state = 'processing')
    or (old.export_state = 'processing' and new.export_state in ('ready', 'failed'))
    or (old.export_state = 'ready' and new.export_state in ('expired', 'revoked'))
  ) then
    raise exception using errcode = '55000', message = 'analytics_export_state_transition_invalid';
  end if;
  if old.artifact_content is not null
     and (
       new.artifact_content is distinct from old.artifact_content
       or new.checksum_sha256 is distinct from old.checksum_sha256
       or new.object_reference is distinct from old.object_reference
       or new.row_count is distinct from old.row_count
     ) then
    raise exception using errcode = '55000', message = 'analytics_export_artifact_is_immutable';
  end if;
  return new;
end;
$$;
create trigger organizer_analytics_export_jobs_protect
before update or delete on public.organizer_analytics_export_jobs
for each row execute function public.protect_analytics_export_job();
create or replace function public.service_save_analytics_view(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_view_id uuid,
  p_name text,
  p_event_edition_id uuid,
  p_comparison_event_edition_id uuid,
  p_timezone text,
  p_filters_json jsonb,
  p_is_default boolean,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_view public.organizer_saved_analytics_views%rowtype;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'analytics.view'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if nullif(trim(p_name), '') is null
     or coalesce(jsonb_typeof(p_filters_json), 'object') <> 'object'
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone)
     or p_event_edition_id = p_comparison_event_edition_id then
    raise exception using errcode = '22023', message = 'analytics_view_input_invalid';
  end if;
  if p_event_edition_id is not null and not exists (
    select 1
    from public.event_editions edition
    join public.event_series series on series.id = edition.event_series_id
    where edition.id = p_event_edition_id and series.organization_id = p_organization_id
  ) then
    raise exception using errcode = '22023', message = 'analytics_scope_invalid';
  end if;
  if p_comparison_event_edition_id is not null and not exists (
    select 1
    from public.event_editions edition
    join public.event_series series on series.id = edition.event_series_id
    where edition.id = p_comparison_event_edition_id and series.organization_id = p_organization_id
  ) then
    raise exception using errcode = '22023', message = 'analytics_scope_invalid';
  end if;

  select *
  into saved_view
  from public.organizer_saved_analytics_views
  where last_client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object('id', saved_view.id, 'replayed', true);
  end if;

  if coalesce(p_is_default, false) then
    update public.organizer_saved_analytics_views
    set is_default = false, updated_at = clock_timestamp()
    where organization_id = p_organization_id and is_default;
  end if;

  insert into public.organizer_saved_analytics_views (
    id, organization_id, name, event_edition_id, comparison_event_edition_id,
    timezone, filters_json, is_default, created_by_user_id, last_client_event_id
  )
  values (
    coalesce(p_view_id, gen_random_uuid()), p_organization_id, trim(p_name),
    p_event_edition_id, p_comparison_event_edition_id, p_timezone,
    coalesce(p_filters_json, '{}'::jsonb), coalesce(p_is_default, false),
    p_actor_user_id, p_client_event_id
  )
  on conflict (id) do update set
    name = excluded.name,
    event_edition_id = excluded.event_edition_id,
    comparison_event_edition_id = excluded.comparison_event_edition_id,
    timezone = excluded.timezone,
    filters_json = excluded.filters_json,
    is_default = excluded.is_default,
    last_client_event_id = excluded.last_client_event_id,
    updated_at = clock_timestamp()
  returning * into saved_view;

  return jsonb_build_object(
    'id', saved_view.id,
    'name', saved_view.name,
    'eventEditionId', saved_view.event_edition_id,
    'comparisonEventEditionId', saved_view.comparison_event_edition_id,
    'timezone', saved_view.timezone,
    'filters', saved_view.filters_json,
    'isDefault', saved_view.is_default,
    'replayed', false
  );
end;
$$;
create or replace function public.service_build_edition_analytics(p_event_edition_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with
  edition_scope as (
    select edition.id, edition.name, edition.status, edition.start_date, edition.end_date,
           edition.timezone, series.organization_id
    from public.event_editions edition
    join public.event_series series on series.id = edition.event_series_id
    where edition.id = p_event_edition_id
  ),
  categories as (
    select category.*
    from public.event_categories category
    where category.event_edition_id = p_event_edition_id
  ),
  registrations_scope as (
    select registration.*
    from public.registrations registration
    join categories category on category.id = registration.event_category_id
  ),
  registration_metrics as (
    select
      count(*)::integer as total,
      count(*) filter (where status = 'confirmed')::integer as confirmed,
      count(*) filter (where status = 'waitlisted')::integer as waitlisted,
      count(*) filter (where status = 'cancelled')::integer as cancelled,
      count(*) filter (where status <> 'draft')::integer as non_draft,
      count(*) filter (where participation_status = 'not_started')::integer as not_started,
      count(*) filter (where participation_status = 'started')::integer as started,
      count(*) filter (where participation_status = 'finished')::integer as finished,
      count(*) filter (where participation_status = 'dnf')::integer as dnf,
      count(*) filter (where participation_status = 'dns')::integer as dns,
      count(*) filter (where participation_status = 'dsq')::integer as dsq
    from registrations_scope
  ),
  capacity_metric as (
    select coalesce(sum(capacity), 0)::integer as capacity from categories
  ),
  checkin_metric as (
    select count(*)::integer as checked_in
    from public.checkins checkin
    join registrations_scope registration on registration.id = checkin.registration_id
  ),
  timing_metric as (
    select
      count(*)::integer as captures,
      count(*) filter (where punch.registration_id is null)::integer as unknown_bibs,
      count(*) filter (where punch.is_voided)::integer as voided,
      coalesce(avg(greatest(0, extract(epoch from (punch.ingested_at - punch.recorded_at)))), 0)::numeric(12,2) as average_sync_delay_seconds
    from public.punch_events punch
    join categories category on category.id = punch.event_category_id
  ),
  timing_revisions as (
    select count(*)::integer as corrections
    from public.punch_event_revisions revision
    join public.punch_events punch on punch.id = revision.punch_event_id
    join categories category on category.id = punch.event_category_id
  ),
  finance_metric as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'currency', ledger.currency,
      'grossCents', ledger.gross_cents,
      'refundCents', ledger.refund_cents,
      'feeCents', ledger.fee_cents,
      'netCents', ledger.net_cents,
      'entryCount', ledger.entry_count
    ) order by ledger.currency), '[]'::jsonb) as currencies
    from (
      select trim(entry.currency) as currency,
             coalesce(sum(entry.amount_cents) filter (where entry.entry_type = 'charge' and entry.amount_cents > 0), 0)::bigint as gross_cents,
             coalesce(sum(entry.amount_cents) filter (where entry.entry_type = 'refund'), 0)::bigint as refund_cents,
             coalesce(sum(entry.amount_cents) filter (where entry.entry_type in ('platform_fee', 'processor_fee')), 0)::bigint as fee_cents,
             coalesce(sum(entry.amount_cents), 0)::bigint as net_cents,
             count(*)::integer as entry_count
      from public.financial_ledger_entries entry
      join registrations_scope registration on registration.id = entry.registration_id
      group by entry.currency
    ) ledger
  ),
  safety_metric as (
    select
      count(*)::integer as incidents,
      count(*) filter (where incident_state not in ('resolved', 'reviewed', 'closed'))::integer as open_incidents,
      count(*) filter (where severity = 'critical')::integer as critical_incidents,
      coalesce(avg(extract(epoch from (acknowledged_at - reported_at)) / 60)
        filter (where acknowledged_at is not null), 0)::numeric(12,2) as average_acknowledgement_minutes
    from public.safety_incidents
    where event_edition_id = p_event_edition_id
  ),
  communication_metric as (
    select
      count(delivery.id)::integer as total,
      count(delivery.id) filter (where delivery.state = 'delivered')::integer as delivered,
      count(delivery.id) filter (where delivery.state = 'failed')::integer as failed,
      count(delivery.id) filter (where delivery.state = 'suppressed')::integer as suppressed
    from public.communication_campaigns campaign
    left join public.communication_deliveries delivery on delivery.campaign_id = campaign.id
    where campaign.event_edition_id = p_event_edition_id
  ),
  latest_publications as (
    select distinct on (publication.event_category_id)
      publication.id, publication.event_category_id, publication.result_run_id,
      publication.publication_state, publication.published_at,
      publication.manifest_digest_sha256
    from public.result_publications publication
    join categories category on category.id = publication.event_category_id
    where publication.publication_state in ('official', 'corrected')
    order by publication.event_category_id, publication.published_at desc
  ),
  publication_metric as (
    select
      count(*)::integer as publication_count,
      coalesce(jsonb_agg(jsonb_build_object(
        'publicationId', publication.id,
        'categoryId', publication.event_category_id,
        'resultRunId', publication.result_run_id,
        'publicationState', publication.publication_state,
        'publishedAt', publication.published_at,
        'manifestDigestSha256', publication.manifest_digest_sha256
      ) order by publication.published_at desc), '[]'::jsonb) as references
    from latest_publications publication
  ),
  source_breakdown as (
    select coalesce(jsonb_agg(jsonb_build_object('source', source, 'count', source_count) order by source_count desc), '[]'::jsonb) as values
    from (
      select registration.source, count(*)::integer as source_count
      from registrations_scope registration
      group by registration.source
    ) grouped
  ),
  registration_trend as (
    select coalesce(jsonb_agg(jsonb_build_object('date', day, 'registrations', registrations) order by day), '[]'::jsonb) as values
    from (
      select (registration.created_at at time zone edition.timezone)::date as day,
             count(*)::integer as registrations
      from registrations_scope registration
      cross join edition_scope edition
      group by day
    ) grouped
  ),
  returning_metric as (
    select count(distinct current_registration.athlete_profile_id)::integer as returning_athletes
    from registrations_scope current_registration
    cross join edition_scope current_edition
    where exists (
      select 1
      from public.registrations prior_registration
      join public.event_categories prior_category on prior_category.id = prior_registration.event_category_id
      join public.event_editions prior_edition on prior_edition.id = prior_category.event_edition_id
      join public.event_series prior_series on prior_series.id = prior_edition.event_series_id
      where prior_registration.athlete_profile_id = current_registration.athlete_profile_id
        and prior_series.organization_id = current_edition.organization_id
        and prior_edition.start_date < current_edition.start_date
    )
  )
  select jsonb_build_object(
    'eventEditionId', edition.id,
    'name', edition.name,
    'status', edition.status,
    'startDate', edition.start_date,
    'endDate', edition.end_date,
    'timezone', edition.timezone,
    'registration', jsonb_build_object(
      'total', registration.total,
      'confirmed', registration.confirmed,
      'waitlisted', registration.waitlisted,
      'cancelled', registration.cancelled,
      'capacity', capacity.capacity,
      'conversionRate', round(registration.confirmed::numeric / greatest(registration.non_draft, 1) * 100, 1),
      'capacityUtilization', round(registration.confirmed::numeric / greatest(capacity.capacity, 1) * 100, 1),
      'checkedIn', checkin.checked_in
    ),
    'finance', jsonb_build_object('currencies', finance.currencies),
    'race', jsonb_build_object(
      'notStarted', registration.not_started,
      'started', registration.started,
      'finished', registration.finished,
      'dnf', registration.dnf,
      'dns', registration.dns,
      'dsq', registration.dsq,
      'completionRate', round(registration.finished::numeric /
        greatest(registration.started + registration.finished + registration.dnf + registration.dsq, 1) * 100, 1)
    ),
    'timing', jsonb_build_object(
      'captures', timing.captures,
      'unknownBibs', timing.unknown_bibs,
      'voided', timing.voided,
      'corrections', revisions.corrections,
      'averageSyncDelaySeconds', timing.average_sync_delay_seconds
    ),
    'safety', jsonb_build_object(
      'incidents', safety.incidents,
      'openIncidents', safety.open_incidents,
      'criticalIncidents', safety.critical_incidents,
      'averageAcknowledgementMinutes', safety.average_acknowledgement_minutes
    ),
    'communications', jsonb_build_object(
      'total', communication.total,
      'delivered', communication.delivered,
      'failed', communication.failed,
      'suppressed', communication.suppressed,
      'deliveryRate', round(communication.delivered::numeric /
        greatest(communication.delivered + communication.failed, 1) * 100, 1)
    ),
    'retention', jsonb_build_object('returningAthletes', returners.returning_athletes),
    'registrationTrend', trend.values,
    'sourceBreakdown', sources.values,
    'finality', jsonb_build_object(
      'isFinal', edition.status in ('completed', 'archived')
        and publication.publication_count = (select count(*) from categories),
      'reason', case
        when edition.status not in ('completed', 'archived') then 'Edition is still operational.'
        when publication.publication_count <> (select count(*) from categories) then 'One or more races do not have an official publication.'
        else 'Every race is backed by an official or corrected publication.'
      end,
      'publicationReferences', publication.references
    )
  )
  from edition_scope edition
  cross join registration_metrics registration
  cross join capacity_metric capacity
  cross join checkin_metric checkin
  cross join timing_metric timing
  cross join timing_revisions revisions
  cross join finance_metric finance
  cross join safety_metric safety
  cross join communication_metric communication
  cross join publication_metric publication
  cross join source_breakdown sources
  cross join registration_trend trend
  cross join returning_metric returners
$$;
create or replace function public.service_get_organization_analytics(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_event_edition_id uuid,
  p_comparison_event_edition_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_edition_id uuid;
  result_json jsonb;
  edition_options jsonb;
  definitions jsonb;
  selected_metrics jsonb;
  comparison_metrics jsonb;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'analytics.view'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception using errcode = '22023', message = 'analytics_timezone_invalid';
  end if;

  select coalesce(
    p_event_edition_id,
    (
      select edition.id
      from public.event_editions edition
      join public.event_series series on series.id = edition.event_series_id
      where series.organization_id = p_organization_id
      order by edition.start_date desc, edition.created_at desc
      limit 1
    )
  ) into selected_edition_id;

  if selected_edition_id is null or not exists (
    select 1
    from public.event_editions edition
    join public.event_series series on series.id = edition.event_series_id
    where edition.id = selected_edition_id and series.organization_id = p_organization_id
  ) then
    raise exception using errcode = '22023', message = 'analytics_scope_invalid';
  end if;
  if p_comparison_event_edition_id is not null and (
    p_comparison_event_edition_id = selected_edition_id
    or not exists (
      select 1
      from public.event_editions edition
      join public.event_series series on series.id = edition.event_series_id
      where edition.id = p_comparison_event_edition_id and series.organization_id = p_organization_id
    )
  ) then
    raise exception using errcode = '22023', message = 'analytics_comparison_scope_invalid';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', edition.id,
    'name', edition.name,
    'startDate', edition.start_date,
    'status', edition.status,
    'timezone', edition.timezone
  ) order by edition.start_date desc), '[]'::jsonb)
  into edition_options
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where series.organization_id = p_organization_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'metricCode', definition.metric_code,
    'versionNumber', definition.version_number,
    'area', definition.area,
    'title', definition.title,
    'description', definition.description,
    'unit', definition.unit,
    'calculation', definition.calculation,
    'sourceTables', definition.source_tables,
    'freshnessTargetSeconds', definition.freshness_target_seconds,
    'finalityRule', definition.finality_rule,
    'sensitivity', definition.sensitivity,
    'minimumGroupSize', definition.minimum_group_size
  ) order by definition.area, definition.metric_code), '[]'::jsonb)
  into definitions
  from public.analytics_metric_definitions definition
  where definition.metric_state = 'active';

  selected_metrics := public.service_build_edition_analytics(selected_edition_id);
  comparison_metrics := case
    when p_comparison_event_edition_id is null then null
    else public.service_build_edition_analytics(p_comparison_event_edition_id)
  end;

  result_json := jsonb_build_object(
    'organizationId', p_organization_id,
    'generatedAt', clock_timestamp(),
    'timezone', p_timezone,
    'freshness', jsonb_build_object(
      'asOf', clock_timestamp(),
      'secondsOld', 0,
      'targetSeconds', 60,
      'status', 'fresh'
    ),
    'scope', jsonb_build_object(
      'eventEditionId', selected_edition_id,
      'filters', '{}'::jsonb
    ),
    'editionOptions', edition_options,
    'metricDefinitions', definitions,
    'selectedEdition', selected_metrics,
    'comparisonEdition', comparison_metrics
  );

  return result_json;
end;
$$;
create or replace function public.service_filter_analytics_export_row(
  p_row jsonb,
  p_fields text[]
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(field_name, p_row -> field_name order by ordinal),
    '{}'::jsonb
  )
  from unnest(p_fields) with ordinality selected(field_name, ordinal)
$$;
create or replace function public.service_build_analytics_export_rows(
  p_organization_id uuid,
  p_event_edition_id uuid,
  p_dataset_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rows_json jsonb;
begin
  if p_event_edition_id is not null and not exists (
    select 1
    from public.event_editions edition
    join public.event_series series on series.id = edition.event_series_id
    where edition.id = p_event_edition_id and series.organization_id = p_organization_id
  ) then
    raise exception using errcode = '22023', message = 'analytics_scope_invalid';
  end if;

  if p_dataset_code = 'participants' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'registrationId', registration.id, 'athleteProfileId', registration.athlete_profile_id,
      'categoryId', category.id, 'categoryName', category.name, 'status', registration.status,
      'paymentStatus', registration.payment_status, 'participationStatus', registration.participation_status,
      'source', registration.source, 'registeredAt', registration.created_at, 'confirmedAt', registration.confirmed_at
    ) order by registration.created_at, registration.id), '[]'::jsonb) into rows_json
    from public.registrations registration
    join public.event_categories category on category.id = registration.event_category_id
    join public.event_editions edition on edition.id = category.event_edition_id
    join public.event_series series on series.id = edition.event_series_id
    where series.organization_id = p_organization_id
      and (p_event_edition_id is null or edition.id = p_event_edition_id);
  elsif p_dataset_code = 'form_answers' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'registrationId', answer.registration_id, 'fieldKey', answer.field_key,
      'fieldLabel', answer.field_label, 'value', answer.value_json, 'submittedAt', answer.created_at
    ) order by answer.created_at, answer.id), '[]'::jsonb) into rows_json
    from public.registration_answers answer
    join public.registrations registration on registration.id = answer.registration_id
    join public.event_categories category on category.id = registration.event_category_id
    join public.event_editions edition on edition.id = category.event_edition_id
    join public.event_series series on series.id = edition.event_series_id
    where series.organization_id = p_organization_id
      and (p_event_edition_id is null or edition.id = p_event_edition_id);
  elsif p_dataset_code = 'financial_ledger' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'ledgerEntryId', ledger.id, 'registrationId', ledger.registration_id,
      'entryType', ledger.entry_type, 'amountCents', ledger.amount_cents,
      'currency', trim(ledger.currency), 'externalReference', ledger.external_reference,
      'description', ledger.description, 'effectiveAt', ledger.effective_at
    ) order by ledger.effective_at, ledger.id), '[]'::jsonb) into rows_json
    from public.financial_ledger_entries ledger
    left join public.registrations registration on registration.id = ledger.registration_id
    left join public.event_categories category on category.id = registration.event_category_id
    where ledger.organization_id = p_organization_id
      and (p_event_edition_id is null or category.event_edition_id = p_event_edition_id);
  elsif p_dataset_code = 'refunds' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'refundId', refund.id, 'registrationId', refund.registration_id, 'status', refund.status,
      'amountCents', refund.amount_cents, 'currency', trim(refund.currency), 'reason', refund.reason,
      'requestedAt', refund.requested_at, 'completedAt', refund.completed_at
    ) order by refund.requested_at, refund.id), '[]'::jsonb) into rows_json
    from public.payment_refunds refund
    join public.registrations registration on registration.id = refund.registration_id
    join public.event_categories category on category.id = registration.event_category_id
    where refund.organization_id = p_organization_id
      and (p_event_edition_id is null or category.event_edition_id = p_event_edition_id);
  elsif p_dataset_code = 'bibs' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'registrationId', bib.registration_id, 'categoryId', bib.event_category_id,
      'bibNumber', bib.bib_number, 'assignedAt', bib.assigned_at, 'revokedAt', bib.revoked_at
    ) order by bib.assigned_at, bib.id), '[]'::jsonb) into rows_json
    from public.bib_assignments bib
    join public.event_editions edition on edition.id = bib.event_edition_id
    join public.event_series series on series.id = edition.event_series_id
    where series.organization_id = p_organization_id
      and (p_event_edition_id is null or bib.event_edition_id = p_event_edition_id);
  elsif p_dataset_code = 'checkins' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'registrationId', checkin.registration_id, 'checkedInAt', checkin.checked_in_at,
      'locationLabel', checkin.location_label, 'notes', checkin.notes
    ) order by checkin.checked_in_at, checkin.id), '[]'::jsonb) into rows_json
    from public.checkins checkin
    join public.registrations registration on registration.id = checkin.registration_id
    join public.event_categories category on category.id = registration.event_category_id
    join public.event_editions edition on edition.id = category.event_edition_id
    join public.event_series series on series.id = edition.event_series_id
    where series.organization_id = p_organization_id
      and (p_event_edition_id is null or edition.id = p_event_edition_id);
  elsif p_dataset_code = 'raw_timing' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'punchId', punch.id, 'categoryId', punch.event_category_id, 'checkpointId', punch.checkpoint_id,
      'registrationId', punch.registration_id, 'bibNumber', punch.bib_number,
      'recordedAt', punch.recorded_at, 'ingestedAt', punch.ingested_at,
      'isVoided', punch.is_voided, 'clientEventId', punch.client_event_id
    ) order by punch.recorded_at, punch.id), '[]'::jsonb) into rows_json
    from public.punch_events punch
    join public.event_categories category on category.id = punch.event_category_id
    join public.event_editions edition on edition.id = category.event_edition_id
    join public.event_series series on series.id = edition.event_series_id
    where series.organization_id = p_organization_id
      and (p_event_edition_id is null or edition.id = p_event_edition_id);
  elsif p_dataset_code = 'participant_statuses' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'statusId', status.id, 'registrationId', status.registration_id, 'status', status.status,
      'effectiveAt', status.effective_at, 'reason', status.reason, 'createdAt', status.created_at
    ) order by status.effective_at, status.id), '[]'::jsonb) into rows_json
    from public.participant_statuses status
    join public.registrations registration on registration.id = status.registration_id
    join public.event_categories category on category.id = registration.event_category_id
    join public.event_editions edition on edition.id = category.event_edition_id
    join public.event_series series on series.id = edition.event_series_id
    where series.organization_id = p_organization_id
      and (p_event_edition_id is null or edition.id = p_event_edition_id);
  elsif p_dataset_code = 'incidents' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'incidentId', incident.id, 'incidentCode', incident.incident_code,
      'categoryId', incident.event_category_id, 'registrationId', incident.registration_id,
      'type', incident.incident_type, 'severity', incident.severity, 'state', incident.incident_state,
      'title', incident.title, 'locationLabel', incident.location_label, 'effectiveAt', incident.effective_at,
      'acknowledgedAt', incident.acknowledged_at, 'resolvedAt', incident.resolved_at
    ) order by incident.effective_at, incident.id), '[]'::jsonb) into rows_json
    from public.safety_incidents incident
    join public.event_editions edition on edition.id = incident.event_edition_id
    join public.event_series series on series.id = edition.event_series_id
    where series.organization_id = p_organization_id
      and (p_event_edition_id is null or incident.event_edition_id = p_event_edition_id);
  elsif p_dataset_code in ('official_results', 'splits') then
    if p_dataset_code = 'official_results' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'publicationId', publication.id, 'publicationState', publication.publication_state,
        'publishedAt', publication.published_at, 'categoryId', publication.event_category_id,
        'resultRunId', publication.result_run_id, 'registrationId', result.registration_id,
        'athleteProfileId', result.athlete_profile_id, 'finishTimeMs', result.finish_time_ms,
        'rankOverall', result.rank_overall, 'rankGender', result.rank_gender,
        'rankAgeCategory', result.rank_age_category, 'resultStatus', result.result_status
      ) order by publication.published_at, result.rank_overall nulls last, result.id), '[]'::jsonb) into rows_json
      from (
        select distinct on (candidate.event_category_id) candidate.*
        from public.result_publications candidate
        where candidate.publication_state in ('official', 'corrected')
        order by candidate.event_category_id, candidate.published_at desc
      ) publication
      join public.event_categories category on category.id = publication.event_category_id
      join public.event_editions edition on edition.id = category.event_edition_id
      join public.event_series series on series.id = edition.event_series_id
      join public.result_rows result on result.result_run_id = publication.result_run_id
      where series.organization_id = p_organization_id
        and (p_event_edition_id is null or edition.id = p_event_edition_id);
    else
      select coalesce(jsonb_agg(jsonb_build_object(
        'publicationId', publication.id, 'resultRowId', split.result_row_id,
        'checkpointId', split.checkpoint_id, 'sequenceNumber', split.sequence_number,
        'elapsedTimeMs', split.elapsed_time_ms, 'splitTimeMs', split.split_time_ms,
        'rankAtCheckpoint', split.rank_at_checkpoint
      ) order by publication.published_at, split.result_row_id, split.sequence_number), '[]'::jsonb) into rows_json
      from (
        select distinct on (candidate.event_category_id) candidate.*
        from public.result_publications candidate
        where candidate.publication_state in ('official', 'corrected')
        order by candidate.event_category_id, candidate.published_at desc
      ) publication
      join public.event_categories category on category.id = publication.event_category_id
      join public.event_editions edition on edition.id = category.event_edition_id
      join public.event_series series on series.id = edition.event_series_id
      join public.result_rows result on result.result_run_id = publication.result_run_id
      join public.result_splits split on split.result_row_id = result.id
      where series.organization_id = p_organization_id
        and (p_event_edition_id is null or edition.id = p_event_edition_id);
    end if;
  elsif p_dataset_code = 'communication_delivery' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'campaignId', campaign.id, 'campaignName', campaign.name, 'registrationId', delivery.registration_id,
      'channel', delivery.channel, 'locale', delivery.locale, 'state', delivery.state,
      'attemptCount', delivery.attempt_count, 'sentAt', delivery.sent_at,
      'deliveredAt', delivery.delivered_at, 'failedAt', delivery.failed_at,
      'failureCode', delivery.failure_code
    ) order by delivery.created_at, delivery.id), '[]'::jsonb) into rows_json
    from public.communication_deliveries delivery
    join public.communication_campaigns campaign on campaign.id = delivery.campaign_id
    where campaign.organization_id = p_organization_id
      and (p_event_edition_id is null or campaign.event_edition_id = p_event_edition_id);
  elsif p_dataset_code = 'audit_log' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'auditId', audit.id, 'entityType', audit.entity_type, 'entityId', audit.entity_id,
      'action', audit.action, 'metadata', audit.metadata_json,
      'actorUserId', audit.actor_user_id, 'createdAt', audit.created_at
    ) order by audit.created_at, audit.id), '[]'::jsonb) into rows_json
    from public.audit_log audit
    where audit.organization_id = p_organization_id;
  elsif p_dataset_code = 'analytics_summary' then
    if p_event_edition_id is null then
      raise exception using errcode = '22023', message = 'analytics_export_edition_required';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'metricCode', definition.metric_code, 'metricVersion', definition.version_number,
      'value', case definition.metric_code
        when 'registration.total' then analytics #> '{registration,total}'
        when 'registration.conversion_rate' then analytics #> '{registration,conversionRate}'
        when 'registration.capacity_utilization' then analytics #> '{registration,capacityUtilization}'
        when 'checkin.completed' then analytics #> '{registration,checkedIn}'
        when 'timing.capture_count' then analytics #> '{timing,captures}'
        when 'timing.unknown_bibs' then analytics #> '{timing,unknownBibs}'
        when 'timing.average_sync_delay' then analytics #> '{timing,averageSyncDelaySeconds}'
        when 'race.finishers' then analytics #> '{race,finished}'
        when 'race.completion_rate' then analytics #> '{race,completionRate}'
        when 'safety.open_incidents' then analytics #> '{safety,openIncidents}'
        when 'safety.average_acknowledgement' then analytics #> '{safety,averageAcknowledgementMinutes}'
        when 'communications.delivery_rate' then analytics #> '{communications,deliveryRate}'
        when 'retention.returning_athletes' then analytics #> '{retention,returningAthletes}'
        when 'finance.gross' then analytics #> '{finance,currencies}'
        when 'finance.net' then analytics #> '{finance,currencies}'
        else 'null'::jsonb
      end,
      'unit', definition.unit,
      'scope', jsonb_build_object('eventEditionId', p_event_edition_id),
      'asOf', clock_timestamp(),
      'isFinal', analytics #> '{finality,isFinal}',
      'sourceReferences', analytics #> '{finality,publicationReferences}'
    ) order by definition.area, definition.metric_code), '[]'::jsonb) into rows_json
    from public.analytics_metric_definitions definition
    cross join lateral (
      select public.service_build_edition_analytics(p_event_edition_id) as analytics
    ) snapshot
    where definition.metric_state = 'active';
  else
    raise exception using errcode = '22023', message = 'analytics_export_dataset_invalid';
  end if;

  return coalesce(rows_json, '[]'::jsonb);
end;
$$;
create or replace function public.service_apply_analytics_export_filters(
  p_rows jsonb,
  p_filters jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  allowed_filter_keys constant text[] := array['status', 'categoryIds', 'areas', 'dateFrom', 'dateTo'];
  date_from_value timestamptz;
  date_to_value timestamptz;
  filtered_rows jsonb;
begin
  if coalesce(p_filters, '{}'::jsonb) = '{}'::jsonb then
    return p_rows;
  end if;
  if jsonb_typeof(p_filters) <> 'object'
     or exists (
       select 1
       from jsonb_object_keys(p_filters) filter_key
       where not filter_key = any(allowed_filter_keys)
     )
     or (
       p_filters ? 'status'
       and jsonb_typeof(p_filters->'status') <> 'array'
     )
     or (
       p_filters ? 'categoryIds'
       and jsonb_typeof(p_filters->'categoryIds') <> 'array'
     )
     or (
       p_filters ? 'areas'
       and jsonb_typeof(p_filters->'areas') <> 'array'
     ) then
    raise exception using errcode = '22023', message = 'analytics_export_filter_invalid';
  end if;

  begin
    date_from_value := case
      when nullif(p_filters->>'dateFrom', '') is null then null
      else (p_filters->>'dateFrom')::timestamptz
    end;
    date_to_value := case
      when nullif(p_filters->>'dateTo', '') is null then null
      else (p_filters->>'dateTo')::timestamptz
    end;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'analytics_export_filter_invalid';
  end;
  if date_from_value is not null and date_to_value is not null and date_from_value > date_to_value then
    raise exception using errcode = '22023', message = 'analytics_export_filter_invalid';
  end if;

  select coalesce(jsonb_agg(row_item.value order by row_item.ordinality), '[]'::jsonb)
  into filtered_rows
  from jsonb_array_elements(p_rows) with ordinality row_item(value, ordinality)
  cross join lateral (
    select coalesce(
      row_item.value->>'registeredAt',
      row_item.value->>'effectiveAt',
      row_item.value->>'createdAt',
      row_item.value->>'requestedAt',
      row_item.value->>'publishedAt',
      row_item.value->>'checkedInAt',
      row_item.value->>'recordedAt',
      row_item.value->>'sentAt',
      row_item.value->>'asOf'
    ) as row_timestamp
  ) timestamp_value
  where (
      not p_filters ? 'status'
      or coalesce(
        row_item.value->>'status',
        row_item.value->>'state',
        row_item.value->>'participationStatus',
        row_item.value->>'resultStatus'
      ) in (select jsonb_array_elements_text(p_filters->'status'))
    )
    and (
      not p_filters ? 'categoryIds'
      or row_item.value->>'categoryId' in (
        select jsonb_array_elements_text(p_filters->'categoryIds')
      )
    )
    and (
      not p_filters ? 'areas'
      or split_part(coalesce(row_item.value->>'metricCode', ''), '.', 1) in (
        select jsonb_array_elements_text(p_filters->'areas')
      )
    )
    and (
      date_from_value is null
      or (
        timestamp_value.row_timestamp is not null
        and timestamp_value.row_timestamp::timestamptz >= date_from_value
      )
    )
    and (
      date_to_value is null
      or (
        timestamp_value.row_timestamp is not null
        and timestamp_value.row_timestamp::timestamptz <= date_to_value
      )
    );

  return filtered_rows;
end;
$$;
create or replace function public.service_render_analytics_export(
  p_rows jsonb,
  p_fields text[],
  p_format text,
  p_metadata jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  filtered_rows jsonb;
  header_line text;
  data_lines text;
begin
  select coalesce(jsonb_agg(
    public.service_filter_analytics_export_row(item.value, p_fields)
    order by item.ordinality
  ), '[]'::jsonb)
  into filtered_rows
  from jsonb_array_elements(p_rows) with ordinality item(value, ordinality);

  if p_format = 'json' then
    return jsonb_build_object('metadata', p_metadata, 'rows', filtered_rows)::text;
  end if;

  select string_agg('"' || replace(field_name, '"', '""') || '"', ',' order by ordinal)
  into header_line
  from unnest(p_fields) with ordinality fields(field_name, ordinal);

  select string_agg(
    (
      select string_agg(
        '"' || replace(coalesce(row_item.value ->> field_name, ''), '"', '""') || '"',
        ',' order by field_ordinal
      )
      from unnest(p_fields) with ordinality fields(field_name, field_ordinal)
    ),
    E'\n' order by row_item.ordinality
  )
  into data_lines
  from jsonb_array_elements(filtered_rows) with ordinality row_item(value, ordinality);

  return '# SiTrail export metadata: ' || p_metadata::text || E'\n'
    || header_line
    || case when data_lines is null then '' else E'\n' || data_lines end
    || E'\n';
end;
$$;
create or replace function public.service_request_analytics_export(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_event_edition_id uuid,
  p_dataset_code text,
  p_export_format text,
  p_selected_fields text[],
  p_filters_json jsonb,
  p_timezone text,
  p_approval_request_id uuid,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dataset public.analytics_export_dataset_definitions%rowtype;
  job public.organizer_analytics_export_jobs%rowtype;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'analytics.export'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  select * into job
  from public.organizer_analytics_export_jobs
  where client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object('id', job.id, 'exportState', job.export_state, 'replayed', true);
  end if;

  select * into dataset
  from public.analytics_export_dataset_definitions
  where dataset_code = p_dataset_code and is_active;
  if not found
     or p_export_format not in ('csv', 'json')
     or coalesce(cardinality(p_selected_fields), 0) = 0
     or not p_selected_fields <@ dataset.available_fields
     or coalesce(jsonb_typeof(p_filters_json), 'object') <> 'object'
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception using errcode = '22023', message = 'analytics_export_input_invalid';
  end if;
  if p_event_edition_id is not null and not exists (
    select 1
    from public.event_editions edition
    join public.event_series series on series.id = edition.event_series_id
    where edition.id = p_event_edition_id and series.organization_id = p_organization_id
  ) then
    raise exception using errcode = '22023', message = 'analytics_scope_invalid';
  end if;

  if dataset.approval_required and not exists (
    select 1
    from public.approval_requests request
    where request.id = p_approval_request_id
      and request.organization_id = p_organization_id
      and request.request_state = 'executed'
      and request.subject_type = 'analytics.export'
      and request.payload_json ->> 'datasetCode' = p_dataset_code
      and (
        p_event_edition_id is null
        or request.payload_json ->> 'eventEditionId' = p_event_edition_id::text
      )
  ) then
    raise exception using errcode = '42501', message = 'analytics_export_approval_required';
  end if;

  insert into public.organizer_analytics_export_jobs (
    id, organization_id, event_edition_id, dataset_code, export_format,
    selected_fields, filters_json, timezone, contains_sensitive_data,
    approval_request_id, requested_by_user_id, client_event_id
  )
  values (
    gen_random_uuid(), p_organization_id, p_event_edition_id, p_dataset_code,
    p_export_format, p_selected_fields, coalesce(p_filters_json, '{}'::jsonb),
    p_timezone, dataset.sensitivity = 'restricted', p_approval_request_id,
    p_actor_user_id, p_client_event_id
  )
  returning * into job;

  insert into public.organizer_analytics_export_events (
    analytics_export_job_id, sequence_number, action_type, note,
    metadata_json, actor_user_id, client_event_id
  )
  values (
    job.id, 1, 'requested', 'Server-side analytical export queued.',
    jsonb_build_object(
      'datasetCode', p_dataset_code,
      'format', p_export_format,
      'selectedFields', p_selected_fields,
      'filters', coalesce(p_filters_json, '{}'::jsonb),
      'timezone', p_timezone,
      'approvalRequestId', p_approval_request_id
    ),
    p_actor_user_id, p_client_event_id
  );

  return jsonb_build_object(
    'id', job.id,
    'exportState', job.export_state,
    'datasetCode', job.dataset_code,
    'requestedAt', job.requested_at,
    'replayed', false
  );
end;
$$;
create or replace function public.service_generate_analytics_export(
  p_analytics_export_job_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.organizer_analytics_export_jobs%rowtype;
  dataset public.analytics_export_dataset_definitions%rowtype;
  rows_json jsonb;
  metadata_json jsonb;
  artifact text;
  row_total integer;
  next_sequence integer;
  generation_error_state text;
  generation_error_message text;
begin
  select * into job
  from public.organizer_analytics_export_jobs
  where id = p_analytics_export_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'analytics_export_not_found';
  end if;
  if job.export_state = 'ready' then
    return jsonb_build_object('id', job.id, 'exportState', job.export_state, 'replayed', true);
  end if;
  if job.export_state <> 'queued' then
    raise exception using errcode = '55000', message = 'analytics_export_not_queued';
  end if;
  if not public.service_user_has_organization_permission(
    job.organization_id, p_actor_user_id, 'analytics.export'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;

  select * into dataset
  from public.analytics_export_dataset_definitions
  where dataset_code = job.dataset_code;

  update public.organizer_analytics_export_jobs
  set export_state = 'processing', processing_started_at = clock_timestamp()
  where id = job.id;
  insert into public.organizer_analytics_export_events (
    analytics_export_job_id, sequence_number, action_type, note, metadata_json, actor_user_id
  )
  values (job.id, 2, 'processing', 'Server-side analytical export generation started.', '{}'::jsonb, p_actor_user_id);

  begin
    rows_json := public.service_build_analytics_export_rows(
      job.organization_id, job.event_edition_id, job.dataset_code
    );
    rows_json := public.service_apply_analytics_export_filters(rows_json, job.filters_json);
    row_total := jsonb_array_length(rows_json);
    metadata_json := jsonb_build_object(
      'schemaVersion', 1,
      'datasetCode', job.dataset_code,
      'metricCatalogVersion', 1,
      'organizationId', job.organization_id,
      'eventEditionId', job.event_edition_id,
      'selectedFields', job.selected_fields,
      'filters', job.filters_json,
      'timezone', job.timezone,
      'generatedAt', clock_timestamp(),
      'rowCount', row_total,
      'sensitivity', dataset.sensitivity,
      'isFinal', job.dataset_code in ('official_results', 'splits')
    );
    artifact := public.service_render_analytics_export(
      rows_json, job.selected_fields, job.export_format, metadata_json
    );

    update public.organizer_analytics_export_jobs
    set export_state = 'ready',
        ready_at = clock_timestamp(),
        expires_at = clock_timestamp() + make_interval(days => dataset.default_retention_days),
        row_count = row_total,
        object_reference = 'analytics-exports/' || job.organization_id::text || '/' || job.id::text || '.' || job.export_format,
        checksum_sha256 = encode(public.digest(convert_to(artifact, 'utf8'), 'sha256'), 'hex'),
        artifact_content = artifact
    where id = job.id
    returning * into job;

    insert into public.organizer_analytics_export_events (
      analytics_export_job_id, sequence_number, action_type, note, metadata_json, actor_user_id
    )
    values (
      job.id, 3, 'generated', 'Checksummed analytical export is ready.',
      jsonb_build_object(
        'rowCount', job.row_count,
        'checksumSha256', job.checksum_sha256,
        'expiresAt', job.expires_at,
        'objectReference', job.object_reference
      ),
      p_actor_user_id
    );
  exception
    when others then
      get stacked diagnostics
        generation_error_state = returned_sqlstate,
        generation_error_message = message_text;
      update public.organizer_analytics_export_jobs
      set export_state = 'failed',
          failure_code = generation_error_state || ':' || generation_error_message
      where id = job.id;
      select coalesce(max(event.sequence_number), 0) + 1 into next_sequence
      from public.organizer_analytics_export_events event
      where event.analytics_export_job_id = job.id;
      insert into public.organizer_analytics_export_events (
        analytics_export_job_id, sequence_number, action_type, note, metadata_json, actor_user_id
      )
      values (
        job.id, next_sequence, 'failed', 'Analytical export generation failed.',
        jsonb_build_object('sqlState', generation_error_state), p_actor_user_id
      );
      return jsonb_build_object(
        'id', job.id,
        'exportState', 'failed',
        'failureCode', generation_error_state,
        'replayed', false
      );
  end;

  return jsonb_build_object(
    'id', job.id,
    'exportState', job.export_state,
    'rowCount', job.row_count,
    'checksumSha256', job.checksum_sha256,
    'expiresAt', job.expires_at,
    'replayed', false
  );
end;
$$;
create or replace function public.service_record_analytics_export_download(
  p_analytics_export_job_id uuid,
  p_actor_user_id uuid,
  p_access_purpose text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.organizer_analytics_export_jobs%rowtype;
  next_sequence integer;
begin
  select * into job
  from public.organizer_analytics_export_jobs
  where id = p_analytics_export_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'analytics_export_not_found';
  end if;
  if not public.service_user_has_organization_permission(
    job.organization_id, p_actor_user_id, 'analytics.export'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if job.export_state = 'ready' and job.expires_at <= clock_timestamp() then
    update public.organizer_analytics_export_jobs
    set export_state = 'expired'
    where id = job.id;
    select coalesce(max(event.sequence_number), 0) + 1 into next_sequence
    from public.organizer_analytics_export_events event
    where event.analytics_export_job_id = job.id;
    insert into public.organizer_analytics_export_events (
      analytics_export_job_id, sequence_number, action_type, note, actor_user_id
    )
    values (job.id, next_sequence, 'expired', 'Analytical export expired before download.', p_actor_user_id);
    return jsonb_build_object('id', job.id, 'exportState', 'expired', 'replayed', false);
  end if;
  if job.export_state <> 'ready' then
    raise exception using errcode = '55000', message = 'analytics_export_not_downloadable';
  end if;
  if nullif(trim(p_access_purpose), '') is null then
    raise exception using errcode = '22023', message = 'analytics_export_download_purpose_required';
  end if;
  if exists (
    select 1 from public.organizer_analytics_export_events
    where client_event_id = p_client_event_id
  ) then
    return jsonb_build_object(
      'id', job.id, 'exportState', job.export_state,
      'checksumSha256', job.checksum_sha256, 'replayed', true
    );
  end if;
  select coalesce(max(event.sequence_number), 0) + 1 into next_sequence
  from public.organizer_analytics_export_events event
  where event.analytics_export_job_id = job.id;
  insert into public.organizer_analytics_export_events (
    analytics_export_job_id, sequence_number, action_type, note,
    metadata_json, actor_user_id, client_event_id
  )
  values (
    job.id, next_sequence, 'downloaded', trim(p_access_purpose),
    jsonb_build_object('checksumSha256', job.checksum_sha256), p_actor_user_id, p_client_event_id
  );
  return jsonb_build_object(
    'id', job.id, 'exportState', job.export_state,
    'checksumSha256', job.checksum_sha256, 'replayed', false
  );
end;
$$;
create or replace function public.service_revoke_analytics_export(
  p_analytics_export_job_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.organizer_analytics_export_jobs%rowtype;
  next_sequence integer;
begin
  select * into job
  from public.organizer_analytics_export_jobs
  where id = p_analytics_export_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'analytics_export_not_found';
  end if;
  if not public.service_user_has_organization_permission(
    job.organization_id, p_actor_user_id, 'analytics.export'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if job.export_state = 'revoked' then
    return jsonb_build_object('id', job.id, 'exportState', 'revoked', 'replayed', true);
  end if;
  if job.export_state <> 'ready' or nullif(trim(p_reason), '') is null then
    raise exception using errcode = '55000', message = 'analytics_export_revocation_invalid';
  end if;
  update public.organizer_analytics_export_jobs
  set export_state = 'revoked', revoked_at = clock_timestamp(),
      revoked_by_user_id = p_actor_user_id, revocation_reason = trim(p_reason)
  where id = job.id;
  select coalesce(max(event.sequence_number), 0) + 1 into next_sequence
  from public.organizer_analytics_export_events event
  where event.analytics_export_job_id = job.id;
  insert into public.organizer_analytics_export_events (
    analytics_export_job_id, sequence_number, action_type, note, actor_user_id, client_event_id
  )
  values (job.id, next_sequence, 'revoked', trim(p_reason), p_actor_user_id, p_client_event_id);
  return jsonb_build_object('id', job.id, 'exportState', 'revoked', 'replayed', false);
end;
$$;
alter table public.analytics_metric_definitions enable row level security;
alter table public.analytics_export_dataset_definitions enable row level security;
alter table public.organizer_saved_analytics_views enable row level security;
alter table public.organizer_analytics_export_jobs enable row level security;
alter table public.organizer_analytics_export_events enable row level security;
revoke all on table public.analytics_metric_definitions from public, anon, authenticated;
revoke all on table public.analytics_export_dataset_definitions from public, anon, authenticated;
revoke all on table public.organizer_saved_analytics_views from public, anon, authenticated;
revoke all on table public.organizer_analytics_export_jobs from public, anon, authenticated;
revoke all on table public.organizer_analytics_export_events from public, anon, authenticated;
grant all on table public.analytics_metric_definitions to service_role;
grant all on table public.analytics_export_dataset_definitions to service_role;
grant all on table public.organizer_saved_analytics_views to service_role;
grant all on table public.organizer_analytics_export_jobs to service_role;
grant all on table public.organizer_analytics_export_events to service_role;
revoke all on function public.service_save_analytics_view(uuid,uuid,uuid,text,uuid,uuid,text,jsonb,boolean,uuid) from public, anon, authenticated;
revoke all on function public.service_build_edition_analytics(uuid) from public, anon, authenticated;
revoke all on function public.service_get_organization_analytics(uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.service_filter_analytics_export_row(jsonb,text[]) from public, anon, authenticated;
revoke all on function public.service_build_analytics_export_rows(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.service_apply_analytics_export_filters(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.service_render_analytics_export(jsonb,text[],text,jsonb) from public, anon, authenticated;
revoke all on function public.service_request_analytics_export(uuid,uuid,uuid,text,text,text[],jsonb,text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.service_generate_analytics_export(uuid,uuid) from public, anon, authenticated;
revoke all on function public.service_record_analytics_export_download(uuid,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.service_revoke_analytics_export(uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.service_save_analytics_view(uuid,uuid,uuid,text,uuid,uuid,text,jsonb,boolean,uuid) to service_role;
grant execute on function public.service_build_edition_analytics(uuid) to service_role;
grant execute on function public.service_get_organization_analytics(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.service_filter_analytics_export_row(jsonb,text[]) to service_role;
grant execute on function public.service_build_analytics_export_rows(uuid,uuid,text) to service_role;
grant execute on function public.service_apply_analytics_export_filters(jsonb,jsonb) to service_role;
grant execute on function public.service_render_analytics_export(jsonb,text[],text,jsonb) to service_role;
grant execute on function public.service_request_analytics_export(uuid,uuid,uuid,text,text,text[],jsonb,text,uuid,uuid) to service_role;
grant execute on function public.service_generate_analytics_export(uuid,uuid) to service_role;
grant execute on function public.service_record_analytics_export_download(uuid,uuid,text,uuid) to service_role;
grant execute on function public.service_revoke_analytics_export(uuid,uuid,text,uuid) to service_role;
