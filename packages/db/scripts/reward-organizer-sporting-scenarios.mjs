import assert from "node:assert/strict";
import { dispatchOrganizerRewardRoutes } from "../../../apps/api/dist/routes/rewards/organizer.js";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";

// Local synthetic Auth/sporting evidence in the parent-owned disposable DB only.
export async function organizerSportingScenarios({ harness, scenario, programmeId, campaignId, emptyCampaignId }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  const identity = { userId: id(4), sessionId: id(98600) }, other = { userId: id(5), sessionId: id(98601) };
  await query(`insert into auth.sessions(id,user_id,not_after) values
    (${literal(identity.sessionId)},${literal(identity.userId)},clock_timestamp()+interval '1 hour'),
    (${literal(other.sessionId)},${literal(other.userId)},clock_timestamp()+interval '1 hour')`);
  const base = `/api/v1/organizer/rewards/programmes/${programmeId}/campaigns/${campaignId}/sources`, calls = new Map();
  const http = async (path, method = "GET", body = null, who = identity, chainId = 31337) => {
    const res = { status: 200, body: null, private: false };
    assert.equal(await dispatchOrganizerRewardRoutes({ method }, res, new URL(path, "http://127.0.0.1:3101"), {
      config: () => ({ chainId, origin: "http://127.0.0.1:3101" }), requireIdentity: async () => who, readJsonBody: async () => body,
      rpc: async (name, args) => { calls.set(name, structuredClone(args)); return rpc(name, args); },
      applyPrivateSessionHeaders: r => { r.private = true; }, sendSuccess: (r, d) => { r.body = d; },
      sendError: (r, status, code) => { r.status = status; r.body = { error: { code } }; },
    }), true);
    assert.equal(res.private, true);
    assert.doesNotMatch(JSON.stringify(res.body), /profileBirthYear|registrationBirthYear|dateOfBirth|recordApprovals|sourceFingerprint|sessionId|operatorUserId|signature|wallet/);
    return res;
  };
  const capture = key => http(`${base}/capture`, "POST", { idempotencyKey: key, confirmCapture: true });
  const counts = () => scalar(`select jsonb_build_object('snapshots',(select count(*) from app_private.reward_source_snapshots),
    'reviews',(select count(*) from app_private.reward_sporting_reviews),'allocations',(select count(*) from app_private.reward_allocations))`);
  async function expiresWhileWaiting(table, mode, action) {
    const before = await counts(), original = await scalar(`select not_after from auth.sessions where id=${literal(identity.sessionId)}`);
    const release = await lock(`lock table app_private.${table} in ${mode} mode;
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
    const pending = action(); pending.catch(() => {});
    try { try { await waiting(1); } finally { await release(); } assert.equal((await pending).status, 401); }
    finally { await query(`update auth.sessions set not_after=${literal(original)}::timestamptz where id=${literal(identity.sessionId)}`); }
    assert.deepEqual(await counts(), before);
  }
  async function grants(method) {
    const args = calls.get(method); assert.ok(args);
    for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin;set local role ${role};${rpcSql(method, args)}rollback;`), /permission denied for function/);
    const data = JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;${rpcSql(method, args)}rollback;`));
    assert.equal(data.campaignId, campaignId);
  }
  return {
    async capture(key) { const r = await capture(key); assert.equal(r.status, 200); return r.body; },
    async inspect(snapshotId) {
      await scenario("organizer HTTP inspects captured sporting facts without approving uncertain athletes or exposing private source fields", async () => {
        const before = await counts(), r = await http(`${base}/${snapshotId}`); assert.equal(r.status, 200);
        assert.equal(r.body.source.resultCount, 7); assert.equal(r.body.source.finishedCount, 6); assert.equal(r.body.source.uncertainMembershipCount, 1);
        assert.equal(r.body.source.items[4].possibleClassificationIds.length, 3); assert.equal(r.body.source.items[6].participationStatus, "dns");
        assert.equal((await http(base)).body.source.snapshotId, snapshotId);
        assert.equal((await http(base.replace(campaignId, emptyCampaignId))).body.source, null);
        assert.equal((await http(base, "GET", null, other)).status, 403);
        assert.equal((await http(base, "GET", null, identity, 10143)).status, 404);
        assert.equal((await http(`${base}/${id(98799)}`)).status, 404);
        // Reestablish the successful arguments before exercising grants.
        await http(`${base}/${snapshotId}`); await grants("service_read_reward_operator_sporting_context");
        assert.deepEqual(await counts(), before);
      });
      await scenario("source reads and capture INSERT roll back after real table waits with committed session expiry", async () => {
        await expiresWhileWaiting("reward_source_snapshots", "access exclusive", () => http(`${base}/${snapshotId}`));
        await expiresWhileWaiting("reward_source_snapshots", "share", () => capture("sporting-expired-capture"));
        await grants("service_capture_reward_operator_source");
      });
    },
    async prepare(snapshotId, review, expectedRevision) {
      const draft = { expectedRevision, review }, previewPath = `${base}/${snapshotId}/review-preview`, savePath = `${base}/${snapshotId}/reviews`;
      const preview = await http(previewPath, "POST", draft); assert.equal(preview.status, 200);
      const input = { ...draft, previewDigest: preview.body.previewDigest, idempotencyKey: "same-review-key-01", confirmReview: true };
      const save = () => http(savePath, "POST", input);
      await scenario("sporting HTTP independently verifies record approvals, rejects changed revisions and requires the exact preview", async () => {
        const before = await counts(); assert.ok(preview.body.families.some(f => f.family === "record" && BigInt(f.allocatedWei) > 0n));
        const baseline = review.roundReviews[0].records.find(r => r.baseline)?.baseline; assert.ok(baseline);
        const record = await http(`${base}/${snapshotId}/record-approvals/${baseline.approvalId}`); assert.equal(record.status, 200);
        assert.deepEqual(record.body.baseline, baseline); assert.equal((await http(`${base}/${snapshotId}/record-approvals/${baseline.approvalId}?after=${snapshotId}`)).status, 400);
        assert.equal((await http(previewPath, "POST", { ...draft, expectedRevision: expectedRevision - 1 })).status, 409);
        assert.equal((await http(savePath, "POST", { ...input, previewDigest: "0".repeat(64) })).status, 409);
        assert.equal((await http(savePath, "POST", { ...input, amountWei: "10000" })).status, 400);
        const missing = structuredClone(draft); missing.review.roundReviews[0].memberships = [];
        assert.equal((await http(previewPath, "POST", missing)).status, 422); assert.deepEqual(await counts(), before);
      });
      await scenario("sporting review INSERT is rolled back if its session expires while waiting, and direct browser-role writes are denied", async () => {
        await expiresWhileWaiting("reward_sporting_reviews", "share", save);
        await grants("service_record_reward_operator_sporting_review");
      });
      return {
        async submit() { const r = await save(); assert.equal(r.status, 200);
          const { programmeId: ignoredProgramme, chainId: ignoredChain, ...body } = r.body; return body; },
        async assertReserved(snapshot) {
          const same = await capture("concurrent-capture-01"); assert.equal(same.status, 200); assert.equal(same.body.snapshotId, snapshot.snapshotId);
          assert.equal((await capture("new-capture-after-allocation")).status, 409);
          assert.equal((await http(previewPath, "POST", draft)).status, 409);
        },
      };
    },
  };
}
