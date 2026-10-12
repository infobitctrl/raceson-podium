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

test('public directory batches at most two exact read RPCs and shares pacing with unbatched private reads',async()=>{
 const {publicDirectoryClient}=await import('../dist/canary-public-client.js');
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(init.body),items=Array.isArray(body)?body:[body];
  calls.push({body,time:performance.now()});assert.equal(new URL(url).origin,'https://testnet-rpc.monad.xyz');
  assert.equal(new Headers(init.headers).has('authorization'),false);
  const replies=items.map(item=>({jsonrpc:'2.0',id:item.id,result:item.method==='eth_chainId'?'0x279f':item.params[0]})).reverse();
  return new Response(JSON.stringify(Array.isArray(body)?replies:replies[0]),{headers:{'Content-Type':'application/json'}});
 };
 try{
  const addresses=Array.from({length:8},(_,i)=>'0x'+String(i+1).padStart(40,'0'));
  const reads=addresses.map(address=>publicDirectoryClient.getCode({address,blockNumber:120n}));
  const privateRead=controllerPublicClient.getChainId();
  assert.deepEqual(await Promise.all(reads),addresses,'reordered batch replies must retain their request identity');
  assert.equal(await privateRead,10143);
  const batches=calls.filter(c=>Array.isArray(c.body));assert.equal(batches.length,4);
  assert.ok(batches.every(c=>c.body.length===2));
  assert.deepEqual(batches.flatMap(c=>c.body.map(b=>b.params)).sort(),addresses.map(a=>[a,'0x78']).sort());
  assert.equal(calls.filter(c=>!Array.isArray(c.body)).length,1,'private transport stays unbatched');
  for(let i=1;i<calls.length;i++)assert.ok(calls[i].time-calls[i-1].time>=190,'directory bypassed shared pacing');
  assert.equal(publicDirectoryClient.cacheTime,0);
  const before=calls.length;
  await assert.rejects(publicDirectoryClient.request({method:'eth_sendRawTransaction',params:['0x00']}));
  assert.equal(calls.length,before,'read-only directory transport cannot send transactions');
 }finally{globalThis.fetch=original;}
});

test('public directory propagates batch errors without retrying or caching successful state',async()=>{
 const {publicDirectoryClient}=await import('../dist/canary-public-client.js');
 const original=globalThis.fetch;let calls=0,fail=true;
 globalThis.fetch=async(_url,init)=>{
  calls++;const body=JSON.parse(init.body);
  return new Response(JSON.stringify(body.map(item=>({jsonrpc:'2.0',id:item.id,...(fail?{error:{code:-32011,message:'limited'}}:{result:'0x1'})}))),{headers:{'Content-Type':'application/json'}});
 };
 try{
  const address='0x'+'1'.repeat(40),input={address,blockNumber:120n};
  await assert.rejects(publicDirectoryClient.getCode(input));assert.equal(calls,1);
  fail=false;assert.equal(await publicDirectoryClient.getCode(input),'0x1');assert.equal(calls,2);
  assert.equal(await publicDirectoryClient.getCode(input),'0x1');assert.equal(calls,3,'each fresh refresh must reach the provider');
 }finally{globalThis.fetch=original;}
});
