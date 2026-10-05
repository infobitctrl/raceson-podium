import assert from "node:assert/strict";
import test from "node:test";
import { aggregateRewardEntitlements } from "../../../packages/domain/dist/rewards/index.js";
import { decodeRewardCalculationContext, rewardAllocationRequest, readRewardAllocationExport,
  checkRewardUploadEvidence } from "../../../packages/db/dist/rewards/index.js";
import { canonicalRewardJson, commitPrivateRewardDocument, rewardUploadDigest } from "../../../packages/rewards-chain/dist/index.js";
import { calculateRewardSportingContext } from "../dist/features/rewards/calculation-service.js";
import { prepareReservedRewardUpload } from "../dist/features/rewards/upload-service.js";
import { calculationFixture, rewardId as id, rewardWire } from "./fixtures/reward-calculation.mjs";

// Predictable IDs/salts only in synthetic tests. Production uses the DB's private
// cryptographic randomness; no fixture key or real athlete wallet is involved.
const h = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const rejects = (code, promise) => assert.rejects(promise, (error) => error.code === code);
async function fixture(pot = "race", number = 1, empty = false) {
  const f = calculationFixture(pot, number); const allocationId = id(90);
  if (empty) {
    f.source.rows = [];
    f.review.roundReviews.forEach((round) => { round.memberships = []; round.podiums.forEach((podium) => { podium.entries = []; }); });
  }
  const context = decodeRewardCalculationContext(f.context, { campaignId: f.campaignId, actorUserId: f.actorId, reviewId: f.reviewId });
  const calculated = await calculateRewardSportingContext(context, context.review.body);
  const chain = { programmeId: h(1), campaignId: h(2 + number), programmeManifestHash: h(10),
    operatorAddress: `0x${"1".repeat(40)}`, treasuryAddress: `0x${"2".repeat(40)}` };
  const allocation = { id: allocationId, reviewId: f.reviewId, snapshotSalt: h(100), body: rewardAllocationRequest(calculated),
    entitlements: aggregateRewardEntitlements(calculated.result).map((row, i) => ({ id: id(10000 + i), entitlementId: h(200 + i),
      beneficiaryKind: row.beneficiaryKind, beneficiaryId: row.beneficiaryId, opaqueBeneficiaryId: h(300 + i),
      amountWei: row.amountWei, explanationSalt: h(400 + i), explanation: row })) };
  const evidenceDocument = { schemaVersion: 1, kind: "raceson-allocation-evidence-v1", programmeId: context.programme.id,
    campaignId: f.campaignId, allocationId, configuration: context.programme.configuration,
    targetSnapshot: { snapshotId: f.snapshotId, sourceFingerprintSha256: context.snapshot.sourceFingerprintSha256 },
    sportingReview: context.review, calculation: calculated.result, recordApprovals: [] };
  return { ...f, allocationId, calculated, exported: rewardWire({ schemaVersion: 1, context: f.context, chain, allocation, evidenceDocument }),
    input: { campaignId: f.campaignId, allocationId, idempotencyKey: "synthetic-upload-01" } };
}
function harness(f) {
  const calls = []; let prepared;
  return { calls, get prepared() { return prepared; }, rpc: async (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    if (name === "service_read_reward_allocation_export") return { data: structuredClone(f.exported), error: null };
    if (name === "service_save_reward_upload") {
      if (prepared) assert.deepEqual(args.p_upload, prepared);
      prepared = structuredClone(args.p_upload);
      return { data: { uploadId: id(91), campaignId: f.campaignId, allocationId: f.allocationId,
        preparedByUserId: f.actorId, preparedAt: "2026-06-01T15:00:00Z", upload: prepared }, error: null };
    }
    if (name === "service_check_reward_upload_evidence") return { data: { uploadId: id(91), campaignId: f.campaignId,
      allocationId: f.allocationId, sourceReviewEndsAt: f.calculated.sourceReviewEndsAt.toString(), checkedAt: "2026-06-01T15:00:01Z" }, error: null };
    assert.fail(`Unexpected RPC ${name}`);
  } };
}

test("six stored campaign uploads preserve all reserved weights and deterministic salted commitments", async () => {
  let total = 0n;
  for (const number of [1, 2, 3, 4, 5, 0]) {
    const f = await fixture(number === 0 ? "league" : "race", number || 1); const h = harness(f);
    const result = await prepareReservedRewardUpload(f.session, f.input, h.rpc);
    assert.deepEqual(await prepareReservedRewardUpload(f.session, f.input, h.rpc), result);
    const upload = result.upload;
    assert.equal(upload.snapshotDigest, commitPrivateRewardDocument("snapshot", f.exported.evidenceDocument, f.exported.allocation.snapshotSalt));
    assert.equal(upload.latestPublicationAt + 259200n, f.calculated.sourceReviewEndsAt);
    assert.equal(upload.entitlementCount, BigInt(f.exported.allocation.entitlements.length));
    assert.equal(upload.allocated[upload.enabledPot] + upload.unallocated, upload.budgets[upload.enabledPot]);
    assert.equal(rewardUploadDigest(upload.awards, upload.enabledPot, upload.budgets[upload.enabledPot]).digest, upload.uploadDigest);
    total += upload.budgets[upload.enabledPot];
    const wire = canonicalRewardJson(upload);
    assert.doesNotMatch(wire, /78000000-|sourceFingerprint|snapshotSalt|explanationSalt|evidenceId|privateKey|claimedBy|email/);
    assert.equal(Object.keys(upload).length, 18);
    assert.ok(h.calls.every((call) => ["service_read_reward_allocation_export", "service_save_reward_upload"].includes(call.name)));
  }
  assert.equal(total, 100000000000000000001n);
});

