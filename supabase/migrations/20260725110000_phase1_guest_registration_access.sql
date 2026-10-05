/*
 * Opaque, server-hashed guest access grants let an unclaimed runner pay and
 * inspect exactly one registration without exposing athlete identity tables.
 */

create table public.guest_registration_access_grants (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references public.registrations (id) on delete cascade,
  token_hash text not null unique,
  guest_email citext not null,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (length(token_hash) = 64),
  check (expires_at > created_at)
);

alter table public.guest_registration_access_grants enable row level security;
revoke all on table public.guest_registration_access_grants
  from public, anon, authenticated;
grant all on table public.guest_registration_access_grants
  to service_role;

create or replace function public.service_issue_guest_registration_access(
  p_registration_id uuid,
  p_token_hash text,
  p_guest_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  registration_row public.registrations%rowtype;
  resolved_expiry timestamptz;
  saved_grant public.guest_registration_access_grants%rowtype;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_guest_access_token_hash';
  end if;

  select registration.*
  into registration_row
  from public.registrations registration
  where registration.id = p_registration_id
  for update;

  if not found or registration_row.source <> 'guest' then
    raise exception using errcode = 'P0002', message = 'guest_registration_not_found';
  end if;

  select greatest(
    (coalesce(edition.end_date, edition.start_date) + 30)::timestamptz,
    now() + interval '30 days'
  )
  into resolved_expiry
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  where category.id = registration_row.event_category_id;

  insert into public.guest_registration_access_grants (
    registration_id,
    token_hash,
    guest_email,
    expires_at
  )
  values (
    registration_row.id,
    p_token_hash,
    lower(trim(p_guest_email)),
    resolved_expiry
  )
  on conflict (registration_id)
  do update set
    token_hash = excluded.token_hash,
    guest_email = excluded.guest_email,
    expires_at = greatest(
      public.guest_registration_access_grants.expires_at,
      excluded.expires_at
    ),
    revoked_at = null
  where public.guest_registration_access_grants.guest_email = excluded.guest_email
  returning * into saved_grant;

  if saved_grant.id is null then
    raise exception using errcode = '23505', message = 'guest_access_identity_mismatch';
  end if;

  return jsonb_build_object(
    'registrationId', saved_grant.registration_id,
    'expiresAt', saved_grant.expires_at
  );
end;
$$;

create or replace function public.service_validate_guest_registration_access(
  p_registration_id uuid,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row public.guest_registration_access_grants%rowtype;
begin
  update public.guest_registration_access_grants access_grant
  set last_used_at = now()
  where access_grant.registration_id = p_registration_id
    and access_grant.token_hash = p_token_hash
    and access_grant.revoked_at is null
    and access_grant.expires_at > now()
  returning * into grant_row;

  if not found then
    raise exception using errcode = '28000', message = 'invalid_guest_registration_access';
  end if;

  return jsonb_build_object(
    'registrationId', grant_row.registration_id,
    'guestEmail', grant_row.guest_email,
    'expiresAt', grant_row.expires_at
  );
end;
$$;

revoke all on function public.service_issue_guest_registration_access(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.service_validate_guest_registration_access(uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_issue_guest_registration_access(uuid, text, text)
  to service_role;
grant execute on function public.service_validate_guest_registration_access(uuid, text)
  to service_role;
