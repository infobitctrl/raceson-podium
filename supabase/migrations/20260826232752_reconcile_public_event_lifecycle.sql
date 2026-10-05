begin;

/*
 * Public lifecycle invalidations must refresh every surface that can list an
 * event. In particular, unpublishing or deleting an edition changes the
 * results directory even when no result publication row changes.
 */
create or replace function public.build_platform_invalidation_payload(
  p_domain_event_id uuid,
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_payload_json jsonb,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  query_families jsonb;
begin
  query_families := case p_event_type
    when 'race.finish.completed' then
      '["event","results","league","organizer","homepage"]'::jsonb
    when 'race.category.completed' then
      '["event","results","organizer","homepage"]'::jsonb
    when 'event.edition.completed' then
      '["event","results","league","organizer","homepage"]'::jsonb
    when 'event.edition.publication_changed' then
      '["event","results","league","organizer","homepage"]'::jsonb
    when 'result.publication.committed' then
      '["event","results","athlete","club","track","league","rankings","organizer","homepage"]'::jsonb
    when 'league.round.source_changed' then
      '["league","rankings","athlete","club","organizer","homepage"]'::jsonb
    when 'league.standings.published' then
      '["league","rankings","athlete","club","organizer","homepage"]'::jsonb
    when 'league.season.publication_changed' then
      '["event","league","rankings","athlete","club","organizer","homepage"]'::jsonb
    when 'event.organizer_deleted' then
      '["event","results","track","league","organizer","homepage"]'::jsonb
    when 'event_category.organizer_deleted' then
      '["event","results","track","organizer","homepage"]'::jsonb
    when 'track.organizer_deleted' then
      '["track","organizer","homepage"]'::jsonb
    when 'track.sport_changed' then
      '["event","results","track","league","organizer","homepage"]'::jsonb
    else null
  end;

  if query_families is null then
    return null;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'schemaVersion', 1,
    'domainEventId', p_domain_event_id,
    'eventType', p_event_type,
    'aggregateType', p_aggregate_type,
    'aggregateId', p_aggregate_id,
    'occurredAt', p_occurred_at,
    'eventEditionId', nullif(coalesce(p_payload_json, '{}'::jsonb)->>'eventEditionId', ''),
    'eventCategoryId', nullif(coalesce(p_payload_json, '{}'::jsonb)->>'eventCategoryId', ''),
    'leagueSeasonId', nullif(coalesce(p_payload_json, '{}'::jsonb)->>'leagueSeasonId', ''),
    'publicationState', nullif(coalesce(p_payload_json, '{}'::jsonb)->>'publicationState', ''),
    'queryFamilies', query_families
  ));
end;
$$;

create or replace function public.enqueue_event_edition_publication_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_organization_id uuid;
  correlation_id uuid := gen_random_uuid();
  publication_state text;
begin
  if row(old.published_at, old.public_visibility, old.status, old.organizer_deleted_at)
     is not distinct from
     row(new.published_at, new.public_visibility, new.status, new.organizer_deleted_at) then
    return new;
  end if;

  select series.organization_id
  into resolved_organization_id
  from public.event_series series
  where series.id = new.event_series_id;

  publication_state := case
    when new.organizer_deleted_at is null
      and new.published_at is not null
      and new.public_visibility = 'public'
      and new.status::text <> 'draft'
      then 'published'
    else 'private'
  end;

  insert into public.domain_events (
    organization_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload_json,
    correlation_id,
    idempotency_key
  )
  values (
    resolved_organization_id,
    'event.edition.publication_changed',
    'event_edition',
    new.id,
    jsonb_build_object(
      'eventEditionId', new.id,
      'publicationState', publication_state
    ),
    correlation_id,
    correlation_id::text
  );

  return new;
end;
$$;

drop trigger if exists event_editions_enqueue_publication_invalidation
  on public.event_editions;
create trigger event_editions_enqueue_publication_invalidation
after update of published_at, public_visibility, status, organizer_deleted_at
on public.event_editions
for each row execute function public.enqueue_event_edition_publication_invalidation();

revoke all on function public.enqueue_event_edition_publication_invalidation()
  from public, anon, authenticated;

/*
 * Removing a generated league round must also retire its generated public
 * edition when that edition has no participant or race-day history. Publishing
 * an empty generated copy is presentation state, not immutable race history,
 * so it no longer prevents a soft tombstone.
 */
