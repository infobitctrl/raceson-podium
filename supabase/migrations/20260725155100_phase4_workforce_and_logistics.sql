create table public.event_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  event_category_id uuid references public.event_categories (id) on delete cascade,
  checkpoint_id uuid references public.checkpoints (id) on delete cascade,
  staff_user_id uuid,
  display_name text not null,
  worker_type text not null,
  role_code text not null,
  role_title text not null,
  access_scope text not null,
  assignment_state text not null default 'planned',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  lead_user_id uuid,
  briefing_required boolean not null default false,
  briefing_acknowledged_at timestamptz,
  briefing_acknowledged_by_user_id uuid,
  checked_in_at timestamptz,
  checked_in_by_user_id uuid,
  completed_at timestamptz,
  completed_by_user_id uuid,
  replacement_for_assignment_id uuid references public.event_staff_assignments (id) on delete restrict,
  instructions text,
  client_event_id uuid not null unique,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(display_name)) between 2 and 200),
  check (length(trim(role_code)) between 2 and 100),
  check (length(trim(role_title)) between 2 and 200),
  check (worker_type in ('staff', 'volunteer', 'contractor')),
  check (access_scope in ('operations', 'registration', 'timing', 'safety', 'logistics', 'communications')),
  check (assignment_state in ('planned', 'confirmed', 'checked_in', 'completed', 'no_show', 'replaced', 'cancelled')),
  check (ends_at > starts_at),
  check (
    (briefing_acknowledged_at is null and briefing_acknowledged_by_user_id is null)
    or (briefing_acknowledged_at is not null and briefing_acknowledged_by_user_id is not null)
  ),
  check (
    (checked_in_at is null and checked_in_by_user_id is null)
    or (checked_in_at is not null and checked_in_by_user_id is not null)
  ),
  check (
    (completed_at is null and completed_by_user_id is null)
    or (completed_at is not null and completed_by_user_id is not null)
  )
);

create index event_staff_assignments_edition_state_idx
  on public.event_staff_assignments (event_edition_id, assignment_state, starts_at);

create table public.event_staff_assignment_events (
  id uuid primary key default gen_random_uuid(),
  event_staff_assignment_id uuid not null references public.event_staff_assignments (id) on delete cascade,
  sequence_number integer not null,
  action_type text not null,
  from_state text,
  to_state text not null,
  note text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  client_event_id uuid not null unique,
  created_at timestamptz not null default now(),
  unique (event_staff_assignment_id, sequence_number),
  check (length(trim(note)) between 1 and 4000),
  check (jsonb_typeof(payload_json) = 'object')
);

create table public.event_operations_tasks (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  event_category_id uuid references public.event_categories (id) on delete cascade,
  checkpoint_id uuid references public.checkpoints (id) on delete cascade,
  title text not null,
  task_type text not null,
  criticality text not null,
  task_state text not null default 'planned',
  owner_assignment_id uuid references public.event_staff_assignments (id) on delete restrict,
  due_at timestamptz,
  evidence_required boolean not null default false,
  latest_evidence_json jsonb not null default '{}'::jsonb,
  dependency_task_ids uuid[] not null default '{}'::uuid[],
  client_event_id uuid not null unique,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(title)) between 3 and 240),
  check (length(trim(task_type)) between 2 and 100),
  check (criticality in ('routine', 'important', 'critical')),
  check (task_state in ('planned', 'ready', 'in_progress', 'blocked', 'done', 'waived')),
  check (jsonb_typeof(latest_evidence_json) = 'object'),
  check (criticality <> 'critical' or (owner_assignment_id is not null and due_at is not null))
);

create index event_operations_tasks_edition_state_idx
  on public.event_operations_tasks (event_edition_id, criticality, task_state, due_at);

create table public.event_operations_task_events (
  id uuid primary key default gen_random_uuid(),
  event_operations_task_id uuid not null references public.event_operations_tasks (id) on delete cascade,
  sequence_number integer not null,
  action_type text not null,
  from_state text,
  to_state text not null,
  note text not null,
  evidence_json jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  client_event_id uuid not null unique,
  created_at timestamptz not null default now(),
  unique (event_operations_task_id, sequence_number),
  check (length(trim(note)) between 1 and 4000),
  check (jsonb_typeof(evidence_json) = 'object')
);

