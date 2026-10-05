begin;

/*
 * One privacy-safe source for the public athlete history. The function selects
 * only the latest published result run for each category and exposes outcome
 * state without exposing private registration fields.
 */
create or replace function public.public_athlete_result_history(
  target_athlete_slug text
)
returns table (
  result_row_id uuid,
  event_category_id uuid,
  event_slug text,
  event_name text,
  category_name text,
  distance_km numeric,
  event_date date,
  finish_time_ms bigint,
  rank_overall integer,
  total_finishers integer,
  outcome_label text,
  splits_json jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with target_athlete as (
    select athlete.id
    from public.athlete_profiles athlete
    where athlete.slug = trim(target_athlete_slug)
      and athlete.status = 'active'
      and athlete.merged_into_athlete_profile_id is null
    limit 1
  ),
  latest_publications as (
    select ranked.event_category_id, ranked.result_run_id
    from (
      select
        publication.event_category_id,
        publication.result_run_id,
        row_number() over (
          partition by publication.event_category_id
          order by publication.published_at desc, publication.created_at desc, publication.id desc
        ) as publication_rank
      from public.result_publications publication
      where publication.publication_state in ('official', 'corrected')
    ) ranked
    where ranked.publication_rank = 1
  )
  select
    result.id as result_row_id,
    category.id as event_category_id,
    edition.slug as event_slug,
    edition.name as event_name,
    category.name as category_name,
    category.distance_km,
    edition.start_date as event_date,
    result.finish_time_ms,
    result.rank_overall,
    (
      select count(*)::integer
      from public.result_rows peer_result
      join public.registrations peer_registration
        on peer_registration.id = peer_result.registration_id
      where peer_result.result_run_id = result.result_run_id
        and peer_result.event_category_id = result.event_category_id
        and peer_result.result_status in ('official', 'corrected')
        and peer_registration.participation_status = 'finished'
        and peer_result.finish_time_ms is not null
    ) as total_finishers,
    case
      when registration.participation_status in ('not_started', 'checked_in') then 'dns'
      when registration.participation_status in (
        'finished', 'dns', 'dnf', 'dsq', 'withdrawn', 'stopped', 'evacuated', 'missing'
      ) then registration.participation_status::text
      when result.finish_time_ms is not null and result.finish_time_ms > 0 then 'finished'
      else 'unknown'
    end as outcome_label,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'elapsedTimeMs', split.elapsed_time_ms,
            'sequenceNumber', split.sequence_number
          )
          order by split.sequence_number
        )
        from public.result_splits split
        where split.result_row_id = result.id
      ),
      '[]'::jsonb
    ) as splits_json
  from target_athlete athlete
  join public.result_rows result
    on result.athlete_profile_id = athlete.id
   and result.result_status in ('official', 'corrected')
  join latest_publications publication
    on publication.event_category_id = result.event_category_id
   and publication.result_run_id = result.result_run_id
  join public.registrations registration
    on registration.id = result.registration_id
  join public.event_categories category
    on category.id = result.event_category_id
  join public.event_editions edition
    on edition.id = category.event_edition_id
  where public.is_event_category_public(category.id)
  order by edition.start_date desc, category.display_order asc, result.id asc
$$;

comment on function public.public_athlete_result_history(text) is
  'Returns the latest published public race history for an athlete slug, including normalized finish outcome but no private registration data.';

revoke all on function public.public_athlete_result_history(text) from public, anon, authenticated;
grant execute on function public.public_athlete_result_history(text) to service_role;

/*
 * Both public-athlete RPCs are consumed by the application API with the
 * service-role client. Keep the security-definer boundary off the browser.
 */
revoke execute on function public.public_athlete_age_categories() from anon, authenticated;
grant execute on function public.public_athlete_age_categories() to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.public_athlete_result_history(text)', 'execute') then
    raise exception 'anon must not execute public athlete result history directly';
  end if;

  if has_function_privilege('authenticated', 'public.public_athlete_result_history(text)', 'execute') then
    raise exception 'authenticated must not execute public athlete result history directly';
  end if;

  if not has_function_privilege('service_role', 'public.public_athlete_result_history(text)', 'execute') then
    raise exception 'service_role must be able to read public athlete result history';
  end if;

  if has_function_privilege('anon', 'public.public_athlete_age_categories()', 'execute') then
    raise exception 'anon must not execute public athlete age categories directly';
  end if;
end
$$;

commit;
