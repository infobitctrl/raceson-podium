import assert from "node:assert/strict";
import { dispatchOrganizerRewardRoutes } from "../../../apps/api/dist/routes/rewards/organizer.js";
import { recordFixture } from "../../../apps/api/test/fixtures/reward-record.mjs";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";

// Exercise the actual demo HTTP services against the parent-owned scratch SQL.
export async function organizerRecordScenarios({ harness, scenario, programmeId, campaignId, snapshotId }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  const identity = { userId: id(4), sessionId: id(98620) }, other = { userId: id(5), sessionId: id(98621) }, calls = new Map();
  await query(`insert into auth.sessions(id,user_id,not_after) values
    (${literal(identity.sessionId)},${literal(identity.userId)},clock_timestamp()+interval '1 hour'),
    (${literal(other.sessionId)},${literal(other.userId)},clock_timestamp()+interval '1 hour')`);
  const base = `/api/v1/organizer/rewards/programmes/${programmeId}/campaigns/${campaignId}/sources/${snapshotId}`;
  async function http(suffix, method = "GET", body = null, who = identity, chainId = 31337) {
    const res = { status: 200, body: null, private: false };
    assert.equal(await dispatchOrganizerRewardRoutes({ method }, res, new URL(base + suffix, "http://127.0.0.1:3101"), {
      config: () => ({ chainId, origin: "http://127.0.0.1:3101" }), requireIdentity: async () => who, readJsonBody: async () => body,
      rpc: async (name, args) => { calls.set(name, structuredClone(args)); return rpc(name, args); },
      applyPrivateSessionHeaders: r => { r.private = true; }, sendSuccess: (r, b) => { r.body = b; },
      sendError: (r, status, code) => { r.status = status; r.body = { error: { code } }; },
    }), true);
    assert.equal(res.private, true);
    assert.doesNotMatch(JSON.stringify(res.body), /sourceFingerprint|registrationId|identityPath|operatorUserId|sessionId|birthYear|dateOfBirth|signature|wallet|approvedByUserId|withdrawnByUserId/);
    return res;
  }
  const counts = () => scalar(`select jsonb_build_object('captures',(select count(*) from app_private.reward_record_source_snapshots),
    'approvals',(select count(*) from app_private.reward_record_approvals),'withdrawals',(select count(*) from app_private.reward_record_withdrawals),
    'allocations',(select count(*) from app_private.reward_allocations))`);
  const capture = key => http("/record-captures", "POST", { priorRaceId: id(60001), idempotencyKey: key, confirmCapture: true });
  async function expire(table, mode, action) {
    const before = await counts(), original = await scalar(`select not_after from auth.sessions where id=${literal(identity.sessionId)}`);
    const release = await lock(`lock table app_private.${table} in ${mode} mode;
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
    const pending = action(); pending.catch(() => {});
    try { try { await waiting(1); } finally { await release(); } assert.equal((await pending).status, 401); }
    finally { await query(`update auth.sessions set not_after=${literal(original)}::timestamptz where id=${literal(identity.sessionId)}`); }
    assert.deepEqual(await counts(), before);
  }
  async function grants(name) {
    const args = calls.get(name); assert.ok(args);
    for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin;set local role ${role};${rpcSql(name, args)}rollback;`), /permission denied for function/);
    const before = await counts(); await query(`begin;alter role service_role bypassrls;set local role service_role;${rpcSql(name, args)}rollback;`);
    assert.deepEqual(await counts(), before);
  }
  let approvedInput;
  return {
    async inspect() {
      await scenario("record HTTP discovers prior editions without using current-round results as historical baselines", async () => {
        const before = await counts(), races = await http("/record-races"); assert.equal(races.status, 200);
        assert.ok(races.body.items.some(r => r.raceId === id(60001))); assert.ok(races.body.items.every(r => ![id(302), id(303)].includes(r.raceId)));
        const old = races.body.items.find(r => r.raceId === id(60001)); assert.ok(old.eventName); assert.equal(old.latestCaptureId, null);
        assert.equal((await http("/record-workspace")).body.prior, null);
        assert.equal((await http("/record-workspace", "GET", null, other)).status, 403);
        assert.equal((await http("/record-workspace", "GET", null, identity, 10143)).status, 404);
        assert.equal((await http(`/record-captures/${id(999999)}`)).status, 404);
        assert.equal((await http("/record-races?unexpected=x")).status, 400);
        const functions = await scalar(`select jsonb_agg(jsonb_build_object('name',p.proname,'definer',p.prosecdef,'volatility',p.provolatile,
          'emptySearchPath',p.proconfig @> array['search_path=""'],'anon',has_function_privilege('anon',p.oid,'execute'),
          'authenticated',has_function_privilege('authenticated',p.oid,'execute'),'service',has_function_privilege('service_role',p.oid,'execute')))
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.proname in
          ('require_reward_record_workspace','service_list_reward_operator_record_races','service_read_reward_operator_record_context',
           'service_capture_reward_operator_record','service_approve_reward_operator_record','service_withdraw_reward_operator_record')`);
        assert.equal(functions.length,6); assert.ok(functions.every(f=>!f.definer&&f.volatility==='v'&&f.emptySearchPath&&!f.anon&&!f.authenticated&&f.service));
        await http("/record-races"); await grants("service_list_reward_operator_record_races"); assert.deepEqual(await counts(), before);
      });
    },
    async capture(key) { const r = await capture(key); assert.equal(r.status, 200); return r.body; },
    async prepare(priorSnapshot, expectedRevision, key, baselineSourceId = id(60120)) {
      const draft = { priorSnapshotId: priorSnapshot.snapshotId, expectedRevision, targetRaceId: id(302), baselineSourceId,
        gender: "M", comparison: recordFixture().comparison };
      const preview = await http("/record-preview", "POST", draft); assert.equal(preview.status, 200);
      const input = { ...draft, previewDigest: preview.body.previewDigest, idempotencyKey: key, confirmApproval: true };
      if (key === "record-approve-01") approvedInput = input;
      return { input, async approve() { const r = await http("/record-approvals", "POST", input); assert.equal(r.status, 200); return r.body; } };
    },
    async approvalChecks(approved, prepared) {
      await scenario("record HTTP shows captured prior evidence and current revision without exporting the raw packet", async () => {
        const r = await http(`/record-captures/${approved.priorSnapshotId}`); assert.equal(r.status, 200);
        assert.equal(r.body.prior.items.length, 6); assert.equal(r.body.prior.items[0].finishTimeMs, "1700000");
        assert.equal(r.body.latestApprovals[0].approvalId, approved.approvalId); assert.equal(r.body.latestApprovals[0].withdrawnAt, null);
        assert.equal((await http("/record-preview", "POST", { ...prepared.input })).status, 400);
        const { previewDigest, idempotencyKey, confirmApproval, ...draft } = prepared.input;
        assert.equal((await http("/record-preview", "POST", draft)).status, 409);
        assert.equal((await http("/record-approvals", "POST", { ...prepared.input, previewDigest: "0".repeat(64) })).status, 409);
        assert.equal((await http("/record-approvals", "POST", { ...prepared.input, idempotencyKey: "http-stale-record-revision" })).status, 409);
        assert.equal((await http(`/record-approvals/${approved.approvalId}/withdraw`, "POST", { expectedRevision: approved.revision+1,
          idempotencyKey: "http-stale-withdrawal", reason: "Synthetic mismatched inspected revision", confirmWithdrawal: true })).status, 409);
        await http(`/record-captures/${approved.priorSnapshotId}`); await grants("service_read_reward_operator_record_context");
      });
      await scenario("record reads and capture INSERT suppress output or roll back after committed session expiry during table waits", async () => {
        await expire("reward_record_approvals", "access exclusive", () => http("/record-workspace"));
        await expire("reward_record_source_snapshots", "share", () => capture("http-expired-prior-capture"));
        await grants("service_capture_reward_operator_record");
      });
      const next = await this.prepare({ snapshotId: approved.priorSnapshotId }, approved.revision, "http-expired-record-approval");
      await scenario("record approval and withdrawal INSERT roll back on session expiry and deny direct browser-role execution", async () => {
        await expire("reward_record_approvals", "share", () => http("/record-approvals", "POST", next.input));
        await grants("service_approve_reward_operator_record");
        const withdrawal = { expectedRevision: approved.revision, idempotencyKey: "http-expired-record-withdrawal", reason: "Synthetic rollback-only record correction", confirmWithdrawal: true };
        await expire("reward_record_withdrawals", "share", () => http(`/record-approvals/${approved.approvalId}/withdraw`, "POST", withdrawal));
        await grants("service_withdraw_reward_operator_record");
      });
    },
    async withdrawn(approved, originalInput) {
      const response = await http(`/record-approvals/${approved.approvalId}/withdraw`, "POST", {
        expectedRevision: approved.revision, idempotencyKey: originalInput.idempotencyKey, reason: originalInput.reason, confirmWithdrawal: true });
      assert.equal(response.status, 200); assert.equal(response.body.approvalId, approved.approvalId);
      const context = await http("/record-workspace"); assert.ok(context.body.latestApprovals[0].withdrawnAt);
      const before = await counts();
      assert.equal((await http(`/record-approvals/${approved.approvalId}/withdraw`, "POST", {
        expectedRevision: approved.revision, idempotencyKey: "http-already-withdrawn", reason: "Synthetic no second withdrawal", confirmWithdrawal: true })).status, 409);
      assert.deepEqual(await counts(), before);
    },
    async historical(originalApproval) {
      const before = await counts(), r = await http("/record-approvals", "POST", approvedInput); assert.equal(r.status, 200);
      assert.equal(r.body.approvalId, originalApproval.approvalId); assert.equal(r.body.revision, 1);
      assert.equal((await capture("prior-capture-01")).status, 200); assert.equal((await capture("post-allocation-new-record-capture")).status, 409);
      assert.deepEqual(await counts(), before);
    },
  };
}
