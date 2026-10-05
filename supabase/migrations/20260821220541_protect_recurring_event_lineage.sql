/*
 * Recurrence materialization is a one-way copy operation. Generated event
 * editions must never become base events for another recurrence rule, and an
 * interrupted or detached materialization must not remain organizer-visible.
 *
 * Keep lineage on the event edition itself instead of relying solely on the
 * category track snapshot. The boolean remains true after a source rule or
 * base event is deleted, so generated copies cannot silently become eligible
 * templates later.
 */

alter table public.event_editions
  add column if not exists is_recurrence_generated boolean not null default false,
  add column if not exists recurrence_rule_id uuid
    references public.league_recurrence_rules(id) on delete set null,
  add column if not exists recurrence_source_event_edition_id uuid
    references public.event_editions(id) on delete set null,
  add column if not exists recurrence_source_date date;

create index if not exists event_editions_recurrence_rule_idx
  on public.event_editions(recurrence_rule_id, recurrence_source_date)
  where is_recurrence_generated;

create index if not exists event_editions_recurrence_source_idx
  on public.event_editions(recurrence_source_event_edition_id)
  where recurrence_source_event_edition_id is not null;

comment on column public.event_editions.is_recurrence_generated is
  'True only for an event edition copied by recurring-schedule materialization. Generated editions can never be recurrence templates.';
comment on column public.event_editions.recurrence_rule_id is
  'The currently retained recurrence rule that generated this edition. The generated flag remains true if the rule is deleted.';
comment on column public.event_editions.recurrence_source_event_edition_id is
  'The organizer-authored base event copied into this generated edition, when that source still exists.';
comment on column public.event_editions.recurrence_source_date is
  'The source schedule date used to materialize this generated edition.';

-- Backfill editions produced before edition-level lineage was introduced.
with snapshot_lineage as (
  select
    category.event_edition_id,
    min(snapshot.snapshot_json ->> 'recurrenceRuleId') as recurrence_rule_id_text,
    min(snapshot.snapshot_json ->> 'sourceEventEditionId') as source_event_edition_id_text,
    min(snapshot.snapshot_json ->> 'sourceDate') as source_date_text
  from public.event_category_track_snapshots snapshot
  join public.event_categories category
    on category.id = snapshot.event_category_id
  where snapshot.snapshot_json ? 'recurrenceRuleId'
  group by category.event_edition_id
), resolved_lineage as (
  select
    lineage.event_edition_id,
    rule.id as recurrence_rule_id,
    source_event.id as source_event_edition_id,
    case
      when lineage.source_date_text ~ '^\d{4}-\d{2}-\d{2}$'
        then lineage.source_date_text::date
      else null
    end as source_date
  from snapshot_lineage lineage
  left join public.league_recurrence_rules rule
    on rule.id = case
      when lineage.recurrence_rule_id_text ~ '^[0-9a-fA-F-]{36}$'
        then lineage.recurrence_rule_id_text::uuid
      else null
    end
  left join public.event_editions source_event
    on source_event.id = case
      when lineage.source_event_edition_id_text ~ '^[0-9a-fA-F-]{36}$'
        then lineage.source_event_edition_id_text::uuid
      else null
    end
)
update public.event_editions edition
set
  is_recurrence_generated = true,
  recurrence_rule_id = lineage.recurrence_rule_id,
  recurrence_source_event_edition_id = lineage.source_event_edition_id,
  recurrence_source_date = lineage.source_date
from resolved_lineage lineage
where edition.id = lineage.event_edition_id;

create or replace function public.validate_recurrence_base_event_lineage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  source_is_generated boolean;
  source_deleted_at timestamptz;
begin
  if new.source_event_edition_id is null then
    return new;
  end if;

  select
    edition.is_recurrence_generated,
    edition.organizer_deleted_at
  into source_is_generated, source_deleted_at
  from public.event_editions edition
  where edition.id = new.source_event_edition_id;

  if source_deleted_at is not null then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_source_event_is_deleted';
  end if;

  if coalesce(source_is_generated, false) then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_source_event_is_generated';
  end if;

  return new;
end;
$$;

drop trigger if exists league_recurrence_rules_validate_base_event_lineage
  on public.league_recurrence_rules;
