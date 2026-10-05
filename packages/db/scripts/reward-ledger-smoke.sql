-- Disposable synthetic programme only. No live sporting approval or funding.
begin;
alter role service_role bypassrls;
create function pg_temp.reward_id(n integer) returns uuid language sql immutable as $$
  select ('77000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into public.leagues(id, organization_id, slug, name, status)
values (pg_temp.reward_id(1), '20000000-0000-4000-8000-000000000001', 'synthetic-reward-ledger', 'Synthetic reward ledger', 'active');
insert into public.league_seasons(id, league_id, year, name, status)
values (pg_temp.reward_id(2), pg_temp.reward_id(1), 2026, 'Synthetic 2026', 'active');
insert into public.league_competitions(id, league_season_id, slug, name, status)
values (pg_temp.reward_id(3), pg_temp.reward_id(2), 'short', 'Short', 'active'),
  (pg_temp.reward_id(4), pg_temp.reward_id(2), 'long', 'Long', 'active');
insert into public.league_classifications(id, league_competition_id, slug, name, eligibility_json, status)
select pg_temp.reward_id(10 + i), pg_temp.reward_id(case when i <= 5 then 3 else 4 end), 'division-' || i,
  'Synthetic division ' || i, '{}'::jsonb, 'active' from generate_series(1, 7) i;
do $$
declare n integer; distance integer; edition uuid; race uuid; publication uuid; series uuid;
begin
  select e.event_series_id into series from public.event_categories c join public.event_editions e on e.id = c.event_edition_id
    where c.id = '20000000-0000-4000-8000-000000000013';
  for n in 1..5 loop
    if n = 1 then select event_edition_id into edition from public.event_categories where id = '20000000-0000-4000-8000-000000000013';
    else
      edition := pg_temp.reward_id(200 + n);
      insert into public.event_editions(id, event_series_id, slug, name, start_date, status)
      values (edition, series, 'synthetic-reward-' || n, 'Synthetic reward round ' || n, '2026-06-01', 'completed');
    end if;
    insert into public.league_round_events(id, league_season_id, event_edition_id, round_number, status)
    values (pg_temp.reward_id(100 + n), pg_temp.reward_id(2), edition, n, 'completed');
    for distance in 0..1 loop
      if n = 1 and distance = 0 then
        race := '20000000-0000-4000-8000-000000000013'; publication := '23000000-0000-4000-8000-000000000002';
      else
        race := pg_temp.reward_id(300 + n * 2 + distance); publication := pg_temp.reward_id(600 + n * 2 + distance);
        insert into public.event_categories(id, event_edition_id, slug, name, distance_km, status)
        values (race, edition, 'reward-distance-' || distance, 'Synthetic distance ' || distance, 5 + distance * 10, 'completed');
        insert into public.result_runs(id, event_category_id, trigger_type, status, started_at, completed_at)
        values (pg_temp.reward_id(500 + n * 2 + distance), race, 'manual', 'succeeded', '2026-06-01T12:00:00Z', '2026-06-01T13:00:00Z');
        insert into public.result_publications(id, event_category_id, result_run_id, publication_state, published_at, published_by_user_id)
        values (publication, race, pg_temp.reward_id(500 + n * 2 + distance), 'official', '2026-06-01T14:00:00Z', '00000000-0000-4000-8000-000000000102');
      end if;
      insert into public.league_round_race_mappings(id, league_round_event_id, league_competition_id, event_category_id, current_result_publication_id)
      values (pg_temp.reward_id(400 + n * 2 + distance), pg_temp.reward_id(100 + n), pg_temp.reward_id(3 + distance), race, publication);
    end loop;
  end loop;
end
$$;
create temporary table reward_ledger_request as
select jsonb_build_object('organizationId', '20000000-0000-4000-8000-000000000001', 'seasonId', pg_temp.reward_id(2),
  'operatorUserId', '00000000-0000-4000-8000-000000000102', 'environment', 'local_simulation', 'chainId', 31337,
  'operatorAddress', '0x1111111111111111111111111111111111111111', 'treasuryAddress', '0x2222222222222222222222222222222222222222',
  'budgetWei', '1000000', 'manifestHash', '0x' || repeat('11', 32),
  'roundIds', (select jsonb_agg(id order by id) from public.league_round_events where league_season_id = pg_temp.reward_id(2)),
  'configuration', jsonb_build_object('organizationId', '20000000-0000-4000-8000-000000000001', 'seasonId', pg_temp.reward_id(2),
    'rounds', (select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.round_number, 'eventEditionId', r.event_edition_id,
      'races', (select jsonb_agg(jsonb_build_object('id', m.event_category_id, 'mappingId', m.id, 'competitionId', m.league_competition_id) order by m.id)
        from public.league_round_race_mappings m where m.league_round_event_id = r.id)) order by r.id)
      from public.league_round_events r where r.league_season_id = pg_temp.reward_id(2)),
    'classifications', (select jsonb_agg(jsonb_build_object('id', c.id, 'competitionId', c.league_competition_id) order by c.id)
      from public.league_classifications c join public.league_competitions competition on competition.id = c.league_competition_id
      where competition.league_season_id = pg_temp.reward_id(2)))) body;
