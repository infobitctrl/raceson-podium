begin;

create or replace function public.service_delete_platform_record(
  p_actor_user_id uuid,
  p_record_type text,
  p_record_id uuid,
  p_confirmation_name text,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  record_name text;
  record_slug text;
  record_is_claimed boolean := false;
  record_claimed_by_user_id uuid;
  has_protected_history boolean := false;
  club_result jsonb;
begin
  if not exists (
    select 1
    from public.platform_administrators administrator
    where administrator.user_id = p_actor_user_id
      and administrator.is_active
      and administrator.platform_role = 'super_admin'
  ) then
    raise exception using errcode = '42501', message = 'super_administrator_required';
  end if;

  if p_record_type not in ('athlete', 'club', 'track', 'event', 'league') then
    raise exception using errcode = '22023', message = 'unsupported_platform_record_type';
  end if;

  if p_reason is null or length(trim(p_reason)) < 8 then
    raise exception using errcode = '22023', message = 'platform_record_deletion_reason_required';
  end if;

  if p_record_type = 'athlete' then
    select profile.display_name, profile.slug, profile.is_claimed, profile.claimed_by_user_id
    into record_name, record_slug, record_is_claimed, record_claimed_by_user_id
    from public.athlete_profiles profile
    where profile.id = p_record_id
    for update;
  elsif p_record_type = 'club' then
    select club.name, club.slug
    into record_name, record_slug
    from public.clubs club
    where club.id = p_record_id
    for update;
  elsif p_record_type = 'track' then
    select template.name, template.slug
    into record_name, record_slug
    from public.track_templates template
    where template.id = p_record_id
    for update;
  elsif p_record_type = 'event' then
    select series.name, series.slug
    into record_name, record_slug
    from public.event_series series
    where series.id = p_record_id
    for update;
  else
    select league.name, league.slug
    into record_name, record_slug
    from public.leagues league
    where league.id = p_record_id
    for update;
  end if;

  if record_name is null then
    raise exception using errcode = 'P0002', message = 'platform_record_not_found';
  end if;

  if trim(coalesce(p_confirmation_name, '')) <> record_name then
    raise exception using errcode = '22023', message = 'platform_record_confirmation_mismatch';
  end if;

  if p_record_type = 'club' then
    club_result := public.service_delete_platform_club(p_actor_user_id, p_record_id);

    insert into public.audit_log (
      actor_user_id,
      entity_type,
      entity_id,
      action,
      metadata_json
    ) values (
      p_actor_user_id,
      'club',
      p_record_id,
      'platform.club_deletion_reason_recorded',
      jsonb_build_object(
        'recordName', record_name,
        'recordSlug', record_slug,
        'reason', trim(p_reason)
      )
    );

    return jsonb_build_object(
      'deleted', true,
      'recordType', p_record_type,
      'recordId', p_record_id,
      'details', club_result
    );
  end if;

  if p_record_type = 'athlete' then
    if record_is_claimed or record_claimed_by_user_id is not null then
      raise exception using errcode = '55000', message = 'athlete_profile_is_claimed';
    end if;

    select exists (
      select 1 from public.registrations registration
      where registration.athlete_profile_id = p_record_id
      union all
      select 1 from public.result_rows result
      where result.athlete_profile_id = p_record_id
      union all
      select 1 from public.club_memberships membership
      where membership.athlete_profile_id = p_record_id
      union all
      select 1 from public.track_attempts attempt
      where attempt.athlete_profile_id = p_record_id
      union all
      select 1 from public.athlete_activities activity
      where activity.athlete_profile_id = p_record_id
      union all
      select 1 from public.athlete_badges badge
      where badge.athlete_profile_id = p_record_id
      union all
      select 1 from public.athlete_claims claim
      where claim.athlete_profile_id = p_record_id
      union all
      select 1 from public.event_photo_submissions photo
      where photo.athlete_profile_id = p_record_id
      union all
      select 1 from public.event_reviews review
      where review.athlete_profile_id = p_record_id
      union all
      select 1 from public.track_reviews review
      where review.athlete_profile_id = p_record_id
      union all
      select 1 from public.track_condition_reports report
      where report.athlete_profile_id = p_record_id
      union all
      select 1 from public.league_individual_standing_rows standing
      where standing.athlete_profile_id = p_record_id
      union all
      select 1 from public.athlete_profiles merged_profile
      where merged_profile.merged_into_athlete_profile_id = p_record_id
      limit 1
    ) into has_protected_history;

    if has_protected_history then
      raise exception using errcode = '55000', message = 'athlete_profile_has_protected_history';
    end if;
  elsif p_record_type = 'track' then
    select exists (
      select 1 from public.event_category_track_snapshots snapshot
      where snapshot.track_template_id = p_record_id
      union all
      select 1 from public.league_recurrence_rules recurrence
      where recurrence.track_template_id = p_record_id
      union all
      select 1 from public.track_attempts attempt
      where attempt.track_template_id = p_record_id
      union all
      select 1 from public.athlete_activities activity
      where activity.track_template_id = p_record_id
      union all
      select 1 from public.track_reviews review
      where review.track_template_id = p_record_id
      union all
      select 1 from public.track_condition_reports report
      where report.track_template_id = p_record_id
      union all
      select 1 from public.badge_definitions badge
      where badge.track_template_id = p_record_id
      limit 1
    ) into has_protected_history;

    if has_protected_history then
      raise exception using errcode = '55000', message = 'track_has_protected_history';
    end if;
  elsif p_record_type = 'event' then
    select exists (
      select 1
      from public.event_editions edition
      where edition.event_series_id = p_record_id
        and (edition.status <> 'draft' or edition.published_at is not null)
      union all
      select 1
      from public.registrations registration
      join public.event_categories category on category.id = registration.event_category_id
      join public.event_editions edition on edition.id = category.event_edition_id
      where edition.event_series_id = p_record_id
      union all
      select 1
      from public.result_rows result
      join public.event_categories category on category.id = result.event_category_id
      join public.event_editions edition on edition.id = category.event_edition_id
      where edition.event_series_id = p_record_id
      union all
      select 1 from public.league_recurrence_rules recurrence
      where recurrence.event_series_id = p_record_id
      union all
      select 1
      from public.league_round_events round_event
      join public.event_editions edition on edition.id = round_event.event_edition_id
      where edition.event_series_id = p_record_id
      union all
      select 1
      from public.event_reviews review
      join public.event_editions edition on edition.id = review.event_edition_id
      where edition.event_series_id = p_record_id
      union all
      select 1
      from public.event_photo_submissions photo
      join public.event_editions edition on edition.id = photo.event_edition_id
      where edition.event_series_id = p_record_id
      union all
      select 1
      from public.timing_sessions timing
      join public.event_editions edition on edition.id = timing.event_edition_id
      where edition.event_series_id = p_record_id
      union all
      select 1
      from public.safety_incidents incident
      join public.event_editions edition on edition.id = incident.event_edition_id
      where edition.event_series_id = p_record_id
      limit 1
    ) into has_protected_history;

    if has_protected_history then
      raise exception using errcode = '55000', message = 'event_has_protected_history';
    end if;
  elsif p_record_type = 'league' then
    select exists (
      select 1
      from public.league_seasons season
      where season.league_id = p_record_id
        and (season.status <> 'draft' or season.published_at is not null)
      union all
      select 1
      from public.league_individual_standings standing
      join public.league_seasons season on season.id = standing.league_season_id
      where season.league_id = p_record_id
      union all
      select 1
      from public.league_club_standings standing
      join public.league_seasons season on season.id = standing.league_season_id
      where season.league_id = p_record_id
      union all
      select 1
      from public.league_standings_versions standing
      join public.league_seasons season on season.id = standing.league_season_id
      where season.league_id = p_record_id
      union all
      select 1
      from public.league_standings_events standing_event
      join public.league_seasons season on season.id = standing_event.league_season_id
      where season.league_id = p_record_id
      union all
      select 1
      from public.legacy_import_review_batches import_batch
      join public.league_seasons season on season.id = import_batch.league_season_id
      where season.league_id = p_record_id
      limit 1
    ) into has_protected_history;

    if has_protected_history then
      raise exception using errcode = '55000', message = 'league_has_protected_history';
    end if;
  end if;

  insert into public.audit_log (
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  ) values (
    p_actor_user_id,
    p_record_type,
    p_record_id,
    'platform.' || p_record_type || '_deleted',
    jsonb_build_object(
      'recordName', record_name,
      'recordSlug', record_slug,
      'reason', trim(p_reason)
    )
  );

  begin
    if p_record_type = 'athlete' then
      delete from public.athlete_profiles where id = p_record_id;
    elsif p_record_type = 'track' then
      delete from public.track_templates where id = p_record_id;
    elsif p_record_type = 'event' then
      delete from public.event_series where id = p_record_id;
    else
      delete from public.leagues where id = p_record_id;
    end if;
  exception
    when foreign_key_violation
      or restrict_violation
      or check_violation
      or object_not_in_prerequisite_state then
        raise exception using errcode = '55000', message = p_record_type || '_has_protected_history';
  end;

  return jsonb_build_object(
    'deleted', true,
    'recordType', p_record_type,
    'recordId', p_record_id
  );
end;
$$;

revoke all on function public.service_delete_platform_record(uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.service_delete_platform_record(uuid, text, uuid, text, text)
  to service_role;

comment on function public.service_delete_platform_record(uuid, text, uuid, text, text) is
  'Deletes a disposable canonical platform record after super-admin authorization, typed confirmation, dependency checks, and an atomic audit entry.';

commit;
