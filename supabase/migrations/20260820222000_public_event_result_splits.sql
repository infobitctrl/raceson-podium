begin;

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
      checkpoint.sequence_number,
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
  live_splits as (
    select distinct on (participant.registration_id, checkpoint.id)
      participant.registration_id,
      participant.event_category_id,
      checkpoint.id as checkpoint_id,
      checkpoint.name as checkpoint_name,
      checkpoint.checkpoint_type::text as checkpoint_type,
      checkpoint.sequence_number,
      punch.effective_recorded_at as recorded_at,
      greatest(
        0,
        (extract(epoch from (punch.effective_recorded_at - live_start.occurred_at)) * 1000)::bigint
      ) as elapsed_time_ms,
      null::bigint as split_time_ms
    from visible_participants participant
    join live_starts live_start
      on live_start.event_category_id = participant.event_category_id
    join public.punch_events punch
      on punch.registration_id = participant.registration_id
     and punch.event_category_id = participant.event_category_id
     and punch.ingested_at <= participant.published_at
     and not punch.is_voided
    join public.checkpoints checkpoint
      on checkpoint.id = punch.checkpoint_id
    where participant.publication_state = 'live'
      and checkpoint.checkpoint_type <> 'start'
    order by participant.registration_id, checkpoint.id, punch.effective_recorded_at
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
      and computed.checkpoint_id = live.checkpoint_id
  )
$$;

comment on function public.public_event_result_splits(uuid) is
  'Returns privacy-filtered local and race-relative checkpoint observations for public live, unofficial, and final event results.';

revoke all on function public.public_event_result_splits(uuid) from public;
grant execute on function public.public_event_result_splits(uuid)
  to anon, authenticated, service_role;

commit;
