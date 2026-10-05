/*
 * Recurrence previews can create private draft event snapshots before an
 * occurrence is materialized. When a schedule, league, base race, or base
 * event is removed, those derivative drafts must stop retaining reusable
 * track sources. Frozen snapshot_json remains available as race evidence.
 */

create or replace function public.detach_recurrence_draft_track_snapshots(
  p_recurrence_rule_ids uuid[]
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  detached_snapshot_count integer := 0;
begin
  if coalesce(cardinality(p_recurrence_rule_ids), 0) = 0 then
    return 0;
  end if;

  update public.event_category_track_snapshots snapshot
  set
    track_template_id = null,
    track_version_id = null
  from public.event_categories category
  join public.event_editions edition
    on edition.id = category.event_edition_id
  where snapshot.event_category_id = category.id
    and snapshot.snapshot_json ->> 'recurrenceRuleId' = any (
      select recurrence_rule_id::text
      from unnest(p_recurrence_rule_ids) as recurrence_rule_id
    )
    and category.status = 'draft'
    and edition.status = 'draft'
    and edition.published_at is null
    and not exists (
      select 1
      from public.registrations registration
      where registration.event_category_id = category.id
    )
    and (
      snapshot.track_template_id is not null
      or snapshot.track_version_id is not null
    );

  get diagnostics detached_snapshot_count = row_count;
  return detached_snapshot_count;
end;
$$;

revoke all on function public.detach_recurrence_draft_track_snapshots(uuid[])
  from public, anon, authenticated;
grant execute on function public.detach_recurrence_draft_track_snapshots(uuid[])
  to service_role;

create or replace function public.detach_deleted_recurrence_rule_draft_tracks()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.detach_recurrence_draft_track_snapshots(array[old.id]);
  return old;
end;
$$;

revoke all on function public.detach_deleted_recurrence_rule_draft_tracks()
  from public, anon, authenticated;
grant execute on function public.detach_deleted_recurrence_rule_draft_tracks()
  to service_role;

drop trigger if exists league_recurrence_rules_detach_draft_tracks
  on public.league_recurrence_rules;
create trigger league_recurrence_rules_detach_draft_tracks
after delete on public.league_recurrence_rules
for each row execute function public.detach_deleted_recurrence_rule_draft_tracks();

create or replace function public.remove_deleted_event_recurrence_sources()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_event_edition_id uuid;
begin
  target_event_edition_id := case when tg_op = 'DELETE' then old.id else new.id end;

  delete from public.league_recurrence_occurrences occurrence
  using public.league_recurrence_rules rule
  where occurrence.recurrence_rule_id = rule.id
    and rule.source_event_edition_id = target_event_edition_id;

  delete from public.league_recurrence_rules rule
  where rule.source_event_edition_id = target_event_edition_id;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.remove_deleted_event_recurrence_sources()
  from public, anon, authenticated;
grant execute on function public.remove_deleted_event_recurrence_sources()
  to service_role;

drop trigger if exists event_editions_remove_recurrence_sources_before_delete
  on public.event_editions;
create trigger event_editions_remove_recurrence_sources_before_delete
before delete on public.event_editions
for each row execute function public.remove_deleted_event_recurrence_sources();

drop trigger if exists event_editions_remove_recurrence_sources_after_soft_delete
  on public.event_editions;
create trigger event_editions_remove_recurrence_sources_after_soft_delete
after update of organizer_deleted_at on public.event_editions
for each row
when (old.organizer_deleted_at is null and new.organizer_deleted_at is not null)
execute function public.remove_deleted_event_recurrence_sources();

create or replace function public.remove_deleted_race_recurrence_sources()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_event_category_id uuid;
begin
  target_event_category_id := case when tg_op = 'DELETE' then old.id else new.id end;

  delete from public.league_recurrence_category_templates template
  where template.source_event_category_id = target_event_category_id;

  delete from public.league_recurrence_occurrences occurrence
  using public.league_recurrence_rules rule
  where occurrence.recurrence_rule_id = rule.id
    and rule.source_event_edition_id is not null
    and not exists (
      select 1
      from public.league_recurrence_category_templates template
      where template.recurrence_rule_id = rule.id
    );

  delete from public.league_recurrence_rules rule
  where rule.source_event_edition_id is not null
    and not exists (
      select 1
      from public.league_recurrence_category_templates template
      where template.recurrence_rule_id = rule.id
    );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.remove_deleted_race_recurrence_sources()
  from public, anon, authenticated;
grant execute on function public.remove_deleted_race_recurrence_sources()
  to service_role;

drop trigger if exists event_categories_remove_recurrence_sources_before_delete
  on public.event_categories;
create trigger event_categories_remove_recurrence_sources_before_delete
before delete on public.event_categories
for each row execute function public.remove_deleted_race_recurrence_sources();

drop trigger if exists event_categories_remove_recurrence_sources_after_soft_delete
  on public.event_categories;
create trigger event_categories_remove_recurrence_sources_after_soft_delete
after update of organizer_deleted_at on public.event_categories
for each row
when (old.organizer_deleted_at is null and new.organizer_deleted_at is not null)
execute function public.remove_deleted_race_recurrence_sources();

-- Reconcile deleted organizer records and schedules removed before these safeguards.
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

update public.event_category_track_snapshots snapshot
set
  track_template_id = null,
  track_version_id = null
from public.event_categories category
join public.event_editions edition
  on edition.id = category.event_edition_id
where snapshot.event_category_id = category.id
  and nullif(snapshot.snapshot_json ->> 'recurrenceRuleId', '') is not null
  and category.status = 'draft'
  and edition.status = 'draft'
  and edition.published_at is null
  and not exists (
    select 1
    from public.registrations registration
    where registration.event_category_id = category.id
  )
  and not exists (
    select 1
    from public.league_round_events round_event
    where round_event.event_edition_id = edition.id
  )
  and not exists (
    select 1
    from public.league_rounds round
    where round.event_edition_id = edition.id
  )
  and not exists (
    select 1
    from public.league_recurrence_occurrences occurrence
    where occurrence.event_edition_id = edition.id
  )
  and (
    snapshot.track_template_id is not null
    or snapshot.track_version_id is not null
  );

/*
 * A race with no registrations can still have append-only safety, staffing,
 * timing, or publication evidence. Try the existing physical cleanup first,
 * but fall back to the normal organizer soft-delete path when retained
 * evidence correctly prevents erasure.
 */
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
    begin
      physically_deleted := public.service_delete_unused_event_category(p_category_id);
    exception
      when foreign_key_violation
        or sqlstate 'P0001'
        or sqlstate '55000'
      then
        physically_deleted := false;
    end;
  end if;

  if not physically_deleted then
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

revoke all on function public.service_delete_organizer_event_category(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_delete_organizer_event_category(uuid, uuid)
  to service_role;

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
  affected_recurrence_rule_ids uuid[] := '{}'::uuid[];
  removed_league_schedule_count integer := 0;
  detached_draft_snapshot_count integer := 0;
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

  select coalesce(array_agg(affected.rule_id), '{}'::uuid[])
  into affected_recurrence_rule_ids
  from (
    select rule.id as rule_id
    from public.league_recurrence_rules rule
    where rule.track_template_id = p_track_template_id
    union
    select template.recurrence_rule_id as rule_id
    from public.league_recurrence_category_templates template
    where template.track_template_id = p_track_template_id
  ) affected;

  if coalesce(cardinality(affected_recurrence_rule_ids), 0) > 0 then
    perform 1
    from public.league_recurrence_rules rule
    where rule.id = any(affected_recurrence_rule_ids)
    for update;

    if exists (
      select 1
      from public.league_recurrence_occurrences occurrence
      where occurrence.recurrence_rule_id = any(affected_recurrence_rule_ids)
    ) then
      raise exception using
        errcode = '23514',
        message = 'track_has_generated_league_events';
    end if;

    detached_draft_snapshot_count :=
      public.detach_recurrence_draft_track_snapshots(affected_recurrence_rule_ids);
  end if;

  update public.event_category_track_snapshots snapshot
  set
    track_template_id = null,
    track_version_id = null
  from public.event_categories category
  join public.event_editions edition
    on edition.id = category.event_edition_id
  where snapshot.event_category_id = category.id
    and snapshot.track_template_id = p_track_template_id
    and (
      category.organizer_deleted_at is not null
      or edition.organizer_deleted_at is not null
    );

  perform 1
  from public.event_category_track_snapshots snapshot
  where snapshot.track_template_id = p_track_template_id
  for update;

  if found then
    raise exception using errcode = '23514', message = 'track_has_race_assignments';
  end if;

  delete from public.league_recurrence_rules rule
  where rule.id = any(affected_recurrence_rule_ids);

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
      'removedLeagueScheduleCount', removed_league_schedule_count,
      'detachedDraftTrackSnapshotCount', detached_draft_snapshot_count
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
      'removedLeagueScheduleCount', removed_league_schedule_count,
      'detachedDraftTrackSnapshotCount', detached_draft_snapshot_count
    ),
    p_actor_user_id,
    deletion_event_id,
    'track:' || p_track_template_id::text || ':organizer_deleted'
  );

  return jsonb_build_object(
    'deleted', true,
    'trackTemplateId', p_track_template_id,
    'removedLeagueScheduleCount', removed_league_schedule_count,
    'detachedDraftTrackSnapshotCount', detached_draft_snapshot_count
  );
end;
$$;

revoke all on function public.service_delete_organizer_track(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_delete_organizer_track(uuid, uuid, uuid)
  to service_role;

comment on function public.detach_recurrence_draft_track_snapshots(uuid[]) is
  'Detaches reusable track sources from private, unregistered recurrence-generated drafts while retaining frozen snapshot evidence.';
