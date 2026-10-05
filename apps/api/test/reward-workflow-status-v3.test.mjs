import assert from 'node:assert/strict';
import test from 'node:test';
import { projectWorkflowStatusV3, readWorkflowStatusV3, sameWorkflowClaimV3 } from '../dist/features/rewards/workflow-status-v3-service.js';
import { dispatchWorkflowV3 } from '../dist/routes/rewards/workflow-v3.js';
const id = n => `a1200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = n => '0x' + n.repeat(64);
const scope = { chainId: 31337, uploadId: id(1), destinationId: id(2), entitlementId: hash('a'), claimId: id(3), role: 'recipient' };
const actor = { userId: id(4), sessionId: id(5) };
// These deliberately minimized facts test only projection, not RPC/cryptographic
// decoding. Real SQL scenarios exercise full context and current-session checks.
function fixture(slot = 1) {
  const claim = { intent: { ...scope, id: scope.claimId, reviewId: id(6), recipientAddress: '0x' + 'b'.repeat(40), witness: { amountWei: 1000000000000000001n },
    sourceGuardHash: 'c'.repeat(64), profileFingerprint: 'd'.repeat(64), issuedAt: 1000n, expiresAt: 2000n },
    readiness: { state: 'reviewed', review: { id: id(6) }, source: { current: true, sourceGuardHash: 'c'.repeat(64), slot }, profileFingerprint: 'd'.repeat(64) },
    proofs: [{ role: 'recipient', proof: { signature: 'never expose' } }, { role: 'operator', proof: { signature: 'never expose' } }] };
  const payment = { ...scope, amountWei: '1000000000000000001', recipientAddress: claim.intent.recipientAddress, paymentId: id(7),
    state: 'confirmed', confirmed: true, transactionHash: hash('e'), blockNumber: '500', blockHash: hash('f'), readinessHeld: false };
  return { claim, payment };
}
test('all six pots retain exact paid receipts separately from present eligibility and wallet balance', () => {
  for (let slot = 1; slot <= 6; slot++) {
    const { claim, payment } = fixture(slot), view = projectWorkflowStatusV3(claim, payment);
    assert.equal(view.payment.verified, true); assert.equal(view.receipt.amountWei, '1000000000000000001');
    assert.equal(view.eligibility.state, 'not_observed'); assert.equal(view.eligibility.claimable, false);
    assert.doesNotMatch(JSON.stringify(view), /signature|never expose|balance|sessionId|leaseToken/);
  }
});
test('withdrawn/revoked destinations, changed results and profiles hold new claims without erasing paid history', () => {
  for (const state of ['request_withdrawn', 'revoked', 'source_hold', 'profile_changed', 'identity_hold', 'age_hold', 'unreviewed']) {
    const { claim, payment } = fixture(); claim.readiness.state = state; payment.readinessHeld = true;
    if (state === 'source_hold') claim.readiness.source.current = false;
    if (state === 'profile_changed') claim.readiness.profileFingerprint = 'f'.repeat(64);
    const v = projectWorkflowStatusV3(claim, payment);
    assert.equal(v.readiness.current, false); assert.ok(v.eligibility.holds.includes('readiness_review_required'));
    assert.equal(v.receipt.transactionHash, payment.transactionHash); assert.equal(v.payment.verified, true);
    if (state === 'source_hold') assert.equal(v.allocation.sourceCurrent, false);
  }
});
test('consent, approval, signed attempt and submission never masquerade as payment', () => {
  for (const state of ['not_prepared', 'prepared', 'signed', 'queued', 'leased', 'broadcasting', 'submitted']) {
    const { claim, payment } = fixture(); Object.assign(payment, { state, confirmed: false, blockNumber: null, blockHash: null });
    claim.proofs = []; const v = projectWorkflowStatusV3(claim, payment);
    assert.equal(v.receipt, null); assert.equal(v.payment.verified, false); assert.equal(v.payment.submitted, state === 'submitted');
    assert.deepEqual(v.eligibility.holds, ['recipient_consent_required', 'operator_approval_required']);
    claim.proofs = [{ role: 'recipient' }]; assert.equal(projectWorkflowStatusV3(claim, payment).consent.operatorRecorded, false);
  }
});
test('mismatched amount/destination/award/claim fails closed rather than joining competing histories', () => {
  const { claim, payment } = fixture();
  for (const patch of [{ amountWei: '1' }, { destinationId: id(88) }, { recipientAddress: '0x' + 'c'.repeat(40) },
    { claimId: id(88) }, { uploadId: id(88) }, { entitlementId: hash('b') }, { chainId: 10143 }])
    assert.throws(() => projectWorkflowStatusV3(claim, { ...payment, ...patch }), /status_changed/);
});
test('unknown and failed repository reads never return an empty or claimable status', async () => {
  for (const rpc of [async () => { throw Error('secret provider failure'); }, async () => ({ data: null, error: null }),
    async () => ({ data: null, error: { message: 'reward_account_session_required' } })])
    await assert.rejects(readWorkflowStatusV3(actor, scope, { rpc }));
});
test('status endpoint derives exact recipient scope and returns 401/404/503 without data on failure', async () => {
  const url = `/api/v1/athlete/rewards/uploads/${scope.uploadId}/destinations/${scope.destinationId}/awards/${scope.entitlementId}/claims/${scope.claimId}/workflow-status`;
  for (const [message, expected] of [['reward_account_session_required', 401], ['reward_claim_scope_required', 404], ['private SQL witness', 503]]) {
    let seen; const r = {};
    await dispatchWorkflowV3({ method: 'GET' }, r, new URL(url, 'http://127.0.0.1:3101'), {
      config: () => ({ chainId: 31337, origin: 'http://127.0.0.1:3101' }), requireIdentity: async () => actor,
      readJsonBody: () => assert.fail('read-only'), applyPrivateSessionHeaders: () => {},
      rpc: async (method, args) => { seen = args; return { data: null, error: { message } }; },
      sendSuccess: () => assert.fail('failed read cannot succeed'), sendError: (_, status, code) => Object.assign(r, { status, code }),
    });
    assert.equal(r.status, expected); assert.equal(seen.p_role, 'recipient'); assert.equal(seen.p_actor_user_id, actor.userId);
    assert.doesNotMatch(JSON.stringify(r), /private SQL witness/);
  }
});


test('status consistency ignores only the fresh observation clock, retaining proof/source/expiry checks', () => {
  const { claim } = fixture(); claim.readiness.challenge = { checkedAt: '2026-09-14T00:00:00Z', expiresAt: '2026-09-14T00:10:00Z', proof: { proofId: id(9) } };
  const fresh = structuredClone(claim); fresh.readiness.challenge.checkedAt = '2026-09-14T00:00:01Z';
  assert.equal(sameWorkflowClaimV3(claim, fresh), true);
  for (const change of [c => c.intent.expiresAt++, c => c.readiness.challenge.expiresAt = '2026-09-14T00:11:00Z',
    c => c.readiness.challenge.proof.proofId = id(10), c => c.readiness.source.sourceGuardHash = 'f'.repeat(64),
    c => c.readiness.state = 'revoked', c => c.readiness.profileFingerprint = 'f'.repeat(64),
    c => c.intent.recipientAddress = '0x' + 'f'.repeat(40)]) {
    const changed = structuredClone(fresh); change(changed); assert.equal(sameWorkflowClaimV3(claim, changed), false);
  }
});
