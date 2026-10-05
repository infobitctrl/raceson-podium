begin;

create table if not exists public.athlete_registration_profiles (
  athlete_profile_id uuid primary key references public.athlete_profiles (id) on delete cascade,
  phone text,
  emergency_contact_name text,
  emergency_contact_phone text,
  shirt_size text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists athlete_registration_profiles_set_updated_at
on public.athlete_registration_profiles;

create trigger athlete_registration_profiles_set_updated_at
before update on public.athlete_registration_profiles
for each row execute function public.set_updated_at();

alter table public.athlete_registration_profiles enable row level security;

create policy athlete_registration_profiles_select_self
on public.athlete_registration_profiles
for select
using (public.user_can_access_athlete_profile(athlete_profile_id));

create policy athlete_registration_profiles_insert_self
on public.athlete_registration_profiles
for insert
with check (public.user_can_access_athlete_profile(athlete_profile_id));

create policy athlete_registration_profiles_update_self
on public.athlete_registration_profiles
for update
using (public.user_can_access_athlete_profile(athlete_profile_id))
with check (public.user_can_access_athlete_profile(athlete_profile_id));

commit;