create table public.event_inventory_items (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  item_name text not null,
  item_category text not null,
  unit_label text not null,
  is_critical boolean not null default false,
  reorder_threshold numeric(12, 2) not null default 0,
  total_quantity numeric(12, 2) not null,
  available_quantity numeric(12, 2) not null,
  allocated_quantity numeric(12, 2) not null default 0,
  field_quantity numeric(12, 2) not null default 0,
  item_state text not null default 'active',
  client_event_id uuid not null unique,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(item_name)) between 2 and 200),
  check (length(trim(item_category)) between 2 and 100),
  check (length(trim(unit_label)) between 1 and 40),
  check (item_state in ('active', 'retired')),
  check (
    total_quantity >= 0
    and available_quantity >= 0
    and allocated_quantity >= 0
    and field_quantity >= 0
    and reorder_threshold >= 0
  ),
  check (total_quantity = available_quantity + allocated_quantity + field_quantity)
);

create index event_inventory_items_edition_state_idx
  on public.event_inventory_items (event_edition_id, item_state, is_critical);

create table public.event_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  event_inventory_item_id uuid not null references public.event_inventory_items (id) on delete cascade,
  sequence_number integer not null,
  movement_type text not null,
  quantity numeric(12, 2) not null,
  checkpoint_id uuid references public.checkpoints (id) on delete restrict,
  location_label text,
  note text not null,
  before_json jsonb not null,
  after_json jsonb not null,
  created_by_user_id uuid,
  client_event_id uuid not null unique,
  created_at timestamptz not null default now(),
  unique (event_inventory_item_id, sequence_number),
  check (movement_type in ('stocked', 'allocate', 'release', 'dispatch', 'return', 'consume', 'damage', 'restock', 'adjust_loss')),
  check (quantity > 0),
  check (length(trim(note)) between 1 and 4000),
  check (jsonb_typeof(before_json) = 'object'),
  check (jsonb_typeof(after_json) = 'object')
);

create or replace function public.prevent_workforce_logistics_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'workforce_logistics_evidence_append_only';
end;
$$;

create trigger event_staff_assignment_events_append_only
before update or delete on public.event_staff_assignment_events
for each row execute function public.prevent_workforce_logistics_evidence_mutation();

create trigger event_operations_task_events_append_only
before update or delete on public.event_operations_task_events
for each row execute function public.prevent_workforce_logistics_evidence_mutation();

create trigger event_inventory_movements_append_only
before update or delete on public.event_inventory_movements
for each row execute function public.prevent_workforce_logistics_evidence_mutation();

