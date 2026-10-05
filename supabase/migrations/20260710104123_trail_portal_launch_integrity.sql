alter table public.event_locations enable row level security;

drop policy if exists event_locations_select_public_or_org on public.event_locations;
create policy event_locations_select_public_or_org
on public.event_locations
for select
using (
  public.is_event_edition_public(event_edition_id)
  or public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
  or public.can_time_organization(public.organization_id_for_event_edition(event_edition_id))
);

drop policy if exists event_locations_insert_manage on public.event_locations;
create policy event_locations_insert_manage
on public.event_locations
for insert
with check (
  public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
);

drop policy if exists event_locations_update_manage on public.event_locations;
create policy event_locations_update_manage
on public.event_locations
for update
using (
  public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
)
with check (
  public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
);

drop policy if exists event_locations_delete_manage on public.event_locations;
create policy event_locations_delete_manage
on public.event_locations
for delete
using (
  public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
);

alter table public.registrations
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists public_start_list_opt_in boolean not null default false,
  add column if not exists idempotency_key_hash text,
  add column if not exists idempotency_request_hash text;

alter table public.registrations
  drop constraint if exists registrations_terms_acceptance_pair_check;

alter table public.registrations
  add constraint registrations_terms_acceptance_pair_check
  check (
    (terms_version is null and terms_accepted_at is null)
    or (length(trim(terms_version)) > 0 and terms_accepted_at is not null)
  );

create unique index if not exists registrations_idempotency_key_hash_uidx
  on public.registrations (idempotency_key_hash)
  where idempotency_key_hash is not null;

create unique index if not exists result_runs_one_running_per_category_uidx
  on public.result_runs (event_category_id)
  where status = 'running';

create table if not exists public.registration_payment_evidence (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  object_path text not null,
  original_file_name text not null,
  content_type text not null,
  amount_cents integer,
  currency text,
  review_status text not null default 'submitted',
  submitted_by_user_id uuid,
  reviewed_by_user_id uuid,
  organizer_note text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(object_path)) > 0),
  check (length(trim(original_file_name)) > 0),
  check (amount_cents is null or amount_cents >= 0),
  check (currency is null or currency ~ '^[A-Z]{3}$'),
  check (review_status in ('submitted', 'verified', 'rejected')),
  check (
    (review_status = 'submitted' and reviewed_at is null)
    or (review_status in ('verified', 'rejected') and reviewed_at is not null)
  )
);

create index if not exists registration_payment_evidence_registration_idx
  on public.registration_payment_evidence (registration_id, submitted_at desc);

drop trigger if exists registration_payment_evidence_set_updated_at
  on public.registration_payment_evidence;
create trigger registration_payment_evidence_set_updated_at
before update on public.registration_payment_evidence
for each row execute function public.set_updated_at();

alter table public.registration_payment_evidence enable row level security;

drop policy if exists registration_payment_evidence_select_self_or_org
  on public.registration_payment_evidence;
create policy registration_payment_evidence_select_self_or_org
on public.registration_payment_evidence
for select
to authenticated
using (
  public.user_can_access_registration(registration_id)
  or public.can_manage_organization(public.organization_id_for_registration(registration_id))
);

drop policy if exists registration_payment_evidence_insert_self
  on public.registration_payment_evidence;
create policy registration_payment_evidence_insert_self
on public.registration_payment_evidence
for insert
to authenticated
with check (
  public.user_can_access_registration(registration_id)
  and submitted_by_user_id = public.request_user_id()
  and review_status = 'submitted'
);

drop policy if exists registration_payment_evidence_update_org
  on public.registration_payment_evidence;
create policy registration_payment_evidence_update_org
on public.registration_payment_evidence
for update
to authenticated
using (
  public.can_manage_organization(public.organization_id_for_registration(registration_id))
)
with check (
  public.can_manage_organization(public.organization_id_for_registration(registration_id))
);

revoke all on table public.registration_payment_evidence from public, anon, authenticated;
grant select, insert, update on table public.registration_payment_evidence to authenticated;
grant all on table public.registration_payment_evidence to service_role;

