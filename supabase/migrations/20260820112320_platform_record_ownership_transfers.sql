begin;

create table public.platform_record_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  record_type text not null
    check (record_type in ('athlete', 'club', 'track', 'event', 'league')),
  record_id uuid not null,
  from_owner_type text not null
    check (from_owner_type in ('account', 'club_membership', 'organization', 'unclaimed')),
  from_owner_id uuid,
  to_owner_type text not null
    check (to_owner_type in ('account', 'club_membership', 'organization')),
  to_owner_id uuid not null,
  reason text not null check (char_length(trim(reason)) between 8 and 1000),
  actor_user_id uuid not null,
  metadata_json jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata_json) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);

create index platform_record_ownership_transfers_record_idx
  on public.platform_record_ownership_transfers (record_type, record_id, created_at desc);

alter table public.platform_record_ownership_transfers enable row level security;

revoke all on table public.platform_record_ownership_transfers
  from public, anon, authenticated, service_role;
grant select, insert on table public.platform_record_ownership_transfers
  to service_role;

alter table public.clubs
  add column if not exists ownership_transferred_at timestamptz,
  add column if not exists ownership_transferred_by_user_id uuid;

comment on column public.clubs.ownership_transferred_at is
  'Marks that active owner membership, not creator provenance, is authoritative for this club.';

create or replace function public.enforce_club_creator_membership()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  owner_role_id uuid;
  creator_athlete_profile_id uuid;
  transferred_at timestamptz;
begin
  select
    club.created_by_athlete_profile_id,
    club.ownership_transferred_at
  into creator_athlete_profile_id, transferred_at
  from public.clubs club
  where club.id = new.club_id;

  if
    creator_athlete_profile_id = new.athlete_profile_id
    and transferred_at is null
  then
    select role.id
    into owner_role_id
    from public.club_roles role
    where role.club_id = new.club_id
      and role.is_owner
      and role.status = 'active';

    new.club_role_id := owner_role_id;
    new.membership_role := 'owner';
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

create or replace function public.protect_active_club_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.club_owner_transfer', true) = 'enabled' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'active' and old.membership_role = 'owner' then
      if pg_trigger_depth() = 1 then
        raise exception using errcode = '23514', message = 'club_owner_transfer_required';
      end if;
    end if;
    return old;
  end if;

  if old.status = 'active' and old.membership_role = 'owner' then
    if new.status <> 'active' or new.membership_role <> 'owner' then
      raise exception using errcode = '23514', message = 'club_owner_transfer_required';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.guard_platform_record_organization_transfer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if
    new.organization_id is distinct from old.organization_id
    and current_setting('app.platform_record_owner_transfer', true) is distinct from 'enabled'
  then
    raise exception using
      errcode = '23514',
      message = 'platform_record_ownership_transfer_required';
  end if;
  return new;
end;
$$;

drop trigger if exists track_templates_guard_platform_owner on public.track_templates;
create trigger track_templates_guard_platform_owner
before update of organization_id on public.track_templates
for each row execute function public.guard_platform_record_organization_transfer();

drop trigger if exists event_series_guard_platform_owner on public.event_series;
create trigger event_series_guard_platform_owner
before update of organization_id on public.event_series
for each row execute function public.guard_platform_record_organization_transfer();

drop trigger if exists leagues_guard_platform_owner on public.leagues;
create trigger leagues_guard_platform_owner
before update of organization_id on public.leagues
for each row execute function public.guard_platform_record_organization_transfer();

