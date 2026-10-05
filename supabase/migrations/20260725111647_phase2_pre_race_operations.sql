/*
 * Phase 2 pre-race control plane:
 * - deterministic, replay-safe bulk bib allocation
 * - immutable, versioned start-list manifests
 * - explicit freeze/reopen state with audited change control
 */

create table public.bib_allocation_runs (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  event_category_id uuid not null references public.event_categories (id) on delete cascade,
  idempotency_key_hash text not null,
  request_hash text not null,
  start_number integer not null,
  prefix text not null default '',
  padding integer not null default 0,
  assigned_count integer not null default 0,
  first_bib text,
  last_bib text,
  requested_by_user_id uuid,
  created_at timestamptz not null default now(),
  unique (event_edition_id, idempotency_key_hash),
  check (length(idempotency_key_hash) = 64),
  check (length(request_hash) = 64),
  check (start_number > 0),
  check (length(prefix) <= 12),
  check (padding between 0 and 8),
  check (assigned_count >= 0)
);

create index bib_allocation_runs_category_created_idx
  on public.bib_allocation_runs (event_category_id, created_at desc);

create table public.start_list_manifests (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  version_number integer not null,
  digest text not null,
  entry_count integer not null,
  snapshot_json jsonb not null,
  freeze_note text,
  frozen_by_user_id uuid,
  frozen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (event_edition_id, version_number),
  check (version_number > 0),
  check (digest ~ '^[a-f0-9]{64}$'),
  check (entry_count >= 0),
  check (jsonb_typeof(snapshot_json) = 'array')
);

create index start_list_manifests_edition_frozen_idx
  on public.start_list_manifests (event_edition_id, frozen_at desc);

create table public.start_list_manifest_entries (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references public.start_list_manifests (id) on delete cascade,
  registration_id uuid not null references public.registrations (id),
  event_category_id uuid not null references public.event_categories (id),
  athlete_profile_id uuid not null references public.athlete_profiles (id),
  bib_number text not null,
  athlete_name text not null,
  category_name text not null,
  gender text,
  date_of_birth date,
  represented_club_name text,
  phone text,
  emergency_contact_name text,
  emergency_contact_phone text,
  captured_registration_status text not null,
  captured_payment_status text not null,
  captured_participation_status text not null,
  created_at timestamptz not null default now(),
  unique (manifest_id, registration_id),
  unique (manifest_id, bib_number),
  check (length(trim(bib_number)) > 0),
  check (length(trim(athlete_name)) > 0),
  check (length(trim(category_name)) > 0)
);

create index start_list_manifest_entries_category_bib_idx
  on public.start_list_manifest_entries (manifest_id, event_category_id, bib_number);

create table public.edition_operational_controls (
  event_edition_id uuid primary key references public.event_editions (id) on delete cascade,
  start_list_state text not null default 'open',
  current_manifest_id uuid references public.start_list_manifests (id),
  frozen_at timestamptz,
  frozen_by_user_id uuid,
  reopened_at timestamptz,
  reopened_by_user_id uuid,
  reopen_reason text,
  updated_at timestamptz not null default now(),
  check (start_list_state in ('open', 'frozen', 'reopened')),
  check (
    (start_list_state = 'frozen' and current_manifest_id is not null and frozen_at is not null)
    or start_list_state <> 'frozen'
  )
);

create trigger edition_operational_controls_set_updated_at
before update on public.edition_operational_controls
for each row execute function public.set_updated_at();

create or replace function public.reject_start_list_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'start_list_snapshot_is_immutable';
end;
$$;

create trigger start_list_manifests_immutable
before update or delete on public.start_list_manifests
for each row execute function public.reject_start_list_snapshot_mutation();

create trigger start_list_manifest_entries_immutable
before update or delete on public.start_list_manifest_entries
for each row execute function public.reject_start_list_snapshot_mutation();

