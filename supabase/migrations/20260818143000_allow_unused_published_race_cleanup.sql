-- Organizers must be able to remove an accidentally-created race even when
-- the parent event is already published. Published registration contracts
-- remain immutable unless this server-only command deletes the whole category
-- and the category has no athlete registration evidence.
create or replace function public.protect_published_registration_configuration()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  protected_status text;
  protected_form_id uuid;
  cleanup_category_id uuid := nullif(
    current_setting('sitrail.unused_category_cleanup_id', true),
    ''
  )::uuid;
  configuration_is_unused_draft_event boolean := false;
  configuration_is_authorized_unused_category boolean := false;
begin
  if tg_table_name = 'registration_form_versions' then
    protected_status := old.status;
    protected_form_id := old.id;
    if tg_op = 'UPDATE'
       and old.status = 'published'
       and new.status = 'retired'
       and new.published_at = old.published_at
       and new.retired_at is not null
       and (
         to_jsonb(new) - 'status' - 'retired_at' - 'updated_at'
       ) = (
         to_jsonb(old) - 'status' - 'retired_at' - 'updated_at'
       ) then
      return new;
    end if;
  else
    protected_form_id := old.form_version_id;
    select version.status
    into protected_status
    from public.registration_form_versions version
    where version.id = protected_form_id;
  end if;

  if tg_op = 'DELETE' and protected_status in ('published', 'retired') then
    select exists (
      select 1
      from public.registration_form_versions version
      join public.event_categories category on category.id = version.event_category_id
      join public.event_editions edition on edition.id = category.event_edition_id
      where version.id = protected_form_id
        and edition.status = 'draft'
        and edition.published_at is null
        and not exists (
          select 1
          from public.registrations registration
          where registration.event_category_id = category.id
             or registration.registration_form_version_id = version.id
        )
    )
    into configuration_is_unused_draft_event;

    if cleanup_category_id is not null then
      select exists (
        select 1
        from public.registration_form_versions version
        join public.event_categories category on category.id = version.event_category_id
        where version.id = protected_form_id
          and category.id = cleanup_category_id
          and not exists (
            select 1
            from public.registrations registration
            where registration.event_category_id = category.id
               or registration.registration_form_version_id = version.id
          )
      )
      into configuration_is_authorized_unused_category;
    end if;

    if configuration_is_unused_draft_event
       or configuration_is_authorized_unused_category then
      return old;
    end if;
  end if;

  if protected_status in ('published', 'retired') then
    raise exception using errcode = '55000', message = 'published_registration_configuration_is_immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.service_delete_unused_event_category(
  p_category_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_found boolean := false;
  deleted_count integer := 0;
  form_version_ids uuid[] := '{}'::uuid[];
begin
  select true
  into category_found
  from public.event_categories category
  where category.id = p_category_id
  for update;

  if not coalesce(category_found, false) then
    return false;
  end if;

  if exists (
    select 1
    from public.registrations registration
    where registration.event_category_id = p_category_id
  ) then
    raise exception using errcode = '23514', message = 'event_category_has_registrations';
  end if;

  perform set_config(
    'sitrail.unused_category_cleanup_id',
    p_category_id::text,
    true
  );

  select coalesce(array_agg(version.id), '{}'::uuid[])
  into form_version_ids
  from public.registration_form_versions version
  where version.event_category_id = p_category_id;

  if cardinality(form_version_ids) > 0 then
    delete from public.registration_form_fields field
    where field.form_version_id = any(form_version_ids);

    delete from public.registration_legal_documents document
    where document.form_version_id = any(form_version_ids);

    delete from public.registration_form_versions version
    where version.id = any(form_version_ids);
  end if;

  delete from public.event_categories category
  where category.id = p_category_id;

  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;

revoke all on function public.service_delete_unused_event_category(uuid)
  from public, anon, authenticated;
grant execute on function public.service_delete_unused_event_category(uuid)
  to service_role;
