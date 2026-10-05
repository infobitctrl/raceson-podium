create or replace function public.public_event_participants(
  target_event_edition_id uuid
)
returns table (
  registration_id uuid,
  event_category_id uuid,
  event_category_slug text,
  event_category_name text,
  bib_number text,
  athlete_slug text,
  athlete_name text,
  club_name text,
  gender text,
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
  with scoped_categories as (
    select
      ec.id,
      ec.slug,
      ec.name,
      coalesce(ec.display_order, 0) as display_order
    from event_categories ec
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
      from result_publications rp
      join scoped_categories sc
        on sc.id = rp.event_category_id
    ) ranked
    where ranked.publication_rank = 1
  ),
  active_bibs as (
    select
      ba.registration_id,
      ba.bib_number
    from bib_assignments ba
    where ba.revoked_at is null
  )
  select
    r.id as registration_id,
    sc.id as event_category_id,
    sc.slug as event_category_slug,
    sc.name as event_category_name,
    coalesce(active_bibs.bib_number, '—') as bib_number,
    coalesce(ap.slug, '') as athlete_slug,
    coalesce(ap.display_name, ap.slug, 'Trail Runner') as athlete_name,
    coalesce(clubs.name, 'Independent') as club_name,
    coalesce(ap.gender, '') as gender,
    r.status::text as registration_status,
    r.participation_status::text as participation_status,
    r.result_status::text as result_status,
    latest_publications.publication_state::text as publication_state,
    latest_publications.published_at,
    result_rows.finish_time_ms,
    result_rows.rank_overall,
    result_rows.rank_gender,
    result_rows.rank_age_category
  from registrations r
  join scoped_categories sc
    on sc.id = r.event_category_id
  join athlete_profiles ap
    on ap.id = r.athlete_profile_id
  left join clubs
    on clubs.id = r.represented_club_id
  left join active_bibs
    on active_bibs.registration_id = r.id
  left join latest_publications
    on latest_publications.event_category_id = r.event_category_id
  left join result_rows
    on result_rows.result_run_id = latest_publications.result_run_id
   and result_rows.registration_id = r.id
  where r.status in ('pending', 'confirmed')
  order by
    sc.display_order asc,
    sc.name asc,
    case
      when result_rows.rank_overall is null then 1
      else 0
    end asc,
    result_rows.rank_overall asc nulls last,
    active_bibs.bib_number asc nulls last,
    coalesce(ap.display_name, ap.slug, 'Trail Runner') asc;
$$;

revoke all on function public.public_event_participants(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.public_event_participants(uuid) to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.public_event_participants(uuid) to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.public_event_participants(uuid) to service_role;
  end if;
end;
$$;
