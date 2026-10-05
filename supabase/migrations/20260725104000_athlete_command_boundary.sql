/*
 * Authenticated athlete commands are issued by the application API with the
 * service role. Each function performs its mutation and audit append in one
 * database transaction. Browser roles cannot execute these functions.
 */

create or replace function public.service_submit_track_condition_report(
  p_actor_user_id uuid,
  p_athlete_profile_id uuid,
  p_track_slug text,
  p_status public.track_condition_report_status,
  p_title text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_track public.track_templates%rowtype;
  created_report public.track_condition_reports%rowtype;
begin
  select track.*
  into target_track
  from public.track_templates track
  where track.slug = p_track_slug
    and exists (
      select 1
      from public.track_versions version
      where version.track_template_id = track.id
        and version.published_at is not null
    );

  if not found then
    raise exception 'Published track not found'
      using errcode = 'P0002';
  end if;

  insert into public.track_condition_reports (
    track_template_id,
    athlete_profile_id,
    status,
    title,
    note
  )
  values (
    target_track.id,
    p_athlete_profile_id,
    p_status,
    nullif(trim(p_title), ''),
    trim(p_note)
  )
  returning *
  into created_report;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    target_track.organization_id,
    p_actor_user_id,
    'track_condition_report',
    created_report.id,
    'athlete.track_condition_report.created',
    jsonb_build_object(
      'track_template_id', target_track.id,
      'status', created_report.status
    )
  );

  return jsonb_build_object(
    'id', created_report.id,
    'trackTemplateId', target_track.id,
    'status', created_report.status
  );
end;
$$;

create or replace function public.service_upsert_track_review(
  p_actor_user_id uuid,
  p_athlete_profile_id uuid,
  p_track_slug text,
  p_rating smallint,
  p_title text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_track public.track_templates%rowtype;
  saved_review public.track_reviews%rowtype;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5'
      using errcode = '22023';
  end if;

  select track.*
  into target_track
  from public.track_templates track
  where track.slug = p_track_slug
    and exists (
      select 1
      from public.track_versions version
      where version.track_template_id = track.id
        and version.published_at is not null
    );

  if not found then
    raise exception 'Published track not found'
      using errcode = 'P0002';
  end if;

  insert into public.track_reviews (
    track_template_id,
    athlete_profile_id,
    rating,
    title,
    body
  )
  values (
    target_track.id,
    p_athlete_profile_id,
    p_rating,
    nullif(trim(p_title), ''),
    trim(p_body)
  )
  on conflict (track_template_id, athlete_profile_id)
  do update
  set
    rating = excluded.rating,
    title = excluded.title,
    body = excluded.body,
    updated_at = now()
  returning *
  into saved_review;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    target_track.organization_id,
    p_actor_user_id,
    'track_review',
    saved_review.id,
    'athlete.track_review.saved',
    jsonb_build_object(
      'track_template_id', target_track.id,
      'rating', saved_review.rating
    )
  );

  return jsonb_build_object(
    'id', saved_review.id,
    'trackTemplateId', target_track.id,
    'rating', saved_review.rating
  );
end;
$$;

