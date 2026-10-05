import test from "node:test";
import assert from "node:assert/strict";
import { verifyRewardRecordCandidate, decodeRewardRecordComparison, calculateRoundRewards,
  adaptRewardSourceEvidence, reviewRewardRoundEvidence } from "../../../packages/domain/dist/rewards/index.js";
import { decodeRewardConfiguration, captureRewardRecordSource, readRewardRecordSource } from "../../../packages/db/dist/rewards/index.js";
import { captureRewardRecordCandidate } from "../dist/features/rewards/record-candidate-service.js";
import { recordFixture } from "./fixtures/reward-record.mjs";
import { rewardId as id, rewardWire } from "./fixtures/reward-calculation.mjs";
const request = (f) => ({ ...f.input, roundId: id(101), configuration: decodeRewardConfiguration(f.configuration),
  targetSnapshot: f.context.snapshot, priorSnapshot: f.priorSnapshot });
const fails = (code, mutate) => { const f = recordFixture(); mutate(f); assert.throws(() => verifyRewardRecordCandidate(request(f)), (error) => error.code === code); };

test("independent prior evidence derives a strict baseline but never invents an approval", () => {
  const f = recordFixture(); const before = structuredClone(f); const result = verifyRewardRecordCandidate(request(f));
  assert.equal(result.baseline.finishTimeMs, 1800000n);
  assert.equal(result.baseline.establishedAtMs, BigInt(Date.parse("2025-06-01T08:30:00Z")));
  assert.equal(result.baseline.publicationId, id(60006));
  assert.equal(result.baseline.courseComparisonKey, `course:${id(502)}:standard:1:5000`);
  assert.equal(result.publicationSignature, "unverified"); assert.equal(Object.hasOwn(result.baseline, "approvalId"), false);
  assert.equal(result.sourceReviewEndsAt, BigInt(Date.parse("2026-06-04T12:00:01Z") / 1000));
  assert.deepEqual(f, before);
});
test("only fastest cited prior result qualifies; unknown division evidence cannot hide a competitor", () => {
  fails("reward_record_not_fastest_verified_source", (f) => { f.input.baselineSourceId = id(60021); });
  fails("record_gender_requires_review", (f) => { f.priorSnapshot.source.rows[4].gender = null; });
  fails("reward_record_not_fastest_verified_source", (f) => { f.input.gender = "F"; });
  fails("record_gender_requires_review", (f) => { f.source.rows[0].gender = "unknown"; });
  const f = recordFixture(); f.priorSnapshot.source.rows[4].finishTimeMs = "100000";
  assert.equal(verifyRewardRecordCandidate(request(f)).baseline.finishTimeMs, 1800000n);
});
test("course version equality never bypasses direction, timing, precision or human comparison", () => {
  fails("reward_record_direction_not_comparable", (f) => { f.comparison.targetDirection = "reverse"; });
  fails("reward_record_timing_not_comparable", (f) => { f.comparison.targetTimingMethod = "electronic"; });
  fails("reward_record_timing_not_comparable", (f) => { f.comparison.targetTimingBasis = "net"; });
  fails("reward_record_precision_not_comparable", (f) => { f.comparison.targetPrecisionMs = "1"; });
  fails("reward_record_comparison_review_required", (f) => { f.comparison.historyReviewed = false; });
  fails("reward_record_comparison_review_required", (f) => { f.comparison.exceptionsReviewed = false; });
  fails("reward_record_comparison_review_required", (f) => { f.comparison.rationale = "OK"; });
  fails("reward_record_course_not_comparable", (f) => { f.priorSnapshot.source.race.distanceMetres = "4999"; });
  fails("reward_record_course_not_comparable", (f) => { f.priorSnapshot.source.race.lapCount = 2; });
  fails("reward_record_course_not_comparable", (f) => { f.priorSnapshot.source.track.distanceMetres = "2500"; });
  fails("reward_record_precision_or_time_invalid", (f) => { f.priorSnapshot.source.rows[0].finishTimeMs = "1800001"; });
  fails("reward_record_precision_or_time_invalid", (f) => { f.source.rows[0].finishTimeMs = "1000001"; });
});
test("record evidence scope, publication and registration substitution are rejected", () => {
  fails("reward_record_source_scope_mismatch", (f) => { f.priorSnapshot.targetSnapshotId = id(999); });
  fails("reward_record_source_scope_mismatch", (f) => { f.priorSnapshot.campaignId = id(999); });
  fails("reward_record_source_scope_mismatch", (f) => { f.priorSnapshot.source.organizationId = id(999); });
  fails("reward_record_source_scope_mismatch", (f) => { f.priorSnapshot.source.race.eventEditionId = id(201); });
  fails("reward_record_publication_not_ready", (f) => { f.priorSnapshot.source.latestPublicationId = id(999); });
  fails("reward_record_publication_not_ready", (f) => { f.priorSnapshot.source.run.status = "running"; });
  fails("reward_record_row_provenance_mismatch", (f) => { f.priorSnapshot.source.rows[0].registrationRaceId = id(999); });
  fails("reward_record_source_not_ready", (f) => { f.priorSnapshot.source.race.isPractice = true; });
});
test("record evidence preserves contradiction, identity and adjudication blockers", () => {
  fails("reward_record_contradictory_finish", (f) => { f.priorSnapshot.source.rows[0].participationStatus = "dnf"; });
  fails("reward_record_contradictory_finish", (f) => { f.priorSnapshot.source.rows[0].finishTimeMs = "0"; });
  fails("duplicate_reward_record_source", (f) => { f.priorSnapshot.source.rows.push(structuredClone(f.priorSnapshot.source.rows[0])); });
  fails("reward_record_duplicate_finish_requires_review", (f) => { f.priorSnapshot.source.rows.push({ ...f.priorSnapshot.source.rows[0], id: id(60999) }); });
  fails("unresolved_reward_identity", (f) => { f.priorSnapshot.source.rows[0].identityCycle = true; });
  fails("reward_record_unresolved_adjudication", (f) => { f.priorSnapshot.source.adjudicationCases = [{ raceId: id(60001), state: "open", recomputeRequired: false }]; });
  fails("reward_round_has_unresolved_adjudication", (f) => { f.source.adjudicationCases = [{ id: id(60999), raceId: id(302), state: "open", recomputeRequired: false }]; });
});
test("prior finish must predate verified target start and review clocks never round down", () => {
  fails("record_requires_verified_race_start", (f) => { f.source.mappings[0].startAt = null; });
  fails("record_baseline_must_precede_race", (f) => { f.source.mappings[0].startAt = "2025-06-01T08:30:00Z"; });
  fails("reward_record_precision_or_time_invalid", (f) => { f.priorSnapshot.source.run.completedAt = "2025-06-01T08:01:00Z"; });
  const f = recordFixture(); f.priorSnapshot.source.publication.publishedAt = "2026-06-02T12:00:00.000001Z";
  assert.equal(verifyRewardRecordCandidate(request(f)).sourceReviewEndsAt, BigInt(Date.parse("2026-06-05T12:00:01Z") / 1000));
});
test("comparison rejects unknown keys, numbers, executable getters and lossy precision", () => {
  const f = recordFixture(); let invoked = false;
  for (const changed of [{ ...f.comparison, rewardAmount: "999" }, { ...f.comparison, priorPrecisionMs: 1000 },
    { ...f.comparison, priorPrecisionMs: "0.5" }, { ...f.comparison, priorPrecisionMs: "3", targetPrecisionMs: "3" }]) {
    assert.throws(() => decodeRewardRecordComparison(changed));
  }
  Object.defineProperty(f.comparison, "rationale", { enumerable: true, get() { invoked = true; return "must not run"; } });
  assert.throws(() => decodeRewardRecordComparison(f.comparison)); assert.equal(invoked, false);
});
test("net timing uses a conservative completed-run bound, never gun start plus net elapsed", () => {
  const f = recordFixture(); f.comparison.priorTimingBasis = "net"; f.comparison.targetTimingBasis = "net";
  const verified = verifyRewardRecordCandidate(request(f));
  assert.equal(verified.establishmentBasis, "result_run_completed_upper_bound");
  assert.equal(verified.baseline.establishedAtMs, BigInt(Date.parse("2025-06-01T09:00:00Z")));
  f.source.mappings[0].startAt = "2025-06-01T08:45:00Z";
  assert.throws(() => verifyRewardRecordCandidate(request(f)), { code: "record_baseline_must_precede_race" });
  f.comparison.priorTimingBasis = "gun"; f.comparison.targetTimingBasis = "gun";
  assert.equal(verifyRewardRecordCandidate(request(f)).establishmentBasis, "gun_finish");
});
test("verified candidate composes with strict record-broken and equal-time calculator rules", () => {
  const f = recordFixture(); const verified = verifyRewardRecordCandidate(request(f));
  const configuration = decodeRewardConfiguration(f.configuration); configuration.rounds = [configuration.rounds[0]];
  const evidence = adaptRewardSourceEvidence(f.context.snapshot, configuration);
  const round = reviewRewardRoundEvidence(evidence, id(101), { snapshotId: f.snapshotId, sourceFingerprintSha256: f.context.snapshot.sourceFingerprintSha256,
    approvalId: "synthetic-only", ...f.review.roundReviews[0], adjudications: [] });
  const records = f.review.roundReviews[0].records.map((r) => ({ ...r, baseline: r.gender === "M" && r.raceId === id(302)
    ? { ...verified.baseline, approvalId: "explicit-synthetic-approval-not-a-service-proof" } : null }));
  const input = { programmeId: id(10), roundId: id(101), budgetWei: 12000n, records, ...round };
  const result = calculateRoundRewards(input); assert.equal(result.awards.find((r) => r.family === "record").amountWei, 500n);
  assert.equal(result.awards.reduce((sum, r) => sum + r.amountWei, result.unallocatedWei), 12000n);
  records[0].baseline.finishTimeMs = 1000000n;
  assert.equal(calculateRoundRewards(input).awards.some((r) => r.family === "record"), false);
});

