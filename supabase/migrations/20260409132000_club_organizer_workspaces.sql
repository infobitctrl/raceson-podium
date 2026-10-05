begin;

alter table public.organizations
  add column if not exists kind text not null default 'organizer';

update public.organizations
set kind = 'organizer'
where kind is null
   or btrim(kind) = '';

alter table public.organizations
  drop constraint if exists organizations_kind_check;

alter table public.organizations
  add constraint organizations_kind_check
  check (kind in ('organizer', 'club'));

alter table public.clubs
  add column if not exists organization_id uuid references public.organizations (id) on delete set null;

create unique index if not exists clubs_organization_id_unique_idx
  on public.clubs (organization_id)
  where organization_id is not null;

drop policy if exists clubs_insert_creator on public.clubs;

create policy clubs_insert_creator
on public.clubs
for insert
with check (
  created_by_athlete_profile_id is not null
  and public.user_can_access_athlete_profile(created_by_athlete_profile_id)
  and (organization_id is null or public.can_manage_organization(organization_id))
);

drop policy if exists clubs_update_creator on public.clubs;

create policy clubs_update_creator
on public.clubs
for update
using (public.can_manage_club(id))
with check (
  created_by_athlete_profile_id is not null
  and public.user_can_access_athlete_profile(created_by_athlete_profile_id)
  and (organization_id is null or public.can_manage_organization(organization_id))
);

