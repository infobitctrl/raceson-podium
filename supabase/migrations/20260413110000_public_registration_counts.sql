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
set search_path = public
as $$
  with scoped_categories as (
    select ec.id
    from event_categories ec
    where public.is_event_category_public(ec.id)
      and (
        target_event_category_ids is null
        or ec.id = any(target_event_category_ids)
      )
  ),
  active_bibs as (
    select distinct registration_id
    from bib_assignments
    where revoked_at is null
  )
  select
    r.event_category_id,
    count(*) filter (
      where r.status in ('pending', 'confirmed')
    )::integer as registered_count,
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
  from registrations r
  join scoped_categories on scoped_categories.id = r.event_category_id
  left join active_bibs on active_bibs.registration_id = r.id
  group by r.event_category_id;
$$;

revoke all on function public.public_registration_counts(uuid[]) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.public_registration_counts(uuid[]) to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.public_registration_counts(uuid[]) to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.public_registration_counts(uuid[]) to service_role;
  end if;
end;
$$;
