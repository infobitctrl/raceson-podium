begin;

-- Keep the original RPC available during the application rollout. The v2 wrapper
-- adds region persistence and corrects the linked organization location in the
-- same transaction as the existing club creation workflow.
create or replace function public.create_current_user_club_v2(
  club_slug text,
  club_name text,
  club_country_code text,
  club_city text,
  club_description text,
  president_name text,
  founded_year integer default null,
  main_sport text default null,
  club_type text default null,
  officially_registered boolean default false,
  website_url text default null,
  instagram_url text default null,
  facebook_url text default null,
  contact_email text default null,
  contact_phone text default null,
  training_days text[] default '{}'::text[],
  has_regular_training boolean default true,
  training_location text default null,
  training_note text default null,
  privacy_level text default 'public',
  requires_approval boolean default false,
  icon_key text default 'mountain',
  color_key text default 'primary',
  logo_image_url text default null,
  cover_image_url text default null,
  create_organizer_workspace boolean default false,
  workspace_name text default null,
  club_region text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  created_club jsonb;
  created_club_id uuid;
  created_organization_id uuid;
begin
  created_club := public.create_current_user_club(
    club_slug => club_slug,
    club_name => club_name,
    club_country_code => club_country_code,
    club_city => club_city,
    club_description => club_description,
    president_name => president_name,
    founded_year => founded_year,
    main_sport => main_sport,
    club_type => club_type,
    officially_registered => officially_registered,
    website_url => website_url,
    instagram_url => instagram_url,
    facebook_url => facebook_url,
    contact_email => contact_email,
    contact_phone => contact_phone,
    training_days => training_days,
    has_regular_training => has_regular_training,
    training_location => training_location,
    training_note => training_note,
    privacy_level => privacy_level,
    requires_approval => requires_approval,
    icon_key => icon_key,
    color_key => color_key,
    logo_image_url => logo_image_url,
    cover_image_url => cover_image_url,
    create_organizer_workspace => create_organizer_workspace,
    workspace_name => workspace_name
  );

  created_club_id := nullif(created_club ->> 'club_id', '')::uuid;
  created_organization_id := nullif(created_club ->> 'organization_id', '')::uuid;

  update public.clubs
  set
    country_code = nullif(btrim(upper(club_country_code)), ''),
    region = nullif(btrim(club_region), ''),
    city = nullif(btrim(club_city), ''),
    updated_at = now()
  where id = created_club_id;

  if created_organization_id is not null then
    update public.organizations
    set
      country_code = nullif(btrim(upper(club_country_code)), ''),
      region = nullif(btrim(club_region), ''),
      city = nullif(btrim(club_city), ''),
      updated_at = now()
    where id = created_organization_id;
  end if;

  return created_club;
end;
$$;

revoke all on function public.create_current_user_club_v2(
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text,
  text[],
  boolean,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text
) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.create_current_user_club_v2(
      text,
      text,
      text,
      text,
      text,
      text,
      integer,
      text,
      text,
      boolean,
      text,
      text,
      text,
      text,
      text,
      text[],
      boolean,
      text,
      text,
      text,
      boolean,
      text,
      text,
      text,
      text,
      boolean,
      text,
      text
    ) to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.create_current_user_club_v2(
      text,
      text,
      text,
      text,
      text,
      text,
      integer,
      text,
      text,
      boolean,
      text,
      text,
      text,
      text,
      text,
      text[],
      boolean,
      text,
      text,
      text,
      boolean,
      text,
      text,
      text,
      text,
      boolean,
      text,
      text
    ) to service_role;
  end if;
end;
$$;

-- The candidate audit found 112 clubs: 111 have no city/region data and one
-- uses the ASCII typo "Sibenik". Set every existing club to Croatia, retain
-- empty values as null, and normalize only that known city/county pair.
update public.clubs
set
  country_code = 'HR',
  region = case
    when lower(btrim(coalesce(city, ''))) in ('sibenik', 'šibenik')
      then 'Šibensko-kninska županija'
    else nullif(btrim(region), '')
  end,
  city = case
    when lower(btrim(coalesce(city, ''))) in ('sibenik', 'šibenik')
      then 'Šibenik'
    else nullif(btrim(city), '')
  end,
  updated_at = now()
where country_code is distinct from 'HR'
   or city is distinct from nullif(btrim(city), '')
   or region is distinct from nullif(btrim(region), '')
   or lower(btrim(coalesce(city, ''))) in ('sibenik', 'šibenik');

commit;
