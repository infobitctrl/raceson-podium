begin;

/*
 * Platform athlete categories follow the ITRA season convention: use the age
 * reached by 31 December of the reference year. Race and league classifications
 * remain scoped overrides and do not rewrite the athlete's platform category.
 */
create or replace function public.platform_age_at_year_end(
  target_date_of_birth date,
  target_reference_date date
)
returns integer
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select extract(year from target_reference_date)::integer
       - extract(year from target_date_of_birth)::integer
$$;

create or replace function public.platform_age_category(
  target_date_of_birth date,
  target_reference_date date
)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when public.platform_age_at_year_end(target_date_of_birth, target_reference_date) < 16 then 'U16'
    when public.platform_age_at_year_end(target_date_of_birth, target_reference_date) < 18 then 'U18'
    when public.platform_age_at_year_end(target_date_of_birth, target_reference_date) < 20 then 'U20'
    when public.platform_age_at_year_end(target_date_of_birth, target_reference_date) < 23 then 'U23'
    when public.platform_age_at_year_end(target_date_of_birth, target_reference_date) < 35 then '23-34'
    when public.platform_age_at_year_end(target_date_of_birth, target_reference_date) < 40 then '35-39'
    when public.platform_age_at_year_end(target_date_of_birth, target_reference_date) < 45 then '40-44'
    when public.platform_age_at_year_end(target_date_of_birth, target_reference_date) < 50 then '45-49'
    when public.platform_age_at_year_end(target_date_of_birth, target_reference_date) < 55 then '50-54'
    when public.platform_age_at_year_end(target_date_of_birth, target_reference_date) < 60 then '55-59'
    when public.platform_age_at_year_end(target_date_of_birth, target_reference_date) < 65 then '60-64'
    when public.platform_age_at_year_end(target_date_of_birth, target_reference_date) < 70 then '65-69'
    when public.platform_age_at_year_end(target_date_of_birth, target_reference_date) < 75 then '70-74'
    when public.platform_age_at_year_end(target_date_of_birth, target_reference_date) < 80 then '75-79'
    else '80+'
  end
$$;

comment on function public.platform_age_category(date, date) is
  'Returns the Sitrail platform age category from age reached by calendar year end: U16, U18, U20, U23, 23-34, five-year masters bands, then 80+.';

revoke all on function public.platform_age_at_year_end(date, date) from public, anon, authenticated;
revoke all on function public.platform_age_category(date, date) from public, anon, authenticated;
grant execute on function public.platform_age_at_year_end(date, date) to service_role;
grant execute on function public.platform_age_category(date, date) to service_role;

/*
 * Public consumers receive only the derived label. Date of birth stays behind
 * the existing private athlete profile boundary, and show_age_category remains
 * the athlete-controlled visibility switch.
 */
