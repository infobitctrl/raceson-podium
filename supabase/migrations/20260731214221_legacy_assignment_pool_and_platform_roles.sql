begin;

alter table public.platform_administrators
  drop constraint if exists platform_administrators_platform_role_check;

update public.platform_administrators
set platform_role = 'super_admin',
    updated_at = clock_timestamp()
where platform_role = 'master_admin';

alter table public.platform_administrators
  alter column platform_role set default 'site_admin',
  add constraint platform_administrators_platform_role_check
    check (platform_role in ('super_admin', 'site_admin'));

create index if not exists platform_administrators_active_role_idx
  on public.platform_administrators (platform_role, user_id)
  where is_active;

create table public.platform_test_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  test_role text not null,
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (test_role in ('test_admin', 'test_timer', 'test_organizer'))
);

alter table public.platform_test_accounts enable row level security;
revoke all on table public.platform_test_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_test_accounts to service_role;

create table public.platform_administrator_events (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  previous_role text,
  next_role text,
  detail_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  check (action in ('provisioned', 'invited', 'activated', 'role_changed', 'deactivated')),
  check (previous_role is null or previous_role in ('super_admin', 'site_admin')),
  check (next_role is null or next_role in ('super_admin', 'site_admin')),
  check (jsonb_typeof(detail_json) = 'object')
);

alter table public.platform_administrator_events enable row level security;
revoke all on table public.platform_administrator_events from public, anon, authenticated;
grant select, insert on table public.platform_administrator_events to service_role;

create table public.legacy_category_assignment_pool (
  legacy_import_batch_id uuid not null
    references migration_support.legacy_import_batches (id) on delete restrict,
  source_race_id text not null,
  legacy_event_edition_id uuid not null
    references public.event_editions (id) on delete restrict,
  legacy_event_category_id uuid not null
    references public.event_categories (id) on delete restrict,
  canonical_event_category_id uuid
    references public.event_categories (id) on delete set null,
  legacy_event_name text not null,
  legacy_category_name text not null,
  legacy_start_date date,
  expected_registration_count integer not null default 0,
  expected_result_count integer not null default 0,
  assignment_state text not null default 'unassigned',
  assignment_note text,
  assigned_by_user_id uuid references auth.users (id) on delete set null,
  assigned_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (legacy_import_batch_id, source_race_id),
  unique (legacy_import_batch_id, legacy_event_category_id),
  check (length(trim(source_race_id)) > 0),
  check (length(trim(legacy_event_name)) > 0),
  check (length(trim(legacy_category_name)) > 0),
  check (expected_registration_count >= 0),
  check (expected_result_count >= 0),
  check (assignment_state in ('unassigned', 'mapped', 'imported', 'verified', 'ignored')),
  check (
    (assignment_state = 'unassigned' and canonical_event_category_id is null)
    or assignment_state = 'ignored'
    or (
      assignment_state in ('mapped', 'imported', 'verified')
      and canonical_event_category_id is not null
    )
  )
);

alter table public.legacy_category_assignment_pool enable row level security;
revoke all on table public.legacy_category_assignment_pool from public, anon, authenticated;
grant select, insert, update, delete on table public.legacy_category_assignment_pool to service_role;

create index legacy_category_assignment_pool_state_idx
  on public.legacy_category_assignment_pool (assignment_state, legacy_start_date);

create index legacy_category_assignment_pool_canonical_idx
  on public.legacy_category_assignment_pool (canonical_event_category_id)
  where canonical_event_category_id is not null;

create or replace function public.is_active_platform_administrator(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_administrators administrator
    where administrator.user_id = p_user_id
      and administrator.is_active
      and administrator.platform_role in ('super_admin', 'site_admin')
  )
$$;

revoke all on function public.is_active_platform_administrator(uuid)
  from public, anon, authenticated;
grant execute on function public.is_active_platform_administrator(uuid) to service_role;

create or replace function public.is_platform_administrator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_platform_administrator(public.request_user_id())
$$;

revoke all on function public.is_platform_administrator()
  from public, anon, authenticated;
grant execute on function public.is_platform_administrator() to authenticated, service_role;

create or replace function public.service_refresh_legacy_category_assignment_pool()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  insert into public.legacy_category_assignment_pool (
    legacy_import_batch_id,
    source_race_id,
    legacy_event_edition_id,
    legacy_event_category_id,
    legacy_event_name,
    legacy_category_name,
    legacy_start_date,
    expected_registration_count,
    expected_result_count
  )
  select
    entity_map.legacy_import_batch_id,
    entity_map.source_id,
    edition.id,
    category.id,
    edition.name,
    category.name,
    edition.start_date,
    (
      select count(*)::integer
      from public.registrations registration
      where registration.event_category_id = category.id
    ),
    (
      select count(*)::integer
      from public.result_rows result_row
      where result_row.event_category_id = category.id
    )
  from migration_support.legacy_entity_map entity_map
  join migration_support.legacy_import_batches import_batch
    on import_batch.id = entity_map.legacy_import_batch_id
   and import_batch.import_state = 'completed'
  join public.event_categories category
    on category.id = entity_map.target_id
  join public.event_editions edition
    on edition.id = category.event_edition_id
  where entity_map.source_table = 'races'
    and entity_map.target_table = 'event_categories'
  on conflict (legacy_import_batch_id, source_race_id) do update
  set
    legacy_event_edition_id = excluded.legacy_event_edition_id,
    legacy_event_category_id = excluded.legacy_event_category_id,
    legacy_event_name = excluded.legacy_event_name,
    legacy_category_name = excluded.legacy_category_name,
    legacy_start_date = excluded.legacy_start_date,
    expected_registration_count = excluded.expected_registration_count,
    expected_result_count = excluded.expected_result_count,
    updated_at = clock_timestamp();

  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$$;

revoke all on function public.service_refresh_legacy_category_assignment_pool()
  from public, anon, authenticated;
grant execute on function public.service_refresh_legacy_category_assignment_pool()
  to service_role;

select public.service_refresh_legacy_category_assignment_pool();

comment on table public.platform_administrators is
  'Server-owned global administrators. Super admins may manage site admins; site admins receive all other platform privileges.';
comment on table public.platform_test_accounts is
  'Server-owned test identities restricted to the organizer testing workspace and denied production organizer permissions.';
comment on table public.legacy_category_assignment_pool is
  'Non-destructive assignment index from immutable legacy categories to manually recreated canonical categories.';
comment on function public.service_refresh_legacy_category_assignment_pool() is
  'Service-only refresh of assignment-pool counts and legacy category metadata from the private migration archive.';

commit;
