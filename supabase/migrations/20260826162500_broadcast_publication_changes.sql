begin;

create or replace function public.build_platform_invalidation_payload(
  p_domain_event_id uuid,
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_payload_json jsonb,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  query_families jsonb;
begin
  query_families := case p_event_type
    when 'race.finish.completed' then
      '["event","league","organizer","homepage"]'::jsonb
    when 'race.category.completed' then
      '["event","results","organizer"]'::jsonb
    when 'event.edition.completed' then
      '["event","league","organizer","homepage"]'::jsonb
    when 'event.edition.publication_changed' then
      '["event","league","organizer","homepage"]'::jsonb
    when 'result.publication.committed' then
      '["event","results","athlete","club","track","league","rankings","organizer","homepage"]'::jsonb
    when 'league.round.source_changed' then
      '["league","rankings","athlete","club","organizer","homepage"]'::jsonb
    when 'league.standings.published' then
      '["league","rankings","athlete","club","organizer","homepage"]'::jsonb
    when 'league.season.publication_changed' then
      '["event","league","rankings","athlete","club","organizer","homepage"]'::jsonb
    when 'event.organizer_deleted' then
      '["event","track","league","organizer","homepage"]'::jsonb
    when 'event_category.organizer_deleted' then
      '["event","track","organizer","homepage"]'::jsonb
    when 'track.organizer_deleted' then
      '["track","organizer","homepage"]'::jsonb
    when 'track.sport_changed' then
      '["event","track","league","organizer","homepage"]'::jsonb
    else null
  end;

  if query_families is null then
    return null;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'schemaVersion', 1,
    'domainEventId', p_domain_event_id,
    'eventType', p_event_type,
    'aggregateType', p_aggregate_type,
    'aggregateId', p_aggregate_id,
    'occurredAt', p_occurred_at,
    'eventEditionId', nullif(coalesce(p_payload_json, '{}'::jsonb)->>'eventEditionId', ''),
    'eventCategoryId', nullif(coalesce(p_payload_json, '{}'::jsonb)->>'eventCategoryId', ''),
    'leagueSeasonId', nullif(coalesce(p_payload_json, '{}'::jsonb)->>'leagueSeasonId', ''),
    'publicationState', nullif(coalesce(p_payload_json, '{}'::jsonb)->>'publicationState', ''),
    'queryFamilies', query_families
  ));
end;
$$;

create or replace function public.enqueue_event_edition_publication_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_organization_id uuid;
  correlation_id uuid := gen_random_uuid();
  publication_state text;
begin
  if row(old.published_at, old.public_visibility, old.status)
     is not distinct from row(new.published_at, new.public_visibility, new.status) then
    return new;
  end if;

  select series.organization_id
  into resolved_organization_id
  from public.event_series series
  where series.id = new.event_series_id;

  publication_state := case
    when new.published_at is not null
      and new.public_visibility = 'public'
      and new.status::text <> 'draft'
      then 'published'
    else 'private'
  end;

  insert into public.domain_events (
    organization_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload_json,
    correlation_id,
    idempotency_key
  )
  values (
    resolved_organization_id,
    'event.edition.publication_changed',
    'event_edition',
    new.id,
    jsonb_build_object(
      'eventEditionId', new.id,
      'publicationState', publication_state
    ),
    correlation_id,
    correlation_id::text
  );

  return new;
end;
$$;

drop trigger if exists event_editions_enqueue_publication_invalidation
  on public.event_editions;
create trigger event_editions_enqueue_publication_invalidation
after update of published_at, public_visibility, status on public.event_editions
for each row execute function public.enqueue_event_edition_publication_invalidation();

create or replace function public.enqueue_league_season_publication_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_organization_id uuid;
  correlation_id uuid := gen_random_uuid();
  publication_state text;
begin
  if row(old.published_at, old.status)
     is not distinct from row(new.published_at, new.status) then
    return new;
  end if;

  select league.organization_id
  into resolved_organization_id
  from public.leagues league
  where league.id = new.league_id;

  publication_state := case
    when new.published_at is not null and new.status <> 'draft' then 'published'
    else 'private'
  end;

  insert into public.domain_events (
    organization_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload_json,
    correlation_id,
    idempotency_key
  )
  values (
    resolved_organization_id,
    'league.season.publication_changed',
    'league_season',
    new.id,
    jsonb_build_object(
      'leagueSeasonId', new.id,
      'publicationState', publication_state
    ),
    correlation_id,
    correlation_id::text
  );

  return new;
end;
$$;

drop trigger if exists league_seasons_enqueue_publication_invalidation
  on public.league_seasons;
create trigger league_seasons_enqueue_publication_invalidation
after update of published_at, status on public.league_seasons
for each row execute function public.enqueue_league_season_publication_invalidation();

revoke all on function public.enqueue_event_edition_publication_invalidation()
  from public, anon, authenticated;
revoke all on function public.enqueue_league_season_publication_invalidation()
  from public, anon, authenticated;

comment on function public.enqueue_event_edition_publication_invalidation() is
  'Enqueues public cache invalidation whenever an event edition is published, unpublished, or changes public lifecycle state.';
comment on function public.enqueue_league_season_publication_invalidation() is
  'Enqueues public cache invalidation whenever a league season is published, unpublished, or republished.';

commit;
