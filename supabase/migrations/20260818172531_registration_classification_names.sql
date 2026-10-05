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
set search_path = public
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
      ec.ranking_config_json,
      coalesce(ec.display_order, 0) as display_order
    from public.event_categories ec
    where ec.event_edition_id = target_event_edition_id
      and public.is_event_category_public(ec.id)
  ),
  latest_publications as (
    select
      ranked.event_category_id,
      ranked.result_run_id,
      ranked.publication_state,
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
  active_bibs as (
    select ba.registration_id, ba.bib_number
    from public.bib_assignments ba
    where ba.revoked_at is null
  )
  select
    r.id as registration_id,
    ap.id as athlete_profile_id,
    sc.id as event_category_id,
    sc.slug as event_category_slug,
    sc.name as event_category_name,
    coalesce(active_bibs.bib_number, '—') as bib_number,
    ap.slug as athlete_slug,
    coalesce(ap.display_name, ap.slug, 'Trail Runner') as athlete_name,
    clubs.slug as club_slug,
    coalesce(clubs.name, '') as club_name,
    coalesce(ap.gender, '') as gender,
    coalesce(
      (
        select nullif(classification.value ->> 'label', '')
        from jsonb_array_elements(
          coalesce(sc.ranking_config_json -> 'classifications', '[]'::jsonb)
        ) with ordinality as classification(value, display_order)
        where (
            classification.value ->> 'gender' is null
            or upper(classification.value ->> 'gender') = upper(coalesce(ap.gender, ''))
          )
          and (
            classification.value ->> 'minimumAge' is null
            or (
              ap.date_of_birth is not null
              and extract(year from age(ctx.reference_date, ap.date_of_birth))::numeric
                >= (classification.value ->> 'minimumAge')::numeric
            )
          )
          and (
            classification.value ->> 'maximumAge' is null
            or (
              ap.date_of_birth is not null
              and extract(year from age(ctx.reference_date, ap.date_of_birth))::numeric
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
        where upper(sex_bucket.value ->> 'gender') = upper(coalesce(ap.gender, ''))
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
          where ap.date_of_birth is not null
            and extract(year from age(ctx.reference_date, ap.date_of_birth))::numeric
              >= nullif(age_bucket.value ->> 'minAge', '')::numeric
            and (
              age_bucket.value ->> 'maxAge' is null
              or extract(year from age(ctx.reference_date, ap.date_of_birth))::numeric
                <= (age_bucket.value ->> 'maxAge')::numeric
            )
          order by age_bucket.display_order
          limit 1
        )
      end,
      public.platform_age_category(ap.date_of_birth, ctx.reference_date),
      'Unclassified'
    ) as age_category_label,
    r.status::text as registration_status,
    r.participation_status::text as participation_status,
    r.result_status::text as result_status,
    latest_publications.publication_state::text as publication_state,
    latest_publications.published_at,
    result_rows.finish_time_ms,
    result_rows.rank_overall,
    result_rows.rank_gender,
    result_rows.rank_age_category
  from public.registrations r
  join scoped_categories sc
    on sc.id = r.event_category_id
  join public.athlete_profiles ap
    on ap.id = r.athlete_profile_id
  cross join event_context ctx
  left join public.clubs
    on clubs.id = r.represented_club_id
  left join active_bibs
    on active_bibs.registration_id = r.id
  left join latest_publications
    on latest_publications.event_category_id = r.event_category_id
  left join public.result_rows
    on result_rows.result_run_id = latest_publications.result_run_id
   and result_rows.registration_id = r.id
  where r.status in ('pending', 'confirmed')
  order by
    sc.display_order asc,
    sc.name asc,
    case when result_rows.rank_overall is null then 1 else 0 end asc,
    result_rows.rank_overall asc nulls last,
    active_bibs.bib_number asc nulls last,
    coalesce(ap.display_name, ap.slug, 'Trail Runner') asc
$$;

revoke all on function public.public_event_participants_unfiltered(uuid)
  from public, anon, authenticated;
grant execute on function public.public_event_participants_unfiltered(uuid)
  to service_role;

comment on function public.public_event_participants_unfiltered(uuid) is
  'Internal participant projection. Returns configured competition classification names separately from organizer-only age-band context.';

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
  'Returns public registrations and published result participants with race names and configured competition category names as separate fields.';

revoke all on function public.public_event_participants(uuid) from public;
grant execute on function public.public_event_participants(uuid)
  to anon, authenticated, service_role;

commit;
