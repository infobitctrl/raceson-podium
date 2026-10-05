begin;

-- Exact, unscaled NUMERIC: numeric(78,0) would round fractional input before a CHECK.
create domain app_private.reward_uint256 as numeric
  check (value >= 0 and value <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
    and value = trunc(value));
create domain app_private.reward_bytes32 as bytea
  check (octet_length(value) = 32 and value <> decode(repeat('00', 32), 'hex'));
create domain app_private.reward_address as text
  check (value ~ '^0x[0-9a-f]{40}$' and value <> '0x0000000000000000000000000000000000000000');

create table app_private.reward_programmes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  league_season_id uuid not null,
  environment text not null check (environment in ('local_simulation', 'testnet_pilot')),
  chain_id integer not null,
  policy_family text not null default 'si-trail-rewards-v1' check (policy_family = 'si-trail-rewards-v1'),
  round_ids uuid[] not null check (cardinality(round_ids) = 5),
  budget_wei app_private.reward_uint256 not null check (budget_wei >= 9),
  operator_user_id uuid not null,
  operator_address app_private.reward_address not null,
  treasury_address app_private.reward_address not null,
  on_chain_id app_private.reward_bytes32 not null default public.gen_random_bytes(32) unique,
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object' and octet_length(configuration::text) <= 262144),
  manifest_hash app_private.reward_bytes32 not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  request_body jsonb not null,
  unique (organization_id, league_season_id, environment, policy_family),
  unique (organization_id, created_by_user_id, idempotency_key),
  check ((environment = 'local_simulation' and chain_id = 31337) or (environment = 'testnet_pilot' and chain_id = 10143))
);

-- These are configured liabilities, NOT asserted on-chain funding or state.
create table app_private.reward_campaigns (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references app_private.reward_programmes(id) on delete restrict,
  scope_key text not null,
  pot text not null check (pot in ('race', 'league')),
  round_ids uuid[] not null,
  budget_wei app_private.reward_uint256 not null check (budget_wei > 0),
  on_chain_id app_private.reward_bytes32 not null default public.gen_random_bytes(32) unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (programme_id, scope_key),
  check ((pot = 'race' and cardinality(round_ids) = 1 and scope_key = round_ids[1]::text)
      or (pot = 'league' and cardinality(round_ids) = 5 and scope_key = 'rounds-1-5'))
);

create table app_private.reward_sporting_reviews (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app_private.reward_campaigns(id) on delete restrict,
  source_snapshot_id uuid not null references app_private.reward_source_snapshots(id) on delete restrict,
  revision integer not null check (revision > 0),
  reviewed_by_user_id uuid not null,
  reviewed_at timestamptz not null default clock_timestamp(),
  review_body jsonb not null check (jsonb_typeof(review_body) = 'object' and octet_length(review_body::text) <= 4194304),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  unique (campaign_id, revision), unique (campaign_id, reviewed_by_user_id, idempotency_key)
);
create index reward_sporting_reviews_source_idx on app_private.reward_sporting_reviews(source_snapshot_id);

create table app_private.reward_allocations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app_private.reward_campaigns(id) on delete restrict unique,
  review_id uuid not null references app_private.reward_sporting_reviews(id) on delete restrict unique,
  reserved_by_user_id uuid not null,
  reserved_at timestamptz not null default clock_timestamp(),
  allocated_wei app_private.reward_uint256 not null,
  unallocated_wei app_private.reward_uint256 not null,
  selected_source_ids uuid[] not null,
  allocation_body jsonb not null check (jsonb_typeof(allocation_body) = 'object' and octet_length(allocation_body::text) <= 8388608),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  snapshot_salt app_private.reward_bytes32 not null default public.gen_random_bytes(32) unique
);

create table app_private.reward_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app_private.reward_campaigns(id) on delete restrict,
  kind text not null check (kind in ('athlete', 'club')),
  entity_id uuid not null,
  on_chain_id app_private.reward_bytes32 not null default public.gen_random_bytes(32) unique,
  unique (campaign_id, kind, entity_id)
);
-- Entity IDs are historical identity references, deliberately no cascading FK to
-- deletable sporting/account rows. No wallet or readiness predicate affects awards.
create index reward_beneficiaries_entity_idx on app_private.reward_beneficiaries(kind, entity_id, campaign_id);

