begin;
-- Athlete identity and organizer operations are intentionally separate account
-- types. Keep the invariant at the database boundary as well as in the API so
-- direct RPC clients cannot recreate a hybrid account.
alter table public.user_profiles
  drop constraint if exists user_profiles_account_type_exclusive;
alter table public.user_profiles
  add constraint user_profiles_account_type_exclusive
  check (
    not (
      coalesce(preferences_json -> 'requested_roles', '[]'::jsonb) ? 'athlete'
      and (
        coalesce(preferences_json -> 'requested_roles', '[]'::jsonb) ? 'organizer'
        or coalesce(preferences_json -> 'requested_roles', '[]'::jsonb) ? 'timer'
      )
    )
    and not (
      primary_athlete_profile_id is not null
      and coalesce(preferences_json ->> 'default_role', 'athlete') in ('organizer', 'timer')
    )
  );
commit;
