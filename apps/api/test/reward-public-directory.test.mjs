import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePublicDirectory,directoryMetrics,campaignStatus} from '@raceson/domain/rewards/public-directory';
import {dispatchPublicDirectory} from '../dist/routes/rewards/public-directory.js';
const id='73000000-0000-4000-8000-000000000001',hash='0x'+'bb'.repeat(32);
const campaign={id,name:'Public',chainId:10143,budgetWei:'100',address:'0x'+'11'.repeat(20),fundingHash:hash,blockNumber:'100',blockTimestamp:'1800000000',pots:[{slot:0,name:'Race',amountWei:'100',state:1,paused:false,allocatedWei:'0',paidWei:'0',remainingWei:'100',returnedWei:'0',claimDeadline:'0',groups:[{name:'Category',amountWei:'100'}]}]};
const item={campaign,selection:null,publishedAt:'2026-09-28T10:00:00Z',verified:true};
const directory={chainId:10143,items:[item],sponsors:1,checkedAt:'2026-09-28T10:00:00Z',refreshStatus:'current'};
test('directory metrics count only public verified facts, fail unknown rather than invent zero',()=>{
 assert.deepEqual(decodePublicDirectory(directory),directory);
 assert.deepEqual(directoryMetrics(directory),{active:1,finished:0,pots:1,sponsors:1,paidWei:'0',fundedWei:'100'});
 assert.equal(directoryMetrics({...directory,items:[{...item,verified:false}]}),null);
 for(const change of [d=>d.ownerUserId=id,d=>d.items[0].record={},d=>d.items.push(d.items[0]),d=>d.chainId=31337,d=>d.sponsors=2,d=>d.items[0].campaign.pots[0].paidWei='1']){
  const bad=structuredClone(directory);change(bad);assert.throws(()=>decodePublicDirectory(bad));
 }
});
test('finished requires terminal and settled pots; expired claims and paused pots remain active',()=>{
 const status=patch=>campaignStatus({...item,campaign:{...campaign,pots:[{...campaign.pots[0],...patch}]}});
 assert.equal(status({state:3,claimDeadline:'1800000100'}),'claiming');
 assert.equal(status({state:3,claimDeadline:'1799999999'}),'settling');
 assert.equal(status({state:4,remainingWei:'1'}),'settling');
 assert.equal(status({state:4,remainingWei:'0',paidWei:'90',returnedWei:'10'}),'finished');
 assert.equal(status({state:5,remainingWei:'0',returnedWei:'100'}),'cancelled');
 assert.equal(status({paused:true}),'paused');
 assert.equal(campaignStatus({...item,verified:false}),'unavailable');
});
const plan={version:4,launchId:id,setupRevision:1,configurationHash:'a'.repeat(64),chainId:10143,funder:'0x'+'11'.repeat(20),operator:'0x'+'22'.repeat(20),unallocatedTreasury:'0x'+'33'.repeat(20),expiredTreasury:'0x'+'11'.repeat(20),claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:['100','0','0','0','0','0'],budgetWei:'100'};
const saved={sponsors:1,items:[{campaign,selection:null,publishedAt:item.publishedAt,record:{plan,deploymentHash:'0x'+'aa'.repeat(32),fundingHash:hash}}]};
test('guest directory is read-only, shares concurrent reads, strips execution data and labels offline observations',async()=>{
 let calls=0;const responses=[];
 const deps={config:()=>({chainId:10143}),rpc:async(name,args)=>{calls++;assert.equal(name,'service_reward_public_directory');assert.deepEqual(args,{p_chain_id:10143});return{data:saved,error:null};},sponsorReader:{getChainId:async()=>{throw Error('offline');}},sendSuccess:(_,data)=>responses.push({status:200,data}),sendError:(_,status)=>responses.push({status})};
 const request=(method='GET',query='')=>dispatchPublicDirectory({method},{setHeader(){}},new URL('http://local/api/v1/rewards/public-campaigns'+query),deps);
 await request('POST');assert.equal(responses.pop().status,405);assert.equal(calls,0);
 await request('GET','?owner=private');assert.equal(responses.pop().status,400);assert.equal(calls,0);
 await Promise.all([request(),request()]);assert.equal(calls,1);
 for(const r of responses){assert.equal(r.status,200);assert.equal(r.data.items[0].verified,true);assert.deepEqual(Object.keys(r.data.items[0]).sort(),['campaign','publishedAt','selection','verified']);assert.equal(JSON.stringify(r.data).includes('funder'),false);}
});