grant select on reward_ledger_request to service_role;
create function pg_temp.reward_programme(key text, actor uuid default '00000000-0000-4000-8000-000000000102')
returns jsonb language sql security invoker as $$
  select public.service_create_reward_programme(actor, key, (select body from reward_ledger_request))
$$;

set local role service_role;
create temporary table reward_ledger_checkpoint(kind text primary key, body jsonb);
insert into reward_ledger_checkpoint values ('programme', pg_temp.reward_programme('programme-01'));
do $$
declare result jsonb := (select body from reward_ledger_checkpoint where kind = 'programme');
begin
  if result is distinct from pg_temp.reward_programme('programme-01')
    or jsonb_array_length(result->'campaigns') <> 6
    or (select sum((c->>'budgetWei')::numeric) from jsonb_array_elements(result->'campaigns') c) <> 1000000
    or (select count(*) from jsonb_array_elements(result->'campaigns') c where c->>'pot' = 'race' and c->>'budgetWei' = '120000') <> 5
    or (select count(*) from jsonb_array_elements(result->'campaigns') c where c->>'pot' = 'league' and c->>'budgetWei' = '400000') <> 1 then
    raise exception 'programme budget conservation or idempotency failed';
  end if;
  begin perform pg_temp.reward_programme('programme-02'); raise exception 'duplicate economic programme allowed';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'reward_programme_already_configured' then raise; end if;
  end;
  begin perform pg_temp.reward_programme('programme-01', '00000000-0000-4000-8000-000000000101'); raise exception 'athlete created/replayed programme';
  exception when insufficient_privilege then null; end;
  begin update app_private.reward_programmes set id = id; raise exception 'row-lock grant enabled ledger editing';
  exception when object_not_in_prerequisite_state then null; end;
end
$$;
do $$
declare large_budget text; payload jsonb; result jsonb; expected_race numeric; remainder numeric; i integer; item jsonb;
begin
  foreach large_budget in array array['100000000000000000001', '100000000000000000006',
    '115792089237316195423570985008687907853269984665640564039457584007913129639935'] loop
    begin
      payload := (select body from reward_ledger_request) || jsonb_build_object('budgetWei', large_budget, 'environment', 'testnet_pilot', 'chainId', 10143);
      result := public.service_create_reward_programme('00000000-0000-4000-8000-000000000102', 'precision-test-01', payload);
      expected_race := div(large_budget::numeric * 3, 5); remainder := mod(expected_race, 5); i := 0;
      for item in select value from jsonb_array_elements(result->'campaigns') c where c->>'pot' = 'race' order by c->>'scopeKey' loop
        i := i + 1;
        if (item->>'budgetWei')::numeric <> div(expected_race, 5) + (case when i <= remainder then 1 else 0 end) then
          raise exception 'large wei integer division/largest remainder drift';
        end if;
      end loop;
      if (select sum((c->>'budgetWei')::numeric) from jsonb_array_elements(result->'campaigns') c) <> large_budget::numeric
        or (select (c->>'budgetWei')::numeric from jsonb_array_elements(result->'campaigns') c where c->>'pot' = 'league') <> large_budget::numeric - expected_race then
        raise exception 'large programme budget not conserved';
      end if;
      -- Roll back this isolated synthetic programme, not a real ledger deletion.
      raise exception using errcode = 'P9900', message = 'rollback_precision_fixture';
    exception when sqlstate 'P9900' then null;
    end;
  end loop;
