begin;

/*
 * Event snapshots are immutable race evidence, while track templates and
 * versions are reusable organizer sources. Once an event/category is removed
 * from the organizer workspace, retain the frozen snapshot but sever its
 * source pointers so the reusable track can be deleted independently.
 */
alter table public.event_category_track_snapshots
  alter column track_template_id drop not null,
  alter column track_version_id drop not null;

alter table public.event_category_track_snapshots
  drop constraint event_category_track_snapshots_track_template_id_fkey,
  add constraint event_category_track_snapshots_track_template_id_fkey
    foreign key (track_template_id)
    references public.track_templates(id)
    on delete set null,
  drop constraint event_category_track_snapshots_track_version_id_fkey,
  add constraint event_category_track_snapshots_track_version_id_fkey
    foreign key (track_version_id)
    references public.track_versions(id)
    on delete set null;

comment on column public.event_category_track_snapshots.track_template_id is
  'Reusable source track. Null after the owning race/event is organizer-deleted; snapshot_json remains immutable evidence.';

comment on column public.event_category_track_snapshots.track_version_id is
  'Reusable source version. Null after the owning race/event is organizer-deleted; frozen snapshot fields remain available.';

update public.event_category_track_snapshots snapshot
set
  track_template_id = null,
  track_version_id = null
from public.event_categories category
join public.event_editions edition
  on edition.id = category.event_edition_id
where snapshot.event_category_id = category.id
  and (
    category.organizer_deleted_at is not null
    or edition.organizer_deleted_at is not null
  )
  and (
    snapshot.track_template_id is not null
    or snapshot.track_version_id is not null
  );

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
      '["event","league","organizer","homepage"]'::jsonb
    when 'race.category.completed' then
      '["event","results","organizer"]'::jsonb
    when 'event.edition.completed' then
      '["event","league","organizer","homepage"]'::jsonb
    when 'result.publication.committed' then
      '["event","results","athlete","club","track","league","rankings","organizer","homepage"]'::jsonb
    when 'league.round.source_changed' then
      '["league","rankings","athlete","club","organizer","homepage"]'::jsonb
    when 'league.standings.published' then
      '["league","rankings","athlete","club","organizer","homepage"]'::jsonb
    when 'event.organizer_deleted' then
      '["event","track","league","organizer","homepage"]'::jsonb
    when 'event_category.organizer_deleted' then
      '["event","track","organizer","homepage"]'::jsonb
    when 'track.organizer_deleted' then
      '["track","organizer","homepage"]'::jsonb
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

create or replace function public.service_delete_organizer_event(
  p_event_edition_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_organization_id uuid;
  deleted_at timestamptz := clock_timestamp();
  deleted_category_count integer := 0;
  detached_track_snapshot_count integer := 0;
  deletion_event_id uuid := gen_random_uuid();
begin
  select series.organization_id
  into target_organization_id
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = p_event_edition_id
    and edition.organizer_deleted_at is null
  for update of edition;

  if not found then
    raise exception using errcode = 'P0002', message = 'event_not_found';
  end if;

  perform 1
  from public.event_categories category
  where category.event_edition_id = p_event_edition_id
  for update;

  if exists (
    select 1
    from public.registrations registration
    join public.event_categories category
      on category.id = registration.event_category_id
    where category.event_edition_id = p_event_edition_id
      and registration.organizer_removed_at is null
  ) then
    raise exception using errcode = '23514', message = 'event_has_visible_registrations';
  end if;

  update public.event_categories category
  set
    organizer_deleted_at = deleted_at,
    organizer_deleted_by_user_id = p_actor_user_id,
    updated_at = deleted_at
  where category.event_edition_id = p_event_edition_id
    and category.organizer_deleted_at is null;

  get diagnostics deleted_category_count = row_count;

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

  get diagnostics detached_track_snapshot_count = row_count;

  update public.event_editions edition
  set
    organizer_deleted_at = deleted_at,
    organizer_deleted_by_user_id = p_actor_user_id,
    public_visibility = 'private',
    status = 'archived',
    updated_at = deleted_at
  where edition.id = p_event_edition_id;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    target_organization_id,
    p_actor_user_id,
    'event_edition',
    p_event_edition_id,
    'event.organizer_deleted',
    jsonb_build_object(
      'deletedAt', deleted_at,
      'deletedCategoryCount', deleted_category_count,
      'detachedTrackSnapshotCount', detached_track_snapshot_count,
      'retainedEvidence', true
    )
  );

  insert into public.domain_events (
    id,
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
    deletion_event_id,
    target_organization_id,
    'event.organizer_deleted',
    'event_edition',
    p_event_edition_id,
    jsonb_build_object(
      'eventEditionId', p_event_edition_id,
      'deletedCategoryCount', deleted_category_count,
      'detachedTrackSnapshotCount', detached_track_snapshot_count
    ),
    p_actor_user_id,
    deletion_event_id,
    'event:' || p_event_edition_id::text || ':organizer_deleted'
  );

  return jsonb_build_object(
    'eventEditionId', p_event_edition_id,
    'deletedCategoryCount', deleted_category_count,
    'detachedTrackSnapshotCount', detached_track_snapshot_count,
    'softDeleted', true
  );
end;
$$;

