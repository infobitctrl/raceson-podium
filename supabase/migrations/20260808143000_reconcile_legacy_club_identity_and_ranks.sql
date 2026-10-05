begin;

/*
 * Reconcile the four imported 2026 league rounds against the read-only legacy
 * database snapshot audited on 2026-08-08.
 *
 * Source grain:
 *   - 432 active registrations across eight mapped race categories
 *   - 389 published result rows
 *
 * The candidate already contains every source registration and result, with
 * matching athlete, race, participation status, finish time, and club points.
 * This repair addresses the remaining presentation/scoring drift:
 *
 *   1. Mutable registrations and derived memberships still reference merged
 *      typo/alias club identities in 23 cases.
 *   2. Twenty current result rows carry those historical aliases. Published
 *      result evidence stays immutable, so corrected result runs canonicalize
 *      the club identity without rewriting the superseded rows.
 *   3. Eleven Raslina overall ranks differ from the legacy source because a
 *      previous candidate import converted equal times into tied competition
 *      ranks. The legacy ranks below are keyed by source registration evidence.
 */

create or replace function public.normalize_represented_club_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $normalize_represented_club_identity$
begin
  if new.represented_club_id is not null then
    new.represented_club_id := public.canonical_club_identity_id(
      new.represented_club_id
    );
  end if;

  return new;
end
$normalize_represented_club_identity$;

revoke all on function public.normalize_represented_club_identity()
  from public, anon, authenticated;

drop trigger if exists registrations_normalize_represented_club_identity
  on public.registrations;
create trigger registrations_normalize_represented_club_identity
before insert or update of represented_club_id
on public.registrations
for each row execute function public.normalize_represented_club_identity();

drop trigger if exists result_rows_normalize_represented_club_identity
  on public.result_rows;
create trigger result_rows_normalize_represented_club_identity
before insert or update of represented_club_id
on public.result_rows
for each row execute function public.normalize_represented_club_identity();

create or replace function public.apply_represented_club_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $apply_represented_club_membership$
begin
  if new.represented_club_id is null then
    return new;
  end if;

  insert into public.club_memberships (
    club_id,
    athlete_profile_id,
    membership_role,
    status,
    is_primary,
    joined_at,
    membership_origin
  )
  values (
    new.represented_club_id,
    new.athlete_profile_id,
    'member',
    'active',
    false,
    coalesce(new.confirmed_at, new.created_at, clock_timestamp()),
    'represented'
  )
  on conflict (club_id, athlete_profile_id)
  do update set
    membership_role = case
      when public.club_memberships.membership_origin = 'represented'
        then excluded.membership_role
      else public.club_memberships.membership_role
    end,
    status = 'active',
    joined_at = coalesce(public.club_memberships.joined_at, excluded.joined_at),
    membership_origin = case
      when public.club_memberships.membership_origin = 'represented'
        then excluded.membership_origin
      else public.club_memberships.membership_origin
    end,
    updated_at = clock_timestamp();

  return new;
end
$apply_represented_club_membership$;

revoke all on function public.apply_represented_club_membership()
  from public, anon, authenticated;

comment on function public.normalize_represented_club_identity() is
  'Canonicalizes represented club foreign keys on new or mutable race facts while approved merge evidence retains the imported alias lineage.';

comment on column public.clubs.merged_into_club_id is
  'Canonical directory identity for a merged club. Superseded signed result rows retain their historical ID; registrations and corrected public result publications use the canonical ID.';

create temporary table _target_legacy_categories (
  event_category_id uuid primary key,
  expected_result_count integer not null,
  correction_result_run_id uuid not null unique
) on commit drop;

