/*
 * Organizer registration removal is intentionally non-destructive: finance,
 * consent, communication, and race-day evidence remains linked to the
 * registration. Event and category deletion therefore needs a tombstone path
 * once every remaining registration has already been removed from the roster.
 */

alter table public.event_editions
  add column if not exists organizer_deleted_at timestamptz,
  add column if not exists organizer_deleted_by_user_id uuid
    references auth.users(id) on delete set null;

alter table public.event_categories
  add column if not exists organizer_deleted_at timestamptz,
  add column if not exists organizer_deleted_by_user_id uuid
    references auth.users(id) on delete set null;

create index if not exists event_editions_organizer_visible_idx
  on public.event_editions(event_series_id, start_date desc)
  where organizer_deleted_at is null;

create index if not exists event_categories_organizer_visible_idx
  on public.event_categories(event_edition_id, display_order)
  where organizer_deleted_at is null;

comment on column public.event_editions.organizer_deleted_at is
  'Organizer-facing deletion tombstone used when retained audit evidence prevents physical deletion.';

comment on column public.event_categories.organizer_deleted_at is
  'Organizer-facing deletion tombstone used when retained registration evidence prevents physical deletion.';

drop policy if exists "organizer deleted editions stay hidden" on public.event_editions;
create policy "organizer deleted editions stay hidden"
on public.event_editions
as restrictive
for select
to anon, authenticated
using (organizer_deleted_at is null);

drop policy if exists "organizer deleted categories stay hidden" on public.event_categories;
create policy "organizer deleted categories stay hidden"
on public.event_categories
as restrictive
for select
to anon, authenticated
using (organizer_deleted_at is null);

create or replace function public.service_delete_organizer_event(
  p_event_edition_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_organization_id uuid;
  deleted_at timestamptz := clock_timestamp();
  deleted_category_count integer := 0;
begin
  select series.organization_id
  into target_organization_id
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = p_event_edition_id
    and edition.organizer_deleted_at is null
  for update of edition;

  if not found then
    raise exception using errcode = 'P0002', message = 'event_not_found';
  end if;

  perform 1
  from public.event_categories category
  where category.event_edition_id = p_event_edition_id
  for update;

  if exists (
    select 1
    from public.registrations registration
    join public.event_categories category
      on category.id = registration.event_category_id
    where category.event_edition_id = p_event_edition_id
      and registration.organizer_removed_at is null
  ) then
    raise exception using errcode = '23514', message = 'event_has_visible_registrations';
  end if;

  update public.event_categories category
  set
    organizer_deleted_at = deleted_at,
    organizer_deleted_by_user_id = p_actor_user_id,
    updated_at = deleted_at
  where category.event_edition_id = p_event_edition_id
    and category.organizer_deleted_at is null;

  get diagnostics deleted_category_count = row_count;

  update public.event_editions edition
  set
    organizer_deleted_at = deleted_at,
    organizer_deleted_by_user_id = p_actor_user_id,
    public_visibility = 'private',
    status = 'archived',
    updated_at = deleted_at
  where edition.id = p_event_edition_id;

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
    'event.organizer_deleted',
    jsonb_build_object(
      'deletedAt', deleted_at,
      'deletedCategoryCount', deleted_category_count,
      'retainedEvidence', true
    )
  );

  return jsonb_build_object(
    'eventEditionId', p_event_edition_id,
    'deletedCategoryCount', deleted_category_count,
    'softDeleted', true
  );
end;
$$;

create or replace function public.service_delete_organizer_event_category(
  p_category_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_event_edition_id uuid;
  target_organization_id uuid;
  retained_registration_count integer := 0;
  deleted_at timestamptz := clock_timestamp();
  physically_deleted boolean := false;
begin
  select category.event_edition_id, series.organization_id
  into target_event_edition_id, target_organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = p_category_id
    and category.organizer_deleted_at is null
    and edition.organizer_deleted_at is null
  for update of category;

  if not found then
    raise exception using errcode = 'P0002', message = 'event_category_not_found';
  end if;

  select count(*)::integer
  into retained_registration_count
  from public.registrations registration
  where registration.event_category_id = p_category_id;

  if exists (
    select 1
    from public.registrations registration
    where registration.event_category_id = p_category_id
      and registration.organizer_removed_at is null
  ) then
    raise exception using errcode = '23514', message = 'event_category_has_visible_registrations';
  end if;

  if retained_registration_count = 0 then
    physically_deleted := public.service_delete_unused_event_category(p_category_id);
  else
    update public.event_categories category
    set
      organizer_deleted_at = deleted_at,
      organizer_deleted_by_user_id = p_actor_user_id,
      updated_at = deleted_at
    where category.id = p_category_id;
  end if;

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
    'event_category',
    p_category_id,
    'event_category.organizer_deleted',
    jsonb_build_object(
      'deletedAt', deleted_at,
      'eventEditionId', target_event_edition_id,
      'physicallyDeleted', physically_deleted,
      'retainedRegistrationCount', retained_registration_count
    )
  );

  return jsonb_build_object(
    'categoryId', p_category_id,
    'physicallyDeleted', physically_deleted,
    'softDeleted', not physically_deleted
  );
end;
$$;

revoke all on function public.service_delete_organizer_event(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_delete_organizer_event(uuid, uuid)
  to service_role;

revoke all on function public.service_delete_organizer_event_category(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_delete_organizer_event_category(uuid, uuid)
  to service_role;
