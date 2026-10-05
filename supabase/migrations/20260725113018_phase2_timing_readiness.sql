/*
 * Versioned timing plans, device health, and rehearsal evidence. Timing may
 * start only from an approved plan paired with the current frozen manifest and
 * a passing rehearsal.
 */

alter table public.timing_devices
  add column status text not null default 'active',
  add column clock_offset_ms integer,
  add column clock_checked_at timestamptz,
  add column battery_percent integer,
  add column firmware_version text,
  add column health_json jsonb not null default '{}'::jsonb;

alter table public.timing_devices
  add constraint timing_devices_status_check
    check (status in ('active', 'maintenance', 'retired')),
  add constraint timing_devices_battery_check
    check (battery_percent is null or battery_percent between 0 and 100),
  add constraint timing_devices_health_object_check
    check (jsonb_typeof(health_json) = 'object');

create index timing_devices_organization_status_idx
  on public.timing_devices (organization_id, status, last_seen_at desc);

create table public.timing_plan_versions (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  version_number integer not null,
  name text not null,
  digest text not null,
  clock_tolerance_ms integer not null default 2000,
  plan_json jsonb not null,
  approved_by_user_id uuid,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (event_edition_id, version_number),
  check (version_number > 0),
  check (length(trim(name)) > 0),
  check (digest ~ '^[a-f0-9]{64}$'),
  check (clock_tolerance_ms between 100 and 60000),
  check (jsonb_typeof(plan_json) = 'object')
);

create index timing_plan_versions_edition_approved_idx
  on public.timing_plan_versions (event_edition_id, approved_at desc);

create table public.timing_plan_points (
  id uuid primary key default gen_random_uuid(),
  timing_plan_id uuid not null references public.timing_plan_versions (id) on delete cascade,
  event_category_id uuid not null references public.event_categories (id),
  checkpoint_id uuid not null references public.checkpoints (id),
  capture_mode text not null,
  primary_device_id uuid references public.timing_devices (id),
  backup_method text not null,
  operator_label text,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (timing_plan_id, checkpoint_id),
  unique (timing_plan_id, position),
  check (capture_mode in ('manual', 'device', 'import')),
  check (
    (capture_mode = 'device' and primary_device_id is not null)
    or capture_mode <> 'device'
  ),
  check (length(trim(backup_method)) > 0),
  check (position > 0)
);

create table public.pre_race_rehearsals (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  start_list_manifest_id uuid not null references public.start_list_manifests (id),
  timing_plan_id uuid not null references public.timing_plan_versions (id),
  status text not null,
  checklist_json jsonb not null,
  issues_json jsonb not null default '[]'::jsonb,
  notes text,
  completed_by_user_id uuid,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (status in ('passed', 'failed')),
  check (jsonb_typeof(checklist_json) = 'object'),
  check (jsonb_typeof(issues_json) = 'array')
);

create index pre_race_rehearsals_edition_completed_idx
  on public.pre_race_rehearsals (event_edition_id, completed_at desc);

alter table public.edition_operational_controls
  add column current_timing_plan_id uuid references public.timing_plan_versions (id),
  add column latest_rehearsal_id uuid references public.pre_race_rehearsals (id),
  add column timing_readiness_state text not null default 'draft';

alter table public.edition_operational_controls
  add constraint edition_operational_controls_timing_state_check
    check (timing_readiness_state in ('draft', 'planned', 'ready', 'failed'));

create or replace function public.reject_timing_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'timing_snapshot_is_immutable';
end;
$$;

create trigger timing_plan_versions_immutable
before update or delete on public.timing_plan_versions
for each row execute function public.reject_timing_snapshot_mutation();

create trigger timing_plan_points_immutable
before update or delete on public.timing_plan_points
for each row execute function public.reject_timing_snapshot_mutation();

create trigger pre_race_rehearsals_immutable
before update or delete on public.pre_race_rehearsals
for each row execute function public.reject_timing_snapshot_mutation();

