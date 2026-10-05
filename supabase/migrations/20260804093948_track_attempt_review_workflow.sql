begin;

alter table public.track_attempts
  alter column started_at drop not null,
  add column if not exists submitted_at timestamptz not null default now(),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by_user_id uuid references auth.users (id) on delete set null,
  add column if not exists review_note text;

update public.track_attempts
set submitted_at = created_at;

alter table public.track_attempts
  drop constraint if exists track_attempts_verified_fields_check;

alter table public.track_attempts
  add constraint track_attempts_verified_fields_check
  check (
    verification_status <> 'verified'
    or (
      started_at is not null
      and elapsed_time_ms is not null
      and elapsed_time_ms > 0
    )
  );

create unique index if not exists track_attempts_strava_url_unique_idx
  on public.track_attempts (strava_url)
  where strava_url is not null;

create index if not exists track_attempts_review_queue_idx
  on public.track_attempts (verification_status, submitted_at desc);

create table if not exists public.track_attempt_reviews (
  id uuid primary key default gen_random_uuid(),
  track_attempt_id uuid not null references public.track_attempts (id) on delete cascade,
  reviewer_user_id uuid references auth.users (id) on delete set null,
  reviewer_platform_role text not null default 'super_admin',
  previous_status public.track_attempt_verification_status not null,
  decision public.track_attempt_verification_status not null,
  review_note text,
  snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (reviewer_platform_role = 'super_admin'),
  check (decision in ('verified', 'rejected'))
);

create index if not exists track_attempt_reviews_attempt_created_idx
  on public.track_attempt_reviews (track_attempt_id, created_at desc);

alter table public.track_attempt_reviews enable row level security;

revoke all on table public.track_attempt_reviews from anon, authenticated;
grant select, insert, update, delete on table public.track_attempt_reviews to service_role;

drop policy if exists track_attempts_select_public_self_or_org on public.track_attempts;
drop policy if exists track_attempts_insert_self_or_org on public.track_attempts;
drop policy if exists track_attempts_update_self_or_org on public.track_attempts;
drop policy if exists track_attempts_delete_self_or_org on public.track_attempts;

create policy track_attempts_select_verified
on public.track_attempts
for select
to anon
using (verification_status = 'verified');

create policy track_attempts_select_authenticated
on public.track_attempts
for select
to authenticated
using (
  verification_status = 'verified'
  or (select public.user_can_access_athlete_profile(athlete_profile_id))
);

revoke insert, update, delete on table public.track_attempts from anon, authenticated;
grant select on table public.track_attempts to anon, authenticated;
grant select, insert, update, delete on table public.track_attempts to service_role;

create or replace function public.review_track_attempt(
  p_attempt_id uuid,
  p_reviewer_user_id uuid,
  p_decision public.track_attempt_verification_status,
  p_review_note text default null,
  p_started_at timestamptz default null,
  p_elapsed_time_ms bigint default null,
  p_result_json jsonb default '{}'::jsonb
)
returns public.track_attempts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_attempt public.track_attempts;
  reviewed_attempt public.track_attempts;
begin
  if p_decision not in ('verified', 'rejected') then
    raise exception 'Track attempt decision must be verified or rejected';
  end if;

  if p_decision = 'verified' and (p_started_at is null or p_elapsed_time_ms is null or p_elapsed_time_ms <= 0) then
    raise exception 'Verified track attempts require a start time and positive elapsed time';
  end if;

  select *
  into previous_attempt
  from public.track_attempts
  where id = p_attempt_id
  for update;

  if not found then
    raise exception 'Track attempt not found';
  end if;

  update public.track_attempts
  set
    verification_status = p_decision,
    started_at = case when p_decision = 'verified' then p_started_at else started_at end,
    finished_at = case
      when p_decision = 'verified' then p_started_at + (p_elapsed_time_ms * interval '1 millisecond')
      else finished_at
    end,
    elapsed_time_ms = case when p_decision = 'verified' then p_elapsed_time_ms else elapsed_time_ms end,
    result_json = coalesce(result_json, '{}'::jsonb) || coalesce(p_result_json, '{}'::jsonb),
    reviewed_at = clock_timestamp(),
    reviewed_by_user_id = p_reviewer_user_id,
    review_note = nullif(btrim(p_review_note), ''),
    updated_at = clock_timestamp()
  where id = p_attempt_id
  returning * into reviewed_attempt;

  insert into public.track_attempt_reviews (
    track_attempt_id,
    reviewer_user_id,
    reviewer_platform_role,
    previous_status,
    decision,
    review_note,
    snapshot_json
  ) values (
    reviewed_attempt.id,
    p_reviewer_user_id,
    'super_admin',
    previous_attempt.verification_status,
    p_decision,
    nullif(btrim(p_review_note), ''),
    pg_catalog.jsonb_build_object(
      'before', pg_catalog.to_jsonb(previous_attempt),
      'after', pg_catalog.to_jsonb(reviewed_attempt)
    )
  );

  return reviewed_attempt;
end;
$$;

revoke all on function public.review_track_attempt(
  uuid,
  uuid,
  public.track_attempt_verification_status,
  text,
  timestamptz,
  bigint,
  jsonb
) from public, anon, authenticated;

grant execute on function public.review_track_attempt(
  uuid,
  uuid,
  public.track_attempt_verification_status,
  text,
  timestamptz,
  bigint,
  jsonb
) to service_role;

commit;
