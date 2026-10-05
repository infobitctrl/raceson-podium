-- Store explicit exclusions separately from mappings. Existing partial rounds
-- deliberately remain unreviewed; never infer consent from an omitted course.
alter table public.league_round_events
  add column if not exists excluded_event_category_ids uuid[] not null default '{}';

comment on column public.league_round_events.excluded_event_category_ids is
  'Competitive courses explicitly excluded by the organizer from this round. New courses require a new coverage review.';

alter table public.league_round_events
  add constraint league_round_exclusions_no_nulls
  check (array_position(excluded_event_category_ids, null) is null);
