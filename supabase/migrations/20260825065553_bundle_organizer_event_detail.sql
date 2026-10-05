create index if not exists event_editions_active_slug_idx
  on public.event_editions (slug)
  where organizer_deleted_at is null;

create or replace function public.service_organizer_event_detail_bundle(
  target_event_id uuid,
  target_event_slug text,
  target_organization_ids uuid[],
  target_assigned_event_ids uuid[]
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
      edition.created_at,
      edition.start_date,
      edition.end_date,
      edition.timezone,
      edition.location_name,
      edition.registration_open_at,
      edition.registration_close_at,
      edition.status,
      edition.published_at,
      edition.activity_type,
      edition.is_practice,
      edition.is_recurrence_generated,
      edition.recurrence_rule_id,
      edition.recurrence_source_event_edition_id,
      edition.recurrence_source_date,
      edition.public_visibility,
      edition.registration_access,
      edition.cover_image_url,
      edition.about_text,
      edition.organizer_rules,
      edition.website_url,
      edition.instagram_url,
      edition.facebook_url,
      edition.general_timeline_json
    from public.event_editions edition
    join public.event_series series
      on series.id = edition.event_series_id
    where edition.organizer_deleted_at is null
      and (
        (target_event_id is not null and edition.id = target_event_id)
        or (target_event_slug is not null and edition.slug = target_event_slug)
      )
      and (
        series.organization_id = any(
          coalesce(target_organization_ids, '{}'::uuid[])
        )
        or edition.id = any(
          coalesce(target_assigned_event_ids, '{}'::uuid[])
        )
      )
      and (
        not edition.is_recurrence_generated
        or exists (
          select 1
          from public.league_recurrence_occurrences occurrence
          where occurrence.event_edition_id = edition.id
            and occurrence.state = 'materialized'
        )
      )
    order by edition.start_date desc
    limit 1
  ),
  selected_series as (
    select
      series.id,
      series.organization_id,
      series.slug,
      series.name,
      series.description,
      series.location_name
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
      category.course_format,
      category.lap_count,
      category.distance_km,
      category.elevation_gain_m,
      category.capacity,
      category.registration_fee_cents,
      category.currency,
      category.minimum_age,
      category.maximum_age,
      category.allowed_genders,
      category.eligibility_note,
      category.start_at,
      category.parking_label,
      category.organizer_notes,
      category.display_order,
      category.results_mode,
      category.status,
      category.ranking_config_json
    from public.event_categories category
    join selected_edition edition
      on edition.id = category.event_edition_id
    where category.organizer_deleted_at is null
  ),
  selected_category_ids as (
    select coalesce(array_agg(category.id), '{}'::uuid[]) as ids
    from selected_categories category
  ),
  selected_rounds as (
    select
      round.id,
      round.league_season_id,
      round.event_edition_id,
      round.event_category_id,
      round.round_number,
      round.status
    from public.league_rounds round
    join selected_edition edition
      on edition.id = round.event_edition_id
  ),
  selected_seasons as (
    select distinct
      season.id,
      season.league_id,
      season.year,
      season.name,
      season.status,
      season.published_at
    from public.league_seasons season
    join selected_rounds round
      on round.league_season_id = season.id
  ),
  selected_leagues as (
    select distinct league.id, league.name
    from public.leagues league
    join selected_seasons season
      on season.league_id = league.id
  ),
  latest_publications as (
    select distinct on (publication.event_category_id)
      publication.event_category_id,
      publication.publication_state,
      publication.published_at
    from public.result_publications publication
    join selected_categories category
      on category.id = publication.event_category_id
    order by publication.event_category_id, publication.published_at desc
  )
  select case
    when not exists (select 1 from selected_edition) then null
    else jsonb_build_object(
      'edition', (
        select to_jsonb(edition)
        from selected_edition edition
      ),
      'series', (
        select to_jsonb(series)
        from selected_series series
        limit 1
      ),
      'organization', (
        select to_jsonb(organization_row)
        from (
          select organization.id, organization.name
          from public.organizations organization
          join selected_series series
            on series.organization_id = organization.id
          limit 1
        ) organization_row
      ),
      'eligible_clubs', coalesce((
        select jsonb_agg(to_jsonb(eligible_club))
        from (
          select eligible.event_edition_id, eligible.club_id
          from public.event_eligible_clubs eligible
          join selected_edition edition
            on edition.id = eligible.event_edition_id
        ) eligible_club
      ), '[]'::jsonb),
      'categories', coalesce((
        select jsonb_agg(
          to_jsonb(category)
          order by category.display_order, category.distance_km desc
        )
        from selected_categories category
      ), '[]'::jsonb),
      'league_rounds', coalesce((
        select jsonb_agg(to_jsonb(round) order by round.round_number)
        from selected_rounds round
      ), '[]'::jsonb),
      'sports', coalesce((
        select jsonb_agg(to_jsonb(sport_row))
        from (
          select sport.event_edition_id, sport.sport_code, sport.is_primary
          from public.event_edition_sports sport
          join selected_edition edition
            on edition.id = sport.event_edition_id
        ) sport_row
      ), '[]'::jsonb),
      'locations', coalesce((
        select jsonb_agg(
          to_jsonb(location_row)
          order by location_row.display_order, location_row.created_at
        )
        from (
          select
            location.id,
            location.event_edition_id,
            location.location_type,
            location.label,
            location.description,
            location.place_label,
            location.latitude,
            location.longitude,
            location.display_order,
            location.created_at
          from public.event_locations location
          join selected_edition edition
            on edition.id = location.event_edition_id
        ) location_row
      ), '[]'::jsonb),
      'registration_counts', coalesce((
        select jsonb_agg(to_jsonb(registration_count))
        from public.service_organizer_registration_counts(
          (select ids from selected_category_ids)
        ) registration_count
      ), '[]'::jsonb),
      'snapshots', coalesce((
        select jsonb_agg(to_jsonb(snapshot_row))
        from (
          select
            snapshot.event_category_id,
            snapshot.track_template_id,
            snapshot.track_version_id
          from public.event_category_track_snapshots snapshot
          join selected_categories category
            on category.id = snapshot.event_category_id
        ) snapshot_row
      ), '[]'::jsonb),
      'checkpoints', coalesce((
        select jsonb_agg(
          to_jsonb(checkpoint_row)
          order by checkpoint_row.event_category_id, checkpoint_row.sequence_number
        )
        from (
          select
            checkpoint.id,
            checkpoint.event_category_id,
            checkpoint.code,
            checkpoint.name,
            checkpoint.checkpoint_type,
            checkpoint.sequence_number,
            checkpoint.distance_from_start_km,
            checkpoint.cutoff_at,
            checkpoint.is_mandatory,
            checkpoint.settings_json
          from public.checkpoints checkpoint
          join selected_categories category
            on category.id = checkpoint.event_category_id
        ) checkpoint_row
      ), '[]'::jsonb),
      'publications', coalesce((
        select jsonb_agg(to_jsonb(publication))
        from latest_publications publication
      ), '[]'::jsonb),
      'league_seasons', coalesce((
        select jsonb_agg(to_jsonb(season))
        from selected_seasons season
      ), '[]'::jsonb),
      'leagues', coalesce((
        select jsonb_agg(to_jsonb(league))
        from selected_leagues league
      ), '[]'::jsonb)
    )
  end;
$function$;

comment on function public.service_organizer_event_detail_bundle(
  uuid,
  text,
  uuid[],
  uuid[]
) is
  'Returns one authorized organizer event detail graph in one Data API round trip. GPX, map polylines, and elevation geometry remain deferred.';

revoke all on function public.service_organizer_event_detail_bundle(
  uuid,
  text,
  uuid[],
  uuid[]
) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.service_organizer_event_detail_bundle(
      uuid,
      text,
      uuid[],
      uuid[]
    ) to service_role;
  end if;
end;
$$;