test('cold response does not wait for live RPC; failed refresh retains verified amounts and original observation time',async()=>{
 let rejectRead;let reads=0;
 const held=new Promise((_,reject)=>{rejectRead=reject;});
 const responses=[];
 const deps={config:()=>({chainId:10143}),rpc:async()=>({data:saved,error:null}),sponsorReader:{getChainId:()=>{reads++;return held;}},sendSuccess:(_,data)=>responses.push(data),sendError:()=>assert.fail('unexpected failure')};
 const request=()=>dispatchPublicDirectory({method:'GET'},{setHeader(){}},new URL('http://local/api/v1/rewards/public-campaigns'),deps);
 await request(); // Would hang here under the old blocking implementation.
 assert.equal(responses[0].refreshStatus,'refreshing');
 assert.equal(responses[0].checkedAt,new Date(Number(campaign.blockTimestamp)*1000).toISOString());
 assert.equal(directoryMetrics(responses[0]).fundedWei,'100');
 await request();assert.equal(reads,1);
 rejectRead(Error('offline'));await new Promise(resolve=>setImmediate(resolve));
 await request();assert.equal(responses.at(-1).refreshStatus,'failed');
 assert.deepEqual(responses.at(-1).items,responses[0].items);
 assert.equal(responses.at(-1).checkedAt,responses[0].checkedAt);
 assert.equal(reads,1);
});
test('database failure and invalid public snapshots cannot produce made-up totals',async()=>{
 for(const data of [null,{...saved,items:[{...saved.items[0],campaign:{...campaign,budgetWei:'101'}}]}]){
  let status;
  await dispatchPublicDirectory({method:'GET'},{setHeader(){}},new URL('http://local/api/v1/rewards/public-campaigns'),{
   config:()=>({chainId:10143}),rpc:async()=>({data,error:null}),sponsorReader:{},sendSuccess:()=>assert.fail('invalid snapshot accepted'),sendError:(_,code)=>{status=code;}});
  assert.equal(status,503);
 }
});
test('offline reads preserve nonzero published payments and do not relabel their timestamp',async()=>{
 const paid=structuredClone(saved);Object.assign(paid.items[0].campaign.pots[0],{allocatedWei:'80',paidWei:'30',remainingWei:'70'});
 const responses=[];const deps={config:()=>({chainId:10143}),rpc:async()=>({data:paid,error:null}),sponsorReader:{getChainId:async()=>{throw Error('offline');}},sendSuccess:(_,data)=>responses.push(data),sendError:()=>assert.fail('unexpected failure')};
 const request=()=>dispatchPublicDirectory({method:'GET'},{setHeader(){}},new URL('http://local/api/v1/rewards/public-campaigns'),deps);
 await request();await new Promise(resolve=>setImmediate(resolve));await request();
 assert.equal(responses.at(-1).refreshStatus,'failed');assert.equal(directoryMetrics(responses.at(-1)).paidWei,'30');
 assert.equal(responses.at(-1).checkedAt,new Date(Number(campaign.blockTimestamp)*1000).toISOString());
});
test('stalled provider stops browser polling without overlapping verification work',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 let release,reads=0;const stalled=new Promise((_,reject)=>{release=reject;});const responses=[];
 const deps={config:()=>({chainId:10143}),rpc:async()=>({data:saved,error:null}),sponsorReader:{getChainId:()=>{reads++;return stalled;}},sendSuccess:(_,data)=>responses.push(data),sendError:()=>assert.fail('unexpected failure')};
 const request=()=>dispatchPublicDirectory({method:'GET'},{setHeader(){}},new URL('http://local/api/v1/rewards/public-campaigns'),deps);
 await request();t.mock.timers.tick(90_001);await new Promise(resolve=>setImmediate(resolve));await request();
 assert.equal(responses.at(-1).refreshStatus,'failed');assert.equal(reads,1);
 t.mock.timers.tick(120_000);await request();assert.equal(reads,1);
 release(Error('offline'));await new Promise(resolve=>setImmediate(resolve));
});

