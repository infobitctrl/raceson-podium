begin;

create or replace function public.sync_current_result_status_to_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.result_status not in ('official', 'corrected', 'void') then
    return new;
  end if;

  if exists (
    select 1
    from public.result_publications publication
    where publication.result_run_id = new.result_run_id
      and publication.id = (
        select latest.id
        from public.result_publications latest
        where latest.event_category_id = new.event_category_id
        order by latest.published_at desc, latest.created_at desc, latest.id desc
        limit 1
      )
  ) then
    update public.registrations registration
    set
      result_status = new.result_status,
      updated_at = clock_timestamp()
    where registration.id = new.registration_id
      and registration.result_status is distinct from new.result_status;
  end if;

  return new;
end;
$$;

drop trigger if exists result_rows_sync_current_registration_status
  on public.result_rows;

create trigger result_rows_sync_current_registration_status
after insert or update on public.result_rows
for each row execute function public.sync_current_result_status_to_registration();

with latest_publications as (
  select distinct on (publication.event_category_id)
    publication.event_category_id,
    publication.result_run_id
  from public.result_publications publication
  order by
    publication.event_category_id,
    publication.published_at desc,
    publication.created_at desc,
    publication.id desc
), current_results as (
  select result.registration_id, result.result_status
  from latest_publications publication
  join public.result_rows result
    on result.result_run_id = publication.result_run_id
  where result.result_status in ('official', 'corrected', 'void')
)
update public.registrations registration
set
  result_status = result.result_status,
  updated_at = clock_timestamp()
from current_results result
where registration.id = result.registration_id
  and registration.result_status is distinct from result.result_status;

comment on function public.sync_current_result_status_to_registration() is
  'Keeps the registration status projection aligned with the latest published result run.';

revoke all on function public.sync_current_result_status_to_registration()
  from public, anon, authenticated;

commit;