create or replace function public.service_tombstone_orphaned_recurrence_event(
  p_event_edition_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_event_series_id uuid;
  target_is_generated boolean := false;
  target_status text;
  target_published_at timestamptz;
  target_deleted_at timestamptz;
  target_category_id uuid;
  deleted_at timestamptz := clock_timestamp();
begin
  select
    edition.event_series_id,
    edition.is_recurrence_generated,
    edition.status::text,
    edition.published_at,
    edition.organizer_deleted_at
  into
    target_event_series_id,
    target_is_generated,
    target_status,
    target_published_at,
    target_deleted_at
  from public.event_editions edition
  where edition.id = p_event_edition_id
  for update;

  if not found or not target_is_generated then
    return false;
  end if;

  if exists (
       select 1
       from public.league_recurrence_occurrences occurrence
       where occurrence.event_edition_id = p_event_edition_id
     )
     or exists (
       select 1
       from public.league_round_events round_event
       where round_event.event_edition_id = p_event_edition_id
     )
     or exists (
       select 1
       from public.league_rounds legacy_round
       where legacy_round.event_edition_id = p_event_edition_id
     )
     or exists (
       select 1
       from public.event_categories category
       join public.registrations registration
         on registration.event_category_id = category.id
       where category.event_edition_id = p_event_edition_id
     )
     or exists (
       select 1
       from public.event_categories category
       join public.result_rows result
         on result.event_category_id = category.id
       where category.event_edition_id = p_event_edition_id
     )
     or exists (
       select 1
       from public.event_categories category
       join public.result_publications publication
         on publication.event_category_id = category.id
       where category.event_edition_id = p_event_edition_id
     )
     or exists (
       select 1
       from public.event_staff_assignments assignment
       where assignment.event_edition_id = p_event_edition_id
     )
     or exists (
       select 1
       from public.race_start_events start_event
       where start_event.event_edition_id = p_event_edition_id
     )
     or exists (
       select 1
       from public.timing_sessions timing_session
       where timing_session.event_edition_id = p_event_edition_id
     )
     or exists (
       select 1
       from public.event_categories category
       join public.punch_events punch
         on punch.event_category_id = category.id
       where category.event_edition_id = p_event_edition_id
     )
     or exists (
       select 1
       from public.finance_report_snapshots finance_snapshot
       where finance_snapshot.event_edition_id = p_event_edition_id
     )
     or exists (
       select 1
       from public.finance_export_jobs finance_export
       where finance_export.event_edition_id = p_event_edition_id
     ) then
    return false;
  end if;

  /*
   * Keep the original hard-delete path for disposable unpublished drafts. It
   * prevents empty generated series from accumulating and preserves the
   * event-record lifecycle contract. Published or otherwise promoted copies
   * are retained as tombstones so their public removal remains auditable.
   */
  if target_published_at is null and target_status = 'draft' then
    if exists (
         select 1
         from public.organizer_event_presentation_versions presentation
         where presentation.event_edition_id = p_event_edition_id
       )
       or exists (
         select 1
         from public.audit_log audit
         where audit.entity_type = 'event_edition'
           and audit.entity_id = p_event_edition_id
       )
       or exists (
         select 1
         from public.domain_events domain_event
         where domain_event.aggregate_type = 'event_edition'
           and domain_event.aggregate_id = p_event_edition_id
       ) then
      return false;
    end if;

    for target_category_id in
      select category.id
      from public.event_categories category
      where category.event_edition_id = p_event_edition_id
    loop
      if not public.service_delete_unused_event_category(target_category_id) then
        return false;
      end if;
    end loop;

    delete from public.event_editions edition
    where edition.id = p_event_edition_id;

    delete from public.event_series series
    where series.id = target_event_series_id
      and not exists (
        select 1
        from public.event_editions remaining_edition
        where remaining_edition.event_series_id = series.id
      )
      and not exists (
        select 1
        from public.league_recurrence_rules recurrence
        where recurrence.event_series_id = series.id
      );

    return true;
  end if;

  if target_deleted_at is not null then
    return false;
  end if;

  perform 1
  from public.event_categories category
  where category.event_edition_id = p_event_edition_id
  for update;

  update public.event_category_track_snapshots snapshot
  set
    track_template_id = null,
    track_version_id = null
  from public.event_categories category
  where category.id = snapshot.event_category_id
    and category.event_edition_id = p_event_edition_id
    and (
      snapshot.track_template_id is not null
      or snapshot.track_version_id is not null
    );

  update public.event_categories category
  set
    organizer_deleted_at = coalesce(category.organizer_deleted_at, deleted_at),
    updated_at = deleted_at
  where category.event_edition_id = p_event_edition_id;

  update public.event_editions edition
  set
    organizer_deleted_at = deleted_at,
    public_visibility = 'private',
    status = 'archived',
    updated_at = deleted_at
  where edition.id = p_event_edition_id;

  return true;
exception
  when foreign_key_violation or restrict_violation then
    return false;
end;
$$;

revoke all on function public.service_tombstone_orphaned_recurrence_event(uuid)
  from public, anon, authenticated;
grant execute on function public.service_tombstone_orphaned_recurrence_event(uuid)
  to service_role;

comment on function public.service_tombstone_orphaned_recurrence_event(uuid) is
  'Removes disposable generated drafts and soft-deletes empty promoted recurrence copies after proving that no league, participant, result, staffing, timing, or finance history exists.';

-- Repair generated editions detached by the older draft-only cleanup rule.
do $$
declare
  orphaned_event_edition_id uuid;
begin
  for orphaned_event_edition_id in
    select edition.id
    from public.event_editions edition
    where edition.is_recurrence_generated
      and edition.organizer_deleted_at is null
      and not exists (
        select 1
        from public.league_recurrence_occurrences occurrence
        where occurrence.event_edition_id = edition.id
      )
      and not exists (
        select 1
        from public.league_round_events round_event
        where round_event.event_edition_id = edition.id
      )
      and not exists (
        select 1
        from public.league_rounds legacy_round
        where legacy_round.event_edition_id = edition.id
      )
  loop
    perform public.service_tombstone_orphaned_recurrence_event(
      orphaned_event_edition_id
    );
  end loop;
end;
$$;

commit;
