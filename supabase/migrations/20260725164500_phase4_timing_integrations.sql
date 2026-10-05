/*
 * Premium timing fleet and provider integration control.
 *
 * Canonical timing observations remain punch_events. These tables own device
 * identity, event-scoped assignment, provider health, and replay-safe staging
 * evidence before an external observation is accepted into the sporting record.
 */

alter table public.timing_devices
  add column device_type text not null default 'browser_workstation',
  add column external_identity text,
  add column software_version text,
  add column sync_state text not null default 'unknown',
  add column pending_event_count integer not null default 0,
  add column last_sync_at timestamptz,
  add column credential_state text not null default 'unprovisioned',
  add column credential_expires_at timestamptz;

alter table public.timing_devices
  add constraint timing_devices_type_check check (
    device_type in (
      'browser_workstation',
      'phone',
      'tablet',
      'chip_reader',
      'rfid_mat',
      'barcode_scanner',
      'gps_gateway',
      'import_source',
      'partner_system'
    )
  ),
  add constraint timing_devices_sync_state_check check (
    sync_state in ('unknown', 'synced', 'pending', 'degraded', 'offline', 'error')
  ),
  add constraint timing_devices_pending_event_count_check check (pending_event_count >= 0),
  add constraint timing_devices_credential_state_check check (
    credential_state in ('unprovisioned', 'active', 'rotating', 'revoked', 'expired')
  );

create unique index timing_devices_org_external_identity_unique
  on public.timing_devices (organization_id, external_identity)
  where external_identity is not null;

create table public.timing_device_assignments (
  id uuid primary key default gen_random_uuid(),
  timing_device_id uuid not null references public.timing_devices (id),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  event_category_id uuid references public.event_categories (id),
  checkpoint_id uuid references public.checkpoints (id),
  assignment_state text not null default 'active',
  allowed_event_types text[] not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  manifest_version integer,
  created_by_user_id uuid,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (assignment_state in ('planned', 'active', 'suspended', 'revoked', 'expired')),
  check (cardinality(allowed_event_types) > 0),
  check (valid_until > valid_from),
  check (manifest_version is null or manifest_version > 0)
);

create index timing_device_assignments_edition_state_idx
  on public.timing_device_assignments (event_edition_id, assignment_state, valid_from, valid_until);

create index timing_device_assignments_device_state_idx
  on public.timing_device_assignments (timing_device_id, assignment_state, valid_from, valid_until);

create table public.timing_device_events (
  id uuid primary key default gen_random_uuid(),
  timing_device_id uuid not null references public.timing_devices (id),
  timing_device_assignment_id uuid references public.timing_device_assignments (id),
  sequence_number integer not null,
  action_type text not null,
  note text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (timing_device_id, sequence_number),
  check (
    action_type in (
      'registered',
      'health',
      'heartbeat',
      'sync',
      'maintenance',
      'activate',
      'assignment_created',
      'assignment_suspended',
      'assignment_resumed',
      'assignment_revoked',
      'credential_rotated',
      'credential_revoked',
      'note'
    )
  ),
  check (length(trim(note)) > 0),
  check (jsonb_typeof(payload_json) = 'object')
);

create index timing_device_events_device_sequence_idx
  on public.timing_device_events (timing_device_id, sequence_number desc);

create table public.timing_provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider_type text not null,
  provider_key text not null,
  label text not null,
  connection_state text not null default 'configured',
  config_json jsonb not null default '{}'::jsonb,
  credential_reference text,
  secret_version integer not null default 1,
  webhook_key_id text,
  last_health_at timestamptz,
  health_state text not null default 'unknown',
  last_error text,
  created_by_user_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, provider_key),
  check (provider_type in ('chip_timing', 'gps_tracking', 'file_import', 'partner_api')),
  check (length(trim(provider_key)) > 0),
  check (length(trim(label)) > 0),
  check (connection_state in ('configured', 'active', 'degraded', 'disabled')),
  check (jsonb_typeof(config_json) = 'object'),
  check (secret_version > 0),
  check (health_state in ('unknown', 'healthy', 'degraded', 'offline', 'error'))
);

create index timing_provider_connections_org_state_idx
  on public.timing_provider_connections (organization_id, connection_state, provider_type);

create table public.timing_provider_connection_events (
  id uuid primary key default gen_random_uuid(),
  timing_provider_connection_id uuid not null references public.timing_provider_connections (id),
  sequence_number integer not null,
  action_type text not null,
  note text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (timing_provider_connection_id, sequence_number),
  check (action_type in ('configured', 'activated', 'degraded', 'disabled', 'health', 'credential_rotated', 'note')),
  check (length(trim(note)) > 0),
  check (jsonb_typeof(payload_json) = 'object')
);

