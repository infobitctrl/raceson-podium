-- Historical imports may know only a birth year. League classifications use
-- age reached on December 31 of the season year, so a year is sufficient and
-- no synthetic month/day is needed. Prefer the immutable registration
-- snapshot, then the profile birth year, then the year of a full birth date.

do $migration$
declare
  compute_definition text;
  old_age_expression text := $old$      case
        when athlete.date_of_birth is null then null
        else extract(
          year from age(make_date(season_row.year, 12, 31), athlete.date_of_birth)
        )::numeric
      end as athlete_age,$old$;
  new_age_expression text := $new$      case
        when coalesce(
          registration.birth_year_snapshot,
          athlete.birth_year,
          extract(year from athlete.date_of_birth)::smallint
        ) between 1900 and season_row.year
        then (
          season_row.year - coalesce(
            registration.birth_year_snapshot,
            athlete.birth_year,
            extract(year from athlete.date_of_birth)::smallint
          )
        )::numeric
        else null
      end as athlete_age,$new$;
  old_athlete_join text := $old$    join public.athlete_profiles athlete
      on athlete.id = result.athlete_profile_id
    where round_event.league_season_id = p_league_season_id$old$;
  new_athlete_join text := $new$    join public.athlete_profiles athlete
      on athlete.id = result.athlete_profile_id
    join public.registrations registration
      on registration.id = result.registration_id
     and registration.athlete_profile_id = result.athlete_profile_id
    where round_event.league_season_id = p_league_season_id$new$;
  age_replacement_count integer;
  join_replacement_count integer;
begin
  select pg_get_functiondef(
    'public.service_compute_league_standings(uuid,uuid,uuid,text,uuid)'::regprocedure
  ) into compute_definition;

  age_replacement_count := (
    length(compute_definition) - length(replace(compute_definition, old_age_expression, ''))
  ) / length(old_age_expression);
  join_replacement_count := (
    length(compute_definition) - length(replace(compute_definition, old_athlete_join, ''))
  ) / length(old_athlete_join);

  if age_replacement_count <> 1 or join_replacement_count <> 1 then
    raise exception
      'Expected one league age expression and athlete join, found age %, join %',
      age_replacement_count,
      join_replacement_count;
  end if;

  compute_definition := replace(compute_definition, old_age_expression, new_age_expression);
  compute_definition := replace(compute_definition, old_athlete_join, new_athlete_join);
  execute compute_definition;
end
$migration$;

comment on function public.service_compute_league_standings(uuid,uuid,uuid,text,uuid) is
  'Computes immutable league standings from official sources. Classification age uses the season-year registration birth snapshot, then profile birth year/date, without synthetic dates.';
