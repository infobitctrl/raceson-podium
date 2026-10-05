import assert from "node:assert/strict";
import test from "node:test";
import { readRewardCalculationContext, decodeRewardConfiguration, decodeRewardSportingReview } from "../../../packages/db/dist/rewards/index.js";
import { previewRewardSportingReview, submitRewardSportingReview, reserveReviewedRewardAllocation } from "../dist/features/rewards/calculation-service.js";
import { calculationFixture, rewardId as id, rewardWire } from "./fixtures/reward-calculation.mjs";

const rejects = (code, promise) => assert.rejects(promise, (error) => error.code === code);
const reference = (f) => ({ campaignId: f.campaignId, actorUserId: f.actorId, reviewId: f.reviewId });
const input = (f) => ({ campaignId: f.campaignId, snapshotId: f.snapshotId, review: f.review, idempotencyKey: "synthetic-review-01" });
const reserveInput = (f) => ({ campaignId: f.campaignId, reviewId: f.reviewId, idempotencyKey: "synthetic-reserve-01" });
function harness(f) {
  const calls = []; let allocation;
  return { calls, get allocation() { return allocation; }, rpc: async (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    if (name === "service_read_reward_calculation_context") return { error: null,
      data: { ...structuredClone(f.context), review: args.p_review_id ? structuredClone(f.context.review) : null } };
    if (name === "service_record_reward_sporting_review") return { error: null, data: { reviewId: f.reviewId,
      campaignId: f.campaignId, snapshotId: f.snapshotId, revision: 1, reviewedAt: "2026-06-01T14:00:00Z" } };
    if (name === "service_reserve_reward_allocation") {
      if (allocation) assert.deepEqual(args.p_allocation, allocation);
      allocation = structuredClone(args.p_allocation);
      return { error: null, data: { allocationId: id(90), campaignId: f.campaignId, reviewId: f.reviewId,
        allocatedWei: String(BigInt(allocation.budgetWei) - BigInt(allocation.unallocatedWei)), unallocatedWei: allocation.unallocatedWei,
        entitlementCount: allocation.entitlements.length, reservedAt: "2026-06-01T15:00:00Z" } };
    }
    assert.fail(`Unexpected RPC ${name}`);
  } };
}

test("private context is one scoped read with exact configuration/budget decoding", async () => {
  for (const budget of [100000000000000000001n, 100000000000000000006n, (1n << 256n) - 1n]) {
    const f = calculationFixture("race", 1, budget); const h = harness(f);
    const context = await readRewardCalculationContext(reference(f), h.rpc);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0].args, { p_campaign_id: f.campaignId, p_actor_user_id: f.actorId, p_source_snapshot_id: null, p_review_id: f.reviewId });
    assert.equal(context.programme.budgetWei, budget); assert.equal(context.campaign.budgetWei, BigInt(f.context.campaign.budgetWei));
    assert.equal(context.programme.configuration.classifications[0].maximumAgeHundredths, 1599n);
    assert.equal(context.programme.configuration.rounds[0].races[0].distanceMetres, 5000n);
    assert.equal(context.review.id, f.reviewId);
  }
});

test("stored configuration/review decoder rejects rounding, injection, invalid structure and executable getters", () => {
  const f = calculationFixture(); const decode = (mutate) => { const config = structuredClone(f.configuration); mutate(config); assert.throws(() => decodeRewardConfiguration(config)); };
  decode((c) => { c.rounds[0].races[0].distanceMetres = "5000.1"; });
  decode((c) => { c.rounds[0].races[0].distanceMetres = 5000; });
  decode((c) => { c.rounds[0].races[0].distanceMetres = "05000"; });
  decode((c) => { c.classifications[0].maximumAgeHundredths = "15001"; });
  decode((c) => { c.classifications[0].gender = "U"; });
  decode((c) => { c.rounds.pop(); });
  decode((c) => { c.rounds[1].number = 1; });
  decode((c) => { c.rounds[1].races[0].mappingId = c.rounds[0].races[0].mappingId; });
  decode((c) => { c.wallets = []; });
  let getterRan = false; const review = structuredClone(f.review);
  Object.defineProperty(review, "adjudications", { enumerable: true, get() { getterRan = true; return []; } });
  assert.throws(() => decodeRewardSportingReview(review)); assert.equal(getterRan, false);
  assert.throws(() => decodeRewardSportingReview({ ...f.review, amountWei: "1" }));
  const sparse = structuredClone(f.review); delete sparse.roundReviews[0].podiums[0];
  assert.throws(() => decodeRewardSportingReview(sparse));
  const typed = decodeRewardSportingReview(f.review); assert.deepEqual(rewardWire(typed), f.review);
});