create or replace function public.service_remove_event_favorite(
  p_actor_user_id uuid,
  p_athlete_profile_id uuid,
  p_event_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event_id uuid;
  deleted_favorite_id uuid;
begin
  select edition.id
  into target_event_id
  from public.event_editions edition
  where edition.slug = p_event_slug;

  if target_event_id is null then
    raise exception 'Saved race not found'
      using errcode = 'P0002';
  end if;

  delete from public.athlete_favorites favorite
  where favorite.athlete_profile_id = p_athlete_profile_id
    and favorite.entity_type = 'event_edition'::public.athlete_favorite_entity_type
    and favorite.event_edition_id = target_event_id
  returning favorite.id
  into deleted_favorite_id;

  if deleted_favorite_id is not null then
    insert into public.audit_log (
      actor_user_id,
      entity_type,
      entity_id,
      action,
      metadata_json
    )
    values (
      p_actor_user_id,
      'athlete_favorite',
      deleted_favorite_id,
      'athlete.event_favorite.removed',
      jsonb_build_object('event_edition_id', target_event_id)
    );
  end if;

  return jsonb_build_object(
    'eventEditionId', target_event_id,
    'removed', deleted_favorite_id is not null
  );
end;
$$;

create or replace function public.service_join_club(
  p_actor_user_id uuid,
  p_athlete_profile_id uuid,
  p_club_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club public.clubs%rowtype;
  target_status public.club_membership_status;
  saved_membership public.club_memberships%rowtype;
  active_membership_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_athlete_profile_id::text, 901));

  select club.*
  into target_club
  from public.clubs club
  where club.id = p_club_id
    and club.status = 'active';

  if not found then
    raise exception 'Club not found'
      using errcode = 'P0002';
  end if;

  if coalesce(target_club.privacy_level, 'public') = 'invite_only' then
    raise exception 'This club is invite only'
      using errcode = '42501';
  end if;

  target_status :=
    case
      when coalesce(target_club.privacy_level, 'public') = 'public'
        and not coalesce(target_club.requires_approval, false)
        then 'active'::public.club_membership_status
      else 'pending'::public.club_membership_status
    end;

  if target_status = 'active'::public.club_membership_status then
    select count(*)
    into active_membership_count
    from public.club_memberships membership
    where membership.athlete_profile_id = p_athlete_profile_id
      and membership.status = 'active'::public.club_membership_status
      and membership.club_id <> p_club_id;

    if active_membership_count >= 3 then
      raise exception 'You can join up to 3 clubs at the same time.'
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.club_memberships (
    club_id,
    athlete_profile_id,
    status,
    joined_at
  )
  values (
    p_club_id,
    p_athlete_profile_id,
    target_status,
    case when target_status = 'active' then now() else null end
  )
  on conflict (club_id, athlete_profile_id)
  do update
  set
    status = excluded.status,
    joined_at = excluded.joined_at,
    updated_at = now()
  returning *
  into saved_membership;

  insert into public.audit_log (
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    p_actor_user_id,
    'club_membership',
    saved_membership.id,
    case
      when target_status = 'active' then 'athlete.club.joined'
      else 'athlete.club.requested'
    end,
    jsonb_build_object(
      'club_id', p_club_id,
      'status', target_status
    )
  );

  return jsonb_build_object(
    'membershipId', saved_membership.id,
    'clubId', p_club_id,
    'status', target_status,
    'changed', true
  );
end;
$$;

create or replace function public.service_leave_club(
  p_actor_user_id uuid,
  p_athlete_profile_id uuid,
  p_club_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_membership public.club_memberships%rowtype;
begin
  update public.club_memberships membership
  set
    status = 'removed'::public.club_membership_status,
    is_primary = false,
    joined_at = null,
    updated_at = now()
  where membership.club_id = p_club_id
    and membership.athlete_profile_id = p_athlete_profile_id
    and membership.status in (
      'active'::public.club_membership_status,
      'pending'::public.club_membership_status
    )
  returning *
  into saved_membership;

  if saved_membership.id is not null then
    insert into public.audit_log (
      actor_user_id,
      entity_type,
      entity_id,
      action,
      metadata_json
    )
    values (
      p_actor_user_id,
      'club_membership',
      saved_membership.id,
      'athlete.club.left',
      jsonb_build_object('club_id', p_club_id)
    );
  end if;

  return jsonb_build_object(
    'membershipId', saved_membership.id,
    'clubId', p_club_id,
    'status', 'removed',
    'changed', saved_membership.id is not null
  );
end;
$$;

revoke execute on function public.service_submit_track_condition_report(
  uuid,
  uuid,
  text,
  public.track_condition_report_status,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.service_submit_track_condition_report(
  uuid,
  uuid,
  text,
  public.track_condition_report_status,
  text,
  text
) to service_role;

revoke execute on function public.service_upsert_track_review(
  uuid,
  uuid,
  text,
  smallint,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.service_upsert_track_review(
  uuid,
  uuid,
  text,
  smallint,
  text,
  text
) to service_role;

revoke execute on function public.service_remove_event_favorite(
  uuid,
  uuid,
  text
) from public, anon, authenticated;
grant execute on function public.service_remove_event_favorite(
  uuid,
  uuid,
  text
) to service_role;

revoke execute on function public.service_join_club(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function public.service_join_club(
  uuid,
  uuid,
  uuid
) to service_role;

revoke execute on function public.service_leave_club(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function public.service_leave_club(
  uuid,
  uuid,
  uuid
) to service_role;
