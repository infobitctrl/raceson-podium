create table public.safety_plan_versions (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  version_number integer not null,
  plan_state text not null default 'draft',
  plan_json jsonb not null,
  public_excerpt_json jsonb not null default '{}'::jsonb,
  content_digest text not null,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  activated_by_user_id uuid,
  activated_at timestamptz,
  supersedes_plan_version_id uuid references public.safety_plan_versions (id) on delete restrict,
  unique (event_edition_id, version_number),
  check (plan_state in ('draft', 'active', 'superseded')),
  check (jsonb_typeof(plan_json) = 'object'),
  check (jsonb_typeof(public_excerpt_json) = 'object'),
  check (content_digest ~ '^[0-9a-f]{64}$'),
  check (
    (plan_state = 'active' and activated_at is not null)
    or (plan_state <> 'active')
  )
);

create unique index safety_plan_versions_one_active_idx
  on public.safety_plan_versions (event_edition_id)
  where plan_state = 'active';

create table public.safety_incidents (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  event_category_id uuid references public.event_categories (id) on delete restrict,
  checkpoint_id uuid references public.checkpoints (id) on delete restrict,
  registration_id uuid references public.registrations (id) on delete restrict,
  incident_number integer not null,
  incident_code text not null,
  incident_type text not null,
  severity text not null,
  incident_state text not null default 'reported',
  title text not null,
  restricted_summary text,
  privacy_classification text not null default 'restricted',
  location_label text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  effective_at timestamptz not null,
  reported_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  reviewed_at timestamptz,
  closed_at timestamptz,
  owner_user_id uuid,
  reported_by_user_id uuid,
  source text not null default 'operator',
  emergency_service_reference text,
  suppress_public_live boolean not null default false,
  participant_status_reconciled boolean not null default false,
  result_impact_reviewed boolean not null default false,
  client_event_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_edition_id, incident_number),
  unique (event_edition_id, incident_code),
  check (incident_type in (
    'overdue_participant',
    'missing_participant',
    'medical',
    'injury',
    'evacuation',
    'weather',
    'course_hazard',
    'infrastructure',
    'communications',
    'security',
    'environmental',
    'other'
  )),
  check (severity in ('info', 'minor', 'major', 'critical')),
  check (incident_state in (
    'reported',
    'acknowledged',
    'investigating',
    'action_in_progress',
    'monitoring',
    'resolved',
    'reviewed',
    'closed'
  )),
  check (privacy_classification in ('operational', 'restricted', 'medical')),
  check (length(trim(title)) between 3 and 240),
  check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  ),
  check (severity <> 'critical' or owner_user_id is not null),
  check (
    incident_state <> 'closed'
    or (
      participant_status_reconciled
      and result_impact_reviewed
      and closed_at is not null
    )
  )
);

create index safety_incidents_edition_state_severity_idx
  on public.safety_incidents (event_edition_id, incident_state, severity, reported_at desc);
create index safety_incidents_registration_idx
  on public.safety_incidents (registration_id, reported_at desc)
  where registration_id is not null;

create table public.safety_incident_events (
  id uuid primary key default gen_random_uuid(),
  safety_incident_id uuid not null references public.safety_incidents (id) on delete cascade,
  sequence_number integer not null,
  action_type text not null,
  from_state text,
  to_state text,
  note text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  client_event_id uuid not null unique,
  created_at timestamptz not null default now(),
  unique (safety_incident_id, sequence_number),
  check (action_type in (
    'reported',
    'acknowledge',
    'classify',
    'action',
    'communication',
    'handoff',
    'status_reconciliation',
    'result_review',
    'resolve',
    'review',
    'close',
    'reopen'
  )),
  check (jsonb_typeof(payload_json) = 'object'),
  check (length(trim(note)) between 1 and 4000)
);

create index safety_incident_events_incident_sequence_idx
  on public.safety_incident_events (safety_incident_id, sequence_number desc);

create table public.safety_record_access_log (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  safety_incident_id uuid references public.safety_incidents (id) on delete cascade,
  actor_user_id uuid not null,
  access_purpose text not null,
  fields_classification text not null,
  accessed_at timestamptz not null default now(),
  check (length(trim(access_purpose)) between 3 and 500),
  check (fields_classification in ('operational', 'restricted', 'medical'))
);