create or replace function public.service_delete_organizer_event_category(
  p_category_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_event_edition_id uuid;
  target_organization_id uuid;
  retained_registration_count integer := 0;
  detached_track_snapshot_count integer := 0;
  deleted_at timestamptz := clock_timestamp();
  physically_deleted boolean := false;
  deletion_event_id uuid := gen_random_uuid();
begin
  select category.event_edition_id, series.organization_id
  into target_event_edition_id, target_organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = p_category_id
    and category.organizer_deleted_at is null
    and edition.organizer_deleted_at is null
  for update of category;

  if not found then
    raise exception using errcode = 'P0002', message = 'event_category_not_found';
  end if;

  select count(*)::integer
  into retained_registration_count
  from public.registrations registration
  where registration.event_category_id = p_category_id;

  if exists (
    select 1
    from public.registrations registration
    where registration.event_category_id = p_category_id
      and registration.organizer_removed_at is null
  ) then
    raise exception using errcode = '23514', message = 'event_category_has_visible_registrations';
  end if;

  if retained_registration_count = 0 then
    physically_deleted := public.service_delete_unused_event_category(p_category_id);
  else
    update public.event_categories category
    set
      organizer_deleted_at = deleted_at,
      organizer_deleted_by_user_id = p_actor_user_id,
      updated_at = deleted_at
    where category.id = p_category_id;

    update public.event_category_track_snapshots snapshot
    set
      track_template_id = null,
      track_version_id = null
    where snapshot.event_category_id = p_category_id
      and (
        snapshot.track_template_id is not null
        or snapshot.track_version_id is not null
      );

    get diagnostics detached_track_snapshot_count = row_count;
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
    target_organization_id,
    p_actor_user_id,
    'event_category',
    p_category_id,
    'event_category.organizer_deleted',
    jsonb_build_object(
      'deletedAt', deleted_at,
      'eventEditionId', target_event_edition_id,
      'physicallyDeleted', physically_deleted,
      'retainedRegistrationCount', retained_registration_count,
      'detachedTrackSnapshotCount', detached_track_snapshot_count
    )
  );

  insert into public.domain_events (
    id,
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
    deletion_event_id,
    target_organization_id,
    'event_category.organizer_deleted',
    'event_category',
    p_category_id,
    jsonb_build_object(
      'eventEditionId', target_event_edition_id,
      'eventCategoryId', p_category_id,
      'physicallyDeleted', physically_deleted,
      'detachedTrackSnapshotCount', detached_track_snapshot_count
    ),
    p_actor_user_id,
    deletion_event_id,
    'event_category:' || p_category_id::text || ':organizer_deleted'
  );

  return jsonb_build_object(
    'categoryId', p_category_id,
    'detachedTrackSnapshotCount', detached_track_snapshot_count,
    'physicallyDeleted', physically_deleted,
    'softDeleted', not physically_deleted
  );
end;
$$;

create or replace function public.service_delete_organizer_track(
  p_track_template_id uuid,
  p_organization_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_organization_id uuid;
  removed_league_schedule_count integer := 0;
  deletion_event_id uuid := gen_random_uuid();
begin
  select template.organization_id
  into target_organization_id
  from public.track_templates template
  where template.id = p_track_template_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'track_not_found';
  end if;

  if target_organization_id <> p_organization_id then
    raise exception using errcode = '42501', message = 'track_organization_mismatch';
  end if;

  perform 1
  from public.event_category_track_snapshots snapshot
  where snapshot.track_template_id = p_track_template_id
  for update;

  if found then
    raise exception using errcode = '23514', message = 'track_has_race_assignments';
  end if;

  perform 1
  from public.league_recurrence_rules rule
  where rule.track_template_id = p_track_template_id
  for update;

  if exists (
    select 1
    from public.league_recurrence_occurrences occurrence
    join public.league_recurrence_rules rule
      on rule.id = occurrence.recurrence_rule_id
    where rule.track_template_id = p_track_template_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'track_has_generated_league_events';
  end if;

  delete from public.league_recurrence_rules rule
  where rule.track_template_id = p_track_template_id;

  get diagnostics removed_league_schedule_count = row_count;

  delete from public.track_templates template
  where template.id = p_track_template_id;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    target_organization_id,
    p_actor_user_id,
    'track_template',
    p_track_template_id,
    'track.organizer_deleted',
    jsonb_build_object(
      'removedLeagueScheduleCount', removed_league_schedule_count
    )
  );

  insert into public.domain_events (
    id,
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
    deletion_event_id,
    target_organization_id,
    'track.organizer_deleted',
    'track_template',
    p_track_template_id,
    jsonb_build_object(
      'trackTemplateId', p_track_template_id,
      'removedLeagueScheduleCount', removed_league_schedule_count
    ),
    p_actor_user_id,
    deletion_event_id,
    'track:' || p_track_template_id::text || ':organizer_deleted'
  );

  return jsonb_build_object(
    'deleted', true,
    'trackTemplateId', p_track_template_id,
    'removedLeagueScheduleCount', removed_league_schedule_count
  );
end;
$$;

revoke all on function public.service_delete_organizer_event(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_delete_organizer_event(uuid, uuid)
  to service_role;

revoke all on function public.service_delete_organizer_event_category(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_delete_organizer_event_category(uuid, uuid)
  to service_role;

revoke all on function public.service_delete_organizer_track(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_delete_organizer_track(uuid, uuid, uuid)
  to service_role;

commit;
