create table public.club_sports (
  club_id uuid not null references public.clubs(id) on delete cascade,
  sport_code text not null references public.sport_disciplines(code) on delete restrict,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (club_id, sport_code)
);

create unique index club_sports_one_primary_idx
  on public.club_sports (club_id)
  where is_primary;

create index club_sports_sport_code_idx
  on public.club_sports (sport_code, club_id);

insert into public.club_sports (club_id, sport_code, is_primary)
select
  club.id,
  case
    when lower(coalesce(club.main_sport, '')) like '%triathlon%' then 'triathlon'
    when lower(coalesce(club.main_sport, '')) like '%duathlon%' then 'duathlon'
    when lower(coalesce(club.main_sport, '')) like '%aquathlon%' then 'aquathlon'
    when lower(coalesce(club.main_sport, '')) like '%swim%' then 'swimming'
    when lower(coalesce(club.main_sport, '')) like '%mountain%'
      and (
        lower(coalesce(club.main_sport, '')) like '%bike%'
        or lower(coalesce(club.main_sport, '')) like '%cycl%'
      ) then 'mountain_biking'
    when lower(coalesce(club.main_sport, '')) like '%bike%'
      or lower(coalesce(club.main_sport, '')) like '%cycl%' then 'road_cycling'
    when lower(coalesce(club.main_sport, '')) like '%road%'
      and lower(coalesce(club.main_sport, '')) like '%run%' then 'road_running'
    else 'trail_running'
  end,
  true
from public.clubs club;

create or replace function public.service_set_club_sports(
  target_club_id uuid,
  selected_sport_codes text[],
  selected_primary_sport_code text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_count integer;
  known_count integer;
  distinct_count integer;
  primary_label text;
begin
  selected_count := cardinality(selected_sport_codes);
  if selected_count is null or selected_count = 0 then
    raise exception using
      errcode = '22023',
      message = 'club_sports_required';
  end if;

  if selected_primary_sport_code is null
     or not (selected_primary_sport_code = any(selected_sport_codes)) then
    raise exception using
      errcode = '22023',
      message = 'club_primary_sport_must_be_selected';
  end if;

  select count(distinct code)::integer, count(*)::integer
  into distinct_count, known_count
  from public.sport_disciplines
  where code = any(selected_sport_codes)
    and is_active;

  if known_count <> selected_count or distinct_count <> selected_count then
    raise exception using
      errcode = '22023',
      message = 'club_sports_invalid';
  end if;

  select label
  into primary_label
  from public.sport_disciplines
  where code = selected_primary_sport_code
    and is_active;

  if primary_label is null then
    raise exception using
      errcode = '22023',
      message = 'club_primary_sport_invalid';
  end if;

  perform 1
  from public.clubs
  where id = target_club_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'club_not_found';
  end if;

  delete from public.club_sports
  where club_id = target_club_id;

  insert into public.club_sports (club_id, sport_code, is_primary)
  select
    target_club_id,
    selected.sport_code,
    selected.sport_code = selected_primary_sport_code
  from unnest(selected_sport_codes) with ordinality as selected(sport_code, position)
  order by selected.position;

  update public.clubs
  set
    main_sport = primary_label,
    updated_at = now()
  where id = target_club_id;
end;
$$;

alter table public.club_sports enable row level security;

revoke all on table public.club_sports from public, anon, authenticated;
grant select, insert, update, delete on table public.club_sports to service_role;

revoke all on function public.service_set_club_sports(uuid, text[], text)
  from public, anon, authenticated;
grant execute on function public.service_set_club_sports(uuid, text[], text)
  to service_role;