create or replace function public.service_save_timing_device(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_device_fingerprint text,
  p_device_label text,
  p_status text,
  p_clock_offset_ms integer,
  p_battery_percent integer,
  p_firmware_version text,
  p_health_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_device public.timing_devices%rowtype;
begin
  if nullif(trim(p_device_fingerprint), '') is null
     or length(trim(p_device_fingerprint)) > 200
     or p_status not in ('active', 'maintenance', 'retired')
     or (p_battery_percent is not null and (p_battery_percent < 0 or p_battery_percent > 100))
     or jsonb_typeof(coalesce(p_health_json, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'timing_device_input_invalid';
  end if;

  insert into public.timing_devices (
    organization_id,
    device_label,
    device_fingerprint,
    status,
    clock_offset_ms,
    clock_checked_at,
    battery_percent,
    firmware_version,
    health_json,
    last_seen_at
  )
  values (
    p_organization_id,
    nullif(trim(p_device_label), ''),
    trim(p_device_fingerprint),
    p_status,
    p_clock_offset_ms,
    case when p_clock_offset_ms is null then null else now() end,
    p_battery_percent,
    nullif(trim(p_firmware_version), ''),
    coalesce(p_health_json, '{}'::jsonb),
    now()
  )
  on conflict (device_fingerprint)
  do update set
    device_label = excluded.device_label,
    status = excluded.status,
    clock_offset_ms = excluded.clock_offset_ms,
    clock_checked_at = excluded.clock_checked_at,
    battery_percent = excluded.battery_percent,
    firmware_version = excluded.firmware_version,
    health_json = excluded.health_json,
    last_seen_at = excluded.last_seen_at,
    updated_at = now()
  where public.timing_devices.organization_id = excluded.organization_id
  returning * into saved_device;

  if saved_device.id is null then
    raise exception using errcode = '23505', message = 'timing_device_owned_by_other_organization';
  end if;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'timing_device',
    saved_device.id,
    'timing_device.health_recorded',
    jsonb_build_object(
      'status', saved_device.status,
      'clockOffsetMs', saved_device.clock_offset_ms,
      'batteryPercent', saved_device.battery_percent
    )
  );

  return jsonb_build_object(
    'id', saved_device.id,
    'label', saved_device.device_label,
    'fingerprint', saved_device.device_fingerprint,
    'status', saved_device.status,
    'clockOffsetMs', saved_device.clock_offset_ms,
    'clockCheckedAt', saved_device.clock_checked_at,
    'batteryPercent', saved_device.battery_percent,
    'firmwareVersion', saved_device.firmware_version,
    'lastSeenAt', saved_device.last_seen_at
  );
end;
$$;

create or replace function public.service_publish_timing_plan(
  p_event_edition_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_clock_tolerance_ms integer,
  p_points jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  edition_row public.event_editions%rowtype;
  resolved_organization_id uuid;
  next_version integer;
  normalized_plan jsonb;
  plan_digest text;
  current_plan public.timing_plan_versions%rowtype;
  created_plan public.timing_plan_versions%rowtype;
  point_row record;
  point_position integer := 0;
  mandatory_checkpoint_count integer;
begin
  if nullif(trim(p_name), '') is null
     or p_clock_tolerance_ms is null
     or p_clock_tolerance_ms < 100
     or p_clock_tolerance_ms > 60000
     or jsonb_typeof(p_points) <> 'array'
     or jsonb_array_length(p_points) = 0 then
    raise exception using errcode = '22023', message = 'timing_plan_input_invalid';
  end if;

  select edition.*
  into edition_row
  from public.event_editions edition
  where edition.id = p_event_edition_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  select series.organization_id
  into resolved_organization_id
  from public.event_series series
  where series.id = edition_row.event_series_id;

  normalized_plan := jsonb_build_object(
    'name', trim(p_name),
    'clockToleranceMs', p_clock_tolerance_ms,
    'points', p_points
  );
  plan_digest := encode(
    public.digest(convert_to(normalized_plan::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select plan.*
  into current_plan
  from public.edition_operational_controls control
  join public.timing_plan_versions plan on plan.id = control.current_timing_plan_id
  where control.event_edition_id = p_event_edition_id
    and plan.digest = plan_digest;

  if found then
    return jsonb_build_object(
      'timingPlanId', current_plan.id,
      'versionNumber', current_plan.version_number,
      'digest', current_plan.digest,
      'pointCount', jsonb_array_length(current_plan.plan_json->'points'),
      'replayed', true
    );
  end if;

  create temporary table if not exists timing_plan_input_points (
    category_id uuid,
    checkpoint_id uuid,
    capture_mode text,
    primary_device_id uuid,
    backup_method text,
    operator_label text,
    position integer
  ) on commit drop;
  truncate table timing_plan_input_points;

  insert into timing_plan_input_points (
    category_id,
    checkpoint_id,
    capture_mode,
    primary_device_id,
    backup_method,
    operator_label,
    position
  )
  select
    point.category_id,
    point.checkpoint_id,
    point.capture_mode,
    point.primary_device_id,
    nullif(trim(point.backup_method), ''),
    nullif(trim(point.operator_label), ''),
    point.ordinality::integer
  from rows from (
    jsonb_to_recordset(p_points) as (
      category_id uuid,
      checkpoint_id uuid,
      capture_mode text,
      primary_device_id uuid,
      backup_method text,
      operator_label text
    )
  ) with ordinality as point(
    category_id,
    checkpoint_id,
    capture_mode,
    primary_device_id,
    backup_method,
    operator_label,
    ordinality
  );

  if exists (
    select 1
    from timing_plan_input_points point
    left join public.checkpoints checkpoint on checkpoint.id = point.checkpoint_id
    left join public.event_categories category on category.id = point.category_id
    where point.capture_mode not in ('manual', 'device', 'import')
      or point.backup_method is null
      or checkpoint.id is null
      or category.id is null
      or checkpoint.event_category_id <> category.id
      or category.event_edition_id <> p_event_edition_id
      or (
        point.capture_mode = 'device'
        and not exists (
          select 1
          from public.timing_devices device
          where device.id = point.primary_device_id
            and device.organization_id = resolved_organization_id
            and device.status = 'active'
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'timing_plan_point_invalid';
  end if;

  if exists (
    select checkpoint.id
    from public.checkpoints checkpoint
    join public.event_categories category on category.id = checkpoint.event_category_id
    where category.event_edition_id = p_event_edition_id
      and category.results_mode <> 'informative_age'
      and checkpoint.is_mandatory
    except
    select point.checkpoint_id
    from timing_plan_input_points point
  ) then
    raise exception using errcode = 'P0001', message = 'timing_plan_mandatory_point_missing';
  end if;

  select count(*)::integer
  into mandatory_checkpoint_count
  from public.checkpoints checkpoint
  join public.event_categories category on category.id = checkpoint.event_category_id
  where category.event_edition_id = p_event_edition_id
    and category.results_mode <> 'informative_age'
    and checkpoint.is_mandatory;

  select coalesce(max(plan.version_number), 0) + 1
  into next_version
  from public.timing_plan_versions plan
  where plan.event_edition_id = p_event_edition_id;

  insert into public.timing_plan_versions (
    event_edition_id,
    version_number,
    name,
    digest,
    clock_tolerance_ms,
    plan_json,
    approved_by_user_id
  )
  values (
    p_event_edition_id,
    next_version,
    trim(p_name),
    plan_digest,
    p_clock_tolerance_ms,
    normalized_plan,
    p_actor_user_id
  )
  returning * into created_plan;

  for point_row in
    select *
    from timing_plan_input_points
    order by position
  loop
    point_position := point_position + 1;
    insert into public.timing_plan_points (
      timing_plan_id,
      event_category_id,
      checkpoint_id,
      capture_mode,
      primary_device_id,
      backup_method,
      operator_label,
      position
    )
    values (
      created_plan.id,
      point_row.category_id,
      point_row.checkpoint_id,
      point_row.capture_mode,
      point_row.primary_device_id,
      point_row.backup_method,
      point_row.operator_label,
      point_position
    );
  end loop;

  insert into public.edition_operational_controls (
    event_edition_id,
    current_timing_plan_id,
    timing_readiness_state,
    latest_rehearsal_id
  )
  values (
    p_event_edition_id,
    created_plan.id,
    'planned',
    null
  )
  on conflict (event_edition_id)
  do update set
    current_timing_plan_id = excluded.current_timing_plan_id,
    timing_readiness_state = excluded.timing_readiness_state,
    latest_rehearsal_id = null;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    resolved_organization_id,
    p_actor_user_id,
    'event_edition',
    p_event_edition_id,
    'timing_plan.approved',
    jsonb_build_object(
      'timingPlanId', created_plan.id,
      'versionNumber', created_plan.version_number,
      'pointCount', mandatory_checkpoint_count,
      'digest', created_plan.digest
    )
  );

  return jsonb_build_object(
    'timingPlanId', created_plan.id,
    'versionNumber', created_plan.version_number,
    'digest', created_plan.digest,
    'pointCount', jsonb_array_length(p_points),
    'replayed', false
  );
end;
$$;

create or replace function public.service_record_pre_race_rehearsal(
  p_event_edition_id uuid,
  p_actor_user_id uuid,
  p_passed boolean,
  p_checklist jsonb,
  p_issues jsonb,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  control_row public.edition_operational_controls%rowtype;
  created_rehearsal public.pre_race_rehearsals%rowtype;
  resolved_organization_id uuid;
begin
  if jsonb_typeof(p_checklist) <> 'object'
     or jsonb_typeof(coalesce(p_issues, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'rehearsal_input_invalid';
  end if;

  select control.*
  into control_row
  from public.edition_operational_controls control
  where control.event_edition_id = p_event_edition_id
  for update;

  if not found
     or control_row.start_list_state <> 'frozen'
     or control_row.current_manifest_id is null then
    raise exception using errcode = 'P0001', message = 'rehearsal_requires_frozen_manifest';
  end if;
  if control_row.current_timing_plan_id is null then
    raise exception using errcode = 'P0001', message = 'rehearsal_requires_timing_plan';
  end if;

  if p_passed and not (
    coalesce((p_checklist->>'manifestVerified')::boolean, false)
    and coalesce((p_checklist->>'clockSyncVerified')::boolean, false)
    and coalesce((p_checklist->>'backupCaptureVerified')::boolean, false)
    and coalesce((p_checklist->>'operatorBriefingComplete')::boolean, false)
    and coalesce((p_checklist->>'testPunchReconciled')::boolean, false)
  ) then
    raise exception using errcode = '22023', message = 'rehearsal_checklist_incomplete';
  end if;

  insert into public.pre_race_rehearsals (
    event_edition_id,
    start_list_manifest_id,
    timing_plan_id,
    status,
    checklist_json,
    issues_json,
    notes,
    completed_by_user_id
  )
  values (
    p_event_edition_id,
    control_row.current_manifest_id,
    control_row.current_timing_plan_id,
    case when p_passed then 'passed' else 'failed' end,
    p_checklist,
    coalesce(p_issues, '[]'::jsonb),
    nullif(trim(p_notes), ''),
    p_actor_user_id
  )
  returning * into created_rehearsal;

  update public.edition_operational_controls control
  set
    latest_rehearsal_id = created_rehearsal.id,
    timing_readiness_state = case when p_passed then 'ready' else 'failed' end
  where control.event_edition_id = p_event_edition_id;

  select series.organization_id
  into resolved_organization_id
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
    resolved_organization_id,
    p_actor_user_id,
    'event_edition',
    p_event_edition_id,
    case when p_passed then 'pre_race_rehearsal.passed' else 'pre_race_rehearsal.failed' end,
    jsonb_build_object(
      'rehearsalId', created_rehearsal.id,
      'manifestId', created_rehearsal.start_list_manifest_id,
      'timingPlanId', created_rehearsal.timing_plan_id,
      'issues', created_rehearsal.issues_json
    )
  );

  return jsonb_build_object(
    'rehearsalId', created_rehearsal.id,
    'status', created_rehearsal.status,
    'completedAt', created_rehearsal.completed_at,
    'timingReadinessState', case when p_passed then 'ready' else 'failed' end
  );
end;
$$;

alter table public.timing_plan_versions enable row level security;
alter table public.timing_plan_points enable row level security;
alter table public.pre_race_rehearsals enable row level security;

revoke all on table
  public.timing_plan_versions,
  public.timing_plan_points,
  public.pre_race_rehearsals
from public, anon, authenticated;

grant all on table
  public.timing_plan_versions,
  public.timing_plan_points,
  public.pre_race_rehearsals
to service_role;

revoke all on function public.reject_timing_snapshot_mutation()
  from public, anon, authenticated;
revoke all on function public.service_save_timing_device(
  uuid, uuid, text, text, text, integer, integer, text, jsonb
) from public, anon, authenticated;
revoke all on function public.service_publish_timing_plan(
  uuid, uuid, text, integer, jsonb
) from public, anon, authenticated;
revoke all on function public.service_record_pre_race_rehearsal(
  uuid, uuid, boolean, jsonb, jsonb, text
) from public, anon, authenticated;

grant execute on function public.service_save_timing_device(
  uuid, uuid, text, text, text, integer, integer, text, jsonb
) to service_role;
grant execute on function public.service_publish_timing_plan(
  uuid, uuid, text, integer, jsonb
) to service_role;
grant execute on function public.service_record_pre_race_rehearsal(
  uuid, uuid, boolean, jsonb, jsonb, text
) to service_role;
