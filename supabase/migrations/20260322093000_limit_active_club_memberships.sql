begin;

create or replace function public.enforce_active_club_membership_limit()
returns trigger
language plpgsql
as $$
declare
  active_membership_count integer := 0;
begin
  if new.status <> 'active' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select count(*)
    into active_membership_count
    from public.club_memberships
    where athlete_profile_id = new.athlete_profile_id
      and status = 'active'
      and id <> old.id;
  else
    select count(*)
    into active_membership_count
    from public.club_memberships
    where athlete_profile_id = new.athlete_profile_id
      and status = 'active';
  end if;

  if active_membership_count >= 3 then
    raise exception 'You can join up to 3 clubs at the same time.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists club_memberships_enforce_active_limit
  on public.club_memberships;

create trigger club_memberships_enforce_active_limit
before insert or update of athlete_profile_id, status
on public.club_memberships
for each row execute function public.enforce_active_club_membership_limit();

commit;
