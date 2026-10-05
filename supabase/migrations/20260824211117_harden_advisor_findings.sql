-- Reduce the exposed privileged-function surface reported by the Security
-- Advisor, move citext to the conventional extension schema, add the highest
-- value missing foreign-key indexes, and provide one compact event-detail read
-- boundary for the public portal.

begin;

create schema if not exists app_private authorization postgres;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to anon, authenticated, service_role;

alter default privileges for role postgres in schema app_private
  revoke execute on functions from public;
alter default privileges for role postgres in schema app_private
  revoke execute on functions from anon;
alter default privileges for role postgres in schema app_private
  revoke execute on functions from authenticated;

-- Policies retain function dependencies by OID when a function moves schemas.
-- Capture the reviewed SECURITY DEFINER helpers first, move those exact OIDs,
-- and then rewrite stored function bodies that called the old qualified names.
create temporary table advisor_policy_helpers (
  function_oid oid primary key,
  function_name name not null
) on commit drop;

insert into advisor_policy_helpers (function_oid, function_name)
select distinct procedure.oid, procedure.proname
from pg_policy policy
join pg_depend dependency
  on dependency.classid = 'pg_policy'::regclass
 and dependency.objid = policy.oid
join pg_proc procedure
  on dependency.refclassid = 'pg_proc'::regclass
 and dependency.refobjid = procedure.oid
join pg_namespace function_namespace
  on function_namespace.oid = procedure.pronamespace
where function_namespace.nspname = 'public'
  and procedure.prosecdef;

do $$
declare
  helper_count integer;
begin
  select count(*) into helper_count from advisor_policy_helpers;
  if helper_count <> 60 then
    raise exception
      'Expected 60 public SECURITY DEFINER policy helpers, found %',
      helper_count;
  end if;
end
$$;

do $$
declare
  helper record;
begin
  for helper in
    select function_oid
    from advisor_policy_helpers
    order by function_oid::regprocedure::text
  loop
    execute format(
      'alter function %s set schema app_private',
      helper.function_oid::regprocedure
    );
  end loop;
end
$$;

-- SQL and PL/pgSQL bodies are stored as source text. Recreate only functions
-- whose body still contains a public-qualified reference to a moved helper.
do $$
declare
  target record;
  helper record;
  original_definition text;
  rewritten_definition text;
begin
  for target in
    select procedure.oid
    from pg_proc procedure
    join pg_namespace function_namespace
      on function_namespace.oid = procedure.pronamespace
    where function_namespace.nspname in ('public', 'app_private')
      and procedure.prokind = 'f'
      and not exists (
        select 1
        from pg_depend dependency
        where dependency.classid = 'pg_proc'::regclass
          and dependency.objid = procedure.oid
          and dependency.deptype = 'e'
      )
    order by procedure.oid
  loop
    original_definition := pg_get_functiondef(target.oid);
    rewritten_definition := original_definition;

    for helper in
      select distinct function_name
      from advisor_policy_helpers
      order by function_name
    loop
      rewritten_definition := replace(
        rewritten_definition,
        format('public.%I(', helper.function_name),
        format('app_private.%I(', helper.function_name)
      );
    end loop;

    if rewritten_definition <> original_definition then
      execute rewritten_definition;
    end if;
  end loop;
end
$$;

-- citext is relocatable. Existing columns and compiled expressions retain the
-- same type OID; current function source is qualified below for future parses.
create schema if not exists extensions authorization postgres;
revoke create on schema extensions from public;
grant usage on schema extensions to anon, authenticated, service_role;
alter extension citext set schema extensions;

do $$
declare
  target record;
  original_definition text;
  rewritten_definition text;