/*
 * Function bodies are intentionally applied in the following ordered migrations.
 * Supabase CLI 2.75 cannot split this large migration when PL/pgSQL bodies are inline.
 * Keeping the original definitions here as comments documents the complete change.
 *

create or replace function public.create_registration_atomically(
  target_event_category_id uuid,
  target_athlete_profile_id uuid,
  target_represented_club_id uuid default null,
  target_changed_by_user_id uuid default null,
  target_source text default 'direct',
  target_terms_version text default null,
  target_terms_accepted_at timestamptz default null,
  target_public_start_list_opt_in boolean default false,
  target_idempotency_key_hash text default null,
  target_idempotency_request_hash text default null
)
returns table (
  registration_id uuid,
  registration_status public.registration_status,
  payment_status public.payment_status
)
language plpgsql
security definer
set search_path = public
as $$
declare
  category_row public.event_categories%rowtype;
  edition_row public.event_editions%rowtype;
  existing_registration public.registrations%rowtype;
  created_registration public.registrations%rowtype;
  active_registration_count bigint;
  initial_status public.registration_status;
  initial_payment_status public.payment_status;
begin
  if target_source not in ('direct', 'guest') then
    raise exception using errcode = '22023', message = 'invalid_registration_source';
  end if;

  if target_terms_version is null or length(trim(target_terms_version)) = 0 or target_terms_accepted_at is null then
    raise exception using errcode = '22023', message = 'terms_acceptance_required';
  end if;

  select *
  into category_row
  from public.event_categories
  where id = target_event_category_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;

  select *
  into edition_row
  from public.event_editions
  where id = category_row.event_edition_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  if category_row.status in ('closed', 'completed')
     or edition_row.status not in ('published', 'registration_open', 'registration_closed')
     or (edition_row.registration_open_at is not null and edition_row.registration_open_at > now())
     or (edition_row.registration_close_at is not null and edition_row.registration_close_at < now()) then
    raise exception using errcode = 'P0001', message = 'registration_closed';
  end if;

  if target_idempotency_key_hash is not null then
    select *
    into existing_registration
    from public.registrations
    where idempotency_key_hash = target_idempotency_key_hash;

    if found then
      if existing_registration.idempotency_request_hash is distinct from target_idempotency_request_hash then
        raise exception using errcode = '23505', message = 'idempotency_key_reused';
      end if;

      return query
      select existing_registration.id, existing_registration.status, existing_registration.payment_status;
      return;
    end if;
  end if;

  select *
  into existing_registration
  from public.registrations
  where event_category_id = target_event_category_id
    and athlete_profile_id = target_athlete_profile_id
    and status <> 'cancelled'
  order by created_at desc
  limit 1;

  if found then
    raise exception using errcode = '23505', message = 'already_registered';
  end if;

  if category_row.capacity is not null and category_row.capacity > 0 then
    select count(*)
    into active_registration_count
    from public.registrations
    where event_category_id = target_event_category_id
      and status in ('pending', 'confirmed', 'waitlisted');

    if active_registration_count >= category_row.capacity then
      raise exception using errcode = 'P0001', message = 'category_full';
    end if;
  end if;

  if coalesce(category_row.registration_fee_cents, 0) > 0 then
    initial_status := 'pending';
    initial_payment_status := 'unpaid';
  else
    initial_status := 'confirmed';
    initial_payment_status := 'not_required';
  end if;

  insert into public.registrations (
    event_category_id,
    athlete_profile_id,
    represented_club_id,
    status,
    payment_status,
    confirmed_at,
    source,
    terms_version,
    terms_accepted_at,
    public_start_list_opt_in,
    idempotency_key_hash,
    idempotency_request_hash
  ) values (
    target_event_category_id,
    target_athlete_profile_id,
    target_represented_club_id,
    initial_status,
    initial_payment_status,
    null,
    target_source,
    trim(target_terms_version),
    target_terms_accepted_at,
    target_public_start_list_opt_in,
    target_idempotency_key_hash,
    target_idempotency_request_hash
  )
  returning * into created_registration;

  insert into public.registration_status_history (
    registration_id,
    from_status,
    to_status,
    changed_by_user_id,
    reason
  ) values (
    created_registration.id,
    null,
    created_registration.status,
    target_changed_by_user_id,
    case when target_source = 'guest' then 'guest_created' else 'created' end
  );

  return query
  select created_registration.id, created_registration.status, created_registration.payment_status;
end;
$$;

revoke all on function public.create_registration_atomically(
  uuid, uuid, uuid, uuid, text, text, timestamptz, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.create_registration_atomically(
  uuid, uuid, uuid, uuid, text, text, timestamptz, boolean, text, text
) to service_role;

create or replace function public.publish_result_run_atomically(
  target_event_category_id uuid,
  target_result_run_id uuid,
  target_publication_state public.publication_state,
  target_published_by_user_id uuid,
  target_change_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  latest_publication_id uuid;
  created_publication_id uuid;
begin
  perform 1
  from public.event_categories
  where id = target_event_category_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;

  if not exists (
    select 1
    from public.result_runs
    where id = target_result_run_id
      and event_category_id = target_event_category_id
      and status = 'succeeded'
  ) then
    raise exception using errcode = 'P0001', message = 'successful_result_run_required';
  end if;

  select id
  into latest_publication_id
  from public.result_publications
  where event_category_id = target_event_category_id
  order by published_at desc, created_at desc, id desc
  limit 1;

  if target_publication_state = 'corrected' and latest_publication_id is null then
    raise exception using errcode = 'P0001', message = 'correction_requires_previous_publication';
  end if;

  insert into public.result_publications (
    event_category_id,
    result_run_id,
    publication_state,
    published_by_user_id,
    supersedes_publication_id,
    change_note
  ) values (
    target_event_category_id,
    target_result_run_id,
    target_publication_state,
    target_published_by_user_id,
    latest_publication_id,
    target_change_note
  )
  returning id into created_publication_id;

  update public.result_rows
  set result_status = case
    when target_publication_state = 'corrected' then 'corrected'::public.result_status
    when target_publication_state = 'official' then 'official'::public.result_status
    else 'provisional'::public.result_status
  end
  where result_run_id = target_result_run_id;

  return created_publication_id;
end;
$$;

revoke all on function public.publish_result_run_atomically(
  uuid, uuid, public.publication_state, uuid, text
) from public, anon, authenticated;
grant execute on function public.publish_result_run_atomically(
  uuid, uuid, public.publication_state, uuid, text
) to service_role;

*/

