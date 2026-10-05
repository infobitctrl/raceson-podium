begin;

alter table public.clubs
  add column if not exists president_name text;

update public.clubs club
set president_name = athlete.display_name
from public.athlete_profiles athlete
where club.created_by_athlete_profile_id = athlete.id
  and (club.president_name is null or btrim(club.president_name) = '');

commit;
