alter table public.event_categories
  add column if not exists cover_image_url text,
  add column if not exists creation_idempotency_key text;

create unique index if not exists event_categories_edition_creation_idempotency_key_idx
  on public.event_categories (event_edition_id, creation_idempotency_key)
  where creation_idempotency_key is not null;

comment on column public.event_categories.cover_image_url is
  'Race-specific cover image. Falls back to the assigned track or event cover when null.';

comment on column public.event_categories.creation_idempotency_key is
  'Client request key used to make organizer race creation safe to retry.';
