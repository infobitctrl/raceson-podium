/*
 * Organization-owned practice races are permanently private race-day drills.
 * They use the same registrations, start control, timing, and finish capture as
 * real races, while remaining identifiable and isolated from public reporting.
 */

alter table public.event_editions
  add column if not exists is_practice boolean not null default false;
create index if not exists event_editions_practice_idx
  on public.event_editions (event_series_id, updated_at desc)
  where is_practice;
alter table public.event_editions
  add constraint event_editions_practice_private_check
  check (
    not is_practice
    or (
      published_at is null
      and public_visibility = 'private'
    )
  );
comment on column public.event_editions.is_practice is
  'True only for private organization training races that may be safely reset.';