create or replace function public.service_transfer_platform_organization_record(
  p_record_type text,
  p_record_id uuid,
  p_expected_organization_id uuid,
  p_new_organization_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_organization_id uuid;
  record_slug text;
  record_name text;
begin
  if p_record_type not in ('track', 'event', 'league') then
    raise exception using errcode = '22023', message = 'platform_record_type_invalid';
  end if;
  if p_expected_organization_id = p_new_organization_id then
    raise exception using errcode = '22023', message = 'platform_transfer_requires_new_owner';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception using errcode = '22023', message = 'platform_transfer_reason_required';
  end if;

  perform 1
  from public.organizations organization
  where organization.id = p_new_organization_id
    and organization.kind = 'organizer'
    and organization.status = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'platform_transfer_destination_not_found';
  end if;

  if p_record_type = 'track' then
    select track.organization_id, track.slug, track.name
    into current_organization_id, record_slug, record_name
    from public.track_templates track
    where track.id = p_record_id
    for update;
  elsif p_record_type = 'event' then
    select event.organization_id, event.slug, event.name
    into current_organization_id, record_slug, record_name
    from public.event_series event
    where event.id = p_record_id
    for update;
  else
    select league.organization_id, league.slug, league.name
    into current_organization_id, record_slug, record_name
    from public.leagues league
    where league.id = p_record_id
    for update;
  end if;

  if current_organization_id is null then
    raise exception using errcode = 'P0002', message = 'platform_record_not_found';
  end if;
  if current_organization_id <> p_expected_organization_id then
    raise exception using errcode = '40001', message = 'platform_record_owner_changed';
  end if;

  if p_record_type = 'track' then
    if exists (
      select 1
      from public.track_templates track
      where track.organization_id = p_new_organization_id
        and track.slug = record_slug
        and track.id <> p_record_id
    ) then
      raise exception using errcode = '23505', message = 'platform_transfer_slug_conflict';
    end if;
    if exists (
      select 1
      from public.league_recurrence_rules recurrence
      where recurrence.track_template_id = p_record_id
        and recurrence.status <> 'archived'
    ) then
      raise exception using errcode = '23514', message = 'platform_track_transfer_recurrence_conflict';
    end if;
  elsif p_record_type = 'event' then
    if exists (
      select 1
      from public.event_series event
      where event.organization_id = p_new_organization_id
        and event.slug = record_slug
        and event.id <> p_record_id
    ) then
      raise exception using errcode = '23505', message = 'platform_transfer_slug_conflict';
    end if;
    if exists (
      select 1
      from public.registrations registration
      join public.event_categories category on category.id = registration.event_category_id
      join public.event_editions edition on edition.id = category.event_edition_id
      where edition.event_series_id = p_record_id
    ) then
      raise exception using errcode = '23514', message = 'platform_event_transfer_has_registrations';
    end if;
    if exists (
      select 1
      from public.league_recurrence_rules recurrence
      where recurrence.event_series_id = p_record_id
        and recurrence.status <> 'archived'
    ) then
      raise exception using errcode = '23514', message = 'platform_event_transfer_recurrence_conflict';
    end if;
  else
    if exists (
      select 1
      from public.leagues league
      where league.organization_id = p_new_organization_id
        and league.slug = record_slug
        and league.id <> p_record_id
    ) then
      raise exception using errcode = '23505', message = 'platform_transfer_slug_conflict';
    end if;
    if exists (
      select 1
      from public.league_recurrence_rules recurrence
      join public.league_seasons season on season.id = recurrence.league_season_id
      join public.event_series event on event.id = recurrence.event_series_id
      join public.track_templates track on track.id = recurrence.track_template_id
      where season.league_id = p_record_id
        and recurrence.status <> 'archived'
        and (
          event.organization_id <> p_new_organization_id
          or track.organization_id <> p_new_organization_id
        )
    ) then
      raise exception using errcode = '23514', message = 'platform_league_transfer_dependency_conflict';
    end if;
  end if;

  perform set_config('app.platform_record_owner_transfer', 'enabled', true);

  if p_record_type = 'track' then
    update public.track_templates
    set organization_id = p_new_organization_id, updated_at = clock_timestamp()
    where id = p_record_id and organization_id = p_expected_organization_id;
  elsif p_record_type = 'event' then
    update public.event_series
    set organization_id = p_new_organization_id, updated_at = clock_timestamp()
    where id = p_record_id and organization_id = p_expected_organization_id;
  else
    update public.leagues
    set organization_id = p_new_organization_id, updated_at = clock_timestamp()
    where id = p_record_id and organization_id = p_expected_organization_id;
  end if;

  if not found then
    raise exception using errcode = '40001', message = 'platform_record_owner_changed';
  end if;

  insert into public.platform_record_ownership_transfers (
    record_type, record_id, from_owner_type, from_owner_id,
    to_owner_type, to_owner_id, reason, actor_user_id, metadata_json
  ) values (
    p_record_type, p_record_id, 'organization', p_expected_organization_id,
    'organization', p_new_organization_id, trim(p_reason), p_actor_user_id,
    jsonb_build_object('recordName', record_name, 'recordSlug', record_slug)
  );

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  ) values (
    p_new_organization_id,
    p_actor_user_id,
    p_record_type,
    p_record_id,
    'platform.' || p_record_type || '_ownership_transferred',
    jsonb_build_object(
      'fromOrganizationId', p_expected_organization_id,
      'toOrganizationId', p_new_organization_id,
      'reason', trim(p_reason)
    )
  );

  return jsonb_build_object(
    'recordType', p_record_type,
    'recordId', p_record_id,
    'previousOwnerId', p_expected_organization_id,
    'newOwnerId', p_new_organization_id
  );
end;
$$;