end
$$;
insert into reward_ledger_checkpoint
select 'snapshot', public.service_capture_reward_source('20000000-0000-4000-8000-000000000001', pg_temp.reward_id(2),
  array[pg_temp.reward_id(101)], '00000000-0000-4000-8000-000000000102', 'ledger-source-01');
create function pg_temp.reward_review(key text, actor uuid default '00000000-0000-4000-8000-000000000102')
returns jsonb language sql security invoker as $$
  select public.service_record_reward_sporting_review(
    (select (c->>'id')::uuid from reward_ledger_checkpoint p cross join jsonb_array_elements(p.body->'campaigns') c
      where p.kind = 'programme' and c->>'scopeKey' = pg_temp.reward_id(101)::text),
    (select (body->>'snapshotId')::uuid from reward_ledger_checkpoint where kind = 'snapshot'), actor, key,
    '{"schemaVersion":1,"adjudications":[],"evidence":"synthetic-db-test-not-sporting-approval"}'::jsonb)
$$;
insert into reward_ledger_checkpoint values ('review', pg_temp.reward_review('review-01'));
do $$
declare first_review jsonb := (select body from reward_ledger_checkpoint where kind = 'review'); second_review jsonb;
begin
  if first_review is distinct from pg_temp.reward_review('review-01') then raise exception 'review replay changed'; end if;
  second_review := pg_temp.reward_review('review-02');
  if second_review->>'revision' <> '2' or second_review->>'reviewId' = first_review->>'reviewId' then raise exception 'reviews not versioned'; end if;
  insert into reward_ledger_checkpoint values ('latest-review', second_review);
  begin perform pg_temp.reward_review('review-03', '00000000-0000-4000-8000-000000000101'); raise exception 'athlete reviewed rewards';
  exception when insufficient_privilege then null; end;
end
$$;
-- Read bundles return the explicitly referenced immutable revision, not whichever
-- review became latest. No salt, recipient binding or request key is projected.
do $$
declare
  first_review jsonb := (select body from reward_ledger_checkpoint where kind = 'review');
  snapshot jsonb := (select body from reward_ledger_checkpoint where kind = 'snapshot');
  campaign_id uuid := (first_review->>'campaignId')::uuid;
  review_id uuid := (first_review->>'reviewId')::uuid;
  actor_id uuid := '00000000-0000-4000-8000-000000000102';
  bundle jsonb;
