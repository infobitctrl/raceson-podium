begin;

-- A recurrence rule copies one complete organizer event. That source event is
-- the league's original Round 1; generated output starts strictly afterwards.

create temporary table recurrence_round_one_orphans
on commit drop
as
select generated.id
from public.event_editions generated
join public.event_editions source
  on source.id = generated.recurrence_source_event_edition_id
where generated.is_recurrence_generated
  and generated.start_date <= source.start_date
  and generated.organizer_deleted_at is null
  and not exists (
    select 1
    from public.league_round_events round_event
    where round_event.event_edition_id = generated.id
  )
  and not exists (
    select 1
    from public.league_rounds legacy_round
    where legacy_round.event_edition_id = generated.id
  )
  and not exists (
    select 1
    from public.event_categories category
    join public.registrations registration
      on registration.event_category_id = category.id
    where category.event_edition_id = generated.id
  )
  and not exists (
    select 1
    from public.event_categories category
    join public.result_rows result
      on result.event_category_id = category.id
    where category.event_edition_id = generated.id
  )
  and not exists (
    select 1
    from public.event_categories category
    join public.result_publications publication
      on publication.event_category_id = category.id
    where category.event_edition_id = generated.id
  )
  and not exists (
    select 1
    from public.race_start_events start_event
    where start_event.event_edition_id = generated.id
  )
  and not exists (
    select 1
    from public.timing_sessions timing_session
    where timing_session.event_edition_id = generated.id
  );

delete from public.league_recurrence_occurrences occurrence
using public.league_recurrence_rules rule,
      public.event_editions source
where rule.id = occurrence.recurrence_rule_id
  and source.id = rule.source_event_edition_id
  and occurrence.scheduled_date <= source.start_date
  and (
    occurrence.event_edition_id is null
    or occurrence.event_edition_id in (
      select orphan.id from recurrence_round_one_orphans orphan
    )
  );

update public.event_editions generated
set
  organizer_deleted_at = coalesce(generated.organizer_deleted_at, now()),
  organizer_deleted_by_user_id = null,
  public_visibility = 'private'
where generated.id in (
  select orphan.id from recurrence_round_one_orphans orphan
);

delete from public.league_recurrence_overrides override
using public.league_recurrence_rules rule,
      public.event_editions source
where rule.id = override.recurrence_rule_id
  and source.id = rule.source_event_edition_id
  and (
    override.source_date <= source.start_date
    or override.replacement_date <= source.start_date
  );

update public.league_recurrence_rules rule
set status = 'archived'
where rule.status = 'active'
  and (
    rule.source_event_edition_id is null
    or exists (
      select 1
      from public.event_editions source
      where source.id = rule.source_event_edition_id
        and rule.valid_until <= source.start_date
    )
  );

update public.league_recurrence_rules rule
set valid_from = source.start_date + 1
from public.event_editions source
where source.id = rule.source_event_edition_id
  and rule.status = 'active'
  and rule.valid_from <= source.start_date;

-- Attach the source event when a season is empty or contains only copies made
-- from that same source. A temporary number avoids uniqueness conflicts before
-- the chronological two-phase reorder below.
with source_candidates as (
  select
    rule.league_season_id,
    rule.source_event_edition_id,
    coalesce((
      select max(existing.round_number)
      from public.league_round_events existing
      where existing.league_season_id = rule.league_season_id
    ), 0) + 1 as temporary_round_number
  from public.league_recurrence_rules rule
  where rule.status = 'active'
    and rule.source_event_edition_id is not null
    and not exists (
      select 1
      from public.league_round_events existing
      where existing.league_season_id = rule.league_season_id
        and existing.event_edition_id = rule.source_event_edition_id
    )
    and not exists (
      select 1
      from public.league_round_events existing
      join public.event_editions edition on edition.id = existing.event_edition_id
      where existing.league_season_id = rule.league_season_id
        and (
          not edition.is_recurrence_generated
          or edition.recurrence_source_event_edition_id is distinct from rule.source_event_edition_id
        )
    )
)
insert into public.league_round_events (
  league_season_id,
  event_edition_id,
  round_number,
  status
)
select
  candidate.league_season_id,
  candidate.source_event_edition_id,
  candidate.temporary_round_number,
  'scheduled'