create index safety_record_access_log_edition_time_idx
  on public.safety_record_access_log (event_edition_id, accessed_at desc);

create or replace function public.protect_safety_plan_version_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'safety_plan_version_delete_forbidden';
  end if;

  if new.event_edition_id is distinct from old.event_edition_id
     or new.version_number is distinct from old.version_number
     or new.plan_json is distinct from old.plan_json
     or new.public_excerpt_json is distinct from old.public_excerpt_json
     or new.content_digest is distinct from old.content_digest
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.activated_by_user_id is distinct from old.activated_by_user_id
     or new.activated_at is distinct from old.activated_at
     or new.supersedes_plan_version_id is distinct from old.supersedes_plan_version_id
     or new.created_at is distinct from old.created_at
     or not (
       new.plan_state = old.plan_state
       or (old.plan_state = 'active' and new.plan_state = 'superseded')
     ) then
    raise exception using errcode = 'P0001', message = 'safety_plan_version_evidence_immutable';
  end if;

  return new;
end;
$$;

create trigger safety_plan_versions_protect_evidence
before update or delete on public.safety_plan_versions
for each row execute function public.protect_safety_plan_version_evidence();

create or replace function public.prevent_safety_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'safety_evidence_append_only';
end;
$$;

create trigger safety_incident_events_append_only
before update or delete on public.safety_incident_events
for each row execute function public.prevent_safety_evidence_mutation();

create trigger safety_record_access_log_append_only
before update or delete on public.safety_record_access_log
for each row execute function public.prevent_safety_evidence_mutation();

create or replace function public.service_create_safety_plan_version(
  p_event_edition_id uuid,
  p_actor_user_id uuid,
  p_plan_json jsonb,
  p_public_excerpt_json jsonb,
  p_activate boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_plan public.safety_plan_versions%rowtype;
  previous_active public.safety_plan_versions%rowtype;
  next_version integer;
  content_digest text;
  organization_id uuid;
begin
  if jsonb_typeof(p_plan_json) <> 'object'
     or jsonb_typeof(coalesce(p_public_excerpt_json, '{}'::jsonb)) <> 'object'
     or not (p_plan_json ? 'commandRoles')
     or not (p_plan_json ? 'emergencyContacts')
     or not (p_plan_json ? 'escalationInstructions')
     or not (p_plan_json ? 'missingPersonProtocol')
     or jsonb_typeof(p_plan_json->'commandRoles') <> 'array'
     or jsonb_array_length(p_plan_json->'commandRoles') = 0
     or jsonb_typeof(p_plan_json->'emergencyContacts') <> 'array'
     or jsonb_array_length(p_plan_json->'emergencyContacts') = 0
     or jsonb_typeof(p_plan_json->'escalationInstructions') <> 'array'
     or jsonb_array_length(p_plan_json->'escalationInstructions') = 0
     or jsonb_typeof(p_plan_json->'missingPersonProtocol') <> 'array'
     or jsonb_array_length(p_plan_json->'missingPersonProtocol') = 0 then
    raise exception using errcode = '22023', message = 'safety_plan_input_invalid';
  end if;

  perform 1
  from public.event_editions edition
  where edition.id = p_event_edition_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  select plan.*
  into previous_active
  from public.safety_plan_versions plan
  where plan.event_edition_id = p_event_edition_id
    and plan.plan_state = 'active'
  for update;

  select coalesce(max(plan.version_number), 0) + 1
  into next_version
  from public.safety_plan_versions plan
  where plan.event_edition_id = p_event_edition_id;

  content_digest := encode(
    public.digest(convert_to(p_plan_json::text, 'utf8'), 'sha256'),
    'hex'
  );

  if coalesce(p_activate, false) and previous_active.id is not null then
    update public.safety_plan_versions
    set plan_state = 'superseded'
    where id = previous_active.id;
  end if;

  insert into public.safety_plan_versions (
    event_edition_id,
    version_number,
    plan_state,
    plan_json,
    public_excerpt_json,
    content_digest,
    created_by_user_id,
    activated_by_user_id,
    activated_at,
    supersedes_plan_version_id
  )
  values (
    p_event_edition_id,
    next_version,
    case when coalesce(p_activate, false) then 'active' else 'draft' end,
    p_plan_json,
    coalesce(p_public_excerpt_json, '{}'::jsonb),
    content_digest,
    p_actor_user_id,
    case when coalesce(p_activate, false) then p_actor_user_id else null end,
    case when coalesce(p_activate, false) then clock_timestamp() else null end,
    previous_active.id
  )
  returning * into created_plan;

  select series.organization_id
  into organization_id
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = p_event_edition_id;

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
    'safety_plan_version',
    created_plan.id,
    case when p_activate then 'safety.plan_activated' else 'safety.plan_drafted' end,
    jsonb_build_object(
      'versionNumber', created_plan.version_number,
      'contentDigest', created_plan.content_digest,
      'supersedesPlanVersionId', created_plan.supersedes_plan_version_id
    )
  );

  return jsonb_build_object(
    'id', created_plan.id,
    'eventEditionId', created_plan.event_edition_id,
    'versionNumber', created_plan.version_number,
    'planState', created_plan.plan_state,
    'contentDigest', created_plan.content_digest,
    'activatedAt', created_plan.activated_at
  );
