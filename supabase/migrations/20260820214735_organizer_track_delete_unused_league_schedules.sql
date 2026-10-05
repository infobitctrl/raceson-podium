/*
 * Track templates are reusable sources, but draft recurrence rules can retain
 * them before any league event has been generated. Delete those unused rules
 * in the same transaction as the track so the organizer trash action cannot
 * leave either half of the workflow behind. Historical race snapshots and
 * generated recurrence occurrences remain hard blockers.
 */

create or replace function public.service_delete_organizer_track(
  p_track_template_id uuid,
  p_organization_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_organization_id uuid;
  removed_league_schedule_count integer := 0;
begin
  select template.organization_id
  into target_organization_id
  from public.track_templates template
  where template.id = p_track_template_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'track_not_found';
  end if;

  if target_organization_id <> p_organization_id then
    raise exception using errcode = '42501', message = 'track_organization_mismatch';
  end if;

  perform 1
  from public.event_category_track_snapshots snapshot
  where snapshot.track_template_id = p_track_template_id
  for update;

  if found then
    raise exception using errcode = '23514', message = 'track_has_race_assignments';
  end if;

  perform 1
  from public.league_recurrence_rules rule
  where rule.track_template_id = p_track_template_id
  for update;

  if exists (
    select 1
    from public.league_recurrence_occurrences occurrence
    join public.league_recurrence_rules rule
      on rule.id = occurrence.recurrence_rule_id
    where rule.track_template_id = p_track_template_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'track_has_generated_league_events';
  end if;

  delete from public.league_recurrence_rules rule
  where rule.track_template_id = p_track_template_id;

  get diagnostics removed_league_schedule_count = row_count;

  delete from public.track_templates template
  where template.id = p_track_template_id;

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
    'track_template',
    p_track_template_id,
    'track.organizer_deleted',
    jsonb_build_object(
      'removedLeagueScheduleCount', removed_league_schedule_count
    )
  );

  return jsonb_build_object(
    'deleted', true,
    'trackTemplateId', p_track_template_id,
    'removedLeagueScheduleCount', removed_league_schedule_count
  );
end;
$$;

revoke all on function public.service_delete_organizer_track(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_delete_organizer_track(uuid, uuid, uuid)
  to service_role;
