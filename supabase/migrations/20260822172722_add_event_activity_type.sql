alter table public.event_editions
  add column if not exists activity_type text not null default 'race';

alter table public.event_editions
  drop constraint if exists event_editions_activity_type_check;

alter table public.event_editions
  add constraint event_editions_activity_type_check
  check (activity_type in (
    'race',
    'training',
    'recreational',
    'club_activity',
    'community'
  ));

create index if not exists event_editions_activity_type_start_date_idx
  on public.event_editions (activity_type, start_date);

comment on column public.event_editions.activity_type is
  'Public activity classification: race, training, recreational, club activity, or community activity.';
