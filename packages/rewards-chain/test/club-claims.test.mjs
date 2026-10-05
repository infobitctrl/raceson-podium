import assert from "node:assert/strict";
import test from "node:test";
import { getContractAddress, keccak256, toHex } from "viem";
import { normalizeRewardAthleteClaimExpectation, normalizeRewardClubClaimExpectation } from "../dist/index.js";
import { proposalFor, leagueResult, h } from "./fixtures.mjs";
import { clubSafeDeploymentFixture } from "./club-safe-deployment-fixture.mjs";

function fixture(league = false) {
  const safe = clubSafeDeploymentFixture(), upload = proposalFor(league ? leagueResult() : undefined);
  const operatorAddress = toHex(999n, { size: 20 });
  return { upload, entitlementId: upload.awards.find(a => a.beneficiaryKind === 1).entitlementId,
    recipient: safe.input.safe.context.verifyingContract, treasury: safe.input,
    deployment: { context: { environment: "local-simulation", chainId: 31337, verifyingContract: getContractAddress({ from: operatorAddress, nonce: 0n }) },
      operatorAddress, treasuryAddress: toHex(998n, { size: 20 }), programmeId: upload.programmeId, campaignId: upload.campaignId,
      programmeManifestHash: upload.programmeManifestHash, enabledPot: upload.enabledPot, deploymentNonce: 0n, deploymentTransactionHash: h("club-campaign") },
    review: { reviewedBlock: safe.at, deploymentBlock: safe.deployment, initializerHash: keccak256(safe.initializer) } };
}
test("club claim normalization binds either complete pot to its exact Safe and copies review anchors", () => {
  for (const league of [false, true]) {
    const input = fixture(league), copy = normalizeRewardClubClaimExpectation(input);
    assert.equal(copy.award.beneficiaryKind, 1); assert.equal(copy.upload.enabledPot, league ? 1 : 0);
    assert.equal(copy.recipient, copy.treasury.safe.context.verifyingContract);
    input.review.reviewedBlock.number++; input.treasury.safe.owners.reverse(); input.upload.awards[0].amount++;
    assert.equal(copy.review.reviewedBlock.number, 100n);
    assert.notDeepEqual(copy.upload.awards, input.upload.awards);
    assert.notDeepEqual(copy.treasury.safe.owners, input.treasury.safe.owners);
  }
});
test("club and athlete entry points reject the other beneficiary kind without widening EOA policy", () => {
  const input = fixture();
  assert.throws(() => normalizeRewardAthleteClaimExpectation(input), { code: "reward_athlete_claim_required" });
  input.entitlementId = input.upload.awards.find(a => a.beneficiaryKind === 0).entitlementId;
  assert.throws(() => normalizeRewardClubClaimExpectation(input), { code: "reward_club_claim_required" });
});
test("club normalization rejects changed award/package, network, destination and inconsistent review anchors", () => {
  for (const change of [e => e.upload.awards[0].amount++, e => e.upload.budgets[e.upload.enabledPot]++,
    e => { e.entitlementId = h("missing"); }, e => { e.deployment.campaignId = h("foreign"); },
    e => { e.recipient = e.deployment.treasuryAddress; }, e => { e.treasury.safe.context.chainId = 143; },
    e => { e.treasury.safe.context = { ...e.treasury.safe.context, chainId: 10143, environment: "monad-testnet" }; },
    e => { e.treasury.factoryAddress = e.treasury.safe.singletonAddress; },
    e => { e.review.deploymentBlock.number = 0n; }, e => { e.review.reviewedBlock.number = 49n; },
    e => { e.review.deploymentBlock.timestamp = e.review.reviewedBlock.timestamp + 1n; },
    e => { e.review.reviewedBlock = { ...e.review.deploymentBlock, hash: h("other fork") }; },
    e => { e.review.initializerHash = "0x"; }, e => { e.review.reviewedBlock.timestamp = 1000; }]) {
    const input = fixture(); change(input); assert.throws(() => normalizeRewardClubClaimExpectation(input));
  }
});
