import assert from "node:assert/strict";
import test from "node:test";
import { copyRewardLedgerDocument as copy, decodeRewardClubClaimWitness, decodeRewardClubClaimIntent,
  readRewardClubClaimContext, storeRewardClubClaimIntent } from "../../../packages/db/dist/rewards/index.js";
import { prepareClubRewardClaim } from "../dist/features/rewards/club-claim-service.js";
import { proposalFor, h } from "../../../packages/rewards-chain/test/fixtures.mjs";
import { rewardCampaignBuild } from "../../../packages/rewards-chain/dist/index.js";
import { clubReviewFixture, clubReviewId as id } from "./fixtures/reward-club-review.mjs";

// Synthetic structural documents only, not mined/reviewed claim evidence.
function witness() {
  const e = clubReviewFixture().review.evidence, u = proposalFor(), award = u.awards.find(a => a.beneficiaryKind === 1);
  const finalizedBlock = { number: 200n, hash: h("club claim block"), timestamp: 1801000000n };
  return copy({ deployment: { schemaVersion: 1, chainId: 31337, contractAddress: `0x${"ab".repeat(20)}`, buildId: rewardCampaignBuild.id,
    creationCodeHash: rewardCampaignBuild.creationCodeHash, runtimeCodeHash: h("synthetic runtime"), deploymentTransactionHash: h("synthetic deployment"),
    deploymentNonce: 1n, deploymentBlockNumber: 1n, deploymentBlockHash: h("deployment block") },
    observation: { schemaVersion: 1, finalizedBlock, accounting: { state: 3, paused: false, accountedFunding: u.budgets[0], treasuryReturned: 0n,
      budgets: u.budgets, allocated: u.allocated, paid: [0n, 0n], nativeBalance: u.budgets[0], entitlementCount: u.entitlementCount,
      uploadDigest: u.uploadDigest, snapshotDigest: u.snapshotDigest, allocationDigest: u.allocationDigest,
      activationNotBefore: u.latestPublicationAt + 259200n, claimDeadline: 1801000000n + 31536000n, pausedAt: 0n } },
    award: { ...award, nonce: 0n, paid: false }, recipient: e.candidate.safeAddress,
    treasury: { schemaVersion: 1, buildId: "safe-1.4.1-original-2-of-3-v1", provenanceId: "safe-1.4.1-original-direct-initialization-v1",
      scope: "initialization_only", executionHistoryReviewRequired: true, ...e.candidate, factoryAddress: e.factoryAddress,
      deploymentTransactionHash: e.deploymentTransactionHash, initializerHash: e.initializerHash, deploymentBlock: e.deploymentBlock,
      reviewedBlock: e.reviewedBlock, finalizedBlock, executionNonce: 0n } });
}
test("club witness decoder retains exact integer amounts, Safe anchors and explicit human-review limitation", () => {
  const raw = witness(), parsed = decodeRewardClubClaimWitness(raw);
  assert.equal(parsed.award.beneficiaryKind, 1); assert.equal(parsed.award.amount, BigInt(raw.award.amount));
  assert.equal(parsed.treasury.executionHistoryReviewRequired, true); assert.equal(parsed.treasury.executionNonce, 0n);
  raw.treasury.owners.reverse(); assert.notDeepEqual(parsed.treasury.owners, raw.treasury.owners);
});
test("club witness decoder rejects EOA-kind substitution, malformed amounts, conflicting checkpoints and weakened Safe metadata", () => {
  for (const change of [w => { w.award.beneficiaryKind = 0; }, w => { w.award.amount = 1; }, w => { w.award.paid = true; },
    w => { w.award.nonce = ((1n << 256n) - 1n).toString(); }, w => { w.deployment.chainId = 143; }, w => { w.privateData = true; },
    w => { w.recipient = `0x${"cd".repeat(20)}`; }, w => { w.observation.accounting.paused = true; },
    w => { w.treasury.owners[0] = w.treasury.owners[1]; }, w => { w.treasury.scope = "fully_verified"; },
    w => { w.treasury.executionHistoryReviewRequired = false; }, w => { w.treasury.finalizedBlock.hash = h("fork"); },
    w => { w.treasury.executionNonce = "-1"; }, w => { w.treasury.reviewedBlock.number = "201"; }]) {
    const raw = witness(); change(raw); assert.throws(() => decodeRewardClubClaimWitness(raw));
  }
});
test("club intent decoder freezes a maximum 24-hour window for the same treasury and nonce", () => {
  const w = witness(), i = { intentId: id(1), campaignId: id(2), entitlementId: id(3), treasuryReviewId: id(4), uploadId: id(5), clubId: id(6),
    recipientUserId: id(7), recipientAddress: w.recipient, nonce: "0", issuedAt: "1801000000", expiresAt: "1801086400",
    preparedByUserId: id(8), preparedSessionId: id(9), preparedAt: "2026-09-09T04:00:00Z", idempotencyKey: "synthetic-club-intent", chainWitness: w };
  assert.equal(decodeRewardClubClaimIntent(i).expiresAt, 1801086400n);
  for (const patch of [{ expiresAt: "1801086401" }, { nonce: "1" }, { issuedAt: "1801000001" }, { recipientAddress: `0x${"ef".repeat(20)}` },
    { treasuryReviewId: "invalid" }, { extra: true }]) assert.throws(() => decodeRewardClubClaimIntent({ ...i, ...patch }));
});
test("club preparation rejects malformed scope before any RPC or chain construction", async () => {
  let calls = 0; const rpc = async () => { calls++; throw Error("Must not read"); }, identity = { userId: id(1), sessionId: id(2) };
  const input = { reviewId: id(3), entitlementId: id(4), idempotencyKey: "valid-claim-key" };
  await assert.rejects(readRewardClubClaimContext({ ...identity, sessionId: "invalid" }, input, rpc));
  await assert.rejects(storeRewardClubClaimIntent(identity, { ...input, witness: {}, observedAt: "2026-09-09T04:00:00Z" }, rpc));
  await assert.rejects(prepareClubRewardClaim(identity, { ...input, idempotencyKey: "tiny" }, { chainId: 31337, rpc, reader: () => { calls++; }, creationCode: "0x" }));
  assert.equal(calls, 0);
});
test("club context freezes operator/session/award scope and sanitizes private transport diagnostics", async () => {
  const identity = { userId: id(1), sessionId: id(2) }, input = { reviewId: id(3), entitlementId: id(4), idempotencyKey: "valid-claim-key" };
  let sent; const pending = readRewardClubClaimContext(identity, input, async (name, args) => {
    assert.equal(name, "service_read_reward_club_claim_context"); sent = args; await Promise.resolve(); return { data: null, error: { message: "reward_account_session_required" } };
  });
  identity.userId = id(20); input.entitlementId = id(21);
  await assert.rejects(pending, { code: "reward_account_session_required" });
  assert.equal(sent.p_actor_user_id, id(1)); assert.equal(sent.p_entitlement_id, id(4));
  await assert.rejects(readRewardClubClaimContext(identity, input, async () => ({ data: null, error: { message: "private SQL data" } })), { code: "reward_ledger_store_failed" });
  await assert.rejects(readRewardClubClaimContext(identity, input, async () => { throw Error("secret RPC detail"); }), { code: "reward_ledger_unavailable" });
});
