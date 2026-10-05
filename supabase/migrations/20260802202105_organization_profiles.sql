begin;

alter table public.organizations
  add column if not exists city text,
  add column if not exists description text,
  add column if not exists website_url text,
  add column if not exists contact_phone text,
  add column if not exists logo_image_url text,
  add column if not exists profile_visibility text not null default 'public',
  add column if not exists member_directory_visibility text not null default 'members',
  add column if not exists contact_details_visibility text not null default 'public';

update public.organizations
set
  profile_visibility = coalesce(nullif(btrim(profile_visibility), ''), 'public'),
  member_directory_visibility = coalesce(
    nullif(btrim(member_directory_visibility), ''),
    'members'
  ),
  contact_details_visibility = coalesce(
    nullif(btrim(contact_details_visibility), ''),
    'public'
  )
where profile_visibility is null
   or btrim(profile_visibility) = ''
   or member_directory_visibility is null
   or btrim(member_directory_visibility) = ''
   or contact_details_visibility is null
   or btrim(contact_details_visibility) = '';

alter table public.organizations
  drop constraint if exists organizations_profile_visibility_check,
  drop constraint if exists organizations_member_directory_visibility_check,
  drop constraint if exists organizations_contact_details_visibility_check;

alter table public.organizations
  add constraint organizations_profile_visibility_check
    check (profile_visibility in ('public', 'members')),
  add constraint organizations_member_directory_visibility_check
    check (member_directory_visibility in ('public', 'members')),
  add constraint organizations_contact_details_visibility_check
    check (contact_details_visibility in ('public', 'members'));

commit;