create index if not exists athlete_aliases_athlete_profile_id_fkey_idx on public.athlete_aliases (athlete_profile_id);
create index if not exists athlete_badges_athlete_activity_id_fkey_idx on public.athlete_badges (athlete_activity_id);
create index if not exists athlete_badges_result_row_id_fkey_idx on public.athlete_badges (result_row_id);
create index if not exists athlete_badges_track_attempt_id_fkey_idx on public.athlete_badges (track_attempt_id);
create index if not exists athlete_claims_claimant_user_id_fkey_idx on public.athlete_claims (claimant_user_id);
create index if not exists athlete_claims_reviewed_by_user_id_fkey_idx on public.athlete_claims (reviewed_by_user_id);
create index if not exists athlete_favorites_club_id_fkey_idx on public.athlete_favorites (club_id);
create index if not exists athlete_favorites_event_edition_id_fkey_idx on public.athlete_favorites (event_edition_id);
create index if not exists athlete_favorites_target_athlete_profile_id_fkey_idx on public.athlete_favorites (target_athlete_profile_id);
create index if not exists athlete_favorites_track_template_id_fkey_idx on public.athlete_favorites (track_template_id);
create index if not exists bib_assignments_registration_id_fkey_idx on public.bib_assignments (registration_id);
create index if not exists club_posts_author_athlete_profile_id_fkey_idx on public.club_posts (author_athlete_profile_id);
create index if not exists club_posts_club_id_fkey_idx on public.club_posts (club_id);
create index if not exists clubs_created_by_athlete_profile_id_fkey_idx on public.clubs (created_by_athlete_profile_id);
create index if not exists event_categories_ruleset_id_fkey_idx on public.event_categories (ruleset_id);
create index if not exists event_category_track_snapshots_track_template_id_fkey_idx on public.event_category_track_snapshots (track_template_id);
create index if not exists event_category_track_snapshots_track_version_id_fkey_idx on public.event_category_track_snapshots (track_version_id);
create index if not exists event_documents_event_edition_id_fkey_idx on public.event_documents (event_edition_id);
create index if not exists export_jobs_organization_id_fkey_idx on public.export_jobs (organization_id);
create index if not exists league_club_standings_club_id_fkey_idx on public.league_club_standings (club_id);
create index if not exists league_individual_standings_athlete_profile_id_fkey_idx on public.league_individual_standings (athlete_profile_id);
create index if not exists league_rounds_event_category_id_fkey_idx on public.league_rounds (event_category_id);
create index if not exists league_rounds_event_edition_id_fkey_idx on public.league_rounds (event_edition_id);
create index if not exists punch_event_revisions_punch_event_id_fkey_idx on public.punch_event_revisions (punch_event_id);
create index if not exists punch_events_athlete_profile_id_fkey_idx on public.punch_events (athlete_profile_id);
create index if not exists punch_events_device_id_fkey_idx on public.punch_events (device_id);
create index if not exists punch_events_timing_session_id_fkey_idx on public.punch_events (timing_session_id);
create index if not exists registrations_athlete_profile_id_fkey_idx on public.registrations (athlete_profile_id);
create index if not exists registrations_represented_club_id_fkey_idx on public.registrations (represented_club_id);
create index if not exists result_publications_result_run_id_fkey_idx on public.result_publications (result_run_id);
create index if not exists result_publications_supersedes_publication_id_fkey_idx on public.result_publications (supersedes_publication_id);
create index if not exists result_rows_athlete_profile_id_fkey_idx on public.result_rows (athlete_profile_id);
create index if not exists result_rows_registration_id_fkey_idx on public.result_rows (registration_id);
create index if not exists result_rows_represented_club_id_fkey_idx on public.result_rows (represented_club_id);
create index if not exists result_splits_checkpoint_id_fkey_idx on public.result_splits (checkpoint_id);
create index if not exists timing_devices_organization_id_fkey_idx on public.timing_devices (organization_id);
create index if not exists timing_sessions_checkpoint_id_fkey_idx on public.timing_sessions (checkpoint_id);
create index if not exists timing_sessions_device_id_fkey_idx on public.timing_sessions (device_id);
create index if not exists timing_sessions_event_edition_id_fkey_idx on public.timing_sessions (event_edition_id);
create index if not exists track_attempts_track_version_id_fkey_idx on public.track_attempts (track_version_id);
create index if not exists track_condition_reports_athlete_profile_id_fkey_idx on public.track_condition_reports (athlete_profile_id);
create index if not exists track_reviews_athlete_profile_id_fkey_idx on public.track_reviews (athlete_profile_id);

