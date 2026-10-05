import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchFinalResultsCanaryStatusRoute } from '../dist/routes/rewards/final-results-canary.js';
import { finalResultsCanaryPlan as plan, FINAL_RESULTS_CANARY_MANIFEST, FINAL_RESULTS_CANARY_ADDRESS, FINAL_RESULTS_CANARY_DEPLOYMENT_TX } from '@raceson/domain/rewards/final-results-canary';
const status = { schema: 'raceson-final-results-canary-status-v3', chainId: 10143, manifestHash: FINAL_RESULTS_CANARY_MANIFEST,
  observedBlock: { number: '1', timestamp: '1801000000', hash: `0x${'12'.repeat(32)}` },
  wallets: ['funder', 'operator', 'relayer'].map(role => ({ role, address: plan[role], balanceWei: '0' })), deployment: 'verified',
  contract: { address: FINAL_RESULTS_CANARY_ADDRESS, transactionHash: FINAL_RESULTS_CANARY_DEPLOYMENT_TX, state: 0, paused: false,
    fundedWei: '0', allocatedWei: '0', paidWei: '0', returnedWei: '0', balanceWei: '0', reviewPeriodSeconds: '0',
    reviewStartedAt: null, officialPublishedAt: null, allocationApprovedAt: null } };
async function request({ method = 'GET', path = '/api/v1/rewards/canary/final-results', config = { chainId: 10143 }, observe = async () => status } = {}) {
  let calls = 0; const res = { status: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; } };
  const matched = await dispatchFinalResultsCanaryStatusRoute({ method }, res, new URL(path, 'https://demo.invalid'), {
    config: () => config, sendSuccess: (r, data) => { r.data = data; }, sendError: (r, code, error) => { r.status = code; r.error = error; },
  }, async () => { calls++; return observe(); });
  return { matched, ...res, calls };
}
test('V3 public endpoint exposes only validated fixed metadata without session or database', async () => {
  const result = await request(); assert.equal(result.matched, true); assert.equal(result.status, 200);
  assert.deepEqual(result.data, status); assert.equal(result.headers['Cache-Control'], 'no-store');
});
test('V3 rejects mutation, wrong mode and caller address/RPC selectors before any observation', async () => {
  for (const [input, expected] of [[{ method: 'POST' }, 405], [{ config: null }, 409], [{ config: { chainId: 31337 } }, 409],
    [{ path: '/api/v1/rewards/canary/final-results?address=bad' }, 400], [{ path: '/api/v1/rewards/canary/final-results?rpc=bad' }, 400]]) {
    const result = await request(input); assert.equal(result.status, expected); assert.equal(result.calls, 0);
  }
  assert.equal((await request({ path: '/api/v1/rewards/canary' })).matched, false);
});
test('invalid/private/V2 responses and RPC failures return no stale values or raw errors', async () => {
  for (const observe of [async () => ({ ...status, secret: 'never-return' }), async () => ({ ...status, schema: 'raceson-canary-status-v1' }),
    async () => { throw Error('https://provider.invalid/private-token'); }]) {
    const result = await request({ observe }); assert.equal(result.status, 503); assert.equal(result.data, undefined);
    assert.doesNotMatch(JSON.stringify(result), /never-return|private-token/);
  }
  const result = await request({ observe: async () => { throw Error('canary_rate_limited'); } });
  assert.equal(result.status, 429); assert.equal(result.headers['Retry-After'], '3');
});