create or replace function public.public_athlete_age_categories()
returns table (
  athlete_profile_id uuid,
  age_category_label text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    athlete.id as athlete_profile_id,
    public.platform_age_category(athlete.date_of_birth, current_date) as age_category_label
  from public.athlete_profiles athlete
  left join public.profile_visibility_settings visibility
    on visibility.athlete_profile_id = athlete.id
  where athlete.status = 'active'
    and athlete.merged_into_athlete_profile_id is null
    and coalesce(visibility.show_age_category, true)
$$;

comment on function public.public_athlete_age_categories() is
  'Privacy-safe public athlete age categories. Returns no date of birth and respects show_age_category.';

revoke all on function public.public_athlete_age_categories() from public;
grant execute on function public.public_athlete_age_categories() to anon, authenticated, service_role;

/* New event categories inherit the platform-quality age preset. */
alter table public.event_categories
  alter column ranking_config_json set default jsonb_build_object(
    'overall', jsonb_build_object('enabled', true),
    'sex', jsonb_build_object(
      'enabled', true,
      'buckets', jsonb_build_array(
        jsonb_build_object('key', 'female', 'label', 'Female', 'gender', 'F'),
        jsonb_build_object('key', 'male', 'label', 'Male', 'gender', 'M')
      )
    ),
    'age', jsonb_build_object(
      'enabled', false,
      'buckets', jsonb_build_array(
        jsonb_build_object('key', 'u16', 'label', 'U16', 'minAge', 0, 'maxAge', 15),
        jsonb_build_object('key', 'u18', 'label', 'U18', 'minAge', 16, 'maxAge', 17),
        jsonb_build_object('key', 'u20', 'label', 'U20', 'minAge', 18, 'maxAge', 19),
        jsonb_build_object('key', 'u23', 'label', 'U23', 'minAge', 20, 'maxAge', 22),
        jsonb_build_object('key', 'senior', 'label', '23-34', 'minAge', 23, 'maxAge', 34),
        jsonb_build_object('key', '35-39', 'label', '35-39', 'minAge', 35, 'maxAge', 39),
        jsonb_build_object('key', '40-44', 'label', '40-44', 'minAge', 40, 'maxAge', 44),
        jsonb_build_object('key', '45-49', 'label', '45-49', 'minAge', 45, 'maxAge', 49),
        jsonb_build_object('key', '50-54', 'label', '50-54', 'minAge', 50, 'maxAge', 54),
        jsonb_build_object('key', '55-59', 'label', '55-59', 'minAge', 55, 'maxAge', 59),
        jsonb_build_object('key', '60-64', 'label', '60-64', 'minAge', 60, 'maxAge', 64),
        jsonb_build_object('key', '65-69', 'label', '65-69', 'minAge', 65, 'maxAge', 69),
        jsonb_build_object('key', '70-74', 'label', '70-74', 'minAge', 70, 'maxAge', 74),
        jsonb_build_object('key', '75-79', 'label', '75-79', 'minAge', 75, 'maxAge', 79),
        jsonb_build_object('key', '80-plus', 'label', '80+', 'minAge', 80, 'maxAge', null)
      )
    ),
    'team', jsonb_build_object(
      'enabled', false,
      'mode', 'club',
      'label', 'Club / Team',
      'scoringMethod', 'best_three_by_place',
      'scoringCount', 3
    )
  );

/* Replace only the untouched legacy three-band preset; preserve custom rules. */
update public.event_categories
set ranking_config_json = jsonb_set(
  ranking_config_json,
  '{age,buckets}',
  jsonb_build_array(
    jsonb_build_object('key', 'u16', 'label', 'U16', 'minAge', 0, 'maxAge', 15),
    jsonb_build_object('key', 'u18', 'label', 'U18', 'minAge', 16, 'maxAge', 17),
    jsonb_build_object('key', 'u20', 'label', 'U20', 'minAge', 18, 'maxAge', 19),
    jsonb_build_object('key', 'u23', 'label', 'U23', 'minAge', 20, 'maxAge', 22),
    jsonb_build_object('key', 'senior', 'label', '23-34', 'minAge', 23, 'maxAge', 34),
    jsonb_build_object('key', '35-39', 'label', '35-39', 'minAge', 35, 'maxAge', 39),
    jsonb_build_object('key', '40-44', 'label', '40-44', 'minAge', 40, 'maxAge', 44),
    jsonb_build_object('key', '45-49', 'label', '45-49', 'minAge', 45, 'maxAge', 49),
    jsonb_build_object('key', '50-54', 'label', '50-54', 'minAge', 50, 'maxAge', 54),
    jsonb_build_object('key', '55-59', 'label', '55-59', 'minAge', 55, 'maxAge', 59),
    jsonb_build_object('key', '60-64', 'label', '60-64', 'minAge', 60, 'maxAge', 64),
    jsonb_build_object('key', '65-69', 'label', '65-69', 'minAge', 65, 'maxAge', 69),
    jsonb_build_object('key', '70-74', 'label', '70-74', 'minAge', 70, 'maxAge', 74),
    jsonb_build_object('key', '75-79', 'label', '75-79', 'minAge', 75, 'maxAge', 79),
    jsonb_build_object('key', '80-plus', 'label', '80+', 'minAge', 80, 'maxAge', null)
  ),
  true
)
where ranking_config_json #> '{age,buckets}' = jsonb_build_array(
  jsonb_build_object('key', 'u18', 'label', 'U18', 'minAge', 0, 'maxAge', 17),
  jsonb_build_object('key', 'adult', 'label', '18-65', 'minAge', 18, 'maxAge', 65),
  jsonb_build_object('key', 'senior', 'label', 'Seniors', 'minAge', 66, 'maxAge', null)
)
or ranking_config_json #> '{age,buckets}' = jsonb_build_array(
  jsonb_build_object('key', 'u18', 'label', 'U18', 'minAge', 0, 'maxAge', 17.99),
  jsonb_build_object('key', 'adult', 'label', '18-65', 'minAge', 18, 'maxAge', 65.99),
  jsonb_build_object('key', 'senior', 'label', 'Seniors', 'minAge', 66, 'maxAge', null)
);

/*
 * Event pages use the event ranking buckets when age awards are enabled.
 * Otherwise they show the athlete's platform category for the event year.
 */
