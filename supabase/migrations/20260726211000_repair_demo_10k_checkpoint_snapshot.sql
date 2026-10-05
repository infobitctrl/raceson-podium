begin;
-- Local organizer testing may replace the seeded 10K snapshot with a new
-- immutable snapshot ID. Bind the demo checkpoints to whichever snapshot is
-- currently assigned to that race.
with current_snapshot as (
  select snapshot.id
  from public.event_category_track_snapshots snapshot
  where snapshot.event_category_id =
    '20000000-0000-4000-8000-000000000012'::uuid
  order by snapshot.created_at desc, snapshot.id
  limit 1
)
insert into public.checkpoints (
  id,
  event_category_id,
  track_snapshot_id,
  code,
  name,
  checkpoint_type,
  sequence_number,
  distance_from_start_km,
  cutoff_at,
  is_mandatory
)
select
  '21000000-0000-4000-8000-000000000028'::uuid,
  '20000000-0000-4000-8000-000000000012'::uuid,
  current_snapshot.id,
  'START',
  'Start - Zadar Marina',
  'start'::public.checkpoint_type,
  1,
  0.00,
  null,
  true
from current_snapshot
union all
select
  '21000000-0000-4000-8000-000000000029'::uuid,
  '20000000-0000-4000-8000-000000000012'::uuid,
  current_snapshot.id,
  'FINISH',
  'Finish - Zadar Marina',
  'finish'::public.checkpoint_type,
  2,
  10.00,
  '2026-04-12T12:30:00Z'::timestamptz,
  true
from current_snapshot
on conflict (id) do nothing;
commit;
