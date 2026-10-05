/*
 * Event participation is owned by the organizer workspace, while club
 * membership remains owned by the independent club workspace. This boundary
 * lets an organizer require an active membership in one or more clubs without
 * linking the entities, inheriting roles, or granting club managers access to
 * organizer operations.
 */

alter table public.event_editions
  add column registration_access text not null default 'open';

alter table public.event_editions
  add constraint event_editions_registration_access_check
    check (registration_access in ('open', 'club_members'));

create table public.event_eligible_clubs (
  event_edition_id uuid not null
    references public.event_editions (id) on delete cascade,
  club_id uuid not null
    references public.clubs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_edition_id, club_id)
);

create index event_eligible_clubs_club_event_idx
  on public.event_eligible_clubs (club_id, event_edition_id);

alter table public.event_eligible_clubs enable row level security;

revoke all on table public.event_eligible_clubs
  from public, anon, authenticated;
grant all on table public.event_eligible_clubs
  to service_role;

alter table public.registrations
  add column eligibility_club_id uuid
    references public.clubs (id) on delete set null,
  add column eligibility_club_membership_id uuid
    references public.club_memberships (id) on delete set null;

comment on column public.event_editions.registration_access is
  'Participation gate controlled by the organizer: open or active membership in a selected independent club.';
comment on table public.event_eligible_clubs is
  'Independent clubs whose active members may register for a club-restricted organizer event. This is not a workspace association.';
comment on column public.registrations.eligibility_club_membership_id is
  'Snapshot evidence of the active club membership that satisfied the event participation gate at registration time.';

create or replace function public.is_event_edition_public(target_event_edition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.event_editions edition
    where edition.id = target_event_edition_id
      and edition.published_at is not null
      and edition.status <> 'draft'
      and (
        edition.public_visibility = 'public'
        or (
          edition.public_visibility = 'club_members'
          and exists (
            select 1
            from public.event_eligible_clubs eligible
            join public.club_memberships membership
              on membership.club_id = eligible.club_id
            where eligible.event_edition_id = edition.id
              and membership.status = 'active'
              and public.user_can_access_athlete_profile(membership.athlete_profile_id)
          )
        )
      )
  )
$$;

comment on function public.is_event_edition_public(uuid) is
  'RLS visibility boundary: public editions are anonymous; club_members editions require an active eligible membership; private editions remain organizer-only.';

create or replace function public.enforce_event_club_participation_access()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  resolved_access text;
  qualifying_membership_id uuid;
  qualifying_club_id uuid;
begin
  select edition.registration_access
  into resolved_access
  from public.event_categories category
  join public.event_editions edition
    on edition.id = category.event_edition_id
  where category.id = new.event_category_id;

  if not found then
    return new;
  end if;

  if resolved_access = 'open' then
    new.eligibility_club_id := null;
    new.eligibility_club_membership_id := null;
    return new;
  end if;

  select membership.id, membership.club_id
  into qualifying_membership_id, qualifying_club_id
  from public.club_memberships membership
  join public.event_eligible_clubs eligible
    on eligible.club_id = membership.club_id
  join public.event_categories category
    on category.event_edition_id = eligible.event_edition_id
  where category.id = new.event_category_id
    and membership.athlete_profile_id = new.athlete_profile_id
    and membership.status = 'active'
  order by membership.is_primary desc, membership.joined_at nulls last, membership.created_at
  limit 1;

  if qualifying_membership_id is null then
    raise exception using
      errcode = '42501',
      message = 'event_club_membership_required';
  end if;

  new.eligibility_club_id := qualifying_club_id;
  new.eligibility_club_membership_id := qualifying_membership_id;
  return new;
end;
$$;

create trigger registrations_enforce_event_club_participation_access
before insert or update of event_category_id, athlete_profile_id
on public.registrations
for each row execute function public.enforce_event_club_participation_access();

revoke all on function public.enforce_event_club_participation_access()
  from public, anon, authenticated;

create or replace function public.service_set_event_registration_access(
  p_event_edition_id uuid,
  p_registration_access text,
  p_club_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_club_ids uuid[];
  saved_edition public.event_editions%rowtype;
begin
  if p_registration_access not in ('open', 'club_members') then
    raise exception using
      errcode = '22023',
      message = 'event_registration_access_invalid';
  end if;

  select coalesce(array_agg(distinct club_id order by club_id), array[]::uuid[])
  into normalized_club_ids
  from unnest(coalesce(p_club_ids, array[]::uuid[])) club_id
  where club_id is not null;

  if p_registration_access = 'open' then
    normalized_club_ids := array[]::uuid[];
  elsif cardinality(normalized_club_ids) = 0 then
    raise exception using
      errcode = '22023',
      message = 'event_eligible_club_required';
  end if;

  if exists (
    select 1
    from unnest(normalized_club_ids) requested_club_id
    where not exists (
      select 1
      from public.clubs club
      where club.id = requested_club_id
        and club.status = 'active'
        and club.merged_into_club_id is null
    )
  ) then
    raise exception using
      errcode = '22023',
      message = 'event_eligible_club_invalid';
  end if;

  update public.event_editions edition
  set registration_access = p_registration_access
  where edition.id = p_event_edition_id
  returning edition.* into saved_edition;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'edition_not_found';
  end if;

  delete from public.event_eligible_clubs eligible
  where eligible.event_edition_id = p_event_edition_id;

  insert into public.event_eligible_clubs (event_edition_id, club_id)
  select p_event_edition_id, club_id
  from unnest(normalized_club_ids) club_id;

  return jsonb_build_object(
    'eventEditionId', saved_edition.id,
    'registrationAccess', saved_edition.registration_access,
    'eligibleClubIds', to_jsonb(normalized_club_ids)
  );
end;
$$;

revoke all on function public.service_set_event_registration_access(uuid, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.service_set_event_registration_access(uuid, text, uuid[])
  to service_role;
