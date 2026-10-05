import assert from "node:assert/strict";
import test from "node:test";
import { getContractAddress, keccak256, toHex } from "viem";
import { normalizeRewardClubPaymentPlan, encodeRewardClubPayment, verifySignedRewardClubPayment } from "../dist/index.js";
import { clubSafeDeploymentFixture } from "./club-safe-deployment-fixture.mjs";
import { proposalFor, leagueResult, h } from "./fixtures.mjs";

function fixture(league = false) {
  const safe = clubSafeDeploymentFixture(), upload = proposalFor(league ? leagueResult() : undefined), operatorAddress = toHex(999n, { size: 20 });
  const award = upload.awards.find(a => a.beneficiaryKind === 1);
  const expected = { upload, entitlementId: award.entitlementId, recipient: safe.input.safe.context.verifyingContract, treasury: safe.input,
    deployment: { context: { environment: "local-simulation", chainId: 31337, verifyingContract: getContractAddress({ from: operatorAddress, nonce: 0n }) },
      operatorAddress, treasuryAddress: toHex(998n, { size: 20 }), programmeId: upload.programmeId, campaignId: upload.campaignId,
      programmeManifestHash: upload.programmeManifestHash, enabledPot: upload.enabledPot, deploymentNonce: 0n, deploymentTransactionHash: h("club-payment-campaign") },
    review: { reviewedBlock: safe.at, deploymentBlock: safe.deployment, initializerHash: keccak256(safe.initializer) } };
  // Shape-only signatures. Positive cryptographic checks use the real owned
  // chain and actual original Safe, not this structural fixture.
  return { expected, claim: { entitlementId: award.entitlementId, recipient: expected.recipient, amount: award.amount, pot: league ? "league" : "race",
    nonce: 7n, issuedAt: safe.at.timestamp, expiresAt: safe.at.timestamp + 86400n, allocationDigest: upload.allocationDigest },
    proofs: { operator: `0x${"11".repeat(65)}`, recipient: `0x${"22".repeat(130)}` },
    relayerAddress: toHex(997n, { size: 20 }), nonce: 0n, consentCheckpoint: { ...safe.at } };
}
test("club payment plans bind exact kind-1 race/league amounts, nonces and the historical Safe checkpoint", () => {
  for (const league of [false, true]) {
    const p = fixture(league), result = normalizeRewardClubPaymentPlan(p), encoded = encodeRewardClubPayment(p);
    assert.equal(result.expected.award.beneficiaryKind, 1); assert.equal(result.claim.pot, league ? "league" : "race");
    assert.equal(result.claim.nonce, 7n); assert.equal(result.nonce, 0n); assert.equal(encoded.value, 0n); assert.equal(encoded.nonce, 0);
    p.expected.upload.awards[0].amount++; p.expected.treasury.safe.owners.reverse(); p.consentCheckpoint.number++; p.claim.amount++;
    assert.equal(result.consentCheckpoint.number, 100n); assert.notDeepEqual(result.expected.upload.awards, p.expected.upload.awards);
    assert.notDeepEqual(result.expected.treasury.safe.owners, p.expected.treasury.safe.owners);
  }
});
test("club normalization refuses wrong kind, changed economics, gas-payer reuse and fabricated consent time", () => {
  for (const mutate of [p => { p.claim.amount++; }, p => { p.claim.nonce = (1n << 256n) - 1n; }, p => { p.claim.pot = "league"; },
    p => { p.claim.allocationDigest = h("changed"); }, p => { p.expected.upload.awards[0].amount++; },
    p => { p.expected.entitlementId = p.expected.upload.awards.find(a => a.beneficiaryKind === 0).entitlementId; },
    p => { p.relayerAddress = p.expected.recipient; }, p => { p.relayerAddress = p.expected.deployment.operatorAddress; },
    p => { p.relayerAddress = p.expected.deployment.treasuryAddress; }, p => { p.relayerAddress = p.expected.deployment.context.verifyingContract; },
    p => { p.nonce = 9007199254740992n; }, p => { p.expected.treasury.safe.context.chainId = 143; },
    p => { p.consentCheckpoint = { ...p.consentCheckpoint, hash: h("other fork") }; }, p => { p.consentCheckpoint.number--; },
    p => { p.consentCheckpoint.timestamp = p.claim.expiresAt; }, p => { p.proofs.operator = p.proofs.recipient; },
    p => { p.proofs.recipient = `0x${"22".repeat(8193)}`; }]) {
    const p = fixture(); mutate(p); assert.throws(() => normalizeRewardClubPaymentPlan(p));
  }
  assert.equal(normalizeRewardClubPaymentPlan({ ...fixture(), proofs: { ...fixture().proofs, recipient: `0x${"22".repeat(8192)}` } }).proofs.recipient.length, 16386);
});
test("malformed and oversized signed club envelopes fail before any provider read", async () => {
  let calls = 0; const reader = { getChainId: async () => { calls++; throw Error("Unexpected provider request"); } };
  for (const raw of [null, "0x", "0x02", "0x020", "0x02zz", `0x02${"ab".repeat(12289)}`])
    await assert.rejects(verifySignedRewardClubPayment(reader, fixture(), raw), { code: "invalid_reward_signed_payment" });
  assert.equal(calls, 0);
});
