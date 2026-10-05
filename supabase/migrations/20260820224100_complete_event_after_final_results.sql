-- Final result publication is the durable completion boundary for organizer events.
begin;

create or replace function public.complete_event_edition_after_final_result_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_event_edition_id uuid;
  resolved_organization_id uuid;
  competitive_race_count integer := 0;
  final_race_count integer := 0;
  updated_edition_count integer := 0;
  completed_at timestamptz := clock_timestamp();
begin
  if new.publication_state not in ('official', 'corrected') then
    return new;
  end if;

  select edition.id, series.organization_id
  into resolved_event_edition_id, resolved_organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = new.event_category_id
  for update of edition;

  if resolved_event_edition_id is null then
    return new;
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where latest_publication.publication_state in ('official', 'corrected')
    )::integer
  into competitive_race_count, final_race_count
  from public.event_categories category
  left join lateral (
    select publication.publication_state
    from public.result_publications publication
    where publication.event_category_id = category.id
    order by publication.published_at desc, publication.created_at desc, publication.id desc
    limit 1
  ) latest_publication on true
  where category.event_edition_id = resolved_event_edition_id
    and category.results_mode <> 'informative_age'
    and category.organizer_deleted_at is null;

  if competitive_race_count = 0 or final_race_count <> competitive_race_count then
    return new;
  end if;

  update public.event_editions edition
  set status = 'completed'
  where edition.id = resolved_event_edition_id
    and edition.status not in ('completed', 'archived');
  get diagnostics updated_edition_count = row_count;

  if updated_edition_count = 0 then
    return new;
  end if;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    resolved_organization_id,
    new.published_by_user_id,
    'event_edition',
    resolved_event_edition_id,
    'event.results_finalized',
    jsonb_build_object(
      'publicationId', new.id,
      'eventCategoryId', new.event_category_id,
      'competitiveRaceCount', competitive_race_count,
      'finalRaceCount', final_race_count,
      'completedAt', completed_at
    )
  );

  insert into public.domain_events (
    organization_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload_json,
    actor_user_id,
    correlation_id,
    idempotency_key
  )
  values (
    resolved_organization_id,
    'event.edition.results_finalized',
    'event_edition',
    resolved_event_edition_id,
    jsonb_build_object(
      'eventEditionId', resolved_event_edition_id,
      'publicationId', new.id,
      'eventCategoryId', new.event_category_id,
      'competitiveRaceCount', competitive_race_count,
      'completedAt', completed_at
    ),
    new.published_by_user_id,
    new.id,
    new.id::text
  );

  return new;
end;
$$;

comment on function public.complete_event_edition_after_final_result_publication() is
  'Marks an event edition completed when the newest publication for every visible competitive race is official or corrected.';

revoke all on function public.complete_event_edition_after_final_result_publication()
  from public, anon, authenticated;

drop trigger if exists result_publications_complete_event_edition
  on public.result_publications;

create trigger result_publications_complete_event_edition
after insert on public.result_publications
for each row
execute function public.complete_event_edition_after_final_result_publication();

with final_result_progress as (
  select
    edition.id as event_edition_id,
    count(*)::integer as competitive_race_count,
    count(*) filter (
      where latest_publication.publication_state in ('official', 'corrected')
    )::integer as final_race_count
  from public.event_editions edition
  join public.event_categories category
    on category.event_edition_id = edition.id
   and category.results_mode <> 'informative_age'
   and category.organizer_deleted_at is null
  left join lateral (
    select publication.publication_state
    from public.result_publications publication
    where publication.event_category_id = category.id
    order by publication.published_at desc, publication.created_at desc, publication.id desc
    limit 1
  ) latest_publication on true
  group by edition.id
)
update public.event_editions edition
set status = 'completed'
from final_result_progress progress
where edition.id = progress.event_edition_id
  and edition.status not in ('completed', 'archived')
  and progress.competitive_race_count > 0
  and progress.final_race_count = progress.competitive_race_count;

commit;
