begin;

create or replace function public.close_category_checkpoints_on_finish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status not in ('completed', 'closed')
     or old.status in ('completed', 'closed') then
    return new;
  end if;

  insert into public.checkpoint_operation_events (
    event_category_id,
    checkpoint_id,
    operation_state,
    effective_at,
    sequence_number,
    reason,
    unresolved_package_json,
    client_event_id,
    created_by_user_id
  )
  select
    new.id,
    checkpoint.id,
    'closed',
    clock_timestamp(),
    coalesce((
      select max(existing_event.sequence_number)
      from public.checkpoint_operation_events existing_event
      where existing_event.checkpoint_id = checkpoint.id
    ), 0) + 1,
    'Closed automatically when the race finished.',
    jsonb_build_object(
      'source', 'race_finish',
      'capturedAt', clock_timestamp(),
      'recordedPunches', (
        select count(*)::integer
        from public.punch_events punch
        where punch.checkpoint_id = checkpoint.id
          and not punch.is_voided
      ),
      'unresolvedTimingEvents', (
        select count(*)::integer
        from public.punch_events punch
        where punch.checkpoint_id = checkpoint.id
          and not punch.is_voided
          and punch.registration_id is null
      ),
      'confirmedParticipants', (
        select count(*)::integer
        from public.registrations registration
        where registration.event_category_id = new.id
          and registration.status = 'confirmed'
      )
    ),
    gen_random_uuid(),
    null
  from public.checkpoints checkpoint
  where checkpoint.event_category_id = new.id
    and not exists (
      select 1
      from public.checkpoint_operation_events latest_event
      where latest_event.checkpoint_id = checkpoint.id
        and latest_event.operation_state in ('closed', 'reconciled')
        and latest_event.sequence_number = (
          select max(candidate.sequence_number)
          from public.checkpoint_operation_events candidate
          where candidate.checkpoint_id = checkpoint.id
        )
    );

  return new;
end;
$$;

drop trigger if exists event_categories_close_checkpoints_on_finish
  on public.event_categories;

create trigger event_categories_close_checkpoints_on_finish
after update of status on public.event_categories
for each row
execute function public.close_category_checkpoints_on_finish();

comment on function public.close_category_checkpoints_on_finish() is
  'Closes every checkpoint and captures its timing counts when a race category finishes; the result workflow then creates the temporary result run from the same committed race state.';

revoke all on function public.close_category_checkpoints_on_finish()
  from public, anon, authenticated;

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
  proposal_digest text;
  required_approvals integer := 0;
  recorded_approvals integer := 0;
begin
  select result_run.*
  into result_run_row
  from public.result_runs result_run
  where result_run.id = p_result_run_id
    and result_run.event_category_id = p_event_category_id
    and result_run.status = 'succeeded';
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

  if p_publication_state in ('official', 'corrected') and exists (
    select 1
    from public.result_adjudication_cases adjudication_case
    where adjudication_case.event_category_id = p_event_category_id
      and adjudication_case.case_state in (
        'submitted', 'accepted', 'in_review', 'decision_pending', 'appealed'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'unresolved_result_adjudications_open';
  end if;

  if p_publication_state in ('official', 'corrected') and exists (
    select 1
    from public.result_adjudication_cases adjudication_case
    where adjudication_case.event_category_id = p_event_category_id
      and adjudication_case.recompute_required
      and adjudication_case.decided_at is not null
      and result_run_row.started_at <= adjudication_case.decided_at
  ) then
    raise exception using errcode = 'P0001', message = 'result_recompute_after_decision_required';
  end if;

  if p_publication_state in ('official', 'corrected') and exists (
    select 1
    from public.registrations registration
    where registration.event_category_id = p_event_category_id
      and registration.status = 'confirmed'
      and registration.participation_status in (
        'not_started', 'checked_in', 'started', 'missing'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'field_accounting_incomplete';
  end if;

  if p_publication_state in ('official', 'corrected') then
    select case p_publication_state
      when 'corrected' then settings.required_corrected_approvals
      else settings.required_official_approvals
    end
    into required_approvals
    from public.result_governance_settings settings
    where settings.event_category_id = p_event_category_id;
    required_approvals := coalesce(required_approvals, 0);

    proposal_digest := public.result_publication_proposal_digest(
      p_event_category_id,
      p_result_run_id,
      p_publication_state,
      p_change_note
    );

    if exists (
      select 1
      from public.result_publication_approvals approval
      where approval.proposal_digest_sha256 = proposal_digest
        and approval.decision = 'rejected'
    ) then
      raise exception using errcode = 'P0001', message = 'result_publication_proposal_rejected';
    end if;

    select count(distinct approval.actor_user_id)::integer
    into recorded_approvals
    from public.result_publication_approvals approval
    where approval.proposal_digest_sha256 = proposal_digest
      and approval.decision = 'approved';

    if recorded_approvals < required_approvals then
      raise exception using
        errcode = 'P0001',
        message = 'result_publication_approvals_required',
        detail = jsonb_build_object(
          'required', required_approvals,
          'recorded', recorded_approvals,
          'proposalDigestSha256', proposal_digest
        )::text;
    end if;
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

comment on function public.service_publish_result_run_guarded(
  uuid, uuid, public.publication_state, uuid, text
) is
  'Publishes a reviewed result run after result, timing, participant, adjudication, and approval checks. Race finish owns checkpoint closure, so no separate field-accounting sign-off is required.';

commit;