test("only checked session and immutable allocation reference enter upload preparation", async () => {
  const f = await fixture(); const h = harness(f); const request = { ...f.input, upload: { awards: [] }, amountWei: "1", actorUserId: id(999) };
  await prepareReservedRewardUpload(f.session, request, async (name, args) => {
    if (name === "service_read_reward_allocation_export") {
      request.allocationId = id(998); request.campaignId = id(997); request.idempotencyKey = "mutated-key"; f.session.account.userId = id(996);
    }
    return h.rpc(name, args);
  });
  assert.equal(h.calls[1].args.p_actor_user_id, f.actorId); assert.equal(h.calls[1].args.p_allocation_id, f.allocationId);
  assert.equal(h.calls[1].args.p_idempotency_key, "synthetic-upload-01"); assert.ok(h.prepared.awards.length > 0);
});

test("empty approved race uploads no invented recipients and preserves its entire unallocated pot", async () => {
  const f = await fixture("race", 1, true); const h = harness(f);
  const { upload } = await prepareReservedRewardUpload(f.session, f.input, h.rpc);
  assert.deepEqual(upload.awards, []); assert.equal(upload.entitlementCount, 0n);
  assert.equal(upload.uploadDigest, `0x${"0".repeat(64)}`); assert.equal(upload.allocated[0], 0n);
  assert.equal(upload.unallocated, upload.budgets[0]); assert.equal(upload.budgets[1], 0n);
});

test("stored calculation, entitlement and evidence substitution cannot reach the upload writer", async () => {
  const cases = [
    ["reward_reserved_calculation_mismatch", (e) => { e.allocation.body.calculation.unallocatedWei = "1"; }],
    ["reward_reserved_entitlements_mismatch", (e) => { e.allocation.entitlements[0].amountWei = "1"; }],
    ["reward_reserved_entitlements_mismatch", (e) => { e.allocation.entitlements[0].explanation.beneficiaryId = id(999); }],
    ["reward_reserved_entitlements_mismatch", (e) => { e.allocation.entitlements.pop(); }],
    ["reward_evidence_salt_reused", (e) => { e.allocation.entitlements[0].explanationSalt = e.allocation.snapshotSalt; }],
    ["reward_upload_evidence_mismatch", (e) => { e.evidenceDocument.targetSnapshot.sourceFingerprintSha256 = "cc".repeat(32); }],
    ["reward_upload_evidence_mismatch", (e) => { e.evidenceDocument.recordApprovals = [{ approvalId: id(999) }]; }],
  ];
  for (const [code, change] of cases) {
    const f = await fixture(); change(f.exported); const h = harness(f);
    await rejects(code, prepareReservedRewardUpload(f.session, f.input, h.rpc)); assert.equal(h.calls.length, 1);
  }
});

test("export requires exact account/campaign/allocation, chain, integer precision and safe fields", async () => {
  for (const change of [(e) => { e.allocation.id = id(999); }, (e) => { e.context.campaign.id = id(999); },
    (e) => { e.context.programme.operatorUserId = id(999); }, (e) => { e.context.programme.chainId = 143; },
    (e) => { e.allocation.snapshotSalt = h(0); }, (e) => { e.allocation.entitlements[0].amountWei = 123; }]) {
    const f = await fixture(); change(f.exported);
    await assert.rejects(readRewardAllocationExport({ ...f.input, actorUserId: f.actorId }, harness(f).rpc));
  }
  const f = await fixture(); let ran = false;
  Object.defineProperty(f.exported.allocation, "body", { enumerable: true, get() { ran = true; } });
  await assert.rejects(readRewardAllocationExport({ ...f.input, actorUserId: f.actorId }, async () => ({ data: f.exported, error: null })));
  assert.equal(ran, false);
});

test("SQL freshness failure is not retried, hidden, or converted into a funded/active state", async () => {
  for (const code of ["reward_review_source_changed", "reward_record_approval_withdrawn", "reward_operator_permission_required", "reward_upload_already_prepared"]) {
    const f = await fixture(); const h = harness(f); let writes = 0;
    await rejects(code, prepareReservedRewardUpload(f.session, f.input, async (name, args) => {
      if (name === "service_save_reward_upload") { writes++; return { data: null, error: { message: code } }; }
      return h.rpc(name, args);
    }));
    assert.equal(writes, 1); assert.equal(h.prepared, undefined);
  }
});

test("evidence check is scoped, timestamped and contains no chain-state or permission assertion", async () => {
  const f = await fixture(); const h = harness(f); const input = { campaignId: f.campaignId, actorUserId: f.actorId, uploadId: id(91) };
  const result = await checkRewardUploadEvidence(input, h.rpc);
  assert.equal(result.allocationId, f.allocationId); assert.equal(result.sourceReviewEndsAt, f.calculated.sourceReviewEndsAt);
  assert.deepEqual(Object.keys(result).sort(), ["allocationId", "campaignId", "checkedAt", "sourceReviewEndsAt", "uploadId"]);
  await rejects("reward_ledger_store_failed", checkRewardUploadEvidence(input, async () => ({ data: null, error: { message: "private SQL connection details" } })));
  await rejects("reward_ledger_unavailable", checkRewardUploadEvidence(input, async () => { throw Error("private details"); }));
});