create trigger league_recurrence_rules_validate_base_event_lineage
before insert or update of source_event_edition_id
on public.league_recurrence_rules
for each row execute function public.validate_recurrence_base_event_lineage();

revoke all on function public.validate_recurrence_base_event_lineage()
  from public, anon, authenticated;
grant execute on function public.validate_recurrence_base_event_lineage()
  to service_role;

/*
 * Tombstone only disposable recurrence output. The function intentionally
 * refuses to hide materialized rounds or any event with participant, result,
 * staffing, timing, presentation, or finance evidence.
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
  target_is_generated boolean := false;
  target_status text;
  target_published_at timestamptz;
begin
  select
    edition.is_recurrence_generated,
    edition.status::text,
    edition.published_at
  into target_is_generated, target_status, target_published_at
  from public.event_editions edition
  where edition.id = p_event_edition_id
    and edition.organizer_deleted_at is null
  for update;

  if not found then
    return false;
  end if;

  if not target_is_generated
     or target_status <> 'draft'
     or target_published_at is not null
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
     ) then
    return false;
  end if;

  update public.event_category_track_snapshots snapshot
  set
    track_template_id = null,
    track_version_id = null
  from public.event_categories category
  where category.id = snapshot.event_category_id
    and category.event_edition_id = p_event_edition_id;

  update public.event_editions edition
  set organizer_deleted_at = now()
  where edition.id = p_event_edition_id;

  return true;
end;
$$;

revoke all on function public.service_tombstone_orphaned_recurrence_event(uuid)
  from public, anon, authenticated;
grant execute on function public.service_tombstone_orphaned_recurrence_event(uuid)
  to service_role;

comment on function public.service_tombstone_orphaned_recurrence_event(uuid) is
  'Hides a generated draft only after proving it has no recurrence occurrence, league round, participant, result, staff, timing, presentation, or finance evidence.';

create or replace function public.detach_deleted_recurrence_rule_draft_tracks()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  generated_event_edition_id uuid;
begin
  perform public.detach_recurrence_draft_track_snapshots(array[old.id]);

  for generated_event_edition_id in
    select distinct category.event_edition_id
    from public.event_category_track_snapshots snapshot
    join public.event_categories category
      on category.id = snapshot.event_category_id
    where snapshot.snapshot_json ->> 'recurrenceRuleId' = old.id::text
  loop
    perform public.service_tombstone_orphaned_recurrence_event(
      generated_event_edition_id
    );
  end loop;

  return old;
end;
$$;

revoke all on function public.detach_deleted_recurrence_rule_draft_tracks()
  from public, anon, authenticated;
grant execute on function public.detach_deleted_recurrence_rule_draft_tracks()
  to service_role;

-- Track-based legacy rules with no materialized occurrence cannot satisfy the
-- new base-event contract. Remove them so the organizer starts from a clean
-- base-event definition; preserve materialized legacy history as archived.
update public.league_recurrence_rules rule
set status = 'archived'
where rule.source_event_edition_id is null
  and exists (
    select 1
    from public.league_recurrence_occurrences occurrence
    where occurrence.recurrence_rule_id = rule.id
      and occurrence.state = 'materialized'
  );

delete from public.league_recurrence_occurrences occurrence
using public.league_recurrence_rules rule
where occurrence.recurrence_rule_id = rule.id
  and rule.source_event_edition_id is null
  and not exists (
    select 1
    from public.league_recurrence_occurrences materialized
    where materialized.recurrence_rule_id = rule.id
      and materialized.state = 'materialized'
  );

delete from public.league_recurrence_rules rule
where rule.source_event_edition_id is null
  and not exists (
    select 1
    from public.league_recurrence_occurrences materialized
    where materialized.recurrence_rule_id = rule.id
      and materialized.state = 'materialized'
  );

-- Reconcile derivative drafts left behind by earlier interrupted, replaced,
-- or detached recurrence runs. This is a tombstone, not destructive deletion.
do $$
declare
  orphan_event_edition_id uuid;
begin
  for orphan_event_edition_id in
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
      orphan_event_edition_id
    );
  end loop;
end
$$;
