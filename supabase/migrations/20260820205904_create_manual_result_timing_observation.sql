create or replace function public.service_create_manual_result_timing_observation(
  p_registration_id uuid,
  p_checkpoint_id uuid,
  p_recorded_at timestamptz,
  p_reason text,
  p_actor_user_id uuid,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  registration_row public.registrations%rowtype;
  existing_punch public.punch_events%rowtype;
  created_punch public.punch_events%rowtype;
  timing_session_id uuid;
  edition_id uuid;
  organization_id uuid;
  resolved_bib text;
begin
  if p_registration_id is null
     or p_checkpoint_id is null
     or p_recorded_at is null
     or nullif(trim(p_reason), '') is null
     or p_actor_user_id is null
     or p_client_event_id is null then
    raise exception using errcode = '22023', message = 'manual_result_timing_observation_input_invalid';
  end if;

  select punch.*
  into existing_punch
  from public.punch_events punch
  where punch.client_event_id = p_client_event_id;
  if found then
    if existing_punch.registration_id <> p_registration_id
       or existing_punch.checkpoint_id <> p_checkpoint_id
       or existing_punch.recorded_at_source <> 'manual_result_correction' then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'punchEventId', existing_punch.id,
      'registrationId', existing_punch.registration_id,
      'checkpointId', existing_punch.checkpoint_id,
      'recordedAt', existing_punch.effective_recorded_at,
      'reconciliationState', existing_punch.reconciliation_state,
      'replayed', true
    );
  end if;

  select registration.*
  into registration_row
  from public.registrations registration
  where registration.id = p_registration_id
    and registration.status = 'confirmed'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'manual_result_registration_not_found';
  end if;

  perform 1
  from public.checkpoints checkpoint
  where checkpoint.id = p_checkpoint_id
    and checkpoint.event_category_id = registration_row.event_category_id
    and checkpoint.checkpoint_type in ('split', 'finish');
  if not found then
    raise exception using errcode = '22023', message = 'manual_result_checkpoint_invalid';
  end if;

  select category.event_edition_id, series.organization_id
  into edition_id, organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = registration_row.event_category_id;

  if exists (
    select 1
    from public.punch_events punch
    where punch.registration_id = p_registration_id
      and punch.checkpoint_id = p_checkpoint_id
      and punch.is_voided = false
  ) then
    raise exception using errcode = '23505', message = 'manual_result_timing_observation_exists';
  end if;

  select assignment.bib_number
  into resolved_bib
  from public.bib_assignments assignment
  where assignment.registration_id = p_registration_id
    and assignment.revoked_at is null
  order by assignment.assigned_at desc
  limit 1;

  select timing.id
  into timing_session_id
  from public.timing_sessions timing
  where timing.event_edition_id = edition_id
    and timing.event_category_id = registration_row.event_category_id
    and timing.checkpoint_id = p_checkpoint_id
  order by timing.started_at desc, timing.created_at desc
  limit 1;

  if timing_session_id is null then
    select timing.id
    into timing_session_id
    from public.timing_sessions timing
    where timing.event_edition_id = edition_id
      and timing.event_category_id = registration_row.event_category_id
      and timing.checkpoint_id is null
    order by timing.started_at desc, timing.created_at desc
    limit 1;
  end if;

  if timing_session_id is null then
    insert into public.timing_sessions (
      event_edition_id,
      event_category_id,
      checkpoint_id,
      started_by_user_id,
      started_at,
      closed_at,
      mode,
      status
    )
    values (
      edition_id,
      registration_row.event_category_id,
      p_checkpoint_id,
      p_actor_user_id,
      now(),
      now(),
      'online',
      'closed'
    )
    returning id into timing_session_id;
  end if;

  insert into public.punch_events (
    timing_session_id,
    event_category_id,
    checkpoint_id,
    registration_id,
    athlete_profile_id,
    bib_number,
    recorded_at,
    recorded_at_source,
    entered_by_user_id,
    client_event_id,
    effective_recorded_at,
    reconciliation_state
  )
  values (
    timing_session_id,
    registration_row.event_category_id,
    p_checkpoint_id,
    p_registration_id,
    registration_row.athlete_profile_id,
    resolved_bib,
    p_recorded_at,
    'manual_result_correction',
    p_actor_user_id,
    p_client_event_id,
    p_recorded_at,
    'corrected'
  )
  returning * into created_punch;

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
    'punch_event',
    created_punch.id,
    'result.manual_timing_observation_created',
    jsonb_build_object(
      'registrationId', p_registration_id,
      'checkpointId', p_checkpoint_id,
      'recordedAt', p_recorded_at,
      'reason', trim(p_reason)
    )
  );

  return jsonb_build_object(
    'punchEventId', created_punch.id,
    'registrationId', created_punch.registration_id,
    'checkpointId', created_punch.checkpoint_id,
    'recordedAt', created_punch.effective_recorded_at,
    'reconciliationState', created_punch.reconciliation_state,
    'replayed', false
  );
end;
$$;

revoke all on function public.service_create_manual_result_timing_observation(
  uuid, uuid, timestamptz, text, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.service_create_manual_result_timing_observation(
  uuid, uuid, timestamptz, text, uuid, uuid
) to service_role;
