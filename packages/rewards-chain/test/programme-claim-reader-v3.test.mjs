import assert from "node:assert/strict";
import test from "node:test";
import { getContractAddress, toHex } from "viem";
import { rewardProgrammeChildV3 } from "../dist/programme-v3.js";
import { rewardAllocationCommitmentV3 } from "../dist/campaign-v3.js";
import { normalizeRewardAthleteClaimExpectationV3, normalizeRewardProgrammeAthleteClaimExpectationV3,
  readVerifiedRewardProgrammeAthleteClaimV3 } from "../dist/claim-reader-v3.js";

const hash = n => toHex(BigInt(n), { size: 32 });
const address = n => toHex(BigInt(n), { size: 20 });
function fixture(slot = 0) {
  const programme = { context: { environment: "local-simulation", chainId: 31337,
    verifyingContract: getContractAddress({ from: address(1), nonce: 3n }) }, operatorAddress: address(1), funderAddress: address(2),
    programmeId: hash(10), programmeManifestHash: hash(11), budgetWei: 100n * 10n ** 18n,
    campaignIds: Array.from({ length: 6 }, (_, i) => hash(20 + i)), reviewPeriods: [86400n, 0n, 0n, 0n, 0n, 0n],
    deploymentTransactionHash: hash(30), deploymentNonce: 3n };
  const child = rewardProgrammeChildV3(programme, slot);
  const upload = rewardAllocationCommitmentV3({ ...child, budget: child.budgetWei, snapshotDigest: hash(31),
    reviewStartedAt: 100n, officialPublishedAt: 100n + child.reviewPeriod, publicationEvidenceHash: hash(32),
    awards: [{ entitlementId: hash(40), beneficiaryId: hash(41), amount: 1n, explanationHash: hash(42), pot: child.enabledPot, beneficiaryKind: 0 }] });
  return { protocolVersion: 3, programme, slot, upload, stageTransactionHash: hash(33), entitlementId: hash(40), recipient: address(3) };
}

test("V3 programme claims derive each race/league contract and preserve full package/clock/cap", () => {
  for (let slot = 0; slot < 6; slot++) {
    const input = fixture(slot), value = normalizeRewardProgrammeAthleteClaimExpectationV3(input);
    assert.equal(value.deployment.context.verifyingContract, getContractAddress({ from: input.programme.context.verifyingContract, nonce: BigInt(slot + 1) }));
    assert.equal(value.deployment.enabledPot, slot === 5 ? 1 : 0);
    assert.equal(value.upload.budgets[value.deployment.enabledPot], value.deployment.budgetWei);
    assert.equal(value.upload.reviewPeriod, slot === 0 ? 86400n : 0n);
    assert.throws(() => normalizeRewardAthleteClaimExpectationV3({ ...input, deployment: {
      ...value.deployment, deploymentTransactionHash: input.programme.deploymentTransactionHash, deploymentNonce: input.programme.deploymentNonce,
    } }), { code: "reward_deployment_address_mismatch" });
    const before = structuredClone(value);
    input.programme.campaignIds[slot] = hash(99); input.programme.reviewPeriods[slot] = 1n;
    input.programme.context.chainId = 143; input.upload.awards[0].amount = 2n;
    assert.deepEqual(value, before, "caller mutation must not change an expectation already captured");
  }
});

test("V3 programme claim normalization rejects downgrade, wrong pot, unbound cap, changed commitments and club awards", () => {
  for (const mutate of [
    x => { x.protocolVersion = 2; }, x => { x.upload.protocolVersion = 2; },
    x => { x.slot = -1; }, x => { x.slot = 6; }, x => { x.slot = 0.5; }, x => { x.slot = 1; }, x => { x.slot = 5; },
    x => { x.programme.context.chainId = 143; }, x => { x.programme.budgetWei += 10n; },
    x => { x.programme.programmeManifestHash = hash(99); }, x => { x.programme.reviewPeriods[0] = 0n; },
    x => { x.upload.awards[0].amount = 2n; }, x => { x.upload.allocationDigest = hash(99); },
    x => { x.upload.officialPublishedAt++; }, x => { x.upload.publicationEvidenceHash = hash(99); },
    x => { x.entitlementId = hash(99); }, x => { x.recipient = address(0); },
    x => { x.upload = rewardAllocationCommitmentV3({ ...x.upload, budget: x.upload.budgets[0],
      awards: x.upload.awards.map(a => ({ ...a, beneficiaryKind: 1 })) }); },
  ]) assert.throws(() => { const input = fixture(); mutate(input); normalizeRewardProgrammeAthleteClaimExpectationV3(input); });
});

test("invalid programme claim fails before IO; unavailable provider errors do not expose endpoint credentials", async () => {
  let calls = 0;
  const reader = { getChainId: async () => { calls++; throw new Error("private-provider-credential"); } };
  await assert.rejects(readVerifiedRewardProgrammeAthleteClaimV3(reader, { ...fixture(), protocolVersion: 1 }), { code: "wrong_reward_claim_protocol" });
  assert.equal(calls, 0);
  await assert.rejects(readVerifiedRewardProgrammeAthleteClaimV3(reader, fixture()), error =>
    error.code === "reward_programme_observation_unavailable" && !JSON.stringify(error).includes("private-provider-credential"));
  assert.equal(calls, 1);
});