from source_candidates candidate
on conflict (league_season_id, event_edition_id) do nothing;

insert into public.league_round_race_mappings (
  league_round_event_id,
  league_competition_id,
  event_category_id,
  status
)
select
  round_event.id,
  template.league_competition_id,
  template.source_event_category_id,
  'mapped'
from public.league_recurrence_rules rule
join public.league_round_events round_event
  on round_event.league_season_id = rule.league_season_id
 and round_event.event_edition_id = rule.source_event_edition_id
join public.league_recurrence_category_templates template
  on template.recurrence_rule_id = rule.id
where rule.status = 'active'
  and template.league_competition_id is not null
  and template.source_event_category_id is not null
on conflict (league_round_event_id, league_competition_id) do update
set
  event_category_id = excluded.event_category_id,
  status = 'mapped';

with primary_source_races as (
  select distinct on (rule.league_season_id)
    rule.league_season_id,
    rule.source_event_edition_id,
    template.source_event_category_id
  from public.league_recurrence_rules rule
  join public.league_recurrence_category_templates template
    on template.recurrence_rule_id = rule.id
  where rule.status = 'active'
    and template.league_competition_id is not null
    and template.source_event_category_id is not null
  order by rule.league_season_id, template.display_order, template.id
), source_candidates as (
  select
    source_race.*,
    coalesce((
      select max(existing.round_number)
      from public.league_rounds existing
      where existing.league_season_id = source_race.league_season_id
    ), 0) + 1 as temporary_round_number
  from primary_source_races source_race
  where not exists (
    select 1
    from public.league_rounds existing
    where existing.league_season_id = source_race.league_season_id
      and existing.event_category_id = source_race.source_event_category_id
  )
)
insert into public.league_rounds (
  league_season_id,
  event_edition_id,
  event_category_id,
  round_number,
  status
)
select
  candidate.league_season_id,
  candidate.source_event_edition_id,
  candidate.source_event_category_id,
  candidate.temporary_round_number,
  'scheduled'
from source_candidates candidate
on conflict (league_season_id, event_category_id) do nothing;

with season_offsets as (
  select
    round_event.league_season_id,
    max(round_event.round_number) + count(*)::integer + 1 as offset
  from public.league_round_events round_event
  group by round_event.league_season_id
)
update public.league_round_events round_event
set round_number = round_event.round_number + season_offsets.offset
from season_offsets
where season_offsets.league_season_id = round_event.league_season_id;

with chronological_rounds as (
  select
    round_event.id,
    row_number() over (
      partition by round_event.league_season_id
      order by edition.start_date, round_event.event_edition_id, round_event.id
    )::integer as round_number
  from public.league_round_events round_event
  join public.event_editions edition on edition.id = round_event.event_edition_id
)
update public.league_round_events round_event
set round_number = chronological_rounds.round_number
from chronological_rounds
where chronological_rounds.id = round_event.id;

with season_offsets as (
  select
    legacy_round.league_season_id,
    max(legacy_round.round_number) + count(*)::integer + 1 as offset
  from public.league_rounds legacy_round
  group by legacy_round.league_season_id
)
update public.league_rounds legacy_round
set round_number = legacy_round.round_number + season_offsets.offset
from season_offsets
where season_offsets.league_season_id = legacy_round.league_season_id;

with chronological_rounds as (
  select
    legacy_round.id,
    row_number() over (
      partition by legacy_round.league_season_id
      order by edition.start_date, legacy_round.event_edition_id, legacy_round.id
    )::integer as round_number
  from public.league_rounds legacy_round
  join public.event_editions edition on edition.id = legacy_round.event_edition_id
)
update public.league_rounds legacy_round
set round_number = chronological_rounds.round_number
from chronological_rounds
where chronological_rounds.id = legacy_round.id;

create or replace function public.enforce_league_recurrence_round_one_workflow()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  source_event public.event_editions%rowtype;
  target_season public.league_seasons%rowtype;
