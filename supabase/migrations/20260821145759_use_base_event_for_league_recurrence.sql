-- A recurring league rule is now based on a complete organizer event edition.
-- The rule keeps the source event lineage while each race template snapshots its
-- own route and checkpoint setup. Existing track-based rules remain compatible.

alter table public.league_recurrence_rules
  add column if not exists source_event_edition_id uuid
    references public.event_editions(id) on delete restrict;

alter table public.league_recurrence_category_templates
  add column if not exists source_event_category_id uuid
    references public.event_categories(id) on delete restrict,
  add column if not exists track_template_id uuid
    references public.track_templates(id) on delete restrict,
  add column if not exists track_version_id uuid
    references public.track_versions(id) on delete restrict,
  add column if not exists category_snapshot_json jsonb not null default '{}'::jsonb,
  add column if not exists track_snapshot_json jsonb not null default '{}'::jsonb,
  add column if not exists checkpoints_json jsonb not null default '[]'::jsonb;

update public.league_recurrence_category_templates template
set
  track_template_id = rule.track_template_id,
  track_version_id = rule.track_version_id
from public.league_recurrence_rules rule
where rule.id = template.recurrence_rule_id
  and (template.track_template_id is null or template.track_version_id is null);

alter table public.league_recurrence_category_templates
  drop constraint if exists league_recurrence_category_templates_track_pair_check;
alter table public.league_recurrence_category_templates
  add constraint league_recurrence_category_templates_track_pair_check
  check (num_nonnulls(track_template_id, track_version_id) in (0, 2));

create index if not exists league_recurrence_rules_source_event_idx
  on public.league_recurrence_rules (source_event_edition_id)
  where source_event_edition_id is not null;

create index if not exists league_recurrence_category_templates_source_race_idx
  on public.league_recurrence_category_templates (source_event_category_id)
  where source_event_category_id is not null;

create or replace function public.validate_league_recurrence_rule_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_league_id uuid;
  league_organization_id uuid;
  series_organization_id uuid;
  track_organization_id uuid;
  track_sport_code text;
  version_track_template_id uuid;
  source_event_series_id uuid;
  source_event_organization_id uuid;
  source_event_is_practice boolean;
begin
  select season.league_id, league.organization_id
  into target_league_id, league_organization_id
  from public.league_seasons season
  join public.leagues league on league.id = season.league_id
  where season.id = new.league_season_id;

  select series.organization_id
  into series_organization_id
  from public.event_series series
  where series.id = new.event_series_id;

  select track.organization_id, track.sport_code
  into track_organization_id, track_sport_code
  from public.track_templates track
  where track.id = new.track_template_id;

  select version.track_template_id
  into version_track_template_id
  from public.track_versions version
  where version.id = new.track_version_id;

  if new.source_event_edition_id is not null then
    select edition.event_series_id, series.organization_id, coalesce(edition.is_practice, false)
    into source_event_series_id, source_event_organization_id, source_event_is_practice
    from public.event_editions edition
    join public.event_series series on series.id = edition.event_series_id
    where edition.id = new.source_event_edition_id;
  end if;

  if series_organization_id is distinct from league_organization_id then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_event_series_scope_mismatch';
  end if;

  if track_organization_id is distinct from league_organization_id then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_track_scope_mismatch';
  end if;

  if version_track_template_id is distinct from new.track_template_id then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_track_version_scope_mismatch';
  end if;

  if not exists (
    select 1
    from public.league_sports league_sport
    where league_sport.league_id = target_league_id
      and league_sport.sport_code = track_sport_code
  ) then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_track_sport_mismatch';
  end if;

  if new.source_event_edition_id is not null then
    if source_event_organization_id is distinct from league_organization_id then
      raise exception using
        errcode = '23514',
        message = 'league_recurrence_source_event_scope_mismatch';
    end if;

    if source_event_series_id is distinct from new.event_series_id then
      raise exception using
        errcode = '23514',
        message = 'league_recurrence_source_event_series_mismatch';
    end if;

    if source_event_is_practice then
      raise exception using
        errcode = '23514',
        message = 'league_recurrence_source_event_is_practice';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists league_recurrence_rules_validate_scope
on public.league_recurrence_rules;
create trigger league_recurrence_rules_validate_scope
before insert or update of
  league_season_id,
  event_series_id,
  source_event_edition_id,
  track_template_id,
  track_version_id
on public.league_recurrence_rules
for each row execute function public.validate_league_recurrence_rule_scope();

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

  select competition.league_season_id
  into competition_league_season_id
  from public.league_competitions competition
  where competition.id = new.league_competition_id;

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

  if competition_league_season_id is distinct from rule_league_season_id then
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

drop trigger if exists league_recurrence_category_templates_validate_scope
on public.league_recurrence_category_templates;
create trigger league_recurrence_category_templates_validate_scope
before insert or update of
  recurrence_rule_id,
  league_competition_id,
  source_event_category_id,
  track_template_id,
  track_version_id,
  sport_code
on public.league_recurrence_category_templates
for each row execute function public.validate_league_recurrence_category_scope();

revoke all on function public.validate_league_recurrence_rule_scope()
from public, anon, authenticated;
revoke all on function public.validate_league_recurrence_category_scope()
from public, anon, authenticated;
grant execute on function public.validate_league_recurrence_rule_scope()
to service_role;
grant execute on function public.validate_league_recurrence_category_scope()
to service_role;

comment on column public.league_recurrence_rules.source_event_edition_id is
  'Organizer event edition used as the immutable structural template for newly materialized occurrences.';
comment on column public.league_recurrence_category_templates.source_event_category_id is
  'Source race lineage for a recurring league competition mapping.';
comment on column public.league_recurrence_category_templates.category_snapshot_json is
  'Base-event race settings captured when the recurring rule is created.';
comment on column public.league_recurrence_category_templates.track_snapshot_json is
  'Base-event route snapshot captured when the recurring rule is created.';
comment on column public.league_recurrence_category_templates.checkpoints_json is
  'Base-event checkpoint templates captured when the recurring rule is created.';
comment on function public.validate_league_recurrence_rule_scope() is
  'Prevents a recurring schedule and its source base event from crossing league organization, series, track, version, or sport boundaries.';
comment on function public.validate_league_recurrence_category_scope() is
  'Keeps each recurring race mapping, source race, route, and sport inside its league and base-event boundary.';
