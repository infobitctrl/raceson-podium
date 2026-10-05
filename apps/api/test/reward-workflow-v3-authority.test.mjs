import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWorkflowHostPolicyV3, workflowPermissionV3, createWorkflowSessionVaultV3, createWorkflowPolicyAuthorityV3 } from '../dist/features/rewards/workflow-v3-authority.js';

const id = n => `98000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const actor = { userId: id(1), sessionId: id(2) };
const target = { kind: 'programme', draftId: id(3), slot: 1, approvalId: id(4), uploadId: id(5), intentId: id(6), attemptId: id(7) };
const permit = { target, signPlanHash: hash(1), approvalPlanHash: null, transactionHash: hash(2), maxGasCostWei: '1000', maxRewardWei: '0' };
const policy = { schema: 'raceson-workflow-host-policy-v1', operatorUserId: actor.userId, draftId: target.draftId,
  durationSeconds: 60, maxGasCostWei: '1000', maxRewardWei: '0', permits: [permit] };
const noIO = () => assert.fail('Denied operation must not reach IO');

test('private policy bounds exact operator, draft, target, action hash and spending', () => {
  const p = parseWorkflowHostPolicyV3(policy);
  for (const [op, binding] of [['sign', hash(1)], ['schedule', hash(2)], ['deliver', hash(2)]]) {
    assert.deepEqual(workflowPermissionV3(p, actor, op, target, binding), permit);
    assert.throws(() => workflowPermissionV3(p, actor, op, target, hash(3)), /authority_required/);
    assert.throws(() => workflowPermissionV3(p, actor, op, { ...target, attemptId: id(90) }, binding), /authority_required/);
  }
  assert.throws(() => workflowPermissionV3(p, { ...actor, userId: id(90) }, 'status', target, null), /authority_required/);
  assert.throws(() => workflowPermissionV3(p, actor, 'status', { ...target, draftId: id(90) }, null), /authority_required/);
  assert.throws(() => workflowPermissionV3(p, actor, 'approve', target, hash(1)), /authority_required/);
  assert.equal(workflowPermissionV3(p, actor, 'status', target, null), null);
});

test('empty policy is read-only, and malformed or excessive policy cannot activate', () => {
  const empty = parseWorkflowHostPolicyV3({ ...policy, permits: [], maxGasCostWei: '0' });
  assert.equal(workflowPermissionV3(empty, actor, 'inspect', target, null), null);
  for (const operation of ['sign', 'approve', 'schedule', 'deliver'])
    assert.throws(() => workflowPermissionV3(empty, actor, operation, target, hash(1)), /authority_required/);
  for (const change of [
    { durationSeconds: 1801 }, { unknown: true }, { maxGasCostWei: '999' }, { maxRewardWei: '-1' },
    { maxGasCostWei: (1n << 256n).toString() }, { permits: [permit, permit] },
    { permits: [{ ...permit, maxGasCostWei: '0' }] }, { permits: [{ ...permit, maxRewardWei: '1' }], maxRewardWei: '1' },
    { permits: [{ ...permit, signPlanHash: null, transactionHash: null }] },
    { permits: [{ ...permit, approvalPlanHash: hash(3) }] },
    { permits: [{ ...permit, target: { ...target, draftId: id(90) } }] },
  ]) assert.throws(() => parseWorkflowHostPolicyV3({ ...policy, ...change }));
});

test('recipient permits budget real rewards and keep approval and transaction authority separate', () => {
  const t = { kind: 'athlete', uploadId: id(5), destinationId: id(10), entitlementId: hash(7), claimId: id(11), paymentId: id(12), attemptId: id(13) };
  const p = parseWorkflowHostPolicyV3({ ...policy, maxRewardWei: '50', permits: [{ ...permit, target: t, approvalPlanHash: hash(8), maxRewardWei: '50' }] });
  assert.ok(workflowPermissionV3(p, actor, 'approve', t, hash(8)));
  assert.throws(() => workflowPermissionV3(p, actor, 'sign', t, hash(8)), /authority_required/);
  assert.throws(() => parseWorkflowHostPolicyV3({ ...p, maxRewardWei: '49' }), /authority_required/);
});

test('session vault requires SDK-verified identity, rechecks tokens, and preserves concurrent same-token grants', async () => {
  let calls = 0, valid = true;
  const stop = new AbortController(), expiresAtMs = Date.now() + 60_000;
  const vault = createWorkflowSessionVaultV3(async token => { calls++; assert.ok(valid); assert.ok(['token-one', 'token-two'].includes(token));
    return { identity: actor, expiresAtMs }; }, stop.signal);
  await assert.rejects(vault.verify(actor), /session_required/);
  await assert.rejects(vault.admit({ ...actor, sessionId: id(90) }, 'token-one'), /session_required/);
  await vault.admit(actor, 'token-one'); const grant = await vault.verify(actor);
  await Promise.all([vault.admit(actor, 'token-one'), vault.admit(actor, 'token-one')]); grant.assertActive();
  await vault.verify(actor); assert.equal(calls, 6);
  await vault.admit(actor, 'token-two'); assert.throws(grant.assertActive, /session_required/);
  const current = await vault.verify(actor); valid = false;
  await assert.rejects(vault.verify(actor)); valid = true;
  stop.abort(); assert.throws(current.assertActive, /session_required/);
  await assert.rejects(vault.admit(actor, 'token-two'), /session_required/);
});

test('session vault rejects expiration, changed identity and a verifier that completes after shutdown', async () => {
  const stop = new AbortController(); let expiry = Date.now() + 60_000, identity = actor;
  const vault = createWorkflowSessionVaultV3(async () => ({ identity, expiresAtMs: expiry }), stop.signal);
  for (const value of [0, Infinity, Date.now() + 1000]) { expiry = value; await assert.rejects(vault.admit(actor, 'token'), /session_required/); }
  expiry = Date.now() + 60_000; await vault.admit(actor, 'token');
  identity = { ...actor, userId: id(90) }; await assert.rejects(vault.verify(actor), /session_required/);
  identity = actor; const grant = await vault.verify(actor); vault.clear(); assert.throws(grant.assertActive, /session_required/);
  let release;
  const pendingVault = createWorkflowSessionVaultV3(() => new Promise(resolve => release = resolve), stop.signal);
  const pending = pendingVault.admit(actor, 'token'); stop.abort(); release({ identity: actor, expiresAtMs: expiry });
  await assert.rejects(pending, /session_required/);
});

test('concrete authority denies source drift, foreign actor and unapproved operations before RPC, chain or token verification', async () => {
  let sourceOK = true;
  const authorize = createWorkflowPolicyAuthorityV3({
    target: { mode: 'local-testnet', chainId: 10143, origin: 'http://127.0.0.1:3102', supabaseUrl: 'http://127.0.0.1:55321' },
    policy, reader: {}, rpc: noIO, sessions: { verify: noIO }, assertSource: () => assert.ok(sourceOK, 'source_drift'),
  });
  await assert.rejects(authorize({ ...actor, userId: id(90) }, 'status', target, null), /authority_required/);
  await assert.rejects(authorize(actor, 'sign', target, hash(90)), /authority_required/);
  sourceOK = false; await assert.rejects(authorize(actor, 'status', target, null), /source_drift/);
});
