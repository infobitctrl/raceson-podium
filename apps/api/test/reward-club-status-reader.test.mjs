import test from 'node:test';
import assert from 'node:assert/strict';
import {clubStatusReader} from '../dist/features/rewards/club-status-reader.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('concurrent exact status reads share work; later nonce/finality reads are fresh',async()=>{
 let calls=0,release;const reader={readContract:async()=>{calls++;return new Promise(resolve=>{release=resolve;});}};
 const a=clubStatusReader(reader),b=clubStatusReader(reader);assert.equal(a,b);
 const args={address:'safe',functionName:'nonce',blockNumber:7n};const first=a.readContract(args),second=b.readContract({...args});await tick();assert.equal(calls,1);
 release(1n);assert.deepEqual(await Promise.all([first,second]),[1n,1n]);
 const next=a.readContract(args);await tick();assert.equal(calls,2);release(2n);assert.equal(await next,2n);
});
test('different block, method, arguments and underlying provider never share a read',async()=>{
 let calls=0;const method=async()=>{calls++;await tick();return 1;};const first=clubStatusReader({readContract:method,getBlock:method}),second=clubStatusReader({readContract:method});
 await Promise.all([first.readContract({blockNumber:1n,args:['one']}),first.readContract({blockNumber:2n,args:['one']}),first.readContract({blockNumber:1n,args:['two']}),first.getBlock({blockNumber:1n,args:['one']}),second.readContract({blockNumber:1n,args:['one']})]);assert.equal(calls,5);
});
test('rejections are shared only in flight and do not poison a retry',async()=>{
 let calls=0;const reader=clubStatusReader({getBlock:async()=>{calls++;await tick();if(calls===1)throw Error('RPC unavailable');return {hash:'fresh'};}});
 const results=await Promise.allSettled([reader.getBlock({blockTag:'finalized'}),reader.getBlock({blockTag:'finalized'})]);assert(results.every(r=>r.status==='rejected'));assert.equal(calls,1);assert.deepEqual(await reader.getBlock({blockTag:'finalized'}),{hash:'fresh'});assert.equal(calls,2);
});
test('non-read methods and raw request calls are never shared',async()=>{
 let calls=0;const action=async()=>++calls;const reader=clubStatusReader({sendRawTransaction:action,request:action});
 await Promise.all([reader.sendRawTransaction({}),reader.sendRawTransaction({}),reader.request({method:'eth_call'}),reader.request({method:'eth_call'})]);assert.equal(calls,4);
});
test('read sharing has a bounded pending map and does not block excess unique calls',async()=>{
 let calls=0;const resolve=[];const reader=clubStatusReader({getCode:async()=>{calls++;await new Promise(r=>resolve.push(r));return '0x';}});
 const pending=Array.from({length:514},(_,i)=>reader.getCode({address:String(i)}));await tick();assert.equal(calls,514);resolve.forEach(r=>r());await Promise.all(pending);
});

// Exercise the real provenance/finality validator through the shared reader.
import {readVerifiedRewardClubSafeDeployment} from '../../../packages/rewards-chain/dist/index.js';
import {clubSafeDeploymentFixture} from '../../../packages/rewards-chain/test/club-safe-deployment-fixture.mjs';
test('shared reads preserve full Safe provenance and reject changed historical checkpoints',async()=>{
 for(const changed of [false,true]){
  const fixture=clubSafeDeploymentFixture();let historicalReads=0;
  const original=fixture.reader.getBlock;
  fixture.reader.getBlock=async args=>{
   await tick();const block=await original(args);
   if(args.blockNumber===50n&&++historicalReads>1&&changed)return {...block,hash:'0x'+'ff'.repeat(32)};
   return block;
  };
  const reader=clubStatusReader(fixture.reader);
  const results=await Promise.allSettled([readVerifiedRewardClubSafeDeployment(reader,fixture.input),readVerifiedRewardClubSafeDeployment(reader,fixture.input)]);
  assert(historicalReads>=2,'historical checkpoint was not freshly rechecked');
  assert(results.every(result=>result.status===(changed?'rejected':'fulfilled')));
  if(!changed)assert.deepEqual(results[0].value.setupOwners,fixture.owners);
 }
});
test('a successful status check never masks a subsequent owner configuration change',async()=>{
 const fixture=clubSafeDeploymentFixture(),reader=clubStatusReader(fixture.reader);
 await readVerifiedRewardClubSafeDeployment(reader,fixture.input);
 const original=fixture.reader.readContract;
 fixture.reader.readContract=async args=>args.functionName==='getThreshold'?1n:original(args);
 await assert.rejects(readVerifiedRewardClubSafeDeployment(reader,fixture.input));
});
