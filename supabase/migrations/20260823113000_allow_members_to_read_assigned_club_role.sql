begin;

-- Athlete account views need the label of the role assigned to the current
-- membership. Keep the full role catalog manager-only, but allow an athlete
-- to read the single active role referenced by their own active membership.
drop policy if exists club_roles_select_manager
  on public.club_roles;
drop policy if exists club_roles_select_manager_or_assignee
  on public.club_roles;

create policy club_roles_select_manager_or_assignee
on public.club_roles
for select
to authenticated
using (
  public.is_platform_administrator()
  or public.club_member_has_permission(club_id, 'club.roles.manage')
  or exists (
    select 1
    from public.club_memberships membership
    where membership.club_role_id = club_roles.id
      and membership.club_id = club_roles.club_id
      and membership.athlete_profile_id = public.current_primary_athlete_profile_id()
      and membership.status = 'active'
  )
);

commit;
