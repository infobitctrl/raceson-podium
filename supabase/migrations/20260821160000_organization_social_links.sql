begin;

alter table public.organizations
  add column if not exists instagram_url text,
  add column if not exists facebook_url text,
  add column if not exists linkedin_url text,
  add column if not exists youtube_url text,
  add column if not exists tiktok_url text,
  add column if not exists x_url text;

commit;
