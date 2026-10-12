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

test('public directory batches at most eight exact read RPCs and shares pacing with unbatched private reads',async()=>{
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
  const addresses=Array.from({length:26},(_,i)=>'0x'+String(i+1).padStart(40,'0'));
  const reads=addresses.map(address=>publicDirectoryClient.getCode({address,blockNumber:120n}));
  const privateRead=controllerPublicClient.getChainId();
  assert.deepEqual(await Promise.all(reads),addresses,'reordered batch replies must retain their request identity');
  assert.equal(await privateRead,10143);
  const batches=calls.filter(c=>Array.isArray(c.body));assert.equal(batches.length,4);
  assert.deepEqual(batches.map(c=>c.body.length),[8,8,8,2],'a short final batch must not wait for more reads');
  assert.deepEqual(batches.flatMap(c=>c.body.map(b=>b.params)).sort(),addresses.map(a=>[a,'0x78']).sort());
  assert.equal(calls.filter(c=>!Array.isArray(c.body)).length,1,'private transport stays unbatched');
  for(let i=1;i<calls.length;i++)assert.ok(calls[i].time-calls[i-1].time>=190,'directory bypassed shared pacing');
  for(const start of calls){
   const window=calls.filter(c=>c.time>=start.time&&c.time<start.time+990);
   assert.ok(window.reduce((n,c)=>n+(Array.isArray(c.body)?c.body.length:1),0)<=40,'logical read limit exceeded');
  }
  assert.equal(publicDirectoryClient.cacheTime,0);
  const before=calls.length;
  await assert.rejects(publicDirectoryClient.request({method:'eth_sendRawTransaction',params:['0x00']}));
  assert.equal(calls.length,before,'read-only directory transport cannot send transactions');
 }finally{globalThis.fetch=original;}
});

test('a failed read in a reordered four-item batch stays attached to its caller without retry',async()=>{
 const {publicDirectoryClient}=await import('../dist/canary-public-client.js');
 const original=globalThis.fetch;let calls=0;
 const addresses=Array.from({length:4},(_,i)=>'0x'+String(i+1).padStart(40,'0'));
 globalThis.fetch=async(_url,init)=>{
  calls++;const body=JSON.parse(init.body);assert.equal(body.length,4);
  return new Response(JSON.stringify(body.map(item=>({jsonrpc:'2.0',id:item.id,
   ...(item.params[0]===addresses[1]?{error:{code:-32011,message:'synthetic_provider_limit'}}:{result:item.params[0]})
  })).reverse()),{headers:{'Content-Type':'application/json'}});
 };
 try{
  const result=await Promise.allSettled(addresses.map(address=>publicDirectoryClient.getCode({address,blockNumber:120n})));
  assert.deepEqual(result.map(r=>r.status),['fulfilled','rejected','fulfilled','fulfilled']);
  for(const i of [0,2,3])assert.equal(result[i].value,addresses[i]);
  assert.match(result[1].reason.message,/synthetic_provider_limit/);
  assert.equal(calls,1,'a failed batch member must not retry successful or failed reads');
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


test('mixed public call batches and private requests stay within the shared rolling eth_call budget',async()=>{
 const pace=createCanaryRpcPacer(),starts=[];
 const weights=[8,8,8,1,0,8,8];
 await Promise.all(weights.map((count,i)=>pace(undefined,count).then(()=>starts.push({i,count,time:performance.now()}))));
 assert.deepEqual(starts.map(s=>s.i),weights.map((_,i)=>i));
 for(const start of starts){
  const window=starts.filter(s=>s.time>=start.time&&s.time<start.time+990);
  assert.ok(window.reduce((n,s)=>n+s.count,0)<=20,'eth_call limit exceeded');
  assert.ok(window.length<=5,'shared HTTP limit exceeded');
 }
 for(const invalid of [-1,9,1.5,NaN])await assert.rejects(pace(undefined,invalid),/invalid_rpc_batch/);
});


test('actual directory eth_call envelopes honor the call limit alongside private traffic',async()=>{
 const {publicDirectoryClient}=await import('../dist/canary-public-client.js');
 const original=globalThis.fetch,starts=[];
 globalThis.fetch=async(_url,init)=>{
  const body=JSON.parse(init.body),items=Array.isArray(body)?body:[body];
  starts.push({time:performance.now(),calls:items.filter(i=>i.method==='eth_call').length,total:items.length});
  const results=items.map(i=>({jsonrpc:'2.0',id:i.id,result:i.method==='eth_chainId'?'0x279f':'0x'}));
  return new Response(JSON.stringify(Array.isArray(body)?results:results[0]),{headers:{'Content-Type':'application/json'}});
 };
 try{
  await Promise.all([...Array.from({length:40},(_,i)=>publicDirectoryClient.request({method:'eth_call',params:[{to:'0x'+'11'.repeat(20),data:'0x'+i.toString(16).padStart(2,'0')},'0x10']})),controllerPublicClient.getChainId()]);
  assert.equal(starts.reduce((sum,s)=>sum+s.calls,0),40);
  assert.ok(starts.every(s=>s.total<=8));
  for(const start of starts){
   const window=starts.filter(s=>s.time>=start.time&&s.time<start.time+990);
   assert.ok(window.reduce((sum,s)=>sum+s.calls,0)<=20);
   assert.ok(window.reduce((sum,s)=>sum+s.total,0)<=40);
  }
 }finally{globalThis.fetch=original;}
});

test('an expired call-heavy batch releases its wait without holding up a permitted private read',async()=>{
 const pace=createCanaryRpcPacer();await pace(undefined,8);await pace(undefined,8);
 const began=performance.now(),controller=new AbortController();
 const blocked=pace(controller.signal,8),rejected=assert.rejects(blocked,/expired/);
 setTimeout(()=>controller.abort(Error('expired')),20);
 await rejected;await pace();
 assert.ok(performance.now()-began<700,'cancelled eth_call batch held the private queue');
});
