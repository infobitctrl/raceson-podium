-- A lap course reuses one physical route and its timing stations. Repeated
-- observations stay append-only punch events; the category records how many
-- passes are expected before a finish-line punch completes the race.

alter table public.event_categories
  add column if not exists course_format text not null default 'standard',
  add column if not exists lap_count integer not null default 1;

alter table public.event_categories
  drop constraint if exists event_categories_course_format_check,
  add constraint event_categories_course_format_check
    check (course_format in ('standard', 'laps')),
  drop constraint if exists event_categories_lap_count_check,
  add constraint event_categories_lap_count_check
    check (
      (course_format = 'standard' and lap_count = 1)
      or (course_format = 'laps' and lap_count between 2 and 100)
    );

comment on column public.event_categories.course_format is
  'standard means the assigned track is the full race; laps means the assigned track is one lap reused lap_count times.';

comment on column public.event_categories.lap_count is
  'Number of repetitions of the assigned one-lap track. Physical checkpoints are not duplicated.';

-- One physical checkpoint may produce one immutable split per lap. The
-- sequence number remains unique within a result row and represents the
-- expanded passage order across every lap.
alter table public.result_splits
  drop constraint if exists result_splits_result_row_id_checkpoint_id_key;

create index if not exists result_splits_result_checkpoint_idx
  on public.result_splits (result_row_id, checkpoint_id, sequence_number);

create or replace function public.project_resolved_punch_participant_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  checkpoint_kind text;
  category_course_format text;
  category_lap_count integer;
  finish_pass_count integer;
  current_status public.participation_status;
  projected_status public.participation_status;
begin
  if new.registration_id is null or new.is_voided then
    return new;
  end if;

  select
    checkpoint.checkpoint_type::text,
    category.course_format,
    category.lap_count
  into
    checkpoint_kind,
    category_course_format,
    category_lap_count
  from public.checkpoints checkpoint
  join public.event_categories category
    on category.id = checkpoint.event_category_id
  where checkpoint.id = new.checkpoint_id;

  select registration.participation_status
  into current_status
  from public.registrations registration
  where registration.id = new.registration_id
  for update;

  if checkpoint_kind = 'start' and current_status in ('not_started', 'checked_in') then
    projected_status := 'started';
  elsif checkpoint_kind = 'finish' and current_status in ('started', 'missing', 'stopped') then
    if category_course_format = 'laps' then
      select count(*)::integer
      into finish_pass_count
      from public.punch_events punch
      where punch.event_category_id = new.event_category_id
        and punch.checkpoint_id = new.checkpoint_id
        and punch.registration_id = new.registration_id
        and not punch.is_voided;

      if finish_pass_count < category_lap_count then
        return new;
      end if;
    end if;
    projected_status := 'finished';
  else
    return new;
  end if;

  insert into public.participant_statuses (
    registration_id,
    status,
    effective_at,
    reason,
    created_by_user_id,
    client_event_id,
    source,
    metadata_json
  )
  values (
    new.registration_id,
    projected_status,
    new.recorded_at,
    'timing_punch',
    new.entered_by_user_id,
    gen_random_uuid(),
    'timing',
    jsonb_build_object(
      'punchEventId', new.id,
      'checkpointId', new.checkpoint_id,
      'courseFormat', category_course_format,
      'lapCount', category_lap_count
    )
  );

  update public.registrations
  set participation_status = projected_status
  where id = new.registration_id;

  return new;
end;
$$;

revoke all on function public.project_resolved_punch_participant_status()
  from public, anon, authenticated;
grant execute on function public.project_resolved_punch_participant_status()
  to service_role;

