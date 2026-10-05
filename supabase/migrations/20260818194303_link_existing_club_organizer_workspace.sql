begin;

create or replace function public.create_current_user_club_organizer_workspace(
  target_club_id uuid,
  workspace_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := public.request_user_id();
  current_auth_user auth.users%rowtype;
  current_profile public.user_profiles%rowtype;
  target_club public.clubs%rowtype;
  linked_organization public.organizations%rowtype;
  organization_slug_base text;
  organization_slug_candidate text;
  organization_slug_suffix integer := 0;
  resolved_workspace_name text;
  requested_roles text[];
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authenticated_user_required';
  end if;

  select auth_user.*
  into current_auth_user
  from auth.users auth_user
  where auth_user.id = current_user_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'auth_user_not_found';
  end if;

  if current_auth_user.email_confirmed_at is null then
    raise exception using
      errcode = '42501',
      message = 'email_verification_required';
  end if;

  select club.*
  into target_club
  from public.clubs club
  where club.id = target_club_id
    and club.status = 'active'
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'club_not_found';
  end if;

  if not exists (
    select 1
    from public.user_profiles profile
    join public.club_memberships membership
      on membership.athlete_profile_id = profile.primary_athlete_profile_id
    join public.club_roles role
      on role.id = membership.club_role_id
     and role.club_id = membership.club_id
    where profile.user_id = current_user_id
      and membership.club_id = target_club.id
      and membership.status = 'active'
      and role.is_owner
      and role.status = 'active'
  ) then
    raise exception using
      errcode = '42501',
      message = 'club_owner_required';
  end if;

  if target_club.organization_id is not null then
    select organization.*
    into linked_organization
    from public.organizations organization
    where organization.id = target_club.organization_id;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'linked_organization_not_found';
    end if;

    return jsonb_build_object(
      'club_id', target_club.id,
      'club_slug', target_club.slug,
      'organization_id', linked_organization.id,
      'organization_slug', linked_organization.slug,
      'organization_name', linked_organization.name,
      'workspace_created', false
    );
  end if;

  resolved_workspace_name := coalesce(
    nullif(btrim(workspace_name), ''),
    nullif(btrim(target_club.name), '')
  );

  if resolved_workspace_name is null
     or char_length(resolved_workspace_name) < 2
     or char_length(resolved_workspace_name) > 160 then
    raise exception using
      errcode = '22023',
      message = 'workspace_name_invalid';
  end if;

  organization_slug_base := nullif(btrim(target_club.slug), '');
  if organization_slug_base is null then
    organization_slug_base := 'club-' || left(replace(target_club.id::text, '-', ''), 8);
  end if;

  organization_slug_candidate := left(organization_slug_base, 80);
  while exists (
    select 1
    from public.organizations organization
    where organization.slug = organization_slug_candidate
  ) loop
    organization_slug_suffix := organization_slug_suffix + 1;
    organization_slug_candidate := left(
      organization_slug_base,
      greatest(1, 75 - char_length(organization_slug_suffix::text))
    ) || '-club-' || organization_slug_suffix::text;
  end loop;

  insert into public.organizations (
    slug,
    name,
    legal_name,
    country_code,
    region,
    city,
    description,
    contact_email,
    contact_phone,
    website_url,
    logo_image_url,
    status,
    kind
  )
  values (
    organization_slug_candidate,
    resolved_workspace_name,
    case when target_club.officially_registered then target_club.name else null end,
    target_club.country_code,
    target_club.region,
    target_club.city,
    target_club.description,
    coalesce(target_club.contact_email, nullif(btrim(current_auth_user.email), '')::citext),
    target_club.contact_phone,
    target_club.website_url,
    target_club.logo_image_url,
    'active',
    'club'
  )
  returning *
  into linked_organization;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    status,
    invited_by_user_id,
    joined_at
  )
  values (
    linked_organization.id,
    current_user_id,
    'owner',
    'active',
    null,
    clock_timestamp()
  );

  update public.clubs club
  set
    organization_id = linked_organization.id,
    updated_at = clock_timestamp()
  where club.id = target_club.id
    and club.organization_id is null;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'club_workspace_link_changed';
  end if;

  select profile.*
  into current_profile
  from public.user_profiles profile
  where profile.user_id = current_user_id;

  if found then
    requested_roles := case
      when jsonb_typeof(current_profile.preferences_json -> 'requested_roles') = 'array' then
        array(
          select jsonb_array_elements_text(current_profile.preferences_json -> 'requested_roles')
        )
      else array[]::text[]
    end;

    if current_profile.primary_athlete_profile_id is not null
       and not ('athlete' = any(requested_roles)) then
      requested_roles := array_append(requested_roles, 'athlete');
    end if;
    if not ('organizer' = any(requested_roles)) then
      requested_roles := array_append(requested_roles, 'organizer');
    end if;

    requested_roles := array(
      select distinct role_name
      from unnest(requested_roles) role_name
      where nullif(btrim(role_name), '') is not null
    );

    update public.user_profiles profile
    set
      preferences_json = coalesce(profile.preferences_json, '{}'::jsonb)
        || jsonb_build_object('requested_roles', to_jsonb(requested_roles)),
      updated_at = clock_timestamp()
    where profile.user_id = current_user_id;

    update auth.users auth_user
    set
      raw_user_meta_data = coalesce(auth_user.raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object('requested_roles', to_jsonb(requested_roles)),
      updated_at = clock_timestamp()
    where auth_user.id = current_user_id;
  end if;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    linked_organization.id,
    current_user_id,
    'club',
    target_club.id,
    'club.organizer_workspace.created',
    jsonb_build_object(
      'club_id', target_club.id,
      'organization_id', linked_organization.id
    )
  );

  insert into public.auth_security_events (
    user_id,
    email,
    event_type,
    event_status,
    metadata_json
  )
  values (
    current_user_id,
    nullif(btrim(current_auth_user.email), '')::citext,
    'club_organizer_workspace_created',
    'success',
    jsonb_build_object(
      'club_id', target_club.id,
      'club_slug', target_club.slug,
      'organization_id', linked_organization.id
    )
  );

  return jsonb_build_object(
    'club_id', target_club.id,
    'club_slug', target_club.slug,
    'organization_id', linked_organization.id,
    'organization_slug', linked_organization.slug,
    'organization_name', linked_organization.name,
    'workspace_created', true
  );
end;
$$;

revoke all on function public.create_current_user_club_organizer_workspace(uuid, text)
  from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.create_current_user_club_organizer_workspace(uuid, text)
      from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.create_current_user_club_organizer_workspace(uuid, text)
      to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.create_current_user_club_organizer_workspace(uuid, text)
      to service_role;
  end if;
end
$$;

comment on function public.create_current_user_club_organizer_workspace(uuid, text) is
  'Creates the one club-backed organizer workspace for an existing club; callable only by its verified active owner.';

commit;
