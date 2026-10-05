import assert from "node:assert/strict";
import test from "node:test";
import { rewardClaimDigestsV2, rewardClaimMessagesV2, requireRewardReviewClockV2 } from "../dist/campaign-v2.js";
import { rewardClaimDigests } from "../dist/claims.js";
const hash = n => `0x${n.repeat(64)}`;
const context = { environment: 'monad-testnet', chainId: 10143, verifyingContract: '0x1111111111111111111111111111111111111111' };
const claim = { entitlementId: hash('1'), recipient: '0x2222222222222222222222222222222222222222', amount: 1n, pot: 'race', nonce: 0n, issuedAt: 100n, expiresAt: 200n, allocationDigest: hash('2') };
test('v2 signatures use a separate domain and retain exact recipient/amount/expiry validation', () => {
  const messages = rewardClaimMessagesV2(context, claim), digests = rewardClaimDigestsV2(context, claim);
  assert.equal(messages.consent.domain.version, '3'); assert.equal(messages.consent.message.amount, 1n);
  assert.notEqual(digests.consent, rewardClaimDigests(context, claim).consent);
  assert.notEqual(digests.authorization, rewardClaimDigests(context, claim).authorization);
  assert.throws(() => rewardClaimMessagesV2({ ...context, chainId: 143 }, claim));
  assert.throws(() => rewardClaimMessagesV2(context, { ...claim, amount: 0n }));
  assert.throws(() => rewardClaimMessagesV2(context, { ...claim, expiresAt: 100000n }));
});
test('only the exact staged block starts one 86400 second review; no historical credit or second wait', () => {
  const input = { protocolVersion: 2n, period: 86400n, reviewStartedAt: 1000000n, stageBlockTimestamp: 1000000n, activationNotBefore: 1086400n, latestPublicationAt: 1n };
  assert.deepEqual(requireRewardReviewClockV2(input), { reviewStartedAt: 1000000n, activationNotBefore: 1086400n });
  for (const change of [{ protocolVersion: 1n }, { period: 259200n }, { reviewStartedAt: 1n }, { activationNotBefore: 1172800n }, { latestPublicationAt: 1000001n }])
    assert.throws(() => requireRewardReviewClockV2({ ...input, ...change }));
});