test('completed observations update one campaign immediately while other campaigns retain exact old facts',async()=>{
 const {mergeDirectoryObservation}=await import('../dist/routes/rewards/public-directory.js');
 const other={...item,campaign:{...campaign,id:'73000000-0000-4000-8000-000000000002'}};
 const directory=decodePublicDirectory({chainId:10143,items:[item,other],sponsors:1,checkedAt:new Date(1800000000*1000).toISOString(),refreshStatus:'refreshing'});
 const observed={address:campaign.address,funded:true,cancelled:false,fundingHash:hash,blockNumber:'101',blockTimestamp:'1800000010',
  pots:[{...campaign.pots[0],state:3,allocatedWei:'80',paidWei:'30',remainingWei:'70',claimDeadline:'1800010000',address:'0x'+'55'.repeat(20),entitlementCount:'4'}]};
 const next=mergeDirectoryObservation(directory,0,observed);
 assert.equal(next.items[0].campaign.pots[0].paidWei,'30');assert.equal(next.items[0].campaign.blockNumber,'101');
 assert.deepEqual(next.items[1],other);assert.equal(next.refreshStatus,'refreshing');assert.equal(next.checkedAt,directory.checkedAt);
 assert.equal(directory.items[0].campaign.pots[0].paidWei,'0');
 for(const patch of [{blockNumber:'99'},{blockTimestamp:'1799999999'},{funded:false},{address:other.campaign.id},{fundingHash:null},
  {pots:[{...observed.pots[0],paidWei:'101'}]}])assert.throws(()=>mergeDirectoryObservation(directory,0,{...observed,...patch}));
 assert.throws(()=>mergeDirectoryObservation(directory,2,observed));
});


test('hosted request waits for bounded refresh instead of relying on later process-local polls',async()=>{
 let rejectRead;const held=new Promise((_,reject)=>{rejectRead=reject;});const responses=[];
 const deps={config:()=>({chainId:10143}),rpc:async()=>({data:saved,error:null}),awaitRefresh:true,
 sponsorReader:{getChainId:()=>held},sendSuccess:(_,data)=>responses.push(data),sendError:()=>assert.fail('unexpected failure')};
 const request=()=>dispatchPublicDirectory({method:'GET'},{setHeader(){}},new URL('http://local/api/v1/rewards/public-campaigns'),deps);
 const first=request(),second=request();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(responses.length,0);rejectRead(Error('offline'));await Promise.all([first,second]);
 assert.equal(responses.length,2);for(const r of responses){assert.equal(r.refreshStatus,'failed');assert.deepEqual(r.items[0].campaign,campaign);}
});
test('hosted stalled refresh returns preserved facts at the deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let response;
 const deps={config:()=>({chainId:10143}),rpc:async()=>({data:saved,error:null}),awaitRefresh:true,
 sponsorReader:{getChainId:()=>new Promise(()=>{})},sendSuccess:(_,data)=>{response=data;},sendError:()=>assert.fail('unexpected failure')};
 const request=dispatchPublicDirectory({method:'GET'},{setHeader(){}},new URL('http://local/api/v1/rewards/public-campaigns'),deps);
 await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(90001);await request;
 assert.equal(response.refreshStatus,'failed');assert.deepEqual(response.items[0].campaign,campaign);
});
