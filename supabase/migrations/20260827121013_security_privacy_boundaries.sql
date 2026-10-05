-- Local security remediation. Production application requires the release gate.
begin;

-- Intentionally public, bounded projections. These helpers accept arbitrary IDs
-- but return only opted-in fields; no caller identity can expand their output.
create function app_private.public_athlete_location(target_athlete_profile_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('city', athlete.city, 'country_code', athlete.country_code)
  from public.athlete_profiles athlete
  join public.profile_visibility_settings visibility on visibility.athlete_profile_id = athlete.id
  where athlete.id = target_athlete_profile_id
    and athlete.status = 'active' and athlete.merged_into_athlete_profile_id is null
    and visibility.show_city
$$;
revoke all on function app_private.public_athlete_location(uuid) from public, anon, authenticated;
grant execute on function app_private.public_athlete_location(uuid) to anon, authenticated, service_role;

create or replace view public.public_athlete_profiles
with (security_invoker = true, security_barrier = true) as
select athlete.id, athlete.slug, athlete.display_name, athlete.gender,
  null::date as date_of_birth,
  app_private.public_athlete_location(athlete.id)->>'city' as city,
  (app_private.public_athlete_location(athlete.id)->>'country_code')::bpchar as country_code,
  athlete.status, athlete.created_at, athlete.updated_at
from public.athlete_profiles athlete
where athlete.status = 'active' and athlete.merged_into_athlete_profile_id is null;

revoke select (city, country_code) on public.athlete_profiles from public, anon, authenticated;

create function app_private.public_organization_details(target_organization_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'profile_visibility', organization.profile_visibility,
    'contact_details_visibility', organization.contact_details_visibility
  ) || case when organization.profile_visibility = 'public' then jsonb_build_object(
    'country_code', organization.country_code, 'region', organization.region,
    'city', organization.city, 'description', organization.description,
    'logo_image_url', organization.logo_image_url
  ) else '{}'::jsonb end
  || case when organization.contact_details_visibility = 'public' then jsonb_build_object(
    'contact_email', organization.contact_email, 'contact_phone', organization.contact_phone,
    'website_url', organization.website_url, 'instagram_url', organization.instagram_url,
    'facebook_url', organization.facebook_url, 'linkedin_url', organization.linkedin_url,
    'youtube_url', organization.youtube_url, 'tiktok_url', organization.tiktok_url,
    'x_url', organization.x_url
  ) else '{}'::jsonb end
  from public.organizations organization
  where organization.id = target_organization_id and organization.status = 'active'
$$;
revoke all on function app_private.public_organization_details(uuid) from public, anon, authenticated;
grant execute on function app_private.public_organization_details(uuid) to anon, authenticated, service_role;

create view public.public_organization_profiles
with (security_invoker = true, security_barrier = true) as
select organization.id, organization.slug, organization.name, organization.kind,
  organization.status, organization.created_at, organization.updated_at,
  (details.value->>'country_code')::char(2) as country_code,
  details.value->>'region' as region, details.value->>'city' as city,
  details.value->>'description' as description, details.value->>'logo_image_url' as logo_image_url,
  details.value->>'contact_email' as contact_email, details.value->>'contact_phone' as contact_phone,
  details.value->>'website_url' as website_url, details.value->>'instagram_url' as instagram_url,
  details.value->>'facebook_url' as facebook_url, details.value->>'linkedin_url' as linkedin_url,
  details.value->>'youtube_url' as youtube_url, details.value->>'tiktok_url' as tiktok_url,
  details.value->>'x_url' as x_url,
  details.value->>'profile_visibility' as profile_visibility,
  details.value->>'contact_details_visibility' as contact_details_visibility
from public.organizations organization
cross join lateral (select app_private.public_organization_details(organization.id) as value) details
where organization.status = 'active';
revoke all on public.public_organization_profiles from public, anon, authenticated;
grant select on public.public_organization_profiles to anon, authenticated, service_role;
revoke select on public.organizations from public, anon, authenticated;
-- Also remove legacy column grants, if present in a previously drifted database.
do $$
declare column_list text;
begin
  select string_agg(quote_ident(attname), ', ') into column_list
  from pg_attribute where attrelid = 'public.organizations'::regclass and attnum > 0 and not attisdropped;
  execute format('revoke select (%s) on public.organizations from public, anon, authenticated', column_list);
end $$;
grant select (id, slug, name, kind, status, created_at, updated_at) on public.organizations to anon, authenticated;

-- Keep the latest event bundle (including finished league-round history).
do $$
declare definition text;
begin
  select pg_get_functiondef('public.public_event_detail_bundle(text)'::regprocedure) into definition;
  if strpos(definition, 'from public.organizations organization') = 0 then
    raise exception 'Unexpected event bundle definition; privacy projection must be reviewed';
  end if;
  execute replace(definition, 'from public.organizations organization', 'from public.public_organization_profiles organization');
end $$;

create or replace function app_private.is_event_edition_public(target_event_edition_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.event_editions edition
    where edition.id = target_event_edition_id and edition.published_at is not null
      and edition.status <> 'draft' and edition.organizer_deleted_at is null
      and (edition.public_visibility = 'public' or (
        edition.public_visibility = 'club_members' and exists (
          select 1 from public.event_eligible_clubs eligible
          join public.club_memberships membership on membership.club_id = eligible.club_id
          where eligible.event_edition_id = edition.id and membership.status = 'active'
            and app_private.user_can_access_athlete_profile(membership.athlete_profile_id)
        )
      ))
  )
$$;
create or replace function app_private.is_event_category_public(target_event_category_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.event_categories category
    where category.id = target_event_category_id and category.status <> 'draft'
      and category.organizer_deleted_at is null
      and app_private.is_event_edition_public(category.event_edition_id)
  )
$$;
create or replace function app_private.is_result_run_public(target_result_run_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.result_publications publication
    where publication.result_run_id = target_result_run_id
      and app_private.is_event_category_public(publication.event_category_id)
  )
$$;

-- Privileged public API reads must filter before pagination. The canonical view
-- remains complete for personal history, scoring, and organizer operations.
create view public.public_current_published_result_rows
with (security_invoker = true, security_barrier = true) as
select result.* from public.current_published_result_rows result
join public.event_categories category on category.id = result.event_category_id
join public.event_editions edition on edition.id = category.event_edition_id
where edition.public_visibility = 'public' and edition.published_at is not null
  and edition.status <> 'draft' and edition.organizer_deleted_at is null
  and category.status <> 'draft' and category.organizer_deleted_at is null;
revoke all on public.public_current_published_result_rows from public, anon, authenticated;
grant select on public.public_current_published_result_rows to service_role;

-- Guarded edits preserve the independently evolving aggregate/live semantics.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.public_registration_counts(uuid[])'::regprocedure) into definition;
  if strpos(definition, 'where ec.status <> ''draft''') = 0 then
    raise exception 'Unexpected registration count definition';
  end if;
  execute replace(definition, 'where ec.status <> ''draft''',
    'where ec.status <> ''draft'' and app_private.is_event_category_public(ec.id)');

  select pg_get_functiondef('public.read_public_live_edition(uuid)'::regprocedure) into definition;
  if strpos(definition, 'where edition.id = p_event_edition_id') = 0
    or strpos(definition, 'where settings.is_enabled') = 0 then
    raise exception 'Unexpected public live definition';
  end if;
  definition := replace(definition, 'where edition.id = p_event_edition_id',
    'where edition.id = p_event_edition_id and app_private.is_event_edition_public(edition.id)');
  execute replace(definition, 'where settings.is_enabled',
    'where settings.is_enabled and app_private.is_event_category_public(category.id)');
end $$;

create function app_private.can_read_club_membership_requests(target_club_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_platform_administrator(auth.uid())
    or app_private.club_member_has_permission(target_club_id, 'club.members.manage')
$$;
revoke all on function app_private.can_read_club_membership_requests(uuid) from public, anon, authenticated;
grant execute on function app_private.can_read_club_membership_requests(uuid) to anon, authenticated, service_role;

alter policy club_memberships_select_public_or_self on public.club_memberships using (
  (status = 'active' and app_private.is_club_public(club_id))
  or app_private.user_can_access_athlete_profile(athlete_profile_id)
  or app_private.can_read_club_membership_requests(club_id)
);

-- Only scalar summary values and four bounded analysis metrics may be public.
create function app_private.public_track_attempt_summary(value jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  from (
    select key, value from jsonb_each(case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end)
    where (key in ('submissionSource', 'activityName') and jsonb_typeof(value) in ('string', 'null'))
      or (key in ('distanceKm', 'elevationGainM', 'timestampCoveragePercent', 'submissionCount') and jsonb_typeof(value) in ('number', 'null'))
      or (key = 'resubmittedAfterRejection' and jsonb_typeof(value) = 'boolean')
    union all
    select 'analysisSummary', coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    from jsonb_each(case when jsonb_typeof(value->'analysisSummary') = 'object' then value->'analysisSummary' else '{}'::jsonb end)
    where (key = 'recommendation' and value #>> '{}' in ('approve', 'reject', 'manual_review'))
      or (key in ('courseCoveragePercent', 'activityOnCoursePercent', 'distanceDeltaPercent') and jsonb_typeof(value) in ('number', 'null'))
    having count(*) > 0
  ) entry
$$;
revoke all on function app_private.public_track_attempt_summary(jsonb) from public, anon, authenticated;
grant execute on function app_private.public_track_attempt_summary(jsonb) to service_role;

-- Legacy evidence may be the sole review copy. Move it before removing the
-- public copy; never replace an existing ready private analysis.
insert into public.track_attempt_evidence (track_attempt_id, source, evidence_json)
select id, 'strava', result_json from public.track_attempts
where source = 'strava' and result_json->>'analysisVersion' in ('1', '2')
on conflict (track_attempt_id) do update set evidence_json = excluded.evidence_json
where track_attempt_evidence.evidence_json->>'status' is distinct from 'ready';

do $$
begin
  if exists (
    select 1 from public.track_attempts attempt
    where attempt.source = 'gpx_upload' and attempt.result_json->>'analysisVersion' in ('1', '2')
      and not exists (select 1 from public.track_attempt_evidence evidence where evidence.track_attempt_id = attempt.id)
  ) then
    raise exception 'Preserve missing private GPX evidence before sanitizing public summaries';
  end if;
end $$;

update public.track_attempts set result_json = app_private.public_track_attempt_summary(result_json)
where result_json is distinct from app_private.public_track_attempt_summary(result_json);

create function app_private.sanitize_track_attempt_summary()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.result_json := app_private.public_track_attempt_summary(new.result_json);
  return new;
end $$;
revoke all on function app_private.sanitize_track_attempt_summary() from public, anon, authenticated;
grant execute on function app_private.sanitize_track_attempt_summary() to service_role;
create trigger track_attempts_public_summary
before insert or update of result_json on public.track_attempts
for each row execute function app_private.sanitize_track_attempt_summary();

-- Durable one-use OAuth initiation. No browser has table or RPC privileges.
create table public.athlete_strava_oauth_intents (
  nonce_hash text primary key check (nonce_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_profile_id uuid not null references public.athlete_profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index athlete_strava_oauth_intents_expiry_idx on public.athlete_strava_oauth_intents(expires_at);
alter table public.athlete_strava_oauth_intents enable row level security;
revoke all on public.athlete_strava_oauth_intents from public, anon, authenticated;
grant select, insert, delete on public.athlete_strava_oauth_intents to service_role;

create function public.consume_strava_oauth_intent(target_nonce_hash text, target_user_id uuid, target_athlete_profile_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  with consumed as (
    delete from public.athlete_strava_oauth_intents
    where nonce_hash = target_nonce_hash and user_id = target_user_id
      and athlete_profile_id = target_athlete_profile_id and expires_at > clock_timestamp()
    returning nonce_hash
  ) select exists (select 1 from consumed)
$$;
revoke all on function public.consume_strava_oauth_intent(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_strava_oauth_intent(text, uuid, uuid) to service_role;

commit;
