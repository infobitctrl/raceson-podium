begin;

alter table public.clubs
  add column if not exists logo_image_url text;

alter table public.clubs
  add column if not exists cover_image_url text;

commit;
