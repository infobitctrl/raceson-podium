import assert from "node:assert/strict";
import test from "node:test";
import { verifyRewardRecordCandidate } from "../../../packages/domain/dist/rewards/index.js";
import { decodeRewardConfiguration, decodeRewardRecordApproval, rewardRecordApprovalRequest,
  readRewardRecordApproval, readRewardRecordSnapshot, withdrawRewardRecordApproval } from "../../../packages/db/dist/rewards/index.js";
import { approveRewardRecordCandidate, withdrawApprovedRewardRecord } from "../dist/features/rewards/record-approval-service.js";
import { previewRewardSportingReview, submitRewardSportingReview, reserveReviewedRewardAllocation } from "../dist/features/rewards/calculation-service.js";
import { recordFixture } from "./fixtures/reward-record.mjs";
import { rewardId as id } from "./fixtures/reward-calculation.mjs";

const rejects = (code, promise) => assert.rejects(promise, (error) => error.code === code);
function fixture() {
  const f = recordFixture();
  // A later correction extends the target clock even though performance was prior.
  f.priorSnapshot.source.publication.publishedAt = "2026-06-02T12:00:00.000001Z";
  const candidate = verifyRewardRecordCandidate({ ...f.input, roundId: f.context.campaign.scopeKey,
    priorSnapshot: f.priorSnapshot, targetSnapshot: f.context.snapshot, configuration: decodeRewardConfiguration(f.configuration) });
  const approval = { approvalId: id(61000), campaignId: f.campaignId, targetSnapshotId: f.snapshotId,
    priorSnapshotId: f.priorSnapshot.snapshotId, revision: 1, approvedByUserId: f.actorId, approvedAt: "2026-06-02T13:00:00Z",
    body: rewardRecordApprovalRequest(candidate), priorSnapshot: f.priorSnapshot };
  f.review.roundReviews[0].records[0].baseline = { ...approval.body.baseline, approvalId: approval.approvalId };
  return { ...f, candidate, approval, approveInput: { ...f.input, priorSnapshotId: f.priorSnapshot.snapshotId, idempotencyKey: "synthetic-approval-01" } };
}
function harness(f) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    if (name === "service_read_reward_record_snapshot") return { error: null, data: structuredClone(f.priorSnapshot) };
    if (name === "service_read_reward_calculation_context") return { error: null,
      data: { ...structuredClone(f.context), review: args.p_review_id ? structuredClone(f.context.review) : null } };
    if (name === "service_read_reward_record_approval" || name === "service_approve_reward_record") return { error: null, data: structuredClone(f.approval) };
    if (name === "service_record_reward_sporting_review") return { error: null, data: { reviewId: f.reviewId, campaignId: f.campaignId,
      snapshotId: f.snapshotId, revision: 1, reviewedAt: "2026-06-02T14:00:00Z" } };
    if (name === "service_reserve_reward_allocation") return { error: null, data: { allocationId: id(61001), campaignId: f.campaignId,
      reviewId: f.reviewId, allocatedWei: String(BigInt(args.p_allocation.budgetWei) - BigInt(args.p_allocation.unallocatedWei)),
      unallocatedWei: args.p_allocation.unallocatedWei, entitlementCount: args.p_allocation.entitlements.length, reservedAt: "2026-06-02T15:00:00Z" } };
    if (name === "service_withdraw_reward_record") return { error: null, data: { withdrawalId: id(61002), approvalId: f.approval.approvalId,
      campaignId: f.campaignId, withdrawnByUserId: f.actorId, withdrawnAt: "2026-06-02T16:00:00Z", reason: args.p_reason } };
    assert.fail(`Unexpected RPC ${name}`);
  };
  return { calls, rpc };
}
const reviewInput = (f) => ({ campaignId: f.campaignId, snapshotId: f.snapshotId, review: f.review, idempotencyKey: "synthetic-review-01" });
const reserveInput = (f) => ({ campaignId: f.campaignId, reviewId: f.reviewId, idempotencyKey: "synthetic-reserve-01" });
const expected = (f) => ({ campaignId: f.campaignId, actorUserId: f.actorId, approvalId: f.approval.approvalId });

test("record approval derives exact candidate from two stored snapshots and checked session", async () => {
  const f = fixture(); const h = harness(f);
  const result = await approveRewardRecordCandidate(f.session, { ...f.approveInput, actorUserId: id(999), baseline: { finishTimeMs: "1" } }, h.rpc);
  assert.equal(result.approvalId, f.approval.approvalId);
  assert.deepEqual(h.calls.map((call) => call.name), ["service_read_reward_record_snapshot", "service_read_reward_calculation_context", "service_approve_reward_record"]);
  assert.equal(h.calls[2].args.p_actor_user_id, f.actorId);
  assert.deepEqual(h.calls[2].args.p_request, f.approval.body);
  assert.equal(result.body.baseline.finishTimeMs, 1800000n);
});

test("approval copies human decisions and references before awaiting and does not trust returned derived values", async () => {
  const f = fixture(); const h = harness(f); const request = structuredClone(f.approveInput);
  await approveRewardRecordCandidate(f.session, request, async (name, args) => {
    if (name === "service_read_reward_record_snapshot") {
      request.comparison.courseEquivalent = false; request.campaignId = id(999); request.baselineSourceId = id(998);
      request.idempotencyKey = "mutated-key"; f.session.account.userId = id(997);
    }
    return h.rpc(name, args);
  });
  assert.equal(h.calls[2].args.p_request.comparison.courseEquivalent, true);
  assert.equal(h.calls[2].args.p_idempotency_key, "synthetic-approval-01");
  const other = fixture(); other.approval.body.baseline.finishTimeMs = "1";
  await rejects("invalid_reward_record_approval_document", approveRewardRecordCandidate(other.session, other.approveInput, harness(other).rpc));
});