create or replace function public.service_create_staff_assignment(
  p_event_edition_id uuid,
  p_event_category_id uuid,
  p_checkpoint_id uuid,
  p_staff_user_id uuid,
  p_display_name text,
  p_worker_type text,
  p_role_code text,
  p_role_title text,
  p_access_scope text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_lead_user_id uuid,
  p_briefing_required boolean,
  p_instructions text,
  p_replacement_for_assignment_id uuid,
  p_actor_user_id uuid,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_assignment public.event_staff_assignments%rowtype;
  created_assignment public.event_staff_assignments%rowtype;
  organization_id uuid;
begin
  if p_client_event_id is null
     or length(trim(coalesce(p_display_name, ''))) < 2
     or p_worker_type not in ('staff', 'volunteer', 'contractor')
     or length(trim(coalesce(p_role_code, ''))) < 2
     or length(trim(coalesce(p_role_title, ''))) < 2
     or p_access_scope not in ('operations', 'registration', 'timing', 'safety', 'logistics', 'communications')
     or p_starts_at is null
     or p_ends_at is null
     or p_ends_at <= p_starts_at then
    raise exception using errcode = '22023', message = 'staff_assignment_input_invalid';
  end if;

  select assignment.*
  into existing_assignment
  from public.event_staff_assignments assignment
  where assignment.client_event_id = p_client_event_id;
  if found then
    if existing_assignment.event_edition_id <> p_event_edition_id
       or existing_assignment.role_code <> trim(p_role_code) then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_assignment.id,
      'assignmentState', existing_assignment.assignment_state,
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
    raise exception using errcode = '22023', message = 'operations_scope_invalid';
  end if;
  if p_checkpoint_id is not null and not exists (
    select 1
    from public.checkpoints checkpoint
    join public.event_categories category on category.id = checkpoint.event_category_id
    where checkpoint.id = p_checkpoint_id
      and category.event_edition_id = p_event_edition_id
      and (p_event_category_id is null or checkpoint.event_category_id = p_event_category_id)
  ) then
    raise exception using errcode = '22023', message = 'operations_scope_invalid';
  end if;
  if p_replacement_for_assignment_id is not null and not exists (
    select 1
    from public.event_staff_assignments assignment
    where assignment.id = p_replacement_for_assignment_id
      and assignment.event_edition_id = p_event_edition_id
  ) then
    raise exception using errcode = '22023', message = 'operations_scope_invalid';
  end if;

  insert into public.event_staff_assignments (
    event_edition_id,
    event_category_id,
    checkpoint_id,
    staff_user_id,
    display_name,
    worker_type,
    role_code,
    role_title,
    access_scope,
    starts_at,
    ends_at,
    lead_user_id,
    briefing_required,
    instructions,
    replacement_for_assignment_id,
    client_event_id,
    created_by_user_id
  )
  values (
    p_event_edition_id,
    p_event_category_id,
    p_checkpoint_id,
    p_staff_user_id,
    trim(p_display_name),
    p_worker_type,
    trim(p_role_code),
    trim(p_role_title),
    p_access_scope,
    p_starts_at,
    p_ends_at,
    p_lead_user_id,
    coalesce(p_briefing_required, false),
    nullif(trim(p_instructions), ''),
    p_replacement_for_assignment_id,
    p_client_event_id,
    p_actor_user_id
  )
  returning * into created_assignment;

  insert into public.event_staff_assignment_events (
    event_staff_assignment_id,
    sequence_number,
    action_type,
    to_state,
    note,
    payload_json,
    created_by_user_id,
    client_event_id
  )
  values (
    created_assignment.id,
    1,
    'created',
    'planned',
    'Assignment created',
    jsonb_build_object(
      'roleCode', created_assignment.role_code,
      'accessScope', created_assignment.access_scope,
      'briefingRequired', created_assignment.briefing_required
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
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    organization_id,
    p_actor_user_id,
    'event_staff_assignment',
    created_assignment.id,
    'operations.staff_assignment_created',
    jsonb_build_object('roleCode', created_assignment.role_code, 'workerType', created_assignment.worker_type)
  );

  return jsonb_build_object(
    'id', created_assignment.id,
    'assignmentState', created_assignment.assignment_state,
    'briefingRequired', created_assignment.briefing_required,
    'replayed', false
  );
end;
$$;

create or replace function public.service_append_staff_assignment_event(
  p_event_staff_assignment_id uuid,
  p_actor_user_id uuid,
  p_action_type text,
  p_to_state text,
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
  assignment_row public.event_staff_assignments%rowtype;
  existing_event public.event_staff_assignment_events%rowtype;
  created_event public.event_staff_assignment_events%rowtype;
  next_sequence integer;
  target_state text;
begin
  if p_action_type not in (
       'confirm', 'briefing_acknowledgement', 'check_in', 'complete', 'no_show', 'replace', 'cancel', 'note'
     )
     or nullif(trim(p_note), '') is null
     or coalesce(jsonb_typeof(p_payload_json), 'object') <> 'object'
     or p_client_event_id is null then
    raise exception using errcode = '22023', message = 'staff_assignment_event_input_invalid';
  end if;

  select assignment_event.*
  into existing_event
  from public.event_staff_assignment_events assignment_event
  where assignment_event.client_event_id = p_client_event_id;
  if found then
    if existing_event.event_staff_assignment_id <> p_event_staff_assignment_id
       or existing_event.action_type <> p_action_type then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_event.id,
      'assignmentState', existing_event.to_state,
      'sequenceNumber', existing_event.sequence_number,
      'replayed', true
    );
  end if;

  select assignment.*
  into assignment_row
  from public.event_staff_assignments assignment
  where assignment.id = p_event_staff_assignment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'staff_assignment_not_found';
  end if;

  target_state := coalesce(nullif(trim(p_to_state), ''), assignment_row.assignment_state);
  if target_state not in ('planned', 'confirmed', 'checked_in', 'completed', 'no_show', 'replaced', 'cancelled') then
    raise exception using errcode = '22023', message = 'staff_assignment_state_invalid';
  end if;
  if target_state <> assignment_row.assignment_state and not (
    (assignment_row.assignment_state = 'planned' and target_state in ('confirmed', 'cancelled'))
    or (assignment_row.assignment_state = 'confirmed' and target_state in ('checked_in', 'no_show', 'replaced', 'cancelled'))
    or (assignment_row.assignment_state = 'checked_in' and target_state in ('completed', 'replaced'))
    or (assignment_row.assignment_state = 'no_show' and target_state = 'replaced')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'staff_assignment_transition_invalid',
      detail = assignment_row.assignment_state || ' -> ' || target_state;
  end if;
  if target_state = 'checked_in'
     and assignment_row.briefing_required
     and assignment_row.briefing_acknowledged_at is null
     and p_action_type <> 'briefing_acknowledgement' then
    raise exception using errcode = 'P0001', message = 'staff_briefing_acknowledgement_required';
  end if;

  select coalesce(max(assignment_event.sequence_number), 0) + 1
  into next_sequence
  from public.event_staff_assignment_events assignment_event
  where assignment_event.event_staff_assignment_id = assignment_row.id;

  insert into public.event_staff_assignment_events (
    event_staff_assignment_id,
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
    assignment_row.id,
    next_sequence,
    p_action_type,
    assignment_row.assignment_state,
    target_state,
    trim(p_note),
    coalesce(p_payload_json, '{}'::jsonb),
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_event;

  update public.event_staff_assignments
  set
    assignment_state = target_state,
    briefing_acknowledged_at = case
      when p_action_type = 'briefing_acknowledgement' then coalesce(briefing_acknowledged_at, clock_timestamp())
      else briefing_acknowledged_at
    end,
    briefing_acknowledged_by_user_id = case
      when p_action_type = 'briefing_acknowledgement' then coalesce(briefing_acknowledged_by_user_id, p_actor_user_id)
      else briefing_acknowledged_by_user_id
    end,
    checked_in_at = case when target_state = 'checked_in' then coalesce(checked_in_at, clock_timestamp()) else checked_in_at end,
    checked_in_by_user_id = case when target_state = 'checked_in' then coalesce(checked_in_by_user_id, p_actor_user_id) else checked_in_by_user_id end,
    completed_at = case when target_state = 'completed' then clock_timestamp() else completed_at end,
    completed_by_user_id = case when target_state = 'completed' then p_actor_user_id else completed_by_user_id end,
    updated_at = clock_timestamp()
  where id = assignment_row.id
  returning * into assignment_row;

  return jsonb_build_object(
    'id', created_event.id,
    'assignmentId', assignment_row.id,
    'assignmentState', assignment_row.assignment_state,
    'briefingAcknowledgedAt', assignment_row.briefing_acknowledged_at,
    'sequenceNumber', created_event.sequence_number,
    'replayed', false
  );
end;
$$;

create or replace function public.service_create_operations_task(
  p_event_edition_id uuid,
  p_event_category_id uuid,
  p_checkpoint_id uuid,
  p_title text,
  p_task_type text,
  p_criticality text,
  p_owner_assignment_id uuid,
  p_due_at timestamptz,
  p_evidence_required boolean,
  p_dependency_task_ids uuid[],
  p_actor_user_id uuid,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_task public.event_operations_tasks%rowtype;
  created_task public.event_operations_tasks%rowtype;
begin
  if p_client_event_id is null
     or length(trim(coalesce(p_title, ''))) < 3
     or length(trim(coalesce(p_task_type, ''))) < 2
     or p_criticality not in ('routine', 'important', 'critical')
     or (p_criticality = 'critical' and (p_owner_assignment_id is null or p_due_at is null)) then
    raise exception using errcode = '22023', message = 'operations_task_input_invalid';
  end if;

  select task.*
  into existing_task
  from public.event_operations_tasks task
  where task.client_event_id = p_client_event_id;
  if found then
    if existing_task.event_edition_id <> p_event_edition_id
       or existing_task.title <> trim(p_title) then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object('id', existing_task.id, 'taskState', existing_task.task_state, 'replayed', true);
  end if;

  perform 1 from public.event_editions edition where edition.id = p_event_edition_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;
  if p_event_category_id is not null and not exists (
    select 1 from public.event_categories category
    where category.id = p_event_category_id and category.event_edition_id = p_event_edition_id
  ) then
    raise exception using errcode = '22023', message = 'operations_scope_invalid';
  end if;
  if p_checkpoint_id is not null and not exists (
    select 1
    from public.checkpoints checkpoint
    join public.event_categories category on category.id = checkpoint.event_category_id
    where checkpoint.id = p_checkpoint_id
      and category.event_edition_id = p_event_edition_id
      and (p_event_category_id is null or checkpoint.event_category_id = p_event_category_id)
  ) then
    raise exception using errcode = '22023', message = 'operations_scope_invalid';
  end if;
  if p_owner_assignment_id is not null and not exists (
    select 1 from public.event_staff_assignments assignment
    where assignment.id = p_owner_assignment_id and assignment.event_edition_id = p_event_edition_id
  ) then
    raise exception using errcode = '22023', message = 'operations_scope_invalid';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_dependency_task_ids, '{}'::uuid[])) dependency_id
    where not exists (
      select 1 from public.event_operations_tasks dependency
      where dependency.id = dependency_id and dependency.event_edition_id = p_event_edition_id
    )
  ) then
    raise exception using errcode = '22023', message = 'operations_scope_invalid';
  end if;

  insert into public.event_operations_tasks (
    event_edition_id,
    event_category_id,
    checkpoint_id,
    title,
    task_type,
    criticality,
    owner_assignment_id,
    due_at,
    evidence_required,
    dependency_task_ids,
    client_event_id,
    created_by_user_id
  )
  values (
    p_event_edition_id,
    p_event_category_id,
    p_checkpoint_id,
    trim(p_title),
    trim(p_task_type),
    p_criticality,
    p_owner_assignment_id,
    p_due_at,
    coalesce(p_evidence_required, false),
    coalesce(p_dependency_task_ids, '{}'::uuid[]),
    p_client_event_id,
    p_actor_user_id
  )
  returning * into created_task;

  insert into public.event_operations_task_events (
    event_operations_task_id, sequence_number, action_type, to_state, note, evidence_json,
    created_by_user_id, client_event_id
  )
  values (
    created_task.id, 1, 'created', 'planned', 'Task created', '{}'::jsonb,
    p_actor_user_id, gen_random_uuid()
  );

  return jsonb_build_object(
    'id', created_task.id,
    'taskState', created_task.task_state,
    'criticality', created_task.criticality,
    'replayed', false
  );
end;
$$;

create or replace function public.service_append_operations_task_event(
  p_event_operations_task_id uuid,
  p_actor_user_id uuid,
  p_action_type text,
  p_to_state text,
  p_note text,
  p_evidence_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.event_operations_tasks%rowtype;
  existing_event public.event_operations_task_events%rowtype;
  created_event public.event_operations_task_events%rowtype;
  next_sequence integer;
  target_state text;
begin
  if p_action_type not in ('ready', 'start', 'block', 'complete', 'waive', 'reopen', 'note')
     or nullif(trim(p_note), '') is null
     or coalesce(jsonb_typeof(p_evidence_json), 'object') <> 'object'
     or p_client_event_id is null then
    raise exception using errcode = '22023', message = 'operations_task_event_input_invalid';
  end if;

  select task_event.*
  into existing_event
  from public.event_operations_task_events task_event
  where task_event.client_event_id = p_client_event_id;
  if found then
    if existing_event.event_operations_task_id <> p_event_operations_task_id
       or existing_event.action_type <> p_action_type then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_event.id,
      'taskState', existing_event.to_state,
      'sequenceNumber', existing_event.sequence_number,
      'replayed', true
    );
  end if;

  select task.*
  into task_row
  from public.event_operations_tasks task
  where task.id = p_event_operations_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'operations_task_not_found';
  end if;

  target_state := coalesce(nullif(trim(p_to_state), ''), task_row.task_state);
  if target_state not in ('planned', 'ready', 'in_progress', 'blocked', 'done', 'waived') then
    raise exception using errcode = '22023', message = 'operations_task_state_invalid';
  end if;
  if target_state <> task_row.task_state and not (
    (task_row.task_state = 'planned' and target_state in ('ready', 'in_progress', 'blocked', 'waived'))
    or (task_row.task_state = 'ready' and target_state in ('in_progress', 'blocked', 'done', 'waived'))
    or (task_row.task_state = 'in_progress' and target_state in ('blocked', 'done', 'waived'))
    or (task_row.task_state = 'blocked' and target_state in ('in_progress', 'waived'))
    or (task_row.task_state in ('done', 'waived') and target_state = 'in_progress')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'operations_task_transition_invalid',
      detail = task_row.task_state || ' -> ' || target_state;
  end if;
  if target_state = 'done'
     and task_row.evidence_required
     and coalesce(p_evidence_json, '{}'::jsonb) = '{}'::jsonb then
    raise exception using errcode = 'P0001', message = 'operations_task_evidence_required';
  end if;
  if target_state in ('ready', 'in_progress', 'done')
     and exists (
       select 1
       from unnest(task_row.dependency_task_ids) dependency_id
       join public.event_operations_tasks dependency on dependency.id = dependency_id
       where dependency.task_state not in ('done', 'waived')
     ) then
    raise exception using errcode = 'P0001', message = 'operations_task_dependencies_open';
  end if;

  select coalesce(max(task_event.sequence_number), 0) + 1
  into next_sequence
  from public.event_operations_task_events task_event
  where task_event.event_operations_task_id = task_row.id;

  insert into public.event_operations_task_events (
    event_operations_task_id, sequence_number, action_type, from_state, to_state, note,
    evidence_json, created_by_user_id, client_event_id
  )
  values (
    task_row.id, next_sequence, p_action_type, task_row.task_state, target_state, trim(p_note),
    coalesce(p_evidence_json, '{}'::jsonb), p_actor_user_id, p_client_event_id
  )
  returning * into created_event;

  update public.event_operations_tasks
  set
    task_state = target_state,
    latest_evidence_json = case
      when coalesce(p_evidence_json, '{}'::jsonb) <> '{}'::jsonb then p_evidence_json
      else latest_evidence_json
    end,
    updated_at = clock_timestamp()
  where id = task_row.id
  returning * into task_row;

  return jsonb_build_object(
    'id', created_event.id,
    'taskId', task_row.id,
    'taskState', task_row.task_state,
    'sequenceNumber', created_event.sequence_number,
    'replayed', false
  );
end;
$$;

create or replace function public.service_create_event_inventory_item(
  p_event_edition_id uuid,
  p_item_name text,
  p_item_category text,
  p_unit_label text,
  p_is_critical boolean,
  p_reorder_threshold numeric,
  p_initial_quantity numeric,
  p_actor_user_id uuid,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_item public.event_inventory_items%rowtype;
  created_item public.event_inventory_items%rowtype;
begin
  if p_client_event_id is null
     or length(trim(coalesce(p_item_name, ''))) < 2
     or length(trim(coalesce(p_item_category, ''))) < 2
     or length(trim(coalesce(p_unit_label, ''))) < 1
     or p_initial_quantity is null
     or p_initial_quantity < 0
     or coalesce(p_reorder_threshold, 0) < 0 then
    raise exception using errcode = '22023', message = 'inventory_item_input_invalid';
  end if;

  select item.*
  into existing_item
  from public.event_inventory_items item
  where item.client_event_id = p_client_event_id;
  if found then
    if existing_item.event_edition_id <> p_event_edition_id
       or existing_item.item_name <> trim(p_item_name) then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object('id', existing_item.id, 'replayed', true);
  end if;

  perform 1 from public.event_editions edition where edition.id = p_event_edition_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  insert into public.event_inventory_items (
    event_edition_id,
    item_name,
    item_category,
    unit_label,
    is_critical,
    reorder_threshold,
    total_quantity,
    available_quantity,
    client_event_id,
    created_by_user_id
  )
  values (
    p_event_edition_id,
    trim(p_item_name),
    trim(p_item_category),
    trim(p_unit_label),
    coalesce(p_is_critical, false),
    coalesce(p_reorder_threshold, 0),
    p_initial_quantity,
    p_initial_quantity,
    p_client_event_id,
    p_actor_user_id
  )
  returning * into created_item;

  if p_initial_quantity > 0 then
    insert into public.event_inventory_movements (
      event_inventory_item_id, sequence_number, movement_type, quantity, note,
      before_json, after_json, created_by_user_id, client_event_id
    )
    values (
      created_item.id,
      1,
      'stocked',
      p_initial_quantity,
      'Initial stock',
      '{"total":0,"available":0,"allocated":0,"field":0}'::jsonb,
      jsonb_build_object(
        'total', created_item.total_quantity,
        'available', created_item.available_quantity,
        'allocated', created_item.allocated_quantity,
        'field', created_item.field_quantity
      ),
      p_actor_user_id,
      gen_random_uuid()
    );
  end if;

  return jsonb_build_object(
    'id', created_item.id,
    'totalQuantity', created_item.total_quantity,
    'availableQuantity', created_item.available_quantity,
    'replayed', false
  );
end;
$$;

create or replace function public.service_record_inventory_movement(
  p_event_inventory_item_id uuid,
  p_actor_user_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_checkpoint_id uuid,
  p_location_label text,
  p_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row public.event_inventory_items%rowtype;
  existing_movement public.event_inventory_movements%rowtype;
  created_movement public.event_inventory_movements%rowtype;
  next_sequence integer;
  next_total numeric(12, 2);
  next_available numeric(12, 2);
  next_allocated numeric(12, 2);
  next_field numeric(12, 2);
  before_snapshot jsonb;
  after_snapshot jsonb;
begin
  if p_movement_type not in ('allocate', 'release', 'dispatch', 'return', 'consume', 'damage', 'restock', 'adjust_loss')
     or p_quantity is null
     or p_quantity <= 0
     or nullif(trim(p_note), '') is null
     or p_client_event_id is null then
    raise exception using errcode = '22023', message = 'inventory_movement_input_invalid';
  end if;

  select movement.*
  into existing_movement
  from public.event_inventory_movements movement
  where movement.client_event_id = p_client_event_id;
  if found then
    if existing_movement.event_inventory_item_id <> p_event_inventory_item_id
       or existing_movement.movement_type <> p_movement_type then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_movement.id,
      'sequenceNumber', existing_movement.sequence_number,
      'replayed', true
    );
  end if;

  select item.*
  into item_row
  from public.event_inventory_items item
  where item.id = p_event_inventory_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'inventory_item_not_found';
  end if;
  if item_row.item_state <> 'active' then
    raise exception using errcode = 'P0001', message = 'inventory_item_not_active';
  end if;
  if p_checkpoint_id is not null and not exists (
    select 1
    from public.checkpoints checkpoint
    join public.event_categories category on category.id = checkpoint.event_category_id
    where checkpoint.id = p_checkpoint_id
      and category.event_edition_id = item_row.event_edition_id
  ) then
    raise exception using errcode = '22023', message = 'operations_scope_invalid';
  end if;

  next_total := item_row.total_quantity;
  next_available := item_row.available_quantity;
  next_allocated := item_row.allocated_quantity;
  next_field := item_row.field_quantity;

  case p_movement_type
    when 'allocate' then
      next_available := next_available - p_quantity;
      next_allocated := next_allocated + p_quantity;
    when 'release' then
      next_allocated := next_allocated - p_quantity;
      next_available := next_available + p_quantity;
    when 'dispatch' then
      next_allocated := next_allocated - p_quantity;
      next_field := next_field + p_quantity;
    when 'return' then
      next_field := next_field - p_quantity;
      next_available := next_available + p_quantity;
    when 'consume' then
      next_field := next_field - p_quantity;
      next_total := next_total - p_quantity;
    when 'damage' then
      next_field := next_field - p_quantity;
      next_total := next_total - p_quantity;
    when 'restock' then
      next_total := next_total + p_quantity;
      next_available := next_available + p_quantity;
    when 'adjust_loss' then
      next_available := next_available - p_quantity;
      next_total := next_total - p_quantity;
    else
      raise exception using errcode = '22023', message = 'inventory_movement_input_invalid';
  end case;

  if least(next_total, next_available, next_allocated, next_field) < 0
     or next_total <> next_available + next_allocated + next_field then
    raise exception using errcode = 'P0001', message = 'inventory_quantity_insufficient';
  end if;

  before_snapshot := jsonb_build_object(
    'total', item_row.total_quantity,
    'available', item_row.available_quantity,
    'allocated', item_row.allocated_quantity,
    'field', item_row.field_quantity
  );
  after_snapshot := jsonb_build_object(
    'total', next_total,
    'available', next_available,
    'allocated', next_allocated,
    'field', next_field
  );

  select coalesce(max(movement.sequence_number), 0) + 1
  into next_sequence
  from public.event_inventory_movements movement
  where movement.event_inventory_item_id = item_row.id;

  insert into public.event_inventory_movements (
    event_inventory_item_id, sequence_number, movement_type, quantity, checkpoint_id,
    location_label, note, before_json, after_json, created_by_user_id, client_event_id
  )
  values (
    item_row.id,
    next_sequence,
    p_movement_type,
    p_quantity,
    p_checkpoint_id,
    nullif(trim(p_location_label), ''),
    trim(p_note),
    before_snapshot,
    after_snapshot,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_movement;

  update public.event_inventory_items
  set
    total_quantity = next_total,
    available_quantity = next_available,
    allocated_quantity = next_allocated,
    field_quantity = next_field,
    updated_at = clock_timestamp()
  where id = item_row.id;

  return jsonb_build_object(
    'id', created_movement.id,
    'itemId', item_row.id,
    'sequenceNumber', created_movement.sequence_number,
    'movementType', created_movement.movement_type,
    'after', after_snapshot,
    'replayed', false
  );
end;
$$;

create or replace function public.block_race_start_for_operations_readiness()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_type in ('actual_start', 'restart') and exists (
    select 1
    from public.event_operations_tasks task
    where task.event_edition_id = new.event_edition_id
      and (task.event_category_id is null or task.event_category_id = new.event_category_id)
      and task.criticality = 'critical'
      and task.task_state not in ('done', 'waived')
  ) then
    raise exception using errcode = 'P0001', message = 'critical_operations_task_blocks_start';
  end if;
  if new.event_type in ('actual_start', 'restart') and exists (
    select 1
    from public.event_inventory_items item
    where item.event_edition_id = new.event_edition_id
      and item.item_state = 'active'
      and item.is_critical
      and item.total_quantity < item.reorder_threshold
  ) then
    raise exception using errcode = 'P0001', message = 'critical_inventory_shortage_blocks_start';
  end if;
  return new;
end;
$$;

create trigger race_start_events_block_operations_readiness
before insert on public.race_start_events
for each row execute function public.block_race_start_for_operations_readiness();

alter table public.event_staff_assignments enable row level security;
alter table public.event_staff_assignment_events enable row level security;
alter table public.event_operations_tasks enable row level security;
alter table public.event_operations_task_events enable row level security;
alter table public.event_inventory_items enable row level security;
alter table public.event_inventory_movements enable row level security;

revoke all on table public.event_staff_assignments from public, anon, authenticated;
revoke all on table public.event_staff_assignment_events from public, anon, authenticated;
revoke all on table public.event_operations_tasks from public, anon, authenticated;
revoke all on table public.event_operations_task_events from public, anon, authenticated;
revoke all on table public.event_inventory_items from public, anon, authenticated;
revoke all on table public.event_inventory_movements from public, anon, authenticated;

grant all on table public.event_staff_assignments to service_role;
grant all on table public.event_staff_assignment_events to service_role;
grant all on table public.event_operations_tasks to service_role;
grant all on table public.event_operations_task_events to service_role;
grant all on table public.event_inventory_items to service_role;
grant all on table public.event_inventory_movements to service_role;

revoke all on function public.service_create_staff_assignment(
  uuid, uuid, uuid, uuid, text, text, text, text, text, timestamptz, timestamptz,
  uuid, boolean, text, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.service_append_staff_assignment_event(
  uuid, uuid, text, text, text, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.service_create_operations_task(
  uuid, uuid, uuid, text, text, text, uuid, timestamptz, boolean, uuid[], uuid, uuid
) from public, anon, authenticated;
revoke all on function public.service_append_operations_task_event(
  uuid, uuid, text, text, text, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.service_create_event_inventory_item(
  uuid, text, text, text, boolean, numeric, numeric, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.service_record_inventory_movement(
  uuid, uuid, text, numeric, uuid, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.service_create_staff_assignment(
  uuid, uuid, uuid, uuid, text, text, text, text, text, timestamptz, timestamptz,
  uuid, boolean, text, uuid, uuid, uuid
) to service_role;
grant execute on function public.service_append_staff_assignment_event(
  uuid, uuid, text, text, text, jsonb, uuid
) to service_role;
grant execute on function public.service_create_operations_task(
  uuid, uuid, uuid, text, text, text, uuid, timestamptz, boolean, uuid[], uuid, uuid
) to service_role;
grant execute on function public.service_append_operations_task_event(
  uuid, uuid, text, text, text, jsonb, uuid
) to service_role;
grant execute on function public.service_create_event_inventory_item(
  uuid, text, text, text, boolean, numeric, numeric, uuid, uuid
) to service_role;
grant execute on function public.service_record_inventory_movement(
  uuid, uuid, text, numeric, uuid, text, text, uuid
) to service_role;
