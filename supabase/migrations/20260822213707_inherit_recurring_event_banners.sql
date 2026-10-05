begin;

-- Recurring drafts represent copies of their base event. Preserve an explicit
-- generated-event banner, but repair missing banners from the linked base event.
update public.event_editions as generated
set cover_image_url = source.cover_image_url
from public.event_editions as source
where generated.is_recurrence_generated
  and generated.organizer_deleted_at is null
  and generated.recurrence_source_event_edition_id = source.id
  and source.organizer_deleted_at is null
  and nullif(btrim(generated.cover_image_url), '') is null
  and nullif(btrim(source.cover_image_url), '') is not null;

commit;