begin
  bundle := public.service_read_reward_calculation_context(campaign_id, actor_id, null, review_id);
  if bundle->>'schemaVersion' <> '1' or bundle#>>'{review,id}' <> review_id::text
    or bundle#>>'{review,revision}' <> '1' or bundle#>>'{campaign,id}' <> campaign_id::text
    or bundle#>>'{programme,operatorUserId}' <> actor_id::text
    or ((bundle->'snapshot') - 'capturedAt') is distinct from (snapshot - 'capturedAt')
    or (bundle#>>'{snapshot,capturedAt}')::timestamptz is distinct from (snapshot->>'capturedAt')::timestamptz
    or bundle->'programme' ?| array['snapshotSalt','onChainId','idempotencyKey','requestBody']
    or bundle->'campaign' ?| array['entitlements','beneficiaries','snapshotSalt'] then
    raise exception 'private calculation context changed source/review or leaked internal binding material';
  end if;
  bundle := public.service_read_reward_calculation_context(campaign_id, actor_id, (snapshot->>'snapshotId')::uuid, null);
  if bundle->'review' <> 'null'::jsonb
    or ((bundle->'snapshot') - 'capturedAt') is distinct from (snapshot - 'capturedAt')
    or (bundle#>>'{snapshot,capturedAt}')::timestamptz is distinct from (snapshot->>'capturedAt')::timestamptz then
    raise exception 'snapshot preview unexpectedly selected a review or different source';
  end if;
  begin perform public.service_read_reward_calculation_context(campaign_id, '00000000-0000-4000-8000-000000000101', null, review_id);
    raise exception 'athlete read private reward evidence';
  exception when insufficient_privilege then
    if sqlerrm <> 'reward_operator_permission_required' then raise; end if;
  end;
  begin perform public.service_read_reward_calculation_context(campaign_id, actor_id, (snapshot->>'snapshotId')::uuid, review_id);
    raise exception 'ambiguous review and source reference accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'invalid_reward_calculation_reference' then raise; end if;
  end;
  begin perform public.service_read_reward_calculation_context(campaign_id, actor_id, null, pg_temp.reward_id(999));
    raise exception 'foreign review read';
  exception when invalid_parameter_value then
    if sqlerrm <> 'reward_calculation_reference_mismatch' then raise; end if;
  end;
end
$$;
create temporary table reward_test_allocation as select jsonb_build_object(
  'programmeId', (select body->>'programmeId' from reward_ledger_checkpoint where kind = 'programme'),
  'campaignScopeId', pg_temp.reward_id(101), 'pot', 'race', 'budgetWei', '120000',
  'selectedSourceIds', jsonb_build_array('23000000-0000-4000-8000-000000000010', '23000000-0000-4000-8000-000000000011', '23000000-0000-4000-8000-000000000012'),
  'unallocatedWei', '60000', 'entitlements', jsonb_build_array(
    jsonb_build_object('kind', 'athlete', 'entityId', '10000000-0000-4000-8000-000000000003', 'amountWei', '30000', 'explanation', '{"synthetic":true}'::jsonb),
    jsonb_build_object('kind', 'club', 'entityId', '30000000-0000-4000-8000-000000000001', 'amountWei', '30000', 'explanation', '{"synthetic":true}'::jsonb))) body;
create function pg_temp.reward_reserve(body jsonb, review_kind text default 'latest-review')
returns jsonb language sql security invoker as $$
  select public.service_reserve_reward_allocation((select (body->>'reviewId')::uuid from reward_ledger_checkpoint where kind = review_kind),
    '00000000-0000-4000-8000-000000000102', 'reserve-01', $1)
$$;
do $$
declare payload jsonb := (select body from reward_test_allocation); result jsonb;
begin
  begin perform pg_temp.reward_reserve(payload, 'review'); raise exception 'superseded review allocated';
  exception when object_not_in_prerequisite_state then if sqlerrm <> 'reward_review_superseded' then raise; end if; end;
  begin perform pg_temp.reward_reserve(jsonb_set(payload, '{unallocatedWei}', '"60001"')); raise exception 'over budget accepted';
  exception when invalid_parameter_value then if sqlerrm <> 'reward_budget_not_conserved' then raise; end if; end;
  begin perform pg_temp.reward_reserve(jsonb_set(payload, '{selectedSourceIds}', '["23000000-0000-4000-8000-000000000010"]')); raise exception 'omitted runners accepted';
  exception when invalid_parameter_value then if sqlerrm <> 'reward_allocation_source_coverage_invalid' then raise; end if; end;
  begin perform pg_temp.reward_reserve(jsonb_set(payload, '{entitlements,0,amountWei}', '"30000.1"')); raise exception 'fractional wei accepted';
  exception when invalid_parameter_value then null; end;
  begin perform pg_temp.reward_reserve(jsonb_set(payload, '{entitlements,0,entityId}', '"10000000-0000-4000-8000-000000000099"')); raise exception 'foreign beneficiary accepted';
  exception when invalid_parameter_value then if sqlerrm <> 'invalid_reward_entitlement' then raise; end if; end;
  -- The duplicate error occurs after allocation and first entitlement insertion;
  -- the function's transaction must roll the entire attempted reservation back.
  begin perform pg_temp.reward_reserve(jsonb_set(payload, '{entitlements,1}', payload->'entitlements'->0)); raise exception 'duplicate beneficiary accepted';
  exception when unique_violation then null; end;
  if exists (select 1 from app_private.reward_allocations) or exists (select 1 from app_private.reward_entitlements)
    or exists (select 1 from app_private.reward_beneficiaries) or exists (select 1 from app_private.reward_source_reservations) then
    raise exception 'failed reservation left partial financial state';
  end if;
  result := pg_temp.reward_reserve(payload);
  insert into reward_ledger_checkpoint values ('allocation', result);
  if result is distinct from pg_temp.reward_reserve(payload) or result->>'entitlementCount' <> '2'
    or (select count(*) from app_private.reward_source_reservations) <> 12
    or (select count(distinct on_chain_id) from app_private.reward_entitlements) <> 2 then
    raise exception 'atomic reservation, opaque identities or scope consumption failed';
  end if;
  begin perform pg_temp.reward_review('review-03'); raise exception 'reserved allocation allowed new sporting review';
  exception when object_not_in_prerequisite_state then if sqlerrm <> 'reward_campaign_allocation_already_reserved' then raise; end if; end;
  begin perform pg_temp.reward_reserve(jsonb_set(payload, '{unallocatedWei}', '"60001"')); raise exception 'reservation edited by retry';
  exception when object_not_in_prerequisite_state then null; end;
end
$$;
reset role;
-- Exercise the league branch and reverse merge closure, not just race scopes.
insert into public.athlete_profiles(id, slug, first_name, last_name, display_name, merged_into_athlete_profile_id)
values (pg_temp.reward_id(950), 'synthetic-reward-alias', 'Synthetic', 'Alias', 'Synthetic Alias', '10000000-0000-4000-8000-000000000003');
set local role service_role;
insert into reward_ledger_checkpoint
select 'league-source', public.service_capture_reward_source('20000000-0000-4000-8000-000000000001', pg_temp.reward_id(2),
  array[pg_temp.reward_id(101),pg_temp.reward_id(102),pg_temp.reward_id(103),pg_temp.reward_id(104),pg_temp.reward_id(105)],
  '00000000-0000-4000-8000-000000000102', 'ledger-league-source-01');
create function pg_temp.reward_league_review() returns jsonb language sql security invoker as $$
  select public.service_record_reward_sporting_review(
    (select (c->>'id')::uuid from reward_ledger_checkpoint p cross join jsonb_array_elements(p.body->'campaigns') c
      where p.kind = 'programme' and c->>'pot' = 'league'),
    (select (body->>'snapshotId')::uuid from reward_ledger_checkpoint where kind = 'league-source'),
    '00000000-0000-4000-8000-000000000102', 'league-review-01', '{"schemaVersion":1,"adjudications":[]}'::jsonb)
$$;
reset role;
update public.league_classifications set eligibility_json = '{"minimumAge":18}' where id = pg_temp.reward_id(11);
set local role service_role;
do $$ begin
  begin perform pg_temp.reward_league_review(); raise exception 'changed source was reviewed against old capture';
  exception when object_not_in_prerequisite_state then if sqlerrm <> 'reward_review_source_changed' then raise; end if; end;
end $$;
reset role;
update public.league_classifications set eligibility_json = '{}' where id = pg_temp.reward_id(11);
set local role service_role;
insert into reward_ledger_checkpoint values ('league-review', pg_temp.reward_league_review());
do $$
declare
  race_review jsonb := (select body from reward_ledger_checkpoint where kind = 'review');
  league_review jsonb := (select body from reward_ledger_checkpoint where kind = 'league-review');
  snapshot_id uuid := (select (body->>'snapshotId')::uuid from reward_ledger_checkpoint where kind = 'league-source');
begin
  begin perform public.service_read_reward_calculation_context((race_review->>'campaignId')::uuid,
      '00000000-0000-4000-8000-000000000102', snapshot_id, null);
    raise exception 'league source was substituted for a round source';
  exception when invalid_parameter_value then
    if sqlerrm <> 'reward_calculation_reference_mismatch' then raise; end if;
  end;
  begin perform public.service_read_reward_calculation_context((race_review->>'campaignId')::uuid,
      '00000000-0000-4000-8000-000000000102', null, (league_review->>'reviewId')::uuid);
    raise exception 'foreign campaign review was substituted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'reward_calculation_reference_mismatch' then raise; end if;
  end;
end
$$;
do $$
declare payload jsonb := (select body from reward_test_allocation); result jsonb;
begin
  payload := payload || '{"campaignScopeId":"rounds-1-5","pot":"league","budgetWei":"400000","unallocatedWei":"100000"}'::jsonb;
  payload := jsonb_set(jsonb_set(payload, '{entitlements,0,amountWei}', '"150000"'), '{entitlements,1,amountWei}', '"150000"');
  result := pg_temp.reward_reserve(payload, 'league-review');
  if result->>'allocatedWei' <> '300000' or result->>'unallocatedWei' <> '100000'
    or (select count(*) from app_private.reward_source_reservations where family in ('athlete_metres', 'club_finishes')) <> 8
    or (select count(*) from app_private.reward_source_reservations where subject_key = pg_temp.reward_id(950)::text) <> 2 then
    raise exception 'league weights did not reserve every canonical/old-alias contribution';
  end if;
  begin
    insert into app_private.reward_source_reservations select * from app_private.reward_source_reservations limit 1;
    raise exception 'same sporting scope reserved twice';
  exception when unique_violation then null; end;
  if (select count(*) from app_private.reward_allocations) <> 2 or (select count(*) from app_private.reward_entitlements) <> 4 then
    raise exception 'independent race/league allocations or retry conservation failed';
  end if;
end
$$;
reset role;
do $$
declare name text;
begin
  foreach name in array array['reward_programmes', 'reward_campaigns', 'reward_sporting_reviews', 'reward_allocations',
    'reward_beneficiaries', 'reward_entitlements', 'reward_source_reservations'] loop
    if has_table_privilege('anon', 'app_private.' || name, 'select') or has_table_privilege('authenticated', 'app_private.' || name, 'select') then
      raise exception 'browser role can read private reward ledger';
    end if;
  end loop;
  begin delete from app_private.reward_entitlements; raise exception 'privileged deletion erased liability';
  exception when object_not_in_prerequisite_state then null; end;
  begin perform '1.1'::app_private.reward_uint256; raise exception 'numeric domain rounded fractional wei';
  exception when check_violation then null; end;
  begin perform 'NaN'::app_private.reward_uint256; raise exception 'numeric domain accepted NaN';
  exception when check_violation then null; end;
end
$$;
set local role anon;
do $$ begin
  begin perform public.service_read_reward_calculation_context(null, null, null, null); raise exception 'anonymous evidence read';
  exception when insufficient_privilege then null; end;
  begin perform public.service_create_reward_programme(null, null, null); raise exception 'anonymous programme mutation';
  exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
do $$ begin
  begin perform public.service_read_reward_calculation_context(null, null, null, null); raise exception 'browser evidence read';
  exception when insufficient_privilege then null; end;
  begin perform public.service_record_reward_sporting_review(null, null, null, null, null); raise exception 'browser review mutation';
  exception when insufficient_privilege then null; end;
  begin perform public.service_reserve_reward_allocation(null, null, null, null); raise exception 'browser reservation mutation';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
