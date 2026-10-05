begin;

/*
 * Organization access is granted by organization_memberships and event staff
 * assignments, independently from a user's personal athlete profile. A person
 * can therefore be both an athlete and an organizer. The former exclusivity
 * constraint predates that authorization model and rejects otherwise unrelated
 * account updates (for example, saving an avatar) for those users.
 */
alter table public.user_profiles
  drop constraint if exists user_profiles_account_type_exclusive;

/*
 * Keep organizer workspace creation on the same multi-role account model. The
 * earlier implementation treated default_role as an account-type boundary and
 * replaced requested_roles with an organizer-only array after creating a
 * workspace. That could reject, or silently strip metadata from, an athlete who
 * also enabled organizer access.
 */
create or replace function public.create_current_user_organizer_workspace(
  workspace_name text,
  workspace_country_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := public.request_user_id();
  current_profile public.user_profiles%rowtype;
  current_auth_user auth.users%rowtype;
  existing_organization public.organizations%rowtype;
  next_organization public.organizations%rowtype;
  slug_base text;
  slug_candidate text;
  slug_suffix integer := 0;
  normalized_country_code text;
  account_default_role text;
  account_requested_roles text[];
  next_requested_roles text[];
begin
  if current_user_id is null then
    raise exception 'Authenticated user required'
      using errcode = '42501';
  end if;

  select *
  into current_profile
  from public.user_profiles
  where user_id = current_user_id;

  if not found then
    raise exception 'Complete account setup before creating an organizer workspace.'
      using errcode = 'P0001';
  end if;

  account_default_role := nullif(trim(current_profile.preferences_json ->> 'default_role'), '');
  account_requested_roles := case
    when jsonb_typeof(current_profile.preferences_json -> 'requested_roles') = 'array' then
      array(
        select jsonb_array_elements_text(current_profile.preferences_json -> 'requested_roles')
      )
    else array[]::text[]
  end;

  if not ('organizer' = any(account_requested_roles))
    and coalesce(account_default_role, '') not in ('organizer', 'timer') then
    raise exception 'Enable organizer access in Account before creating an organization.'
      using errcode = '42501';
  end if;

  select organization.*
  into existing_organization
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
  where membership.user_id = current_user_id
    and membership.status = 'active'
  order by membership.joined_at nulls last, membership.created_at
  limit 1;

  if found then
    return jsonb_build_object(
      'organization_id', existing_organization.id,
      'organization_slug', existing_organization.slug,
      'workspace_created', false
    );
  end if;

  select *
  into current_auth_user
  from auth.users
  where id = current_user_id;

  if not found then
    raise exception 'Auth user not found'
      using errcode = 'P0001';
  end if;

  if current_auth_user.email_confirmed_at is null then
    raise exception 'Verify your email before creating an organizer workspace.'
      using errcode = '42501';
  end if;

  if nullif(trim(workspace_name), '') is null then
    raise exception 'Organization name is required.'
      using errcode = '22023';
  end if;

  normalized_country_code := nullif(trim(upper(workspace_country_code)), '');
  if normalized_country_code is not null and normalized_country_code !~ '^[A-Z]{2}$' then
    raise exception 'Country code must contain exactly two letters.'
      using errcode = '22023';
  end if;

  slug_base := trim(both '-' from regexp_replace(lower(trim(workspace_name)), '[^a-z0-9]+', '-', 'g'));
  if slug_base = '' then
    slug_base := 'organization-' || left(replace(current_user_id::text, '-', ''), 8);
  end if;
  slug_candidate := left(slug_base, 80);

  while exists (
    select 1
    from public.organizations
    where slug = slug_candidate
  ) loop
    slug_suffix := slug_suffix + 1;
    slug_candidate := left(slug_base, greatest(1, 76 - length(slug_suffix::text)))
      || '-' || slug_suffix::text;
  end loop;

  insert into public.organizations (
    slug,
    name,
    country_code,
    contact_email,
    status,
    kind
  )
  values (
    slug_candidate,
    trim(workspace_name),
    normalized_country_code,
    nullif(trim(current_auth_user.email), '')::citext,
    'active',
    'organizer'
  )
  returning *
  into next_organization;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    status,
    invited_by_user_id,
    joined_at
  )
  values (
    next_organization.id,
    current_user_id,
    'owner',
    'active',
    null,
    now()
  );

  next_requested_roles := account_requested_roles;

  if current_profile.primary_athlete_profile_id is not null
    and not ('athlete' = any(next_requested_roles)) then
    next_requested_roles := array_append(next_requested_roles, 'athlete');
  end if;

  if not ('organizer' = any(next_requested_roles)) then
    next_requested_roles := array_append(next_requested_roles, 'organizer');
  end if;

  next_requested_roles := array(
    select distinct role_name
    from unnest(next_requested_roles) as role_name
    where nullif(trim(role_name), '') is not null
  );

  update public.user_profiles
  set
    preferences_json = coalesce(preferences_json, '{}'::jsonb)
      || jsonb_build_object(
        'default_role', 'organizer',
        'requested_roles', to_jsonb(next_requested_roles)
      ),
    updated_at = now()
  where user_id = current_user_id;

  update auth.users
  set
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object(
        'default_role', 'organizer',
        'requested_roles', to_jsonb(next_requested_roles)
      ),
    updated_at = now()
  where id = current_user_id;

  return jsonb_build_object(
    'organization_id', next_organization.id,
    'organization_slug', next_organization.slug,
    'workspace_created', true
  );
end;
$$;

revoke all on function public.create_current_user_organizer_workspace(text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.create_current_user_organizer_workspace(text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.create_current_user_organizer_workspace(text, text) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.create_current_user_organizer_workspace(text, text) to service_role;
  end if;
end
$$;

commit;
