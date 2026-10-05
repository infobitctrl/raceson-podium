-- Published registration contracts remain immutable once athlete evidence
-- exists. A draft event with no registrations, however, must be removable by
-- its organizer even though the platform creates a published default contract
-- for every race category.
create or replace function public.protect_published_registration_configuration()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  protected_status text;
  protected_form_id uuid;
  configuration_is_unused_draft_event boolean := false;
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

    if configuration_is_unused_draft_event then
      return old;
    end if;
  end if;

  if protected_status in ('published', 'retired') then
    raise exception using errcode = '55000', message = 'published_registration_configuration_is_immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
