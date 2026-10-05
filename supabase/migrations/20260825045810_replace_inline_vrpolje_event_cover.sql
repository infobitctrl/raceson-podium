do $$
declare
  matching_count integer;
  updated_count integer;
begin
  select count(*)
  into matching_count
  from public.event_editions
  where slug = 'vrpolje-trail-2026-2026'
    and cover_image_url like 'data:image/jpeg;base64,%'
    and octet_length(cover_image_url) = 3738599
    and md5(decode(split_part(cover_image_url, ',', 2), 'base64')) = '3ba6310e1cbb3fffb0731a40e80b22fa';

  if matching_count = 0 then
    if exists (
      select 1
      from public.event_editions
      where slug = 'vrpolje-trail-2026-2026'
        and cover_image_url <> '/event-media/vrpolje-2026/vrpolje-cover.webp'
    ) then
      raise exception 'Refusing to replace an unverified Vrpolje event cover';
    end if;
    return;
  end if;

  if matching_count <> 1 then
    raise exception 'Expected one verified inline event cover, found %', matching_count;
  end if;

  update public.event_editions
  set cover_image_url = '/event-media/vrpolje-2026/vrpolje-cover.webp',
      updated_at = now()
  where slug = 'vrpolje-trail-2026-2026'
    and cover_image_url like 'data:image/jpeg;base64,%'
    and octet_length(cover_image_url) = 3738599
    and md5(decode(split_part(cover_image_url, ',', 2), 'base64')) = '3ba6310e1cbb3fffb0731a40e80b22fa';

  get diagnostics updated_count = row_count;
  if updated_count <> matching_count then
    raise exception
      'Expected to replace exactly one verified inline event cover, replaced %',
      updated_count;
  end if;
end
$$;

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
  ) not valid;

alter table public.event_editions
  validate constraint event_editions_cover_image_reference_check;