test("record repository captures in one RPC, pins request scope and preserves raw evidence", async () => {
  const f = recordFixture(); const input = { campaignId: f.campaignId, actorUserId: f.actorId,
    priorRaceId: id(60001), targetSnapshotId: f.snapshotId, idempotencyKey: "capture-record-01" }; let calls = 0;
  const result = await captureRewardRecordSource(input, async (name, args) => {
    calls++; assert.equal(name, "service_capture_reward_record_source"); assert.equal(args.p_actor_user_id, f.actorId);
    input.priorRaceId = id(999); input.targetSnapshotId = id(999); return { data: f.priorSnapshot, error: null };
  });
  assert.equal(calls, 1); assert.equal(result.source.race.distanceMetres, "5000.00"); assert.deepEqual(result, f.priorSnapshot);
  await assert.rejects(captureRewardRecordSource({ ...input, idempotencyKey: "short" }, () => { throw new Error("must not call"); }), { code: "invalid_reward_record_capture" });
});
test("record repository rejects changed response scope and sanitizes database failures", async () => {
  const f = recordFixture(); const input = { ...f.input, actorUserId: f.actorId };
  for (const property of ["campaignId", "targetSnapshotId", "priorRaceId"]) {
    await assert.rejects(captureRewardRecordSource(input, async () => ({ data: { ...f.priorSnapshot, [property]: id(999) }, error: null })),
      { code: "invalid_reward_record_source_response" });
  }
  for (const [message, code] of [["reward_operator_permission_required", "reward_operator_permission_required"],
    ["database private connection details", "reward_ledger_store_failed"]]) {
    await assert.rejects(readRewardRecordSource(input, async () => ({ data: null, error: { message } })), { code });
  }
});
test("private candidate service derives actor from session and snapshots decisions before await", async () => {
  const f = recordFixture(); const original = structuredClone(f.comparison); const calls = [];
  const output = await captureRewardRecordCandidate(f.session, f.input, {
    ledgerRpc: async (name, args) => { calls.push(name); assert.equal(args.p_actor_user_id, f.actorId);
      f.input.priorRaceId = id(999); f.comparison.historyReviewed = false;
      return { data: { ...f.context, review: null }, error: null }; },
    recordRpc: async (name, args) => { calls.push(name); assert.equal(args.p_actor_user_id, f.actorId);
      assert.equal(args.p_prior_race_id, id(60001)); return { data: f.priorSnapshot, error: null }; },
  });
  assert.deepEqual(rewardWire(output.comparison), original);
  assert.deepEqual(calls, ["service_read_reward_calculation_context", "service_capture_reward_record_source"]);
  assert.equal(Object.hasOwn(output.baseline, "approvalId"), false);
});
test("invalid comparison or cross-campaign record work cannot capture evidence", async () => {
  const f = recordFixture(); let writes = 0;
  const recordRpc = async () => { writes++; throw new Error("must not write"); };
  await assert.rejects(captureRewardRecordCandidate(f.session, { ...f.input, comparison: {} }, { recordRpc }));
  await assert.rejects(captureRewardRecordCandidate(f.session, { ...f.input, targetRaceId: id(999) }, {
    ledgerRpc: async () => ({ data: { ...f.context, review: null }, error: null }), recordRpc }), { code: "reward_record_target_scope_mismatch" });
  assert.equal(writes, 0);
});
