begin;
-- These fixed local demo identities existed before athlete and organizer
-- accounts became exclusive. Normalize them without deleting historical rows.
update public.user_profiles
set
  primary_athlete_profile_id = null,
  preferences_json = coalesce(preferences_json, '{}'::jsonb)
    || '{"default_role":"organizer","requested_roles":["organizer"]}'::jsonb,
  updated_at = now()
where user_id = '00000000-0000-4000-8000-000000000102'::uuid
  and lower(email::text) = 'organizer@trail-portal.local';
update public.user_profiles
set
  primary_athlete_profile_id = null,
  preferences_json = coalesce(preferences_json, '{}'::jsonb)
    || '{"default_role":"timer","requested_roles":["timer"]}'::jsonb,
  updated_at = now()
where user_id = '00000000-0000-4000-8000-000000000103'::uuid
  and lower(email::text) = 'timer@trail-portal.local';
update auth.users
set
  raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    || '{"default_role":"organizer","requested_roles":["organizer"]}'::jsonb,
  updated_at = now()
where id = '00000000-0000-4000-8000-000000000102'::uuid
  and lower(email) = 'organizer@trail-portal.local';
update auth.users
set
  raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    || '{"default_role":"timer","requested_roles":["timer"]}'::jsonb,
  updated_at = now()
where id = '00000000-0000-4000-8000-000000000103'::uuid
  and lower(email) = 'timer@trail-portal.local';
commit;
