begin;

drop function if exists public.public_event_participants(uuid);
drop function if exists public.public_event_participants_unfiltered(uuid);

create function public.public_event_participants_unfiltered(
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
  classification_label text,
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
set search_path = ''
as $$
  with event_context as (
    select ee.start_date as reference_date
    from public.event_editions ee
    where ee.id = target_event_edition_id
  ),
  scoped_categories as (
    select
      ec.id,
      ec.slug,
      ec.name,
      ec.status::text as status,
      ec.ranking_config_json,
      coalesce(ec.display_order, 0) as display_order,
      live_settings.delay_seconds,
      case
        when ec.status = 'in_progress'
          and coalesce(live_settings.is_enabled, false)
          and not coalesce(live_settings.is_suppressed, false)
          then clock_timestamp() - make_interval(secs => live_settings.delay_seconds)
        else null
      end as live_visible_through
    from public.event_categories ec
    left join public.public_live_settings live_settings
      on live_settings.event_category_id = ec.id
    where ec.event_edition_id = target_event_edition_id
      and public.is_event_category_public(ec.id)
  ),
  latest_publications as (
    select
      ranked.event_category_id,
      ranked.result_run_id,
      ranked.publication_state::text as publication_state,
      ranked.published_at
    from (
      select
        rp.event_category_id,
        rp.result_run_id,
        rp.publication_state,
        rp.published_at,
        row_number() over (
          partition by rp.event_category_id
          order by rp.published_at desc, rp.created_at desc, rp.id desc
        ) as publication_rank
      from public.result_publications rp
      join scoped_categories sc
        on sc.id = rp.event_category_id
    ) ranked
    where ranked.publication_rank = 1
  ),
  latest_successful_runs as (
    select
      ranked.event_category_id,
      ranked.id as result_run_id,
      ranked.completed_at
    from (
      select
        rr.id,
        rr.event_category_id,
        rr.completed_at,
        row_number() over (
          partition by rr.event_category_id
          order by rr.completed_at desc nulls last, rr.started_at desc, rr.id desc
        ) as result_run_rank
      from public.result_runs rr
      join scoped_categories sc
        on sc.id = rr.event_category_id
      where rr.status = 'succeeded'
    ) ranked
    where ranked.result_run_rank = 1
  ),
  selected_sources as (
    select
      sc.id as event_category_id,
      coalesce(lp.result_run_id, case when sc.status = 'completed' then lsr.result_run_id end) as result_run_id,
      case
        when lp.event_category_id is not null then lp.publication_state
        when sc.status = 'completed' and lsr.result_run_id is not null then 'provisional'
        when sc.live_visible_through is not null then 'live'
        else null
      end as publication_state,
      case
        when lp.event_category_id is not null then lp.published_at
        when sc.status = 'completed' and lsr.result_run_id is not null then lsr.completed_at
        when sc.live_visible_through is not null then sc.live_visible_through
        else null
      end as published_at
    from scoped_categories sc
    left join latest_publications lp
      on lp.event_category_id = sc.id
    left join latest_successful_runs lsr
      on lsr.event_category_id = sc.id
  ),
  live_starts as (
    select
      sc.id as event_category_id,
      start_event.occurred_at
    from scoped_categories sc
    left join lateral (
      select rse.occurred_at
      from public.race_start_events rse
      where rse.event_category_id = sc.id
        and rse.event_type in ('actual_start', 'restart')
        and rse.created_at <= sc.live_visible_through
      order by rse.sequence_number desc
      limit 1
    ) start_event on true
    where sc.live_visible_through is not null
  ),
  delayed_statuses as (
    select distinct on (status_event.registration_id)
      status_event.registration_id,
      registration.event_category_id,
      status_event.status::text as status
    from public.participant_statuses status_event
    join public.registrations registration
      on registration.id = status_event.registration_id
    join scoped_categories sc
      on sc.id = registration.event_category_id
    where sc.live_visible_through is not null
      and status_event.created_at <= sc.live_visible_through
      and not exists (
        select 1
        from public.participant_statuses superseding_event
        where superseding_event.supersedes_status_id = status_event.id
          and superseding_event.created_at <= sc.live_visible_through
      )
    order by status_event.registration_id, status_event.sequence_number desc
  ),
  live_finish_times as (
    select
      punch.registration_id,
      punch.event_category_id,
      min(punch.effective_recorded_at) as finished_at
    from public.punch_events punch
    join public.checkpoints checkpoint
      on checkpoint.id = punch.checkpoint_id
     and checkpoint.checkpoint_type = 'finish'
    join scoped_categories sc
      on sc.id = punch.event_category_id
    where sc.live_visible_through is not null
      and punch.registration_id is not null
      and not punch.is_voided
      and punch.ingested_at <= sc.live_visible_through
    group by punch.registration_id, punch.event_category_id
  ),
  live_timings as (
    select
      registration.id as registration_id,
      registration.event_category_id,
      coalesce(delayed_status.status, 'not_started') as participation_status,
      case
        when delayed_status.status = 'finished'
          and live_finish.finished_at is not null
          and live_start.occurred_at is not null
          and live_finish.finished_at >= live_start.occurred_at
          then floor(extract(epoch from (live_finish.finished_at - live_start.occurred_at)) * 1000)::bigint
        else null
      end as finish_time_ms,
      athlete.gender
    from public.registrations registration
    join scoped_categories sc
      on sc.id = registration.event_category_id
    join public.athlete_profiles athlete
      on athlete.id = registration.athlete_profile_id
    join selected_sources source
      on source.event_category_id = registration.event_category_id
     and source.publication_state = 'live'
    left join delayed_statuses delayed_status
      on delayed_status.registration_id = registration.id
    left join live_finish_times live_finish
      on live_finish.registration_id = registration.id
    left join live_starts live_start
      on live_start.event_category_id = registration.event_category_id
    where registration.status = 'confirmed'
  ),
  live_ranked as (
    select
      live_timing.*,
      case
        when live_timing.finish_time_ms is not null then rank() over (
          partition by live_timing.event_category_id
          order by live_timing.finish_time_ms
        )::integer
        else null
      end as rank_overall,
      case
        when live_timing.finish_time_ms is not null then rank() over (
          partition by live_timing.event_category_id, live_timing.gender
          order by live_timing.finish_time_ms
        )::integer
        else null
      end as rank_gender
    from live_timings live_timing
  ),
  active_bibs as (
    select ba.registration_id, ba.bib_number
    from public.bib_assignments ba
    where ba.revoked_at is null
  )
  select
    registration.id as registration_id,
    athlete.id as athlete_profile_id,
    sc.id as event_category_id,
    sc.slug as event_category_slug,
    sc.name as event_category_name,
    coalesce(active_bibs.bib_number, '—') as bib_number,
    athlete.slug as athlete_slug,
    coalesce(athlete.display_name, athlete.slug, 'Trail Runner') as athlete_name,
    club.slug as club_slug,
    coalesce(club.name, '') as club_name,
    coalesce(athlete.gender, '') as gender,
    coalesce(
      (
        select nullif(classification.value ->> 'label', '')
        from jsonb_array_elements(
          coalesce(sc.ranking_config_json -> 'classifications', '[]'::jsonb)
        ) with ordinality as classification(value, display_order)
        where (
            classification.value ->> 'gender' is null
            or upper(classification.value ->> 'gender') = upper(coalesce(athlete.gender, ''))
          )
          and (
            classification.value ->> 'minimumAge' is null
            or (
              athlete.date_of_birth is not null
              and extract(year from age(ctx.reference_date, athlete.date_of_birth))::numeric
                >= (classification.value ->> 'minimumAge')::numeric
            )
          )
          and (
            classification.value ->> 'maximumAge' is null
            or (
              athlete.date_of_birth is not null
              and extract(year from age(ctx.reference_date, athlete.date_of_birth))::numeric
                <= (classification.value ->> 'maximumAge')::numeric
            )
          )
        order by classification.display_order
        limit 1
      ),
      (
        select nullif(sex_bucket.value ->> 'label', '')
        from jsonb_array_elements(
          coalesce(sc.ranking_config_json #> '{sex,buckets}', '[]'::jsonb)
        ) with ordinality as sex_bucket(value, display_order)
        where upper(sex_bucket.value ->> 'gender') = upper(coalesce(athlete.gender, ''))
        order by sex_bucket.display_order
        limit 1
      ),
      'Open'
    ) as classification_label,
    coalesce(
      case
        when sc.ranking_config_json #>> '{age,enabled}' = 'true' then (
          select nullif(age_bucket.value ->> 'label', '')
          from jsonb_array_elements(
            coalesce(sc.ranking_config_json #> '{age,buckets}', '[]'::jsonb)
          ) with ordinality as age_bucket(value, display_order)
          where athlete.date_of_birth is not null
            and extract(year from age(ctx.reference_date, athlete.date_of_birth))::numeric
              >= nullif(age_bucket.value ->> 'minAge', '')::numeric
            and (
              age_bucket.value ->> 'maxAge' is null
              or extract(year from age(ctx.reference_date, athlete.date_of_birth))::numeric
                <= (age_bucket.value ->> 'maxAge')::numeric
            )
          order by age_bucket.display_order
          limit 1
        )
      end,
      public.platform_age_category(athlete.date_of_birth, ctx.reference_date),
      'Unclassified'
    ) as age_category_label,
    registration.status::text as registration_status,
    case
      when source.publication_state = 'live' then coalesce(live_result.participation_status, 'not_started')
      else registration.participation_status::text
    end as participation_status,
    case
      when source.publication_state = 'live' then 'provisional'
      else result.result_status::text
    end as result_status,
    source.publication_state,
    source.published_at,
    case
      when source.publication_state = 'live' then live_result.finish_time_ms
      else result.finish_time_ms
    end as finish_time_ms,
    case
      when source.publication_state = 'live' then live_result.rank_overall
      else result.rank_overall
    end as rank_overall,
    case
      when source.publication_state = 'live' then live_result.rank_gender
      else result.rank_gender
    end as rank_gender,
    case
      when source.publication_state = 'live' then null::integer
      else result.rank_age_category
    end as rank_age_category
  from public.registrations registration
  join scoped_categories sc
    on sc.id = registration.event_category_id
  join public.athlete_profiles athlete
    on athlete.id = registration.athlete_profile_id
  cross join event_context ctx
  left join public.clubs club
    on club.id = registration.represented_club_id
  left join active_bibs
    on active_bibs.registration_id = registration.id
  left join selected_sources source
    on source.event_category_id = registration.event_category_id
  left join public.result_rows result
    on result.result_run_id = source.result_run_id
   and result.registration_id = registration.id
  left join live_ranked live_result
    on live_result.registration_id = registration.id
   and source.publication_state = 'live'
  where registration.status in ('pending', 'confirmed')
  order by
    sc.display_order asc,
    sc.name asc,
    case
      when coalesce(result.rank_overall, live_result.rank_overall) is null then 1
      else 0
    end asc,
    coalesce(result.rank_overall, live_result.rank_overall) asc nulls last,
    active_bibs.bib_number asc nulls last,
    coalesce(athlete.display_name, athlete.slug, 'Trail Runner') asc
$$;

revoke all on function public.public_event_participants_unfiltered(uuid)
  from public, anon, authenticated;
grant execute on function public.public_event_participants_unfiltered(uuid)
  to service_role;

comment on function public.public_event_participants_unfiltered(uuid) is
  'Internal participant projection with delayed live standings, automatic unofficial results from the latest completed run, and confirmed final publications.';

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
  classification_label text,
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
set search_path = ''
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
    participant.classification_label,
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
       participant.publication_state = 'live'
       and participant.participation_status in (
         'started', 'finished', 'dnf', 'dsq', 'withdrawn', 'stopped', 'evacuated', 'missing'
       )
     )
     or (
       participant.publication_state = 'provisional'
       and participant.registration_status = 'confirmed'
     )
$$;

comment on function public.public_event_participants(uuid) is
  'Returns opted-in start lists, privacy-delayed live standings, automatic unofficial results after race finish, and organizer-confirmed final results.';

revoke all on function public.public_event_participants(uuid) from public;
grant execute on function public.public_event_participants(uuid)
  to anon, authenticated, service_role;

create or replace function public.public_results_directory_category_states()
returns table (
  event_category_id uuid,
  result_run_id uuid,
  publication_state text,
  published_at timestamptz,
  finisher_count integer
)
language sql
security definer
set search_path = ''
as $$
  with scoped_categories as (
    select
      category.id,
      category.status::text as status,
      live_settings.delay_seconds,
      case
        when category.status = 'in_progress'
          and coalesce(live_settings.is_enabled, false)
          and not coalesce(live_settings.is_suppressed, false)
          then clock_timestamp() - make_interval(secs => live_settings.delay_seconds)
        else null
      end as live_visible_through
    from public.event_categories category
    left join public.public_live_settings live_settings
      on live_settings.event_category_id = category.id
    where public.is_event_category_public(category.id)
  ),
  latest_publications as (
    select
      ranked.event_category_id,
      ranked.result_run_id,
      ranked.publication_state::text as publication_state,
      ranked.published_at
    from (
      select
        publication.event_category_id,
        publication.result_run_id,
        publication.publication_state,
        publication.published_at,
        row_number() over (
          partition by publication.event_category_id
          order by publication.published_at desc, publication.created_at desc, publication.id desc
        ) as publication_rank
      from public.result_publications publication
      join scoped_categories category
        on category.id = publication.event_category_id
    ) ranked
    where ranked.publication_rank = 1
  ),
  latest_successful_runs as (
    select
      ranked.event_category_id,
      ranked.id as result_run_id,
      ranked.completed_at
    from (
      select
        result_run.id,
        result_run.event_category_id,
        result_run.completed_at,
        row_number() over (
          partition by result_run.event_category_id
          order by result_run.completed_at desc nulls last, result_run.started_at desc, result_run.id desc
        ) as result_run_rank
      from public.result_runs result_run
      join scoped_categories category
        on category.id = result_run.event_category_id
      where result_run.status = 'succeeded'
    ) ranked
    where ranked.result_run_rank = 1
  ),
  selected_sources as (
    select
      category.id as event_category_id,
      coalesce(
        publication.result_run_id,
        case when category.status = 'completed' then result_run.result_run_id end
      ) as result_run_id,
      case
        when publication.event_category_id is not null then publication.publication_state
        when category.status = 'completed' and result_run.result_run_id is not null then 'provisional'
        when category.live_visible_through is not null then 'live'
        else null
      end as publication_state,
      case
        when publication.event_category_id is not null then publication.published_at
        when category.status = 'completed' and result_run.result_run_id is not null then result_run.completed_at
        when category.live_visible_through is not null then category.live_visible_through
        else null
      end as published_at
    from scoped_categories category
    left join latest_publications publication
      on publication.event_category_id = category.id
    left join latest_successful_runs result_run
      on result_run.event_category_id = category.id
  )
  select
    source.event_category_id,
    source.result_run_id,
    source.publication_state,
    source.published_at,
    coalesce((
      select count(*)::integer
      from public.result_rows result
      where result.result_run_id = source.result_run_id
        and result.finish_time_ms is not null
        and result.result_status <> 'void'
    ), 0) as finisher_count
  from selected_sources source
$$;

comment on function public.public_results_directory_category_states() is
  'Returns privacy-safe Live, Unofficial, and Final category lifecycle state for the public results directory.';

revoke all on function public.public_results_directory_category_states() from public;
grant execute on function public.public_results_directory_category_states()
  to anon, authenticated, service_role;

commit;
