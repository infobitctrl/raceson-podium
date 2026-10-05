begin;

/*
 * Imported race identity is evidence, not authority.
 *
 * - Representing a club creates an ordinary member relationship.
 * - Athlete profile and club administrator claims remain reviewable actions.
 * - Request tables stay behind the server boundary; browser roles receive no
 *   direct table privileges.
 */

alter table public.club_memberships
  add column if not exists membership_origin text not null default 'self_joined';

alter table public.club_memberships
  drop constraint if exists club_memberships_membership_origin_check;

alter table public.club_memberships
  add constraint club_memberships_membership_origin_check
  check (membership_origin in ('self_joined', 'represented', 'invited', 'admin_added'));

create index if not exists club_memberships_origin_status_idx
  on public.club_memberships (athlete_profile_id, membership_origin, status);

create or replace function public.enforce_active_club_membership_limit()
returns trigger
language plpgsql
as $$
declare
  active_membership_count integer := 0;
begin
  if new.status <> 'active' or new.membership_origin = 'represented' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select count(*)
    into active_membership_count
    from public.club_memberships membership
    where membership.athlete_profile_id = new.athlete_profile_id
      and membership.status = 'active'
      and membership.membership_origin <> 'represented'
      and membership.id <> old.id;
  else
    select count(*)
    into active_membership_count
    from public.club_memberships membership
    where membership.athlete_profile_id = new.athlete_profile_id
      and membership.status = 'active'
      and membership.membership_origin <> 'represented';
  end if;

  if active_membership_count >= 3 then
    raise exception 'You can join up to 3 clubs at the same time.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create table public.club_admin_role_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  athlete_profile_id uuid not null references public.athlete_profiles (id) on delete restrict,
  claimant_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  note text,
  submitted_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references auth.users (id) on delete set null,
  decision_note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  check (note is null or length(trim(note)) <= 1000),
  check (decision_note is null or length(trim(decision_note)) <= 2000),
  check (
    (status = 'pending' and reviewed_at is null and reviewed_by_user_id is null)
    or status = 'withdrawn'
    or (reviewed_at is not null and reviewed_by_user_id is not null)
  )
);

create unique index club_admin_role_requests_open_idx
  on public.club_admin_role_requests (club_id, claimant_user_id)
  where status = 'pending';

create index club_admin_role_requests_inbox_idx
  on public.club_admin_role_requests (status, submitted_at);

create index if not exists athlete_claims_inbox_idx
  on public.athlete_claims (status, submitted_at);

create trigger club_admin_role_requests_set_updated_at
before update on public.club_admin_role_requests
for each row execute function public.set_updated_at();

alter table public.club_admin_role_requests enable row level security;
revoke all on table public.club_admin_role_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.club_admin_role_requests to service_role;

create or replace function public.apply_represented_club_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.represented_club_id is null then
    return new;
  end if;

  insert into public.club_memberships (
    club_id,
    athlete_profile_id,
    membership_role,
    status,
    is_primary,
    joined_at,
    membership_origin
  )
  values (
    new.represented_club_id,
    new.athlete_profile_id,
    'member',
    'active',
    false,
    coalesce(new.confirmed_at, new.created_at, clock_timestamp()),
    'represented'
  )
  on conflict (club_id, athlete_profile_id)
  do update set
    membership_role = 'member',
    status = 'active',
    joined_at = coalesce(public.club_memberships.joined_at, excluded.joined_at),
    membership_origin = case
      when public.club_memberships.membership_origin = 'self_joined'
        then public.club_memberships.membership_origin
      else 'represented'
    end,
    updated_at = clock_timestamp();

  return new;
end;
$$;

drop trigger if exists registrations_apply_represented_club_membership
  on public.registrations;
create trigger registrations_apply_represented_club_membership
after insert or update of represented_club_id, athlete_profile_id
on public.registrations
for each row
when (new.represented_club_id is not null)
execute function public.apply_represented_club_membership();

