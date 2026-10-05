begin;

grant select on table public.athlete_activities to authenticated;

delete from public.athlete_badges
where athlete_activity_id in (
  '40000000-0000-4000-8000-000000000020',
  '40000000-0000-4000-8000-000000000021',
  '40000000-0000-4000-8000-000000000022'
)
or track_attempt_id in (
  select id
  from public.track_attempts
  where athlete_activity_id in (
    '40000000-0000-4000-8000-000000000020',
    '40000000-0000-4000-8000-000000000021',
    '40000000-0000-4000-8000-000000000022'
  )
);

delete from public.track_attempts
where athlete_activity_id in (
  '40000000-0000-4000-8000-000000000020',
  '40000000-0000-4000-8000-000000000021',
  '40000000-0000-4000-8000-000000000022'
);

delete from public.athlete_activities
where id in (
  '40000000-0000-4000-8000-000000000020',
  '40000000-0000-4000-8000-000000000021',
  '40000000-0000-4000-8000-000000000022'
);

commit;
