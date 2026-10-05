alter table public.registrations
  add column if not exists organizer_removed_at timestamptz,
  add column if not exists organizer_removed_by_user_id uuid references auth.users (id) on delete set null;

create index if not exists registrations_active_roster_created_idx
  on public.registrations (event_category_id, created_at desc)
  where organizer_removed_at is null;

comment on column public.registrations.organizer_removed_at is
  'When set, hides an inactive registration from organizer rosters and athlete registration history while retaining audit, payment, and race-day records.';

comment on column public.registrations.organizer_removed_by_user_id is
  'Organizer or platform user who removed the inactive registration from operational views.';
