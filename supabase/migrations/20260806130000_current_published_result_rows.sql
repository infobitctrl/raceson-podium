/*
 * Canonical read source for every consumer that displays an official result.
 * The view resolves exactly one latest official/corrected publication per race
 * before exposing rows from that publication's immutable result run.
 */

create index if not exists result_publications_current_eligible_idx
  on public.result_publications (
    event_category_id,
    published_at desc,
    created_at desc,
    id desc
  )
  include (result_run_id, publication_state)
  where publication_state in ('official', 'corrected');

create or replace view public.current_published_result_rows
with (security_invoker = true, security_barrier = true)
as
with latest_publications as (
  select
    ranked.publication_id,
    ranked.event_category_id,
    ranked.result_run_id,
    ranked.publication_state,
    ranked.published_at
  from (
    select
      publication.id as publication_id,
      publication.event_category_id,
      publication.result_run_id,
      publication.publication_state,
      publication.published_at,
      row_number() over (
        partition by publication.event_category_id
        order by
          publication.published_at desc,
          publication.created_at desc,
          publication.id desc
      ) as publication_rank
    from public.result_publications publication
    where publication.publication_state in ('official', 'corrected')
  ) ranked
  where ranked.publication_rank = 1
)
select
  publication.publication_id,
  publication.publication_state,
  publication.published_at,
  result.id as result_row_id,
  result.result_run_id,
  result.registration_id,
  result.athlete_profile_id,
  result.event_category_id,
  result.result_status,
  result.finish_time_ms,
  result.gap_ms,
  result.rank_overall,
  result.rank_gender,
  result.rank_age_category,
  result.club_points,
  result.represented_club_id,
  result.created_at as result_created_at
from latest_publications publication
join public.result_rows result
  on result.result_run_id = publication.result_run_id
 and result.event_category_id = publication.event_category_id
where result.result_status in ('official', 'corrected');

comment on view public.current_published_result_rows is
  'Canonical official-result projection. Returns rows only from the latest official or corrected publication for each event category.';

revoke all on public.current_published_result_rows from public;
revoke all on public.current_published_result_rows from anon;
revoke all on public.current_published_result_rows from authenticated;
grant select on public.current_published_result_rows to service_role;

do $$
declare
  view_options text[];
begin
  select coalesce(reloptions, '{}'::text[])
  into view_options
  from pg_class
  where oid = 'public.current_published_result_rows'::regclass;

  if not ('security_invoker=true' = any(view_options))
     or not ('security_barrier=true' = any(view_options)) then
    raise exception 'current_published_result_rows must remain a security-invoker, security-barrier view';
  end if;

  if has_table_privilege('anon', 'public.current_published_result_rows', 'select') then
    raise exception 'anon must not select current_published_result_rows directly';
  end if;

  if has_table_privilege('authenticated', 'public.current_published_result_rows', 'select') then
    raise exception 'authenticated must not select current_published_result_rows directly';
  end if;

  if not has_table_privilege('service_role', 'public.current_published_result_rows', 'select') then
    raise exception 'service_role must be able to select current_published_result_rows';
  end if;
end
$$;
