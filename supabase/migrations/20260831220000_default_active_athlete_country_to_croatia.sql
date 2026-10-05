begin;

-- RacesOn launches Croatia-first, so an active athlete without an explicit
-- country uses Croatia as the competition identity shown in public race
-- tables. Deleted profiles remain anonymized, and explicit foreign countries
-- are never overwritten.
alter table public.athlete_profiles
  alter column country_code set default 'HR';

create or replace function app_private.default_active_athlete_country()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'active'
    and new.merged_into_athlete_profile_id is null
    and nullif(btrim(new.country_code::text), '') is null
  then
    new.country_code := 'HR';
  end if;

  return new;
end;
$$;

revoke all on function app_private.default_active_athlete_country()
  from public, anon, authenticated;

drop trigger if exists athlete_profiles_default_active_country
  on public.athlete_profiles;

create trigger athlete_profiles_default_active_country
before insert or update of country_code, status, merged_into_athlete_profile_id
on public.athlete_profiles
for each row execute function app_private.default_active_athlete_country();

update public.athlete_profiles
set country_code = 'HR'
where status = 'active'
  and merged_into_athlete_profile_id is null
  and nullif(btrim(country_code::text), '') is null;

-- Country is a coarse competition identity used for flags. It remains
-- independent from the more precise city disclosure and can still be opted
-- out per athlete after this Croatia-first default is established.
alter table public.profile_visibility_settings
  alter column show_country set default true;

update public.profile_visibility_settings visibility
set show_country = true
from public.athlete_profiles athlete
where athlete.id = visibility.athlete_profile_id
  and athlete.status = 'active'
  and athlete.merged_into_athlete_profile_id is null
  and not visibility.show_country;

comment on column public.athlete_profiles.country_code is
  'ISO 3166-1 alpha-2 competition country. Active profiles default to Croatia (HR); explicit countries are preserved.';

comment on column public.profile_visibility_settings.show_country is
  'Whether the athlete country code may appear in public athlete and competition views; defaults to visible independently of city.';

commit;
