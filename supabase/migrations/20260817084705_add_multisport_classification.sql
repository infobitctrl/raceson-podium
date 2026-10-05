create table if not exists public.sport_disciplines (
  code text primary key,
  label text not null unique,
  family text not null,
  is_multisport boolean not null default false,
  sort_order smallint not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint sport_disciplines_code_format_check
    check (code ~ '^[a-z][a-z0-9_]{2,39}$'),
  constraint sport_disciplines_family_check
    check (family in ('running', 'swimming', 'cycling', 'multisport')),
  constraint sport_disciplines_sort_order_check
    check (sort_order > 0)
);

insert into public.sport_disciplines (
  code,
  label,
  family,
  is_multisport,
  sort_order
)
values
  ('trail_running', 'Trail running', 'running', false, 10),
  ('road_running', 'Road running', 'running', false, 20),
  ('swimming', 'Swimming', 'swimming', false, 30),
  ('road_cycling', 'Road cycling', 'cycling', false, 40),
  ('mountain_biking', 'Mountain biking', 'cycling', false, 50),
  ('duathlon', 'Duathlon', 'multisport', true, 60),
  ('triathlon', 'Triathlon', 'multisport', true, 70),
  ('aquathlon', 'Aquathlon', 'multisport', true, 80)
on conflict (code) do update
set
  label = excluded.label,
  family = excluded.family,
  is_multisport = excluded.is_multisport,
  sort_order = excluded.sort_order,
  is_active = true;

create table if not exists public.event_edition_sports (
  event_edition_id uuid not null references public.event_editions(id) on delete cascade,
  sport_code text not null references public.sport_disciplines(code) on delete restrict,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (event_edition_id, sport_code)
);

create unique index if not exists event_edition_sports_one_primary_idx
  on public.event_edition_sports (event_edition_id)
  where is_primary;

create index if not exists event_edition_sports_sport_code_idx
  on public.event_edition_sports (sport_code, event_edition_id);

create table if not exists public.league_sports (
  league_id uuid not null references public.leagues(id) on delete cascade,
  sport_code text not null references public.sport_disciplines(code) on delete restrict,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (league_id, sport_code)
);

create unique index if not exists league_sports_one_primary_idx
  on public.league_sports (league_id)
  where is_primary;

create index if not exists league_sports_sport_code_idx
  on public.league_sports (sport_code, league_id);

alter table public.event_categories
  add column if not exists sport_code text;

update public.event_categories
set sport_code = 'trail_running'
where sport_code is null;

alter table public.event_categories
  alter column sport_code set default 'trail_running',
  alter column sport_code set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'event_categories_sport_code_fkey'
      and conrelid = 'public.event_categories'::regclass
  ) then
    alter table public.event_categories
      add constraint event_categories_sport_code_fkey
      foreign key (sport_code)
      references public.sport_disciplines(code)
      on delete restrict;
  end if;
end
$$;

create index if not exists event_categories_sport_code_edition_idx
  on public.event_categories (sport_code, event_edition_id);

insert into public.event_edition_sports (event_edition_id, sport_code, is_primary)
select edition.id, 'trail_running', true
from public.event_editions edition
on conflict (event_edition_id, sport_code) do update
set is_primary = true;

insert into public.league_sports (league_id, sport_code, is_primary)
select league.id, 'trail_running', true
from public.leagues league
on conflict (league_id, sport_code) do update
set is_primary = true;

create or replace function public.add_default_event_edition_sport()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.event_edition_sports (event_edition_id, sport_code, is_primary)
  values (new.id, 'trail_running', true)
  on conflict (event_edition_id, sport_code) do nothing;
  return new;
end;
$$;

create or replace function public.add_default_league_sport()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.league_sports (league_id, sport_code, is_primary)
  values (new.id, 'trail_running', true)
  on conflict (league_id, sport_code) do nothing;
  return new;
end;
$$;

revoke all on function public.add_default_event_edition_sport() from public, anon, authenticated;
revoke all on function public.add_default_league_sport() from public, anon, authenticated;
grant execute on function public.add_default_event_edition_sport() to service_role;
grant execute on function public.add_default_league_sport() to service_role;

drop trigger if exists event_editions_add_default_sport on public.event_editions;
create trigger event_editions_add_default_sport
after insert on public.event_editions
for each row execute function public.add_default_event_edition_sport();

drop trigger if exists leagues_add_default_sport on public.leagues;
create trigger leagues_add_default_sport
after insert on public.leagues
for each row execute function public.add_default_league_sport();

alter table public.sport_disciplines enable row level security;
alter table public.event_edition_sports enable row level security;
alter table public.league_sports enable row level security;

create policy sport_disciplines_select_active
on public.sport_disciplines
for select
to anon, authenticated
using (is_active);

create policy event_edition_sports_select_public_or_org
on public.event_edition_sports
for select
to anon, authenticated
using (
  public.is_event_edition_public(event_edition_id)
  or public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
  or public.can_time_organization(public.organization_id_for_event_edition(event_edition_id))
);

create policy league_sports_select_public_or_org
on public.league_sports
for select
to anon, authenticated
using (
  public.is_league_public(league_id)
  or public.can_manage_organization(public.organization_id_for_league(league_id))
);

revoke all on table public.sport_disciplines from public, anon, authenticated;
revoke all on table public.event_edition_sports from public, anon, authenticated;
revoke all on table public.league_sports from public, anon, authenticated;

grant select on table public.sport_disciplines to anon, authenticated;
grant select on table public.event_edition_sports to anon, authenticated;
grant select on table public.league_sports to anon, authenticated;

grant select, insert, update, delete on table public.sport_disciplines to service_role;
grant select, insert, update, delete on table public.event_edition_sports to service_role;
grant select, insert, update, delete on table public.league_sports to service_role;
