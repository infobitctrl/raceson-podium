create or replace function public.service_set_primary_club(
  p_actor_user_id uuid,
  p_athlete_profile_id uuid,
  p_club_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_membership public.club_memberships%rowtype;
  previous_primary_club_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_athlete_profile_id::text, 902));

  select membership.*
  into target_membership
  from public.club_memberships membership
  where membership.athlete_profile_id = p_athlete_profile_id
    and membership.club_id = p_club_id
    and membership.status = 'active'::public.club_membership_status;

  if not found then
    raise exception 'Active club membership not found'
      using errcode = 'P0002';
  end if;

  select membership.club_id
  into previous_primary_club_id
  from public.club_memberships membership
  where membership.athlete_profile_id = p_athlete_profile_id
    and membership.status = 'active'::public.club_membership_status
    and membership.is_primary
  limit 1;

  if previous_primary_club_id is distinct from p_club_id then
    update public.club_memberships membership
    set is_primary = false,
        updated_at = clock_timestamp()
    where membership.athlete_profile_id = p_athlete_profile_id
      and membership.status = 'active'::public.club_membership_status
      and membership.is_primary;

    update public.club_memberships membership
    set is_primary = true,
        updated_at = clock_timestamp()
    where membership.id = target_membership.id;

    insert into public.audit_log (
      actor_user_id,
      entity_type,
      entity_id,
      action,
      metadata_json
    )
    values (
      p_actor_user_id,
      'club_membership',
      target_membership.id,
      'athlete.club.primary_changed',
      jsonb_build_object(
        'club_id', p_club_id,
        'previous_club_id', previous_primary_club_id
      )
    );
  end if;

  return jsonb_build_object(
    'clubId', p_club_id,
    'changed', previous_primary_club_id is distinct from p_club_id
  );
end;
$$;

revoke execute on function public.service_set_primary_club(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.service_set_primary_club(
  uuid,
  uuid,
  uuid
) to service_role;
