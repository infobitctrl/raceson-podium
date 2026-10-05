/*
 * Server-enforced race eligibility evaluated on the event start date.
 * Dynamic form questions can collect qualifications and licenses; these core
 * demographic gates prevent an ineligible direct or guest entry from consuming
 * capacity before organizer review.
 */

alter table public.event_categories
  add column minimum_age integer,
  add column maximum_age integer,
  add column allowed_genders text[] not null default array['F', 'M', 'U']::text[],
  add column eligibility_note text;

alter table public.event_categories
  add constraint event_categories_age_range_check
    check (
      (minimum_age is null or minimum_age >= 0)
      and (maximum_age is null or maximum_age >= 0)
      and (minimum_age is null or maximum_age is null or maximum_age >= minimum_age)
    ),
  add constraint event_categories_allowed_genders_check
    check (
      cardinality(allowed_genders) > 0
      and allowed_genders <@ array['F', 'M', 'U']::text[]
    );

create or replace function public.enforce_registration_category_eligibility()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  category_row public.event_categories%rowtype;
  edition_start_date date;
  athlete_birth_date date;
  athlete_gender text;
  athlete_age integer;
begin
  if new.source not in ('direct', 'guest') then
    return new;
  end if;

  select category.*
  into category_row
  from public.event_categories category
  where category.id = new.event_category_id;

  select edition.start_date
  into edition_start_date
  from public.event_editions edition
  where edition.id = category_row.event_edition_id;

  if category_row.minimum_age is null
     and category_row.maximum_age is null
     and category_row.allowed_genders = array['F', 'M', 'U']::text[] then
    return new;
  end if;

  select athlete.date_of_birth, athlete.gender
  into athlete_birth_date, athlete_gender
  from public.athlete_profiles athlete
  where athlete.id = new.athlete_profile_id;

  if category_row.minimum_age is not null or category_row.maximum_age is not null then
    if athlete_birth_date is null then
      raise exception using errcode = '22023', message = 'eligibility_birth_date_required';
    end if;

    athlete_age := extract(year from age(edition_start_date, athlete_birth_date))::integer;
    if category_row.minimum_age is not null and athlete_age < category_row.minimum_age then
      raise exception using errcode = '22023', message = 'eligibility_minimum_age_not_met';
    end if;
    if category_row.maximum_age is not null and athlete_age > category_row.maximum_age then
      raise exception using errcode = '22023', message = 'eligibility_maximum_age_exceeded';
    end if;
  end if;

  athlete_gender := case lower(coalesce(athlete_gender, ''))
    when 'f' then 'F'
    when 'female' then 'F'
    when 'woman' then 'F'
    when 'w' then 'F'
    when 'm' then 'M'
    when 'male' then 'M'
    when 'man' then 'M'
    else 'U'
  end;
  if not (athlete_gender = any(category_row.allowed_genders)) then
    raise exception using errcode = '22023', message = 'eligibility_gender_not_allowed';
  end if;

  return new;
end;
$$;

create trigger registrations_enforce_category_eligibility
before insert on public.registrations
for each row execute function public.enforce_registration_category_eligibility();

revoke all on function public.enforce_registration_category_eligibility()
  from public, anon, authenticated;