insert into _target_legacy_categories (
  event_category_id,
  expected_result_count,
  correction_result_run_id
)
values
  (
    '9f962e45-6fb5-4eed-bc1f-dea59c9301ca',
    37,
    md5('20260808-legacy-source-truth:9f962e45-6fb5-4eed-bc1f-dea59c9301ca')::uuid
  ),
  (
    'cda95d40-ac9e-46f8-a8e2-54c821403afb',
    36,
    md5('20260808-legacy-source-truth:cda95d40-ac9e-46f8-a8e2-54c821403afb')::uuid
  ),
  (
    '7feb35db-19d7-b178-3b04-7fbc56e02b84',
    51,
    md5('20260808-legacy-source-truth:7feb35db-19d7-b178-3b04-7fbc56e02b84')::uuid
  ),
  (
    '4e498c18-36e1-ee92-70a4-6ed2db197b6c',
    66,
    md5('20260808-legacy-source-truth:4e498c18-36e1-ee92-70a4-6ed2db197b6c')::uuid
  ),
  (
    'd6bb6954-de4a-b828-ec20-5ad41b75b262',
    52,
    md5('20260808-legacy-source-truth:d6bb6954-de4a-b828-ec20-5ad41b75b262')::uuid
  ),
  (
    'fe849774-2e71-a2bf-e208-ef86dab53e10',
    50,
    md5('20260808-legacy-source-truth:fe849774-2e71-a2bf-e208-ef86dab53e10')::uuid
  ),
  (
    '0f9b18f8-28a6-c37f-a0f5-d60b993cdeec',
    53,
    md5('20260808-legacy-source-truth:0f9b18f8-28a6-c37f-a0f5-d60b993cdeec')::uuid
  ),
  (
    '281db898-b68f-d3f1-07b4-b1cc70059051',
    44,
    md5('20260808-legacy-source-truth:281db898-b68f-d3f1-07b4-b1cc70059051')::uuid
  );

create temporary table _legacy_rank_corrections (
  registration_id uuid primary key,
  source_registration_id text not null unique,
  event_category_id uuid not null,
  expected_candidate_rank integer not null,
  legacy_rank integer not null
) on commit drop;

insert into _legacy_rank_corrections (
  registration_id,
  source_registration_id,
  event_category_id,
  expected_candidate_rank,
  legacy_rank
)
values
  (
    'f3612534-fa44-e067-61e9-cde7fa8cfbb1',
    'duga-trkaci-raslina-126',
    '0f9b18f8-28a6-c37f-a0f5-d60b993cdeec',
    19,
    20
  ),
  (
    '4b876b73-0e55-7d48-b6c5-3dee24257270',
    'duga-trkaci-raslina-134',
    '0f9b18f8-28a6-c37f-a0f5-d60b993cdeec',
    49,
    50
  ),
  (
    '3b5c598d-fe04-06e7-3e4a-490356ee1b16',
    'duga-trkaci-raslina-156',
    '0f9b18f8-28a6-c37f-a0f5-d60b993cdeec',
    7,
    8
  ),
  (
    'b3467bc0-65f7-31fe-b39d-bbb078542480',
    'kratka-trkaci-raslina-22',
    '281db898-b68f-d3f1-07b4-b1cc70059051',
    35,
    36
  ),
  (
    '232c0832-316b-532c-a1f0-c648d1e91bf2',
    'kratka-trkaci-raslina-29',
    '281db898-b68f-d3f1-07b4-b1cc70059051',
    31,
    32
  ),
  (
    '8d8528e3-b895-5162-f919-2411cab38664',
    'kratka-trkaci-raslina-30',
    '281db898-b68f-d3f1-07b4-b1cc70059051',
    40,
    41
  ),
  (
    '41de7250-90a9-6194-5675-bc95ee040fa1',
    'kratka-trkaci-raslina-31',
    '281db898-b68f-d3f1-07b4-b1cc70059051',
    10,
    11
  ),
  (
    '71002e13-b978-e904-f404-f6626ffc5227',
    'kratka-trkaci-raslina-32',
    '281db898-b68f-d3f1-07b4-b1cc70059051',
    10,
    12
  ),
  (
    '8d4df939-26ef-c6e2-101b-c9200ede9cc3',
    'kratka-trkaci-raslina-33',
    '281db898-b68f-d3f1-07b4-b1cc70059051',
    40,
    42
  ),
  (
    '19c29a6c-288f-46bd-5f9e-302cfb419b87',
    'kratka-trkaci-raslina-34',
    '281db898-b68f-d3f1-07b4-b1cc70059051',
    40,
    43
  ),
  (
    'd561587e-4962-e63b-f1db-03b1c95890ba',
    'kratka-trkaci-raslina-39',
    '281db898-b68f-d3f1-07b4-b1cc70059051',
    16,
    17
  );