create table public.timing_ingestion_batches (
  id uuid primary key default gen_random_uuid(),
  timing_provider_connection_id uuid not null references public.timing_provider_connections (id),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  source_batch_id text not null,
  batch_state text not null default 'received',
  signature_state text not null,
  raw_evidence_reference text not null,
  declared_event_count integer,
  received_event_count integer not null default 0,
  accepted_event_count integer not null default 0,
  rejected_event_count integer not null default 0,
  conflicted_event_count integer not null default 0,
  error_summary_json jsonb not null default '[]'::jsonb,
  idempotency_key uuid not null,
  received_at timestamptz not null default clock_timestamp(),
  reconciled_at timestamptz,
  created_by_user_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (timing_provider_connection_id, source_batch_id),
  unique (timing_provider_connection_id, idempotency_key),
  check (batch_state in ('received', 'processing', 'reconciled', 'failed', 'quarantined')),
  check (signature_state in ('valid', 'invalid', 'not_applicable')),
  check (length(trim(source_batch_id)) > 0),
  check (length(trim(raw_evidence_reference)) > 0),
  check (declared_event_count is null or declared_event_count >= 0),
  check (least(received_event_count, accepted_event_count, rejected_event_count, conflicted_event_count) >= 0),
  check (jsonb_typeof(error_summary_json) = 'array')
);

create index timing_ingestion_batches_edition_state_idx
  on public.timing_ingestion_batches (event_edition_id, batch_state, received_at desc);

create table public.external_timing_events (
  id uuid primary key default gen_random_uuid(),
  timing_ingestion_batch_id uuid not null references public.timing_ingestion_batches (id),
  timing_provider_connection_id uuid not null references public.timing_provider_connections (id),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  event_category_id uuid references public.event_categories (id),
  checkpoint_id uuid references public.checkpoints (id),
  timing_device_id uuid references public.timing_devices (id),
  source_event_id text not null,
  event_type text not null,
  observed_at timestamptz not null,
  signature_state text not null,
  processing_state text not null default 'received',
  raw_evidence_reference text not null,
  payload_json jsonb not null,
  error_code text,
  client_event_id uuid not null unique,
  ingested_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  unique (timing_provider_connection_id, source_event_id),
  check (event_type in ('chip_read', 'checkpoint_read', 'finish_read', 'gps_position', 'device_status', 'heartbeat', 'file_row')),
  check (signature_state in ('valid', 'invalid', 'not_applicable')),
  check (processing_state in ('received', 'accepted', 'rejected', 'duplicate', 'conflicted')),
  check (length(trim(source_event_id)) > 0),
  check (length(trim(raw_evidence_reference)) > 0),
  check (jsonb_typeof(payload_json) = 'object')
);

create index external_timing_events_batch_state_idx
  on public.external_timing_events (timing_ingestion_batch_id, processing_state, ingested_at);

create index external_timing_events_edition_observed_idx
  on public.external_timing_events (event_edition_id, observed_at desc);

create or replace function public.prevent_timing_integration_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'timing_integration_evidence_is_append_only';
end;
$$;

create trigger timing_device_events_append_only
before update or delete on public.timing_device_events
for each row execute function public.prevent_timing_integration_evidence_mutation();

create trigger timing_provider_connection_events_append_only
before update or delete on public.timing_provider_connection_events
for each row execute function public.prevent_timing_integration_evidence_mutation();

create trigger external_timing_events_append_only
before update or delete on public.external_timing_events
for each row execute function public.prevent_timing_integration_evidence_mutation();

