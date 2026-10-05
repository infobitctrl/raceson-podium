begin;

-- Clubs and organizer organizations are independent domains. Preserve every
-- existing record, but remove the runtime association and prevent it from
-- being recreated by legacy functions.
update public.organizations organization
set
  kind = 'organizer',
  updated_at = clock_timestamp()
where organization.kind = 'club'
  and exists (
    select 1
    from public.clubs club
    where club.organization_id = organization.id
  );

update public.clubs
set
  organization_id = null,
  updated_at = clock_timestamp()
where organization_id is not null;

drop index if exists public.clubs_organization_id_unique_idx;

drop policy if exists clubs_insert_creator on public.clubs;
create policy clubs_insert_creator
on public.clubs
for insert
with check (
  created_by_athlete_profile_id is not null
  and public.user_can_access_athlete_profile(created_by_athlete_profile_id)
  and organization_id is null
);

drop policy if exists clubs_update_creator on public.clubs;
create policy clubs_update_creator
on public.clubs
for update
using (public.can_manage_club(id))
with check (
  created_by_athlete_profile_id is not null
  and public.can_manage_club(id)
  and organization_id is null
);

drop function if exists public.club_organization_association_is_unchanged(uuid, uuid);
drop function if exists public.create_current_user_club_organizer_workspace(uuid, text);

alter table public.clubs
  drop constraint if exists clubs_organization_id_must_be_null,
  add constraint clubs_organization_id_must_be_null
    check (organization_id is null) not valid;

alter table public.clubs
  validate constraint clubs_organization_id_must_be_null;

comment on column public.clubs.organization_id is
  'Deprecated compatibility column. Clubs and organizer organizations are independent; this value must remain null.';

-- Keep a durable creation key so a network retry can return the committed club
-- instead of reporting a duplicate or creating a second identity.
create table public.club_creation_requests (
  user_id uuid not null references auth.users (id) on delete cascade,
  idempotency_key uuid not null,
  club_id uuid not null unique references public.clubs (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, idempotency_key)
);

alter table public.club_creation_requests enable row level security;
revoke all on table public.club_creation_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.club_creation_requests to service_role;

