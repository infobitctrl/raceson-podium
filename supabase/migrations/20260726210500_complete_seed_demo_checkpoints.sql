begin;
-- Keep the public three-race demo edition operationally complete so an
-- edition-wide start-list manifest can be frozen during local workflow tests.
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
  fixture.id,
  fixture.event_category_id,
  fixture.track_snapshot_id,
  fixture.code,
  fixture.name,
  fixture.checkpoint_type,
  fixture.sequence_number,
  fixture.distance_from_start_km,
  fixture.cutoff_at,
  fixture.is_mandatory
from (
  values
  (
    '21000000-0000-4000-8000-000000000026'::uuid,
    '20000000-0000-4000-8000-000000000011'::uuid,
    '21000000-0000-4000-8000-000000000012'::uuid,
    'START',
    'Start - Zadar Marina',
    'start'::public.checkpoint_type,
    1,
    0.00,
    null,
    true
  ),
  (
    '21000000-0000-4000-8000-000000000027'::uuid,
    '20000000-0000-4000-8000-000000000011'::uuid,
    '21000000-0000-4000-8000-000000000012'::uuid,
    'FINISH',
    'Finish - Zadar Marina',
    'finish'::public.checkpoint_type,
    2,
    21.00,
    '2026-04-12T14:30:00Z'::timestamptz,
    true
  ),
  (
    '21000000-0000-4000-8000-000000000028'::uuid,
    '20000000-0000-4000-8000-000000000012'::uuid,
    '21000000-0000-4000-8000-000000000013'::uuid,
    'START',
    'Start - Zadar Marina',
    'start'::public.checkpoint_type,
    1,
    0.00,
    null,
    true
  ),
  (
    '21000000-0000-4000-8000-000000000029'::uuid,
    '20000000-0000-4000-8000-000000000012'::uuid,
    '21000000-0000-4000-8000-000000000013'::uuid,
    'FINISH',
    'Finish - Zadar Marina',
    'finish'::public.checkpoint_type,
    2,
    10.00,
    '2026-04-12T12:30:00Z'::timestamptz,
    true
  )
) as fixture (
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
join public.event_categories category
  on category.id = fixture.event_category_id
join public.event_category_track_snapshots snapshot
  on snapshot.id = fixture.track_snapshot_id
 and snapshot.event_category_id = fixture.event_category_id
on conflict (id) do nothing;
commit;
