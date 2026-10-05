create or replace function public.public_registration_counts(
  target_event_category_ids uuid[] default null
)
returns table (
  event_category_id uuid,
  registered_count integer,
  confirmed_count integer,
  waitlisted_count integer,
  dns_count integer,
  checked_in_count integer,
  starter_count integer,
  finisher_count integer
)
language sql
security definer
set search_path = ''
as $$
  with scoped_categories as (
    select ec.id
    from public.event_categories ec
    join public.event_editions ee on ee.id = ec.event_edition_id
    where ec.status <> 'draft'
      and ee.status in (
        'published',
        'registration_open',
        'registration_closed',
        'in_progress',
        'completed',
        'archived'
      )
      and (
        target_event_category_ids is null
        or ec.id = any(target_event_category_ids)
      )
  ),
  active_bibs as (
    select distinct registration_id
    from public.bib_assignments
    where revoked_at is null
  )
  select
    r.event_category_id,
    count(*)::integer as registered_count,
    count(*) filter (
      where r.status in ('pending', 'confirmed')
        and (
          active_bibs.registration_id is not null
          or r.confirmed_at is not null
          or r.participation_status in ('checked_in', 'started', 'finished', 'dnf', 'dsq')
        )
    )::integer as confirmed_count,
    count(*) filter (
      where r.status = 'waitlisted'
    )::integer as waitlisted_count,
    count(*) filter (
      where r.status in ('pending', 'confirmed')
        and r.participation_status = 'dns'
    )::integer as dns_count,
    count(*) filter (
      where r.status in ('pending', 'confirmed')
        and r.participation_status in ('checked_in', 'started', 'finished', 'dnf', 'dsq')
    )::integer as checked_in_count,
    count(*) filter (
      where r.status in ('pending', 'confirmed')
        and r.participation_status in ('started', 'finished', 'dnf', 'dsq')
    )::integer as starter_count,
    count(*) filter (
      where r.status in ('pending', 'confirmed')
        and r.participation_status = 'finished'
    )::integer as finisher_count
  from public.registrations r
  join scoped_categories on scoped_categories.id = r.event_category_id
  left join active_bibs on active_bibs.registration_id = r.id
  group by r.event_category_id;
$$;

comment on function public.public_registration_counts(uuid[]) is
  'Returns public per-category totals. registered_count counts every registration row regardless of registration status; participation and status-specific counts retain their own definitions.';

revoke all on function public.public_registration_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.public_registration_counts(uuid[]) to anon, authenticated, service_role;