begin
  if new.status <> 'active' then
    return new;
  end if;

  if new.source_event_edition_id is null then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_round_one_event_required';
  end if;

  select edition.*
  into source_event
  from public.event_editions edition
  where edition.id = new.source_event_edition_id;

  select season.*
  into target_season
  from public.league_seasons season
  where season.id = new.league_season_id;

  if source_event.id is null
     or source_event.organizer_deleted_at is not null
     or source_event.is_practice
     or source_event.is_recurrence_generated then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_round_one_event_invalid';
  end if;

  if (target_season.starts_on is not null and source_event.start_date < target_season.starts_on)
     or (target_season.ends_on is not null and source_event.start_date > target_season.ends_on) then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_round_one_outside_season';
  end if;

  if new.valid_from <= source_event.start_date then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_must_start_after_round_one';
  end if;

  return new;
end;
$$;

drop trigger if exists league_recurrence_rules_enforce_round_one
on public.league_recurrence_rules;
create trigger league_recurrence_rules_enforce_round_one
before insert or update of
  league_season_id,
  source_event_edition_id,
  valid_from,
  valid_until,
  status
on public.league_recurrence_rules
for each row execute function public.enforce_league_recurrence_round_one_workflow();

create or replace function public.enforce_league_recurrence_occurrence_after_round_one()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  round_one_date date;
begin
  select source.start_date
  into round_one_date
  from public.league_recurrence_rules rule
  join public.event_editions source on source.id = rule.source_event_edition_id
  where rule.id = new.recurrence_rule_id;

  if round_one_date is null or new.scheduled_date <= round_one_date then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_occurrence_must_follow_round_one';
  end if;

  return new;
end;
$$;

drop trigger if exists league_recurrence_occurrences_enforce_after_round_one
on public.league_recurrence_occurrences;
create trigger league_recurrence_occurrences_enforce_after_round_one
before insert or update of recurrence_rule_id, scheduled_date
on public.league_recurrence_occurrences
for each row execute function public.enforce_league_recurrence_occurrence_after_round_one();

create or replace function public.enforce_generated_event_after_recurrence_source()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  source_date date;
begin
  if not new.is_recurrence_generated then
    return new;
  end if;

  select source.start_date
  into source_date
  from public.event_editions source
  where source.id = new.recurrence_source_event_edition_id
    and source.organizer_deleted_at is null
    and not source.is_practice
    and not source.is_recurrence_generated;

  if source_date is null or new.start_date <= source_date then
    raise exception using
      errcode = '23514',
      message = 'generated_event_must_follow_recurrence_source';
  end if;

  return new;
end;
$$;

drop trigger if exists event_editions_enforce_recurrence_source_order
on public.event_editions;
create trigger event_editions_enforce_recurrence_source_order
before insert or update of
  is_recurrence_generated,
  recurrence_source_event_edition_id,
  start_date
on public.event_editions
for each row execute function public.enforce_generated_event_after_recurrence_source();

revoke all on function public.enforce_league_recurrence_round_one_workflow()
  from public, anon, authenticated;
revoke all on function public.enforce_league_recurrence_occurrence_after_round_one()
  from public, anon, authenticated;
revoke all on function public.enforce_generated_event_after_recurrence_source()
  from public, anon, authenticated;
grant execute on function public.enforce_league_recurrence_round_one_workflow()
  to service_role;
grant execute on function public.enforce_league_recurrence_occurrence_after_round_one()
  to service_role;
grant execute on function public.enforce_generated_event_after_recurrence_source()
  to service_role;

comment on function public.enforce_league_recurrence_round_one_workflow() is
  'Requires one complete organizer event inside the season as Round 1 and permits generated recurrence dates only afterwards.';
comment on function public.enforce_league_recurrence_occurrence_after_round_one() is
  'Rejects stored recurrence occurrences on or before the original Round 1 event date.';
comment on function public.enforce_generated_event_after_recurrence_source() is
  'Rejects recurring event copies that would duplicate or precede their original Round 1 event.';

commit;
