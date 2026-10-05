import assert from "node:assert/strict";
import test from "node:test";
import { getContractAddress, keccak256, toHex } from "viem";
import { rewardProgrammeChildV3 } from "../dist/programme-v3.js";
import { rewardAllocationCommitmentV3 } from "../dist/campaign-v3.js";
import { normalizeRewardProgrammeClubClaimExpectationV3, readVerifiedRewardProgrammeClubClaimV3 } from "../dist/club-claim-reader-v3.js";
import { normalizeRewardProgrammeAthleteClaimExpectationV3 } from "../dist/claim-reader-v3.js";
import { normalizeRewardProgrammeClubPaymentV3, encodeRewardProgrammeClubPaymentV3,
  verifySignedRewardProgrammeClubPaymentV3 } from "../dist/programme-club-payments-v3.js";
import { clubSafeDeploymentFixture } from "./club-safe-deployment-fixture.mjs";

const h = n => toHex(BigInt(n), { size: 32 }), a = n => toHex(BigInt(n), { size: 20 });
function fixture(slot = 0) {
  const safe = clubSafeDeploymentFixture(), operatorAddress = a(990);
  const programme = { context: { environment: "local-simulation", chainId: 31337,
    verifyingContract: getContractAddress({ from: operatorAddress, nonce: 3n }) },
    operatorAddress, funderAddress: a(991), programmeId: h(10), programmeManifestHash: h(11), budgetWei: 100n * 10n ** 18n,
    campaignIds: Array.from({ length: 6 }, (_, i) => h(20 + i)), reviewPeriods: [0n, 100n, 0n, 0n, 0n, 0n],
    deploymentTransactionHash: h(30), deploymentNonce: 3n };
  const child = rewardProgrammeChildV3(programme, slot);
  const upload = rewardAllocationCommitmentV3({ ...child, budget: child.budgetWei, snapshotDigest: h(31),
    reviewStartedAt: 1n, officialPublishedAt: 1n + child.reviewPeriod, publicationEvidenceHash: h(32),
    awards: [0, 1].map(kind => ({ entitlementId: h(40 + kind), beneficiaryId: h(50 + kind), amount: 1n,
      explanationHash: h(60 + kind), pot: child.enabledPot, beneficiaryKind: kind })) });
  const recipient = safe.input.safe.context.verifyingContract;
  const expectation = { protocolVersion: 3, programme, slot, upload, stageTransactionHash: h(33), entitlementId: h(41), recipient,
    treasury: safe.input, review: { reviewedBlock: safe.at, deploymentBlock: safe.deployment, initializerHash: keccak256(safe.initializer) } };
  // Shape-only placeholders. Actual signatures are tested against an original
  // Safe on an owned Anvil instance; this is not evidence of wallet control.
  return { protocolVersion: 3, expectation, claim: { entitlementId: h(41), recipient, amount: 1n,
    pot: slot === 5 ? "league" : "race", nonce: 7n, issuedAt: safe.at.timestamp, expiresAt: safe.at.timestamp + 86400n,
    allocationDigest: upload.allocationDigest }, proofs: { operator: `0x${"11".repeat(65)}`, recipient: `0x${"22".repeat(130)}` },
    relayerAddress: a(992), nonce: 0n, consentCheckpoint: { ...safe.at } };
}

test("V3 club plans derive all six exact children, preserve caps and cannot enter athlete normalization", () => {
  for (let slot = 0; slot < 6; slot++) {
    const p = fixture(slot), result = normalizeRewardProgrammeClubPaymentV3(p), encoded = encodeRewardProgrammeClubPaymentV3(p);
    const e = result.expectation;
    assert.equal(e.award.beneficiaryKind, 1); assert.equal(e.slot, slot);
    assert.equal(e.deployment.budgetWei, slot === 5 ? 50n * 10n ** 18n : 10n * 10n ** 18n);
    assert.equal(result.claim.pot, slot === 5 ? "league" : "race");
    assert.equal(encoded.to, rewardProgrammeChildV3(p.expectation.programme, slot).context.verifyingContract);
    assert.equal(encoded.value, 0n); assert.equal(result.claim.nonce, 7n); assert.equal(encoded.nonce, 0);
    assert.throws(() => normalizeRewardProgrammeAthleteClaimExpectationV3(p.expectation), { code: "reward_athlete_claim_required" });
    assert.throws(() => normalizeRewardProgrammeClubClaimExpectationV3({ ...p.expectation, entitlementId: h(40) }), { code: "reward_club_claim_required" });
    const captured = structuredClone(result);
    p.expectation.programme.campaignIds[slot] = h(99); p.expectation.upload.awards[1].amount++;
    p.expectation.treasury.safe.owners[0] = a(999); p.claim.amount++; p.consentCheckpoint.hash = h(99);
    assert.deepEqual(result, captured);
  }
});
test("V3 club plans reject protocol/slot/package substitution, stale clocks and conflated relayers", () => {
  for (const mutate of [p => p.protocolVersion = 1, p => p.expectation.protocolVersion = 2,
    p => p.expectation.upload.protocolVersion = 2, p => p.expectation.programme.context.chainId = 143,
    p => p.expectation.slot = -1, p => p.expectation.slot = 6, p => p.expectation.slot = 1.5, p => p.expectation.slot = 5,
    p => p.expectation.programme.budgetWei += 10n, p => p.expectation.programme.reviewPeriods[0] = 1n,
    p => p.expectation.upload.awards[0].amount++, p => p.expectation.upload.publicationEvidenceHash = h(99),
    p => p.claim.amount++, p => p.claim.recipient = a(999), p => p.claim.pot = "league", p => p.claim.allocationDigest = h(99),
    p => p.claim.nonce = (1n << 256n) - 1n, p => p.nonce = BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    p => p.relayerAddress = p.expectation.recipient, p => p.relayerAddress = p.expectation.programme.funderAddress,
    p => p.relayerAddress = p.expectation.programme.operatorAddress, p => p.relayerAddress = p.expectation.programme.context.verifyingContract,
    p => p.relayerAddress = rewardProgrammeChildV3(p.expectation.programme, 0).context.verifyingContract,
    p => p.expectation.treasury.safe.context.chainId = 143, p => p.expectation.treasury.safe.owners.pop(),
    p => p.consentCheckpoint.number--, p => p.consentCheckpoint.hash = h(99), p => p.consentCheckpoint.timestamp = p.claim.expiresAt,
    p => p.proofs.recipient = "0x", p => p.proofs.recipient = `0x${"22".repeat(8193)}`]) {
    const p = fixture(); mutate(p); assert.throws(() => normalizeRewardProgrammeClubPaymentV3(p), String(mutate));
  }
});
test("malformed V3 club expectations and oversized signed envelopes fail before provider IO", async () => {
  let calls = 0; const reader = { getChainId: async () => { calls++; throw Error("private-provider-credential"); } };
  for (const raw of [null, "0x", "0x02", "0x020", "0x02zz", `0x02${"ab".repeat(12289)}`])
    await assert.rejects(verifySignedRewardProgrammeClubPaymentV3(reader, fixture(), raw), { code: "invalid_reward_signed_payment" });
  await assert.rejects(readVerifiedRewardProgrammeClubClaimV3(reader, { ...fixture().expectation, protocolVersion: 1 }), { code: "wrong_reward_claim_protocol" });
  assert.equal(calls, 0);
  await assert.rejects(readVerifiedRewardProgrammeClubClaimV3(reader, fixture().expectation),
    error => error.code === "reward_programme_observation_unavailable" && !String(error).includes("credential"));
  assert.equal(calls, 1);
});
