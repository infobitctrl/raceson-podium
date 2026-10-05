import assert from "node:assert/strict";
import { dispatchOrganizerRewardRoutes } from "../../../apps/api/dist/routes/rewards/organizer.js";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";

export async function organizerDistributionScenarios({ harness, scenario, identity, other, programmeId }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  const base = `/api/v1/organizer/rewards/programmes/${programmeId}/campaigns`;
  const actor = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_programme_id: programmeId, p_chain_id: 31337 };
  const before = await scalar("select jsonb_build_object('amount',sum(amount_wei)::text,'count',count(*)) from app_private.reward_entitlements");
  const roleBefore = await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
  const http = async (path, who = identity, chainId = 31337) => {
    const res = { status: 200, body: null, private: false };
    assert.equal(await dispatchOrganizerRewardRoutes({ method: "GET" }, res, new URL(path, "http://127.0.0.1:3101"), {
      config: () => ({ chainId, origin: "http://127.0.0.1:3101" }), requireIdentity: async () => who, rpc,
      readJsonBody: async () => { throw Error("Distribution is read-only"); }, applyPrivateSessionHeaders: r => { r.private = true; },
      sendSuccess: (r, body) => { r.body = body; }, sendError: (r, status, code) => { r.status = status; r.body = { error: { code } }; },
    }), true); assert.equal(res.private, true);
    assert.doesNotMatch(JSON.stringify(res.body), /snapshotSalt|explanationSalt|signature|dateOfBirth|birthYear|sessionId|userId|wallet|privateKey|sourceFingerprintSha256/);
    return res;
  };
  let selected, awards, awardUrl, detailUrl;
  await scenario("organizer distribution connects six real SQL campaigns to exact reserved athlete and ownerless-club awards and source-bound calculations", async () => {
    const campaigns = await http(base); assert.equal(campaigns.status, 200); assert.equal(campaigns.body.items.length, 6);
    assert.equal(campaigns.body.budgetWei, await scalar(`select budget_wei::text from app_private.reward_programmes where id=${literal(programmeId)}`));
    selected = campaigns.body.items.find(c => c.roundNumber === 1); assert.ok(selected.allocation);
    assert.equal(selected.raceName, "Synthetic round 1");
    awardUrl = `${base}/${selected.campaignId}/allocations/${selected.allocation.allocationId}/awards`;
    const response = await http(awardUrl); assert.equal(response.status, 200); awards = response.body.items;
    assert.equal(response.body.nextCursor, null); assert.equal(awards.length, selected.allocation.awardCount);
    assert.equal(awards.reduce((s, a) => s + BigInt(a.amountWei), 0n).toString(), selected.allocation.allocatedWei);
    assert.ok(awards.some(a => a.beneficiaryKind === "club"));
    assert.ok(awards.some(a => a.beneficiaryKind === "athlete" && a.beneficiaryId !== id(1000)));
    for (const award of awards) {
      const detail = await http(`${awardUrl}/${award.entitlementId}`); assert.equal(detail.status, 200);
      assert.equal(detail.body.amountWei, award.amountWei); assert.equal(detail.body.beneficiaryId, award.beneficiaryId);
      const stored = await scalar(`select explanation from app_private.reward_entitlements where id=${literal(award.entitlementId)}`);
      const sourceIds = [...new Set(stored.breakdown.flatMap(b => b.sourceIds))].sort();
      assert.deepEqual(detail.body.sources.map(s => s.sourceId), sourceIds);
      assert.equal(detail.body.sourceCount, sourceIds.length);
      assert.deepEqual(detail.body.breakdown.map(b => [b.family, b.scopeId, b.amountWei]), stored.breakdown.map(b => [b.family, b.scopeId, b.amountWei]));
      assert.ok(detail.body.sources.every(s => s.roundNumber === 1 && BigInt(s.distanceMetres) > 0n && BigInt(s.finishTimeMs) > 0n));
      for (const source of detail.body.sources) assert.deepEqual(source.contributions,
        stored.breakdown.filter(b => b.sourceIds.includes(source.sourceId)).map(b => ({ family: b.family, scopeId: b.scopeId })));
      const after = await http(`${awardUrl}/${award.entitlementId}?after=${sourceIds[0]}`); assert.equal(after.status, 200);
      assert.deepEqual(after.body.sources.map(s => s.sourceId), sourceIds.slice(1)); assert.equal(after.body.sourceCount, sourceIds.length);
    }
    detailUrl = `${awardUrl}/${awards[0].entitlementId}`;
    for (const path of [base, awardUrl, detailUrl]) {
      assert.equal((await http(path, other)).status, 403); assert.equal((await http(path, identity, 10143)).status, 404);
    }
    assert.equal((await http(`${awardUrl}/${id(99999)}`)).status, 404);
    assert.equal((await http(awardUrl.replace(selected.allocation.allocationId, id(99999)))).status, 404);
    assert.equal((await http(awardUrl.replace(selected.campaignId, id(99999)))).status, 404);
  });
  await scenario("distribution functions deny browser roles and preserve invoker/session boundaries with service-only access", async () => {
    const calls = [rpcSql("service_list_reward_operator_campaigns", actor),
      rpcSql("service_list_reward_operator_awards", { ...actor, p_campaign_id: selected.campaignId, p_allocation_id: selected.allocation.allocationId, p_after_id: null }),
      rpcSql("service_read_reward_operator_award", { ...actor, p_campaign_id: selected.campaignId, p_allocation_id: selected.allocation.allocationId,
        p_entitlement_id: awards[0].entitlementId, p_after_id: null })];
    for (const call of calls) {
      for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin;set local role ${role};${call}rollback;`), /permission denied for function/);
      const result = JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;${call}rollback;`));
      assert.equal(result.programmeId, programmeId);
    }
    const posture = await scalar(`select jsonb_agg(jsonb_build_object('definer',p.prosecdef,'config',p.proconfig,'volatile',p.provolatile))
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('service_list_reward_operator_campaigns','service_list_reward_operator_awards','service_read_reward_operator_award')`);
    assert.equal(posture.length, 3); assert.ok(posture.every(p => !p.definer && p.volatile === "v" && p.config.includes('search_path=""')));
  });
  await scenario("all distribution HTTP reads recheck an actual expired session after a table-lock wait", async () => {
    const original = await scalar(`select not_after from auth.sessions where id=${literal(identity.sessionId)}`);
    const release = await lock(`lock table app_private.reward_entitlements in access exclusive mode;
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
    const pending = [base, awardUrl, detailUrl].map(path => http(path)); pending.forEach(p => p.catch(() => {}));
    try { await waiting(3); } finally { await release(); }
    try { for (const response of await Promise.all(pending)) {
      assert.equal(response.status, 401); assert.deepEqual(response.body, { error: { code: "reward_auth_required" } });
    } } finally { await query(`update auth.sessions set not_after=${literal(original)}::timestamptz where id=${literal(identity.sessionId)}`); }
    assert.equal((await http(detailUrl)).status, 200);
  });
  await scenario("actual distribution award pages preserve UUID order and exact cursors without retaining synthetic pagination rows", async () => {
    const extra = Array.from({ length: 27 }, (_, n) => `7a000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`);
    // Read-projection clones only, all rolled back. They are not calculated or
    // payable awards and do not establish a sporting allocation's validity.
    const output = JSON.parse(await query(`begin;
      insert into app_private.reward_beneficiaries(id,campaign_id,kind,entity_id)
        select x,${literal(selected.campaignId)},'athlete',x from unnest(array[${extra.map(literal).join(",")}]::uuid[]) x;
      insert into app_private.reward_entitlements(id,allocation_id,beneficiary_id,amount_wei,explanation)
        select x,${literal(selected.allocation.allocationId)},x,1,'{}'::jsonb from unnest(array[${extra.map(literal).join(",")}]::uuid[]) x;
      with first(page) as materialized (${rpcSql("service_list_reward_operator_awards", { ...actor, p_campaign_id: selected.campaignId,
        p_allocation_id: selected.allocation.allocationId, p_after_id: null }).slice(0, -1)})
        select jsonb_build_object('first',page,'second',public.service_list_reward_operator_awards(${literal(identity.userId)},${literal(identity.sessionId)},
          ${literal(programmeId)},31337,${literal(selected.campaignId)},${literal(selected.allocation.allocationId)},(page->>'nextCursor')::uuid)) from first;
      rollback;`));
    assert.equal(output.first.items.length, 25); assert.equal(output.first.nextCursor, output.first.items[24].entitlementId);
    assert.equal(output.second.nextCursor, null);
    assert.deepEqual([...output.first.items, ...output.second.items].map(a => a.entitlementId), [...awards.map(a => a.entitlementId), ...extra].sort());
  });
  assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
  assert.deepEqual(await scalar("select jsonb_build_object('amount',sum(amount_wei)::text,'count',count(*)) from app_private.reward_entitlements"), before);
  // Join the readiness suite's real committed ownership revocation. That suite
  // owns restoration; these reads must not add unrelated owner-transfer cycles
  // or fabricate programmes/awards just to exercise the authorization fence.
  return {
    startRevocationChecks() {
      const pending = [base, awardUrl, detailUrl].map(async path => {
        const response = await http(path);
        assert.equal(response.status, 403);
        assert.deepEqual(response.body, { error: { code: "reward_operator_permission_required" } });
      });
      pending.forEach(p => p.catch(() => {}));
      return pending;
    },
    async checkRestoredAccess() { assert.equal((await http(detailUrl)).status, 200); },
  };
}
