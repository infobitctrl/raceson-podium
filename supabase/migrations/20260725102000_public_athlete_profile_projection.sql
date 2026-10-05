/*
 * Anonymous row access on athlete_profiles previously exposed every column,
 * including primary_email and date_of_birth. Public consumers receive only
 * this privacy-filtered projection; full profiles remain service-owned.
 */
create or replace view public.public_athlete_profiles
with (security_barrier = true)
as
select
  athlete.id,
  athlete.slug,
  athlete.display_name,
  athlete.gender,
  null::date as date_of_birth,
  case when coalesce(visibility.show_city, false) then athlete.city else null end as city,
  case when coalesce(visibility.show_city, false) then athlete.country_code else null end as country_code,
  athlete.status,
  athlete.created_at,
  athlete.updated_at
from public.athlete_profiles athlete
left join public.profile_visibility_settings visibility
  on visibility.athlete_profile_id = athlete.id
where athlete.status = 'active'
  and athlete.merged_into_athlete_profile_id is null;

revoke all on table public.athlete_profiles
  from public, anon, authenticated;

grant all on table public.athlete_profiles
  to service_role;

revoke all on table public.public_athlete_profiles
  from public;

grant select on table public.public_athlete_profiles
  to anon, authenticated, service_role;

comment on view public.public_athlete_profiles is
  'Privacy-filtered public athlete directory. Birth dates, email addresses, claim ownership, and hidden location fields are never exposed.';
