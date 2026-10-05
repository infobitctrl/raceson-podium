begin;

-- Country is useful competition identity (for example, result-table flags),
-- while city is a more precise location. Keep the two disclosures independent.
alter table public.profile_visibility_settings
  add column show_country boolean not null default false;

comment on column public.profile_visibility_settings.show_country is
  'Whether the athlete country code may appear in public athlete and competition views.';

grant select (show_country) on table public.profile_visibility_settings
  to anon, authenticated;

create or replace function app_private.public_athlete_location(target_athlete_profile_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'city', case when visibility.show_city then athlete.city else null end,
    'country_code', case when visibility.show_country then athlete.country_code else null end
  )
  from public.athlete_profiles athlete
  join public.profile_visibility_settings visibility on visibility.athlete_profile_id = athlete.id
  where athlete.id = target_athlete_profile_id
    and athlete.status = 'active' and athlete.merged_into_athlete_profile_id is null
    and (visibility.show_city or visibility.show_country)
$$;

revoke all on function app_private.public_athlete_location(uuid) from public, anon, authenticated;
grant execute on function app_private.public_athlete_location(uuid) to anon, authenticated, service_role;

-- These existing athlete profiles have Croatia recorded and are expected to
-- show that country in public race tables without disclosing their city.
update public.profile_visibility_settings
set show_country = true
where athlete_profile_id in (
  'a30fcc64-18e8-4788-a9a6-d4744e8f7add', -- Luka Vudrag
  'e901380b-da51-4fe1-97f1-500fd2cbd104'  -- Vedran Vudrag
);

commit;
