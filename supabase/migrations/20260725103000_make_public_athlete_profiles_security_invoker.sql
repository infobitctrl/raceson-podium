/*
 * Keep the public athlete directory as a deliberately narrow projection while
 * making the view obey the caller's privileges and athlete-profile RLS.
 * Column grants prevent direct Data API clients from selecting private identity
 * fields even when they bypass the view.
 */
alter view public.public_athlete_profiles
  set (security_invoker = true);

grant select (
  id,
  slug,
  display_name,
  gender,
  city,
  country_code,
  status,
  created_at,
  updated_at,
  merged_into_athlete_profile_id
) on table public.athlete_profiles
  to anon, authenticated;

grant select (
  athlete_profile_id,
  show_city
) on table public.profile_visibility_settings
  to anon, authenticated;

comment on view public.public_athlete_profiles is
  'RLS-backed, privacy-filtered public athlete directory. Birth dates, email addresses, claim ownership, and hidden location fields are never exposed.';
