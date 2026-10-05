/*
 * Platform-record deletion already permits disposable leagues whose seasons
 * are unpublished drafts and have no standings or import history. Recreational
 * scheduling added restrict-side category templates and occurrences beneath
 * those draft seasons, so remove that derivative setup in the same transaction
 * before the existing guarded command deletes the league hierarchy.
 *
 * The core command still owns authorization, confirmation, protected-history
 * checks, and auditing. Any core failure rolls back this cleanup as well.
 */

alter function public.service_delete_platform_record(uuid, text, uuid, text, text)
  rename to service_delete_platform_record_core;

create function public.service_delete_platform_record(
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
  league_name text;
begin
  if p_record_type = 'league' then
    if not exists (
      select 1
      from public.platform_administrators administrator
      where administrator.user_id = p_actor_user_id
        and administrator.is_active
        and administrator.platform_role = 'super_admin'
    ) then
      raise exception using errcode = '42501', message = 'super_administrator_required';
    end if;

    if p_reason is null or length(trim(p_reason)) < 8 then
      raise exception using errcode = '22023', message = 'platform_record_deletion_reason_required';
    end if;

    select league.name
    into league_name
    from public.leagues league
    where league.id = p_record_id
    for update;

    if league_name is null then
      raise exception using errcode = 'P0002', message = 'platform_record_not_found';
    end if;

    if trim(coalesce(p_confirmation_name, '')) <> league_name then
      raise exception using errcode = '22023', message = 'platform_record_confirmation_mismatch';
    end if;

    delete from public.league_recurrence_occurrences occurrence
    using public.league_recurrence_rules rule, public.league_seasons season
    where occurrence.recurrence_rule_id = rule.id
      and rule.league_season_id = season.id
      and season.league_id = p_record_id;

    delete from public.league_recurrence_category_templates template
    using public.league_recurrence_rules rule, public.league_seasons season
    where template.recurrence_rule_id = rule.id
      and rule.league_season_id = season.id
      and season.league_id = p_record_id;

    delete from public.league_recurrence_rules rule
    using public.league_seasons season
    where rule.league_season_id = season.id
      and season.league_id = p_record_id;
  end if;

  return public.service_delete_platform_record_core(
    p_actor_user_id,
    p_record_type,
    p_record_id,
    p_confirmation_name,
    p_reason
  );
end;
$$;

revoke all on function public.service_delete_platform_record_core(uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.service_delete_platform_record_core(uuid, text, uuid, text, text)
  to service_role;

revoke all on function public.service_delete_platform_record(uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.service_delete_platform_record(uuid, text, uuid, text, text)
  to service_role;

comment on function public.service_delete_platform_record(uuid, text, uuid, text, text) is
  'Deletes a disposable canonical platform record after super-admin authorization, typed confirmation, dependency checks, automatic unused league-schedule cleanup, and an atomic audit entry.';
