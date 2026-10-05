-- Keep large gallery JSON out of list/card queries. Full galleries remain available
-- to the organizer editor and track detail reads.
alter table public.track_templates
  add column if not exists gallery_preview_image_url text;

alter table public.track_versions
  add column if not exists template_summary_patch_json jsonb
  generated always as (
    coalesce(template_patch_json, '{}'::jsonb) - 'gallery_items_json'
  ) stored;

alter table public.track_templates
  drop constraint if exists track_templates_gallery_preview_image_url_check;

alter table public.track_templates
  add constraint track_templates_gallery_preview_image_url_check
  check (
    gallery_preview_image_url is null
    or (
      length(gallery_preview_image_url) <= 2048
      and gallery_preview_image_url !~* '^\s*data:'
    )
  ) not valid;

create or replace function app_private.sync_track_gallery_preview_image_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select nullif(btrim(item.value ->> 'imageUrl'), '')
  into new.gallery_preview_image_url
  from jsonb_array_elements(
    case
      when jsonb_typeof(coalesce(new.gallery_items_json, '[]'::jsonb)) = 'array'
        then coalesce(new.gallery_items_json, '[]'::jsonb)
      else '[]'::jsonb
    end
  ) with ordinality as item(value, display_order)
  where nullif(btrim(item.value ->> 'imageUrl'), '') is not null
    and btrim(item.value ->> 'imageUrl') !~* '^data:'
    and length(btrim(item.value ->> 'imageUrl')) <= 2048
  order by
    case when lower(coalesce(item.value ->> 'isDefault', 'false')) = 'true' then 0 else 1 end,
    item.display_order
  limit 1;

  return new;
end;
$$;

revoke all on function app_private.sync_track_gallery_preview_image_url() from public;
revoke all on function app_private.sync_track_gallery_preview_image_url() from anon;
revoke all on function app_private.sync_track_gallery_preview_image_url() from authenticated;
revoke all on function app_private.sync_track_gallery_preview_image_url() from service_role;

drop trigger if exists sync_track_gallery_preview_image_url on public.track_templates;
create trigger sync_track_gallery_preview_image_url
before insert or update of gallery_items_json, gallery_preview_image_url
on public.track_templates
for each row
execute function app_private.sync_track_gallery_preview_image_url();

-- Updating the new column invokes the trigger and derives the preview from the
-- existing gallery without modifying or deleting any gallery content.
update public.track_templates
set gallery_preview_image_url = gallery_preview_image_url;

alter table public.track_templates
  validate constraint track_templates_gallery_preview_image_url_check;

comment on column public.track_templates.gallery_preview_image_url is
  'Small storage-backed preview URL derived from gallery_items_json for list and card reads.';

comment on column public.track_versions.template_summary_patch_json is
  'Draft metadata projection for summary reads; deliberately excludes large gallery content.';

-- These functions already use fully-qualified application relations. An empty
-- search path removes mutable-schema name resolution from their definer context.
alter function public.bootstrap_current_user_account(text[], text, text, text, text, text, boolean)
  set search_path = '';

alter function public.create_current_user_organizer_workspace(text, text)
  set search_path = '';
