begin;

-- Imported clubs arrived without application owners. Give every athlete who
-- was already an active member of one of those clubs day-to-day administrator
-- access. New memberships continue to receive the ordinary Member role.
update public.club_memberships membership
set
  club_role_id = administrator_role.id,
  membership_role = administrator_role.role_key,
  updated_at = clock_timestamp()
from public.clubs club
join public.club_roles administrator_role
  on administrator_role.club_id = club.id
 and administrator_role.role_key = 'administrator'
 and administrator_role.status = 'active'
where membership.club_id = club.id
  and club.created_by_athlete_profile_id is null
  and membership.status = 'active'
  and membership.membership_role <> 'owner';

-- Keep administrator recovery requests and owner claims in one audited inbox,
-- while recording the authority the athlete actually asked the platform team
-- to grant.
alter table public.club_admin_role_requests
  add column requested_role_key text not null default 'administrator';

alter table public.club_admin_role_requests
  add constraint club_admin_role_requests_requested_role_key_check
  check (requested_role_key in ('administrator', 'owner'));

drop function public.service_submit_club_admin_role_request(uuid, uuid, uuid, text);

create function public.service_submit_club_admin_role_request(
  p_actor_user_id uuid,
  p_athlete_profile_id uuid,
  p_club_id uuid,
  p_note text default null,
  p_requested_role_key text default 'administrator'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_membership public.club_memberships%rowtype;
  saved_request public.club_admin_role_requests%rowtype;
begin
  if p_requested_role_key is null
    or p_requested_role_key not in ('administrator', 'owner') then
    raise exception using errcode = '22023', message = 'club_access_role_invalid';
  end if;

  if not exists (
    select 1
    from public.user_profiles profile
    where profile.user_id = p_actor_user_id
      and profile.primary_athlete_profile_id = p_athlete_profile_id
  ) then
    raise exception using errcode = '42501', message = 'athlete_profile_access_required';
  end if;

  select membership.*
  into active_membership
  from public.club_memberships membership
  join public.clubs club
    on club.id = membership.club_id
   and club.status = 'active'
  where membership.club_id = p_club_id
    and membership.athlete_profile_id = p_athlete_profile_id
    and membership.status = 'active';

  if not found then
    raise exception using errcode = '42501', message = 'active_club_membership_required';
  end if;

  if p_requested_role_key = 'administrator'
     and active_membership.membership_role <> 'member' then
    raise exception using errcode = '23505', message = 'club_administrator_access_already_assigned';
  end if;

  if p_requested_role_key = 'owner' then
    if active_membership.membership_role = 'owner' then
      raise exception using errcode = '23505', message = 'club_owner_access_already_assigned';
    end if;
    if active_membership.membership_role <> 'administrator' then
      raise exception using errcode = '42501', message = 'club_administrator_access_required';
    end if;
    if exists (
      select 1
      from public.club_memberships owner_membership
      where owner_membership.club_id = p_club_id
        and owner_membership.status = 'active'
        and owner_membership.membership_role = 'owner'
    ) then
      raise exception using errcode = '23505', message = 'club_owner_already_assigned';
    end if;
  end if;

  insert into public.club_admin_role_requests (
    club_id,
    athlete_profile_id,
    claimant_user_id,
    requested_role_key,
    note
  )
  values (
    p_club_id,
    p_athlete_profile_id,
    p_actor_user_id,
    p_requested_role_key,
    nullif(trim(p_note), '')
  )
  on conflict (club_id, claimant_user_id)
    where status = 'pending'
  do update set
    requested_role_key = excluded.requested_role_key,
    note = coalesce(excluded.note, public.club_admin_role_requests.note),
    updated_at = clock_timestamp()
  returning * into saved_request;

  return jsonb_build_object(
    'requestId', saved_request.id,
    'clubId', saved_request.club_id,
    'requestedRoleKey', saved_request.requested_role_key,
    'status', saved_request.status,
    'submittedAt', saved_request.submitted_at
  );
end;
$$;

create or replace function public.service_decide_club_admin_role_request(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.club_admin_role_requests%rowtype;
  current_membership public.club_memberships%rowtype;
  target_role public.club_roles%rowtype;
  assigned_role_key text;
begin
  if not public.is_active_platform_administrator(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'platform_administrator_required';
  end if;
  if p_decision not in ('approved', 'rejected') or nullif(trim(p_note), '') is null then
    raise exception using errcode = '22023', message = 'club_access_decision_invalid';
  end if;

  select request_item.*
  into request_row
  from public.club_admin_role_requests request_item
  where request_item.id = p_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'club_admin_request_not_found';
  end if;
  if request_row.status <> 'pending' then
    raise exception using errcode = '55000', message = 'club_admin_request_closed';
  end if;

  if request_row.requested_role_key = 'owner'
     and not exists (
       select 1
       from public.platform_administrators administrator
       where administrator.user_id = p_actor_user_id
         and administrator.is_active
         and administrator.platform_role = 'super_admin'
     ) then
    raise exception using errcode = '42501', message = 'platform_super_administrator_required';
  end if;

  if p_decision = 'approved' then
    select membership.*
    into current_membership
    from public.club_memberships membership
    where membership.club_id = request_row.club_id
      and membership.athlete_profile_id = request_row.athlete_profile_id
      and membership.status = 'active';

    if not found then
      raise exception using errcode = '42501', message = 'active_club_membership_required';
    end if;

    if request_row.requested_role_key = 'owner'
       and current_membership.membership_role <> 'administrator' then
      raise exception using errcode = '42501', message = 'club_administrator_access_required';
    end if;

    assigned_role_key := request_row.requested_role_key;

    if assigned_role_key = 'owner'
       and exists (
         select 1
         from public.club_memberships owner_membership
         where owner_membership.club_id = request_row.club_id
           and owner_membership.status = 'active'
           and owner_membership.membership_role = 'owner'
       ) then
      raise exception using errcode = '23505', message = 'club_owner_already_assigned';
    end if;

    select role.*
    into target_role
    from public.club_roles role
    where role.club_id = request_row.club_id
      and role.role_key = assigned_role_key
      and role.status = 'active';

    if not found then
      raise exception using errcode = 'P0002', message = 'club_access_role_not_found';
    end if;

    update public.club_memberships membership
    set
      club_role_id = target_role.id,
      membership_role = target_role.role_key,
      updated_at = clock_timestamp()
    where membership.club_id = request_row.club_id
      and membership.athlete_profile_id = request_row.athlete_profile_id
      and membership.status = 'active';

    insert into public.audit_log (
      actor_user_id, entity_type, entity_id, action, metadata_json
    ) values (
      p_actor_user_id,
      'club_membership',
      request_row.id,
      case
        when assigned_role_key = 'owner' then 'club.owner_claim.approved'
        else 'club.admin_recovery.approved'
      end,
      jsonb_build_object(
        'club_id', request_row.club_id,
        'athlete_profile_id', request_row.athlete_profile_id,
        'club_role', assigned_role_key
      )
    );
  end if;

  update public.club_admin_role_requests request_item
  set
    status = p_decision,
    reviewed_at = clock_timestamp(),
    reviewed_by_user_id = p_actor_user_id,
    decision_note = trim(p_note),
    updated_at = clock_timestamp()
  where request_item.id = request_row.id;

  return jsonb_build_object(
    'requestId', request_row.id,
    'status', p_decision,
    'clubId', request_row.club_id,
    'requestedRoleKey', request_row.requested_role_key,
    'clubRole', assigned_role_key
  );
end;
$$;

revoke all on function public.service_submit_club_admin_role_request(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.service_decide_club_admin_role_request(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.service_submit_club_admin_role_request(uuid, uuid, uuid, text, text)
  to service_role;
grant execute on function public.service_decide_club_admin_role_request(uuid, uuid, text, text)
  to service_role;

comment on column public.club_admin_role_requests.requested_role_key is
  'Club-scoped role requested by the athlete. Owner claims require super-admin approval.';
comment on function public.service_submit_club_admin_role_request(uuid, uuid, uuid, text, text) is
  'Submits an administrator recovery request or owner claim for an active club member.';
comment on function public.service_decide_club_admin_role_request(uuid, uuid, text, text) is
  'Reviews club access requests. Owner claims require a super administrator and never grant organizer access.';

commit;