create or replace function public.service_transfer_club_ownership(
  p_club_id uuid,
  p_current_owner_membership_id uuid,
  p_new_owner_membership_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_owner public.club_memberships%rowtype;
  new_owner public.club_memberships%rowtype;
  owner_role_id uuid;
  administrator_role_id uuid;
  club_name text;
begin
  if
    p_current_owner_membership_id is not null
    and p_current_owner_membership_id = p_new_owner_membership_id
  then
    raise exception using errcode = '22023', message = 'platform_transfer_requires_new_owner';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception using errcode = '22023', message = 'platform_transfer_reason_required';
  end if;

  select club.name
  into club_name
  from public.clubs club
  where club.id = p_club_id
    and club.status <> 'merged'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'platform_record_not_found';
  end if;

  if p_current_owner_membership_id is null then
    if exists (
      select 1
      from public.club_memberships membership
      where membership.club_id = p_club_id
        and membership.status = 'active'
        and membership.membership_role = 'owner'
    ) then
      raise exception using errcode = '40001', message = 'platform_record_owner_changed';
    end if;
  else
    select membership.*
    into current_owner
    from public.club_memberships membership
    where membership.id = p_current_owner_membership_id
      and membership.club_id = p_club_id
    for update;
    if not found or current_owner.status <> 'active' or current_owner.membership_role <> 'owner' then
      raise exception using errcode = '40001', message = 'platform_record_owner_changed';
    end if;
  end if;

  select membership.*
  into new_owner
  from public.club_memberships membership
  where membership.id = p_new_owner_membership_id
    and membership.club_id = p_club_id
  for update;
  if not found or new_owner.status <> 'active' then
    raise exception using errcode = '23514', message = 'platform_club_transfer_requires_active_member';
  end if;

  select role.id into owner_role_id
  from public.club_roles role
  where role.club_id = p_club_id and role.is_owner and role.status = 'active';

  select role.id into administrator_role_id
  from public.club_roles role
  where role.club_id = p_club_id
    and role.role_key = 'administrator'
    and role.status = 'active';

  if owner_role_id is null or administrator_role_id is null then
    raise exception using errcode = '23514', message = 'platform_club_transfer_roles_missing';
  end if;

  update public.clubs
  set
    ownership_transferred_at = clock_timestamp(),
    ownership_transferred_by_user_id = p_actor_user_id,
    updated_at = clock_timestamp()
  where id = p_club_id;

  perform set_config('app.club_owner_transfer', 'enabled', true);

  if p_current_owner_membership_id is not null then
    update public.club_memberships
    set club_role_id = administrator_role_id, updated_at = clock_timestamp()
    where id = p_current_owner_membership_id;
  end if;

  update public.club_memberships
  set club_role_id = owner_role_id, status = 'active', updated_at = clock_timestamp()
  where id = p_new_owner_membership_id;

  insert into public.platform_record_ownership_transfers (
    record_type, record_id, from_owner_type, from_owner_id,
    to_owner_type, to_owner_id, reason, actor_user_id, metadata_json
  ) values (
    'club', p_club_id,
    case when p_current_owner_membership_id is null then 'unclaimed' else 'club_membership' end,
    current_owner.id,
    'club_membership', new_owner.id, trim(p_reason), p_actor_user_id,
    jsonb_build_object(
      'clubName', club_name,
      'previousOwnerAthleteProfileId', current_owner.athlete_profile_id,
      'newOwnerAthleteProfileId', new_owner.athlete_profile_id,
      'previousOwnerRole', case
        when p_current_owner_membership_id is null then null
        else 'administrator'
      end
    )
  );

  insert into public.audit_log (
    actor_user_id, entity_type, entity_id, action, metadata_json
  ) values (
    p_actor_user_id,
    'club',
    p_club_id,
    'platform.club_ownership_transferred',
    jsonb_build_object(
      'previousOwnerMembershipId', current_owner.id,
      'newOwnerMembershipId', new_owner.id,
      'reason', trim(p_reason)
    )
  );

  return jsonb_build_object(
    'recordType', 'club',
    'recordId', p_club_id,
    'previousOwnerId', current_owner.id,
    'newOwnerId', new_owner.id
  );
end;
$$;

create or replace function public.service_reassign_athlete_profile_account(
  p_athlete_profile_id uuid,
  p_expected_current_user_id uuid,
  p_new_user_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  athlete public.athlete_profiles%rowtype;
  target_profile public.user_profiles%rowtype;
begin
  if p_expected_current_user_id = p_new_user_id then
    raise exception using errcode = '22023', message = 'platform_transfer_requires_new_owner';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception using errcode = '22023', message = 'platform_transfer_reason_required';
  end if;

  select profile.*
  into athlete
  from public.athlete_profiles profile
  where profile.id = p_athlete_profile_id
    and profile.merged_into_athlete_profile_id is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'platform_record_not_found';
  end if;
  if athlete.claimed_by_user_id is distinct from p_expected_current_user_id then
    raise exception using errcode = '40001', message = 'platform_record_owner_changed';
  end if;

  select profile.*
  into target_profile
  from public.user_profiles profile
  where profile.user_id = p_new_user_id
    and profile.status = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'platform_transfer_destination_not_found';
  end if;
  if
    target_profile.primary_athlete_profile_id is not null
    and target_profile.primary_athlete_profile_id <> p_athlete_profile_id
  then
    raise exception using errcode = '23514', message = 'platform_athlete_transfer_target_has_profile';
  end if;
  if exists (
    select 1
    from public.athlete_profiles profile
    where profile.claimed_by_user_id = p_new_user_id
      and profile.id <> p_athlete_profile_id
      and profile.merged_into_athlete_profile_id is null
  ) then
    raise exception using errcode = '23514', message = 'platform_athlete_transfer_target_has_profile';
  end if;
  if exists (
    select 1
    from public.athlete_identities identity
    where identity.identity_type = 'auth_user'
      and identity.identity_value = p_new_user_id::text
      and identity.athlete_profile_id <> p_athlete_profile_id
  ) then
    raise exception using errcode = '23514', message = 'platform_athlete_transfer_target_identity_conflict';
  end if;

  if p_expected_current_user_id is not null then
    update public.user_profiles
    set primary_athlete_profile_id = null, updated_at = clock_timestamp()
    where user_id = p_expected_current_user_id
      and primary_athlete_profile_id = p_athlete_profile_id;

    update public.athlete_identities
    set
      user_id = p_new_user_id,
      identity_value = case
        when identity_type = 'auth_user' then p_new_user_id::text
        else identity_value
      end
    where athlete_profile_id = p_athlete_profile_id
      and user_id = p_expected_current_user_id;
  end if;

  insert into public.athlete_identities (
    athlete_profile_id, user_id, identity_type, identity_value, is_verified, verified_at
  ) values (
    p_athlete_profile_id, p_new_user_id, 'auth_user', p_new_user_id::text, true, clock_timestamp()
  )
  on conflict (identity_type, identity_value) do update
  set
    athlete_profile_id = excluded.athlete_profile_id,
    user_id = excluded.user_id,
    is_verified = true,
    verified_at = excluded.verified_at;

  update public.athlete_profiles
  set
    claimed_by_user_id = p_new_user_id,
    is_claimed = true,
    updated_at = clock_timestamp()
  where id = p_athlete_profile_id;

  update public.user_profiles
  set primary_athlete_profile_id = p_athlete_profile_id, updated_at = clock_timestamp()
  where user_id = p_new_user_id;

  insert into public.platform_record_ownership_transfers (
    record_type, record_id, from_owner_type, from_owner_id,
    to_owner_type, to_owner_id, reason, actor_user_id, metadata_json
  ) values (
    'athlete', p_athlete_profile_id,
    case when p_expected_current_user_id is null then 'unclaimed' else 'account' end,
    p_expected_current_user_id,
    'account', p_new_user_id, trim(p_reason), p_actor_user_id,
    jsonb_build_object('athleteName', athlete.display_name, 'athleteSlug', athlete.slug)
  );

  insert into public.audit_log (
    actor_user_id, entity_type, entity_id, action, metadata_json
  ) values (
    p_actor_user_id,
    'athlete_profile',
    p_athlete_profile_id,
    'platform.athlete_account_reassigned',
    jsonb_build_object(
      'previousUserId', p_expected_current_user_id,
      'newUserId', p_new_user_id,
      'reason', trim(p_reason)
    )
  );

  return jsonb_build_object(
    'recordType', 'athlete',
    'recordId', p_athlete_profile_id,
    'previousOwnerId', p_expected_current_user_id,
    'newOwnerId', p_new_user_id
  );
end;
$$;

revoke all on function public.service_transfer_platform_organization_record(
  text, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.service_transfer_platform_organization_record(
  text, uuid, uuid, uuid, uuid, text
) to service_role;

revoke all on function public.service_transfer_club_ownership(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.service_transfer_club_ownership(
  uuid, uuid, uuid, uuid, text
) to service_role;

revoke all on function public.service_reassign_athlete_profile_account(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.service_reassign_athlete_profile_account(
  uuid, uuid, uuid, uuid, text
) to service_role;

comment on table public.platform_record_ownership_transfers is
  'Immutable service-only ledger for platform-level ownership transfers.';

commit;