create or replace function public.service_register_timing_fleet_device(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_device_fingerprint text,
  p_device_label text,
  p_device_type text,
  p_external_identity text,
  p_status text,
  p_sync_state text,
  p_clock_offset_ms integer,
  p_battery_percent integer,
  p_firmware_version text,
  p_software_version text,
  p_credential_state text,
  p_credential_expires_at timestamptz,
  p_health_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_device public.timing_devices%rowtype;
  existing_event public.timing_device_events%rowtype;
  next_sequence integer;
begin
  if p_organization_id is null
     or p_actor_user_id is null
     or nullif(trim(p_device_fingerprint), '') is null
     or length(trim(p_device_fingerprint)) > 200
     or nullif(trim(p_device_label), '') is null
     or p_device_type not in (
       'browser_workstation', 'phone', 'tablet', 'chip_reader', 'rfid_mat',
       'barcode_scanner', 'gps_gateway', 'import_source', 'partner_system'
     )
     or p_status not in ('active', 'maintenance', 'retired')
     or p_sync_state not in ('unknown', 'synced', 'pending', 'degraded', 'offline', 'error')
     or p_credential_state not in ('unprovisioned', 'active', 'rotating', 'revoked', 'expired')
     or (p_battery_percent is not null and (p_battery_percent < 0 or p_battery_percent > 100))
     or coalesce(jsonb_typeof(p_health_json), 'object') <> 'object'
     or p_client_event_id is null then
    raise exception using errcode = '22023', message = 'timing_fleet_device_input_invalid';
  end if;

  select event.*
  into existing_event
  from public.timing_device_events event
  where event.client_event_id = p_client_event_id;
  if found then
    select device.*
    into saved_device
    from public.timing_devices device
    where device.id = existing_event.timing_device_id;
    if saved_device.organization_id <> p_organization_id
       or saved_device.device_fingerprint <> trim(p_device_fingerprint) then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', saved_device.id,
      'label', saved_device.device_label,
      'deviceType', saved_device.device_type,
      'syncState', saved_device.sync_state,
      'replayed', true
    );
  end if;

  insert into public.timing_devices (
    organization_id,
    device_label,
    device_fingerprint,
    device_type,
    external_identity,
    status,
    sync_state,
    clock_offset_ms,
    clock_checked_at,
    battery_percent,
    firmware_version,
    software_version,
    credential_state,
    credential_expires_at,
    health_json,
    last_seen_at,
    last_sync_at
  )
  values (
    p_organization_id,
    trim(p_device_label),
    trim(p_device_fingerprint),
    p_device_type,
    nullif(trim(p_external_identity), ''),
    p_status,
    p_sync_state,
    p_clock_offset_ms,
    case when p_clock_offset_ms is null then null else clock_timestamp() end,
    p_battery_percent,
    nullif(trim(p_firmware_version), ''),
    nullif(trim(p_software_version), ''),
    p_credential_state,
    p_credential_expires_at,
    coalesce(p_health_json, '{}'::jsonb),
    clock_timestamp(),
    case when p_sync_state = 'synced' then clock_timestamp() else null end
  )
  on conflict (device_fingerprint)
  do update set
    device_label = excluded.device_label,
    device_type = excluded.device_type,
    external_identity = excluded.external_identity,
    status = excluded.status,
    sync_state = excluded.sync_state,
    clock_offset_ms = excluded.clock_offset_ms,
    clock_checked_at = excluded.clock_checked_at,
    battery_percent = excluded.battery_percent,
    firmware_version = excluded.firmware_version,
    software_version = excluded.software_version,
    credential_state = excluded.credential_state,
    credential_expires_at = excluded.credential_expires_at,
    health_json = excluded.health_json,
    last_seen_at = excluded.last_seen_at,
    last_sync_at = coalesce(excluded.last_sync_at, public.timing_devices.last_sync_at),
    updated_at = clock_timestamp()
  where public.timing_devices.organization_id = excluded.organization_id
  returning * into saved_device;

  if saved_device.id is null then
    raise exception using errcode = '23505', message = 'timing_device_owned_by_other_organization';
  end if;

  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.timing_device_events event
  where event.timing_device_id = saved_device.id;

  insert into public.timing_device_events (
    timing_device_id,
    sequence_number,
    action_type,
    note,
    payload_json,
    created_by_user_id,
    client_event_id
  )
  values (
    saved_device.id,
    next_sequence,
    'registered',
    'Fleet device profile and health registered.',
    jsonb_build_object(
      'deviceType', saved_device.device_type,
      'status', saved_device.status,
      'syncState', saved_device.sync_state,
      'clockOffsetMs', saved_device.clock_offset_ms,
      'batteryPercent', saved_device.battery_percent,
      'credentialState', saved_device.credential_state
    ),
    p_actor_user_id,
    p_client_event_id
  );

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'timing_device',
    saved_device.id,
    'timing_device.fleet_registered',
    jsonb_build_object('deviceType', saved_device.device_type, 'syncState', saved_device.sync_state)
  );

  return jsonb_build_object(
    'id', saved_device.id,
    'label', saved_device.device_label,
    'deviceType', saved_device.device_type,
    'syncState', saved_device.sync_state,
    'credentialState', saved_device.credential_state,
    'replayed', false
  );
end;
$$;

