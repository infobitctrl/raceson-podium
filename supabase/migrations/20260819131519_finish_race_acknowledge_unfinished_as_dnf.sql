begin;

create or replace function public.service_finish_race_categories(
  p_event_edition_id uuid,
  p_event_category_ids uuid[],
  p_actor_user_id uuid,
  p_client_event_id uuid,
  p_acknowledge_unfinished_as_dnf boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  unfinished_registration public.registrations%rowtype;
  unfinished_participant_count integer := 0;
  marked_dnf_count integer := 0;
  finish_result jsonb;
begin
  if p_acknowledge_unfinished_as_dnf is null then
    raise exception using errcode = '22023', message = 'race_finish_acknowledgement_invalid';
  end if;

  select count(*)::integer
  into unfinished_participant_count
  from public.registrations registration
  where registration.event_category_id = any(p_event_category_ids)
    and registration.status = 'confirmed'
    and registration.participation_status in ('not_started', 'checked_in', 'started', 'missing');

  if unfinished_participant_count > 0 and not p_acknowledge_unfinished_as_dnf then
    raise exception using
      errcode = 'P0001',
      message = 'race_finish_unfinished_acknowledgement_required',
      detail = unfinished_participant_count::text;
  end if;

  if p_acknowledge_unfinished_as_dnf then
    for unfinished_registration in
      select registration.*
      from public.registrations registration
      where registration.event_category_id = any(p_event_category_ids)
        and registration.status = 'confirmed'
        and registration.participation_status in ('not_started', 'checked_in', 'started', 'missing')
      order by registration.event_category_id, registration.id
      for update
    loop
      perform public.service_record_participant_status(
        unfinished_registration.id,
        p_actor_user_id,
        'dnf',
        clock_timestamp(),
        'Race finished by the organizer; unfinished participant acknowledged as DNF.',
        gen_random_uuid(),
        true,
        jsonb_build_object(
          'source', 'race_finish_acknowledgement',
          'eventEditionId', p_event_edition_id,
          'clientEventId', p_client_event_id
        )
      );
      marked_dnf_count := marked_dnf_count + 1;
    end loop;
  end if;

  finish_result := public.service_finish_race_categories(
    p_event_edition_id,
    p_event_category_ids,
    p_actor_user_id,
    p_client_event_id
  );

  return finish_result || jsonb_build_object(
    'unfinishedParticipantCount', unfinished_participant_count,
    'markedDnfCount', marked_dnf_count
  );
end;
$$;

comment on function public.service_finish_race_categories(uuid,uuid[],uuid,uuid,boolean) is
  'Server-only race completion. Requires explicit acknowledgement before atomically marking every unresolved confirmed participant DNF.';

revoke all on function public.service_finish_race_categories(uuid,uuid[],uuid,uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.service_finish_race_categories(uuid,uuid[],uuid,uuid,boolean)
  to service_role;

commit;
