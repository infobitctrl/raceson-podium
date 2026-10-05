-- Preserve the exact source punch timestamp in result snapshots so public and
-- organizer result views can show both event-local clock time and race-relative
-- elapsed time without reading private punch-event rows.

alter table public.result_splits
  add column if not exists recorded_at timestamptz;

with selected_punches as (
  select distinct on (result_split.id)
    result_split.id as result_split_id,
    punch.effective_recorded_at
  from public.result_splits result_split
  join public.result_rows result_row
    on result_row.id = result_split.result_row_id
  join public.punch_events punch
    on punch.registration_id = result_row.registration_id
   and punch.event_category_id = result_row.event_category_id
   and punch.checkpoint_id = result_split.checkpoint_id
   and not punch.is_voided
  order by result_split.id, punch.effective_recorded_at, punch.id
)
update public.result_splits result_split
set recorded_at = selected_punch.effective_recorded_at
from selected_punches selected_punch
where result_split.id = selected_punch.result_split_id
  and result_split.recorded_at is null;

comment on column public.result_splits.recorded_at is
  'Exact effective punch timestamp selected when this immutable result split was computed.';
