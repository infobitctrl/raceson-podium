-- Recurring schedules are materialized with the service role, so their league
-- boundary must be enforced below RLS as well as in the application service.

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

  return new;
end;
$$;

drop trigger if exists league_recurrence_rules_validate_scope
on public.league_recurrence_rules;
create trigger league_recurrence_rules_validate_scope
before insert or update of
  league_season_id,
  event_series_id,
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
  rule_track_sport_code text;
  competition_league_season_id uuid;
begin
  select rule.league_season_id, track.sport_code
  into rule_league_season_id, rule_track_sport_code
  from public.league_recurrence_rules rule
  join public.track_templates track on track.id = rule.track_template_id
  where rule.id = new.recurrence_rule_id;

  select competition.league_season_id
  into competition_league_season_id
  from public.league_competitions competition
  where competition.id = new.league_competition_id;

  if competition_league_season_id is distinct from rule_league_season_id then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_competition_scope_mismatch';
  end if;

  if new.sport_code is distinct from rule_track_sport_code then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_category_sport_mismatch';
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

comment on function public.validate_league_recurrence_rule_scope() is
  'Prevents a recurring schedule from crossing league organization, track, version, or sport boundaries.';
comment on function public.validate_league_recurrence_category_scope() is
  'Keeps each generated race template inside its recurrence rule league season and track sport.';