create or replace function public.public_event_participants_unfiltered(
  target_event_edition_id uuid
)
returns table (
  registration_id uuid,
  athlete_profile_id uuid,
  event_category_id uuid,
  event_category_slug text,
  event_category_name text,
  bib_number text,
  athlete_slug text,
  athlete_name text,
  club_slug text,
  club_name text,
  gender text,
  age_category_label text,
  registration_status text,
  participation_status text,
  result_status text,
  publication_state text,
  published_at timestamptz,
  finish_time_ms bigint,
  rank_overall integer,
  rank_gender integer,
  rank_age_category integer
)
language sql
security definer
set search_path = public
as $$
  with event_context as (
    select ee.start_date as reference_date
    from public.event_editions ee
    where ee.id = target_event_edition_id
  ),
  scoped_categories as (
    select
      ec.id,
      ec.slug,
      ec.name,
      ec.ranking_config_json,
      coalesce(ec.display_order, 0) as display_order
    from public.event_categories ec
    where ec.event_edition_id = target_event_edition_id
      and public.is_event_category_public(ec.id)
  ),
  latest_publications as (
    select
      ranked.event_category_id,
      ranked.result_run_id,
      ranked.publication_state,
      ranked.published_at
    from (
      select
        rp.event_category_id,
        rp.result_run_id,
        rp.publication_state,
        rp.published_at,
        row_number() over (
          partition by rp.event_category_id
          order by rp.published_at desc, rp.created_at desc, rp.id desc
        ) as publication_rank
      from public.result_publications rp
      join scoped_categories sc
        on sc.id = rp.event_category_id
    ) ranked
    where ranked.publication_rank = 1
  ),
  active_bibs as (
    select ba.registration_id, ba.bib_number
    from public.bib_assignments ba
    where ba.revoked_at is null
  )
  select
    r.id as registration_id,
    ap.id as athlete_profile_id,
    sc.id as event_category_id,
    sc.slug as event_category_slug,
    sc.name as event_category_name,
    coalesce(active_bibs.bib_number, '—') as bib_number,
    ap.slug as athlete_slug,
    coalesce(ap.display_name, ap.slug, 'Trail Runner') as athlete_name,
    clubs.slug as club_slug,
    coalesce(clubs.name, 'Independent') as club_name,
    coalesce(ap.gender, '') as gender,
    coalesce(
      case
        when sc.ranking_config_json #>> '{age,enabled}' = 'true' then (
          select nullif(age_bucket.value ->> 'label', '')
          from jsonb_array_elements(
            coalesce(sc.ranking_config_json #> '{age,buckets}', '[]'::jsonb)
          ) with ordinality as age_bucket(value, display_order)
          where ap.date_of_birth is not null
            and extract(year from age(ctx.reference_date, ap.date_of_birth))::numeric
              >= nullif(age_bucket.value ->> 'minAge', '')::numeric
            and (
              age_bucket.value ->> 'maxAge' is null
              or extract(year from age(ctx.reference_date, ap.date_of_birth))::numeric
                <= (age_bucket.value ->> 'maxAge')::numeric
            )
          order by age_bucket.display_order
          limit 1
        )
      end,
      public.platform_age_category(ap.date_of_birth, ctx.reference_date),
      'Unclassified'
    ) as age_category_label,
    r.status::text as registration_status,
    r.participation_status::text as participation_status,
    r.result_status::text as result_status,
    latest_publications.publication_state::text as publication_state,
    latest_publications.published_at,
    result_rows.finish_time_ms,
    result_rows.rank_overall,
    result_rows.rank_gender,
    result_rows.rank_age_category
  from public.registrations r
  join scoped_categories sc
    on sc.id = r.event_category_id
  join public.athlete_profiles ap
    on ap.id = r.athlete_profile_id
  cross join event_context ctx
  left join public.clubs
    on clubs.id = r.represented_club_id
  left join active_bibs
    on active_bibs.registration_id = r.id
  left join latest_publications
    on latest_publications.event_category_id = r.event_category_id
  left join public.result_rows
    on result_rows.result_run_id = latest_publications.result_run_id
   and result_rows.registration_id = r.id
  where r.status in ('pending', 'confirmed')
  order by
    sc.display_order asc,
    sc.name asc,
    case when result_rows.rank_overall is null then 1 else 0 end asc,
    result_rows.rank_overall asc nulls last,
    active_bibs.bib_number asc nulls last,
    coalesce(ap.display_name, ap.slug, 'Trail Runner') asc
$$;

revoke all on function public.public_event_participants_unfiltered(uuid)
  from public, anon, authenticated;
grant execute on function public.public_event_participants_unfiltered(uuid)
  to service_role;

comment on function public.public_event_participants_unfiltered(uuid) is
  'Internal participant projection. Uses event age buckets as scoped overrides and the platform age category otherwise.';

do $$
begin
  if public.platform_age_category(date '2011-12-31', date '2026-01-01') <> 'U16'
     or public.platform_age_category(date '2007-12-31', date '2026-01-01') <> 'U20'
     or public.platform_age_category(date '2004-12-31', date '2026-01-01') <> 'U23'
     or public.platform_age_category(date '2003-12-31', date '2026-01-01') <> '23-34'
     or public.platform_age_category(date '1986-12-31', date '2026-01-01') <> '40-44' then
    raise exception 'platform_age_category_boundary_check_failed';
  end if;
end;
$$;

commit;
