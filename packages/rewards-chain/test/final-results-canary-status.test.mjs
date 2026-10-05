import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFinalResultsCanaryStatus, finalResultsCanaryPlan as plan, FINAL_RESULTS_CANARY_MANIFEST,
  FINAL_RESULTS_CANARY_ADDRESS, FINAL_RESULTS_CANARY_DEPLOYMENT_TX } from '@raceson/domain/rewards/final-results-canary';
import { finalResultsCanaryDeploymentSpec, readFinalResultsCanaryStatus } from '../dist/final-results-canary-status.js';
const status = { schema: 'raceson-final-results-canary-status-v3', chainId: 10143, manifestHash: FINAL_RESULTS_CANARY_MANIFEST,
  observedBlock: { number: '100', hash: `0x${'12'.repeat(32)}`, timestamp: '1801000000' },
  wallets: ['funder', 'operator', 'relayer'].map(role => ({ role, address: plan[role], balanceWei: '0' })), deployment: 'verified',
  contract: { address: FINAL_RESULTS_CANARY_ADDRESS, transactionHash: FINAL_RESULTS_CANARY_DEPLOYMENT_TX,
    state: 0, paused: false, fundedWei: '0', allocatedWei: '0', paidWei: '0', returnedWei: '0', balanceWei: '0',
    reviewPeriodSeconds: '0', reviewStartedAt: null, officialPublishedAt: null, allocationApprovedAt: null } };
test('V3 public plan preserves the deployed manifest, fixed address and distinct 0.1-MON budget', () => {
  const spec = finalResultsCanaryDeploymentSpec();
  assert.equal(spec.context.verifyingContract, FINAL_RESULTS_CANARY_ADDRESS); assert.equal(spec.reviewPeriod, 0n);
  assert.equal(spec.programmeManifestHash, FINAL_RESULTS_CANARY_MANIFEST); assert.equal(plan.budgetMON, '0.1');
  assert.deepEqual(decodeFinalResultsCanaryStatus(status), status);
});
test('V3 DTO rejects V2 clocks, wrong manifest, extra fields, private wallets and oversized trial amounts', () => {
  for (const patch of [{ schema: 'raceson-canary-status-v1' }, { chainId: 143 }, { deployment: 'absent' }, { contract: null },
    { sourceVerified: true }, { manifestHash: `0x${'12'.repeat(32)}` }, { secret: 'not-returnable' },
    { wallets: status.wallets.map(w => ({ ...w, address: plan.funder })) }])
    assert.throws(() => decodeFinalResultsCanaryStatus({ ...status, ...patch }));
  for (const patch of [{ address: plan.operator }, { state: '0' }, { state: 6 }, { reviewPeriodSeconds: '86400' },
    { reviewDeadline: '1801000000' }, { fundedWei: '1000000000000000000' }, { paidWei: '1' }, { state: 3 }])
    assert.throws(() => decodeFinalResultsCanaryStatus({ ...status, contract: { ...status.contract, ...patch } }));
});
test('V3 publication precedes exact approval; there is no fabricated additional day', () => {
  const contract = { ...status.contract, state: 3, fundedWei: '100000000000000000', allocatedWei: '50000000000000000',
    balanceWei: '100000000000000000', reviewStartedAt: '1800999800', officialPublishedAt: '1800999800', allocationApprovedAt: '1800999900' };
  assert.deepEqual(decodeFinalResultsCanaryStatus({ ...status, contract }).contract, contract);
  for (const patch of [{ reviewStartedAt: null }, { officialPublishedAt: null }, { allocationApprovedAt: null },
    { reviewStartedAt: '1800999801' }, { officialPublishedAt: '1800999901' }, { allocationApprovedAt: '1801000001' },
    { paidWei: '60000000000000000' }, { returnedWei: '100000000000000001' }, { balanceWei: '0' }])
    assert.throws(() => decodeFinalResultsCanaryStatus({ ...status, contract: { ...contract, ...patch } }));
});
test('wrong chain and missing/changed code never return fabricated zero funding', async () => {
  const reader = { getChainId: async () => 10143, getBlock: async () => ({ number: 100n, hash: status.observedBlock.hash, timestamp: 1801000000n }),
    getBalance: async () => 0n, getCode: async () => undefined };
  for (const patch of [{}, { getChainId: async () => 143 }, { getCode: async () => '0x00' },
    { getBlock: async () => ({ number: null, hash: null }) }]) await assert.rejects(readFinalResultsCanaryStatus({ ...reader, ...patch }));
});
