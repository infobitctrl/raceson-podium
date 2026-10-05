begin;

-- Some legacy/manual league closures correctly finalized the league round but
-- left the zero-registration event edition in registration_closed. Keep
-- registration_closed meaningful for normal upcoming events and only repair
-- past, explicitly completed league rounds with no registration records.
with completed_zero_registration_editions as (
  select edition.id
  from public.event_editions edition
  where edition.status = 'registration_closed'
    and edition.start_date <= current_date
    and not exists (
      select 1
      from public.event_categories category
      join public.registrations registration
        on registration.event_category_id = category.id
      where category.event_edition_id = edition.id
    )
    and (
      exists (
        select 1
        from public.league_round_events round_event
        where round_event.event_edition_id = edition.id
          and round_event.status = 'completed'
      )
      or exists (
        select 1
        from public.league_rounds round
        where round.event_edition_id = edition.id
          and round.status = 'completed'
      )
    )
    and not exists (
      select 1
      from public.league_round_events round_event
      where round_event.event_edition_id = edition.id
        and round_event.status not in ('completed', 'cancelled')
    )
    and not exists (
      select 1
      from public.league_rounds round
      where round.event_edition_id = edition.id
        and round.status not in ('completed', 'cancelled')
    )
)
update public.event_categories category
set status = 'closed'
where category.event_edition_id in (
  select edition.id
  from completed_zero_registration_editions edition
)
  and category.status not in ('completed', 'closed');

with completed_zero_registration_editions as (
  select edition.id
  from public.event_editions edition
  where edition.status = 'registration_closed'
    and edition.start_date <= current_date
    and not exists (
      select 1
      from public.event_categories category
      join public.registrations registration
        on registration.event_category_id = category.id
      where category.event_edition_id = edition.id
    )
    and (
      exists (
        select 1
        from public.league_round_events round_event
        where round_event.event_edition_id = edition.id
          and round_event.status = 'completed'
      )
      or exists (
        select 1
        from public.league_rounds round
        where round.event_edition_id = edition.id
          and round.status = 'completed'
      )
    )
    and not exists (
      select 1
      from public.league_round_events round_event
      where round_event.event_edition_id = edition.id
        and round_event.status not in ('completed', 'cancelled')
    )
    and not exists (
      select 1
      from public.league_rounds round
      where round.event_edition_id = edition.id
        and round.status not in ('completed', 'cancelled')
    )
)
update public.event_editions edition
set status = 'completed'
where edition.id in (
  select completed.id
  from completed_zero_registration_editions completed
);

commit;
