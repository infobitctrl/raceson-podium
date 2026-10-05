begin;

-- Expand the actor role only in the existing platform-section commands. Keep
-- service-only grants, active-role checks, audit writes and deletion safeguards.
-- Administrator access management and track-attempt review are not included.
do $migration$
declare
  signature text;
  definition text;
  actor_check constant text := 'administrator.platform_role = ''super_admin''';
  protected_account_check constant text := $guard$
  if exists (
    select 1 from public.platform_administrators actor
    where actor.user_id = p_actor_user_id and actor.is_active
      and actor.platform_role = 'site_admin'
  ) and exists (
    select 1 from public.platform_administrators target
    where target.user_id = p_target_user_id
  ) then
    raise exception using errcode = '42501',
      message = 'platform_administrator_account_protected';
  end if;
$guard$;
begin
  foreach signature in array array[
    'public.service_set_platform_integrity_check_state(uuid,text,text,text)',
    'public.service_delete_platform_club(uuid,uuid)',
    'public.service_assert_platform_account_deletable(uuid,uuid)',
    'public.service_update_platform_account_profile(uuid,uuid,text,text,text,text)',
    'public.service_update_platform_account_details(uuid,uuid,text,text,text,jsonb,text)',
    'public.service_update_platform_organization(uuid,uuid,text,text,text,text,text,text,text,text)',
    'public.service_delete_platform_organization(uuid,uuid,text,text)',
    'public.service_delete_platform_record(uuid,text,uuid,text,text)',
    'public.service_delete_platform_record_core(uuid,text,uuid,text,text)',
    'public.service_retire_platform_athlete_for_deletion(uuid,uuid,text,text,uuid,boolean)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if strpos(definition, actor_check) = 0 then
      raise exception 'Expected platform actor guard missing: %', signature;
    end if;
    definition := replace(definition, actor_check,
      'administrator.platform_role in (''super_admin'', ''site_admin'')');
    definition := replace(definition, '''super_administrator_required''', '''platform_administrator_required''');
    definition := replace(definition, '''platform_super_admin_required''', '''platform_administrator_required''');
    if signature like 'public.service_update_platform_account_%' then
      -- Account email/username edits must never let a site administrator take
      -- over another administrator. The API checks before touching Auth too.
      if strpos(definition, E'begin\n') = 0 then
        raise exception 'Expected account function entry missing: %', signature;
      end if;
      definition := overlay(definition placing E'begin\n' || protected_account_check
        from strpos(definition, E'begin\n') for length(E'begin\n'));
    end if;
    execute definition;
  end loop;
end;
$migration$;

commit;
