/*
 * Public authentication throttles must survive serverless cold starts, and a
 * guest registration claim must survive the email-verification redirect on a
 * different browser. Both tables are service-only implementation details.
 */

create table public.public_auth_rate_limits (
  bucket_key text primary key,
  attempts integer not null,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (bucket_key ~ '^[a-f0-9]{64}$'),
  check (attempts > 0)
);

alter table public.public_auth_rate_limits enable row level security;
revoke all on table public.public_auth_rate_limits from public, anon, authenticated;

create or replace function public.service_consume_public_auth_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_bucket public.public_auth_rate_limits%rowtype;
  request_time timestamptz := clock_timestamp();
begin
  if p_bucket_key !~ '^[a-f0-9]{64}$'
     or p_limit < 1
     or p_limit > 1000
     or p_window_seconds < 1
     or p_window_seconds > 86400 then
    raise exception using errcode = '22023', message = 'invalid_public_auth_rate_limit';
  end if;

  insert into public.public_auth_rate_limits (
    bucket_key,
    attempts,
    reset_at,
    updated_at
  )
  values (
    p_bucket_key,
    1,
    request_time + make_interval(secs => p_window_seconds),
    request_time
  )
  on conflict (bucket_key)
  do update set
    attempts = case
      when public.public_auth_rate_limits.reset_at <= request_time then 1
      else public.public_auth_rate_limits.attempts + 1
    end,
    reset_at = case
      when public.public_auth_rate_limits.reset_at <= request_time
        then request_time + make_interval(secs => p_window_seconds)
      else public.public_auth_rate_limits.reset_at
    end,
    updated_at = request_time
  returning * into saved_bucket;

  delete from public.public_auth_rate_limits rate_limit
  where rate_limit.reset_at < request_time - interval '1 day';

  return jsonb_build_object(
    'allowed', saved_bucket.attempts <= p_limit,
    'retryAfterSeconds', case
      when saved_bucket.attempts <= p_limit then null
      else greatest(1, ceil(extract(epoch from saved_bucket.reset_at - request_time)))::integer
    end
  );
end;
$$;

revoke all on function public.service_consume_public_auth_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.service_consume_public_auth_rate_limit(text, integer, integer)
  to service_role;

create table public.guest_registration_claim_intents (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  claimed_by_user_id uuid references auth.users (id) on delete cascade,
  outcome text,
  claim_request_id uuid references public.athlete_claims (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  check (token_hash ~ '^[a-f0-9]{64}$'),
  check (expires_at > created_at),
  check (outcome is null or outcome in ('claimed', 'pending_review')),
  check (
    (claimed_at is null and claimed_by_user_id is null and outcome is null)
    or (claimed_at is not null and claimed_by_user_id is not null and outcome is not null)
  )
);

create index guest_registration_claim_intents_registration_idx
  on public.guest_registration_claim_intents (registration_id, created_at desc);
create index guest_registration_claim_intents_expiry_idx
  on public.guest_registration_claim_intents (expires_at)
  where claimed_at is null;

alter table public.guest_registration_claim_intents enable row level security;
revoke all on table public.guest_registration_claim_intents from public, anon, authenticated;
grant select, insert, update on table public.guest_registration_claim_intents to service_role;

comment on table public.public_auth_rate_limits is
  'Service-only, shared rate-limit buckets for public authentication endpoints.';
comment on table public.guest_registration_claim_intents is
  'Short-lived service-only bearer intents that preserve a verified guest-registration access grant across authentication redirects.';
