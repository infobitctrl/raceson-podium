begin;

alter table public.clubs
  add column if not exists founded_year integer;

alter table public.clubs
  add column if not exists main_sport text;

alter table public.clubs
  add column if not exists club_type text;

alter table public.clubs
  add column if not exists officially_registered boolean not null default false;

alter table public.clubs
  add column if not exists website_url text;

alter table public.clubs
  add column if not exists instagram_url text;

alter table public.clubs
  add column if not exists facebook_url text;

alter table public.clubs
  add column if not exists contact_email text;

alter table public.clubs
  add column if not exists contact_phone text;

alter table public.clubs
  add column if not exists privacy_level text not null default 'public';

alter table public.clubs
  add column if not exists requires_approval boolean not null default false;

update public.clubs
set
  main_sport = coalesce(nullif(btrim(main_sport), ''), 'Trail Running'),
  club_type = coalesce(nullif(btrim(club_type), ''), 'Informal Group'),
  privacy_level = coalesce(nullif(btrim(privacy_level), ''), 'public')
where main_sport is null
   or btrim(main_sport) = ''
   or club_type is null
   or btrim(club_type) = ''
   or privacy_level is null
   or btrim(privacy_level) = '';

commit;