begin
  for target in
    select procedure.oid
    from pg_proc procedure
    join pg_namespace function_namespace
      on function_namespace.oid = procedure.pronamespace
    where function_namespace.nspname in ('public', 'app_private')
      and procedure.prokind = 'f'
      and not exists (
        select 1
        from pg_depend dependency
        where dependency.classid = 'pg_proc'::regclass
          and dependency.objid = procedure.oid
          and dependency.deptype = 'e'
      )
    order by procedure.oid
  loop
    original_definition := pg_get_functiondef(target.oid);
    rewritten_definition := regexp_replace(
      original_definition,
      '(^|[^a-zA-Z0-9_.])citext($|[^a-zA-Z0-9_])',
      E'\\1extensions.citext\\2',
      'g'
    );

    if rewritten_definition <> original_definition then
      execute rewritten_definition;
    end if;
  end loop;
end
$$;

-- Active foreign-key paths identified from the Performance Advisor. These
-- tables currently remain small, so normal transactional index creation keeps
-- the migration deterministic without meaningful lock time on staging.
create index if not exists registrations_eligibility_club_id_idx
  on public.registrations (eligibility_club_id);
create index if not exists registrations_organizer_removed_by_user_id_idx
  on public.registrations (organizer_removed_by_user_id);
create index if not exists registrations_current_quote_id_idx
  on public.registrations (current_quote_id);
create index if not exists registrations_eligibility_club_membership_id_idx
  on public.registrations (eligibility_club_membership_id);
create index if not exists registrations_registration_form_version_id_idx
  on public.registrations (registration_form_version_id);
create index if not exists league_individual_rows_athlete_profile_id_idx
  on public.league_individual_standing_rows (athlete_profile_id);
create index if not exists league_individual_rows_represented_club_id_idx
  on public.league_individual_standing_rows (represented_club_id);
create index if not exists league_club_rows_club_id_idx
  on public.league_club_standing_rows (club_id);
create index if not exists club_memberships_club_role_fk_idx
  on public.club_memberships (club_id, club_role_id);

