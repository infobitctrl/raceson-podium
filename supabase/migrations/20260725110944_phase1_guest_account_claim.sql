/*
 * Claims a token-authenticated guest entry into a verified account without
 * trusting email alone. A newly bootstrapped, otherwise-empty athlete shell can
 * be superseded automatically; established profiles require the reviewed merge
 * workflow so no history is silently moved or hidden.
 */

create or replace function public.service_claim_guest_registration(
  p_registration_id uuid,
  p_token_hash text,
  p_user_id uuid,
  p_verified_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  access_row public.guest_registration_access_grants%rowtype;
  registration_row public.registrations%rowtype;
  guest_profile public.athlete_profiles%rowtype;
  current_profile_id uuid;
  resolved_organization_id uuid;
  dependency record;
  has_dependency boolean;
begin
  if p_user_id is null
     or nullif(lower(trim(p_verified_email)), '') is null
     or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'guest_claim_identity_invalid';
  end if;

  select access_grant.*
  into access_row
  from public.guest_registration_access_grants access_grant
  where access_grant.registration_id = p_registration_id
  for update;

  if not found
     or access_row.token_hash <> p_token_hash
     or access_row.revoked_at is not null
     or access_row.expires_at <= now() then
    raise exception using errcode = '28000', message = 'invalid_guest_registration_access';
  end if;

  if lower(access_row.guest_email::text) <> lower(trim(p_verified_email)) then
    raise exception using errcode = '28000', message = 'guest_claim_email_mismatch';
  end if;

  select registration.*
  into registration_row
  from public.registrations registration
  where registration.id = p_registration_id
    and registration.source = 'guest'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'guest_registration_not_found';
  end if;

  select athlete.*
  into guest_profile
  from public.athlete_profiles athlete
  where athlete.id = registration_row.athlete_profile_id
  for update;

  if guest_profile.claimed_by_user_id is not null
     and guest_profile.claimed_by_user_id <> p_user_id then
    raise exception using errcode = '23505', message = 'guest_profile_already_claimed';
  end if;

  select user_profile.primary_athlete_profile_id
  into current_profile_id
  from public.user_profiles user_profile
  where user_profile.user_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'account_profile_not_found';
  end if;

  if current_profile_id is not null and current_profile_id <> guest_profile.id then
    /*
     * Inspect every single-column FK to athlete_profiles. This remains correct
     * when new athlete-owned tables are added: only account-shell relations may
     * be present for an automatic supersession.
     */
    for dependency in
      select
        namespace.nspname as schema_name,
        relation.relname as table_name,
        attribute.attname as column_name
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation
        on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
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
          'user_profiles'
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
          errcode = 'P0001',
          message = 'guest_claim_requires_profile_merge',
          detail = format(
            'Existing athlete data is referenced by %I.%I.',
            dependency.table_name,
            dependency.column_name
          );
      end if;
    end loop;

    update public.athlete_identities identity
    set athlete_profile_id = guest_profile.id
    where identity.athlete_profile_id = current_profile_id
      and identity.user_id = p_user_id;

    update public.athlete_profiles athlete
    set
      is_claimed = false,
      claimed_by_user_id = null,
      status = 'merged',
      merged_into_athlete_profile_id = guest_profile.id,
      updated_at = now()
    where athlete.id = current_profile_id;
  end if;

  update public.athlete_profiles athlete
  set
    primary_email = coalesce(athlete.primary_email, lower(trim(p_verified_email))),
    is_claimed = true,
    claimed_by_user_id = p_user_id,
    status = 'active',
    updated_at = now()
  where athlete.id = guest_profile.id;

  update public.athlete_identities identity
  set
    user_id = p_user_id,
    is_verified = true,
    verified_at = coalesce(identity.verified_at, now())
  where identity.athlete_profile_id = guest_profile.id
    and identity.identity_type = 'email'
    and lower(identity.identity_value) = lower(trim(p_verified_email));

  insert into public.athlete_identities (
    athlete_profile_id,
    user_id,
    identity_type,
    identity_value,
    is_verified,
    verified_at
  )
  values (
    guest_profile.id,
    p_user_id,
    'auth_user',
    p_user_id::text,
    true,
    now()
  )
  on conflict (identity_type, identity_value)
  do update set
    athlete_profile_id = excluded.athlete_profile_id,
    user_id = excluded.user_id,
    is_verified = true,
    verified_at = coalesce(public.athlete_identities.verified_at, excluded.verified_at);

  update public.user_profiles user_profile
  set
    primary_athlete_profile_id = guest_profile.id,
    updated_at = now()
  where user_profile.user_id = p_user_id;

  update public.guest_registration_access_grants access_grant
  set
    revoked_at = coalesce(access_grant.revoked_at, now()),
    last_used_at = now()
  where access_grant.id = access_row.id;

  select series.organization_id
  into resolved_organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = registration_row.event_category_id;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    resolved_organization_id,
    p_user_id,
    'athlete_profile',
    guest_profile.id,
    'guest_registration.claimed',
    jsonb_build_object(
      'registrationId', registration_row.id,
      'supersededProfileId',
      case
        when current_profile_id is distinct from guest_profile.id then current_profile_id
        else null
      end
    )
  );

  return jsonb_build_object(
    'registrationId', registration_row.id,
    'athleteProfileId', guest_profile.id,
    'claimed', true,
    'replayed', guest_profile.claimed_by_user_id = p_user_id
  );
end;
$$;

revoke all on function public.service_claim_guest_registration(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_claim_guest_registration(uuid, text, uuid, text)
  to service_role;
