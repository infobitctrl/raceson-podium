begin;

/*
 * A club recovery approval on 2026-08-05 ran through the former organizer-
 * workspace implementation. It created a club-kind organization for Jadrija
 * and granted the claimant full organizer permissions. Club access is now
 * owned exclusively by club_memberships and club_roles, so remove that one
 * known historical artifact only after proving the proper club owner role is
 * present and that no unrelated organization data depends on it. The club may
 * already be detached and the shell normalized to organizer kind when the
 * independent-club migration was executed directly before migration history
 * was reconciled. A later abandoned setup attempt also left one exact empty
 * Jadrijada event series on this shell; remove it only while it has no edition
 * or league recurrence dependencies.
 */
do $$
declare
  target_organization_id constant uuid := '8930c9e6-866f-4d89-b78b-e534b425ceb8';
  target_club_id constant uuid := 'd02cfec8-bb6b-49cc-aed1-11c8cc8324eb';
  target_user_id constant uuid := '8f179a6e-9d1a-4c98-ab25-b0683c419417';
  target_event_series_id constant uuid := '4b230f7d-619a-432b-9bf9-52fd1e4ca89a';
  organization_row public.organizations%rowtype;
  dependency record;
  has_dependency boolean;
  affected_rows integer;
begin
  select organization.*
  into organization_row
  from public.organizations organization
  where organization.id = target_organization_id
  for update;

  if not found then
    return;
  end if;

  if organization_row.slug <> 'jadrija-d02cfec8'
     or organization_row.name <> 'Jadrija'
     or organization_row.kind not in ('club', 'organizer') then
    raise exception
      'Refusing Jadrija cleanup because organization % no longer matches the historical artifact',
      target_organization_id;
  end if;

  if not exists (
    select 1
    from public.clubs club
    where club.id = target_club_id
      and (
        club.organization_id = target_organization_id
        or club.organization_id is null
      )
  ) or exists (
    select 1
    from public.clubs club
    where club.organization_id = target_organization_id
      and club.id <> target_club_id
  ) then
    raise exception
      'Refusing Jadrija cleanup because the organization-to-club link changed';
  end if;

  if (select count(*) from public.organization_memberships membership
      where membership.organization_id = target_organization_id) <> 1
     or not exists (
       select 1
       from public.organization_memberships membership
       where membership.organization_id = target_organization_id
         and membership.user_id = target_user_id
         and membership.role = 'admin'
         and membership.status = 'active'
         and membership.account_template_key = 'organization-admin'
     ) then
    raise exception
      'Refusing Jadrija cleanup because its organizer membership set changed';
  end if;

  if not exists (
    select 1
    from public.user_profiles profile
    join public.club_memberships membership
      on membership.athlete_profile_id = profile.primary_athlete_profile_id
    join public.club_roles role
      on role.id = membership.club_role_id
    where profile.user_id = target_user_id
      and membership.club_id = target_club_id
      and membership.status = 'active'
      and membership.membership_role = 'owner'
      and role.is_owner
      and role.status = 'active'
  ) then
    raise exception
      'Refusing Jadrija cleanup because the proper club-scoped owner role is missing';
  end if;

  if exists (
    select 1
    from public.event_series series
    where series.organization_id = target_organization_id
      and (
        series.id <> target_event_series_id
        or series.slug <> 'jadrijada'
        or series.name <> 'Jadrijada'
      )
  ) or exists (
    select 1
    from public.event_editions edition
    where edition.event_series_id = target_event_series_id
  ) or exists (
    select 1
    from public.league_recurrence_rules recurrence
    where recurrence.event_series_id = target_event_series_id
  ) then
    raise exception
      'Refusing Jadrija cleanup because its event-series data changed';
  end if;

  delete from public.organization_memberships membership
  where membership.organization_id = target_organization_id
    and membership.user_id = target_user_id;

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'Expected to remove exactly one stale Jadrija organizer membership';
  end if;

  update public.clubs club
  set organization_id = null, updated_at = clock_timestamp()
  where club.id = target_club_id
    and club.organization_id = target_organization_id;

  get diagnostics affected_rows = row_count;
  if affected_rows > 1 then
    raise exception 'Expected to unlink at most one Jadrija club record';
  end if;

  delete from public.event_series series
  where series.id = target_event_series_id
    and series.organization_id = target_organization_id
    and series.slug = 'jadrijada'
    and series.name = 'Jadrijada';

  for dependency in
    select
      namespace.nspname as schema_name,
      relation.relname as table_name,
      attribute.attname as column_name
    from pg_constraint foreign_key
    join pg_class relation
      on relation.oid = foreign_key.conrelid
    join pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join unnest(foreign_key.conkey) with ordinality as key_column(attnum, ordinal_position)
      on true
    join pg_attribute attribute
      on attribute.attrelid = foreign_key.conrelid
     and attribute.attnum = key_column.attnum
    where foreign_key.contype = 'f'
      and foreign_key.confrelid = 'public.organizations'::regclass
      and cardinality(foreign_key.conkey) = 1
      and cardinality(foreign_key.confkey) = 1
  loop
    execute format(
      'select exists (select 1 from %I.%I where %I = $1)',
      dependency.schema_name,
      dependency.table_name,
      dependency.column_name
    )
    into has_dependency
    using target_organization_id;

    if has_dependency then
      raise exception
        'Refusing Jadrija cleanup because %.%.% still references organization %',
        dependency.schema_name,
        dependency.table_name,
        dependency.column_name,
        target_organization_id;
    end if;
  end loop;

  delete from public.organizations organization
  where organization.id = target_organization_id;

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'Expected to remove exactly one stale Jadrija organization';
  end if;
end
$$;

/*
 * Display names are the user-facing organization identity. Slug suffixing is
 * useful for unrelated slug collisions, but it must not permit two names that
 * differ only by case or whitespace.
 */
create unique index if not exists organizations_name_normalized_unique_idx
  on public.organizations (
    (lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')))
  );

comment on index public.organizations_name_normalized_unique_idx is
  'Reserves organization display names globally after case and whitespace normalization.';

commit;
