import assert from "node:assert/strict";
import test from "node:test";
import { getContractAddress, toHex } from "viem";
import { rewardAllocationCommitment } from "../dist/allocation.js";
import { rewardAllocationCommitmentV3 } from "../dist/campaign-v3.js";
import { normalizeRewardAthleteClaimExpectationV3, readVerifiedRewardAthleteClaimV3 } from "../dist/claim-reader-v3.js";
import { normalizeRewardAthleteClaimExpectationV2 } from "../dist/claim-reader-v2.js";
import { normalizeRewardAthleteClaimExpectation } from "../dist/claim-reader.js";

const hash = n => toHex(BigInt(n), { size: 32 });
const operator = "0x1111111111111111111111111111111111111111";
function fixture(reviewPeriod = 86400n, enabledPot = 0) {
  const deployment = { context: { environment: "monad-testnet", chainId: 10143,
    verifyingContract: getContractAddress({ from: operator, nonce: 0n }) }, operatorAddress: operator,
    treasuryAddress: "0x2222222222222222222222222222222222222222", programmeId: hash(1), campaignId: hash(2),
    programmeManifestHash: hash(3), enabledPot, reviewPeriod, deploymentTransactionHash: hash(4), deploymentNonce: 0n };
  const upload = rewardAllocationCommitmentV3({ ...deployment, budget: 100n, snapshotDigest: hash(5),
    reviewStartedAt: 100n, officialPublishedAt: 100n + reviewPeriod, publicationEvidenceHash: hash(13),
    awards: [{ entitlementId: hash(6), beneficiaryId: hash(7), pot: enabledPot, amount: 10n, explanationHash: hash(8), beneficiaryKind: 0 },
      { entitlementId: hash(9), beneficiaryId: hash(10), pot: enabledPot, amount: 40n, explanationHash: hash(11), beneficiaryKind: 0 }] });
  return { protocolVersion: 3, deployment, upload, stageTransactionHash: hash(12), entitlementId: hash(6),
    recipient: "0x3333333333333333333333333333333333333333" };
}

test("V3 normalizes zero/custom/24h policies for race and league without changing held shares", () => {
  for (const period of [0n, 3600n, 86400n, 172800n]) for (const pot of [0, 1]) {
    const normalized = normalizeRewardAthleteClaimExpectationV3(fixture(period, pot));
    assert.equal(normalized.protocolVersion, 3); assert.equal(normalized.upload.protocolVersion, 3);
    assert.equal(normalized.upload.reviewPeriod, period); assert.equal(normalized.award.amount, 10n);
    assert.equal(normalized.upload.allocated[pot], 50n); assert.equal(normalized.upload.unallocated, 50n);
    assert.equal(normalized.upload.awards[1].amount, 40n);
  }
});
test("V3 captures caller-owned publication/package/context before asynchronous observation", () => {
  const input = fixture(), normalized = normalizeRewardAthleteClaimExpectationV3(input), copy = structuredClone(normalized);
  input.upload.awards[0].amount++; input.upload.budgets[0]++;
  input.upload.reviewStartedAt++; input.upload.publicationEvidenceHash = hash(99);
  input.deployment.context.chainId = 143; input.recipient = operator;
  assert.deepEqual(normalized, copy);
});
test("V3 refuses legacy tags and commitments, incomplete review and inconsistent stored packages", () => {
  for (const mutate of [x => { delete x.protocolVersion; }, x => { x.protocolVersion = 2; },
    x => { delete x.upload.protocolVersion; }, x => { x.upload.protocolVersion = 2; },
    x => { x.deployment.context.chainId = 143; }, x => { x.entitlementId = hash(99); },
    x => { x.stageTransactionHash = hash(0); }, x => { x.recipient = `0x${"00".repeat(20)}`; },
    x => { x.upload.budgets = [0n, 0n]; }, x => { x.upload.enabledPot = 1; },
    x => { x.upload.awards[1].amount++; }, x => { x.upload.reviewStartedAt++; },
    x => { x.upload.officialPublishedAt++; }, x => { x.upload.publicationEvidenceHash = hash(99); },
    x => { x.upload.publicationEvidenceHash = hash(0); }, x => { x.upload.reviewPeriod = 0n; },
    x => { x.deployment.reviewPeriod = 0n; }, x => { x.upload.reviewPeriod = x.deployment.reviewPeriod = 1n << 64n; },
    x => { x.upload.allocationDigest = hash(99); }, x => { x.upload.uploadDigest = hash(99); },
    x => { x.upload.unallocated++; }, x => { x.upload.entitlementCount++; },
    x => { x.upload.allocated[0]++; }, x => { x.upload.budgets[1] = 1n; },
    x => { x.deployment.programmeId = hash(99); }, x => { x.deployment.campaignId = hash(99); },
    x => { x.deployment.programmeManifestHash = hash(99); },
    x => { x.upload = rewardAllocationCommitmentV3({ ...x.upload, budget: 100n,
      awards: x.upload.awards.map((a, i) => i ? a : { ...a, beneficiaryKind: 1 }) }); },
    x => { x.upload.allocationDigest = rewardAllocationCommitment({ ...x.upload, budget: 100n,
      latestPublicationAt: x.upload.officialPublishedAt }).allocationDigest; },
  ]) { const input = fixture(); mutate(input); assert.throws(() => normalizeRewardAthleteClaimExpectationV3(input)); }
});
test("invalid V3 input fails before RPC and unexpected errors expose no provider or input details", async () => {
  let reads = 0;
  const reader = { getChainId: async () => { reads++; throw Error("private provider URL"); } };
  await assert.rejects(readVerifiedRewardAthleteClaimV3(reader, { ...fixture(), protocolVersion: 2 }, "0x01"),
    e => e.code === "wrong_reward_claim_protocol");
  await assert.rejects(readVerifiedRewardAthleteClaimV3(reader, null, "0x01"),
    e => e.code === "reward_claim_observation_unavailable" && !e.cause && !String(e).includes("private"));
  assert.equal(reads, 0);
});
test("V3 package cannot be downgraded into either historical claim reader", () => {
  const v3 = fixture();
  assert.throws(() => normalizeRewardAthleteClaimExpectation(v3));
  assert.throws(() => normalizeRewardAthleteClaimExpectationV2({ ...v3, protocolVersion: 2 }));
  // Even adding the old publication field cannot turn the V3 commitment into V1/V2.
  v3.upload.latestPublicationAt = v3.upload.officialPublishedAt;
  assert.throws(() => normalizeRewardAthleteClaimExpectation(v3));
  assert.throws(() => normalizeRewardAthleteClaimExpectationV2({ ...v3, protocolVersion: 2 }));
});