create or replace function public.service_create_timing_device_assignment(
  p_event_edition_id uuid,
  p_timing_device_id uuid,
  p_event_category_id uuid,
  p_checkpoint_id uuid,
  p_allowed_event_types text[],
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_manifest_version integer,
  p_actor_user_id uuid,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_organization_id uuid;
  device_row public.timing_devices%rowtype;
  created_assignment public.timing_device_assignments%rowtype;
  existing_assignment public.timing_device_assignments%rowtype;
  next_sequence integer;
begin
  if p_event_edition_id is null
     or p_timing_device_id is null
     or p_actor_user_id is null
     or p_client_event_id is null
     or p_valid_from is null
     or p_valid_until is null
     or p_valid_until <= p_valid_from
     or cardinality(p_allowed_event_types) is null
     or cardinality(p_allowed_event_types) = 0
     or exists (
       select 1
       from unnest(p_allowed_event_types) event_type
       where event_type not in (
         'chip_read', 'checkpoint_read', 'finish_read', 'gps_position',
         'device_status', 'heartbeat', 'file_row'
       )
     ) then
    raise exception using errcode = '22023', message = 'timing_device_assignment_input_invalid';
  end if;

  select assignment.*
  into existing_assignment
  from public.timing_device_assignments assignment
  where assignment.client_event_id = p_client_event_id;
  if found then
    if existing_assignment.event_edition_id <> p_event_edition_id
       or existing_assignment.timing_device_id <> p_timing_device_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_assignment.id,
      'assignmentState', existing_assignment.assignment_state,
      'replayed', true
    );
  end if;

  select series.organization_id
  into resolved_organization_id
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = p_event_edition_id;
  if resolved_organization_id is null then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  select device.*
  into device_row
  from public.timing_devices device
  where device.id = p_timing_device_id
    and device.organization_id = resolved_organization_id
    and device.status = 'active';
  if not found then
    raise exception using errcode = '22023', message = 'timing_device_assignment_scope_invalid';
  end if;

  if p_event_category_id is not null and not exists (
    select 1
    from public.event_categories category
    where category.id = p_event_category_id
      and category.event_edition_id = p_event_edition_id
  ) then
    raise exception using errcode = '22023', message = 'timing_device_assignment_scope_invalid';
  end if;
  if p_checkpoint_id is not null and not exists (
    select 1
    from public.checkpoints checkpoint
    join public.event_categories category on category.id = checkpoint.event_category_id
    where checkpoint.id = p_checkpoint_id
      and category.event_edition_id = p_event_edition_id
      and (p_event_category_id is null or category.id = p_event_category_id)
  ) then
    raise exception using errcode = '22023', message = 'timing_device_assignment_scope_invalid';
  end if;

  if exists (
    select 1
    from public.timing_device_assignments assignment
    where assignment.timing_device_id = p_timing_device_id
      and assignment.assignment_state in ('planned', 'active')
      and tstzrange(assignment.valid_from, assignment.valid_until, '[)')
          && tstzrange(p_valid_from, p_valid_until, '[)')
  ) then
    raise exception using errcode = 'P0001', message = 'timing_device_assignment_window_conflict';
  end if;

  insert into public.timing_device_assignments (
    timing_device_id,
    event_edition_id,
    event_category_id,
    checkpoint_id,
    assignment_state,
    allowed_event_types,
    valid_from,
    valid_until,
    manifest_version,
    created_by_user_id,
    client_event_id
  )
  values (
    p_timing_device_id,
    p_event_edition_id,
    p_event_category_id,
    p_checkpoint_id,
    'active',
    p_allowed_event_types,
    p_valid_from,
    p_valid_until,
    p_manifest_version,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_assignment;

  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.timing_device_events event
  where event.timing_device_id = p_timing_device_id;

  insert into public.timing_device_events (
    timing_device_id,
    timing_device_assignment_id,
    sequence_number,
    action_type,
    note,
    payload_json,
    created_by_user_id,
    client_event_id
  )
  values (
    p_timing_device_id,
    created_assignment.id,
    next_sequence,
    'assignment_created',
    'Event-scoped timing device assignment created.',
    jsonb_build_object(
      'eventEditionId', p_event_edition_id,
      'eventCategoryId', p_event_category_id,
      'checkpointId', p_checkpoint_id,
      'validFrom', p_valid_from,
      'validUntil', p_valid_until,
      'manifestVersion', p_manifest_version,
      'allowedEventTypes', p_allowed_event_types
    ),
    p_actor_user_id,
    gen_random_uuid()
  );

  return jsonb_build_object(
    'id', created_assignment.id,
    'assignmentState', created_assignment.assignment_state,
    'replayed', false
  );
end;
$$;

create or replace function public.service_update_timing_device_assignment(
  p_timing_device_assignment_id uuid,
  p_actor_user_id uuid,
  p_assignment_state text,
  p_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment_row public.timing_device_assignments%rowtype;
  existing_event public.timing_device_events%rowtype;
  next_sequence integer;
  action_type_value text;
begin
  if p_assignment_state not in ('active', 'suspended', 'revoked', 'expired')
     or nullif(trim(p_note), '') is null
     or p_actor_user_id is null
     or p_client_event_id is null then
    raise exception using errcode = '22023', message = 'timing_device_assignment_event_input_invalid';
  end if;

  select event.*
  into existing_event
  from public.timing_device_events event
  where event.client_event_id = p_client_event_id;
  if found then
    if existing_event.timing_device_assignment_id <> p_timing_device_assignment_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', p_timing_device_assignment_id,
      'assignmentState', p_assignment_state,
      'replayed', true
    );
  end if;

  select assignment.*
  into assignment_row
  from public.timing_device_assignments assignment
  where assignment.id = p_timing_device_assignment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'timing_device_assignment_not_found';
  end if;

  if assignment_row.assignment_state in ('revoked', 'expired')
     or (
       assignment_row.assignment_state = 'suspended'
       and p_assignment_state not in ('active', 'revoked', 'expired')
     )
     or (
       assignment_row.assignment_state in ('planned', 'active')
       and p_assignment_state not in ('active', 'suspended', 'revoked', 'expired')
     ) then
    raise exception using errcode = 'P0001', message = 'timing_device_assignment_transition_invalid';
  end if;

  action_type_value := case p_assignment_state
    when 'active' then 'assignment_resumed'
    when 'suspended' then 'assignment_suspended'
    else 'assignment_revoked'
  end;

  update public.timing_device_assignments
  set assignment_state = p_assignment_state, updated_at = clock_timestamp()
  where id = assignment_row.id
  returning * into assignment_row;

  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.timing_device_events event
  where event.timing_device_id = assignment_row.timing_device_id;

  insert into public.timing_device_events (
    timing_device_id,
    timing_device_assignment_id,
    sequence_number,
    action_type,
    note,
    payload_json,
    created_by_user_id,
    client_event_id
  )
  values (
    assignment_row.timing_device_id,
    assignment_row.id,
    next_sequence,
    action_type_value,
    trim(p_note),
    jsonb_build_object('assignmentState', p_assignment_state),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'id', assignment_row.id,
    'assignmentState', assignment_row.assignment_state,
    'replayed', false
  );
end;
$$;

create or replace function public.service_append_timing_device_event(
  p_timing_device_id uuid,
  p_actor_user_id uuid,
  p_action_type text,
  p_note text,
  p_payload_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_row public.timing_devices%rowtype;
  existing_event public.timing_device_events%rowtype;
  created_event public.timing_device_events%rowtype;
  next_sequence integer;
begin
  if p_action_type not in (
       'health', 'heartbeat', 'sync', 'maintenance', 'activate',
       'credential_rotated', 'credential_revoked', 'note'
     )
     or nullif(trim(p_note), '') is null
     or coalesce(jsonb_typeof(p_payload_json), 'object') <> 'object'
     or p_client_event_id is null then
    raise exception using errcode = '22023', message = 'timing_device_event_input_invalid';
  end if;

  select event.*
  into existing_event
  from public.timing_device_events event
  where event.client_event_id = p_client_event_id;
  if found then
    if existing_event.timing_device_id <> p_timing_device_id
       or existing_event.action_type <> p_action_type then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object('id', existing_event.id, 'sequenceNumber', existing_event.sequence_number, 'replayed', true);
  end if;

  select device.*
  into device_row
  from public.timing_devices device
  where device.id = p_timing_device_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'timing_device_not_found';
  end if;

  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.timing_device_events event
  where event.timing_device_id = p_timing_device_id;

  insert into public.timing_device_events (
    timing_device_id,
    sequence_number,
    action_type,
    note,
    payload_json,
    created_by_user_id,
    client_event_id
  )
  values (
    p_timing_device_id,
    next_sequence,
    p_action_type,
    trim(p_note),
    coalesce(p_payload_json, '{}'::jsonb),
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_event;

  update public.timing_devices
  set
    status = case
      when p_action_type = 'maintenance' then 'maintenance'
      when p_action_type = 'activate' then 'active'
      else status
    end,
    sync_state = case
      when p_action_type = 'sync' then coalesce(nullif(p_payload_json->>'syncState', ''), sync_state)
      when p_action_type = 'heartbeat' then coalesce(nullif(p_payload_json->>'syncState', ''), sync_state)
      else sync_state
    end,
    pending_event_count = case
      when p_action_type in ('sync', 'heartbeat')
        then greatest(coalesce((p_payload_json->>'pendingEventCount')::integer, pending_event_count), 0)
      else pending_event_count
    end,
    last_sync_at = case
      when p_action_type = 'sync' and coalesce(p_payload_json->>'syncState', '') = 'synced'
        then clock_timestamp()
      else last_sync_at
    end,
    last_seen_at = case when p_action_type in ('heartbeat', 'sync', 'health') then clock_timestamp() else last_seen_at end,
    credential_state = case
      when p_action_type = 'credential_rotated' then 'active'
      when p_action_type = 'credential_revoked' then 'revoked'
      else credential_state
    end,
    credential_expires_at = case
      when p_action_type = 'credential_rotated'
        and nullif(p_payload_json->>'credentialExpiresAt', '') is not null
        then (p_payload_json->>'credentialExpiresAt')::timestamptz
      else credential_expires_at
    end,
    clock_offset_ms = case
      when p_action_type in ('health', 'heartbeat')
        and nullif(p_payload_json->>'clockOffsetMs', '') is not null
        then (p_payload_json->>'clockOffsetMs')::integer
      else clock_offset_ms
    end,
    clock_checked_at = case
      when p_action_type in ('health', 'heartbeat')
        and nullif(p_payload_json->>'clockOffsetMs', '') is not null
        then clock_timestamp()
      else clock_checked_at
    end,
    battery_percent = case
      when p_action_type in ('health', 'heartbeat')
        and nullif(p_payload_json->>'batteryPercent', '') is not null
        then (p_payload_json->>'batteryPercent')::integer
      else battery_percent
    end,
    health_json = case
      when p_action_type in ('health', 'heartbeat') then health_json || p_payload_json
      else health_json
    end,
    updated_at = clock_timestamp()
  where id = p_timing_device_id;

  return jsonb_build_object('id', created_event.id, 'sequenceNumber', created_event.sequence_number, 'replayed', false);
exception
  when invalid_text_representation or datetime_field_overflow or check_violation then
    raise exception using errcode = '22023', message = 'timing_device_event_payload_invalid';
end;
$$;

create or replace function public.service_save_timing_provider_connection(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_provider_type text,
  p_provider_key text,
  p_label text,
  p_connection_state text,
  p_config_json jsonb,
  p_credential_reference text,
  p_secret_version integer,
  p_webhook_key_id text,
  p_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_row public.timing_provider_connections%rowtype;
  existing_event public.timing_provider_connection_events%rowtype;
  next_sequence integer;
  action_type_value text;
begin
  if p_organization_id is null
     or p_actor_user_id is null
     or p_provider_type not in ('chip_timing', 'gps_tracking', 'file_import', 'partner_api')
     or nullif(trim(p_provider_key), '') is null
     or nullif(trim(p_label), '') is null
     or p_connection_state not in ('configured', 'active', 'degraded', 'disabled')
     or coalesce(jsonb_typeof(p_config_json), 'object') <> 'object'
     or p_config_json::text ~* '"[^"]*(secret|token|password|api[_-]?key)[^"]*"[[:space:]]*:'
     or nullif(trim(p_credential_reference), '') is null
     or p_secret_version is null
     or p_secret_version <= 0
     or nullif(trim(p_note), '') is null
     or p_client_event_id is null then
    raise exception using errcode = '22023', message = 'timing_provider_connection_input_invalid';
  end if;

  select event.*
  into existing_event
  from public.timing_provider_connection_events event
  where event.client_event_id = p_client_event_id;
  if found then
    select connection.*
    into connection_row
    from public.timing_provider_connections connection
    where connection.id = existing_event.timing_provider_connection_id;
    if connection_row.organization_id <> p_organization_id
       or connection_row.provider_key <> trim(p_provider_key) then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', connection_row.id,
      'connectionState', connection_row.connection_state,
      'replayed', true
    );
  end if;

  insert into public.timing_provider_connections (
    organization_id,
    provider_type,
    provider_key,
    label,
    connection_state,
    config_json,
    credential_reference,
    secret_version,
    webhook_key_id,
    created_by_user_id
  )
  values (
    p_organization_id,
    p_provider_type,
    trim(p_provider_key),
    trim(p_label),
    p_connection_state,
    coalesce(p_config_json, '{}'::jsonb),
    trim(p_credential_reference),
    p_secret_version,
    nullif(trim(p_webhook_key_id), ''),
    p_actor_user_id
  )
  on conflict (organization_id, provider_key)
  do update set
    provider_type = excluded.provider_type,
    label = excluded.label,
    connection_state = excluded.connection_state,
    config_json = excluded.config_json,
    credential_reference = excluded.credential_reference,
    secret_version = excluded.secret_version,
    webhook_key_id = excluded.webhook_key_id,
    updated_at = clock_timestamp()
  returning * into connection_row;

  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.timing_provider_connection_events event
  where event.timing_provider_connection_id = connection_row.id;

  action_type_value := case p_connection_state
    when 'active' then 'activated'
    when 'degraded' then 'degraded'
    when 'disabled' then 'disabled'
    else 'configured'
  end;

  insert into public.timing_provider_connection_events (
    timing_provider_connection_id,
    sequence_number,
    action_type,
    note,
    payload_json,
    created_by_user_id,
    client_event_id
  )
  values (
    connection_row.id,
    next_sequence,
    action_type_value,
    trim(p_note),
    jsonb_build_object(
      'connectionState', connection_row.connection_state,
      'secretVersion', connection_row.secret_version,
      'webhookKeyId', connection_row.webhook_key_id
    ),
    p_actor_user_id,
    p_client_event_id
  );

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'timing_provider_connection',
    connection_row.id,
    'timing_provider_connection.saved',
    jsonb_build_object('providerType', p_provider_type, 'connectionState', p_connection_state)
  );

  return jsonb_build_object(
    'id', connection_row.id,
    'connectionState', connection_row.connection_state,
    'secretVersion', connection_row.secret_version,
    'replayed', false
  );
end;
$$;

create or replace function public.service_stage_timing_ingestion_batch(
  p_timing_provider_connection_id uuid,
  p_event_edition_id uuid,
  p_source_batch_id text,
  p_signature_state text,
  p_raw_evidence_reference text,
  p_declared_event_count integer,
  p_idempotency_key uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_row public.timing_provider_connections%rowtype;
  batch_row public.timing_ingestion_batches%rowtype;
  edition_organization_id uuid;
begin
  if nullif(trim(p_source_batch_id), '') is null
     or p_signature_state not in ('valid', 'invalid', 'not_applicable')
     or nullif(trim(p_raw_evidence_reference), '') is null
     or (p_declared_event_count is not null and p_declared_event_count < 0)
     or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'timing_ingestion_batch_input_invalid';
  end if;

  select connection.*
  into connection_row
  from public.timing_provider_connections connection
  where connection.id = p_timing_provider_connection_id
    and connection.connection_state in ('active', 'degraded');
  if not found then
    raise exception using errcode = 'P0001', message = 'timing_provider_connection_unavailable';
  end if;

  select series.organization_id
  into edition_organization_id
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = p_event_edition_id;
  if edition_organization_id is null
     or edition_organization_id <> connection_row.organization_id then
    raise exception using errcode = '22023', message = 'timing_ingestion_scope_invalid';
  end if;

  insert into public.timing_ingestion_batches (
    timing_provider_connection_id,
    event_edition_id,
    source_batch_id,
    batch_state,
    signature_state,
    raw_evidence_reference,
    declared_event_count,
    idempotency_key,
    created_by_user_id
  )
  values (
    p_timing_provider_connection_id,
    p_event_edition_id,
    trim(p_source_batch_id),
    case when p_signature_state = 'invalid' then 'quarantined' else 'received' end,
    p_signature_state,
    trim(p_raw_evidence_reference),
    p_declared_event_count,
    p_idempotency_key,
    p_actor_user_id
  )
  on conflict (timing_provider_connection_id, idempotency_key)
  do update set updated_at = public.timing_ingestion_batches.updated_at
  returning * into batch_row;

  if batch_row.source_batch_id <> trim(p_source_batch_id)
     or batch_row.event_edition_id <> p_event_edition_id then
    raise exception using errcode = '23505', message = 'idempotency_key_reused';
  end if;

  return jsonb_build_object(
    'id', batch_row.id,
    'batchState', batch_row.batch_state,
    'signatureState', batch_row.signature_state
  );
end;
$$;

create or replace function public.service_stage_external_timing_event(
  p_timing_ingestion_batch_id uuid,
  p_source_event_id text,
  p_event_type text,
  p_event_category_id uuid,
  p_checkpoint_id uuid,
  p_timing_device_id uuid,
  p_observed_at timestamptz,
  p_signature_state text,
  p_raw_evidence_reference text,
  p_payload_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_row public.timing_ingestion_batches%rowtype;
  event_row public.external_timing_events%rowtype;
begin
  if nullif(trim(p_source_event_id), '') is null
     or p_event_type not in (
       'chip_read', 'checkpoint_read', 'finish_read', 'gps_position',
       'device_status', 'heartbeat', 'file_row'
     )
     or p_observed_at is null
     or p_signature_state not in ('valid', 'invalid', 'not_applicable')
     or nullif(trim(p_raw_evidence_reference), '') is null
     or coalesce(jsonb_typeof(p_payload_json), 'object') <> 'object'
     or p_client_event_id is null then
    raise exception using errcode = '22023', message = 'external_timing_event_input_invalid';
  end if;

  select batch.*
  into batch_row
  from public.timing_ingestion_batches batch
  where batch.id = p_timing_ingestion_batch_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'timing_ingestion_batch_not_found';
  end if;

  if p_event_category_id is not null and not exists (
    select 1
    from public.event_categories category
    where category.id = p_event_category_id
      and category.event_edition_id = batch_row.event_edition_id
  ) then
    raise exception using errcode = '22023', message = 'timing_ingestion_scope_invalid';
  end if;
  if p_checkpoint_id is not null and not exists (
    select 1
    from public.checkpoints checkpoint
    join public.event_categories category on category.id = checkpoint.event_category_id
    where checkpoint.id = p_checkpoint_id
      and category.event_edition_id = batch_row.event_edition_id
      and (p_event_category_id is null or category.id = p_event_category_id)
  ) then
    raise exception using errcode = '22023', message = 'timing_ingestion_scope_invalid';
  end if;
  if p_timing_device_id is not null and not exists (
    select 1
    from public.timing_device_assignments assignment
    where assignment.timing_device_id = p_timing_device_id
      and assignment.event_edition_id = batch_row.event_edition_id
      and assignment.assignment_state = 'active'
      and p_observed_at >= assignment.valid_from
      and p_observed_at < assignment.valid_until
      and p_event_type = any(assignment.allowed_event_types)
      and (assignment.event_category_id is null or assignment.event_category_id = p_event_category_id)
      and (assignment.checkpoint_id is null or assignment.checkpoint_id = p_checkpoint_id)
  ) then
    raise exception using errcode = 'P0001', message = 'timing_device_assignment_invalid_for_event';
  end if;

  select event.*
  into event_row
  from public.external_timing_events event
  where event.client_event_id = p_client_event_id;
  if found then
    if event_row.timing_ingestion_batch_id <> p_timing_ingestion_batch_id
       or event_row.source_event_id <> trim(p_source_event_id) then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', event_row.id,
      'processingState', event_row.processing_state,
      'replayed', true
    );
  end if;

  select event.*
  into event_row
  from public.external_timing_events event
  where event.timing_provider_connection_id = batch_row.timing_provider_connection_id
    and event.source_event_id = trim(p_source_event_id);
  if found then
    return jsonb_build_object(
      'id', event_row.id,
      'processingState', 'duplicate',
      'replayed', true
    );
  end if;

  insert into public.external_timing_events (
    timing_ingestion_batch_id,
    timing_provider_connection_id,
    event_edition_id,
    event_category_id,
    checkpoint_id,
    timing_device_id,
    source_event_id,
    event_type,
    observed_at,
    signature_state,
    processing_state,
    raw_evidence_reference,
    payload_json,
    error_code,
    client_event_id
  )
  values (
    batch_row.id,
    batch_row.timing_provider_connection_id,
    batch_row.event_edition_id,
    p_event_category_id,
    p_checkpoint_id,
    p_timing_device_id,
    trim(p_source_event_id),
    p_event_type,
    p_observed_at,
    p_signature_state,
    case when p_signature_state = 'invalid' then 'rejected' else 'received' end,
    trim(p_raw_evidence_reference),
    p_payload_json,
    case when p_signature_state = 'invalid' then 'signature_invalid' else null end,
    p_client_event_id
  )
  returning * into event_row;

  update public.timing_ingestion_batches
  set
    batch_state = case when batch_state = 'received' then 'processing' else batch_state end,
    received_event_count = received_event_count + 1,
    rejected_event_count = rejected_event_count + case when event_row.processing_state = 'rejected' then 1 else 0 end,
    updated_at = clock_timestamp()
  where id = batch_row.id;

  return jsonb_build_object(
    'id', event_row.id,
    'processingState', event_row.processing_state,
    'replayed', false
  );
end;
$$;

create or replace function public.service_reconcile_timing_ingestion_batch(
  p_timing_ingestion_batch_id uuid,
  p_batch_state text,
  p_accepted_event_count integer,
  p_rejected_event_count integer,
  p_conflicted_event_count integer,
  p_error_summary_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_row public.timing_ingestion_batches%rowtype;
begin
  if p_batch_state not in ('reconciled', 'failed', 'quarantined')
     or least(p_accepted_event_count, p_rejected_event_count, p_conflicted_event_count) < 0
     or coalesce(jsonb_typeof(p_error_summary_json), 'array') <> 'array' then
    raise exception using errcode = '22023', message = 'timing_ingestion_reconciliation_input_invalid';
  end if;

  update public.timing_ingestion_batches
  set
    batch_state = p_batch_state,
    accepted_event_count = p_accepted_event_count,
    rejected_event_count = p_rejected_event_count,
    conflicted_event_count = p_conflicted_event_count,
    error_summary_json = coalesce(p_error_summary_json, '[]'::jsonb),
    reconciled_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = p_timing_ingestion_batch_id
  returning * into batch_row;
  if not found then
    raise exception using errcode = 'P0002', message = 'timing_ingestion_batch_not_found';
  end if;

  if batch_row.received_event_count
     <> batch_row.accepted_event_count + batch_row.rejected_event_count + batch_row.conflicted_event_count then
    raise exception using errcode = 'P0001', message = 'timing_ingestion_reconciliation_mismatch';
  end if;

  return jsonb_build_object(
    'id', batch_row.id,
    'batchState', batch_row.batch_state,
    'receivedEventCount', batch_row.received_event_count
  );
end;
$$;

create or replace function public.block_race_start_for_unhealthy_timing_fleet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan_row public.timing_plan_versions%rowtype;
begin
  if new.event_type not in ('start', 'restart') then
    return new;
  end if;

  select plan.*
  into plan_row
  from public.edition_operational_controls control
  join public.timing_plan_versions plan on plan.id = control.current_timing_plan_id
  where control.event_edition_id = new.event_edition_id;

  if plan_row.id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.timing_plan_points point
    join public.timing_devices device on device.id = point.primary_device_id
    where point.timing_plan_id = plan_row.id
      and point.event_category_id = new.event_category_id
      and point.capture_mode = 'device'
      and (
        device.status <> 'active'
        or device.sync_state in ('offline', 'error')
        or device.credential_state in ('revoked', 'expired')
        or (
          device.clock_offset_ms is not null
          and abs(device.clock_offset_ms) > plan_row.clock_tolerance_ms
        )
        or not exists (
          select 1
          from public.timing_device_assignments assignment
          where assignment.timing_device_id = device.id
            and assignment.event_edition_id = new.event_edition_id
            and assignment.assignment_state = 'active'
            and new.occurred_at >= assignment.valid_from
            and new.occurred_at < assignment.valid_until
            and (
              assignment.event_category_id is null
              or assignment.event_category_id = new.event_category_id
            )
            and (
              assignment.checkpoint_id is null
              or assignment.checkpoint_id = point.checkpoint_id
            )
        )
      )
  ) then
    raise exception using errcode = 'P0001', message = 'timing_fleet_race_start_blocked';
  end if;

  return new;
end;
$$;

create trigger race_start_events_block_unhealthy_timing_fleet
before insert on public.race_start_events
for each row execute function public.block_race_start_for_unhealthy_timing_fleet();

alter table public.timing_device_assignments enable row level security;
alter table public.timing_device_events enable row level security;
alter table public.timing_provider_connections enable row level security;
alter table public.timing_provider_connection_events enable row level security;
alter table public.timing_ingestion_batches enable row level security;
alter table public.external_timing_events enable row level security;

revoke all on table public.timing_device_assignments from anon, authenticated;
revoke all on table public.timing_device_events from anon, authenticated;
revoke all on table public.timing_provider_connections from anon, authenticated;
revoke all on table public.timing_provider_connection_events from anon, authenticated;
revoke all on table public.timing_ingestion_batches from anon, authenticated;
revoke all on table public.external_timing_events from anon, authenticated;

revoke all on function public.service_register_timing_fleet_device(
  uuid, uuid, text, text, text, text, text, text, integer, integer, text, text, text, timestamptz, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.service_create_timing_device_assignment(
  uuid, uuid, uuid, uuid, text[], timestamptz, timestamptz, integer, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.service_update_timing_device_assignment(
  uuid, uuid, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_append_timing_device_event(
  uuid, uuid, text, text, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.service_save_timing_provider_connection(
  uuid, uuid, text, text, text, text, jsonb, text, integer, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_stage_timing_ingestion_batch(
  uuid, uuid, text, text, text, integer, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.service_stage_external_timing_event(
  uuid, text, text, uuid, uuid, uuid, timestamptz, text, text, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.service_reconcile_timing_ingestion_batch(
  uuid, text, integer, integer, integer, jsonb
) from public, anon, authenticated;

grant execute on function public.service_register_timing_fleet_device(
  uuid, uuid, text, text, text, text, text, text, integer, integer, text, text, text, timestamptz, jsonb, uuid
) to service_role;
grant execute on function public.service_create_timing_device_assignment(
  uuid, uuid, uuid, uuid, text[], timestamptz, timestamptz, integer, uuid, uuid
) to service_role;
grant execute on function public.service_update_timing_device_assignment(
  uuid, uuid, text, text, uuid
) to service_role;
grant execute on function public.service_append_timing_device_event(
  uuid, uuid, text, text, jsonb, uuid
) to service_role;
grant execute on function public.service_save_timing_provider_connection(
  uuid, uuid, text, text, text, text, jsonb, text, integer, text, text, uuid
) to service_role;
grant execute on function public.service_stage_timing_ingestion_batch(
  uuid, uuid, text, text, text, integer, uuid, uuid
) to service_role;
grant execute on function public.service_stage_external_timing_event(
  uuid, text, text, uuid, uuid, uuid, timestamptz, text, text, jsonb, uuid
) to service_role;
grant execute on function public.service_reconcile_timing_ingestion_batch(
  uuid, text, integer, integer, integer, jsonb
) to service_role;

grant select, insert, update on table public.timing_device_assignments to service_role;
grant select, insert on table public.timing_device_events to service_role;
grant select, insert, update on table public.timing_provider_connections to service_role;
grant select, insert on table public.timing_provider_connection_events to service_role;
grant select, insert, update on table public.timing_ingestion_batches to service_role;
grant select, insert on table public.external_timing_events to service_role;
