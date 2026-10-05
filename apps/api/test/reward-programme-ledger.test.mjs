import assert from "node:assert/strict";
import test from "node:test";
import { createRewardProgramme, recordRewardSportingReview, reserveRewardAllocation, RewardLedgerStoreError } from "../../../packages/db/dist/rewards/programme-ledger.js";
import { calculateLeagueRewards, splitRewardProgramme } from "../../../packages/domain/dist/rewards/index.js";
import { decodeRewardConfiguration } from "../../../packages/db/dist/rewards/stored-documents.js";
import { calculationFixture } from "./fixtures/reward-calculation.mjs";
const id = (n) => `77000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const rejectsCode = (code, operation) => assert.rejects(operation, (error) => error instanceof RewardLedgerStoreError && error.code === code);
const request = () => ({ actorUserId: id(1), operatorUserId: id(2), environment: "testnet_pilot", idempotencyKey: "programme-01",
  budgetWei: 100000000000000000001n, operatorAddress: `0x${"a".repeat(40)}`, treasuryAddress: `0x${"b".repeat(40)}`, manifestHash: hash(1),
  configuration: { ...decodeRewardConfiguration(calculationFixture().configuration), organizationId: id(3), leagueId: id(4), seasonId: id(5) },
});
function responseFor(args) {
  const p = args.p_request; const split = splitRewardProgramme(BigInt(p.budgetWei), p.roundIds);
  return { programmeId: id(1000), onChainId: hash(1000), budgetWei: p.budgetWei,
    campaigns: [...split.rounds.map((round, i) => ({ id: id(1100+i), onChainId: hash(1100+i), scopeKey: round.key,
      pot: "race", roundIds: [round.key], budgetWei: round.amount.toString() })),
    { id: id(1105), onChainId: hash(1105), scopeKey: "rounds-1-5", pot: "league", roundIds: p.roundIds, budgetWei: split.leagueBudget.toString() }] };
}
test("programme repository uses one RPC, exact integer budgets and disjoint network namespaces", async () => {
  const input = request(); let calls = 0;
  const result = await createRewardProgramme(input, async (name, args) => {
    calls++; assert.equal(name, "service_create_reward_programme"); assert.equal(args.p_request.chainId, 10143);
    assert.equal(args.p_actor_user_id, input.actorUserId); assert.equal(args.p_request.budgetWei, input.budgetWei.toString());
    assert.equal(args.p_request.environment, "testnet_pilot"); return { data: responseFor(args), error: null };
  });
  assert.equal(calls, 1); assert.equal(result.campaigns.reduce((sum, c) => sum + c.budgetWei, 0n), input.budgetWei);
  input.environment = "local_simulation";
  await createRewardProgramme(input, async (_name, args) => { assert.equal(args.p_request.chainId, 31337); return { data: responseFor(args), error: null }; });
});
test("programme response cannot omit a campaign, alter a pot/budget, or reuse an opaque ID", async () => {
  for (const change of [
    (r) => r.campaigns.pop(), (r) => { r.campaigns[0].budgetWei = "1"; },
    (r) => { r.campaigns[0].pot = "league"; }, (r) => { r.campaigns[0].onChainId = r.onChainId; },
    (r) => { r.campaigns[1].scopeKey = r.campaigns[0].scopeKey; },
  ]) await rejectsCode("invalid_reward_ledger_response", () => createRewardProgramme(request(), async (_name, args) => {
    const response = responseFor(args); change(response); return { data: response, error: null };
  }));
});
test("programme request and expected scope stay fixed while the RPC is pending", async () => {
  const input = request(); const budget = input.budgetWei;
  const result = await createRewardProgramme(input, async (_name, args) => {
    input.configuration.rounds.length = 0; input.configuration.seasonId = id(999); input.budgetWei = 999n;
    assert.equal(args.p_request.configuration.rounds.length, 5); assert.equal(args.p_request.configuration.seasonId, id(5));
    return { data: responseFor(args), error: null };
  });
  assert.equal(result.budgetWei, budget);
});
test("unsafe/private document serializers and invalid network input never reach the RPC", async () => {
  for (const change of [
    (r) => { r.environment = "mainnet"; }, (r) => { r.budgetWei = 0n; }, (r) => { r.manifestHash = hash(0); },
    (r) => { r.configuration.extra = undefined; }, (r) => { r.configuration.extra = new Date(); },
    (r) => { r.configuration.extra = 1.1; }, (r) => { r.configuration.extra = r.configuration; },
    (r) => { Object.defineProperty(r.configuration, "extra", { get() { throw new Error("getter executed"); }, enumerable: true }); },
  ]) {
    const input = request(); change(input); let called = false;
    await rejectsCode("invalid_reward_ledger_input", () => createRewardProgramme(input, async () => { called = true; return { data: null, error: null }; }));
    assert.equal(called, false);
  }
});
test("an incomplete frozen sporting configuration is rejected before creating an immutable programme", async () => {
  const input = request(); input.configuration.rounds[0].races = []; let calls = 0;
  await rejectsCode("invalid_reward_programme_configuration", () => createRewardProgramme(input, async () => { calls++; }));
  assert.equal(calls, 0);
});
const reviewRequest = () => ({ campaignId: id(20), snapshotId: id(21), actorUserId: id(1), idempotencyKey: "review-01",
  review: { schemaVersion: 1, adjudications: [], roundReviews: [] } });
test("review recording preserves snapshot/campaign identity and an immutable version response", async () => {
  const input = reviewRequest();
  const result = await recordRewardSportingReview(input, async (name, args) => {
    assert.equal(name, "service_record_reward_sporting_review"); assert.deepEqual(args.p_review, input.review);
    return { data: { reviewId: id(22), campaignId: args.p_campaign_id, snapshotId: args.p_source_snapshot_id,
      revision: 2, reviewedAt: "2026-09-08T00:00:00Z" }, error: null };
  }); assert.equal(result.revision, 2);
  await rejectsCode("invalid_reward_ledger_response", () => recordRewardSportingReview(input, async () => ({ data: {
    reviewId: id(22), campaignId: id(99), snapshotId: id(21), revision: 1, reviewedAt: "2026-09-08T00:00:00Z",
  }, error: null })));
});
function allocationRequest() {
  const sourceId = id(30);
  const result = calculateLeagueRewards({ programmeId: id(1000), scopeId: "rounds-1-5", roundIds: [id(101)], budgetWei: 40000n,
    finishes: [{ sourceId, publicationId: id(31), roundId: id(101), raceId: id(32), athleteId: id(33), representedClubId: id(34),
      gender: "M", classificationIds: [], courseComparisonKey: "course-1", distanceMetres: 5470n, finishTimeMs: 123456n,
      clubPoints: 100n, participationStatus: "finished", resultStatus: "official" }] });
  return { reviewId: id(22), actorUserId: id(1), idempotencyKey: "reserve-01", result, selectedSourceIds: [sourceId] };
}
test("allocation repository aggregates calculated entitlements and copies every explanation exactly", async () => {
  const input = allocationRequest(); const original = structuredClone(input); let calls = 0;
  const result = await reserveRewardAllocation(input, async (name, args) => {
    calls++; assert.equal(name, "service_reserve_reward_allocation"); const payload = args.p_allocation;
    assert.equal(payload.programmeId, id(1000)); assert.equal(payload.pot, "league"); assert.equal(payload.budgetWei, "40000");
    assert.equal(payload.entitlements.length, 2); assert.deepEqual(payload.entitlements.map((e) => e.amountWei), ["30000", "10000"]);
    assert.equal(payload.entitlements[0].explanation.breakdown[0].calculation.weight, "5470");
    assert.equal(JSON.stringify(payload).includes("wallet"), false);
    input.result.unallocatedWei = 999n;
    return { data: { allocationId: id(40), campaignId: id(20), reviewId: id(22), allocatedWei: "40000", unallocatedWei: "0",
      entitlementCount: 2, reservedAt: "2026-09-08T00:00:00Z" }, error: null };
  });
  assert.equal(calls, 1); assert.equal(result.unallocatedWei, original.result.unallocatedWei);
});
test("missing source coverage and mismatched reservation receipt cannot create a successful result", async () => {
  const input = allocationRequest(); input.selectedSourceIds = [];
  await rejectsCode("invalid_reward_ledger_input", () => reserveRewardAllocation(input));
  await rejectsCode("invalid_reward_ledger_response", () => reserveRewardAllocation(allocationRequest(), async () => ({ data: {
    allocationId: id(40), campaignId: id(20), reviewId: id(99), allocatedWei: "40000", unallocatedWei: "0", entitlementCount: 2, reservedAt: "2026-09-08T00:00:00Z",
  }, error: null })));
});
test("ledger database errors expose only stable allowlisted codes", async () => {
  await rejectsCode("reward_review_source_changed", () => recordRewardSportingReview(reviewRequest(), async () => ({ data: null,
    error: { message: "reward_review_source_changed", details: "private connection detail" } })));
  await rejectsCode("reward_ledger_store_failed", () => recordRewardSportingReview(reviewRequest(), async () => ({ data: null,
    error: { message: "password=not-a-real-password" } })));
  await rejectsCode("reward_ledger_unavailable", () => recordRewardSportingReview(reviewRequest(), async () => { throw new Error("private server detail"); }));
});