test("context rejects cross-campaign/review/snapshot/operator substitution, mainnet and precision loss", async () => {
  const changes = [
    (c) => { c.campaign.id = id(999); }, (c) => { c.review.id = id(999); },
    (c) => { c.programme.operatorUserId = id(999); }, (c) => { c.review.reviewedByUserId = id(999); },
    (c) => { c.programme.chainId = 143; }, (c) => { c.campaign.budgetWei = "12000000000000000001"; },
    (c) => { c.campaign.roundIds = [id(999)]; }, (c) => { c.programme.configuration.rounds.pop(); },
    (c) => { c.snapshot.capturedAt = "2026-06-01T14:00:00+02:00"; },
  ];
  for (const change of changes) {
    const f = calculationFixture(); change(f.context);
    await rejects("invalid_reward_calculation_context", readRewardCalculationContext(reference(f), harness(f).rpc));
  }
  const f = calculationFixture(); f.context.snapshot.snapshotId = id(999);
  await rejects("invalid_reward_calculation_context", readRewardCalculationContext({ campaignId: f.campaignId, actorUserId: f.actorId, snapshotId: f.snapshotId }, harness(f).rpc));
});

test("private read errors stay sanitized and invalid references never reach SQL", async () => {
  const f = calculationFixture(); let calls = 0;
  await rejects("invalid_reward_calculation_context", readRewardCalculationContext({ ...reference(f), snapshotId: f.snapshotId }, async () => { calls++; }));
  assert.equal(calls, 0);
  for (const code of ["reward_operator_permission_required", "reward_calculation_reference_mismatch"]) {
    await rejects(code, readRewardCalculationContext(reference(f), async () => ({ data: null, error: { message: code, detail: "private evidence" } })));
  }
  await rejects("reward_ledger_store_failed", readRewardCalculationContext(reference(f), async () => ({ data: null, error: { message: "private SQL connection details" } })));
  await rejects("reward_ledger_unavailable", readRewardCalculationContext(reference(f), async () => { throw new Error("private network details"); }));
});

test("context decoder binds copied request references even when caller mutates them during the read", async () => {
  const f = calculationFixture(); const request = reference(f); const h = harness(f);
  const context = await readRewardCalculationContext(request, async (name, args) => {
    request.campaignId = id(999); request.actorUserId = id(998); request.reviewId = id(997);
    return h.rpc(name, args);
  });
  assert.equal(context.campaign.id, f.campaignId); assert.equal(context.review.id, f.reviewId);
  assert.equal(context.programme.operatorUserId, f.actorId);
});

test("reviewed race preview keeps non-winning sources, missing record reserves and no readiness dependency", async () => {
  const f = calculationFixture(); const h = harness(f); const before = structuredClone(f.context);
  const result = await previewRewardSportingReview(f.session, input(f), h.rpc);
  assert.equal(h.calls.length, 1); assert.equal(result.selectedSourceIds.length, 6);
  assert.ok(result.selectedSourceIds.includes(id(3013))); // fourth place still reserved
  assert.ok(!result.result.awards.some((award) => award.beneficiaryId === id(1003)));
  assert.ok(result.result.awards.some((award) => award.beneficiaryId === id(1004))); // missing age reviewed for sporting category only
  assert.ok(result.result.awards.some((award) => award.beneficiaryId === id(2000) && award.family === "club_performance"));
  assert.equal(result.result.explanations.filter((row) => row.family === "record").length, 4);
  assert.equal(result.result.awards.reduce((sum, award) => sum + award.amountWei, result.result.unallocatedWei), BigInt(f.context.campaign.budgetWei));
  assert.equal(result.sourceReviewEndsAt, BigInt(Date.parse("2026-06-04T12:00:00Z") / 1000) + 1n);
  assert.deepEqual(f.context, before); assert.ok(result.diagnostics.some((row) => row.code === "publication_signature_unverified"));
});

test("league review covers all five rounds without requiring unrelated podium or exact-age decisions", async () => {
  const f = calculationFixture("league"); const h = harness(f);
  const preview = await previewRewardSportingReview(f.session, input(f), h.rpc);
  assert.equal(preview.selectedSourceIds.length, 30);
  assert.equal(preview.result.awards.find((award) => award.beneficiaryId === id(1004)).calculation.weight, 25000n);
  assert.equal(preview.result.awards.find((award) => award.beneficiaryId === id(1004)).calculation.totalWeight, 200000n);
  assert.equal(preview.result.awards.find((award) => award.beneficiaryId === id(2000)).calculation.weight, 25n);
  assert.equal(preview.result.unallocatedWei, 0n);
  f.context.snapshot.source.rounds.pop();
  await rejects("reward_source_rounds_mismatch", previewRewardSportingReview(f.session, input(f), h.rpc));
});

test("incomplete category coverage, foreign records and unverified baseline claims never persist a review", async () => {
  const cases = [
    ["reward_podium_review_incomplete", (f) => { f.review.roundReviews[0].podiums.pop(); }],
    ["reward_podium_members_missing", (f) => { f.review.roundReviews[0].podiums[3].entries.pop(); }],
    ["reward_membership_review_incomplete", (f) => { f.review.roundReviews[0].memberships = []; }],
    ["invalid_record_divisions", (f) => { f.review.roundReviews[0].records[0].raceId = id(999); }],
    ["reward_record_approval_required", (f) => { f.review.roundReviews[0].records[0].baseline = {
      approvalId: "unverified-attestation", publicationId: id(999), establishedAtMs: "1000", finishTimeMs: "999999999", courseComparisonKey: "unverified-course",
    }; }],
    ["reward_round_has_unresolved_adjudication", (f) => { f.source.adjudicationCases = [{ id: id(999), raceId: f.source.mappings[0].raceId,
      state: "open", recomputeRequired: false }]; }],
  ];
  for (const [code, mutate] of cases) {
    const f = calculationFixture(); mutate(f); const h = harness(f);
    await rejects(code, submitRewardSportingReview(f.session, input(f), h.rpc));
    assert.ok(h.calls.every((call) => call.name === "service_read_reward_calculation_context"));
  }
});

