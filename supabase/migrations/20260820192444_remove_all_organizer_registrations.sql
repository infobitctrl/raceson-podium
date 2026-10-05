/*
 * Remove every visible registration from one organizer event in a single
 * transaction while preserving the finance and race-day evidence retained by
 * the existing single-registration removal workflow.
 */

create or replace function public.service_remove_all_event_registrations(
  p_event_edition_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_registration record;
  target_organization_id uuid;
  removed_count integer := 0;
  cancelled_count integer := 0;
  removed_at timestamptz := clock_timestamp();
begin
  perform 1
  from public.event_editions edition
  where edition.id = p_event_edition_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'event_not_found';
  end if;

  perform 1
  from public.event_categories category
  where category.event_edition_id = p_event_edition_id
  for update;

  select series.organization_id
  into target_organization_id
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = p_event_edition_id;

  for target_registration in
    select registration.id, registration.status
    from public.registrations registration
    join public.event_categories category
      on category.id = registration.event_category_id
    where category.event_edition_id = p_event_edition_id
      and registration.organizer_removed_at is null
    order by registration.created_at, registration.id
    for update of registration
  loop
    if target_registration.status not in ('cancelled', 'expired', 'transferred', 'deferred') then
      perform public.service_cancel_registration_atomically(
        target_registration.id,
        p_actor_user_id,
        'organizer_removed_all'
      );
      cancelled_count := cancelled_count + 1;
    end if;
  end loop;

  update public.registrations registration
  set
    organizer_removed_at = removed_at,
    organizer_removed_by_user_id = p_actor_user_id,
    updated_at = removed_at
  where registration.organizer_removed_at is null
    and registration.event_category_id in (
      select category.id
      from public.event_categories category
      where category.event_edition_id = p_event_edition_id
    );

  get diagnostics removed_count = row_count;

  if removed_count > 0 then
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
      'event_edition',
      p_event_edition_id,
      'registration.bulk_removed',
      jsonb_build_object(
        'removedCount', removed_count,
        'cancelledCount', cancelled_count,
        'removedAt', removed_at
      )
    );
  end if;

  return jsonb_build_object(
    'eventEditionId', p_event_edition_id,
    'removedCount', removed_count,
    'cancelledCount', cancelled_count
  );
end;
$$;

revoke all on function public.service_remove_all_event_registrations(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.service_remove_all_event_registrations(uuid, uuid)
  to service_role;
