begin;

create or replace function public.public_event_participants(
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
  select
    participant.registration_id,
    participant.athlete_profile_id,
    participant.event_category_id,
    participant.event_category_slug,
    participant.event_category_name,
    participant.bib_number,
    participant.athlete_slug,
    participant.athlete_name,
    participant.club_slug,
    participant.club_name,
    participant.gender,
    participant.age_category_label,
    participant.registration_status,
    case
      when participant.publication_state in ('official', 'corrected')
        and participant.participation_status in ('not_started', 'checked_in')
        then 'dns'
      when participant.publication_state in ('official', 'corrected')
        and participant.participation_status in ('started', 'withdrawn', 'stopped', 'evacuated', 'missing')
        then 'dnf'
      else participant.participation_status
    end as participation_status,
    participant.result_status,
    participant.publication_state,
    participant.published_at,
    participant.finish_time_ms,
    participant.rank_overall,
    participant.rank_gender,
    participant.rank_age_category
  from public.public_event_participants_unfiltered(target_event_edition_id) participant
  join public.registrations registration
    on registration.id = participant.registration_id
  where registration.public_start_list_opt_in
     or participant.publication_state in ('official', 'corrected')
     or (
       participant.publication_state = 'provisional'
       and exists (
         select 1
         from public.result_publications publication
         join public.result_rows result
           on result.result_run_id = publication.result_run_id
          and result.registration_id = participant.registration_id
         where publication.event_category_id = participant.event_category_id
           and publication.publication_state = 'provisional'
           and publication.published_at = participant.published_at
       )
     )
$$;

comment on function public.public_event_participants(uuid) is
  'Returns opted-in public start-list entries before publication, rows explicitly published in the latest provisional run, and the complete roster after official or corrected publication. Completed non-starters are normalized to DNS and non-finish withdrawals to DNF for final public race presentation.';

revoke all on function public.public_event_participants(uuid) from public;
grant execute on function public.public_event_participants(uuid) to anon, authenticated, service_role;

commit;
