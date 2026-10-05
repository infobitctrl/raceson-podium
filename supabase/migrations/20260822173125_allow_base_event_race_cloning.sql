begin;

-- A recurrence template represents every race copied from the base event. Only
-- the subset used for league standings needs a competition mapping.
alter table public.league_recurrence_category_templates
  alter column league_competition_id drop not null;

comment on column public.league_recurrence_category_templates.league_competition_id is
  'Optional standings mapping. Null templates are still copied into every generated event.';

create or replace function public.validate_league_recurrence_category_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  rule_league_season_id uuid;
  rule_source_event_edition_id uuid;
  rule_organization_id uuid;
  competition_league_season_id uuid;
  source_category_event_edition_id uuid;
  effective_track_template_id uuid;
  effective_track_version_id uuid;
  effective_track_organization_id uuid;
  effective_track_sport_code text;
  version_track_template_id uuid;
  target_league_id uuid;
begin
  select
    rule.league_season_id,
    rule.source_event_edition_id,
    league.organization_id,
    season.league_id,
    coalesce(new.track_template_id, rule.track_template_id),
    coalesce(new.track_version_id, rule.track_version_id)
  into
    rule_league_season_id,
    rule_source_event_edition_id,
    rule_organization_id,
    target_league_id,
    effective_track_template_id,
    effective_track_version_id
  from public.league_recurrence_rules rule
  join public.league_seasons season on season.id = rule.league_season_id
  join public.leagues league on league.id = season.league_id
  where rule.id = new.recurrence_rule_id;

  if new.league_competition_id is not null then
    select competition.league_season_id
    into competition_league_season_id
    from public.league_competitions competition
    where competition.id = new.league_competition_id;
  end if;

  select track.organization_id, track.sport_code
  into effective_track_organization_id, effective_track_sport_code
  from public.track_templates track
  where track.id = effective_track_template_id;

  select version.track_template_id
  into version_track_template_id
  from public.track_versions version
  where version.id = effective_track_version_id;

  if new.source_event_category_id is not null then
    select category.event_edition_id
    into source_category_event_edition_id
    from public.event_categories category
    where category.id = new.source_event_category_id;
  end if;

  if new.league_competition_id is not null
     and competition_league_season_id is distinct from rule_league_season_id then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_competition_scope_mismatch';
  end if;

  if effective_track_organization_id is distinct from rule_organization_id then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_category_track_scope_mismatch';
  end if;

  if version_track_template_id is distinct from effective_track_template_id then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_category_track_version_scope_mismatch';
  end if;

  if new.sport_code is distinct from effective_track_sport_code then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_category_sport_mismatch';
  end if;

  if not exists (
    select 1
    from public.league_sports league_sport
    where league_sport.league_id = target_league_id
      and league_sport.sport_code = effective_track_sport_code
  ) then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_category_league_sport_mismatch';
  end if;

  if new.source_event_category_id is not null
     and source_category_event_edition_id is distinct from rule_source_event_edition_id then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_source_race_scope_mismatch';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_league_recurrence_category_scope()
from public, anon, authenticated;
grant execute on function public.validate_league_recurrence_category_scope()
to service_role;

comment on function public.validate_league_recurrence_category_scope() is
  'Keeps every copied recurring race inside its base-event, organizer, route, and sport boundary; a standings competition mapping is optional.';

-- Track assignment is the authoritative sport boundary for a configured race.
-- Repair legacy mismatches so valid base events are not hidden from recurrence.
create temporary table recurrence_base_event_sport_repairs
on commit drop
as
select
  category.id as event_category_id,
  category.event_edition_id,
  category.sport_code as old_sport_code,
  track.sport_code as new_sport_code,
  coalesce(edition_sport.is_primary, false) as was_primary
from public.event_category_track_snapshots snapshot
join public.event_categories category
  on category.id = snapshot.event_category_id
join public.event_editions edition
  on edition.id = category.event_edition_id
join public.track_templates track
  on track.id = snapshot.track_template_id
left join public.event_edition_sports edition_sport
  on edition_sport.event_edition_id = category.event_edition_id
 and edition_sport.sport_code = category.sport_code
where edition.organizer_deleted_at is null
  and category.organizer_deleted_at is null
  and category.sport_code <> track.sport_code;

update public.event_categories category
set sport_code = repair.new_sport_code
from recurrence_base_event_sport_repairs repair
where category.id = repair.event_category_id;

update public.event_edition_sports edition_sport
set is_primary = false
from recurrence_base_event_sport_repairs repair
where repair.was_primary
  and edition_sport.event_edition_id = repair.event_edition_id
  and edition_sport.sport_code = repair.old_sport_code;

insert into public.event_edition_sports (
  event_edition_id,
  sport_code,
  is_primary
)
select
  repair.event_edition_id,
  repair.new_sport_code,
  bool_or(repair.was_primary)
from recurrence_base_event_sport_repairs repair
group by repair.event_edition_id, repair.new_sport_code
on conflict (event_edition_id, sport_code)
do update set is_primary = public.event_edition_sports.is_primary or excluded.is_primary;

delete from public.event_edition_sports edition_sport
using recurrence_base_event_sport_repairs repair
where edition_sport.event_edition_id = repair.event_edition_id
  and edition_sport.sport_code = repair.old_sport_code
  and not exists (
    select 1
    from public.event_categories category
    where category.event_edition_id = edition_sport.event_edition_id
      and category.sport_code = edition_sport.sport_code
      and category.organizer_deleted_at is null
  );

commit;
