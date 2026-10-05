/*
 * Reverse an accidental registration check-in while the runner has not
 * started. Keep the state change and audit record atomic.
 */

create or replace function public.service_undo_registration_check_in(
  p_registration_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_registration public.registrations%rowtype;
  target_checkin public.checkins%rowtype;
  target_organization_id uuid;
begin
  select registration.*
  into target_registration
  from public.registrations registration
  where registration.id = p_registration_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'registration_not_found';
  end if;
  if target_registration.participation_status::text <> 'checked_in' then
    raise exception using errcode = 'P0001', message = 'registration_check_in_cannot_be_undone';
  end if;

  select checkin.*
  into target_checkin
  from public.checkins checkin
  where checkin.registration_id = target_registration.id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'registration_check_in_not_found';
  end if;

  select series.organization_id
  into target_organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = target_registration.event_category_id;

  delete from public.checkins checkin
  where checkin.id = target_checkin.id;

  update public.registrations registration
  set
    participation_status = 'not_started',
    updated_at = now()
  where registration.id = target_registration.id;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    target_organization_id,
    p_actor_user_id,
    'registration',
    target_registration.id,
    'race_day_desk.check_in_undone',
    jsonb_build_object(
      'checkinId', target_checkin.id,
      'checkedInAt', target_checkin.checked_in_at,
      'locationLabel', target_checkin.location_label
    )
  );

  return jsonb_build_object(
    'registrationId', target_registration.id,
    'participationStatus', 'not_started',
    'checkedInAt', null
  );
end;
$$;

revoke all on function public.service_undo_registration_check_in(
  uuid, uuid
) from public, anon, authenticated;

grant execute on function public.service_undo_registration_check_in(
  uuid, uuid
) to service_role;
