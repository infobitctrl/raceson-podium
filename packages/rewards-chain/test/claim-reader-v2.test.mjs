import assert from "node:assert/strict";
import test from "node:test";
import { getContractAddress, toHex } from "viem";
import { rewardAllocationCommitment } from "../dist/allocation.js";
import { normalizeRewardAthleteClaimExpectationV2, readVerifiedRewardAthleteClaimV2 } from "../dist/claim-reader-v2.js";

const hash = n => toHex(BigInt(n), { size: 32 });
const operator = "0x1111111111111111111111111111111111111111";
function fixture() {
  const deployment = { context: { environment: "monad-testnet", chainId: 10143,
    verifyingContract: getContractAddress({ from: operator, nonce: 0n }) }, operatorAddress: operator,
    treasuryAddress: "0x2222222222222222222222222222222222222222", programmeId: hash(1), campaignId: hash(2),
    programmeManifestHash: hash(3), enabledPot: 0, deploymentTransactionHash: hash(4), deploymentNonce: 0n };
  const upload = rewardAllocationCommitment({ ...deployment, budget: 100n, latestPublicationAt: 100n, snapshotDigest: hash(5),
    awards: [{ entitlementId: hash(6), beneficiaryId: hash(7), pot: 0, amount: 10n, explanationHash: hash(8), beneficiaryKind: 0 },
      { entitlementId: hash(9), beneficiaryId: hash(10), pot: 0, amount: 40n, explanationHash: hash(11), beneficiaryKind: 0 }] });
  return { protocolVersion: 2, deployment, upload, stageTransactionHash: hash(12), entitlementId: hash(6),
    recipient: "0x3333333333333333333333333333333333333333" };
}
test("V2 expectation copies the complete stored package; walletless reserve is not redistributed", () => {
  const input = fixture(), normalized = normalizeRewardAthleteClaimExpectationV2(input), copy = structuredClone(normalized);
  assert.equal(normalized.protocolVersion, 2); assert.equal(normalized.award.amount, 10n);
  assert.equal(normalized.upload.allocated[0], 50n); assert.equal(normalized.upload.unallocated, 50n);
  input.upload.awards[0].amount = 999n; input.upload.budgets[0] = 999n;
  input.deployment.context.chainId = 143; input.recipient = operator;
  assert.deepEqual(normalized, copy);
});
test("V2 expectation refuses missing/legacy protocol, mainnet, club rows and altered package fields", () => {
  for (const mutate of [x => { delete x.protocolVersion; }, x => { x.protocolVersion = 1; },
    x => { x.deployment.context.chainId = 143; }, x => { x.entitlementId = hash(99); },
    x => { x.stageTransactionHash = hash(0); }, x => { x.recipient = `0x${"00".repeat(20)}`; },
    x => { x.upload.budgets = [0n, 0n]; }, x => { x.upload.enabledPot = 1; },
    x => { x.upload.awards[1].amount++; }, x => { x.upload.latestPublicationAt++; },
    x => { x.upload.allocationDigest = hash(99); }, x => { x.upload.uploadDigest = hash(99); },
    x => { x.upload.unallocated++; }, x => { x.upload.entitlementCount++; },
    x => { x.upload.allocated[0]++; }, x => { x.upload.budgets[1] = 1n; },
    x => { x.deployment.programmeId = hash(99); }, x => { x.deployment.campaignId = hash(99); },
    x => { x.deployment.programmeManifestHash = hash(99); },
    x => { x.upload = rewardAllocationCommitment({ ...x.upload, budget: 100n,
      awards: x.upload.awards.map((a, i) => i ? a : { ...a, beneficiaryKind: 1 }) }); },
  ]) { const input = fixture(); mutate(input); assert.throws(() => normalizeRewardAthleteClaimExpectationV2(input)); }
});
test("bad V2 input cannot cause RPC I/O; unexpected errors do not leak input/cause", async () => {
  let reads = 0;
  const reader = { getChainId: async () => { reads++; throw Error("private provider URL"); } };
  await assert.rejects(readVerifiedRewardAthleteClaimV2(reader, { ...fixture(), protocolVersion: 1 }, "0x01"),
    e => e.code === "wrong_reward_claim_protocol");
  await assert.rejects(readVerifiedRewardAthleteClaimV2(reader, null, "0x01"),
    e => e.code === "reward_claim_observation_unavailable" && !e.cause && !String(e).includes("private"));
  assert.equal(reads, 0);
});
