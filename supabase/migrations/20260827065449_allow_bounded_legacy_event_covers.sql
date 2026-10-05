begin;

-- The API serves legacy inline covers through its bounded binary endpoint.
-- Keep the existing migration immutable and apply compatibility forward.
alter table public.event_editions
  drop constraint if exists event_editions_cover_image_reference_check;

alter table public.event_editions
  add constraint event_editions_cover_image_reference_check
  check (
    cover_image_url is null
    or (
      octet_length(cover_image_url) <= 2048
      and (
        (cover_image_url like '/%' and cover_image_url not like '//%')
        or cover_image_url ~* '^https?://'
      )
    )
    or (
      octet_length(cover_image_url) <= ((10 * 1024 * 1024 * 4 / 3) + 64)
      and cover_image_url ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
    )
  ) not valid;

alter table public.event_editions
  validate constraint event_editions_cover_image_reference_check;

commit;
