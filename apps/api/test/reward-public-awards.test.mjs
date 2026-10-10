import test from 'node:test';
import assert from 'node:assert/strict';
import {rewardUploadDigest} from '@raceson/rewards-chain';
import {publicAwardPage,publicAwardQuery} from '../dist/features/rewards/public-awards-service.js';
import {decodePublicRewardPage} from '@raceson/domain/rewards/public-campaign';
const h=n=>'0x'+n.toString(16).padStart(64,'0'),address='0x'+'11'.repeat(20),scope={id:'73000000-0000-4000-8000-000000000001',slot:1,chainId:10143};
function fixture(count=2){
 const awards=Array.from({length:count},(_,i)=>({entitlementId:h(i+1),beneficiaryId:h(i+100),explanationHash:h(i+200),amount:String(i+1),pot:0,beneficiaryKind:0}));
 const commit=rewardUploadDigest(awards.map(r=>({...r,amount:BigInt(r.amount)})),0,10000n);
 const raw={...scope,programmeAddress:address,campaignAddress:address,fundingHash:h(400),uploadDigest:commit.digest,awards};
 const observed={address,funded:true,cancelled:false,fundingHash:h(400),blockNumber:'10',blockHash:h(10),blockTimestamp:'100',pots:[{slot:1,address,amountWei:'10000',state:3,paused:false,allocatedWei:String(commit.total),paidWei:'1',remainingWei:'9999',returnedWei:'0',claimDeadline:'200',entitlementCount:String(count)}]};
 let reads=0;
 const reader={getChainId:async()=>10143,getBlock:async()=>({hash:h(10),timestamp:100n}),readContract:async({functionName,args,blockNumber})=>{
  assert.equal(blockNumber,10n);
  if(functionName==='uploadDigest')return commit.digest;
  reads++;const r=awards.find(a=>a.entitlementId===args[0]);
  return [r.beneficiaryId,BigInt(r.amount),r.explanationHash,0n,args[0]===h(1)?address:'0x'+'00'.repeat(20),0,args[0]===h(1),0];
 }};
 return{raw,observed,reader,reads:()=>reads};
}
const query={offset:0,sort:'reward',direction:'asc'};
test('copied sporting display is bounded and cannot expose account, wallet or consent fields',async()=>{
 const f=fixture();f.raw.awards[0].display={name:'Races Mon70',club:'Demo club 1',timeMs:'4860447'};
 const p=await publicAwardPage(f.reader,f.observed,scope,f.raw,query);
 assert.deepEqual(p.rows[0].display,f.raw.awards[0].display);
 for(const patch of [{name:''},{club:42},{timeMs:'-1'},{timeMs:'01'},{timeMs:'1.2'},{timeMs:'10000000000000000'},{wallet:address},{userId:scope.id},{consent:true}]){
  f.raw.awards[0].display={name:'Races Mon70',club:null,timeMs:null,...patch};
  await assert.rejects(()=>publicAwardPage(f.reader,f.observed,scope,f.raw,query));
 }
 const club={...p.rows[0],kind:'club',display:{name:'Demo club 1',club:null,timeMs:null}};
 assert.doesNotThrow(()=>decodePublicRewardPage({...p,rows:[club,p.rows[1]]}));
 assert.throws(()=>decodePublicRewardPage({...p,rows:[{...club,display:{...club.display,timeMs:'1000'}},p.rows[1]]}));
});
test('mixed finalized paid flags become claimed/unclaimed without identity or recipient leakage',async()=>{
 const f=fixture(),p=await publicAwardPage(f.reader,f.observed,scope,f.raw,query);
 assert.deepEqual(p.rows.map(r=>r.status),['claimed','unclaimed']);assert.equal(p.availability,'open');
 assert.equal(JSON.stringify(p).includes('beneficiaryId'),false);assert.equal(JSON.stringify(p).includes(address),false);
 assert.equal(p.rows.reduce((n,r)=>n+BigInt(r.amountWei),0n),3n);
 assert.throws(()=>decodePublicRewardPage({...p,owner:'private'}));assert.throws(()=>decodePublicRewardPage({...p,rows:[{...p.rows[0],recipient:address},p.rows[1]]}));
});
test('global numerical sorting and page bounds cap chain row reads at 25',async()=>{
 const f=fixture(30),p=await publicAwardPage(f.reader,f.observed,scope,f.raw,{offset:0,sort:'amount',direction:'desc'});
 assert.equal(p.total,30);assert.equal(p.rows.length,25);assert.equal(p.rows[0].amountWei,'30');assert.equal(f.reads(),25);
 const second=await publicAwardPage(f.reader,f.observed,scope,f.raw,{offset:25,sort:'amount',direction:'desc'});
 assert.deepEqual(second.rows.map(r=>r.amountWei),['5','4','3','2','1']);
});
test('mismatched row, upload, scope or block never creates a payment assertion',async()=>{
 for(const kind of ['amount','upload','block','chain','slot','funding']){
  const f=fixture(),original=f.reader.readContract;
  if(kind==='amount')f.reader.readContract=async a=>a.functionName==='entitlements'?[h(100),999n,h(200),0n,address,0,true,0]:original(a);
  if(kind==='upload')f.raw.uploadDigest=h(99);
  if(kind==='block')f.reader.getBlock=async()=>({hash:h(11),timestamp:100n});
  if(kind==='chain')f.reader.getChainId=async()=>1;
  if(kind==='slot')f.raw.slot=2;
  if(kind==='funding')f.raw.fundingHash=h(99);
  await assert.rejects(()=>publicAwardPage(f.reader,f.observed,scope,f.raw,query));
 }
});
test('no prepared rewards is an explicit empty state, and cannot hide allocated on-chain awards',async()=>{
 const f=fixture();await assert.rejects(()=>publicAwardPage(f.reader,f.observed,scope,null,query));
 f.observed.pots[0].entitlementCount='0';f.observed.pots[0].allocatedWei='0';
 const p=await publicAwardPage(f.reader,f.observed,scope,null,query);assert.equal(p.availability,'awaiting_approval');assert.equal(p.total,0);
});
test('query rejects duplicate or unbounded parameters and supports exact page/sort',()=>{
 for(const q of ['offset=1','offset=25000','sort=status','direction=bad','offset=0&offset=25','wallet=other'])assert.throws(()=>publicAwardQuery(new URLSearchParams(q)));
 assert.deepEqual(publicAwardQuery(new URLSearchParams('offset=25&sort=amount&direction=desc')),{offset:25,sort:'amount',direction:'desc'});
});
test('missing contract rows are planned only before staging; paused/expired claims stay distinct',async()=>{
 const f=fixture(),original=f.reader.readContract;
 f.reader.readContract=async a=>a.functionName==='entitlements'?[h(0),0n,h(0),0n,'0x'+'00'.repeat(20),0,false,0]:original(a);
 await assert.rejects(()=>publicAwardPage(f.reader,f.observed,scope,f.raw,query));
 f.observed.pots[0].state=1;f.observed.pots[0].allocatedWei='0';f.observed.pots[0].entitlementCount='0';
 const planned=await publicAwardPage(f.reader,f.observed,scope,f.raw,query);assert.ok(planned.rows.every(r=>r.status==='planned'));
 f.reader.readContract=original;f.observed.pots[0].state=3;f.observed.pots[0].allocatedWei='3';f.observed.pots[0].entitlementCount='2';f.observed.pots[0].paused=true;
 assert.equal((await publicAwardPage(f.reader,f.observed,scope,f.raw,query)).availability,'paused');
 f.observed.pots[0].paused=false;f.observed.pots[0].claimDeadline='99';assert.equal((await publicAwardPage(f.reader,f.observed,scope,f.raw,query)).availability,'closed');
});
test('category contributions reconcile to each entitlement, retain place and expose no private fields',async()=>{
 const f=fixture();f.raw.awards[0].breakdown=[{category:'Long · Female',amountWei:'1',place:1}];f.raw.awards[1].breakdown=[{category:'Short · Male',amountWei:'2',place:null}];
 const scoped={...scope,groups:[{name:'Long · Female',amountWei:'1'},{name:'Short · Male',amountWei:'2'}]};
 const page=await publicAwardPage(f.reader,f.observed,scoped,f.raw,query);
 assert.deepEqual(page.rows[0].breakdown,f.raw.awards[0].breakdown);
 for(const bad of [{category:'Unknown',amountWei:'1',place:1},{category:'Long · Female',amountWei:'2',place:1},{category:'Long · Female',amountWei:'1',place:1,name:'Private athlete'}]){
  f.raw.awards[0].breakdown=[bad];await assert.rejects(()=>publicAwardPage(f.reader,f.observed,scoped,f.raw,query));
 }
});
