import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanaryRpcPacer, canaryPublicClient, controllerPublicClient } from '../dist/canary-public-client.js';
test('concurrent starts are FIFO and at most five per second, without waiting for request responses', async () => {
  const pace = createCanaryRpcPacer(), starts = [];
  await Promise.all(Array.from({ length: 8 }, (_, i) => pace().then(() => starts.push({ i, time: performance.now() }))));
  assert.deepEqual(starts.map(s => s.i), [0, 1, 2, 3, 4, 5, 6, 7]);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i].time - starts[i - 1].time >= 199);
});
test('fixed public client preserves RPC inputs, has no cache/retries, and never retries a failed send', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body, time: performance.now() });
    assert.equal(url, 'https://testnet-rpc.monad.xyz');
    assert.equal(new Headers(init.headers).has('authorization'), false);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32011, message: 'requests limited to 15/sec' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.equal(canaryPublicClient.chain.id, 10143); assert.equal(canaryPublicClient.cacheTime, 0);
    // Deliberately invalid dummy bytes: fake fetch only, no signed attempt/network.
    await assert.rejects(canaryPublicClient.request({ method: 'eth_sendRawTransaction', params: ['0x00'] }));
    assert.equal(calls.length, 1); assert.deepEqual(calls[0].body.params, ['0x00']);
    assert.equal(controllerPublicClient.chain.id,10143);assert.equal(controllerPublicClient.cacheTime,0);
    assert.equal(controllerPublicClient.batch.multicall.deployless,true);
    await assert.rejects(controllerPublicClient.getChainId()); assert.equal(calls.length, 2);
    assert.ok(calls[1].time - calls[0].time >= 190);
  } finally { globalThis.fetch = original; }
});
test('expired queued requests reject immediately and do not delay live requests by consuming slots',async()=>{
 const pace=createCanaryRpcPacer();await pace();
 const began=performance.now(),cancel=new AbortController();
 const expired=Array.from({length:8},()=>pace(cancel.signal));
 const results=Promise.allSettled(expired);
 cancel.abort(Error('synthetic_timeout'));
 assert.ok((await results).every(r=>r.status==='rejected'&&r.reason.message==='synthetic_timeout'));
 assert.ok(performance.now()-began<150,'cancellation waited in the request queue');
 await pace();assert.ok(performance.now()-began<700,'expired requests consumed rate-limit slots');
 const live=performance.now();await pace();assert.ok(performance.now()-live>=199,'live request pacing changed');
});
