begin;

-- A club creator already owns the club profile through
-- clubs.created_by_athlete_profile_id. Keep the matching membership aligned
-- with that authority so approval-gated clubs do not strand their creator in
-- the pending queue.
create or replace function public.enforce_club_creator_membership()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.clubs club
    where club.id = new.club_id
      and club.created_by_athlete_profile_id = new.athlete_profile_id
  ) then
    new.membership_role := 'administrator';
    new.status := 'active'::public.club_membership_status;
    new.joined_at := coalesce(new.joined_at, clock_timestamp());

    if not exists (
      select 1
      from public.club_memberships membership
      where membership.athlete_profile_id = new.athlete_profile_id
        and membership.status = 'active'
        and membership.is_primary
        and membership.id <> new.id
    ) then
      new.is_primary := true;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists club_memberships_00_enforce_creator
  on public.club_memberships;

create trigger club_memberships_00_enforce_creator
before insert or update of
  club_id,
  athlete_profile_id,
  membership_role,
  status,
  is_primary,
  joined_at
on public.club_memberships
for each row execute function public.enforce_club_creator_membership();

-- Repair creator memberships that are still eligible for activation. Rows at
-- the three-club membership limit are deliberately left untouched so this
-- release cannot bypass the existing account limit.
update public.club_memberships membership
set
  membership_role = 'administrator',
  status = 'active'::public.club_membership_status,
  is_primary = not exists (
    select 1
    from public.club_memberships primary_membership
    where primary_membership.athlete_profile_id = membership.athlete_profile_id
      and primary_membership.status = 'active'
      and primary_membership.is_primary
      and primary_membership.id <> membership.id
  ),
  joined_at = coalesce(membership.joined_at, clock_timestamp()),
  updated_at = clock_timestamp()
from public.clubs club
where club.id = membership.club_id
  and club.created_by_athlete_profile_id = membership.athlete_profile_id
  and (
    membership.membership_role <> 'administrator'
    or membership.status <> 'active'
    or membership.joined_at is null
  )
  and (
    select count(*)
    from public.club_memberships active_membership
    where active_membership.athlete_profile_id = membership.athlete_profile_id
      and active_membership.status = 'active'
      and active_membership.membership_origin <> 'represented'
      and active_membership.id <> membership.id
  ) < 3;

comment on function public.enforce_club_creator_membership() is
  'Keeps a club creator membership active with administrator authority and assigns it as primary when no other active primary membership exists.';

commit;
