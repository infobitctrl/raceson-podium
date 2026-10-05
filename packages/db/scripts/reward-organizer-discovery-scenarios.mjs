import assert from "node:assert/strict";
import { dispatchOrganizerRewardRoutes } from "../../../apps/api/dist/routes/rewards/organizer.js";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";
import { organizerDistributionScenarios } from "./reward-organizer-distribution-scenarios.mjs";

export async function organizerDiscoveryScenarios({ harness, scenario, identity, other, programmeId, destination }) {
  const { query, scalar, rpc, rpcSql } = harness;
  const roleBefore = await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
  const totalBefore = await scalar("select sum(amount_wei)::text from app_private.reward_entitlements");
  const base = "/api/v1/organizer/rewards/programmes", dest = `${base}/${programmeId}/destinations`;
  const actorArgs = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: 31337, p_after_id: null };
  const programmeCall = rpcSql("service_list_reward_operator_programmes", actorArgs);
  const destinationCall = rpcSql("service_list_reward_operator_destinations", { ...actorArgs, p_programme_id: programmeId });
  const http = async (path, actor = identity, chainId = 31337) => {
    const res = { status: 200, body: null, private: false };
    assert.equal(await dispatchOrganizerRewardRoutes({ method: "GET" }, res, new URL(path, "http://127.0.0.1:5173"), {
      config: () => ({ chainId, origin: "http://127.0.0.1:5173" }), requireIdentity: async () => actor, rpc,
      readJsonBody: async () => { throw Error("Discovery must not read bodies"); },
      applyPrivateSessionHeaders: r => { r.private = true; }, sendSuccess: (r, body) => { r.body = body; },
      sendError: (r, status, code) => { r.status = status; r.body = { error: { code } }; },
    }), true);
    assert.equal(res.private, true);
    assert.doesNotMatch(JSON.stringify(res.body), /dateOfBirth|birthYear|sessionId|SessionId|userId|UserId|signature|proofId|EvidenceRef|nonce|idempotencyKey/);
    return res;
  };
  await scenario("organizer discovery uses actual programme authority, network and bounded private metadata without interpreting readiness", async () => {
    const p = await http(base); assert.equal(p.status, 200);
    const row = p.body.items.find(x => x.programmeId === programmeId); assert.ok(row);
    assert.equal(row.organizationId, id(1)); assert.equal(row.seasonId, id(3)); assert.equal(row.year, 2026);
    assert.equal(row.budgetWei, await scalar(`select budget_wei::text from app_private.reward_programmes where id=${literal(programmeId)}`));
    assert.equal(row.leagueName, await scalar(`select name from public.leagues where id=${literal(id(2))}`));
    const d = await http(dest); assert.equal(d.status, 200);
    const selected = d.body.items.find(x => x.requestId === destination.requestId); assert.ok(selected);
    assert.equal(selected.athleteProfileId, id(1000)); assert.equal(selected.destinationStatus, "pending_review");
    assert.equal(selected.athleteName, await scalar(`select display_name from public.athlete_profiles where id=${literal(id(1000))}`));
    // Current profile has no DOB. Discovery is not adulthood or payment approval.
    assert.deepEqual((await http(base, other)).body.items, []); assert.equal((await http(dest, other)).status, 403);
    assert.deepEqual((await http(base, identity, 10143)).body.items, []); assert.equal((await http(dest, identity, 10143)).status, 404);
    assert.deepEqual((await http(`${dest}?after=ffffffff-ffff-ffff-ffff-ffffffffffff`)).body.items, []);
  });

  await scenario("discovery follows merge aliases and historical programme review scope without leaking unrelated profiles or releasing held shares", async () => {
    const profile = id(1000), alias = id(99501), unrelated = id(99502), clubOnly = id(99503), historyOnly = id(99504);
    const audit = { schemaVersion: 1, policy: "operator-observed-external-wallet-v1", verifiedDateOfBirth: "1990-01-01",
      identityEvidenceRef: id(99701), adultEvidenceRef: id(99702), walletMfaEvidenceRef: id(99703), walletRecoveryEvidenceRef: id(99704) };
    // Transactional synthetic records only, rolled back before other scenarios.
    // Emulate the hosted service role only within this rolled-back transaction,
    // as in existing grant tests. Never change application grants to bypass RLS.
    const output = await query(`begin;
      alter role service_role bypassrls;
      insert into public.athlete_profiles(id,slug,first_name,last_name,display_name)
        values(${literal(alias)},'discovery-alias','Synthetic','Alias','Synthetic Alias'),
          (${literal(unrelated)},'discovery-unrelated','Synthetic','Unrelated','Synthetic Unrelated'),
          (${literal(clubOnly)},'discovery-club-only','Synthetic','Club','Synthetic Club'),
          (${literal(historyOnly)},'discovery-history-only','Synthetic','History','Synthetic History');
      update public.athlete_profiles set merged_into_athlete_profile_id=${literal(alias)} where id=${literal(profile)};
      insert into app_private.reward_wallet_challenges(id,user_id,session_id,chain_id,address,origin,expires_at,idempotency_key)
        select ('78000000-0000-4000-8000-'||lpad((99600+n)::text,12,'0'))::uuid,user_id,session_id,chain_id,address,origin,
          date_trunc('second',clock_timestamp())+interval '10 minutes','discovery-scope-'||n
        from app_private.reward_wallet_challenges cross join generate_series(1,4) n
        where id=(select challenge_id from app_private.reward_wallet_proofs where id=${literal(destination.proofId)});
      insert into app_private.reward_wallet_proofs(id,challenge_id,message_hash,signature)
        select ('78000000-0000-4000-8000-'||lpad((99600+n)::text,12,'0'))::uuid,
          ('78000000-0000-4000-8000-'||lpad((99600+n)::text,12,'0'))::uuid,message_hash,signature
        from app_private.reward_wallet_proofs cross join generate_series(1,4) n where id=${literal(destination.proofId)};
      insert into app_private.reward_athlete_destination_requests(id,user_id,session_id,athlete_profile_id,proof_id,idempotency_key)
        select ('78000000-0000-4000-8000-'||lpad((99600+n)::text,12,'0'))::uuid,${literal(identity.userId)}::uuid,
          ${literal(identity.sessionId)}::uuid,('78000000-0000-4000-8000-'||lpad((99500+n)::text,12,'0'))::uuid,
          ('78000000-0000-4000-8000-'||lpad((99600+n)::text,12,'0'))::uuid,'discovery-scope-'||n from generate_series(1,4) n;
      insert into app_private.reward_beneficiaries(campaign_id,kind,entity_id)
        select id,'club',${literal(clubOnly)}::uuid from app_private.reward_campaigns where programme_id=${literal(programmeId)} limit 1;
      insert into app_private.reward_athlete_readiness_reviews(programme_id,request_id,revision,reviewed_by_user_id,
        reviewed_session_id,profile_fingerprint_sha256,attestation,idempotency_key)
        values(${literal(programmeId)},${literal(id(99604))},1,${literal(identity.userId)},${literal(identity.sessionId)},
          repeat('a',64),${literal(JSON.stringify(audit))}::jsonb,'discovery-history-review');
      set local role service_role;
      ${destinationCall}
      select jsonb_build_object('unrelated',app_private.reward_destination_has_programme_scope(${literal(programmeId)},${literal(id(99602))}),
        'clubOnly',app_private.reward_destination_has_programme_scope(${literal(programmeId)},${literal(id(99603))}),
        'historyOnly',app_private.reward_destination_has_programme_scope(${literal(programmeId)},${literal(id(99604))}),
        'alias',app_private.reward_destination_has_programme_scope(${literal(programmeId)},${literal(id(99601))}));
      rollback;`);
    const [page, scope] = output.split("\n").map(JSON.parse);
    assert.deepEqual(scope, { unrelated: false, clubOnly: false, historyOnly: true, alias: true });
    assert.equal(page.items.find(x => x.requestId === id(99601)).destinationStatus, "identity_hold");
    assert.equal(page.items.find(x => x.requestId === id(99604)).destinationStatus, "identity_hold");
    assert.equal(page.items.find(x => x.requestId === destination.requestId).destinationStatus, "identity_hold");
    assert.ok(page.items.every(x => ![unrelated, clubOnly].includes(x.athleteProfileId)));
  });

  await scenario("actual SQL discovery pages 25 rows with an exact next cursor and preserves immutable programme/request data", async () => {
    // Clones exercise only the read projection. Copied proofs are deliberately
    // not re-signed and must never be used for review, consent or payment.
    const originalProgrammes = (await http(base)).body, originalDestinations = (await http(dest)).body;
    assert.equal(originalProgrammes.nextCursor, null); assert.equal(originalDestinations.nextCursor, null);
    const output = await query(`begin;
      alter role service_role bypassrls;
      insert into app_private.reward_programmes
        select (jsonb_populate_record(null::app_private.reward_programmes,to_jsonb(p)||jsonb_build_object(
          'id',('79000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
          'league_season_id',('79000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
          'on_chain_id','\\x'||encode(public.gen_random_bytes(32),'hex'),'idempotency_key','discovery-programme-'||n))).*
        from app_private.reward_programmes p cross join generate_series(1,27) n where p.id=${literal(programmeId)};
      insert into app_private.reward_wallet_challenges(id,user_id,session_id,chain_id,address,origin,expires_at,idempotency_key)
        select ('79000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,user_id,session_id,chain_id,address,origin,
          date_trunc('second',clock_timestamp())+interval '10 minutes','discovery-pagination-'||n
        from app_private.reward_wallet_challenges cross join generate_series(1,27) n
        where id=(select challenge_id from app_private.reward_wallet_proofs where id=${literal(destination.proofId)});
      insert into app_private.reward_wallet_proofs(id,challenge_id,message_hash,signature)
        select ('79000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
          ('79000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,message_hash,signature
        from app_private.reward_wallet_proofs cross join generate_series(1,27) n where id=${literal(destination.proofId)};
      insert into app_private.reward_athlete_destination_requests(id,user_id,session_id,athlete_profile_id,proof_id,idempotency_key)
        select ('79000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,${literal(identity.userId)}::uuid,
          ${literal(identity.sessionId)}::uuid,${literal(id(1000))}::uuid,
          ('79000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'discovery-pagination-'||n from generate_series(1,27) n;
      set local role service_role;
      with first(page) as materialized (${programmeCall.slice(0,-1)})
        select jsonb_build_object('first',page,'second',public.service_list_reward_operator_programmes(
          ${literal(identity.userId)},${literal(identity.sessionId)},31337,(page->>'nextCursor')::uuid)) from first;
      with first(page) as materialized (${destinationCall.slice(0,-1)})
        select jsonb_build_object('first',page,'second',public.service_list_reward_operator_destinations(
          ${literal(identity.userId)},${literal(identity.sessionId)},${literal(programmeId)},31337,(page->>'nextCursor')::uuid)) from first;
      rollback;`);
    const [programmes, destinations] = output.split("\n").map(JSON.parse);
    const addedIds = Array.from({ length: 27 }, (_, n) => `79000000-0000-4000-8000-${String(n + 1).padStart(12,"0")}`);
    for (const [{ first: page, second: tail }, key, original] of [
      [programmes, "programmeId", originalProgrammes], [destinations, "requestId", originalDestinations],
    ]) {
      assert.equal(page.items.length, 25); assert.equal(page.nextCursor, page.items[24][key]);
      assert.deepEqual(page.items.map(x => x[key]), page.items.map(x => x[key]).sort());
      assert.equal(tail.nextCursor, null); assert.ok(tail.items.every(x => x[key] > page.nextCursor));
      assert.deepEqual([...page.items, ...tail.items].map(x => x[key]), [...original.items.map(x => x[key]), ...addedIds].sort());
    }
    assert.equal(await scalar("select count(*) from app_private.reward_programmes where idempotency_key like 'discovery-%'"), 0);
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_destination_requests where idempotency_key like 'discovery-%'"), 0);
  });
  assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
  assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"), totalBefore);
  return organizerDistributionScenarios({ harness, scenario, identity, other, programmeId });
}