create or replace function public.create_current_user_club(
  club_slug text,
  club_name text,
  club_country_code text,
  club_city text,
  club_description text,
  president_name text,
  founded_year integer default null,
  main_sport text default null,
  club_type text default null,
  officially_registered boolean default false,
  website_url text default null,
  instagram_url text default null,
  facebook_url text default null,
  contact_email text default null,
  contact_phone text default null,
  training_days text[] default '{}'::text[],
  has_regular_training boolean default true,
  training_location text default null,
  training_note text default null,
  privacy_level text default 'public',
  requires_approval boolean default false,
  icon_key text default 'mountain',
  color_key text default 'primary',
  logo_image_url text default null,
  cover_image_url text default null,
  create_organizer_workspace boolean default false,
  workspace_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := public.request_user_id();
  auth_user_row auth.users%rowtype;
  current_profile public.user_profiles%rowtype;
  current_athlete_profile_id uuid;
  active_membership_count integer := 0;
  organization_slug_base text;
  organization_slug_candidate text;
  organization_slug_suffix integer := 0;
  next_organization_id uuid := null;
  next_club_id uuid;
  next_contact_email citext;
  next_workspace_name text;
  next_requested_roles text[] := array[]::text[];
  next_default_role text;
  next_member_status public.club_membership_status;
begin
  if current_user_id is null then
    raise exception 'Authenticated user required'
      using errcode = '42501';
  end if;

  select *
  into auth_user_row
  from auth.users
  where id = current_user_id;

  if not found then
    raise exception 'Auth user % not found', current_user_id
      using errcode = 'P0001';
  end if;

  select *
  into current_profile
  from public.user_profiles
  where user_id = current_user_id;

  if not found then
    raise exception 'Create your account profile before creating a club.'
      using errcode = 'P0001';
  end if;

  current_athlete_profile_id := current_profile.primary_athlete_profile_id;

  if current_athlete_profile_id is null then
    raise exception 'This account needs an athlete profile before creating a club.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.clubs
    where slug = club_slug
  ) then
    raise exception 'Club handle is already taken.'
      using errcode = '23505';
  end if;

  select count(*)
  into active_membership_count
  from public.club_memberships
  where athlete_profile_id = current_athlete_profile_id
    and status = 'active';

  if active_membership_count >= 3 then
    raise exception 'You can only be in 3 clubs at the same time.'
      using errcode = 'P0001';
  end if;

  next_contact_email := coalesce(
    nullif(trim(contact_email), '')::citext,
    nullif(trim(auth_user_row.email), '')::citext
  );

  if create_organizer_workspace then
    organization_slug_base := nullif(trim(club_slug), '');
    if organization_slug_base is null then
      raise exception 'Club handle is required to create the linked organizer workspace.'
        using errcode = 'P0001';
    end if;

    organization_slug_candidate := organization_slug_base;
    while exists (
      select 1
      from public.organizations
      where slug = organization_slug_candidate
    ) loop
      organization_slug_suffix := organization_slug_suffix + 1;
      organization_slug_candidate := format(
        '%s-club%s',
        organization_slug_base,
        case
          when organization_slug_suffix = 1 then ''
          else format('-%s', organization_slug_suffix)
        end
      );
    end loop;

    next_workspace_name := coalesce(nullif(trim(workspace_name), ''), nullif(trim(club_name), ''));
    if next_workspace_name is null then
      next_workspace_name := 'Club workspace';
    end if;

    insert into public.organizations (
      slug,
      name,
      legal_name,
      country_code,
      region,
      contact_email,
      status,
      kind
    )
    values (
      organization_slug_candidate,
      next_workspace_name,
      case when officially_registered then nullif(trim(club_name), '') else null end,
      nullif(trim(upper(club_country_code)), ''),
      nullif(trim(club_city), ''),
      next_contact_email,
      'active',
      'club'
    )
    returning id
    into next_organization_id;

    insert into public.organization_memberships (
      organization_id,
      user_id,
      role,
      status,
      invited_by_user_id,
      joined_at
    )
    values (
      next_organization_id,
      current_user_id,
      'owner',
      'active',
      null,
      now()
    );

    next_requested_roles := coalesce(
      array(
        select jsonb_array_elements_text(
          coalesce(current_profile.preferences_json -> 'requested_roles', '[]'::jsonb)
        )
      ),
      array[]::text[]
    );

    if not ('athlete' = any(next_requested_roles)) then
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

    next_default_role := case
      when coalesce(current_profile.preferences_json ->> 'default_role', '') = 'timer' then 'timer'
      else 'organizer'
    end;

    update public.user_profiles
    set
      preferences_json = coalesce(preferences_json, '{}'::jsonb)
        || jsonb_build_object(
          'requested_roles', to_jsonb(next_requested_roles),
          'default_role', next_default_role
        ),
      updated_at = now()
    where user_id = current_user_id
    returning *
    into current_profile;
  end if;

  next_member_status := case
    when coalesce(nullif(trim(privacy_level), ''), 'public') = 'public' and not requires_approval
      then 'active'::public.club_membership_status
    else 'pending'::public.club_membership_status
  end;

  insert into public.clubs (
    slug,
    name,
    country_code,
    city,
    description,
    created_by_athlete_profile_id,
    organization_id,
    president_name,
    founded_year,
    main_sport,
    club_type,
    officially_registered,
    website_url,
    instagram_url,
    facebook_url,
    contact_email,
    contact_phone,
    training_days,
    has_regular_training,
    training_location,
    training_note,
    privacy_level,
    requires_approval,
    icon_key,
    color_key,
    logo_image_url,
    cover_image_url
  )
  values (
    club_slug,
    club_name,
    nullif(trim(upper(club_country_code)), ''),
    nullif(trim(club_city), ''),
    nullif(trim(club_description), ''),
    current_athlete_profile_id,
    next_organization_id,
    nullif(trim(president_name), ''),
    founded_year,
    nullif(trim(main_sport), ''),
    nullif(trim(club_type), ''),
    coalesce(officially_registered, false),
    nullif(trim(website_url), ''),
    nullif(trim(instagram_url), ''),
    nullif(trim(facebook_url), ''),
    next_contact_email::text,
    nullif(trim(contact_phone), ''),
    coalesce(training_days, '{}'::text[]),
    coalesce(has_regular_training, true),
    nullif(trim(training_location), ''),
    nullif(trim(training_note), ''),
    coalesce(nullif(trim(privacy_level), ''), 'public'),
    coalesce(requires_approval, false),
    coalesce(nullif(trim(icon_key), ''), 'mountain'),
    coalesce(nullif(trim(color_key), ''), 'primary'),
    nullif(trim(logo_image_url), ''),
    nullif(trim(cover_image_url), '')
  )
  returning id
  into next_club_id;

  insert into public.club_memberships (
    club_id,
    athlete_profile_id,
    membership_role,
    status,
    is_primary,
    joined_at
  )
  values (
    next_club_id,
    current_athlete_profile_id,
    'member',
    next_member_status,
    false,
    case
      when next_member_status = 'active'::public.club_membership_status then now()
      else null
    end
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
    next_contact_email,
    'club_created',
    'success',
    jsonb_build_object(
      'club_id', next_club_id,
      'club_slug', club_slug,
      'workspace_created', create_organizer_workspace,
      'organization_id', next_organization_id
    )
  );

  return jsonb_build_object(
    'club_id', next_club_id,
    'club_slug', club_slug,
    'organization_id', next_organization_id,
    'organization_slug',
      case
        when next_organization_id is null then null
        else (select slug from public.organizations where id = next_organization_id)
      end,
    'workspace_created', create_organizer_workspace and next_organization_id is not null
  );
end;
$$;

revoke all on function public.create_current_user_club(
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text,
  text[],
  boolean,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  boolean,
  text
) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.create_current_user_club(
      text,
      text,
      text,
      text,
      text,
      text,
      integer,
      text,
      text,
      boolean,
      text,
      text,
      text,
      text,
      text,
      text[],
      boolean,
      text,
      text,
      text,
      boolean,
      text,
      text,
      text,
      text,
      boolean,
      text
    ) to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.create_current_user_club(
      text,
      text,
      text,
      text,
      text,
      text,
      integer,
      text,
      text,
      boolean,
      text,
      text,
      text,
      text,
      text,
      text[],
      boolean,
      text,
      text,
      text,
      boolean,
      text,
      text,
      text,
      text,
      boolean,
      text
    ) to service_role;
  end if;
end;
$$;

commit;