end;
$$;

create or replace function public.service_create_safety_incident(
  p_event_edition_id uuid,
  p_event_category_id uuid,
  p_checkpoint_id uuid,
  p_registration_id uuid,
  p_actor_user_id uuid,
  p_incident_type text,
  p_severity text,
  p_title text,
  p_restricted_summary text,
  p_privacy_classification text,
  p_location_label text,
  p_effective_at timestamptz,
  p_owner_user_id uuid,
  p_suppress_public_live boolean,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_incident public.safety_incidents%rowtype;
  created_incident public.safety_incidents%rowtype;
  next_number integer;
  organization_id uuid;
begin
  if p_incident_type not in (
       'overdue_participant', 'missing_participant', 'medical', 'injury', 'evacuation',
       'weather', 'course_hazard', 'infrastructure', 'communications', 'security',
       'environmental', 'other'
     )
     or p_severity not in ('info', 'minor', 'major', 'critical')
     or length(trim(coalesce(p_title, ''))) < 3
     or p_effective_at is null
     or p_effective_at > clock_timestamp() + interval '10 minutes'
     or p_privacy_classification not in ('operational', 'restricted', 'medical')
     or p_client_event_id is null
     or (p_severity = 'critical' and p_owner_user_id is null) then
    raise exception using errcode = '22023', message = 'safety_incident_input_invalid';
  end if;

  select incident.*
  into existing_incident
  from public.safety_incidents incident
  where incident.client_event_id = p_client_event_id;
  if found then
    if existing_incident.event_edition_id <> p_event_edition_id
       or existing_incident.incident_type <> p_incident_type then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_incident.id,
      'incidentCode', existing_incident.incident_code,
      'incidentState', existing_incident.incident_state,
      'replayed', true
    );
  end if;

  perform 1
  from public.event_editions edition
  where edition.id = p_event_edition_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  if p_event_category_id is not null and not exists (
    select 1
    from public.event_categories category
    where category.id = p_event_category_id
      and category.event_edition_id = p_event_edition_id
  ) then
    raise exception using errcode = '22023', message = 'safety_incident_scope_invalid';
  end if;
  if p_checkpoint_id is not null and not exists (
    select 1
    from public.checkpoints checkpoint
    join public.event_categories category on category.id = checkpoint.event_category_id
    where checkpoint.id = p_checkpoint_id
      and category.event_edition_id = p_event_edition_id
      and (p_event_category_id is null or checkpoint.event_category_id = p_event_category_id)
  ) then
    raise exception using errcode = '22023', message = 'safety_incident_scope_invalid';
  end if;
  if p_registration_id is not null and not exists (
    select 1
    from public.registrations registration
    join public.event_categories category on category.id = registration.event_category_id
    where registration.id = p_registration_id
      and category.event_edition_id = p_event_edition_id
      and (p_event_category_id is null or registration.event_category_id = p_event_category_id)
  ) then
    raise exception using errcode = '22023', message = 'safety_incident_scope_invalid';
  end if;

  select coalesce(max(incident.incident_number), 0) + 1
  into next_number
  from public.safety_incidents incident
  where incident.event_edition_id = p_event_edition_id;

  insert into public.safety_incidents (
    event_edition_id,
    event_category_id,
    checkpoint_id,
    registration_id,
    incident_number,
    incident_code,
    incident_type,
    severity,
    title,
    restricted_summary,
    privacy_classification,
    location_label,
    effective_at,
    owner_user_id,
    reported_by_user_id,
    suppress_public_live,
    client_event_id
  )
  values (
    p_event_edition_id,
    p_event_category_id,
    p_checkpoint_id,
    p_registration_id,
    next_number,
    'INC-' || lpad(next_number::text, 4, '0'),
    p_incident_type,
    p_severity,
    trim(p_title),
    nullif(trim(p_restricted_summary), ''),
    p_privacy_classification,
    nullif(trim(p_location_label), ''),
    p_effective_at,
    p_owner_user_id,
    p_actor_user_id,
    coalesce(p_suppress_public_live, false),
    p_client_event_id
  )
  returning * into created_incident;

  insert into public.safety_incident_events (
    safety_incident_id,
    sequence_number,
    action_type,
    to_state,
    note,
    payload_json,
    created_by_user_id,
    client_event_id
  )
  values (
    created_incident.id,
    1,
    'reported',
    'reported',
    coalesce(nullif(trim(p_restricted_summary), ''), trim(p_title)),
    jsonb_build_object(
      'severity', p_severity,
      'incidentType', p_incident_type,
      'locationLabel', nullif(trim(p_location_label), '')
    ),
    p_actor_user_id,
    gen_random_uuid()
  );

  select series.organization_id
  into organization_id
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = p_event_edition_id;

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
    'safety_incident',
    created_incident.id,
    'safety.incident_reported',
    jsonb_build_object(
      'incidentCode', created_incident.incident_code,
      'severity', created_incident.severity,
      'privacyClassification', created_incident.privacy_classification
    )
  );

  return jsonb_build_object(
    'id', created_incident.id,
    'incidentCode', created_incident.incident_code,
    'incidentState', created_incident.incident_state,
    'severity', created_incident.severity,
    'replayed', false
  );
