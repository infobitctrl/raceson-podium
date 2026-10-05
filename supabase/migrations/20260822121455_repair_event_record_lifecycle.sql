begin;

/*
 * Platform administration needs a lifecycle-aware event-series read model.
 * event_series.status is editable business metadata; it must not be used to
 * infer whether the child editions are current, deleted history, or practice
 * data. Keep that classification derived from the edition rows themselves.
 */
create or replace view public.platform_event_series_lifecycle
with (security_invoker = true)
as
select
  series.id,
  series.organization_id,
  series.slug,
  series.name,
  series.description,
  series.location_name,
  series.country_code,
  series.status as series_status,
  series.updated_at,
  count(edition.id) filter (
    where edition.organizer_deleted_at is null
      and not edition.is_practice
  )::integer as business_edition_count,
  count(edition.id) filter (
    where edition.organizer_deleted_at is null
      and edition.is_practice
  )::integer as practice_edition_count,
  count(edition.id) filter (
    where edition.organizer_deleted_at is not null
  )::integer as deleted_edition_count,
  count(edition.id)::integer as total_edition_count,
  case
    when count(edition.id) filter (
      where edition.organizer_deleted_at is null
        and not edition.is_practice
    ) > 0 then 'business'
    when count(edition.id) filter (
      where edition.organizer_deleted_at is null
        and edition.is_practice
    ) > 0 then 'sandbox'
    when count(edition.id) = 0 then 'orphaned'
    else 'deleted_history'
  end as lifecycle
from public.event_series series
left join public.event_editions edition
  on edition.event_series_id = series.id
group by series.id;

revoke all on public.platform_event_series_lifecycle
  from public, anon, authenticated;
grant select on public.platform_event_series_lifecycle to service_role;

comment on view public.platform_event_series_lifecycle is
  'Service-role admin inventory of event series classified as current business data, private sandbox data, retained deletion history, or empty/orphaned parents.';

/*
 * Generated draft editions with no operational or historical evidence are
 * derivative schedule output, not history. Remove them physically when their
 * recurrence lineage is removed, then remove the empty parent series. The
 * function deliberately retains any generated edition with participant,
 * league, result, staffing, timing, publication, finance, presentation, or
 * audited organizer-deletion evidence.
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

  if not found then
    return false;
  end if;

  if not target_is_generated
     or target_published_at is not null
     or (target_status <> 'draft' and target_deleted_at is null)
     or exists (
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
       from public.league_rounds round_legacy
       where round_legacy.event_edition_id = p_event_edition_id
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
       from public.organizer_event_presentation_versions presentation
       where presentation.event_edition_id = p_event_edition_id
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
  'Physically removes disposable generated draft output and its empty parent series after proving that no recurrence occurrence, league round, participant, result, staff, timing, publication, presentation, finance, or organizer-deletion evidence exists.';

-- Reconcile derivative rows previously tombstoned by the older cleanup path.
do $$
declare
  orphan_event_edition_id uuid;
begin
  for orphan_event_edition_id in
    select edition.id
    from public.event_editions edition
    where edition.is_recurrence_generated
      and (
        edition.organizer_deleted_at is not null
        or not exists (
          select 1
          from public.league_recurrence_occurrences occurrence
          where occurrence.event_edition_id = edition.id
        )
      )
  loop
    perform public.service_tombstone_orphaned_recurrence_event(
      orphan_event_edition_id
    );
  end loop;
end
$$;

commit;