create table app_private.reward_entitlements (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references app_private.reward_allocations(id) on delete restrict,
  beneficiary_id uuid not null references app_private.reward_beneficiaries(id) on delete restrict,
  on_chain_id app_private.reward_bytes32 not null default public.gen_random_bytes(32) unique,
  amount_wei app_private.reward_uint256 not null check (amount_wei > 0),
  explanation jsonb not null check (jsonb_typeof(explanation) = 'object'),
  explanation_salt app_private.reward_bytes32 not null default public.gen_random_bytes(32) unique,
  unique (allocation_id, beneficiary_id)
);
create index reward_entitlements_beneficiary_idx on app_private.reward_entitlements(beneficiary_id);

create table app_private.reward_source_reservations (
  programme_id uuid not null references app_private.reward_programmes(id) on delete restrict,
  allocation_id uuid not null references app_private.reward_allocations(id) on delete restrict,
  family text not null check (family in ('podium', 'record', 'club_performance', 'athlete_metres', 'club_finishes')),
  round_id uuid not null,
  subject_key text not null check (length(subject_key) between 1 and 200),
  primary key (programme_id, family, round_id, subject_key)
);
create index reward_source_reservations_allocation_idx on app_private.reward_source_reservations(allocation_id);

create function app_private.reject_reward_ledger_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'reward_ledger_is_immutable';
end
$$;
revoke all on function app_private.reject_reward_ledger_mutation() from public, anon, authenticated, service_role;

do $$
declare name text;
begin
  foreach name in array array['reward_programmes', 'reward_campaigns', 'reward_sporting_reviews',
    'reward_allocations', 'reward_beneficiaries', 'reward_entitlements', 'reward_source_reservations'] loop
    execute format('alter table app_private.%I enable row level security', name);
    execute format('revoke all on app_private.%I from public, anon, authenticated, service_role', name);
    execute format('grant select, insert on app_private.%I to service_role', name);
    execute format('create policy %I on app_private.%I for select to service_role using (true)', name || '_service_select', name);
    execute format('create policy %I on app_private.%I for insert to service_role with check (true)', name || '_service_insert', name);
    execute format('create trigger reward_ledger_immutable before update or delete on app_private.%I for each row execute function app_private.reject_reward_ledger_mutation()', name);
  end loop;
end
$$;
-- SELECT FOR UPDATE needs UPDATE permission; immutable triggers forbid changing
-- even these ID columns. No general ledger UPDATE/DELETE privilege is granted.
grant update (id) on app_private.reward_programmes, app_private.reward_campaigns to service_role;
create policy reward_programmes_lock on app_private.reward_programmes for update to service_role using (true) with check (true);
create policy reward_campaigns_lock on app_private.reward_campaigns for update to service_role using (true) with check (true);

create function app_private.require_reward_operator(p_programme_id uuid, p_actor_user_id uuid)
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists (select 1 from app_private.reward_programmes p where p.id = p_programme_id
    and p.operator_user_id = p_actor_user_id
    and public.service_user_has_organization_permission(p.organization_id, p_actor_user_id, 'leagues.manage', 'organization', null)) then
    raise exception using errcode = '42501', message = 'reward_operator_permission_required';
  end if;