end;
$$;

create or replace function public.service_append_safety_incident_event(
  p_safety_incident_id uuid,
  p_actor_user_id uuid,
  p_action_type text,
  p_to_state text,
  p_note text,
  p_payload_json jsonb,
  p_owner_user_id uuid,
  p_suppress_public_live boolean,
  p_participant_status_reconciled boolean,
  p_result_impact_reviewed boolean,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  incident_row public.safety_incidents%rowtype;
  existing_event public.safety_incident_events%rowtype;
  created_event public.safety_incident_events%rowtype;
  next_sequence integer;
  target_state text;
  organization_id uuid;
begin
  if p_action_type not in (
       'acknowledge', 'classify', 'action', 'communication', 'handoff',
       'status_reconciliation', 'result_review', 'resolve', 'review', 'close', 'reopen'
     )
     or nullif(trim(p_note), '') is null
     or coalesce(jsonb_typeof(p_payload_json), 'object') <> 'object'
     or p_client_event_id is null then
    raise exception using errcode = '22023', message = 'safety_incident_event_input_invalid';
  end if;

  select incident_event.*
  into existing_event
  from public.safety_incident_events incident_event
  where incident_event.client_event_id = p_client_event_id;
  if found then
    if existing_event.safety_incident_id <> p_safety_incident_id
       or existing_event.action_type <> p_action_type then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_event.id,
      'incidentId', existing_event.safety_incident_id,
      'toState', existing_event.to_state,
      'sequenceNumber', existing_event.sequence_number,
      'replayed', true
    );
  end if;

  select incident.*
  into incident_row
  from public.safety_incidents incident
  where incident.id = p_safety_incident_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'safety_incident_not_found';
  end if;

  target_state := coalesce(nullif(trim(p_to_state), ''), incident_row.incident_state);
  if target_state not in (
       'reported', 'acknowledged', 'investigating', 'action_in_progress',
       'monitoring', 'resolved', 'reviewed', 'closed'
     ) then
    raise exception using errcode = '22023', message = 'safety_incident_state_invalid';
  end if;

  if target_state <> incident_row.incident_state and not (
    (incident_row.incident_state = 'reported' and target_state in ('acknowledged', 'investigating'))
    or (incident_row.incident_state = 'acknowledged' and target_state in ('investigating', 'action_in_progress'))
    or (incident_row.incident_state = 'investigating' and target_state in ('action_in_progress', 'monitoring', 'resolved'))
    or (incident_row.incident_state = 'action_in_progress' and target_state in ('monitoring', 'resolved'))
    or (incident_row.incident_state = 'monitoring' and target_state in ('action_in_progress', 'resolved'))
    or (incident_row.incident_state = 'resolved' and target_state in ('reviewed', 'investigating'))
    or (incident_row.incident_state = 'reviewed' and target_state in ('closed', 'investigating'))
    or (incident_row.incident_state = 'closed' and target_state = 'investigating')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'safety_incident_transition_invalid',
      detail = incident_row.incident_state || ' -> ' || target_state;
  end if;

  if incident_row.severity = 'critical'
     and coalesce(p_owner_user_id, incident_row.owner_user_id) is null then
    raise exception using errcode = 'P0001', message = 'critical_incident_owner_required';
  end if;

  if target_state = 'closed' and (
    not coalesce(p_participant_status_reconciled, incident_row.participant_status_reconciled)
    or not coalesce(p_result_impact_reviewed, incident_row.result_impact_reviewed)
  ) then
    raise exception using errcode = 'P0001', message = 'incident_closure_reconciliation_required';
  end if;

  select coalesce(max(incident_event.sequence_number), 0) + 1
  into next_sequence
  from public.safety_incident_events incident_event
  where incident_event.safety_incident_id = incident_row.id;

  insert into public.safety_incident_events (
    safety_incident_id,
    sequence_number,
    action_type,
    from_state,
    to_state,
    note,
    payload_json,
    created_by_user_id,
    client_event_id
  )
  values (
    incident_row.id,
    next_sequence,
    p_action_type,
    incident_row.incident_state,
    target_state,
    trim(p_note),
    coalesce(p_payload_json, '{}'::jsonb),
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_event;

  update public.safety_incidents
  set
    incident_state = target_state,
    owner_user_id = coalesce(p_owner_user_id, owner_user_id),
    suppress_public_live = coalesce(p_suppress_public_live, suppress_public_live),
    participant_status_reconciled = coalesce(
      p_participant_status_reconciled,
      participant_status_reconciled
    ),
    result_impact_reviewed = coalesce(p_result_impact_reviewed, result_impact_reviewed),
    acknowledged_at = case
      when target_state in ('acknowledged', 'investigating', 'action_in_progress', 'monitoring', 'resolved', 'reviewed', 'closed')
        then coalesce(acknowledged_at, clock_timestamp())
      else acknowledged_at
    end,
    resolved_at = case
      when target_state in ('resolved', 'reviewed', 'closed') then coalesce(resolved_at, clock_timestamp())
      when target_state = 'investigating' then null
      else resolved_at
    end,
    reviewed_at = case
      when target_state in ('reviewed', 'closed') then coalesce(reviewed_at, clock_timestamp())
      when target_state = 'investigating' then null
      else reviewed_at
    end,
    closed_at = case when target_state = 'closed' then clock_timestamp() else null end,
    updated_at = clock_timestamp()
  where id = incident_row.id
  returning * into incident_row;

  select series.organization_id
  into organization_id
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = incident_row.event_edition_id;

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
    'safety_incident_event',
    created_event.id,
    'safety.incident_' || p_action_type,
    jsonb_build_object(
      'incidentId', incident_row.id,
      'fromState', created_event.from_state,
      'toState', created_event.to_state,
      'sequenceNumber', next_sequence
    )
  );

  return jsonb_build_object(
    'id', created_event.id,
    'incidentId', incident_row.id,
    'incidentState', incident_row.incident_state,
    'toState', created_event.to_state,
    'sequenceNumber', created_event.sequence_number,
    'participantStatusReconciled', incident_row.participant_status_reconciled,
    'resultImpactReviewed', incident_row.result_impact_reviewed,
    'replayed', false
  );
end;
$$;

create or replace function public.service_log_safety_record_access(
  p_event_edition_id uuid,
  p_safety_incident_id uuid,
  p_actor_user_id uuid,
  p_access_purpose text,
  p_fields_classification text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  access_id uuid;
begin
  if length(trim(coalesce(p_access_purpose, ''))) < 3
     or p_fields_classification not in ('operational', 'restricted', 'medical') then
    raise exception using errcode = '22023', message = 'safety_access_log_input_invalid';
  end if;
  if p_safety_incident_id is not null and not exists (
    select 1
    from public.safety_incidents incident
    where incident.id = p_safety_incident_id
      and incident.event_edition_id = p_event_edition_id
  ) then
    raise exception using errcode = '22023', message = 'safety_access_log_scope_invalid';
  end if;

  insert into public.safety_record_access_log (
    event_edition_id,
    safety_incident_id,
    actor_user_id,
    access_purpose,
    fields_classification
  )
  values (
    p_event_edition_id,
    p_safety_incident_id,
    p_actor_user_id,
    trim(p_access_purpose),
    p_fields_classification
  )
  returning id into access_id;
  return access_id;
end;
$$;

create or replace function public.block_race_start_for_critical_incident()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_type in ('actual_start', 'restart') and exists (
    select 1
    from public.safety_incidents incident
    where incident.event_edition_id = new.event_edition_id
      and incident.severity = 'critical'
      and incident.incident_state not in ('resolved', 'reviewed', 'closed')
  ) then
    raise exception using errcode = 'P0001', message = 'critical_safety_incident_blocks_start';
  end if;
  return new;
end;
$$;

create trigger race_start_events_block_critical_incident
before insert on public.race_start_events
for each row execute function public.block_race_start_for_critical_incident();

create or replace function public.block_field_signoff_for_open_incident()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  edition_id uuid;
begin
  select category.event_edition_id
  into edition_id
  from public.event_categories category
  where category.id = new.event_category_id;

  if exists (
    select 1
    from public.safety_incidents incident
    where incident.event_edition_id = edition_id
      and (incident.event_category_id is null or incident.event_category_id = new.event_category_id)
      and incident.incident_state not in ('closed')
      and incident.severity in ('major', 'critical')
  ) then
    raise exception using errcode = 'P0001', message = 'open_safety_incident_blocks_field_signoff';
  end if;
  return new;
end;
$$;

create trigger field_accounting_signoffs_block_open_incident
before insert on public.field_accounting_signoffs
for each row execute function public.block_field_signoff_for_open_incident();

alter table public.safety_plan_versions enable row level security;
alter table public.safety_incidents enable row level security;
alter table public.safety_incident_events enable row level security;
alter table public.safety_record_access_log enable row level security;

revoke all on table public.safety_plan_versions from public, anon, authenticated;
revoke all on table public.safety_incidents from public, anon, authenticated;
revoke all on table public.safety_incident_events from public, anon, authenticated;
revoke all on table public.safety_record_access_log from public, anon, authenticated;
grant all on table public.safety_plan_versions to service_role;
grant all on table public.safety_incidents to service_role;
grant all on table public.safety_incident_events to service_role;
grant all on table public.safety_record_access_log to service_role;

revoke all on function public.service_create_safety_plan_version(uuid, uuid, jsonb, jsonb, boolean)
  from public, anon, authenticated;
revoke all on function public.service_create_safety_incident(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, uuid, boolean, uuid
) from public, anon, authenticated;
revoke all on function public.service_append_safety_incident_event(
  uuid, uuid, text, text, text, jsonb, uuid, boolean, boolean, boolean, uuid
) from public, anon, authenticated;
revoke all on function public.service_log_safety_record_access(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.service_create_safety_plan_version(uuid, uuid, jsonb, jsonb, boolean)
  to service_role;
grant execute on function public.service_create_safety_incident(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, uuid, boolean, uuid
) to service_role;
grant execute on function public.service_append_safety_incident_event(
  uuid, uuid, text, text, text, jsonb, uuid, boolean, boolean, boolean, uuid
) to service_role;
grant execute on function public.service_log_safety_record_access(uuid, uuid, uuid, text, text)
  to service_role;
