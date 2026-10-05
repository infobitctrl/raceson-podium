create or replace function public.service_request_account_context(
  target_user_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with user_profile as materialized (
    select profile.*
    from public.user_profiles profile
    where profile.user_id = target_user_id
    limit 1
  ),
  membership_scope as materialized (
    select
      membership.id,
      membership.organization_id,
      membership.role::text as role,
      membership.membership_type,
      membership.permission_keys,
      membership.login_username::text as login_username,
      membership.expires_at,
      membership.status::text as status
    from public.organization_memberships membership
    where membership.user_id = target_user_id
      and membership.status in ('active', 'invited')
  ),
  organization_scope as materialized (
    select distinct
      organization.id,
      organization.slug,
      organization.name,
      organization.kind
    from public.organizations organization
    join membership_scope membership
      on membership.organization_id = organization.id
  )
  select jsonb_build_object(
    'user_profile', (
      select jsonb_build_object(
        'display_name', profile.display_name,
        'first_name', profile.first_name,
        'last_name', profile.last_name,
        'date_of_birth', profile.date_of_birth,
        'city', profile.city,
        'country_code', profile.country_code,
        'phone', profile.phone,
        'job_title', profile.job_title,
        'bio', profile.bio,
        'website_url', profile.website_url,
        'instagram_url', profile.instagram_url,
        'facebook_url', profile.facebook_url,
        'linkedin_url', profile.linkedin_url,
        'youtube_url', profile.youtube_url,
        'tiktok_url', profile.tiktok_url,
        'x_url', profile.x_url,
        'locale', profile.locale,
        'timezone', profile.timezone,
        'avatar_url', profile.avatar_url,
        'cover_image_url', profile.cover_image_url,
        'primary_athlete_profile_id', profile.primary_athlete_profile_id,
        'email_verified_at', profile.email_verified_at,
        'auth_providers_json', profile.auth_providers_json,
        'preferences_json', profile.preferences_json
      )
      from user_profile profile
    ),
    'athlete_profile', (
      select jsonb_build_object(
        'slug', athlete.slug,
        'display_name', athlete.display_name,
        'first_name', athlete.first_name,
        'last_name', athlete.last_name,
        'gender', athlete.gender,
        'date_of_birth', athlete.date_of_birth,
        'city', athlete.city,
        'country_code', athlete.country_code
      )
      from public.athlete_profiles athlete
      join user_profile profile
        on profile.primary_athlete_profile_id = athlete.id
      limit 1
    ),
    'registration_profile', (
      select jsonb_build_object(
        'phone', registration_profile.phone,
        'emergency_contact_name', registration_profile.emergency_contact_name,
        'emergency_contact_phone', registration_profile.emergency_contact_phone,
        'shirt_size', registration_profile.shirt_size
      )
      from public.athlete_registration_profiles registration_profile
      join user_profile profile
        on profile.primary_athlete_profile_id = registration_profile.athlete_profile_id
      limit 1
    ),
    'login_identifier', (
      select jsonb_build_object(
        'username', identifier.username,
        'email', identifier.email,
        'username_changed_at', identifier.username_changed_at
      )
      from public.account_login_identifiers identifier
      where identifier.user_id = target_user_id
      limit 1
    ),
    'memberships', coalesce(
      (
        select jsonb_agg(to_jsonb(membership) order by membership.organization_id)
        from membership_scope membership
      ),
      '[]'::jsonb
    ),
    'organizations', coalesce(
      (
        select jsonb_agg(to_jsonb(organization) order by organization.id)
        from organization_scope organization
      ),
      '[]'::jsonb
    ),
    'linked_clubs', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', club.id,
            'slug', club.slug,
            'name', club.name,
            'organization_id', club.organization_id
          )
          order by club.id
        )
        from public.clubs club
        join organization_scope organization
          on organization.id = club.organization_id
      ),
      '[]'::jsonb
    ),
    'platform_administrator', (
      select jsonb_build_object(
        'user_id', administrator.user_id,
        'platform_role', administrator.platform_role
      )
      from public.platform_administrators administrator
      where administrator.user_id = target_user_id
        and administrator.is_active = true
      limit 1
    ),
    'test_account', (
      select jsonb_build_object(
        'user_id', test_account.user_id,
        'test_role', test_account.test_role
      )
      from public.platform_test_accounts test_account
      where test_account.user_id = target_user_id
        and test_account.is_active = true
      limit 1
    ),
    'event_access', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', assignment.id,
            'event_edition_id', assignment.event_edition_id,
            'organization_id', series.organization_id,
            'event_category_id', assignment.event_category_id,
            'checkpoint_id', assignment.checkpoint_id,
            'role_title', assignment.role_title,
            'permission_keys', assignment.permission_keys,
            'starts_at', assignment.starts_at,
            'ends_at', assignment.ends_at
          )
          order by assignment.id
        )
        from public.event_staff_assignments assignment
        join public.event_editions edition
          on edition.id = assignment.event_edition_id
        join public.event_series series
          on series.id = edition.event_series_id
        where assignment.staff_user_id = target_user_id
          and assignment.assignment_state in ('planned', 'confirmed', 'checked_in')
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.service_request_account_context(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.service_request_account_context(uuid) to service_role;
  end if;
end;
$$;