create temporary table _source_publications on commit drop as
select
  target.event_category_id,
  target.expected_result_count,
  target.correction_result_run_id,
  publication.id as source_publication_id,
  publication.result_run_id as source_result_run_id,
  publication.published_by_user_id,
  publication.manifest_digest_sha256
from _target_legacy_categories target
join public.event_categories category
  on category.id = target.event_category_id
join lateral (
  select candidate.*
  from public.result_publications candidate
  where candidate.event_category_id = target.event_category_id
    and candidate.publication_state in ('official', 'corrected')
    and candidate.result_run_id <> target.correction_result_run_id
  order by candidate.published_at desc, candidate.created_at desc, candidate.id desc
  limit 1
) publication on true;

do $preflight$
declare
  imported_category_count integer;
  active_registration_count integer;
  published_result_count integer;
  alias_registration_count integer;
  alias_result_count integer;
  alias_membership_count integer;
  invalid_membership_count integer;
  referenced_membership_count integer;
  invalid_rank_evidence_count integer;
begin
  select count(*)::integer
  into imported_category_count
  from _source_publications;

  -- The migration is also safe on a fresh schema without the staging import.
  if imported_category_count = 0 then
    return;
  end if;

  if imported_category_count <> 8 then
    raise exception
      'legacy_reconciliation_category_count_mismatch: expected 8, found %',
      imported_category_count;
  end if;

  if exists (
    select 1
    from _source_publications source
    left join lateral (
      select count(*)::integer as result_count
      from public.result_rows result
      where result.result_run_id = source.source_result_run_id
        and result.result_status in ('official', 'corrected')
    ) counted on true
    where counted.result_count <> source.expected_result_count
       or source.published_by_user_id is null
  ) then
    raise exception 'legacy_reconciliation_source_publication_mismatch';
  end if;

  select count(*)::integer
  into active_registration_count
  from public.registrations registration
  join _target_legacy_categories target
    on target.event_category_id = registration.event_category_id
  where registration.status <> 'cancelled';

  select count(*)::integer
  into published_result_count
  from _source_publications source
  join public.result_rows result
    on result.result_run_id = source.source_result_run_id
   and result.result_status in ('official', 'corrected');

  select count(*)::integer
  into alias_registration_count
  from public.registrations registration
  where registration.represented_club_id is not null
    and registration.represented_club_id is distinct from
      public.canonical_club_identity_id(registration.represented_club_id);

  select count(*)::integer
  into alias_result_count
  from _source_publications source
  join public.result_rows result
    on result.result_run_id = source.source_result_run_id
   and result.result_status in ('official', 'corrected')
  where result.represented_club_id is not null
    and result.represented_club_id is distinct from
      public.canonical_club_identity_id(result.represented_club_id);

  select count(*)::integer
  into alias_membership_count
  from public.club_memberships membership
  where membership.club_id is distinct from
    public.canonical_club_identity_id(membership.club_id);

  select count(*)::integer
  into invalid_membership_count
  from public.club_memberships membership
  where membership.club_id is distinct from
      public.canonical_club_identity_id(membership.club_id)
    and (
      membership.membership_role <> 'member'
      or membership.status <> 'active'
      or membership.is_primary
      or membership.membership_origin <> 'represented'
    );

  select count(*)::integer
  into referenced_membership_count
  from public.club_memberships membership
  where membership.club_id is distinct from
      public.canonical_club_identity_id(membership.club_id)
    and exists (
      select 1
      from public.club_membership_events event
      where event.membership_id = membership.id
    );

  select count(*)::integer
  into invalid_rank_evidence_count
  from _legacy_rank_corrections correction
  left join _source_publications source
    on source.event_category_id = correction.event_category_id
  left join public.result_rows result
    on result.result_run_id = source.source_result_run_id
   and result.registration_id = correction.registration_id
  where result.id is null
     or result.rank_overall is distinct from correction.expected_candidate_rank;

  if active_registration_count <> 432
     or published_result_count <> 389
     or alias_registration_count <> 23
     or alias_result_count <> 20
     or alias_membership_count <> 23
     or invalid_membership_count <> 0
     or referenced_membership_count <> 0
     or invalid_rank_evidence_count <> 0 then
    raise exception
      'legacy_reconciliation_preflight_failed: registrations %, results %, alias registrations %, alias results %, alias memberships %, invalid memberships %, referenced memberships %, invalid rank evidence %',
      active_registration_count,
      published_result_count,
      alias_registration_count,
      alias_result_count,
      alias_membership_count,
      invalid_membership_count,
      referenced_membership_count,
      invalid_rank_evidence_count;
  end if;