create or replace function public.public_event_result_splits(
  target_event_edition_id uuid
)
returns table (
  registration_id uuid,
  event_category_id uuid,
  checkpoint_id uuid,
  checkpoint_name text,
  checkpoint_type text,
  sequence_number integer,
  recorded_at timestamptz,
  elapsed_time_ms bigint,
  split_time_ms bigint
)
language sql
security definer
set search_path = ''
as $$
  with visible_participants as (
    select
      participant.registration_id,
      participant.event_category_id,
      participant.publication_state,
      participant.published_at
    from public.public_event_participants(target_event_edition_id) participant
  ),
  selected_sources as (
    select
      source.event_category_id,
      source.result_run_id
    from public.public_results_directory_category_states() source
    join public.event_categories category
      on category.id = source.event_category_id
    where category.event_edition_id = target_event_edition_id
      and source.result_run_id is not null
  ),
  computed_splits as (
    select
      participant.registration_id,
      participant.event_category_id,
      checkpoint.id as checkpoint_id,
      checkpoint.name as checkpoint_name,
      checkpoint.checkpoint_type::text as checkpoint_type,
      split.sequence_number,
      split.recorded_at,
      split.elapsed_time_ms,
      split.split_time_ms
    from visible_participants participant
    join selected_sources source
      on source.event_category_id = participant.event_category_id
    join public.result_rows result
      on result.result_run_id = source.result_run_id
     and result.registration_id = participant.registration_id
    join public.result_splits split
      on split.result_row_id = result.id
    join public.checkpoints checkpoint
      on checkpoint.id = split.checkpoint_id
    where checkpoint.checkpoint_type <> 'start'
  ),
  live_starts as (
    select distinct on (participant.event_category_id)
      participant.event_category_id,
      start_event.occurred_at
    from visible_participants participant
    join public.race_start_events start_event
      on start_event.event_category_id = participant.event_category_id
     and start_event.event_type in ('actual_start', 'restart')
     and start_event.created_at <= participant.published_at
    where participant.publication_state = 'live'
    order by participant.event_category_id, start_event.sequence_number desc
  ),
  checkpoint_order as (
    select
      checkpoint.id,
      checkpoint.event_category_id,
      row_number() over (
        partition by checkpoint.event_category_id
        order by checkpoint.sequence_number, checkpoint.id
      )::integer as point_order,
      count(*) over (partition by checkpoint.event_category_id)::integer as points_per_lap
    from public.checkpoints checkpoint
    where checkpoint.checkpoint_type <> 'start'
  ),
  ranked_live_punches as (
    select
      participant.registration_id,
      participant.event_category_id,
      checkpoint.id as checkpoint_id,
      checkpoint.name as checkpoint_name,
      checkpoint.checkpoint_type::text as checkpoint_type,
      punch.effective_recorded_at as recorded_at,
      greatest(
        0,
        (extract(epoch from (punch.effective_recorded_at - live_start.occurred_at)) * 1000)::bigint
      ) as elapsed_time_ms,
      row_number() over (
        partition by participant.registration_id, checkpoint.id
        order by punch.effective_recorded_at, punch.id
      )::integer as pass_number,
      category.course_format,
      category.lap_count,
      checkpoint_order.point_order,
      checkpoint_order.points_per_lap
    from visible_participants participant
    join live_starts live_start
      on live_start.event_category_id = participant.event_category_id
    join public.event_categories category
      on category.id = participant.event_category_id
    join public.punch_events punch
      on punch.registration_id = participant.registration_id
     and punch.event_category_id = participant.event_category_id
     and punch.ingested_at <= participant.published_at
     and not punch.is_voided
    join public.checkpoints checkpoint
      on checkpoint.id = punch.checkpoint_id
    join checkpoint_order
      on checkpoint_order.id = checkpoint.id
    where participant.publication_state = 'live'
      and checkpoint.checkpoint_type <> 'start'
  ),
  live_splits as (
    select
      ranked.registration_id,
      ranked.event_category_id,
      ranked.checkpoint_id,
      ranked.checkpoint_name,
      ranked.checkpoint_type,
      case
        when ranked.course_format = 'laps'
          then ((ranked.pass_number - 1) * ranked.points_per_lap) + ranked.point_order
        else ranked.point_order
      end::integer as sequence_number,
      ranked.recorded_at,
      ranked.elapsed_time_ms,
      null::bigint as split_time_ms
    from ranked_live_punches ranked
    where ranked.pass_number <= case
      when ranked.course_format = 'laps' then ranked.lap_count
      else 1
    end
  )
  select *
  from computed_splits
  union all
  select live.*
  from live_splits live
  where not exists (
    select 1
    from computed_splits computed
    where computed.registration_id = live.registration_id
      and computed.event_category_id = live.event_category_id
  )
$$;

comment on function public.public_event_result_splits(uuid) is
  'Returns privacy-filtered checkpoint passages, including repeated physical checkpoint observations for lap races.';

revoke all on function public.public_event_result_splits(uuid)
  from public;
grant execute on function public.public_event_result_splits(uuid)
  to anon, authenticated, service_role;