test("valid saved record contributes money and extends review deadline without altering denominators", async () => {
  const f = fixture(); const h = harness(f);
  const preview = await previewRewardSportingReview(f.session, reviewInput(f), h.rpc);
  assert.equal(preview.recordEvidence.length, 1); assert.equal(preview.recordEvidence[0].approvalId, f.approval.approvalId);
  assert.equal(preview.selectedSourceIds.length, 6);
  assert.equal(preview.sourceReviewEndsAt, BigInt(Date.parse("2026-06-05T12:00:01Z") / 1000));
  const award = preview.result.awards.find((row) => row.family === "record");
  assert.ok(award.amountWei > 0n); assert.equal(award.beneficiaryId, id(1000));
  const saved = await submitRewardSportingReview(f.session, reviewInput(f), h.rpc); assert.equal(saved.reviewId, f.reviewId);
  const first = await reserveReviewedRewardAllocation(f.session, reserveInput(f), h.rpc);
  assert.deepEqual(await reserveReviewedRewardAllocation(f.session, reserveInput(f), h.rpc), first);
  assert.equal(first.allocatedWei + first.unallocatedWei, BigInt(f.context.campaign.budgetWei));
});

test("approval metadata scope, precision, fields and executable getters fail closed", () => {
  for (const change of [(a) => { a.campaignId = id(999); }, (a) => { a.approvedByUserId = id(999); },
    (a) => { a.priorSnapshot.targetSnapshotId = id(999); }, (a) => { a.revision = 0; },
    (a) => { a.body.baseline.finishTimeMs = 1800000; }, (a) => { a.body.baseline.finishTimeMs = "01800000"; },
    (a) => { a.body.amountWei = "1"; }, (a) => { a.approvedAt = "2026-06-02T15:00:00+02:00"; }]) {
    const f = fixture(); change(f.approval); assert.throws(() => decodeRewardRecordApproval(f.approval, expected(f)));
  }
  const f = fixture(); let executed = false;
  Object.defineProperty(f.approval, "body", { enumerable: true, get() { executed = true; } });
  assert.throws(() => decodeRewardRecordApproval(f.approval, expected(f))); assert.equal(executed, false);
});

test("supplied baseline substitution and self-consistent stored value tampering cannot reach a write", async () => {
  const mutations = [
    (f) => { f.review.roundReviews[0].records[0].baseline.finishTimeMs = "999999999"; },
    (f) => { f.review.roundReviews[0].records[0].baseline.publicationId = id(999); },
    (f) => { f.approval.body.sourceReviewEndsAt = "1"; },
    (f) => { f.approval.body.baseline.finishTimeMs = "999999999"; f.review.roundReviews[0].records[0].baseline.finishTimeMs = "999999999"; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f); const h = harness(f);
    await rejects("reward_record_approval_mismatch", submitRewardSportingReview(f.session, reviewInput(f), h.rpc));
    assert.ok(h.calls.every((call) => call.name.startsWith("service_read_")));
  }
});

test("SQL currentness failures are propagated once without rewriting or automatically withdrawing evidence", async () => {
  for (const code of ["reward_record_approval_withdrawn", "reward_record_approval_superseded", "reward_record_source_changed",
    "reward_record_approval_omitted", "reward_record_approval_mismatch", "reward_operator_permission_required"]) {
    const f = fixture(); const h = harness(f); let writes = 0;
    await rejects(code, reserveReviewedRewardAllocation(f.session, reserveInput(f), async (name, args) => {
      if (name === "service_reserve_reward_allocation") { writes++; return { data: null, error: { message: code } }; }
      return h.rpc(name, args);
    }));
    assert.equal(writes, 1);
  }
});

test("missing approval and private RPC failures remain sanitized", async () => {
  const f = fixture();
  await rejects("reward_record_approval_required", readRewardRecordApproval(expected(f), async () => ({ data: null, error: { message: "reward_record_approval_required" } })));
  await rejects("reward_ledger_store_failed", readRewardRecordApproval(expected(f), async () => ({ data: null, error: { message: "secret SQL connection details" } })));
  await rejects("reward_ledger_unavailable", readRewardRecordSnapshot({ ...expected(f), snapshotId: f.priorSnapshot.snapshotId }, async () => { throw Error("private details"); }));
  const h = harness(f); const request = { ...f.approveInput, idempotencyKey: "bad" };
  await assert.rejects(approveRewardRecordCandidate(f.session, request, h.rpc)); assert.equal(h.calls.length, 0);
});

test("withdrawal binds actor, reason, approval and idempotency without accepting any award edits", async () => {
  const f = fixture(); const h = harness(f);
  const request = { ...expected(f), idempotencyKey: "synthetic-withdraw-01", reason: "  Corrected prior result requires a new review.  ", amountWei: "1" };
  const result = await withdrawApprovedRewardRecord(f.session, request, h.rpc);
  assert.equal(result.reason, request.reason.trim()); assert.equal(result.withdrawnByUserId, f.actorId);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, "service_withdraw_reward_record");
  assert.ok(!Object.hasOwn(h.calls[0].args, "amountWei"));
  await assert.rejects(withdrawRewardRecordApproval({ ...request, reason: "short" }, h.rpc)); assert.equal(h.calls.length, 1);
  await rejects("invalid_reward_record_approval_document", withdrawRewardRecordApproval(request, async (name, args) => {
    const response = await h.rpc(name, args); response.data.approvalId = id(999); return response;
  }));
});
