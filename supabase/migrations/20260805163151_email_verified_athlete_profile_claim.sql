/*
 * Imported athlete profiles can be claimed without administrator review when
 * Supabase Auth has verified the exact email already assigned to the profile.
 * A newly-created empty athlete shell may be superseded automatically; an
 * established athlete profile still requires the reviewed merge workflow.
 */

create or replace function public.service_claim_imported_athlete_profile_by_email(
  p_actor_user_id uuid,
  p_athlete_profile_id uuid,
  p_verified_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile public.athlete_profiles%rowtype;
  current_profile_id uuid;
  normalized_verified_email text;
  dependency record;
  has_dependency boolean;
begin
  normalized_verified_email := nullif(lower(trim(p_verified_email)), '');

  if p_actor_user_id is null or normalized_verified_email is null then
    raise exception using errcode = '22023', message = 'athlete_claim_identity_invalid';
  end if;

  if not exists (
    select 1
    from auth.users auth_user
    where auth_user.id = p_actor_user_id
      and auth_user.email_confirmed_at is not null
      and lower(trim(auth_user.email)) = normalized_verified_email
  ) then
    raise exception using errcode = '28000', message = 'athlete_claim_email_not_verified';
  end if;

  select athlete.*
  into target_profile
  from public.athlete_profiles athlete
  where athlete.id = p_athlete_profile_id
    and athlete.status = 'active'
    and athlete.merged_into_athlete_profile_id is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'athlete_profile_not_found';
  end if;
  if target_profile.is_claimed or target_profile.claimed_by_user_id is not null then
    raise exception using errcode = '23505', message = 'athlete_profile_already_claimed';
  end if;
  if target_profile.primary_email is null
     or lower(trim(target_profile.primary_email::text)) <> normalized_verified_email then
    raise exception using errcode = '28000', message = 'athlete_claim_email_mismatch';
  end if;

  select profile.primary_athlete_profile_id
  into current_profile_id
  from public.user_profiles profile
  where profile.user_id = p_actor_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'account_profile_not_found';
  end if;

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
          detail = format(
            'Existing athlete data is referenced by %I.%I.',
            dependency.table_name,
            dependency.column_name
          );
      end if;
    end loop;

    update public.athlete_identities identity
    set athlete_profile_id = target_profile.id
    where identity.athlete_profile_id = current_profile_id
      and identity.user_id = p_actor_user_id;

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
    claimed_by_user_id = p_actor_user_id,
    status = 'active',
    updated_at = clock_timestamp()
  where athlete.id = target_profile.id;

  update public.athlete_identities identity
  set
    user_id = p_actor_user_id,
    is_verified = true,
    verified_at = coalesce(identity.verified_at, clock_timestamp())
  where identity.athlete_profile_id = target_profile.id
    and identity.identity_type = 'email'
    and lower(trim(identity.identity_value)) = normalized_verified_email;

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
    p_actor_user_id,
    'auth_user',
    p_actor_user_id::text,
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
  set
    email = normalized_verified_email,
    email_verified_at = coalesce(profile.email_verified_at, clock_timestamp()),
    primary_athlete_profile_id = target_profile.id,
    updated_at = clock_timestamp()
  where profile.user_id = p_actor_user_id;

  insert into public.audit_log (
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    p_actor_user_id,
    'athlete_profile',
    target_profile.id,
    'athlete_profile.email_verified_claimed',
    jsonb_build_object(
      'athlete_slug', target_profile.slug,
      'superseded_profile_id', current_profile_id,
      'verification_method', 'supabase_auth_magic_link'
    )
  );

  return jsonb_build_object(
    'athleteProfileId', target_profile.id,
    'athleteSlug', target_profile.slug,
    'claimed', true
  );
end;
$$;

revoke all on function public.service_claim_imported_athlete_profile_by_email(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_claim_imported_athlete_profile_by_email(uuid, uuid, text)
  to service_role;
