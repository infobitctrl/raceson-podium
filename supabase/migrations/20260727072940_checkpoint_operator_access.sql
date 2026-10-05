/*
 * Dedicated checkpoint-operator boundary.
 *
 * Checkpoint accounts retain organization membership for identity and lifecycle
 * management, but their race-day data and punch access is restricted to an
 * explicit event category + checkpoint assignment.
 */

insert into public.organization_permission_catalog (
  permission_code,
  area,
  title,
  description,
  sensitivity,
  staff_default,
  timer_default,
  is_active
)
values (
  'timing.punch',
  'timing',
  'Record checkpoint punches',
  'Record and undo bib punches only at an explicitly assigned checkpoint.',
  'standard',
  false,
  false,
  true
)
on conflict (permission_code) do update
set
  title = excluded.title,
  description = excluded.description,
  sensitivity = excluded.sensitivity,
  staff_default = excluded.staff_default,
  timer_default = excluded.timer_default,
  is_active = excluded.is_active;
-- Legacy timer memberships no longer receive broad timing/results permissions.
-- Existing owners, admins, and staff keep their current defaults.
update public.organization_permission_catalog
set timer_default = false
where timer_default;
create table public.organization_checkpoint_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  user_id uuid not null
    references auth.users (id) on delete cascade,
  event_edition_id uuid not null
    references public.event_editions (id) on delete cascade,
  event_category_id uuid not null
    references public.event_categories (id) on delete cascade,
  checkpoint_id uuid not null
    references public.checkpoints (id) on delete cascade,
  assignment_state text not null default 'active',
  starts_at timestamptz not null default clock_timestamp(),
  ends_at timestamptz,
  assigned_by_user_id uuid not null
    references auth.users (id),
  revoked_by_user_id uuid
    references auth.users (id),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, user_id, event_category_id, checkpoint_id),
  check (assignment_state in ('active', 'revoked', 'expired')),
  check (ends_at is null or ends_at > starts_at),
  check (
    assignment_state = 'active'
    or (
      revoked_by_user_id is not null
      and revoked_at is not null
      and length(trim(revocation_reason)) > 0
    )
  )
);
create index organization_checkpoint_assignments_user_active_idx
  on public.organization_checkpoint_assignments (
    user_id,
    event_edition_id,
    assignment_state,
    starts_at,
    ends_at
  );
create index organization_checkpoint_assignments_station_active_idx
  on public.organization_checkpoint_assignments (
    organization_id,
    event_category_id,
    checkpoint_id,
    assignment_state
  );
alter table public.organization_checkpoint_assignments enable row level security;
revoke all on table public.organization_checkpoint_assignments
  from public, anon, authenticated;
grant select, insert, update, delete on table public.organization_checkpoint_assignments
  to service_role;
create or replace function public.is_active_checkpoint_operator(
  p_user_id uuid,
  p_organization_id uuid,
  p_event_category_id uuid,
  p_checkpoint_id uuid,
  p_effective_at timestamptz default clock_timestamp()
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_checkpoint_assignments assignment
    where assignment.user_id = p_user_id
      and assignment.organization_id = p_organization_id
      and assignment.event_category_id = p_event_category_id
      and assignment.checkpoint_id = p_checkpoint_id
      and assignment.assignment_state = 'active'
      and assignment.starts_at <= p_effective_at
      and (assignment.ends_at is null or assignment.ends_at > p_effective_at)
  )
$$;
revoke all on function public.is_active_checkpoint_operator(
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.is_active_checkpoint_operator(
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz
) to service_role;
comment on table public.organization_checkpoint_assignments is
  'Server-owned event-category and checkpoint access for mobile checkpoint operators.';