test("saving review uses the checked session and copied sporting decisions, not mutable caller fields", async () => {
  const f = calculationFixture(); const h = harness(f); const request = input(f); const original = structuredClone(f.review);
  const rpc = async (name, args) => {
    if (name === "service_read_reward_calculation_context") {
      request.campaignId = id(999); request.snapshotId = id(998); request.idempotencyKey = "changed-key";
      request.review.roundReviews[0].podiums[3].entries = [];
      f.session.account.userId = id(997);
    }
    return h.rpc(name, args);
  };
  await submitRewardSportingReview(f.session, request, rpc);
  const saved = h.calls[1]; assert.equal(saved.name, "service_record_reward_sporting_review");
  assert.equal(saved.args.p_actor_user_id, f.actorId); assert.equal(saved.args.p_campaign_id, f.campaignId);
  assert.equal(saved.args.p_source_snapshot_id, f.snapshotId); assert.equal(saved.args.p_idempotency_key, "synthetic-review-01");
  assert.deepEqual(saved.args.p_review, original);
});

test("reservation loads and recomputes the stored review; hostile extra input cannot set amounts or exclude runners", async () => {
  for (const pot of ["race", "league"]) {
    const f = calculationFixture(pot); const h = harness(f);
    const request = { ...reserveInput(f), actorUserId: id(999), budgetWei: "1", selectedSourceIds: [],
      result: { awards: [{ beneficiaryId: id(999), amountWei: "9999999999999999999999" }] } };
    const first = await reserveReviewedRewardAllocation(f.session, request, h.rpc);
    const second = await reserveReviewedRewardAllocation(f.session, request, h.rpc);
    assert.deepEqual(first, second); assert.equal(h.calls.length, 4);
    assert.equal(h.calls[1].args.p_actor_user_id, f.actorId);
    assert.equal(h.allocation.selectedSourceIds.length, pot === "race" ? 6 : 30);
    assert.equal(h.allocation.budgetWei, f.context.campaign.budgetWei);
    assert.ok(!h.allocation.entitlements.some((row) => row.entityId === id(999)));
    assert.equal(first.allocatedWei + first.unallocatedWei, BigInt(f.context.campaign.budgetWei));
  }
});

test("duplicate athlete-round requires exact stored adjudication and keeps excluded-source audit", async () => {
  const f = calculationFixture("league"); const h = harness(f);
  const duplicate = { ...structuredClone(f.source.rows[0]), id: id(9999), registrationId: id(9998) };
  f.source.rows.push(duplicate);
  await rejects("duplicate_athlete_round_requires_review", reserveReviewedRewardAllocation(f.session, reserveInput(f), h.rpc));
  assert.equal(h.allocation, undefined);
  f.review.adjudications.push({ roundId: duplicate.roundId, athleteId: duplicate.canonicalAthleteId,
    sourceIds: [f.source.rows[0].id, duplicate.id], selectedSourceId: f.source.rows[0].id, approvalId: "synthetic-duplicate-review" });
  await reserveReviewedRewardAllocation(f.session, reserveInput(f), h.rpc);
  assert.equal(h.allocation.selectedSourceIds.length, 30);
  assert.ok(h.allocation.calculation.excludedSourceIds.includes(duplicate.id));
});

test("changed source or superseded review between read and write fails closed without local retry/rewrite", async () => {
  for (const code of ["reward_review_source_changed", "reward_review_superseded", "reward_operator_permission_required"]) {
    const f = calculationFixture(); const h = harness(f); let writes = 0;
    await rejects(code, reserveReviewedRewardAllocation(f.session, reserveInput(f), async (name, args) => {
      if (name === "service_reserve_reward_allocation") { writes++; return { data: null, error: { message: code } }; }
      return h.rpc(name, args);
    }));
    assert.equal(writes, 1); assert.equal(h.allocation, undefined);
  }
});

test("empty fully reviewed race preserves the whole configured pot and does not invent recipients", async () => {
  const f = calculationFixture(); f.source.rows = [];
  f.review.roundReviews[0].memberships = []; f.review.roundReviews[0].podiums.forEach((podium) => { podium.entries = []; });
  const h = harness(f); const reserved = await reserveReviewedRewardAllocation(f.session, reserveInput(f), h.rpc);
  assert.equal(reserved.allocatedWei, 0n); assert.equal(reserved.unallocatedWei, BigInt(f.context.campaign.budgetWei));
  assert.deepEqual(h.allocation.entitlements, []); assert.deepEqual(h.allocation.selectedSourceIds, []);
});
