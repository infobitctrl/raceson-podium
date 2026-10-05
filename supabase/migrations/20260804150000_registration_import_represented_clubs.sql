create or replace function public.apply_registration_import_represented_club()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_club_id uuid;
begin
  if new.row_status <> 'imported'
     or new.registration_id is null
     or nullif(new.normalized_json->>'representedClubId', '') is null then
    return new;
  end if;

  resolved_club_id := (new.normalized_json->>'representedClubId')::uuid;
  if not exists (
    select 1
    from public.clubs club
    where club.id = resolved_club_id
      and club.status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'registration_import_club_invalid';
  end if;

  update public.registrations registration
  set
    represented_club_id = resolved_club_id,
    updated_at = now()
  where registration.id = new.registration_id;

  return new;
end;
$$;

drop trigger if exists registration_import_rows_apply_represented_club
  on public.registration_import_rows;
create trigger registration_import_rows_apply_represented_club
after update of row_status, registration_id, normalized_json
on public.registration_import_rows
for each row
execute function public.apply_registration_import_represented_club();

revoke all on function public.apply_registration_import_represented_club()
  from public, anon, authenticated;
grant execute on function public.apply_registration_import_represented_club()
  to service_role;