end
$$;
revoke all on function app_private.require_reward_operator(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function app_private.require_reward_operator(uuid,uuid) to service_role;

create function public.service_create_reward_programme(p_actor_user_id uuid, p_idempotency_key text, p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  org_id uuid := (p_request->>'organizationId')::uuid;
  season_id uuid := (p_request->>'seasonId')::uuid;
  operator_id uuid := (p_request->>'operatorUserId')::uuid;
  rounds uuid[];
  programme app_private.reward_programmes%rowtype;
  total app_private.reward_uint256;
  race_budget numeric;
  i integer := 0;
  round_id uuid;
  config jsonb := p_request->'configuration';
  configured_round jsonb;
begin
  if p_actor_user_id is null or org_id is null or season_id is null or operator_id is null
    or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or jsonb_typeof(p_request) <> 'object' or octet_length(p_request::text) > 524288 then
    raise exception using errcode = '22023', message = 'invalid_reward_programme_request';
  end if;
  if not exists (select 1 from public.organization_memberships m where m.organization_id = org_id
    and m.user_id = p_actor_user_id and m.role = 'owner' and m.status = 'active')
    or public.service_user_has_organization_permission(org_id, p_actor_user_id, 'organization.manage', 'organization', null) is not true
    or public.service_user_has_organization_permission(org_id, operator_id, 'leagues.manage', 'organization', null) is not true
    or not exists (select 1 from public.league_seasons s join public.leagues l on l.id = s.league_id
      where s.id = season_id and l.organization_id = org_id) then
    raise exception using errcode = '42501', message = 'reward_programme_owner_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-programme:' || org_id::text, 0));
  -- The owner/operator may have been revoked while this transaction waited.
  -- Recheck before both replay and creation; a retry is not an authority grant.
  if not exists (select 1 from public.organization_memberships m where m.organization_id = org_id
    and m.user_id = p_actor_user_id and m.role = 'owner' and m.status = 'active')
    or public.service_user_has_organization_permission(org_id, p_actor_user_id, 'organization.manage', 'organization', null) is not true
    or public.service_user_has_organization_permission(org_id, operator_id, 'leagues.manage', 'organization', null) is not true
    or not exists (select 1 from public.league_seasons s join public.leagues l on l.id = s.league_id
      where s.id = season_id and l.organization_id = org_id) then
    raise exception using errcode = '42501', message = 'reward_programme_owner_required';
  end if;
  select * into programme from app_private.reward_programmes where organization_id = org_id
    and created_by_user_id = p_actor_user_id and idempotency_key = p_idempotency_key;
  if found then
    if programme.request_body is distinct from p_request then
      raise exception using errcode = '22023', message = 'reward_ledger_idempotency_conflict';
    end if;
  else
    if jsonb_typeof(p_request->'roundIds') is distinct from 'array' or jsonb_array_length(p_request->'roundIds') <> 5
      or jsonb_typeof(p_request->'budgetWei') is distinct from 'string' or p_request->>'budgetWei' !~ '^[1-9][0-9]{0,77}$'
      or jsonb_typeof(p_request->'configuration') is distinct from 'object'
      or p_request->>'manifestHash' !~ '^0x[0-9a-f]{64}$' then
      raise exception using errcode = '22023', message = 'invalid_reward_programme_request';
    end if;
    select array_agg(id order by id) into rounds from (select value::uuid id from jsonb_array_elements_text(p_request->'roundIds')) r;
    if (select count(distinct id) from unnest(rounds) id) <> 5 or
      (select count(*) from public.league_round_events r where r.id = any(rounds) and r.league_season_id = season_id and r.round_number between 1 and 5) <> 5 then
      raise exception using errcode = '22023', message = 'reward_programme_round_scope_mismatch';
    end if;
    if config->>'organizationId' is distinct from org_id::text or config->>'seasonId' is distinct from season_id::text
      or jsonb_typeof(config->'rounds') is distinct from 'array'
      or jsonb_typeof(config->'classifications') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'invalid_reward_programme_configuration';
    end if;
    if (select array_agg((r->>'id')::uuid order by (r->>'id')::uuid) from jsonb_array_elements(config->'rounds') r) is distinct from rounds
      or jsonb_array_length(config->'classifications') <> 7
      or (select count(distinct c->>'id') from jsonb_array_elements(config->'classifications') c) <> 7
      or (select count(*) from jsonb_array_elements(config->'classifications') item
        join public.league_classifications c on c.id = (item->>'id')::uuid
        join public.league_competitions competition on competition.id = c.league_competition_id
        where c.status = 'active' and competition.status = 'active' and competition.league_season_id = season_id
          and item->>'competitionId' = competition.id::text) <> 7 then
      raise exception using errcode = '22023', message = 'invalid_reward_programme_configuration';
    end if;
    for configured_round in select value from jsonb_array_elements(config->'rounds') loop
      if jsonb_typeof(configured_round->'races') is distinct from 'array' then
        raise exception using errcode = '22023', message = 'invalid_reward_programme_configuration';
      end if;
      if jsonb_array_length(configured_round->'races') <> 2
        or (select count(distinct r->>'id') from jsonb_array_elements(configured_round->'races') r) <> 2
        or not exists (select 1 from public.league_round_events r where r.id = (configured_round->>'id')::uuid
          and r.event_edition_id::text = configured_round->>'eventEditionId' and r.round_number = (configured_round->>'number')::integer)
        or (select count(*) from jsonb_array_elements(configured_round->'races') race
          join public.league_round_race_mappings m on m.id = (race->>'mappingId')::uuid
          where m.league_round_event_id = (configured_round->>'id')::uuid and m.status = 'mapped'
            and m.event_category_id::text = race->>'id' and m.league_competition_id::text = race->>'competitionId') <> 2 then
        raise exception using errcode = '22023', message = 'invalid_reward_programme_configuration';
      end if;
    end loop;
    if exists (select 1 from app_private.reward_programmes where organization_id = org_id and league_season_id = season_id
      and environment = p_request->>'environment') then
      raise exception using errcode = '55000', message = 'reward_programme_already_configured';
    end if;
    total := (p_request->>'budgetWei')::numeric;
    insert into app_private.reward_programmes(organization_id, league_season_id, environment, chain_id, round_ids,
      budget_wei, operator_user_id, operator_address, treasury_address, configuration, manifest_hash,
      created_by_user_id, idempotency_key, request_body)
    values (org_id, season_id, p_request->>'environment', (p_request->>'chainId')::integer, rounds, total,
      operator_id, p_request->>'operatorAddress', p_request->>'treasuryAddress', p_request->'configuration',
      decode(substr(p_request->>'manifestHash', 3), 'hex'), p_actor_user_id, p_idempotency_key, p_request)
    returning * into programme;
    -- NUMERIC / may round a large quotient to scale zero BEFORE truncation.
    -- div() is exact integer division even near the uint256 bound.
    race_budget := div(total * 3, 5);
    foreach round_id in array rounds loop
      i := i + 1;
      insert into app_private.reward_campaigns(programme_id, scope_key, pot, round_ids, budget_wei)
      values (programme.id, round_id::text, 'race', array[round_id], div(race_budget, 5) + case when i <= mod(race_budget, 5) then 1 else 0 end);
    end loop;
    insert into app_private.reward_campaigns(programme_id, scope_key, pot, round_ids, budget_wei)
    values (programme.id, 'rounds-1-5', 'league', rounds, total - race_budget);
  end if;
  return jsonb_build_object('programmeId', programme.id, 'onChainId', '0x' || encode(programme.on_chain_id, 'hex'),
    'budgetWei', programme.budget_wei::text, 'campaigns', (select jsonb_agg(jsonb_build_object('id', c.id,
      'scopeKey', c.scope_key, 'pot', c.pot, 'roundIds', c.round_ids, 'budgetWei', c.budget_wei::text,
      'onChainId', '0x' || encode(c.on_chain_id, 'hex')) order by c.scope_key) from app_private.reward_campaigns c where c.programme_id = programme.id));
