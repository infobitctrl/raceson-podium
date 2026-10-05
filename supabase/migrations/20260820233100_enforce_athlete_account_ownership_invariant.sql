/*
 * One athlete workspace belongs to exactly one application account.
 * Imported and guest athlete profiles remain account-less until they are
 * claimed; claiming never creates a placeholder auth user.
 */

update public.user_profiles profile
set
  primary_athlete_profile_id = null,
  updated_at = clock_timestamp()
from public.athlete_profiles athlete
where athlete.id = profile.primary_athlete_profile_id
  and athlete.claimed_by_user_id is distinct from profile.user_id;

create unique index user_profiles_primary_athlete_unique_idx
  on public.user_profiles (primary_athlete_profile_id)
  where primary_athlete_profile_id is not null;

create or replace function public.enforce_user_profile_primary_athlete_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  athlete_owner_id uuid;
begin
  if new.primary_athlete_profile_id is null then
    return new;
  end if;

  select athlete.claimed_by_user_id
  into athlete_owner_id
  from public.athlete_profiles athlete
  where athlete.id = new.primary_athlete_profile_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'primary_athlete_profile_not_found';
  end if;

  if athlete_owner_id is distinct from new.user_id then
    raise exception using
      errcode = '23514',
      message = 'primary_athlete_account_mismatch',
      detail = format(
        'Athlete profile %s is not claimed by account %s.',
        new.primary_athlete_profile_id,
        new.user_id
      );
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_user_profile_primary_athlete_owner()
  from public, anon, authenticated;

create trigger user_profiles_primary_athlete_owner_guard
before insert or update of user_id, primary_athlete_profile_id
on public.user_profiles
for each row
execute function public.enforce_user_profile_primary_athlete_owner();

comment on function public.enforce_user_profile_primary_athlete_owner() is
  'Rejects account-to-athlete links unless the athlete is claimed by that exact account.';

comment on index public.user_profiles_primary_athlete_unique_idx is
  'Prevents one athlete workspace from being attached to multiple application accounts.';