end
$preflight$;

-- Preserve any canonical membership already claimed by the athlete. Imported
-- alias memberships are derived from registrations and have no event history.
insert into public.club_memberships (
  club_id,
  athlete_profile_id,
  membership_role,
  status,
  is_primary,
  joined_at,
  membership_origin
)
select
  public.canonical_club_identity_id(membership.club_id),
  membership.athlete_profile_id,
  'member',
  'active',
  false,
  min(membership.joined_at),
  'represented'
from public.club_memberships membership
where membership.club_id is distinct from
  public.canonical_club_identity_id(membership.club_id)
group by
  public.canonical_club_identity_id(membership.club_id),
  membership.athlete_profile_id
on conflict (club_id, athlete_profile_id)
do update set
  status = case
    when public.club_memberships.status = 'active'
      then public.club_memberships.status
    else excluded.status
  end,
  joined_at = case
    when public.club_memberships.joined_at is null then excluded.joined_at
    when excluded.joined_at is null then public.club_memberships.joined_at
    else least(public.club_memberships.joined_at, excluded.joined_at)
  end,
  membership_origin = case
    when public.club_memberships.membership_origin = 'self_joined'
      then public.club_memberships.membership_origin
    else excluded.membership_origin
  end,
  updated_at = clock_timestamp();

-- A no-op assignment invokes the BEFORE trigger and canonicalizes all merged
-- club references. The existing AFTER trigger maintains represented members.
update public.registrations registration
set represented_club_id = registration.represented_club_id
where registration.represented_club_id is not null
  and registration.represented_club_id is distinct from
    public.canonical_club_identity_id(registration.represented_club_id);

delete from public.club_memberships membership
where membership.club_id is distinct from
  public.canonical_club_identity_id(membership.club_id);

insert into public.result_runs (
  id,
  event_category_id,
  trigger_type,
  trigger_reference_id,
  started_at,
  completed_at,
  status,
  summary_json,
  created_at,
  engine_version,
  input_digest,
  start_event_id
)
select
  source.correction_result_run_id,
  source.event_category_id,
  'legacy_source_truth_reconciliation',
  source.source_publication_id,
  clock_timestamp(),
  clock_timestamp(),
  'succeeded',
  jsonb_build_object(
    'mappingVersion', 'legacy-club-rank-reconciliation-v1',
    'sourceProjectRef', 'gnnmnhhvujdvyohcidki',
    'sourcePublicationId', source.source_publication_id,
    'sourceResultRunId', source.source_result_run_id,
    'sourceManifestDigestSha256', source.manifest_digest_sha256,
    'sourceResultCount', source.expected_result_count,
    'canonicalizedClubRows', (
      select count(*)
      from public.result_rows result
      where result.result_run_id = source.source_result_run_id
        and result.result_status in ('official', 'corrected')
        and result.represented_club_id is not null
        and result.represented_club_id is distinct from
          public.canonical_club_identity_id(result.represented_club_id)
    ),
    'legacyRankCorrections', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'sourceRegistrationId', correction.source_registration_id,
            'registrationId', correction.registration_id,
            'fromRank', correction.expected_candidate_rank,
            'toRank', correction.legacy_rank
          )
          order by correction.legacy_rank
        ),
        '[]'::jsonb
      )
      from _legacy_rank_corrections correction
      where correction.event_category_id = source.event_category_id
    )
  ),
  clock_timestamp(),
  'legacy-source-truth-v1',
  null,
  null
from _source_publications source
on conflict (id) do nothing;

insert into public.result_rows (
  id,
  result_run_id,
  registration_id,
  athlete_profile_id,
  event_category_id,
  result_status,
  finish_time_ms,
  gap_ms,
  rank_overall,
  rank_gender,
  rank_age_category,
  club_points,
  represented_club_id,
  created_at
)
select
  md5(source.correction_result_run_id::text || ':' || result.registration_id::text)::uuid,
  source.correction_result_run_id,
  result.registration_id,
  result.athlete_profile_id,
  result.event_category_id,
  'corrected',
  result.finish_time_ms,
  result.gap_ms,
  coalesce(correction.legacy_rank, result.rank_overall),
  result.rank_gender,
  result.rank_age_category,
  result.club_points,
  public.canonical_club_identity_id(result.represented_club_id),
  clock_timestamp()
