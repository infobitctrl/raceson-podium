import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicPotObserver} from '../dist/features/rewards/public-pot-observation.js';

const hash = n => '0x' + n.toString(16).padStart(64, '0');
const address = '0x' + '11'.repeat(20);
const plan = {version:4,launchId:'73000000-0000-4000-8000-000000000001',setupRevision:1,configurationHash:'a'.repeat(64),chainId:31337,
 funder:address,operator:'0x'+'22'.repeat(20),unallocatedTreasury:'0x'+'33'.repeat(20),expiredTreasury:address,
 claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:['50','50','0','0','0','0'],budgetWei:'100'};
function fixture() {
 let calls=0,checks=0,programmeCalls=0,now=0,head=100n;
 const reader={getChainId:async()=>{checks++;return 31337;},getBlock:async({blockNumber})=>({number:blockNumber??head,hash:hash(Number(blockNumber??head)),timestamp:(blockNumber??head)*10n})};
 const observe=async(_reader,_plan,deployment,funding,slot,block=head)=>{
  calls++;
  return {address,deploymentHash:deployment,fundingHash:funding,funded:true,cancelled:false,blockNumber:String(block),blockHash:hash(Number(block)),blockTimestamp:String(block*10n),
   pots:[{slot,address,amountWei:'50',state:3,paused:false,allocatedWei:'50',paidWei:block>100n?'10':'0',remainingWei:block>100n?'40':'50',returnedWei:'0',claimDeadline:'2000',entitlementCount:'25'}]};
 };
 const programme=async(reader,plan,deployment,funding)=>{
  programmeCalls++;
  const pots=await Promise.all([0,1].map(slot=>observe(reader,plan,deployment,funding,slot)));
  calls-=2;
  return {...pots[0],pots:pots.flatMap(p=>p.pots)};
 };
 const cached=createPublicPotObserver(observe,()=>now,programme);
 const read=(block,changes={})=>cached(changes.reader??reader,changes.plan??plan,changes.deployment??hash(1),changes.funding??hash(2),changes.slot??0,block);
 return {reader,read,programme:()=>cached.programme(reader,plan,hash(1),hash(2)),programmeCalls:()=>programmeCalls,calls:()=>calls,checks:()=>checks,advance:()=>{now+=120001;},head:()=>{head=101n;}};
}
test('later public pages reuse exact verified observations but refresh always observes current payments',async()=>{
 const f=fixture(),first=await f.read();
 assert.deepEqual(await f.read(100n),first);assert.equal(f.calls(),1);assert.equal(f.checks(),1);
 f.head();const fresh=await f.read();assert.equal(f.calls(),2);assert.equal(fresh.pots[0].paidWei,'10');
 assert.deepEqual(await f.read(100n),first);assert.equal(f.calls(),2);
 fresh.pots[0].paidWei='999';assert.equal((await f.read(101n)).pots[0].paidWei,'10');
});
test('concurrent cold pages share verification at the same block and do not share caller mutations',async()=>{
 const f=fixture();const pages=await Promise.all(Array.from({length:4},()=>f.read(100n)));
 assert.equal(f.calls(),1);assert.equal(f.checks(),3);
 pages[0].pots[0].paidWei='999';assert.equal(pages[1].pots[0].paidWei,'0');
});
test('reader, immutable plan, deployment, funding, slot and block are isolated',async()=>{
 const f=fixture();await f.read(100n);
 for(const changes of [{reader:{...f.reader}},{plan:{...plan,configurationHash:'b'.repeat(64)}},{deployment:hash(3)},{funding:hash(4)},{slot:1}])await f.read(100n,changes);
 await f.read(99n);assert.equal(f.calls(),7);
});
test('expired and evicted snapshots are fully verified again',async()=>{
 const f=fixture();await f.read(1n);f.advance();await f.read(1n);assert.equal(f.calls(),2);
 for(let block=2n;block<=65n;block++)await f.read(block);
 await f.read(1n);assert.equal(f.calls(),67);
});
test('chain, finality, canonical hash and timestamp changes reject and evict cached observations',async()=>{
 for(const change of ['chain','finality','hash','timestamp','number','offline']){
  const f=fixture();await f.read(100n);const getBlock=f.reader.getBlock,getChainId=f.reader.getChainId;
  if(change==='chain')f.reader.getChainId=async()=>1;
  else f.reader.getBlock=async args=>{
   if(change==='offline')throw Error('offline');
   const block=await getBlock(args);
   if(change==='finality'&&args.blockTag)return {...block,number:99n};
   if(args.blockNumber)return {...block,...(change==='hash'?{hash:hash(500)}:change==='timestamp'?{timestamp:999n}:change==='number'?{number:99n}:{})};
   return block;
  };
  await assert.rejects(()=>f.read(100n));
  f.reader.getBlock=getBlock;f.reader.getChainId=getChainId;
  await f.read(100n);assert.equal(f.calls(),2,change);
 }
});
test('failed observations are never retained and can be retried',async()=>{
 let calls=0;
 const observer=createPublicPotObserver(async()=>{calls++;throw Error('failed verification');});
 const reader={};
 for(let i=0;i<2;i++)await assert.rejects(()=>observer(reader,plan,hash(1),hash(2),0,100n));
 assert.equal(calls,2);
});

test('a fresh public programme observation seeds each pot at the same block without repeating the observation',async()=>{
 const f=fixture(),programme=await f.programme();
 programme.pots[0].paidWei='999';
 assert.equal((await f.read(100n)).pots[0].paidWei,'0');
 assert.equal((await f.read(100n,{slot:1})).pots[0].slot,1);
 assert.equal(f.calls(),0);assert.equal(f.checks(),2);
 f.head();assert.equal((await f.read()).pots[0].paidWei,'10');assert.equal(f.calls(),1);
 await f.programme();assert.equal(f.programmeCalls(),2);
 assert.equal((await f.read(101n,{slot:1})).pots[0].paidWei,'10');assert.equal(f.calls(),1);
});
test('programme-seeded snapshots still reject changed canonical blocks and expire',async()=>{
 const f=fixture();await f.programme();const original=f.reader.getBlock;
 f.reader.getBlock=async args=>({...await original(args),hash:hash(999)});
 await assert.rejects(()=>f.read(100n));
 f.reader.getBlock=original;await f.read(100n);assert.equal(f.calls(),1);
 f.advance();await f.read(100n,{slot:1});assert.equal(f.calls(),2);
});