create or replace function public.service_allocate_category_bibs(
  p_event_category_id uuid,
  p_actor_user_id uuid,
  p_start_number integer,
  p_prefix text,
  p_padding integer,
  p_idempotency_key_hash text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_row public.event_categories%rowtype;
  existing_run public.bib_allocation_runs%rowtype;
  registration_row record;
  created_run public.bib_allocation_runs%rowtype;
  next_number integer;
  candidate_bib text;
  assigned_count integer := 0;
  first_bib text;
  last_bib text;
  control_state text;
begin
  if p_start_number is null or p_start_number < 1
     or p_padding is null or p_padding < 0 or p_padding > 8
     or length(coalesce(p_prefix, '')) > 12
     or p_idempotency_key_hash !~ '^[a-f0-9]{64}$'
     or p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'bib_allocation_input_invalid';
  end if;

  select category.*
  into category_row
  from public.event_categories category
  where category.id = p_event_category_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bib-edition:' || category_row.event_edition_id::text, 0)
  );

  select allocation.*
  into existing_run
  from public.bib_allocation_runs allocation
  where allocation.event_edition_id = category_row.event_edition_id
    and allocation.idempotency_key_hash = p_idempotency_key_hash;

  if found then
    if existing_run.request_hash <> p_request_hash then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'runId', existing_run.id,
      'assignedCount', existing_run.assigned_count,
      'firstBib', existing_run.first_bib,
      'lastBib', existing_run.last_bib,
      'replayed', true
    );
  end if;

  select control.start_list_state
  into control_state
  from public.edition_operational_controls control
  where control.event_edition_id = category_row.event_edition_id;

  if control_state = 'frozen' then
    raise exception using errcode = 'P0001', message = 'start_list_is_frozen';
  end if;

  next_number := p_start_number;
  for registration_row in
    select
      registration.id,
      athlete.last_name,
      athlete.first_name
    from public.registrations registration
    join public.athlete_profiles athlete on athlete.id = registration.athlete_profile_id
    where registration.event_category_id = p_event_category_id
      and registration.status = 'confirmed'
      and registration.payment_status in ('paid', 'not_required')
      and not exists (
        select 1
        from public.bib_assignments assignment
        where assignment.registration_id = registration.id
          and assignment.revoked_at is null
      )
    order by
      lower(athlete.last_name),
      lower(athlete.first_name),
      registration.created_at,
      registration.id
    for update of registration
  loop
    loop
      candidate_bib :=
        coalesce(p_prefix, '')
        || case
          when p_padding > 0 then lpad(next_number::text, p_padding, '0')
          else next_number::text
        end;

      exit when not exists (
        select 1
        from public.bib_assignments assignment
        where assignment.event_edition_id = category_row.event_edition_id
          and assignment.bib_number = candidate_bib
          and assignment.revoked_at is null
      );
      next_number := next_number + 1;
    end loop;

    insert into public.bib_assignments (
      registration_id,
      event_edition_id,
      event_category_id,
      bib_number,
      scope,
      assigned_by_user_id
    )
    values (
      registration_row.id,
      category_row.event_edition_id,
      category_row.id,
      candidate_bib,
      'edition',
      p_actor_user_id
    );

    assigned_count := assigned_count + 1;
    first_bib := coalesce(first_bib, candidate_bib);
    last_bib := candidate_bib;
    next_number := next_number + 1;
  end loop;

  insert into public.bib_allocation_runs (
    event_edition_id,
    event_category_id,
    idempotency_key_hash,
    request_hash,
    start_number,
    prefix,
    padding,
    assigned_count,
    first_bib,
    last_bib,
    requested_by_user_id
  )
  values (
    category_row.event_edition_id,
    category_row.id,
    p_idempotency_key_hash,
    p_request_hash,
    p_start_number,
    coalesce(p_prefix, ''),
    p_padding,
    assigned_count,
    first_bib,
    last_bib,
    p_actor_user_id
  )
  returning * into created_run;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  select
    series.organization_id,
    p_actor_user_id,
    'event_category',
    category_row.id,
    'bibs.allocated',
    jsonb_build_object(
      'runId', created_run.id,
      'assignedCount', assigned_count,
      'firstBib', first_bib,
      'lastBib', last_bib
    )
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = category_row.event_edition_id;

  return jsonb_build_object(
    'runId', created_run.id,
    'assignedCount', assigned_count,
    'firstBib', first_bib,
    'lastBib', last_bib,
    'replayed', false
  );
