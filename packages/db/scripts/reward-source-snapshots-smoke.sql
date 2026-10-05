-- Synthetic source review only; run immediately after the disposable demo fixture.
-- Everything, including the Supabase service-role simulation, rolls back.
begin;
alter role service_role bypassrls;

insert into public.leagues (id, organization_id, slug, name, status)
values ('76000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'reward-source-test', 'Synthetic reward league', 'active');
insert into public.league_seasons (id, league_id, year, name, status)
values ('76000000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000001', 2026, 'Synthetic 2026', 'active');
insert into public.league_round_events (id, league_season_id, event_edition_id, round_number, status)
select '76000000-0000-4000-8000-000000000003', '76000000-0000-4000-8000-000000000002',
  event_edition_id, 1, 'completed' from public.event_categories where id = '20000000-0000-4000-8000-000000000013';
insert into public.league_competitions (id, league_season_id, slug, name, status)
values ('76000000-0000-4000-8000-000000000004', '76000000-0000-4000-8000-000000000002', 'short', 'Short', 'active');
insert into public.league_classifications (id, league_competition_id, slug, name, eligibility_json, status)
values ('76000000-0000-4000-8000-000000000005', '76000000-0000-4000-8000-000000000004', 'male', 'Male', '{"gender":"M","minimumAge":16,"maximumAge":64.99}', 'active');
insert into public.league_round_race_mappings
  (id, league_round_event_id, league_competition_id, event_category_id, current_result_publication_id)
values ('76000000-0000-4000-8000-000000000006', '76000000-0000-4000-8000-000000000003',
  '76000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000013', '23000000-0000-4000-8000-000000000002');

create function pg_temp.reward_capture(
  capture_key text, actor uuid default '00000000-0000-4000-8000-000000000102',
  rounds uuid[] default array['76000000-0000-4000-8000-000000000003']::uuid[]
) returns jsonb language sql security invoker as $$
  select public.service_capture_reward_source('20000000-0000-4000-8000-000000000001',
    '76000000-0000-4000-8000-000000000002', rounds, actor, capture_key)
$$;

set local role service_role;
create temporary table reward_capture_checkpoint as select pg_temp.reward_capture('capture-0001') as value;
do $$
declare result jsonb := (select value from reward_capture_checkpoint);
begin
  if jsonb_array_length(result->'source'->'rows') <> 3
     or result->'source'->'mappings'->0->'publication'->>'signatureState' <> 'legacy_unsigned'
     or jsonb_typeof(result->'source'->'rows'->0->'finishTimeMs') <> 'string'
     or jsonb_typeof(result->'source'->'rows'->0->'clubPointsHundredths') <> 'string'
     or result->'source'->'competitions'->0->>'seasonId' <> '76000000-0000-4000-8000-000000000002'
     or result->'source'->'mappings'->0->'run'->>'status' <> 'succeeded'
     or result->'source'->'rows'->0->>'canonicalClubId' <> '30000000-0000-4000-8000-000000000001'
     or result::text ~ '(dateOfBirth|claimedBy|primaryEmail|privateKey|walletAddress)' then
    raise exception 'reward source completeness, provenance, precision or privacy regression';
  end if;
  if result is distinct from pg_temp.reward_capture('capture-0001') then
    raise exception 'reward source replay was not identical';
  end if;
  if (select count(*) from app_private.reward_source_snapshots) <> 1 then
    raise exception 'capture replay duplicated evidence';
  end if;
  begin
    perform pg_temp.reward_capture('capture-0002', '00000000-0000-4000-8000-000000000101');
    raise exception 'athlete without league authority captured private source';
  exception when insufficient_privilege then null; end;
  begin
    perform pg_temp.reward_capture('capture-0001', rounds := array['76000000-0000-4000-8000-000000000099']::uuid[]);
    raise exception 'idempotency key allowed a different round scope';
  exception when invalid_parameter_value then
    if sqlerrm <> 'reward_capture_idempotency_conflict' then raise; end if;
  end;
  begin
    perform pg_temp.reward_capture('capture-0002', rounds := array['76000000-0000-4000-8000-000000000003', '76000000-0000-4000-8000-000000000003']::uuid[]);
    raise exception 'duplicate rounds accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform pg_temp.reward_capture('capture-0002', rounds := array[null]::uuid[]);
    raise exception 'null round accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update app_private.reward_source_snapshots set source_body = '{}'::jsonb;
    raise exception 'service role changed an immutable snapshot';
  exception when insufficient_privilege then null; end;
end
$$;
reset role;

-- Changing reviewed classification eligibility changes a new source fingerprint,
-- but an old idempotency key still returns the original private capture.
update public.league_classifications set eligibility_json = '{"gender":"M","minimumAge":18,"maximumAge":64.99}'
where id = '76000000-0000-4000-8000-000000000005';
set local role service_role;
do $$
declare original jsonb := (select value from reward_capture_checkpoint); changed jsonb;
begin
  changed := pg_temp.reward_capture('capture-0002');
  if changed->>'sourceFingerprintSha256' = original->>'sourceFingerprintSha256'
     or original is distinct from pg_temp.reward_capture('capture-0001') then
    raise exception 'source correction mutated history or was not detected';
  end if;
end
$$;
reset role;

-- Existing immutable results retain the represented club; a new snapshot also
-- records the canonical merge path. Neither missing club owners nor old aliases
-- may remove those finishes from reward weights.
insert into public.clubs (id, slug, name)
values ('76000000-0000-4000-8000-000000000007', 'reward-canonical-club', 'Synthetic canonical club');
update public.clubs set merged_into_club_id = '76000000-0000-4000-8000-000000000007'
where id = '30000000-0000-4000-8000-000000000001';
set local role service_role;
do $$
declare original jsonb := (select value from reward_capture_checkpoint); merged jsonb;
begin
  merged := pg_temp.reward_capture('capture-merge');
  if (select count(*) from jsonb_array_elements(merged->'source'->'rows') r
      where r->>'representedClubId' = '30000000-0000-4000-8000-000000000001'
        and r->>'canonicalClubId' = '76000000-0000-4000-8000-000000000007'
        and r->'clubIdentityPath' = '["30000000-0000-4000-8000-000000000001","76000000-0000-4000-8000-000000000007"]'::jsonb
        and r->>'clubIdentityCycle' = 'false' and r->>'unresolvedClubMergeId' is null) <> 2
     or original is distinct from pg_temp.reward_capture('capture-0001') then
    raise exception 'club merge lost represented identity, canonical path or immutable history';
  end if;
end
$$;
reset role;
update public.clubs set merged_into_club_id = '30000000-0000-4000-8000-000000000001'
where id = '76000000-0000-4000-8000-000000000007';
set local role service_role;
do $$
declare cycled jsonb := pg_temp.reward_capture('capture-cycle');
begin
  if (select count(*) from jsonb_array_elements(cycled->'source'->'rows') r
      where r->>'representedClubId' = '30000000-0000-4000-8000-000000000001'
        and r->>'clubIdentityCycle' = 'true' and jsonb_array_length(r->'clubIdentityPath') = 3) <> 2 then
    raise exception 'club merge cycle was hidden instead of retained for blocking review';
  end if;
end
$$;
reset role;
update public.clubs set merged_into_club_id = null
where id in ('30000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000007');

-- Missing current publication blocks NEW captures, without destroying replay.
update public.league_round_race_mappings set current_result_publication_id = null
where id = '76000000-0000-4000-8000-000000000006';
set local role service_role;
do $$
begin
  if (select value from reward_capture_checkpoint) is distinct from pg_temp.reward_capture('capture-0001') then
    raise exception 'source change destroyed capture replay';
  end if;
  begin
    perform pg_temp.reward_capture('capture-0003');
    raise exception 'missing publication accepted';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'reward_mapping_source_not_ready' then raise; end if;
  end;
end
$$;
reset role;
update public.league_round_race_mappings set current_result_publication_id = '23000000-0000-4000-8000-000000000002'
where id = '76000000-0000-4000-8000-000000000006';
update public.league_round_events set status = 'scheduled'
where id = '76000000-0000-4000-8000-000000000003';
set local role service_role;
do $$
begin
  begin
    perform pg_temp.reward_capture('capture-0003');
    raise exception 'future round accepted';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'reward_round_not_ready' then raise; end if;
  end;
end
$$;
reset role;

-- The real ownership-transfer command retires the prior owner; do not disable
-- that existing safeguard just to manufacture a permission-denial fixture.
update public.organization_memberships
set role = 'admin', membership_type = 'permanent', account_template_key = 'organization-admin', expires_at = null,
  permission_keys = array['organization.manage', 'team.manage', 'events.manage', 'entrants.manage',
    'race_day.manage', 'checkpoint_timing.enter', 'results.manage', 'communications.manage',
    'safety.manage', 'logistics.manage', 'finance.manage']::text[]
where id = '20100000-0000-4000-8000-000000000002';
select public.service_transfer_organization_ownership('20000000-0000-4000-8000-000000000001',
  '20100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000102');
set local role service_role;
do $$
begin
  begin
    perform pg_temp.reward_capture('capture-0001');
    raise exception 'revoked organizer retained private evidence access';
  exception when insufficient_privilege then null; end;
end
$$;
reset role;

do $$
begin
  if has_table_privilege('anon', 'app_private.reward_source_snapshots', 'select')
     or has_table_privilege('authenticated', 'app_private.reward_source_snapshots', 'select')
     or has_function_privilege('anon', 'public.service_read_reward_source(uuid,uuid,uuid[],uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.service_capture_reward_source(uuid,uuid,uuid[],uuid,text)', 'execute')
     or not (select relrowsecurity from pg_class where oid = 'app_private.reward_source_snapshots'::regclass) then
    raise exception 'private reward evidence grants or RLS regression';
  end if;
  begin
    update app_private.reward_source_snapshots set source_body = source_body;
    raise exception 'privileged update bypassed immutable trigger';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    delete from app_private.reward_source_snapshots;
    raise exception 'privileged delete bypassed immutable trigger';
  exception when object_not_in_prerequisite_state then null; end;
end
$$;

set local role anon;
do $$
begin
  begin
    perform public.service_read_reward_source(null, null, null, null);
    raise exception 'anonymous caller reached private evidence reader';
  exception when insufficient_privilege then null; end;
end
$$;
set local role authenticated;
do $$
begin
  begin
    perform public.service_capture_reward_source(null, null, null, null, 'capture-0001');
    raise exception 'browser caller reached private capture RPC';
  exception when insufficient_privilege then null; end;
end
$$;
reset role;
rollback;
