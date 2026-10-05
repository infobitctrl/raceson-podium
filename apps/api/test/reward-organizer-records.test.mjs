import assert from "node:assert/strict";
import test from "node:test";
import { recordFixture } from "./fixtures/reward-record.mjs";
import { rewardId as id } from "./fixtures/reward-calculation.mjs";
import { listOrganizerRecordRaces, getOrganizerRecordWorkspace, captureOrganizerRecord, previewOrganizerRecord,
  approveOrganizerRecord, withdrawOrganizerRecord } from "../dist/features/rewards/organizer-records-service.js";
import { dispatchOrganizerRewardRoutes } from "../dist/routes/rewards/organizer.js";
import { decodeRewardRecordWorkspace, decodeRewardRecordRacePage } from "../../../packages/domain/dist/rewards/index.js";

const privateFields = /sourceFingerprint|sourceAthleteId|registrationId|identityPath|operatorUserId|sessionId|birthYear|dateOfBirth|signature|wallet|approvedByUserId|withdrawnByUserId/;
function fixture() {
  const f = recordFixture(), identity = { userId: f.actorId, sessionId: id(98620) },
    scope = { programmeId: f.context.programme.id, campaignId: f.campaignId, chainId: 31337, snapshotId: f.snapshotId };
  const bundle = { context: { ...f.context, review: null }, priorSnapshot: f.priorSnapshot, names: [], latestApprovals: [], allocationId: null };
  const races = { ...scope, items: [{ raceId: f.input.priorRaceId, raceName: "Synthetic old route", eventEditionId: id(60000), eventName: "Synthetic prior edition",
    startAt: "2025-06-01T08:00:00Z", distanceMetres: "5000.00", latestCaptureId: f.priorSnapshot.snapshotId }], nextCursor: null };
  const draft = { priorSnapshotId: f.priorSnapshot.snapshotId, targetRaceId: f.input.targetRaceId, baselineSourceId: f.input.baselineSourceId,
    gender: "M", expectedRevision: 0, comparison: f.comparison };
  const calls = [], saved = new Map(); let fail = null;
  const rpc = async (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    assert.equal(args.p_actor_user_id, identity.userId); assert.equal(args.p_actor_session_id, identity.sessionId);
    assert.equal(args.p_campaign_id, scope.campaignId); assert.equal(args.p_programme_id, scope.programmeId); assert.equal(args.p_chain_id, 31337);
    if (fail) return { data: null, error: { message: fail } };
    if (name === "service_check_reward_operator_preparation") return { data: { programmeId: scope.programmeId, campaignId: scope.campaignId, chainId: 31337 }, error: null };
    assert.equal(args.p_source_snapshot_id, scope.snapshotId);
    let data;
    if (name === "service_list_reward_operator_record_races") data = races;
    else if (name === "service_read_reward_operator_record_context") data = { ...bundle, priorSnapshot: args.p_prior_snapshot_id === null ? null : bundle.priorSnapshot };
    else if (name === "service_capture_reward_operator_record") data = { ...scope, priorRaceId: f.input.priorRaceId, priorSnapshotId: f.priorSnapshot.snapshotId, capturedAt: f.priorSnapshot.capturedAt };
    else if (name === "service_withdraw_reward_operator_record") data = { withdrawalId: id(61001), approvalId: args.p_approval_id, campaignId: scope.campaignId,
      withdrawnByUserId: identity.userId, withdrawnAt: "2026-06-03T10:00:00Z", reason: args.p_reason };
    else {
      assert.equal(name, "service_approve_reward_operator_record");
      const previous = saved.get(args.p_idempotency_key);
      if (previous) { assert.deepEqual(args.p_request, previous.body); data = previous; }
      else { data = { approvalId: id(61000), campaignId: scope.campaignId, targetSnapshotId: scope.snapshotId, priorSnapshotId: f.priorSnapshot.snapshotId,
        revision: 1, approvedByUserId: identity.userId, approvedAt: "2026-06-02T13:00:00Z", body: args.p_request, priorSnapshot: f.priorSnapshot };
        saved.set(args.p_idempotency_key, structuredClone(data)); }
    }
    return { data: structuredClone(data), error: null };
  };
  return { f, identity, scope, bundle, races, draft, calls, saved, rpc, fail: code => { fail = code; } };
}
const confirm = (draft, preview) => ({ ...draft, previewDigest: preview.previewDigest, idempotencyKey: "synthetic-record-approval", confirmApproval: true });

