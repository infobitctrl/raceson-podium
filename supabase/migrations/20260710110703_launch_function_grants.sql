create function public.public_event_participants(
  target_event_edition_id uuid
)
returns table (
  registration_id uuid,
  athlete_profile_id uuid,
  event_category_id uuid,
  event_category_slug text,
  event_category_name text,
  bib_number text,
  athlete_slug text,
  athlete_name text,
  club_slug text,
  club_name text,
  gender text,
  age_category_label text,
  registration_status text,
  participation_status text,
  result_status text,
  publication_state text,
  published_at timestamptz,
  finish_time_ms bigint,
  rank_overall integer,
  rank_gender integer,
  rank_age_category integer
)
language sql
security definer
set search_path = public
as $$
  select participant.*
  from public.public_event_participants_unfiltered(target_event_edition_id) participant
  join public.registrations registration
    on registration.id = participant.registration_id
  where registration.public_start_list_opt_in
     or (
       participant.publication_state in ('official', 'corrected')
       and participant.finish_time_ms is not null
     )
$$;
