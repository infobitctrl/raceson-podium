create or replace function public.service_organizer_registration_counts(
  target_event_category_ids uuid[]
)
returns table (
  event_category_id uuid,
  registered_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    registration.event_category_id,
    count(*)::integer as registered_count
  from public.registrations registration
  where target_event_category_ids is not null
    and cardinality(target_event_category_ids) > 0
    and registration.event_category_id = any(target_event_category_ids)
    and registration.status in ('pending', 'confirmed')
    and registration.organizer_removed_at is null
  group by registration.event_category_id;
$$;

revoke all on function public.service_organizer_registration_counts(uuid[]) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.service_organizer_registration_counts(uuid[]) to service_role;
  end if;
end;
$$;