test("record workspace lists named prior editions and shows frozen results without exposing private packets", async () => {
  const h = fixture(), list = await listOrganizerRecordRaces(h.identity, h.scope, null, h.rpc);
  assert.equal(list.items[0].distanceMetres, "5000"); assert.equal(list.items[0].latestCaptureId, h.f.priorSnapshot.snapshotId);
  const view = await getOrganizerRecordWorkspace(h.identity, h.scope, { priorSnapshotId: h.draft.priorSnapshotId }, h.rpc);
  assert.equal(view.targetRaces.length, 2); assert.equal(view.prior.resultCount, 6); assert.equal(view.prior.items[0].finishTimeMs, "1800000");
  assert.equal(view.prior.race.eventEditionId, id(60000)); assert.equal(view.prior.race.trackVersionId, id(60003));
  assert.doesNotMatch(JSON.stringify([list, view]), privateFields); assert.equal(h.saved.size, 0);
  assert.equal((await getOrganizerRecordWorkspace(h.identity, h.scope, { priorSnapshotId: null }, h.rpc)).prior, null);
  await assert.rejects(getOrganizerRecordWorkspace(h.identity, h.scope, { priorSnapshotId: null, afterId: id(1) }, h.rpc), { code: "invalid_reward_record_request" });
});
test("prior result inspection pins and pages all 31 rows, retaining unknown genders and no silent baseline selection", async () => {
  const h = fixture(), rows = h.bundle.priorSnapshot.source.rows;
  while (rows.length < 31) { const r = structuredClone(rows[0]); r.id = id(64000 + rows.length); r.gender = "unknown"; rows.push(r); }
  const a = await getOrganizerRecordWorkspace(h.identity, h.scope, { priorSnapshotId: h.draft.priorSnapshotId }, h.rpc);
  const b = await getOrganizerRecordWorkspace(h.identity, h.scope, { priorSnapshotId: h.draft.priorSnapshotId, afterId: a.prior.nextCursor }, h.rpc);
  assert.equal(a.prior.items.length, 25); assert.equal(b.prior.items.length, 6); assert.equal(b.prior.nextCursor, null);
  assert.ok(b.prior.items.every(r => r.gender === "U")); assert.equal(new Set([...a.prior.items, ...b.prior.items].map(r => r.sourceId)).size, 31);
  await assert.rejects(previewOrganizerRecord(h.identity, h.scope, h.draft, h.rpc)); assert.equal(h.saved.size, 0);
});
test("record capture requires explicit consent, keeps one key and returns only source identity", async () => {
  const h = fixture(), input = { priorRaceId: h.f.input.priorRaceId, idempotencyKey: "capture-record-test", confirmCapture: true };
  const a = await captureOrganizerRecord(h.identity, h.scope, input, h.rpc), b = await captureOrganizerRecord(h.identity, h.scope, input, h.rpc);
  assert.deepEqual(a, b); assert.equal(a.priorSnapshotId, h.f.priorSnapshot.snapshotId); assert.doesNotMatch(JSON.stringify(a), privateFields);
  await assert.rejects(captureOrganizerRecord(h.identity, h.scope, { ...input, confirmCapture: false }, h.rpc), { code: "invalid_reward_record_request" });
  assert.equal(h.calls.length, 2); assert.equal(h.saved.size, 0);
});
test("server comparison preview derives baseline and clocks; approval binds the exact preview and re-verifies stored evidence", async () => {
  const h = fixture(), preview = await previewOrganizerRecord(h.identity, h.scope, h.draft, h.rpc);
  assert.equal(preview.baseline.finishTimeMs, "1800000"); assert.equal(preview.establishmentBasis, "gun_finish"); assert.equal(h.saved.size, 0);
  assert.doesNotMatch(JSON.stringify(preview), privateFields);
  const input = confirm(h.draft, preview), a = await approveOrganizerRecord(h.identity, h.scope, input, h.rpc);
  assert.equal(a.revision, 1); assert.equal(h.saved.size, 1); assert.doesNotMatch(JSON.stringify(a), privateFields);
  await assert.rejects(approveOrganizerRecord(h.identity, h.scope, { ...input, previewDigest: "00".repeat(32) }, h.rpc), { code: "reward_record_preview_changed" });
  await assert.rejects(approveOrganizerRecord(h.identity, h.scope, { ...input, confirmApproval: false }, h.rpc), { code: "invalid_reward_record_request" });
  await assert.rejects(previewOrganizerRecord(h.identity, h.scope, { ...h.draft, baselineSourceId: id(60021) }, h.rpc), { code: "reward_record_not_fastest_verified_source" });
  await assert.rejects(previewOrganizerRecord(h.identity, h.scope, { ...h.draft, comparison: { ...h.draft.comparison, historyReviewed: false } }, h.rpc), { code: "reward_record_comparison_review_required" });
  const original = h.saved.get(input.idempotencyKey); original.body.baseline.finishTimeMs = "10";
  await assert.rejects(approveOrganizerRecord(h.identity, h.scope, input, h.rpc));
});
test("new previews reject changed revisions or reserved awards; exact prior approval retry remains historical", async () => {
  const h = fixture(), preview = await previewOrganizerRecord(h.identity, h.scope, h.draft, h.rpc), input = confirm(h.draft, preview);
  const original = await approveOrganizerRecord(h.identity, h.scope, input, h.rpc);
  h.bundle.latestApprovals = [{ approvalId: id(61010), snapshotId: h.scope.snapshotId, priorSnapshotId: h.draft.priorSnapshotId,
    raceId: h.draft.targetRaceId, gender: "M", revision: 2, approvedAt: "2026-06-03T10:00:00Z", withdrawnAt: "2026-06-03T11:00:00Z" }];
  await assert.rejects(previewOrganizerRecord(h.identity, h.scope, h.draft, h.rpc), { code: "reward_record_revision_changed" });
  h.bundle.allocationId = id(61020);
  await assert.rejects(previewOrganizerRecord(h.identity, h.scope, { ...h.draft, expectedRevision: 2 }, h.rpc), { code: "reward_campaign_allocation_already_reserved" });
  assert.deepEqual(await approveOrganizerRecord(h.identity, h.scope, input, h.rpc), original); assert.equal(h.saved.size, 1);
  const view = await getOrganizerRecordWorkspace(h.identity, h.scope, { priorSnapshotId: null }, h.rpc);
  assert.equal(view.latestApprovals[0].revision, 2); assert.ok(view.latestApprovals[0].withdrawnAt);
});
test("record inputs are frozen across awaits and final access loss suppresses private output", async () => {
  const h = fixture(), draft = structuredClone(h.draft), identity = { ...h.identity }, scope = { ...h.scope };
  const result = await previewOrganizerRecord(identity, scope, draft, async (n, p) => {
    const r = await h.rpc(n, p); draft.comparison.rationale = "changed"; draft.targetRaceId = id(8); identity.userId = id(7); scope.chainId = 10143; return r;
  });
  assert.equal(result.targetRaceId, h.draft.targetRaceId); assert.equal(result.chainId, 31337);
  await assert.rejects(getOrganizerRecordWorkspace(h.identity, h.scope, { priorSnapshotId: h.draft.priorSnapshotId }, async (n, p) => {
    if (n === "service_check_reward_operator_preparation") return { data: null, error: { message: "reward_account_session_required" } };
    return h.rpc(n, p);
  }), { code: "reward_account_session_required" });
});
test("record withdrawal requires explicit intent and returns a receipt, not a chain pause", async () => {
  const h = fixture(), input = { approvalId: id(61000), expectedRevision: 1, idempotencyKey: "withdraw-record-test", reason: "Synthetic comparison correction", confirmWithdrawal: true };
  const result = await withdrawOrganizerRecord(h.identity, h.scope, input, h.rpc);
  assert.equal(result.withdrawalId, id(61001)); assert.doesNotMatch(JSON.stringify(result), privateFields);
  await assert.rejects(withdrawOrganizerRecord(h.identity, h.scope, { ...input, confirmWithdrawal: false }, h.rpc));
  assert.equal(h.calls.length, 1);
});
test("record HTTP rejects wrong shape/query/method, authenticates each request and sanitizes backend failures", async () => {
  const h = fixture(), base = `/api/v1/organizer/rewards/programmes/${h.scope.programmeId}/campaigns/${h.scope.campaignId}/sources/${h.scope.snapshotId}`;
  const call = async (suffix, method = "GET", body = null) => {
    const res = { status: 200, body: null, private: false };
    const handled = await dispatchOrganizerRewardRoutes({ method }, res, new URL(base + suffix, "http://127.0.0.1:3101"), {
      config: () => ({ chainId: 31337, origin: "http://127.0.0.1:3101" }), requireIdentity: async () => h.identity, rpc: h.rpc,
      readJsonBody: async () => body, applyPrivateSessionHeaders: r => { r.private = true; }, sendSuccess: (r, b) => { r.body = b; },
      sendError: (r, s, code) => { r.status = s; r.body = { code }; },
    }); return { ...res, handled };
  };
  assert.equal((await call("/record-workspace")).status, 200); assert.equal((await call("/record-races")).private, true);
  assert.equal((await call("/record-preview", "GET")).handled, false);
  assert.equal((await call("/record-preview", "POST", { ...h.draft, amountWei: "1" })).status, 400);
  assert.equal((await call("/record-races?unexpected=x")).status, 400);
  assert.equal((await call("/record-workspace?after=" + id(1))).status, 400);
  assert.equal((await call("/record-captures", "POST", { priorRaceId: h.f.input.priorRaceId, idempotencyKey: "test-capture", confirmCapture: false })).status, 400);
  for (const [code, status] of [["reward_account_session_required", 401], ["reward_operator_permission_required", 403],
    ["reward_record_source_scope_mismatch", 404], ["reward_record_revision_changed", 409], ["private SQL secret", 503]]) {
    h.fail(code); const r = await call("/record-workspace"); assert.equal(r.status, status); assert.doesNotMatch(JSON.stringify(r.body), /private SQL secret/);
  }
});
test("shared record projections reject executable getters, unknown fields, wrong scopes and duplicate divisions", async () => {
  const h = fixture(), v = await getOrganizerRecordWorkspace(h.identity, h.scope, { priorSnapshotId: null }, h.rpc);
  assert.throws(() => decodeRewardRecordWorkspace({ ...v, rawSource: {} }, h.scope, null));
  assert.throws(() => decodeRewardRecordWorkspace(v, { ...h.scope, chainId: 10143 }, null));
  assert.throws(() => decodeRewardRecordWorkspace({ ...v, get latestApprovals() { throw Error("getter executed"); } }, h.scope, null), /invalid_reward_record_workspace_document/);
  const page = await listOrganizerRecordRaces(h.identity, h.scope, null, h.rpc);
  assert.throws(() => decodeRewardRecordRacePage({ ...page, items: [...page.items, ...page.items] }, h.scope));
});