insert into public.club_memberships (
  club_id,
  athlete_profile_id,
  membership_role,
  status,
  is_primary,
  joined_at,
  membership_origin
)
select
  registration.represented_club_id,
  registration.athlete_profile_id,
  'member',
  'active',
  false,
  min(coalesce(registration.confirmed_at, registration.created_at)),
  'represented'
from public.registrations registration
join public.clubs club
  on club.id = registration.represented_club_id
 and club.status = 'active'
where registration.represented_club_id is not null
group by registration.represented_club_id, registration.athlete_profile_id
on conflict (club_id, athlete_profile_id)
do update set
  membership_role = 'member',
  status = 'active',
  joined_at = coalesce(public.club_memberships.joined_at, excluded.joined_at),
  membership_origin = case
    when public.club_memberships.membership_origin = 'self_joined'
      then public.club_memberships.membership_origin
    else 'represented'
  end,
  updated_at = clock_timestamp();

create or replace function public.service_submit_athlete_profile_claim(
  p_actor_user_id uuid,
  p_athlete_profile_id uuid,
  p_evidence_json jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_profile public.user_profiles%rowtype;
  target_profile public.athlete_profiles%rowtype;
  saved_claim public.athlete_claims%rowtype;
begin
  select profile.*
  into current_profile
  from public.user_profiles profile
  where profile.user_id = p_actor_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'account_profile_not_found';
  end if;

  select athlete.*
  into target_profile
  from public.athlete_profiles athlete
  where athlete.id = p_athlete_profile_id
    and athlete.status = 'active'
    and athlete.merged_into_athlete_profile_id is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'athlete_profile_not_found';
  end if;
  if target_profile.is_claimed or target_profile.claimed_by_user_id is not null then
    raise exception using errcode = '23505', message = 'athlete_profile_already_claimed';
  end if;
  if current_profile.primary_athlete_profile_id = target_profile.id then
    raise exception using errcode = '23505', message = 'athlete_profile_already_owned';
  end if;

  insert into public.athlete_claims (
    athlete_profile_id,
    claimant_user_id,
    status,
    evidence_json,
    note
  )
  values (
    target_profile.id,
    p_actor_user_id,
    'pending',
    coalesce(p_evidence_json, '{}'::jsonb),
    nullif(trim(p_note), '')
  )
  on conflict (athlete_profile_id, claimant_user_id)
    where status in ('pending', 'approved')
  do update set
    evidence_json = public.athlete_claims.evidence_json || excluded.evidence_json,
    note = coalesce(excluded.note, public.athlete_claims.note),
    updated_at = clock_timestamp()
  returning * into saved_claim;

  return jsonb_build_object(
    'requestId', saved_claim.id,
    'athleteProfileId', saved_claim.athlete_profile_id,
    'status', saved_claim.status,
    'submittedAt', saved_claim.submitted_at
  );
end;
$$;

create or replace function public.service_submit_club_admin_role_request(
  p_actor_user_id uuid,
  p_athlete_profile_id uuid,
  p_club_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_request public.club_admin_role_requests%rowtype;
begin
  if not exists (
    select 1
    from public.user_profiles profile
    where profile.user_id = p_actor_user_id
      and profile.primary_athlete_profile_id = p_athlete_profile_id
  ) then
    raise exception using errcode = '42501', message = 'athlete_profile_access_required';
  end if;

  if not exists (
    select 1
    from public.club_memberships membership
    join public.clubs club on club.id = membership.club_id
    where membership.club_id = p_club_id
      and membership.athlete_profile_id = p_athlete_profile_id
      and membership.status = 'active'
      and membership.membership_role = 'member'
      and club.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'active_club_membership_required';
  end if;

  insert into public.club_admin_role_requests (
    club_id,
    athlete_profile_id,
    claimant_user_id,
    note
  )
  values (
    p_club_id,
    p_athlete_profile_id,
    p_actor_user_id,
    nullif(trim(p_note), '')
  )
  on conflict (club_id, claimant_user_id)
    where status = 'pending'
  do update set
    note = coalesce(excluded.note, public.club_admin_role_requests.note),
    updated_at = clock_timestamp()
  returning * into saved_request;

  return jsonb_build_object(
    'requestId', saved_request.id,
    'clubId', saved_request.club_id,
    'status', saved_request.status,
    'submittedAt', saved_request.submitted_at
  );
end;
$$;

create or replace function public.service_decide_athlete_profile_claim(
  p_actor_user_id uuid,
  p_claim_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_row public.athlete_claims%rowtype;
  target_profile public.athlete_profiles%rowtype;
  current_profile_id uuid;
  dependency record;
  has_dependency boolean;
begin
  if not public.is_active_platform_administrator(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'platform_administrator_required';
  end if;
  if p_decision not in ('approved', 'rejected') or nullif(trim(p_note), '') is null then
    raise exception using errcode = '22023', message = 'claim_decision_invalid';
  end if;

  select claim.*
  into claim_row
  from public.athlete_claims claim
  where claim.id = p_claim_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'athlete_claim_not_found';
  end if;
  if claim_row.status <> 'pending' then
    raise exception using errcode = '55000', message = 'athlete_claim_closed';
  end if;

  if p_decision = 'approved' then
    select athlete.*
    into target_profile
    from public.athlete_profiles athlete
    where athlete.id = claim_row.athlete_profile_id
    for update;

    if target_profile.is_claimed or target_profile.claimed_by_user_id is not null then
      raise exception using errcode = '23505', message = 'athlete_profile_already_claimed';
    end if;

    select profile.primary_athlete_profile_id
    into current_profile_id
    from public.user_profiles profile
    where profile.user_id = claim_row.claimant_user_id
    for update;

    if current_profile_id is not null and current_profile_id <> target_profile.id then
      for dependency in
        select
          namespace.nspname as schema_name,
          relation.relname as table_name,
          attribute.attname as column_name
        from pg_catalog.pg_constraint constraint_row
        join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
        join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = constraint_row.conkey[1]
        where constraint_row.contype = 'f'
          and constraint_row.confrelid = 'public.athlete_profiles'::regclass
          and cardinality(constraint_row.conkey) = 1
          and namespace.nspname = 'public'
          and relation.relname not in (
            'athlete_profiles',
            'athlete_identities',
            'athlete_registration_profiles',
            'profile_visibility_settings',
            'user_profiles',
            'athlete_claims'
          )
      loop
        execute format(
          'select exists (select 1 from %I.%I where %I = $1)',
          dependency.schema_name,
          dependency.table_name,
          dependency.column_name
        )
        into has_dependency
        using current_profile_id;

        if has_dependency then
          raise exception using
            errcode = '55000',
            message = 'athlete_claim_requires_manual_merge',
            detail = format('Claimant profile is referenced by %I.%I.', dependency.table_name, dependency.column_name);
        end if;
      end loop;

      update public.athlete_identities identity
      set athlete_profile_id = target_profile.id
      where identity.athlete_profile_id = current_profile_id
        and identity.user_id = claim_row.claimant_user_id;

      insert into public.athlete_registration_profiles (
        athlete_profile_id,
        phone,
        emergency_contact_name,
        emergency_contact_phone,
        shirt_size
      )
      select
        target_profile.id,
        registration_profile.phone,
        registration_profile.emergency_contact_name,
        registration_profile.emergency_contact_phone,
        registration_profile.shirt_size
      from public.athlete_registration_profiles registration_profile
      where registration_profile.athlete_profile_id = current_profile_id
      on conflict (athlete_profile_id)
      do update set
        phone = coalesce(public.athlete_registration_profiles.phone, excluded.phone),
        emergency_contact_name = coalesce(
          public.athlete_registration_profiles.emergency_contact_name,
          excluded.emergency_contact_name
        ),
        emergency_contact_phone = coalesce(
          public.athlete_registration_profiles.emergency_contact_phone,
          excluded.emergency_contact_phone
        ),
        shirt_size = coalesce(public.athlete_registration_profiles.shirt_size, excluded.shirt_size),
        updated_at = clock_timestamp();

      update public.athlete_profiles athlete
      set
        is_claimed = false,
        claimed_by_user_id = null,
        status = 'merged',
        merged_into_athlete_profile_id = target_profile.id,
        updated_at = clock_timestamp()
      where athlete.id = current_profile_id;
    end if;

    update public.athlete_profiles athlete
    set
      is_claimed = true,
      claimed_by_user_id = claim_row.claimant_user_id,
      status = 'active',
      updated_at = clock_timestamp()
    where athlete.id = target_profile.id;

    insert into public.athlete_identities (
      athlete_profile_id,
      user_id,
      identity_type,
      identity_value,
      is_verified,
      verified_at
    )
    values (
      target_profile.id,
      claim_row.claimant_user_id,
      'auth_user',
      claim_row.claimant_user_id::text,
      true,
      clock_timestamp()
    )
    on conflict (identity_type, identity_value)
    do update set
      athlete_profile_id = excluded.athlete_profile_id,
      user_id = excluded.user_id,
      is_verified = true,
      verified_at = coalesce(public.athlete_identities.verified_at, excluded.verified_at);

    update public.user_profiles profile
    set primary_athlete_profile_id = target_profile.id, updated_at = clock_timestamp()
    where profile.user_id = claim_row.claimant_user_id;
  end if;

  update public.athlete_claims claim
  set
    status = p_decision::public.athlete_claim_status,
    reviewed_at = clock_timestamp(),
    reviewed_by_user_id = p_actor_user_id,
    note = concat_ws(E'\n\n', nullif(trim(claim.note), ''), trim(p_note)),
    updated_at = clock_timestamp()
  where claim.id = claim_row.id;

  return jsonb_build_object('requestId', claim_row.id, 'status', p_decision);
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
  club_row public.clubs%rowtype;
  organization_slug_base text;
  organization_slug_candidate text;
  suffix integer := 0;
  resolved_organization_id uuid;
begin
  if not public.is_active_platform_administrator(p_actor_user_id) then
    raise exception using errcode = '42501', message = 'platform_administrator_required';
  end if;
  if p_decision not in ('approved', 'rejected') or nullif(trim(p_note), '') is null then
    raise exception using errcode = '22023', message = 'club_admin_decision_invalid';
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

  if p_decision = 'approved' then
    select club.* into club_row
    from public.clubs club
    where club.id = request_row.club_id
    for update;

    resolved_organization_id := club_row.organization_id;
    if resolved_organization_id is null then
      organization_slug_base := coalesce(nullif(trim(club_row.slug), ''), 'club');
      organization_slug_candidate := organization_slug_base;
      while exists (select 1 from public.organizations organization where organization.slug = organization_slug_candidate) loop
        suffix := suffix + 1;
        organization_slug_candidate := format('%s-club-%s', organization_slug_base, suffix);
      end loop;

      insert into public.organizations (
        slug, name, country_code, region, contact_email, status, kind
      ) values (
        organization_slug_candidate,
        club_row.name,
        club_row.country_code,
        coalesce(club_row.region, club_row.city),
        club_row.contact_email,
        'active',
        'club'
      ) returning id into resolved_organization_id;

      update public.clubs club
      set organization_id = resolved_organization_id, updated_at = clock_timestamp()
      where club.id = club_row.id;
    end if;

    insert into public.organization_memberships (
      organization_id,
      user_id,
      role,
      status,
      invited_by_user_id,
      joined_at,
      membership_type,
      permission_keys,
      created_by_user_id,
      account_template_key
    ) values (
      resolved_organization_id,
      request_row.claimant_user_id,
      'admin',
      'active',
      p_actor_user_id,
      clock_timestamp(),
      'permanent',
      array[
        'organization.manage', 'team.manage', 'events.manage', 'entrants.manage',
        'race_day.manage', 'checkpoint_timing.enter', 'results.manage',
        'communications.manage', 'safety.manage', 'logistics.manage', 'finance.manage'
      ]::text[],
      p_actor_user_id,
      'organization-admin'
    )
    on conflict (organization_id, user_id)
    do update set
      role = 'admin',
      status = 'active',
      membership_type = 'permanent',
      permission_keys = excluded.permission_keys,
      account_template_key = 'organization-admin',
      expires_at = null,
      updated_at = clock_timestamp();
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
    'organizationId', resolved_organization_id
  );
end;
$$;

create or replace function public.service_join_club(
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
  target_club public.clubs%rowtype;
  target_status public.club_membership_status;
  saved_membership public.club_memberships%rowtype;
  active_membership_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_athlete_profile_id::text, 901));

  select club.* into target_club
  from public.clubs club
  where club.id = p_club_id and club.status = 'active';
  if not found then
    raise exception 'Club not found' using errcode = 'P0002';
  end if;
  if coalesce(target_club.privacy_level, 'public') = 'invite_only' then
    raise exception 'This club is invite only' using errcode = '42501';
  end if;

  target_status := case
    when coalesce(target_club.privacy_level, 'public') = 'public'
      and not coalesce(target_club.requires_approval, false)
      then 'active'::public.club_membership_status
    else 'pending'::public.club_membership_status
  end;

  if target_status = 'active'::public.club_membership_status then
    select count(*) into active_membership_count
    from public.club_memberships membership
    where membership.athlete_profile_id = p_athlete_profile_id
      and membership.status = 'active'::public.club_membership_status
      and membership.membership_origin <> 'represented'
      and membership.club_id <> p_club_id;
    if active_membership_count >= 3 then
      raise exception 'You can join up to 3 clubs at the same time.' using errcode = 'P0001';
    end if;
  end if;

  insert into public.club_memberships (
    club_id, athlete_profile_id, status, joined_at, membership_origin
  ) values (
    p_club_id,
    p_athlete_profile_id,
    target_status,
    case when target_status = 'active' then now() else null end,
    'self_joined'
  )
  on conflict (club_id, athlete_profile_id)
  do update set
    status = excluded.status,
    joined_at = excluded.joined_at,
    membership_origin = case
      when public.club_memberships.membership_origin = 'represented'
        then public.club_memberships.membership_origin
      else 'self_joined'
    end,
    updated_at = now()
  returning * into saved_membership;

  insert into public.audit_log (
    actor_user_id, entity_type, entity_id, action, metadata_json
  ) values (
    p_actor_user_id,
    'club_membership',
    saved_membership.id,
    case when target_status = 'active' then 'athlete.club.joined' else 'athlete.club.requested' end,
    jsonb_build_object('club_id', p_club_id, 'status', target_status)
  );

  return jsonb_build_object(
    'membershipId', saved_membership.id,
    'clubId', p_club_id,
    'status', target_status,
    'changed', true
  );
end;
$$;

revoke all on function public.apply_represented_club_membership()
  from public, anon, authenticated;
revoke all on function public.service_submit_athlete_profile_claim(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.service_submit_club_admin_role_request(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.service_decide_athlete_profile_claim(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.service_decide_club_admin_role_request(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.service_join_club(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.apply_represented_club_membership() to service_role;
grant execute on function public.service_submit_athlete_profile_claim(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.service_submit_club_admin_role_request(uuid, uuid, uuid, text) to service_role;
grant execute on function public.service_decide_athlete_profile_claim(uuid, uuid, text, text) to service_role;
grant execute on function public.service_decide_club_admin_role_request(uuid, uuid, text, text) to service_role;
grant execute on function public.service_join_club(uuid, uuid, uuid) to service_role;

comment on table public.club_admin_role_requests is
  'Member requests for governed club administrator access, reviewed by site administrators.';
comment on column public.club_memberships.membership_origin is
  'How the regular membership was established. Race representation is membership evidence, never administrator authority.';

commit;
