begin;

create or replace function public.service_delete_platform_club(
  p_actor_user_id uuid,
  p_club_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  club_record public.clubs%rowtype;
  detached_memberships integer := 0;
  detached_registrations integer := 0;
  detached_results integer := 0;
  can_detach_imported_history boolean := false;
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

  select * into club_record
  from public.clubs
  where id = p_club_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'club_not_found';
  end if;

  can_detach_imported_history :=
    club_record.status = 'inactive'
    and club_record.verification_status = 'flagged'
    and club_record.created_by_athlete_profile_id is null
    and club_record.organization_id is null;

  if club_record.verification_status = 'merged'
    or exists (
      select 1 from public.club_identity_merges identity_merge
      where identity_merge.source_club_id = p_club_id
         or identity_merge.canonical_club_id = p_club_id
    ) then
    raise exception using errcode = '55000', message = 'club_has_protected_history';
  end if;

  if not can_detach_imported_history
    and (
      exists (
        select 1 from public.registrations registration
        where registration.represented_club_id = p_club_id
      )
      or exists (
        select 1 from public.result_rows result
        where result.represented_club_id = p_club_id
      )
    ) then
    raise exception using errcode = '55000', message = 'club_has_protected_history';
  end if;

  select count(*)::integer into detached_memberships
  from public.club_memberships membership
  where membership.club_id = p_club_id;

  if can_detach_imported_history then
    update public.result_rows result
    set represented_club_id = null
    where result.represented_club_id = p_club_id;
    get diagnostics detached_results = row_count;

    update public.registrations registration
    set represented_club_id = null
    where registration.represented_club_id = p_club_id;
    get diagnostics detached_registrations = row_count;
  end if;

  insert into public.audit_log (
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  ) values (
    p_actor_user_id,
    'club',
    p_club_id,
    'platform.club_deleted',
    jsonb_build_object(
      'clubName', club_record.name,
      'clubSlug', club_record.slug,
      'deletionMode', case
        when can_detach_imported_history then 'inactive_import'
        else 'unused_club'
      end,
      'detachedMemberships', detached_memberships,
      'detachedRegistrations', detached_registrations,
      'detachedResults', detached_results
    )
  );

  begin
    delete from public.clubs where id = p_club_id;
  exception
    when foreign_key_violation then
      raise exception using errcode = '55000', message = 'club_has_protected_history';
  end;

  return jsonb_build_object(
    'deleted', true,
    'clubId', p_club_id,
    'detachedMemberships', detached_memberships,
    'detachedRegistrations', detached_registrations,
    'detachedResults', detached_results
  );
end;
$$;

revoke all on function public.service_delete_platform_club(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_delete_platform_club(uuid, uuid)
  to service_role;

comment on function public.service_delete_platform_club(uuid, uuid) is
  'Deletes unused clubs, or inactive flagged import placeholders after detaching their registration and result rows, while preserving athlete and race records.';

commit;