/*
 * Public participant function body is applied in
 * 20260710110701_public_participant_privacy_function.sql.
 *

drop function if exists public.public_event_participants(uuid);

create function public.public_event_participants(
  target_event_edition_id uuid
)
returns table (
  registration_id uuid,
  athlete_profile_id uuid,
  event_category_id uuid,
  event_category_slug text,
  event_category_name text,
  bib_number text,
  athlete_slug text,
  athlete_name text,
  club_slug text,
  club_name text,
  gender text,
  age_category_label text,
  registration_status text,
  participation_status text,
  result_status text,
  publication_state text,
  published_at timestamptz,
  finish_time_ms bigint,
  rank_overall integer,
  rank_gender integer,
  rank_age_category integer
)
language sql
security definer
set search_path = public
as $$
  with event_context as (
    select ee.start_date as reference_date
    from public.event_editions ee
    where ee.id = target_event_edition_id
  ),
  scoped_categories as (
    select
      ec.id,
      ec.slug,
      ec.name,
      coalesce(ec.display_order, 0) as display_order
    from public.event_categories ec
    where ec.event_edition_id = target_event_edition_id
      and public.is_event_category_public(ec.id)
  ),
  latest_publications as (
    select
      ranked.event_category_id,
      ranked.result_run_id,
      ranked.publication_state,
      ranked.published_at
    from (
      select
        rp.event_category_id,
        rp.result_run_id,
        rp.publication_state,
        rp.published_at,
        row_number() over (
          partition by rp.event_category_id
          order by rp.published_at desc, rp.created_at desc, rp.id desc
        ) as publication_rank
      from public.result_publications rp
      join scoped_categories sc
        on sc.id = rp.event_category_id
    ) ranked
    where ranked.publication_rank = 1
  ),
  active_bibs as (
    select
      ba.registration_id,
      ba.bib_number
    from public.bib_assignments ba
    where ba.revoked_at is null
  )
  select
    r.id as registration_id,
    ap.id as athlete_profile_id,
    sc.id as event_category_id,
    sc.slug as event_category_slug,
    sc.name as event_category_name,
    coalesce(active_bibs.bib_number, '—') as bib_number,
    ap.slug as athlete_slug,
    coalesce(ap.display_name, ap.slug, 'Trail Runner') as athlete_name,
    clubs.slug as club_slug,
    coalesce(clubs.name, 'Independent') as club_name,
    coalesce(ap.gender, '') as gender,
    case
      when ap.date_of_birth is null then
        case
          when upper(left(coalesce(ap.gender, ''), 1)) = 'F' then 'Women Open'
          when upper(left(coalesce(ap.gender, ''), 1)) = 'M' then 'Men Open'
          else 'Open'
        end
      when extract(year from age(coalesce(ctx.reference_date, current_date), ap.date_of_birth)) < 23 then 'U23'
      when upper(left(coalesce(ap.gender, ''), 1)) = 'F' then
        case
          when extract(year from age(coalesce(ctx.reference_date, current_date), ap.date_of_birth)) >= 50 then 'W50+'
          when extract(year from age(coalesce(ctx.reference_date, current_date), ap.date_of_birth)) >= 40 then 'W40+'
          when extract(year from age(coalesce(ctx.reference_date, current_date), ap.date_of_birth)) >= 35 then 'W35+'
          else 'Women Open'
        end
      when upper(left(coalesce(ap.gender, ''), 1)) = 'M' then
        case
          when extract(year from age(coalesce(ctx.reference_date, current_date), ap.date_of_birth)) >= 50 then 'M50+'
          when extract(year from age(coalesce(ctx.reference_date, current_date), ap.date_of_birth)) >= 40 then 'M40+'
          when extract(year from age(coalesce(ctx.reference_date, current_date), ap.date_of_birth)) >= 35 then 'M35+'
          else 'Men Open'
        end
      else 'Open'
    end as age_category_label,
    r.status::text as registration_status,
    r.participation_status::text as participation_status,
    r.result_status::text as result_status,
    latest_publications.publication_state::text as publication_state,
    latest_publications.published_at,
    result_rows.finish_time_ms,
    result_rows.rank_overall,
    result_rows.rank_gender,
    result_rows.rank_age_category
  from public.registrations r
  join scoped_categories sc
    on sc.id = r.event_category_id
  join public.athlete_profiles ap
    on ap.id = r.athlete_profile_id
  cross join event_context ctx
  left join public.clubs
    on clubs.id = r.represented_club_id
  left join active_bibs
    on active_bibs.registration_id = r.id
  left join latest_publications
    on latest_publications.event_category_id = r.event_category_id
  left join public.result_rows
    on result_rows.result_run_id = latest_publications.result_run_id
   and result_rows.registration_id = r.id
  where r.status in ('pending', 'confirmed')
    and (
      r.public_start_list_opt_in
      or (
        latest_publications.publication_state in ('official', 'corrected')
        and result_rows.id is not null
      )
    )
  order by
    sc.display_order asc,
    sc.name asc,
    case when result_rows.rank_overall is null then 1 else 0 end asc,
    result_rows.rank_overall asc nulls last,
    active_bibs.bib_number asc nulls last,
    coalesce(ap.display_name, ap.slug, 'Trail Runner') asc;
$$;

revoke all on function public.public_event_participants(uuid) from public;
grant execute on function public.public_event_participants(uuid) to anon, authenticated, service_role;
*/