create or replace function public.public_event_detail_bundle(
  target_event_slug text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with selected_edition as (
    select
      edition.id,
      edition.event_series_id,
      edition.slug,
      edition.name,
      edition.activity_type,
      edition.start_date,
      edition.end_date,
      edition.timezone,
      edition.location_name,
      edition.status,
      edition.registration_open_at,
      edition.registration_close_at,
      edition.cover_image_url,
      edition.about_text,
      edition.organizer_rules,
      edition.website_url,
      edition.instagram_url,
      edition.facebook_url,
      edition.general_timeline_json
    from public.event_editions edition
    where edition.slug = target_event_slug
      and edition.published_at is not null
      and edition.status <> 'draft'
    order by edition.published_at desc
    limit 1
  ),
  selected_series as (
    select
      series.id,
      series.name,
      series.organization_id,
      series.description,
      series.location_name,
      series.country_code
    from public.event_series series
    join selected_edition edition
      on edition.event_series_id = series.id
  ),
  selected_categories as (
    select
      category.id,
      category.event_edition_id,
      category.slug,
      category.name,
      category.cover_image_url,
      category.sport_code,
      category.distance_km,
      category.elevation_gain_m,
      category.capacity,
      category.registration_fee_cents,
      category.currency,
      category.start_at,
      category.minimum_age,
      category.maximum_age,
      category.allowed_genders,
      category.eligibility_note,
      category.results_mode,
      category.display_order,
      category.status
    from public.event_categories category
    join selected_edition edition
      on edition.id = category.event_edition_id
  ),
  race_category_ids as (
    select coalesce(array_agg(category.id), '{}'::uuid[]) as ids
    from selected_categories category
    where category.status <> 'draft'
      and category.results_mode <> 'informative_age'
  ),
  selected_snapshots as (
    select
      snapshot.id,
      snapshot.event_category_id,
      snapshot.track_template_id,
      snapshot.track_version_id
    from public.event_category_track_snapshots snapshot
    join selected_categories category
      on category.id = snapshot.event_category_id
  ),
  selected_rounds as (
    select
      round.league_season_id,
      round.event_edition_id,
      round.round_number
    from public.league_rounds round
    join selected_edition edition
      on edition.id = round.event_edition_id
  ),
  selected_seasons as (
    select season.id, season.league_id
    from public.league_seasons season
    join selected_rounds round
      on round.league_season_id = season.id
    where season.published_at is not null
  ),
  selected_leagues as (
    select league.id, league.slug, league.name
    from public.leagues league
    join selected_seasons season
      on season.league_id = league.id
  )
  select case
    when not exists (select 1 from selected_edition) then null
    else jsonb_build_object(
      'edition', (
        select to_jsonb(edition) from selected_edition edition
      ),
      'series', (
        select to_jsonb(series) from selected_series series limit 1
      ),
      'categories', coalesce((
        select jsonb_agg(to_jsonb(category) order by category.display_order, category.distance_km desc)
        from selected_categories category
      ), '[]'::jsonb),
      'documents', coalesce((
        select jsonb_agg(to_jsonb(document_row) order by document_row.created_at desc)
        from (
          select document.title, document.document_type, document.storage_path, document.created_at
          from public.event_documents document
          join selected_edition edition on edition.id = document.event_edition_id
          where document.visibility = 'public'
        ) document_row
      ), '[]'::jsonb),
      'previous_editions', coalesce((
        select jsonb_agg(to_jsonb(previous_row) order by previous_row.start_date desc)
        from (
          select previous.slug, previous.name, previous.start_date
          from public.event_editions previous
          join selected_edition edition
            on edition.event_series_id = previous.event_series_id
          where previous.id <> edition.id
          order by previous.start_date desc
          limit 3
        ) previous_row
      ), '[]'::jsonb),
      'locations', coalesce((
        select jsonb_agg(to_jsonb(location_row) order by location_row.display_order, location_row.created_at)
        from (
          select
            location.id,
            location.location_type,
            location.label,
            location.description,
            location.place_label,
            location.latitude,
            location.longitude,
            location.display_order,
            location.created_at
          from public.event_locations location
          join selected_edition edition on edition.id = location.event_edition_id
        ) location_row
      ), '[]'::jsonb),
      'sports', coalesce((
        select jsonb_agg(to_jsonb(sport_row))
        from (
          select sport.sport_code, sport.is_primary
          from public.event_edition_sports sport
          join selected_edition edition on edition.id = sport.event_edition_id
        ) sport_row
      ), '[]'::jsonb),
      'organization', (
        select to_jsonb(organization_row)
        from (
          select
            organization.name,
            organization.country_code,
            organization.region,
            organization.city,
            organization.description,
            organization.website_url,
            organization.instagram_url,
            organization.facebook_url,
            organization.linkedin_url,
            organization.youtube_url,
            organization.tiktok_url,
            organization.x_url,
            organization.contact_email,
            organization.contact_phone,
            organization.logo_image_url,
            organization.profile_visibility,
            organization.contact_details_visibility
          from public.organizations organization
          join selected_series series on series.organization_id = organization.id
          limit 1
        ) organization_row
      ),
      'registration_counts', coalesce((
        select jsonb_agg(to_jsonb(registration_count))
        from public.public_registration_counts(
          (select ids from race_category_ids)
        ) registration_count
      ), '[]'::jsonb),
      'snapshots', coalesce((
        select jsonb_agg(to_jsonb(snapshot)) from selected_snapshots snapshot
      ), '[]'::jsonb),
      'published_track_version_ids', coalesce((
        select jsonb_agg(distinct version.id)
        from public.track_versions version
        join selected_snapshots snapshot on snapshot.track_version_id = version.id
        where version.published_at is not null
      ), '[]'::jsonb),
      'track_templates', coalesce((
        select jsonb_agg(distinct to_jsonb(template_row))
        from (
          select template.id, template.slug, template.name
          from public.track_templates template
          join selected_snapshots snapshot on snapshot.track_template_id = template.id
        ) template_row
      ), '[]'::jsonb),
      'league_rounds', coalesce((
        select jsonb_agg(to_jsonb(round)) from selected_rounds round
      ), '[]'::jsonb),
      'league_seasons', coalesce((
        select jsonb_agg(distinct to_jsonb(season)) from selected_seasons season
      ), '[]'::jsonb),
      'leagues', coalesce((
        select jsonb_agg(distinct to_jsonb(league)) from selected_leagues league
      ), '[]'::jsonb)
    )
  end;
$function$;

comment on function public.public_event_detail_bundle(text) is
  'Returns the small, RLS-filtered public event detail graph in one Data API round trip; heavy track geometry remains deferred.';

revoke all on function public.public_event_detail_bundle(text) from public;
grant execute on function public.public_event_detail_bundle(text)
  to anon, authenticated, service_role;

create or replace function public.public_event_geometry_bundle(
  target_event_edition_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with selected_snapshots as (
    select distinct on (category.id)
      category.id as event_category_id,
      snapshot.id as track_snapshot_id,
      snapshot.track_version_id
    from public.event_categories category
    join public.event_category_track_snapshots snapshot
      on snapshot.event_category_id = category.id
    join public.track_versions version
      on version.id = snapshot.track_version_id
     and version.published_at is not null
    where category.event_edition_id = target_event_edition_id
      and category.status <> 'draft'
      and category.results_mode <> 'informative_age'
    order by category.id, snapshot.created_at desc
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'event_category_id', snapshot.event_category_id,
      'track_snapshot_id', snapshot.track_snapshot_id,
      'polyline_json', coalesce(render_cache.polyline_json, '[]'::jsonb),
      'elevation_profile_json', coalesce(render_cache.elevation_profile_json, '[]'::jsonb),
      'checkpoints_json', coalesce(render_cache.checkpoints_json, '[]'::jsonb),
      'checkpoint_rows', coalesce((
        select jsonb_agg(to_jsonb(checkpoint_row) order by checkpoint_row.sequence_number)
        from (
          select
            checkpoint.event_category_id,
            checkpoint.track_snapshot_id,
            checkpoint.name,
            checkpoint.distance_from_start_km,
            checkpoint.sequence_number,
            checkpoint.checkpoint_type,
            checkpoint.cutoff_at,
            checkpoint.is_mandatory,
            checkpoint.settings_json
          from public.checkpoints checkpoint
          where checkpoint.track_snapshot_id = snapshot.track_snapshot_id
        ) checkpoint_row
      ), '[]'::jsonb)
    )
  ), '[]'::jsonb)
  from selected_snapshots snapshot
  left join public.track_render_cache render_cache
    on render_cache.track_version_id = snapshot.track_version_id;
