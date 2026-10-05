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
    when 'result.publication.committed' then
      '["event","results","athlete","club","track","league","rankings","organizer","homepage"]'::jsonb
    when 'league.round.source_changed' then
      '["league","rankings","athlete","club","organizer","homepage"]'::jsonb
    when 'league.standings.published' then
      '["league","rankings","athlete","club","organizer","homepage"]'::jsonb
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

create or replace function public.service_update_organizer_track_sport(
  p_track_template_id uuid,
  p_organization_id uuid,
  p_sport_code text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  track_row public.track_templates%rowtype;
  affected_category_ids uuid[] := '{}'::uuid[];
  affected_event_edition_ids uuid[] := '{}'::uuid[];
  affected_category_count integer := 0;
  previous_primary_sport text;
  next_primary_sport text;
  next_sport_codes text[];
  affected_edition_id uuid;
  domain_event_id uuid := gen_random_uuid();
begin
  if not exists (
    select 1
    from public.sport_disciplines discipline
    where discipline.code = p_sport_code
      and discipline.is_active
  ) then
    raise exception using errcode = '22023', message = 'track_sport_invalid';
  end if;

  select template.*
  into track_row
  from public.track_templates template
  where template.id = p_track_template_id
    and template.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'track_not_found';
  end if;

  perform 1
  from public.event_category_track_snapshots snapshot
  join public.event_categories category
    on category.id = snapshot.event_category_id
  where snapshot.track_template_id = p_track_template_id
    and category.organizer_deleted_at is null
  for update of category;

  if exists (
    select 1
    from public.event_category_track_snapshots snapshot
    join public.event_categories category
      on category.id = snapshot.event_category_id
    join public.event_editions edition
      on edition.id = category.event_edition_id
    where snapshot.track_template_id = p_track_template_id
      and category.organizer_deleted_at is null
      and category.sport_code is distinct from p_sport_code
      and (
        edition.status = 'completed'
        or exists (
          select 1
          from public.race_start_events start_event
          where start_event.event_category_id = category.id
        )
        or exists (
          select 1
          from public.punch_events punch
          where punch.event_category_id = category.id
            and not punch.is_voided
        )
        or exists (
          select 1
          from public.result_runs result_run
          where result_run.event_category_id = category.id
        )
        or exists (
          select 1
          from public.result_publications publication
          where publication.event_category_id = category.id
        )
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'track_sport_change_has_historical_race';
  end if;

  select
    coalesce(array_agg(distinct category.id), '{}'::uuid[]),
    coalesce(array_agg(distinct category.event_edition_id), '{}'::uuid[])
  into affected_category_ids, affected_event_edition_ids
  from public.event_category_track_snapshots snapshot
  join public.event_categories category
    on category.id = snapshot.event_category_id
  where snapshot.track_template_id = p_track_template_id
    and category.organizer_deleted_at is null
    and category.sport_code is distinct from p_sport_code;

  if track_row.sport_code = p_sport_code
     and cardinality(affected_category_ids) = 0 then
    return jsonb_build_object(
      'trackTemplateId', p_track_template_id,
      'sportCode', p_sport_code,
      'affectedCategoryCount', 0,
      'affectedEventEditionIds', '[]'::jsonb,
      'changed', false
    );
  end if;

  update public.track_templates template
  set sport_code = p_sport_code
  where template.id = p_track_template_id
    and template.sport_code is distinct from p_sport_code;

  update public.event_categories category
  set sport_code = p_sport_code
  where category.id = any(affected_category_ids);
  get diagnostics affected_category_count = row_count;

  foreach affected_edition_id in array affected_event_edition_ids loop
    select assignment.sport_code
    into previous_primary_sport
    from public.event_edition_sports assignment
    where assignment.event_edition_id = affected_edition_id
      and assignment.is_primary
    limit 1;

    select array_agg(distinct category.sport_code order by category.sport_code)
    into next_sport_codes
    from public.event_categories category
    where category.event_edition_id = affected_edition_id
      and category.organizer_deleted_at is null;

    if coalesce(cardinality(next_sport_codes), 0) = 0 then
      continue;
    end if;

    next_primary_sport := case
      when previous_primary_sport = any(next_sport_codes) then previous_primary_sport
      when p_sport_code = any(next_sport_codes) then p_sport_code
      else next_sport_codes[1]
    end;

    delete from public.event_edition_sports assignment
    where assignment.event_edition_id = affected_edition_id;

    insert into public.event_edition_sports (
      event_edition_id,
      sport_code,
      is_primary
    )
    select
      affected_edition_id,
      next_sport_code,
      next_sport_code = next_primary_sport
    from unnest(next_sport_codes) next_sport_code;
  end loop;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'track_template',
    p_track_template_id,
    'track.sport_changed',
    jsonb_build_object(
      'previousSportCode', track_row.sport_code,
      'sportCode', p_sport_code,
      'affectedCategoryIds', to_jsonb(affected_category_ids),
      'affectedEventEditionIds', to_jsonb(affected_event_edition_ids)
    )
  );

  insert into public.domain_events (
    id,
    organization_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload_json,
    actor_user_id,
    correlation_id,
    idempotency_key
  )
  values (
    domain_event_id,
    p_organization_id,
    'track.sport_changed',
    'track_template',
    p_track_template_id,
    jsonb_build_object(
      'trackTemplateId', p_track_template_id,
      'previousSportCode', track_row.sport_code,
      'sportCode', p_sport_code,
      'affectedCategoryIds', to_jsonb(affected_category_ids),
      'affectedEventEditionIds', to_jsonb(affected_event_edition_ids)
    ),
    p_actor_user_id,
    domain_event_id,
    domain_event_id::text
  );

  return jsonb_build_object(
    'trackTemplateId', p_track_template_id,
    'sportCode', p_sport_code,
    'affectedCategoryCount', affected_category_count,
    'affectedEventEditionIds', to_jsonb(affected_event_edition_ids),
    'domainEventId', domain_event_id,
    'changed', true
  );
end;
$$;

revoke all on function public.service_update_organizer_track_sport(uuid, uuid, text, uuid)
  from public;
grant execute on function public.service_update_organizer_track_sport(uuid, uuid, text, uuid)
  to service_role;

do $$
declare
  drifted_track record;
begin
  for drifted_track in
    select distinct
      template.id,
      template.organization_id,
      template.sport_code
    from public.track_templates template
    join public.event_category_track_snapshots snapshot
      on snapshot.track_template_id = template.id
    join public.event_categories category
      on category.id = snapshot.event_category_id
    where category.organizer_deleted_at is null
      and category.sport_code is distinct from template.sport_code
      and not exists (
        select 1
        from public.event_category_track_snapshots unsafe_snapshot
        join public.event_categories unsafe_category
          on unsafe_category.id = unsafe_snapshot.event_category_id
        join public.event_editions unsafe_edition
          on unsafe_edition.id = unsafe_category.event_edition_id
        where unsafe_snapshot.track_template_id = template.id
          and unsafe_category.organizer_deleted_at is null
          and unsafe_category.sport_code is distinct from template.sport_code
          and (
            unsafe_edition.status = 'completed'
            or exists (
              select 1 from public.race_start_events start_event
              where start_event.event_category_id = unsafe_category.id
            )
            or exists (
              select 1 from public.punch_events punch
              where punch.event_category_id = unsafe_category.id
                and not punch.is_voided
            )
            or exists (
              select 1 from public.result_runs result_run
              where result_run.event_category_id = unsafe_category.id
            )
            or exists (
              select 1 from public.result_publications publication
              where publication.event_category_id = unsafe_category.id
            )
          )
      )
  loop
    perform public.service_update_organizer_track_sport(
      drifted_track.id,
      drifted_track.organization_id,
      drifted_track.sport_code,
      null
    );
  end loop;
end;
$$;

commit;