end;
$$;

create or replace function public.service_freeze_start_list_manifest(
  p_event_edition_id uuid,
  p_actor_user_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  edition_row public.event_editions%rowtype;
  next_version integer;
  manifest_snapshot jsonb;
  manifest_digest text;
  created_manifest public.start_list_manifests%rowtype;
  existing_manifest public.start_list_manifests%rowtype;
  eligible_count integer;
  missing_bib_count integer;
  missing_start_count integer;
  missing_checkpoint_count integer;
  resolved_organization_id uuid;
begin
  select edition.*
  into edition_row
  from public.event_editions edition
  where edition.id = p_event_edition_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('start-list:' || p_event_edition_id::text, 0)
  );

  select manifest.*
  into existing_manifest
  from public.edition_operational_controls control
  join public.start_list_manifests manifest on manifest.id = control.current_manifest_id
  where control.event_edition_id = p_event_edition_id
    and control.start_list_state = 'frozen';

  if found then
    return jsonb_build_object(
      'manifestId', existing_manifest.id,
      'versionNumber', existing_manifest.version_number,
      'entryCount', existing_manifest.entry_count,
      'digest', existing_manifest.digest,
      'frozenAt', existing_manifest.frozen_at,
      'replayed', true
    );
  end if;

  select count(*)::integer
  into eligible_count
  from public.registrations registration
  join public.event_categories category on category.id = registration.event_category_id
  where category.event_edition_id = p_event_edition_id
    and category.results_mode <> 'informative_age'
    and registration.status = 'confirmed'
    and registration.payment_status in ('paid', 'not_required');

  if eligible_count = 0 then
    raise exception using errcode = 'P0001', message = 'start_list_has_no_confirmed_entries';
  end if;

  select count(*)::integer
  into missing_bib_count
  from public.registrations registration
  join public.event_categories category on category.id = registration.event_category_id
  where category.event_edition_id = p_event_edition_id
    and category.results_mode <> 'informative_age'
    and registration.status = 'confirmed'
    and registration.payment_status in ('paid', 'not_required')
    and not exists (
      select 1
      from public.bib_assignments assignment
      where assignment.registration_id = registration.id
        and assignment.revoked_at is null
    );

  if missing_bib_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'start_list_missing_bibs',
      detail = missing_bib_count::text;
  end if;

  select count(*)::integer
  into missing_start_count
  from public.event_categories category
  where category.event_edition_id = p_event_edition_id
    and category.results_mode <> 'informative_age'
    and category.status in ('published', 'closed')
    and category.start_at is null;

  if missing_start_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'start_list_missing_start_times',
      detail = missing_start_count::text;
  end if;

  select count(*)::integer
  into missing_checkpoint_count
  from public.event_categories category
  where category.event_edition_id = p_event_edition_id
    and category.results_mode <> 'informative_age'
    and category.status in ('published', 'closed')
    and (
      not exists (
        select 1
        from public.checkpoints checkpoint
        where checkpoint.event_category_id = category.id
          and checkpoint.checkpoint_type = 'start'
      )
      or not exists (
        select 1
        from public.checkpoints checkpoint
        where checkpoint.event_category_id = category.id
          and checkpoint.checkpoint_type = 'finish'
      )
    );

  if missing_checkpoint_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'start_list_missing_start_finish_checkpoints',
      detail = missing_checkpoint_count::text;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'registrationId', registration.id,
        'categoryId', category.id,
        'categoryName', category.name,
        'athleteProfileId', athlete.id,
        'athleteName', athlete.display_name,
        'bibNumber', assignment.bib_number,
        'gender', athlete.gender,
        'dateOfBirth', athlete.date_of_birth,
        'representedClubName', club.name,
        'phone', registration_profile.phone,
        'emergencyContactName', registration_profile.emergency_contact_name,
        'emergencyContactPhone', registration_profile.emergency_contact_phone,
        'registrationStatus', registration.status,
        'paymentStatus', registration.payment_status,
        'participationStatus', registration.participation_status
      )
      order by category.display_order, category.name, assignment.bib_number, registration.id
    ),
    '[]'::jsonb
  )
  into manifest_snapshot
  from public.registrations registration
  join public.event_categories category on category.id = registration.event_category_id
  join public.athlete_profiles athlete on athlete.id = registration.athlete_profile_id
  join public.bib_assignments assignment
    on assignment.registration_id = registration.id
   and assignment.revoked_at is null
  left join public.clubs club on club.id = registration.represented_club_id
  left join public.athlete_registration_profiles registration_profile
    on registration_profile.athlete_profile_id = athlete.id
  where category.event_edition_id = p_event_edition_id
    and category.results_mode <> 'informative_age'
    and registration.status = 'confirmed'
    and registration.payment_status in ('paid', 'not_required');

  manifest_digest := encode(
    public.digest(convert_to(manifest_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select coalesce(max(manifest.version_number), 0) + 1
  into next_version
  from public.start_list_manifests manifest
  where manifest.event_edition_id = p_event_edition_id;

  insert into public.start_list_manifests (
    event_edition_id,
    version_number,
    digest,
    entry_count,
    snapshot_json,
    freeze_note,
    frozen_by_user_id
  )
  values (
    p_event_edition_id,
    next_version,
    manifest_digest,
    eligible_count,
    manifest_snapshot,
    nullif(trim(p_note), ''),
    p_actor_user_id
  )
  returning * into created_manifest;

  insert into public.start_list_manifest_entries (
    manifest_id,
    registration_id,
    event_category_id,
    athlete_profile_id,
    bib_number,
    athlete_name,
    category_name,
    gender,
    date_of_birth,
    represented_club_name,
    phone,
    emergency_contact_name,
    emergency_contact_phone,
    captured_registration_status,
    captured_payment_status,
    captured_participation_status
  )
  select
    created_manifest.id,
    registration.id,
    category.id,
    athlete.id,
    assignment.bib_number,
    athlete.display_name,
    category.name,
    athlete.gender,
    athlete.date_of_birth,
    club.name,
    registration_profile.phone,
    registration_profile.emergency_contact_name,
    registration_profile.emergency_contact_phone,
    registration.status,
    registration.payment_status,
    registration.participation_status
  from public.registrations registration
  join public.event_categories category on category.id = registration.event_category_id
  join public.athlete_profiles athlete on athlete.id = registration.athlete_profile_id
  join public.bib_assignments assignment
    on assignment.registration_id = registration.id
   and assignment.revoked_at is null
  left join public.clubs club on club.id = registration.represented_club_id
  left join public.athlete_registration_profiles registration_profile
    on registration_profile.athlete_profile_id = athlete.id
  where category.event_edition_id = p_event_edition_id
    and category.results_mode <> 'informative_age'
    and registration.status = 'confirmed'
    and registration.payment_status in ('paid', 'not_required')
  order by category.display_order, category.name, assignment.bib_number, registration.id;

  insert into public.edition_operational_controls (
    event_edition_id,
    start_list_state,
    current_manifest_id,
    frozen_at,
    frozen_by_user_id,
    reopened_at,
    reopened_by_user_id,
    reopen_reason
  )
  values (
    p_event_edition_id,
    'frozen',
    created_manifest.id,
    created_manifest.frozen_at,
    p_actor_user_id,
    null,
    null,
    null
  )
  on conflict (event_edition_id)
  do update set
    start_list_state = excluded.start_list_state,
    current_manifest_id = excluded.current_manifest_id,
    frozen_at = excluded.frozen_at,
    frozen_by_user_id = excluded.frozen_by_user_id,
    reopened_at = null,
    reopened_by_user_id = null,
    reopen_reason = null;

  select series.organization_id
  into resolved_organization_id
  from public.event_series series
  where series.id = edition_row.event_series_id;

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
    'start_list.frozen',
    jsonb_build_object(
      'manifestId', created_manifest.id,
      'versionNumber', created_manifest.version_number,
      'entryCount', created_manifest.entry_count,
      'digest', created_manifest.digest,
      'note', nullif(trim(p_note), '')
    )
  );

  return jsonb_build_object(
    'manifestId', created_manifest.id,
    'versionNumber', created_manifest.version_number,
    'entryCount', created_manifest.entry_count,
    'digest', created_manifest.digest,
    'frozenAt', created_manifest.frozen_at
  );
end;
$$;

create or replace function public.service_reopen_start_list(
  p_event_edition_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  control_row public.edition_operational_controls%rowtype;
  resolved_organization_id uuid;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'start_list_reopen_reason_required';
  end if;

  select control.*
  into control_row
  from public.edition_operational_controls control
  where control.event_edition_id = p_event_edition_id
  for update;

  if not found or control_row.start_list_state <> 'frozen' then
    return jsonb_build_object(
      'eventEditionId', p_event_edition_id,
      'state', coalesce(control_row.start_list_state, 'open'),
      'replayed', true
    );
  end if;

  if exists (
    select 1
    from public.timing_sessions session_row
    where session_row.event_edition_id = p_event_edition_id
      and (
        session_row.status = 'active'
        or exists (
          select 1
          from public.punch_events punch
          where punch.timing_session_id = session_row.id
            and not punch.is_voided
        )
      )
  ) then
    raise exception using errcode = 'P0001', message = 'start_list_reopen_after_timing_forbidden';
  end if;

  update public.edition_operational_controls control
  set
    start_list_state = 'reopened',
    reopened_at = now(),
    reopened_by_user_id = p_actor_user_id,
    reopen_reason = trim(p_reason)
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
    'start_list.reopened',
    jsonb_build_object(
      'previousManifestId', control_row.current_manifest_id,
      'reason', trim(p_reason)
    )
  );

  return jsonb_build_object(
    'eventEditionId', p_event_edition_id,
    'state', 'reopened',
    'previousManifestId', control_row.current_manifest_id,
    'replayed', false
  );
end;
$$;

alter table public.bib_allocation_runs enable row level security;
alter table public.start_list_manifests enable row level security;
alter table public.start_list_manifest_entries enable row level security;
alter table public.edition_operational_controls enable row level security;

revoke all on table
  public.bib_allocation_runs,
  public.start_list_manifests,
  public.start_list_manifest_entries,
  public.edition_operational_controls
from public, anon, authenticated;

grant all on table
  public.bib_allocation_runs,
  public.start_list_manifests,
  public.start_list_manifest_entries,
  public.edition_operational_controls
to service_role;

revoke all on function public.reject_start_list_snapshot_mutation()
  from public, anon, authenticated;
revoke all on function public.service_allocate_category_bibs(
  uuid, uuid, integer, text, integer, text, text
) from public, anon, authenticated;
revoke all on function public.service_freeze_start_list_manifest(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.service_reopen_start_list(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.service_allocate_category_bibs(
  uuid, uuid, integer, text, integer, text, text
) to service_role;
grant execute on function public.service_freeze_start_list_manifest(uuid, uuid, text)
  to service_role;
grant execute on function public.service_reopen_start_list(uuid, uuid, text)
  to service_role;
