begin;

/*
 * Club identity resolution has two deliberately separate layers:
 *
 * 1. Deterministic normalization and reviewed aliases resolve imports.
 * 2. Approved merges combine directory reads while preserving the club name
 *    recorded on historical registrations and result rows.
 *
 * Fuzzy similarity alone never creates a database merge.
 */

create or replace function public.normalize_club_identity_name(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $normalize_club_identity_name$
  select trim(
    both ' '
    from regexp_replace(
      translate(lower(coalesce(p_value, '')), 'čćžšđ', 'cczsd'),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$normalize_club_identity_name$;

create or replace function public.canonical_club_identity_id(p_club_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $canonical_club_identity_id$
declare
  current_club_id uuid := p_club_id;
  next_club_id uuid;
  visited_club_ids uuid[] := array[]::uuid[];
begin
  if p_club_id is null then
    return null;
  end if;

  loop
    if current_club_id = any(visited_club_ids) then
      return p_club_id;
    end if;

    visited_club_ids := array_append(visited_club_ids, current_club_id);

    select club.merged_into_club_id
    into next_club_id
    from public.clubs club
    where club.id = current_club_id;

    if not found or next_club_id is null then
      return current_club_id;
    end if;

    current_club_id := next_club_id;
  end loop;
end
$canonical_club_identity_id$;

create or replace function public.resolve_club_identity_name(
  p_name text,
  p_country_code text default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $resolve_club_identity_name$
declare
  normalized_name text := public.normalize_club_identity_name(p_name);
  compact_name text;
  matching_club_ids uuid[];
begin
  compact_name := replace(normalized_name, ' ', '');
  if compact_name = '' then
    return null;
  end if;

  select array_agg(candidate.canonical_club_id order by candidate.canonical_club_id)
  into matching_club_ids
  from (
    select distinct public.canonical_club_identity_id(club.id) as canonical_club_id
    from public.clubs club
    where club.status = 'active'
      and (
        p_country_code is null
        or club.country_code is null
        or club.country_code = upper(trim(p_country_code))
      )
      and replace(public.normalize_club_identity_name(club.name), ' ', '') = compact_name

    union

    select distinct public.canonical_club_identity_id(alias.club_id) as canonical_club_id
    from public.club_aliases alias
    where (
        p_country_code is null
        or alias.country_code is null
        or alias.country_code = upper(trim(p_country_code))
      )
      and replace(public.normalize_club_identity_name(alias.alias_name), ' ', '') = compact_name
  ) candidate
  where candidate.canonical_club_id is not null;

  if coalesce(cardinality(matching_club_ids), 0) = 1 then
    return matching_club_ids[1];
  end if;

  return null;
end
$resolve_club_identity_name$;

revoke all on function public.normalize_club_identity_name(text)
  from public, anon, authenticated;
revoke all on function public.canonical_club_identity_id(uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_club_identity_name(text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_club_identity_name(text, text)
  to service_role;

create temporary table _reviewed_club_identity_merges (
  source_club_id uuid primary key,
  expected_source_name text not null,
  canonical_club_id uuid not null,
  expected_canonical_name text not null,
  evidence_kind text not null
) on commit drop;

insert into _reviewed_club_identity_merges (
  source_club_id,
  expected_source_name,
  canonical_club_id,
  expected_canonical_name,
  evidence_kind
)
values
  (
    '72ae65dc-4934-4b6c-a699-06bd4562463a',
    'HPD Kozjak -Dračari',
    '81482261-557d-47b3-b259-c841e8058b73',
    'Dračari',
    'reviewed_same_club_and_cross_race_athlete_overlap'
  ),
  (
    '80f33314-7453-45b4-9025-2b131b687fb5',
    'Katma runners',
    '3c9d1854-a384-4570-a3be-0bbc9ba150c7',
    'Karma runners',
    'single_character_typo_and_same_athlete'
  ),
  (
    'c53a2320-21d4-499d-85d4-8495ccb43604',
    'AK Okit Vodice',
    '98da67da-ab12-4e77-ba3f-89610a6fb1f5',
    'Ak Okit',
    'reviewed_long_and_short_club_name'
  ),
  (
    'e24660d5-114c-4c7c-b2d5-0b69c9d34773',
    'Sebenico',
    'c93e03e5-f48c-4fc0-ab01-bc9a9acfe105',
    'Škola trčanja Sebenico',
    'reviewed_short_club_name_and_athlete_overlap'
  ),
  (
    '968b0be3-2ee3-4738-881b-f7ccba367b27',
    'Sebenico Šibenik',
    'c93e03e5-f48c-4fc0-ab01-bc9a9acfe105',
    'Škola trčanja Sebenico',
    'reviewed_location_suffix'
  ),
  (
    'bb4d9401-e327-4580-b234-9c5a05894928',
    'Sebenico škola trčanja',
    'c93e03e5-f48c-4fc0-ab01-bc9a9acfe105',
    'Škola trčanja Sebenico',
    'same_name_tokens_and_athlete_overlap'
  ),
  (
    '5bdfde73-83bb-4fad-8eb7-5002d246fe5e',
    'ST Sebenico',
    'c93e03e5-f48c-4fc0-ab01-bc9a9acfe105',
    'Škola trčanja Sebenico',
    'reviewed_abbreviation'
  ),
  (
    '877a4c67-b5ae-4f39-86f7-fde65b3017a8',
    'TK Šibenik',
    'a388b501-4873-4299-84cd-8c7785d4c857',
    'Triatlon klub Šibenik',
    'reviewed_official_abbreviation'
  );

do $validate_reviewed_club_identity_merges$
begin
  if exists (
    select 1
    from _reviewed_club_identity_merges reviewed
    join public.clubs source_by_id
      on source_by_id.id = reviewed.source_club_id
    left join public.clubs canonical
      on canonical.id = reviewed.canonical_club_id
     and canonical.name = reviewed.expected_canonical_name
     and canonical.status = 'active'
    where source_by_id.name <> reviewed.expected_source_name
       or source_by_id.status <> 'active'
       or canonical.id is null
  ) then
    raise exception 'Reviewed club merge input changed; refusing to apply identity decisions';
  end if;
end
$validate_reviewed_club_identity_merges$;

update public.clubs
set name = 'AK Okit', updated_at = clock_timestamp()
where id = '98da67da-ab12-4e77-ba3f-89610a6fb1f5'
  and name = 'Ak Okit';

insert into public.club_identity_merges (
  id,
  source_club_id,
  canonical_club_id,
  merge_state,
  reason,
  evidence_json,
  proposed_by_user_id,
  decided_by_user_id,
  decided_at,
  client_event_id
)
select
  md5('club-identity-rules-20260807:merge:' || reviewed.source_club_id::text)::uuid,
  reviewed.source_club_id,
  reviewed.canonical_club_id,
  'approved',
  'Reviewed duplicate club identity from the 2026-08-07 staging data audit.',
  jsonb_build_object(
    'migration', '20260807111953_resolve_club_identity_aliases',
    'sourceName', reviewed.expected_source_name,
    'canonicalName', case
      when reviewed.canonical_club_id = '98da67da-ab12-4e77-ba3f-89610a6fb1f5'
        then 'AK Okit'
      else reviewed.expected_canonical_name
    end,
    'evidenceKind', reviewed.evidence_kind,
    'preservesHistoricalRepresentation', true
  ),
  md5('club-identity-rules-20260807:system-actor')::uuid,
  md5('club-identity-rules-20260807:system-actor')::uuid,
  timestamptz '2026-08-07 11:19:53+00',
  md5('club-identity-rules-20260807:merge-event:' || reviewed.source_club_id::text)::uuid
from _reviewed_club_identity_merges reviewed
join public.clubs source
  on source.id = reviewed.source_club_id
 and source.name = reviewed.expected_source_name
join public.clubs canonical
  on canonical.id = reviewed.canonical_club_id
where not exists (
  select 1
  from public.club_identity_merges existing
  where existing.source_club_id = reviewed.source_club_id
    and existing.merge_state = 'approved'
)
on conflict (client_event_id) do nothing;

insert into public.club_aliases (
  id,
  club_id,
  alias_name,
  normalized_alias,
  alias_type,
  country_code,
  source_reference,
  created_by_user_id,
  client_event_id
)
select
  md5('club-identity-rules-20260807:alias:' || reviewed.source_club_id::text)::uuid,
  reviewed.canonical_club_id,
  reviewed.expected_source_name,
  public.normalize_club_identity_name(reviewed.expected_source_name),
  'merged',
  'HR',
  'migration:20260807111953',
  md5('club-identity-rules-20260807:system-actor')::uuid,
  md5('club-identity-rules-20260807:alias-event:' || reviewed.source_club_id::text)::uuid
from _reviewed_club_identity_merges reviewed
join public.clubs source
  on source.id = reviewed.source_club_id
 and source.name = reviewed.expected_source_name
join public.clubs canonical
  on canonical.id = reviewed.canonical_club_id
where not exists (
  select 1
  from public.club_aliases existing
  where existing.normalized_alias = public.normalize_club_identity_name(reviewed.expected_source_name)
    and existing.country_code = 'HR'
)
on conflict (client_event_id) do nothing;

create or replace function public.reject_duplicate_active_club_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $reject_duplicate_active_club_identity$
declare
  normalized_name text;
  compact_name text;
  conflicting_club_id uuid;
  current_canonical_club_id uuid;
begin
  if new.status <> 'active' then
    return new;
  end if;

  normalized_name := public.normalize_club_identity_name(new.name);
  compact_name := replace(normalized_name, ' ', '');
  if compact_name = '' then
    return new;
  end if;

  current_canonical_club_id := public.canonical_club_identity_id(new.id);

  select candidate.canonical_club_id
  into conflicting_club_id
  from (
    select distinct public.canonical_club_identity_id(club.id) as canonical_club_id
    from public.clubs club
    where club.id <> new.id
      and club.status = 'active'
      and club.country_code is not distinct from new.country_code
      and replace(public.normalize_club_identity_name(club.name), ' ', '') = compact_name

    union

    select distinct public.canonical_club_identity_id(alias.club_id) as canonical_club_id
    from public.club_aliases alias
    where alias.country_code is not distinct from new.country_code
      and replace(public.normalize_club_identity_name(alias.alias_name), ' ', '') = compact_name
  ) candidate
  where candidate.canonical_club_id is distinct from current_canonical_club_id
  order by candidate.canonical_club_id
  limit 1;

  if conflicting_club_id is not null then
    raise exception using
      errcode = '23505',
      message = 'club_identity_duplicate',
      detail = format('Canonical club id: %s', conflicting_club_id),
      hint = 'Use the existing canonical club or add a reviewed alias instead of creating a duplicate.';
  end if;

  return new;
end
$reject_duplicate_active_club_identity$;

revoke all on function public.reject_duplicate_active_club_identity()
  from public, anon, authenticated;

drop trigger if exists clubs_reject_duplicate_active_identity on public.clubs;
create trigger clubs_reject_duplicate_active_identity
before insert or update of name, country_code, status
on public.clubs
for each row execute function public.reject_duplicate_active_club_identity();

do $club_identity_postconditions$
begin
  if exists (
    select 1
    from _reviewed_club_identity_merges reviewed
    join public.clubs source on source.id = reviewed.source_club_id
    where source.status <> 'merged'
       or source.verification_status <> 'merged'
       or public.canonical_club_identity_id(source.id) <> reviewed.canonical_club_id
  ) then
    raise exception 'Reviewed club identities did not resolve to their canonical clubs';
  end if;

  if exists (
      select 1
      from public.clubs
      where id = 'f99ac863-6f5f-4869-972b-ccaee2dd1868'
    )
    and (
      public.resolve_club_identity_name('TTKStrka', 'HR')
        is distinct from 'f99ac863-6f5f-4869-972b-ccaee2dd1868'
      or public.resolve_club_identity_name('HPD Kozjak - Dračari', 'HR')
        is distinct from '81482261-557d-47b3-b259-c841e8058b73'
      or public.resolve_club_identity_name('Katma runners', 'HR')
        is distinct from '3c9d1854-a384-4570-a3be-0bbc9ba150c7'
      or public.resolve_club_identity_name('T.K. Šibenik', 'HR')
        is distinct from 'a388b501-4873-4299-84cd-8c7785d4c857'
    )
  then
    raise exception 'Club identity aliases do not resolve deterministically';
  end if;
end
$club_identity_postconditions$;

commit;
