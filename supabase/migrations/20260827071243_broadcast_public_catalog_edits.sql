begin;

-- Publishing is not the only public change. In particular, registration
-- windows and schedule edits can change the rendered lifecycle without
-- changing the stored publication status.
create or replace function app_private.enqueue_public_catalog_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  edition_ids uuid[] := '{}'::uuid[];
  season_ids uuid[] := '{}'::uuid[];
  context_row record;
  correlation_id uuid;
begin
  if (to_jsonb(old) - 'updated_at') is not distinct from (to_jsonb(new) - 'updated_at') then
    return new;
  end if;

  case tg_table_name
    when 'event_editions' then edition_ids := array[new.id];
    when 'event_categories' then edition_ids := array[new.event_edition_id];
    when 'event_series' then
      select array_agg(edition.id) into edition_ids
      from public.event_editions edition where edition.event_series_id = new.id;
    when 'league_seasons' then season_ids := array[new.id];
    when 'leagues' then
      select array_agg(season.id) into season_ids
      from public.league_seasons season where season.league_id = new.id;
    else return new;
  end case;

  for context_row in
    select edition.id, series.organization_id, 'event_edition'::text as aggregate_type,
      'event.edition.publication_changed'::text as event_type,
      jsonb_build_object('eventEditionId', edition.id, 'publicationState', 'published') as payload
    from public.event_editions edition
    join public.event_series series on series.id = edition.event_series_id
    where edition.id = any(edition_ids)
      and edition.published_at is not null and edition.status <> 'draft'
      and edition.public_visibility = 'public' and edition.organizer_deleted_at is null
    union all
    select season.id, league.organization_id, 'league_season'::text,
      'league.season.publication_changed'::text,
      jsonb_build_object('leagueSeasonId', season.id, 'publicationState', 'published')
    from public.league_seasons season
    join public.leagues league on league.id = season.league_id
    where season.id = any(season_ids) and season.published_at is not null
  loop
    correlation_id := gen_random_uuid();
    insert into public.domain_events (
      organization_id, event_type, aggregate_type, aggregate_id,
      payload_json, correlation_id, idempotency_key
    ) values (
      context_row.organization_id, context_row.event_type, context_row.aggregate_type,
      context_row.id, context_row.payload, correlation_id, correlation_id::text
    );
  end loop;

  return new;
end;
$$;

revoke all on function app_private.enqueue_public_catalog_edit()
  from public, anon, authenticated;

create trigger event_editions_enqueue_catalog_edit
after update of name, slug, start_date, end_date, timezone, location_name,
  registration_open_at, registration_close_at, cover_image_url, about_text,
  organizer_rules, website_url, instagram_url, facebook_url, general_timeline_json,
  activity_type, registration_access, results_visibility
on public.event_editions
for each row execute function app_private.enqueue_public_catalog_edit();

create trigger event_categories_enqueue_catalog_edit
after update of name, slug, start_at, status, capacity, distance_km,
  elevation_gain_m, registration_fee_cents, currency, results_mode,
  organizer_deleted_at, sport_code, cover_image_url, display_order, course_format,
  lap_count, minimum_age, maximum_age, allowed_genders, eligibility_note
on public.event_categories
for each row execute function app_private.enqueue_public_catalog_edit();

create trigger event_series_enqueue_catalog_edit
after update of name, slug, description, location_name, country_code, organization_id
on public.event_series
for each row execute function app_private.enqueue_public_catalog_edit();

create trigger league_seasons_enqueue_catalog_edit
after update of name, year, starts_on, ends_on, timezone, organizer_rules, club_scoring_scope
on public.league_seasons
for each row execute function app_private.enqueue_public_catalog_edit();

create trigger leagues_enqueue_catalog_edit
after update of name, slug, description, status, organization_id
on public.leagues
for each row execute function app_private.enqueue_public_catalog_edit();

commit;