create or replace function public.create_current_user_club_v3(
  club_slug text,
  club_name text,
  club_country_code text,
  club_city text,
  club_description text,
  president_name text,
  selected_sport_codes text[],
  selected_primary_sport_code text,
  creation_idempotency_key uuid,
  founded_year integer default null,
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
  club_region text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := public.request_user_id();
  existing_club public.clubs%rowtype;
  created_club jsonb;
  created_club_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authenticated_user_required';
  end if;

  if creation_idempotency_key is null then
    raise exception using errcode = '22023', message = 'club_creation_idempotency_key_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text || ':' || creation_idempotency_key::text, 0)
  );

  select club.*
  into existing_club
  from public.club_creation_requests request_item
  join public.clubs club on club.id = request_item.club_id
  where request_item.user_id = current_user_id
    and request_item.idempotency_key = creation_idempotency_key;

  if found then
    return jsonb_build_object(
      'club_id', existing_club.id,
      'club_slug', existing_club.slug,
      'idempotent_replay', true
    );
  end if;

  created_club := public.create_current_user_club_v2(
    club_slug => club_slug,
    club_name => club_name,
    club_country_code => club_country_code,
    club_city => club_city,
    club_description => club_description,
    president_name => president_name,
    founded_year => founded_year,
    main_sport => selected_primary_sport_code,
    club_type => club_type,
    officially_registered => officially_registered,
    website_url => website_url,
    instagram_url => instagram_url,
    facebook_url => facebook_url,
    contact_email => contact_email,
    contact_phone => contact_phone,
    training_days => training_days,
    has_regular_training => has_regular_training,
    training_location => training_location,
    training_note => training_note,
    privacy_level => privacy_level,
    requires_approval => requires_approval,
    icon_key => icon_key,
    color_key => color_key,
    logo_image_url => logo_image_url,
    cover_image_url => cover_image_url,
    create_organizer_workspace => false,
    workspace_name => null,
    club_region => club_region
  );

  created_club_id := nullif(created_club ->> 'club_id', '')::uuid;
  if created_club_id is null then
    raise exception using errcode = 'P0001', message = 'club_creation_result_invalid';
  end if;

  perform public.service_set_club_sports(
    created_club_id,
    selected_sport_codes,
    selected_primary_sport_code
  );

  insert into public.club_creation_requests (user_id, idempotency_key, club_id)
  values (current_user_id, creation_idempotency_key, created_club_id);

  update public.auth_security_events security_event
  set metadata_json = coalesce(security_event.metadata_json, '{}'::jsonb)
    - 'workspace_created'
    - 'organization_id'
    || jsonb_build_object('idempotency_key', creation_idempotency_key)
  where security_event.user_id = current_user_id
    and security_event.event_type = 'club_created'
    and security_event.metadata_json ->> 'club_id' = created_club_id::text;

  return jsonb_build_object(
    'club_id', created_club_id,
    'club_slug', created_club ->> 'club_slug',
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.create_current_user_club_v3(
  text, text, text, text, text, text, text[], text, uuid, integer, text,
  boolean, text, text, text, text, text, text[], boolean, text, text, text,
  boolean, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_current_user_club_v3(
  text, text, text, text, text, text, text[], text, uuid, integer, text,
  boolean, text, text, text, text, text, text[], boolean, text, text, text,
  boolean, text, text, text, text, text
) to authenticated, service_role;

-- Legacy club creation remains an internal implementation detail for v3.
-- Revoking Data API execution also makes the old linked-workspace arguments
-- unreachable to application clients.
do $$
declare
  target_function regprocedure;
begin
  for target_function in
    select procedure.oid::regprocedure
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in ('create_current_user_club', 'create_current_user_club_v2')
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      target_function
    );
  end loop;
end;
$$;

-- Club profile, sport selection, and audit rows are one transaction. The
-- caller is the server-only service role, but actor authorization is repeated
-- here to protect the database command from accidental misuse.
create or replace function public.service_update_club_profile_v2(
  p_actor_user_id uuid,
  p_club_id uuid,
  p_profile jsonb,
  p_settings jsonb,
  p_selected_sport_codes text[],
  p_selected_primary_sport_code text,
  p_profile_changed boolean,
  p_settings_changed boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_club public.clubs%rowtype;
  updated_club public.clubs%rowtype;
  actor_permissions text[] := '{}'::text[];
  actor_is_platform_administrator boolean := false;
begin
  if p_actor_user_id is null then
    raise exception using errcode = '42501', message = 'club_actor_required';
  end if;

  select club.*
  into target_club
  from public.clubs club
  where club.id = p_club_id
    and club.status = 'active'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'club_not_found';
  end if;

  actor_is_platform_administrator := public.is_active_platform_administrator(p_actor_user_id);

  select coalesce(role.permission_keys, '{}'::text[])
  into actor_permissions
  from public.user_profiles profile
  join public.club_memberships membership
    on membership.athlete_profile_id = profile.primary_athlete_profile_id
   and membership.club_id = target_club.id
   and membership.status = 'active'
  join public.club_roles role
    on role.id = membership.club_role_id
   and role.club_id = membership.club_id
   and role.status = 'active'
  where profile.user_id = p_actor_user_id;

  actor_permissions := coalesce(actor_permissions, '{}'::text[]);

  if p_profile_changed
     and not actor_is_platform_administrator
     and not ('club.profile.manage' = any(actor_permissions)) then
    raise exception using errcode = '42501', message = 'club_profile_permission_required';
  end if;

  if p_settings_changed
     and not actor_is_platform_administrator
     and not ('club.settings.manage' = any(actor_permissions)) then
    raise exception using errcode = '42501', message = 'club_settings_permission_required';
  end if;

  update public.clubs club
  set
    name = p_profile ->> 'name',
    country_code = nullif(upper(btrim(p_profile ->> 'country_code')), ''),
    region = nullif(btrim(p_profile ->> 'region'), ''),
    city = nullif(btrim(p_profile ->> 'city'), ''),
    description = nullif(btrim(p_profile ->> 'description'), ''),
    president_name = nullif(btrim(p_profile ->> 'president_name'), ''),
    founded_year = nullif(p_profile ->> 'founded_year', '')::integer,
    main_sport = nullif(btrim(p_profile ->> 'main_sport'), ''),
    club_type = nullif(btrim(p_profile ->> 'club_type'), ''),
    officially_registered = coalesce((p_profile ->> 'officially_registered')::boolean, false),
    website_url = nullif(btrim(p_profile ->> 'website_url'), ''),
    instagram_url = nullif(btrim(p_profile ->> 'instagram_url'), ''),
    facebook_url = nullif(btrim(p_profile ->> 'facebook_url'), ''),
    contact_email = nullif(btrim(p_profile ->> 'contact_email'), ''),
    contact_phone = nullif(btrim(p_profile ->> 'contact_phone'), ''),
    training_days = coalesce(
      array(select jsonb_array_elements_text(p_profile -> 'training_days')),
      '{}'::text[]
    ),
    has_regular_training = coalesce((p_profile ->> 'has_regular_training')::boolean, false),
    training_location = nullif(btrim(p_profile ->> 'training_location'), ''),
    training_note = nullif(btrim(p_profile ->> 'training_note'), ''),
    icon_key = coalesce(nullif(btrim(p_profile ->> 'icon_key'), ''), 'mountain'),
    color_key = coalesce(nullif(btrim(p_profile ->> 'color_key'), ''), 'primary'),
    logo_image_url = case
      when p_profile ? 'logo_image_url' then nullif(btrim(p_profile ->> 'logo_image_url'), '')
      else club.logo_image_url
    end,
    cover_image_url = case
      when p_profile ? 'cover_image_url' then nullif(btrim(p_profile ->> 'cover_image_url'), '')
      else club.cover_image_url
    end,
    privacy_level = coalesce(nullif(btrim(p_settings ->> 'privacy_level'), ''), 'public'),
    requires_approval = coalesce((p_settings ->> 'requires_approval')::boolean, false),
    organization_id = null,
    updated_at = clock_timestamp()
  where club.id = target_club.id;

  perform public.service_set_club_sports(
    target_club.id,
    p_selected_sport_codes,
    p_selected_primary_sport_code
  );

  if p_profile_changed then
    insert into public.audit_log (
      actor_user_id, entity_type, entity_id, action, metadata_json
    ) values (
      p_actor_user_id,
      'club',
      target_club.id,
      'club.profile.updated',
      jsonb_build_object('club_id', target_club.id)
    );
  end if;

  if p_settings_changed then
    insert into public.audit_log (
      actor_user_id, entity_type, entity_id, action, metadata_json
    ) values (
      p_actor_user_id,
      'club',
      target_club.id,
      'club.settings.updated',
      jsonb_build_object('club_id', target_club.id)
    );
  end if;

  select club.*
  into updated_club
  from public.clubs club
  where club.id = target_club.id;

  return jsonb_build_object(
    'club', to_jsonb(updated_club),
    'sport_codes', to_jsonb(p_selected_sport_codes),
    'primary_sport_code', p_selected_primary_sport_code
  );
end;
$$;

revoke all on function public.service_update_club_profile_v2(
  uuid, uuid, jsonb, jsonb, text[], text, boolean, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.service_update_club_profile_v2(
  uuid, uuid, jsonb, jsonb, text[], text, boolean, boolean
) to service_role;

comment on function public.create_current_user_club_v3(
  text, text, text, text, text, text, text[], text, uuid, integer, text,
  boolean, text, text, text, text, text, text[], boolean, text, text, text,
  boolean, text, text, text, text, text
) is 'Atomically creates an independent club, its owner membership, and sport selection with retry-safe identity.';

comment on function public.service_update_club_profile_v2(
  uuid, uuid, jsonb, jsonb, text[], text, boolean, boolean
) is 'Atomically updates a club profile, settings, sport selection, and audit records without organization coupling.';

commit;
