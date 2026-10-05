begin;

create or replace function public.service_retire_platform_athlete_for_deletion(
  p_actor_user_id uuid,
  p_athlete_profile_id uuid,
  p_confirmation_name text,
  p_reason text,
  p_claimed_user_id uuid default null,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  profile_row public.athlete_profiles%rowtype;
  has_protected_ownership boolean := false;
  membership_row public.club_memberships%rowtype;
  next_event_sequence integer;
  appended_membership_events integer := 0;
  removed_memberships integer := 0;
begin
  if not exists (
    select 1
    from public.platform_administrators administrator
    where administrator.user_id = p_actor_user_id
      and administrator.is_active
      and administrator.platform_role = 'super_admin'
  ) then
    raise exception using errcode = '42501', message = 'super_administrator_required';
  end if;

  if p_reason is null or length(trim(p_reason)) < 8 then
    raise exception using errcode = '22023', message = 'platform_record_deletion_reason_required';
  end if;

  select profile.*
  into profile_row
  from public.athlete_profiles profile
  where profile.id = p_athlete_profile_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'platform_record_not_found';
  end if;

  if trim(coalesce(p_confirmation_name, '')) <> profile_row.display_name then
    raise exception using errcode = '22023', message = 'platform_record_confirmation_mismatch';
  end if;

  if p_claimed_user_id is null then
    if profile_row.is_claimed or profile_row.claimed_by_user_id is not null then
      raise exception using errcode = '55000', message = 'athlete_profile_is_claimed';
    end if;
    if exists (
      select 1 from public.user_profiles account_profile
      where account_profile.primary_athlete_profile_id = p_athlete_profile_id
    ) then
      raise exception using errcode = '55000', message = 'athlete_profile_is_claimed';
    end if;
  elsif not (
    profile_row.claimed_by_user_id = p_claimed_user_id
    or exists (
      select 1 from public.user_profiles account_profile
      where account_profile.user_id = p_claimed_user_id
        and account_profile.primary_athlete_profile_id = p_athlete_profile_id
    )
  ) then
    raise exception using errcode = '55000', message = 'account_athlete_profile_mismatch';
  end if;

  if exists (
    select 1 from public.user_profiles account_profile
    where account_profile.primary_athlete_profile_id = p_athlete_profile_id
      and (p_claimed_user_id is null or account_profile.user_id <> p_claimed_user_id)
  ) then
    raise exception using errcode = '55000', message = 'athlete_profile_is_claimed';
  end if;

  select exists (
    select 1 from public.clubs club
    where club.created_by_athlete_profile_id = p_athlete_profile_id
    union all
    select 1 from public.club_memberships membership
    where membership.athlete_profile_id = p_athlete_profile_id
      and membership.status = 'active'
      and membership.membership_role = 'owner'
    limit 1
  ) into has_protected_ownership;

  if has_protected_ownership then
    raise exception using errcode = '55000', message = 'athlete_profile_owns_club';
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'deletable', true,
      'athleteProfileId', p_athlete_profile_id,
      'athleteName', profile_row.display_name
    );
  end if;

  for membership_row in
    select membership.*
    from public.club_memberships membership
    where membership.athlete_profile_id = p_athlete_profile_id
      and membership.status <> 'removed'
    order by membership.created_at, membership.id
    for update
  loop
    select coalesce(max(event.sequence_number), 0) + 1
    into next_event_sequence
    from public.club_membership_events event
    where event.club_id = membership_row.club_id
      and event.athlete_profile_id = p_athlete_profile_id;

    insert into public.club_membership_events (
      club_id,
      athlete_profile_id,
      membership_id,
      sequence_number,
      event_type,
      from_status,
      to_status,
      membership_role,
      effective_at,
      note,
      actor_user_id,
      client_event_id
    ) values (
      membership_row.club_id,
      p_athlete_profile_id,
      membership_row.id,
      next_event_sequence,
      'removed',
      membership_row.status,
      'removed',
      membership_row.membership_role,
      clock_timestamp(),
      'Platform athlete deletion removed club access.',
      p_actor_user_id,
      gen_random_uuid()
    );
    appended_membership_events := appended_membership_events + 1;

    update public.club_memberships membership
    set status = 'removed',
        is_primary = false,
        updated_at = clock_timestamp()
    where membership.id = membership_row.id;
    removed_memberships := removed_memberships + 1;
  end loop;

  if p_claimed_user_id is not null then
    delete from public.athlete_claims claim
    where claim.athlete_profile_id = p_athlete_profile_id
      and claim.claimant_user_id = p_claimed_user_id;

    update public.user_profiles account_profile
    set primary_athlete_profile_id = null,
        updated_at = clock_timestamp()
    where account_profile.user_id = p_claimed_user_id
      and account_profile.primary_athlete_profile_id = p_athlete_profile_id;

  end if;

  delete from public.athlete_claims claim
  where claim.athlete_profile_id = p_athlete_profile_id;

  delete from public.athlete_identities identity
  where identity.athlete_profile_id = p_athlete_profile_id;

  delete from public.athlete_aliases alias
  where alias.athlete_profile_id = p_athlete_profile_id;

  update public.athlete_profiles profile
  set slug = 'deleted-athlete-' || replace(profile.id::text, '-', ''),
      first_name = 'Deleted',
      last_name = 'Athlete',
      display_name = 'Deleted athlete',
      gender = null,
      date_of_birth = null,
      birth_year = null,
      city = null,
      country_code = null,
      primary_email = null,
      is_claimed = false,
      claimed_by_user_id = null,
      status = 'deleted',
      merged_into_athlete_profile_id = null,
      updated_at = clock_timestamp()
  where profile.id = p_athlete_profile_id;

  insert into public.audit_log (
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  ) values (
    p_actor_user_id,
    'athlete',
    p_athlete_profile_id,
    'platform.athlete_deleted',
    jsonb_build_object(
      'recordName', profile_row.display_name,
      'recordSlug', profile_row.slug,
      'reason', trim(p_reason),
      'accountDeletion', p_claimed_user_id is not null,
      'removedClubMemberships', removed_memberships,
      'appendedClubMembershipEvents', appended_membership_events
    )
  );

  return jsonb_build_object(
    'deleted', true,
    'retired', true,
    'recordType', 'athlete',
    'recordId', p_athlete_profile_id,
    'removedClubMemberships', removed_memberships,
    'appendedClubMembershipEvents', appended_membership_events
  );
end;
$$;

revoke all on function public.service_retire_platform_athlete_for_deletion(
  uuid, uuid, text, text, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.service_retire_platform_athlete_for_deletion(
  uuid, uuid, text, text, uuid, boolean
) to service_role;

comment on function public.service_retire_platform_athlete_for_deletion(
  uuid, uuid, text, text, uuid, boolean
) is
  'Preflights or retires an athlete during platform account/record deletion, removing club and account access while anonymizing immutable race and membership history.';

commit;
