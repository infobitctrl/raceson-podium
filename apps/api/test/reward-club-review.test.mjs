import assert from "node:assert/strict";
import test from "node:test";
import { readRewardClubReviewContext, recordRewardClubReview, decodeRewardClubReviewEvidence } from "../../../packages/db/dist/rewards/index.js";
import { reviewClubRewardTreasury, revokeClubRewardTreasuryReview } from "../dist/features/rewards/club-treasury-review-service.js";
import { clubReviewFixture, clubReviewId as id } from "./fixtures/reward-club-review.mjs";

test("private club review verifies original chain initialization at the explicit human-reviewed block before saving", async () => {
  const f = clubReviewFixture(), result = await reviewClubRewardTreasury(f.identity, f.input, f.deps);
  assert.deepEqual(result, f.review); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].name, "service_record_reward_club_review"); assert.deepEqual(f.calls[1].args.p_evidence, f.input.evidence);
  assert.ok(f.chain.calls.some(p => p.functionName === "getOwners" && p.blockNumber === 100n));
  assert.equal(f.calls[1].args.p_expected_identity_fingerprint, f.input.expectedIdentityFingerprintSha256);
  assert.equal(f.calls[0].args.p_idempotency_key, f.input.idempotencyKey);
});
test("club evidence demands the exact bounded policy, separate audit references, candidate and canonical block values", () => {
  const f = clubReviewFixture();
  for (const patch of [{ policy: "approved" }, { chainId: 143 }, { chainId: null }, { extra: true }, { authorityEvidenceRef: true },
    { executionHistoryEvidenceRef: "00000000-0000-0000-0000-000000000000" }, { factoryAddress: f.input.evidence.candidate.safeAddress },
    { reviewedBlock: { ...f.input.evidence.reviewedBlock, number: "49" } }, { reviewedBlock: { ...f.input.evidence.reviewedBlock, number: "50" } },
    { reviewedBlock: { ...f.input.evidence.reviewedBlock, timestamp: 1100 } }, { deploymentTransactionHash: `0x${"0".repeat(64)}` }]) {
    assert.throws(() => decodeRewardClubReviewEvidence({ ...f.input.evidence, ...patch }));
  }
  const getter = Object.defineProperty({ ...f.input.evidence }, "chainId", { enumerable: true, get() { throw Error("getter must not run"); } });
  assert.throws(() => decodeRewardClubReviewEvidence(getter), e => !e.message.includes("getter must not run"));
});
test("wrong network/candidate, stale owner identity/revision and withdrawn/held nominations never reach chain or storage writes", async () => {
  for (const change of [f => { f.deps.chainId = 10143; }, f => { f.input.evidence.candidate.safeAddress = `0x${"9".repeat(40)}`; },
    f => { f.input.expectedIdentityFingerprintSha256 = "b".repeat(64); }, f => { f.input.expectedRevision = 1; },
    f => { f.context.reviewState = "identity_hold"; f.context.nomination.status = "identity_hold"; },
    f => { f.context.reviewState = "request_withdrawn"; f.context.nomination.status = "withdrawn"; f.context.nomination.withdrawnAt = "2026-09-09T01:00:03Z"; }]) {
    const f = clubReviewFixture(); change(f); await assert.rejects(reviewClubRewardTreasury(f.identity, f.input, f.deps));
    assert.equal(f.chain.calls.length, 0); assert.equal(f.calls.filter(c => c.name === "service_record_reward_club_review").length, 0);
  }
});
test("bad factory/current Safe or mismatched historical initializer/block evidence cannot be persisted", async () => {
  for (const change of [f => { f.chain.reader.getCode = async () => "0x"; }, f => { f.input.evidence.initializerHash = `0x${"a".repeat(64)}`; },
    f => { f.input.evidence.deploymentBlock.hash = `0x${"a".repeat(64)}`; }, f => { f.input.evidence.reviewedBlock.hash = `0x${"a".repeat(64)}`; },
    f => { const read = f.chain.reader.readContract; f.chain.reader.readContract = p => p.functionName === "getThreshold" ? 1n : read(p); }]) {
    const f = clubReviewFixture(); change(f); await assert.rejects(reviewClubRewardTreasury(f.identity, f.input, f.deps)); assert.equal(f.calls.length, 1);
  }
});
test("an exact older retry uses original history even after later revisions and revocation, without requiring fresh archive RPC", async () => {
  const f = clubReviewFixture(); f.review.revokedAt = "2026-09-09T01:00:04Z"; f.review.revocationReason = "operator_correction";
  f.context.retryReview = structuredClone(f.review); f.context.latestReview = { ...structuredClone(f.review), reviewId: id(20), revision: 2, idempotencyKey: "later-club-review" };
  f.context.reviewState = "identity_hold"; f.context.nomination.status = "identity_hold"; f.context.identityFingerprintSha256 = "b".repeat(64);
  f.chain.reader.getChainId = async () => { throw Error("history retry must not read chain"); };
  const result = await reviewClubRewardTreasury(f.identity, f.input, f.deps); assert.equal(result.revision, 1); assert.ok(result.revokedAt);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].args.p_expected_identity_fingerprint, "a".repeat(64));
  const rpc = f.deps.rpc; f.deps.rpc = (name, args) => name === "service_record_reward_club_review"
    ? { data: null, error: { message: "reward_ledger_idempotency_conflict" } } : rpc(name, args);
  f.input.evidence.controlEvidenceRef = id(21);
  await assert.rejects(reviewClubRewardTreasury(f.identity, f.input, f.deps), { code: "reward_ledger_idempotency_conflict" });
});
test("private review decoders reject cross-programme/actor/request/candidate and inconsistent reviewed state", async () => {
  for (const change of [f => { f.context.programmeId = id(99); }, f => { f.context.operatorUserId = id(99); }, f => { f.context.nomination.requestId = id(99); },
    f => { f.context.reviewState = "reviewed"; }, f => { f.context.latestReview = { ...f.review, requestId: id(99) }; },
    f => { f.context.retryReview = f.review; }, f => { f.context.latestReview = { ...f.review, evidence: { ...f.review.evidence, chainId: 10143 } }; }]) {
    const f = clubReviewFixture(); change(f); await assert.rejects(readRewardClubReviewContext(f.identity, f.input.programmeId, f.input.requestId, f.rpc));
  }
});
test("writes freeze nested user inputs and never accept a changed stored review as a successful response", async () => {
  const f = clubReviewFixture(), original = structuredClone(f.input), read = f.deps.rpc;
  f.deps.rpc = async (name, args) => { f.input.evidence.candidate.owners[0] = `0x${"9".repeat(40)}`; f.input.evidence.controlEvidenceRef = id(90); return read(name, args); };
  const result = await reviewClubRewardTreasury(f.identity, f.input, f.deps); assert.deepEqual(result.evidence, original.evidence);
  for (const patch of [{ requestId: id(99) }, { revision: 2 }, { identityFingerprintSha256: "b".repeat(64) }, { idempotencyKey: "foreign-history-key" }]) {
    const h = clubReviewFixture(); Object.assign(h.review, patch); await assert.rejects(recordRewardClubReview(h.identity, h.input, h.rpc));
  }
});
test("revocation is explicit, session-scoped and reason-bound, without chain calls or deletion", async () => {
  const f = clubReviewFixture(), result = await revokeClubRewardTreasuryReview(f.identity,
    { programmeId: f.input.programmeId, reviewId: f.review.reviewId, reason: "wallet_history_uncertain" }, f.rpc);
  assert.equal(result.revocationReason, "wallet_history_uncertain"); assert.ok(result.revokedAt); assert.equal(f.chain.calls.length, 0);
  await assert.rejects(revokeClubRewardTreasuryReview(f.identity, { programmeId: f.input.programmeId, reviewId: f.review.reviewId, reason: "delete" }, f.rpc));
});
test("unavailable DB/chain and post-observation session revocation never leak raw diagnostics or imply a saved review", async () => {
  const f = clubReviewFixture();
  for (const rpc of [async () => { throw Error("secret-db-url"); }, async () => ({ data: null, error: { message: "secret-db-url" } })]) {
    await assert.rejects(readRewardClubReviewContext(f.identity, f.input.programmeId, f.input.requestId, rpc), e => !e.message.includes("secret"));
  }
  f.chain.reader.getTransaction = async () => { throw Error("secret-rpc-url"); };
  await assert.rejects(reviewClubRewardTreasury(f.identity, f.input, f.deps), e => e.code === "reward_club_deployment_observation_unavailable" && !e.cause);
  const h = clubReviewFixture(), read = h.deps.rpc;
  h.deps.rpc = (name, args) => name === "service_record_reward_club_review" ? { data: null, error: { message: "reward_account_session_required" } } : read(name, args);
  await assert.rejects(reviewClubRewardTreasury(h.identity, h.input, h.deps), { code: "reward_account_session_required" });
});