$function$;

comment on function public.public_event_geometry_bundle(uuid) is
  'Returns public event course geometry in one deferred RLS-filtered request so it does not block the event hero.';

revoke all on function public.public_event_geometry_bundle(uuid) from public;
grant execute on function public.public_event_geometry_bundle(uuid)
  to anon, authenticated, service_role;

do $$
declare
  remaining_public_helper text;
  citext_schema text;
begin
  select procedure.oid::regprocedure::text
    into remaining_public_helper
  from pg_policy policy
  join pg_depend dependency
    on dependency.classid = 'pg_policy'::regclass
   and dependency.objid = policy.oid
  join pg_proc procedure
    on dependency.refclassid = 'pg_proc'::regclass
   and dependency.refobjid = procedure.oid
  join pg_namespace function_namespace
    on function_namespace.oid = procedure.pronamespace
  where function_namespace.nspname = 'public'
    and procedure.prosecdef
  order by procedure.oid::regprocedure::text
  limit 1;

  if remaining_public_helper is not null then
    raise exception
      'SECURITY DEFINER policy helper remains exposed in public: %',
      remaining_public_helper;
  end if;

  select namespace.nspname
    into citext_schema
  from pg_extension extension
  join pg_namespace namespace on namespace.oid = extension.extnamespace
  where extension.extname = 'citext';

  if citext_schema is distinct from 'extensions' then
    raise exception 'citext extension remains in schema %', citext_schema;
  end if;

  if public.public_event_detail_bundle('__advisor_validation_missing_event__') is not null then
    raise exception 'Missing event bundle must return null';
  end if;

  if public.public_event_geometry_bundle('00000000-0000-0000-0000-000000000000')
      is distinct from '[]'::jsonb then
    raise exception 'Missing event geometry bundle must return an empty array';
  end if;
end
$$;

commit;