end
$$;

create function public.service_record_reward_sporting_review(
  p_campaign_id uuid, p_source_snapshot_id uuid, p_actor_user_id uuid, p_idempotency_key text, p_review jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  campaign app_private.reward_campaigns%rowtype;
  programme app_private.reward_programmes%rowtype;
  snapshot app_private.reward_source_snapshots%rowtype;
  reviewed app_private.reward_sporting_reviews%rowtype;
  fresh jsonb;
begin
  select * into campaign from app_private.reward_campaigns where id = p_campaign_id;
  perform app_private.require_reward_operator(campaign.programme_id, p_actor_user_id);
  select * into programme from app_private.reward_programmes where id = campaign.programme_id for update;
  perform 1 from app_private.reward_campaigns where id = campaign.id for update;
  perform app_private.require_reward_operator(programme.id, p_actor_user_id);
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or jsonb_typeof(p_review) is distinct from 'object' or p_review->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(p_review->'adjudications') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid_reward_sporting_review';
  end if;
  if jsonb_array_length(p_review->'adjudications') > 20000 or
    (select count(distinct jsonb_build_array(d->>'roundId', d->>'athleteId')) from jsonb_array_elements(p_review->'adjudications') d)
      <> jsonb_array_length(p_review->'adjudications') then
    raise exception using errcode = '22023', message = 'invalid_reward_sporting_review';
  end if;
  select * into reviewed from app_private.reward_sporting_reviews where campaign_id = p_campaign_id
    and reviewed_by_user_id = p_actor_user_id and idempotency_key = p_idempotency_key;
  if found then
    if reviewed.source_snapshot_id is distinct from p_source_snapshot_id or reviewed.review_body is distinct from p_review then
      raise exception using errcode = '22023', message = 'reward_ledger_idempotency_conflict';
    end if;
  else
    if exists (select 1 from app_private.reward_allocations where campaign_id = campaign.id) then
      raise exception using errcode = '55000', message = 'reward_campaign_allocation_already_reserved';
    end if;
    select * into snapshot from app_private.reward_source_snapshots where id = p_source_snapshot_id;
    if snapshot.organization_id is distinct from programme.organization_id or snapshot.league_season_id is distinct from programme.league_season_id
      or snapshot.round_ids is distinct from campaign.round_ids then
      raise exception using errcode = '22023', message = 'reward_review_source_scope_mismatch';
    end if;
    fresh := public.service_read_reward_source(programme.organization_id, programme.league_season_id, campaign.round_ids, p_actor_user_id);
    if fresh is distinct from snapshot.source_body then
      raise exception using errcode = '55000', message = 'reward_review_source_changed';
    end if;
    insert into app_private.reward_sporting_reviews(campaign_id, source_snapshot_id, revision, reviewed_by_user_id, review_body, idempotency_key)
    select campaign.id, snapshot.id, coalesce(max(revision), 0) + 1, p_actor_user_id, p_review, p_idempotency_key
    from app_private.reward_sporting_reviews where campaign_id = campaign.id returning * into reviewed;
  end if;
  return jsonb_build_object('reviewId', reviewed.id, 'campaignId', reviewed.campaign_id, 'snapshotId', reviewed.source_snapshot_id,
    'revision', reviewed.revision, 'reviewedAt', reviewed.reviewed_at);
end
$$;

-- This is a private trusted-service boundary. Application code MUST run the
-- sporting adapter, complete reviewed manifests and deterministic calculator.
-- An organizer HTTP body is never forwarded as an allocation. SQL independently
-- checks authority, source freshness, source coverage, identity, scope and money.
create function public.service_reserve_reward_allocation(
  p_review_id uuid, p_actor_user_id uuid, p_idempotency_key text, p_allocation jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  reviewed app_private.reward_sporting_reviews%rowtype;
  campaign app_private.reward_campaigns%rowtype;
  programme app_private.reward_programmes%rowtype;
  snapshot app_private.reward_source_snapshots%rowtype;
  allocation app_private.reward_allocations%rowtype;
  selected_ids uuid[];
  selected jsonb;
  group_row record;
  decision jsonb;
  item jsonb;
  beneficiary_id uuid;
  total numeric := 0;
  leftover app_private.reward_uint256;
  identity_id uuid;
  alias_id uuid;
begin
  select * into reviewed from app_private.reward_sporting_reviews where id = p_review_id;
  select * into campaign from app_private.reward_campaigns where id = reviewed.campaign_id;
  perform app_private.require_reward_operator(campaign.programme_id, p_actor_user_id);
  select * into programme from app_private.reward_programmes where id = campaign.programme_id for update;
  perform 1 from app_private.reward_campaigns where id = campaign.id for update;
  perform app_private.require_reward_operator(programme.id, p_actor_user_id);
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or jsonb_typeof(p_allocation) is distinct from 'object' or octet_length(p_allocation::text) > 8388608 then
    raise exception using errcode = '22023', message = 'invalid_reward_allocation';
  end if;
  select * into allocation from app_private.reward_allocations where campaign_id = campaign.id;
  if found then
    if allocation.review_id <> reviewed.id or allocation.reserved_by_user_id <> p_actor_user_id
      or allocation.idempotency_key <> p_idempotency_key or allocation.allocation_body is distinct from p_allocation then
      raise exception using errcode = '55000', message = 'reward_campaign_allocation_already_reserved';
    end if;
  else
    if reviewed.revision <> (select max(revision) from app_private.reward_sporting_reviews where campaign_id = campaign.id) then
      raise exception using errcode = '55000', message = 'reward_review_superseded';
    end if;
    select * into snapshot from app_private.reward_source_snapshots where id = reviewed.source_snapshot_id;
    if public.service_read_reward_source(programme.organization_id, programme.league_season_id, campaign.round_ids, p_actor_user_id)
      is distinct from snapshot.source_body then
      raise exception using errcode = '55000', message = 'reward_review_source_changed';
    end if;
    if exists (select 1 from jsonb_array_elements(snapshot.source_body->'adjudicationCases') c
      where c->>'state' not in ('closed', 'withdrawn') or (c->>'recomputeRequired')::boolean) then
      raise exception using errcode = '55000', message = 'reward_round_has_unresolved_adjudication';
    end if;
    if jsonb_typeof(p_allocation->'selectedSourceIds') is distinct from 'array'
      or jsonb_array_length(p_allocation->'selectedSourceIds') > 20000
      or jsonb_typeof(p_allocation->'entitlements') is distinct from 'array'
      or jsonb_array_length(p_allocation->'entitlements') > 20000
      or jsonb_typeof(p_allocation->'unallocatedWei') is distinct from 'string'
      or p_allocation->>'unallocatedWei' !~ '^(0|[1-9][0-9]{0,77})$' then
      raise exception using errcode = '22023', message = 'invalid_reward_allocation';
    end if;
    if p_allocation->>'programmeId' is distinct from programme.id::text
      or p_allocation->>'campaignScopeId' is distinct from campaign.scope_key
      or p_allocation->>'pot' is distinct from campaign.pot
      or p_allocation->>'budgetWei' is distinct from campaign.budget_wei::text then
      raise exception using errcode = '22023', message = 'reward_allocation_campaign_mismatch';
    end if;
    select coalesce(array_agg(value::uuid order by value::uuid), array[]::uuid[]) into selected_ids
      from jsonb_array_elements_text(p_allocation->'selectedSourceIds');
    if cardinality(selected_ids) <> (select count(distinct id) from unnest(selected_ids) id) then
      raise exception using errcode = '22023', message = 'reward_allocation_source_coverage_invalid';
    end if;
    select coalesce(jsonb_agg(r order by r->>'id'), '[]'::jsonb) into selected
      from jsonb_array_elements(snapshot.source_body->'rows') r where (r->>'id')::uuid = any(selected_ids)
        and r->>'participationStatus' = 'finished' and (r->>'finishTimeMs')::numeric > 0 and r->>'resultStatus' in ('official', 'corrected');
    if jsonb_array_length(selected) <> cardinality(selected_ids) then
      raise exception using errcode = '22023', message = 'reward_allocation_source_coverage_invalid';
    end if;
    -- Every qualifying canonical athlete-round is selected exactly once or has
    -- a source-exact, reviewed exclusion. Duplicates require a reviewed selection.
    for group_row in select r->>'roundId' round_id, r->>'canonicalAthleteId' athlete_id,
        array_agg(r->>'id' order by r->>'id') ids,
        array_agg(r->>'id' order by r->>'id') filter (where (r->>'id')::uuid = any(selected_ids)) chosen
      from jsonb_array_elements(snapshot.source_body->'rows') r
      where r->>'participationStatus' = 'finished' and (r->>'finishTimeMs')::numeric > 0 and r->>'resultStatus' in ('official', 'corrected')
      group by r->>'roundId', r->>'canonicalAthleteId' loop
      if group_row.athlete_id is null or coalesce(cardinality(group_row.chosen), 0) > 1 then
        raise exception using errcode = '22023', message = 'reward_allocation_source_coverage_invalid';
      end if;
      select d into decision from jsonb_array_elements(reviewed.review_body->'adjudications') d
        where d->>'roundId' = group_row.round_id and d->>'athleteId' = group_row.athlete_id;
      if cardinality(group_row.ids) > 1 or group_row.chosen is null or decision is not null then
        if decision is null or nullif(decision->>'approvalId', '') is null
          or (select array_agg(value order by value) from jsonb_array_elements_text(decision->'sourceIds')) is distinct from group_row.ids
          or decision->>'selectedSourceId' is distinct from group_row.chosen[1] then
          raise exception using errcode = '22023', message = 'reward_allocation_source_coverage_invalid';
        end if;
      end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(selected) r where r->>'identityCycle' is distinct from 'false'
      or r->>'unresolvedMergeId' is not null or r->>'canonicalAthleteId' is null
      or (r->>'representedClubId' is not null and (r->>'clubIdentityCycle' is distinct from 'false'
        or r->>'unresolvedClubMergeId' is not null or r->>'canonicalClubId' is null))) then
      raise exception using errcode = '55000', message = 'unresolved_reward_identity';
    end if;
    leftover := (p_allocation->>'unallocatedWei')::numeric;
    for item in select value from jsonb_array_elements(p_allocation->'entitlements') loop
      if item->>'kind' not in ('athlete', 'club') or jsonb_typeof(item->'amountWei') is distinct from 'string'
        or item->>'amountWei' !~ '^[1-9][0-9]{0,77}$' or jsonb_typeof(item->'explanation') is distinct from 'object'
        or not exists (select 1 from jsonb_array_elements(selected) r
          where r->>case when item->>'kind' = 'athlete' then 'canonicalAthleteId' else 'canonicalClubId' end = item->>'entityId') then
        raise exception using errcode = '22023', message = 'invalid_reward_entitlement';
      end if;
      total := total + (item->>'amountWei')::app_private.reward_uint256;
    end loop;
    if total + leftover <> campaign.budget_wei then
      raise exception using errcode = '22023', message = 'reward_budget_not_conserved';
    end if;
    insert into app_private.reward_allocations(campaign_id, review_id, reserved_by_user_id, allocated_wei,
      unallocated_wei, selected_source_ids, allocation_body, idempotency_key)
    values (campaign.id, reviewed.id, p_actor_user_id, total, leftover, selected_ids, p_allocation, p_idempotency_key) returning * into allocation;
    for item in select value from jsonb_array_elements(p_allocation->'entitlements') loop
      insert into app_private.reward_beneficiaries(campaign_id, kind, entity_id)
      values (campaign.id, item->>'kind', (item->>'entityId')::uuid) returning id into beneficiary_id;
      insert into app_private.reward_entitlements(allocation_id, beneficiary_id, amount_wei, explanation)
      values (allocation.id, beneficiary_id, (item->>'amountWei')::numeric, item->'explanation');
    end loop;
    if campaign.pot = 'race' then
      -- Entire round/family scopes stay consumed even when no prize is awarded.
      insert into app_private.reward_source_reservations(programme_id, allocation_id, family, round_id, subject_key)
      select programme.id, allocation.id, family, campaign.round_ids[1], subject from (
        select 'podium' family, c->>'id' subject from jsonb_array_elements(programme.configuration->'classifications') c
        union all select 'record', (m->>'raceId') || ':' || gender from jsonb_array_elements(snapshot.source_body->'mappings') m
          cross join (values ('M'), ('F')) g(gender)
        union all select 'club_performance', 'round'
      ) keys;
    else
      for item in select value from jsonb_array_elements(selected) loop
        identity_id := (item->>'canonicalAthleteId')::uuid;
        -- Reverse merge closure includes old aliases even when they no longer
        -- appear in the current result row. A later merge cannot evade an older
        -- reservation just by replacing the canonical athlete UUID.
        for alias_id in with recursive aliases(id) as (
          select identity_id union select a.id from public.athlete_profiles a join aliases previous on a.merged_into_athlete_profile_id = previous.id
        ) select id from aliases order by id loop
          insert into app_private.reward_source_reservations values
            (programme.id, allocation.id, 'athlete_metres', (item->>'roundId')::uuid, alias_id::text);
          if item->>'representedClubId' is not null then
            insert into app_private.reward_source_reservations values
              (programme.id, allocation.id, 'club_finishes', (item->>'roundId')::uuid, alias_id::text);
          end if;
        end loop;
      end loop;
    end if;
  end if;
  return jsonb_build_object('allocationId', allocation.id, 'campaignId', allocation.campaign_id,
    'reviewId', allocation.review_id, 'allocatedWei', allocation.allocated_wei::text, 'unallocatedWei', allocation.unallocated_wei::text,
    'entitlementCount', (select count(*) from app_private.reward_entitlements where allocation_id = allocation.id),
    'reservedAt', allocation.reserved_at);
end
$$;

revoke all on function public.service_create_reward_programme(uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.service_record_reward_sporting_review(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.service_reserve_reward_allocation(uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.service_create_reward_programme(uuid,text,jsonb) to service_role;
grant execute on function public.service_record_reward_sporting_review(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.service_reserve_reward_allocation(uuid,uuid,text,jsonb) to service_role;
comment on table app_private.reward_allocations is
  'Immutable private reservation, not funding/chain registration/activation/payment. No release/reallocation shortcut: cancellation/replacement requires a separately verified chain reconciliation workflow.';

commit;