from _source_publications source
join public.result_rows result
  on result.result_run_id = source.source_result_run_id
 and result.result_status in ('official', 'corrected')
left join _legacy_rank_corrections correction
  on correction.registration_id = result.registration_id
 and correction.event_category_id = result.event_category_id
on conflict (result_run_id, registration_id) do nothing;

do $publish_corrections$
declare
  source record;
begin
  for source in
    select *
    from _source_publications
    order by event_category_id
  loop
    if not exists (
      select 1
      from public.result_publications publication
      where publication.result_run_id = source.correction_result_run_id
    ) then
      perform public.publish_result_run_atomically(
        source.event_category_id,
        source.correction_result_run_id,
        'corrected'::public.publication_state,
        source.published_by_user_id,
        'Legacy source-of-truth reconciliation: canonical club identity and exact imported Raslina ranks.'
      );
    end if;
  end loop;
end
$publish_corrections$;

do $postflight$
declare
  imported_category_count integer;
  active_registration_count integer;
  published_result_count integer;
  dijana_registration_count integer;
  dijana_result_count integer;
  dijana_points numeric;
begin
  select count(*)::integer
  into imported_category_count
  from _source_publications;

  if imported_category_count = 0 then
    return;
  end if;

  select count(*)::integer
  into active_registration_count
  from public.registrations registration
  join _target_legacy_categories target
    on target.event_category_id = registration.event_category_id
  where registration.status <> 'cancelled';

  select count(*)::integer
  into published_result_count
  from public.current_published_result_rows result
  join _target_legacy_categories target
    on target.event_category_id = result.event_category_id;

  if active_registration_count <> 432 or published_result_count <> 389 then
    raise exception
      'legacy_reconciliation_postflight_grain_mismatch: registrations %, results %',
      active_registration_count,
      published_result_count;
  end if;

  if exists (
    select 1
    from public.registrations registration
    where registration.represented_club_id is distinct from
      public.canonical_club_identity_id(registration.represented_club_id)
  ) or exists (
    select 1
    from public.club_memberships membership
    where membership.club_id is distinct from
      public.canonical_club_identity_id(membership.club_id)
  ) or exists (
    select 1
    from public.current_published_result_rows result
    join _target_legacy_categories target
      on target.event_category_id = result.event_category_id
    where result.represented_club_id is distinct from
      public.canonical_club_identity_id(result.represented_club_id)
  ) then
    raise exception 'legacy_reconciliation_noncanonical_club_reference_remains';
  end if;

  if exists (
    select 1
    from _legacy_rank_corrections correction
    left join public.current_published_result_rows result
      on result.event_category_id = correction.event_category_id
     and result.registration_id = correction.registration_id
    where result.result_row_id is null
       or result.rank_overall is distinct from correction.legacy_rank
  ) then
    raise exception 'legacy_reconciliation_rank_correction_failed';
  end if;

  select
    count(*)::integer,
    count(result.result_row_id)::integer,
    coalesce(sum(result.club_points), 0)
  into
    dijana_registration_count,
    dijana_result_count,
    dijana_points
  from public.registrations registration
  join _target_legacy_categories target
    on target.event_category_id = registration.event_category_id
  left join public.current_published_result_rows result
    on result.registration_id = registration.id
  where registration.athlete_profile_id =
      '4c0b738b-15c1-4679-980d-51586cffe8a2'::uuid
    and registration.status <> 'cancelled'
    and registration.represented_club_id =
      '81482261-557d-47b3-b259-c841e8058b73'::uuid;

  if dijana_registration_count <> 3
     or dijana_result_count <> 3
     or dijana_points <> 240 then
    raise exception
      'legacy_reconciliation_dijana_cular_failed: registrations %, results %, points %',
      dijana_registration_count,
      dijana_result_count,
      dijana_points;
  end if;
end
$postflight$;

commit;
