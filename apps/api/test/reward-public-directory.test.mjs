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

test('hosted snapshot returns dated public facts without starting or awaiting chain work',async()=>{
 let reads=0,chainReads=0;const responses=[];
 const deps={config:()=>({chainId:10143}),awaitRefresh:true,
  rpc:async()=>{reads++;return {data:saved,error:null};},
  sponsorReader:{getChainId:()=>{chainReads++;return new Promise(()=>{});}},
  sendSuccess:(_,data)=>responses.push({status:200,data}),sendError:(_,status)=>responses.push({status})};
 const request=(method='GET',query='')=>dispatchPublicDirectory({method},{setHeader(){}},new URL('http://local/api/v1/rewards/public-campaigns/snapshot'+query),deps);
 await request();
 const result=responses.pop();assert.equal(result.status,200);assert.equal(result.data.refreshStatus,'published');
 assert.deepEqual(result.data.items,[item]);assert.equal(result.data.checkedAt,new Date(Number(campaign.blockTimestamp)*1000).toISOString());
 assert.equal(JSON.stringify(result.data).includes('record'),false);assert.equal(JSON.stringify(result.data).includes('funder'),false);
 assert.equal(reads,1);assert.equal(chainReads,0);
 for(const [method,query,status] of [['POST','',405],['GET','?owner=private',400],['GET','?refresh=true',400]]){
  await request(method,query);assert.equal(responses.pop().status,status);
 }
 assert.equal(reads,1);assert.equal(chainReads,0);
});
test('snapshot fails closed on invalid publications and does not truncate a large directory',async()=>{
 for(const data of [null,{...saved,items:[{...saved.items[0],campaign:{...campaign,wallet:'private'}}]},
  {...saved,items:Array.from({length:201},(_,i)=>({...saved.items[0],campaign:{...campaign,id:`73000000-0000-4000-8000-${String(i).padStart(12,'0')}`}}))}]){
  let status;await dispatchPublicDirectory({method:'GET'},{setHeader(){}},new URL('http://local/api/v1/rewards/public-campaigns/snapshot'),{
   config:()=>({chainId:10143}),rpc:async()=>({data,error:null}),sponsorReader:{},sendSuccess:()=>assert.fail('invalid publication accepted'),sendError:(_,code)=>{status=code;}});
  assert.equal(status,503);
 }
});

test('directory refresh refills at most 16 worker slots without waiting for a slow campaign',async()=>{
 let reads=0,active=0,peak=0;const release=[];const responses=[];
 const data={...saved,items:Array.from({length:33},(_,i)=>({...saved.items[0],campaign:{...campaign,id:`73000000-0000-4000-8000-${String(i).padStart(12,'0')}`}}))};
 const deps={config:()=>({chainId:10143}),rpc:async()=>({data,error:null}),awaitRefresh:true,
  sponsorReader:{getChainId:()=>{reads++;active++;peak=Math.max(peak,active);return new Promise((_,reject)=>{release.push(()=>{active--;reject(Error('offline'));});});}},
  sendSuccess:(_,data)=>responses.push(data),sendError:()=>assert.fail('unexpected failure')};
 const pending=dispatchPublicDirectory({method:'GET'},{setHeader(){}},new URL('http://local/api/v1/rewards/public-campaigns'),deps);
 const settle=()=>new Promise(resolve=>setImmediate(resolve));await settle();assert.equal(reads,16);
 // Keep campaign zero pending. Each freed slot should start the next campaign.
 for(let i=1;i<18;i++){release[i]();await settle();assert.equal(reads,Math.min(33,16+i));}
 assert.equal(responses.length,0);assert.equal(peak,16);
 release[0]();for(let i=18;i<33;i++)release[i]();await pending;
 assert.equal(responses[0].refreshStatus,'failed');assert.equal(responses[0].items.length,33);
 for(const item of responses[0].items)assert.equal(item.campaign.blockTimestamp,campaign.blockTimestamp);
});

test('a full directory stops scheduling at the deadline and cannot overlap its stalled workers',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 let reads=0;const release=[],responses=[];
 const data={...saved,items:Array.from({length:200},(_,i)=>({...saved.items[0],campaign:{...campaign,id:`73000000-0000-4000-8000-${String(i).padStart(12,'0')}`}}))};
 const deps={config:()=>({chainId:10143}),rpc:async()=>({data,error:null}),awaitRefresh:true,
  sponsorReader:{getChainId:()=>{reads++;return new Promise((_,reject)=>release.push(()=>reject(Error('offline'))));}},
  sendSuccess:(_,value)=>responses.push(value),sendError:()=>assert.fail('unexpected failure')};
 const request=()=>dispatchPublicDirectory({method:'GET'},{setHeader(){}},new URL('http://local/api/v1/rewards/public-campaigns'),deps);
 const pending=request();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,16);
 t.mock.timers.tick(90001);await pending;
 assert.equal(responses[0].refreshStatus,'failed');assert.equal(responses[0].items.length,200);
 t.mock.timers.tick(120000);await request();assert.equal(reads,16,'a second refresh must not overlap stalled work');
 for(const reject of release)reject();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reads,16,'expired workers must not start the remaining campaigns');
 assert.deepEqual(responses[0].items.map(i=>i.campaign),data.items.map(i=>i.campaign));
});

test('saved summaries preload confirmed payments in a new server instance without chain reads',async()=>{
 const {saveDirectorySummary}=await import('../dist/features/rewards/public-directory-cache.js');
 const {mergeDirectoryObservation}=await import('../dist/routes/rewards/public-directory.js');
 const entries=new Map();const summaryCache={get:async key=>entries.get(key),set:async(key,value,options)=>{
  assert.equal(options.ttl,86400);assert.equal(JSON.stringify(value).includes('record'),false);entries.set(key,structuredClone(value));}};
 const observed={address:campaign.address,funded:true,cancelled:false,fundingHash:hash,blockNumber:'101',blockTimestamp:'1800000010',
  pots:[{...campaign.pots[0],state:3,allocatedWei:'80',paidWei:'30',remainingWei:'70',claimDeadline:'1800010000',address:'0x'+'55'.repeat(20),entitlementCount:'4'}]};
 const verified=mergeDirectoryObservation(directory,0,observed);
 await saveDirectorySummary(verified.items[0],summaryCache);
 for(let instance=0;instance<2;instance++){
  let data;const headers={};
  await dispatchPublicDirectory({method:'GET'},{setHeader:(name,value)=>{headers[name]=value;}},new URL('http://local/api/v1/rewards/public-campaigns/snapshot'),{
   config:()=>({chainId:10143}),rpc:async()=>({data:saved,error:null}),summaryCache,
   sponsorReader:{getChainId:()=>assert.fail('snapshot must not start a chain read')},
   sendSuccess:(_,value)=>{data=value;},sendError:()=>assert.fail('snapshot failed')});
  assert.equal(directoryMetrics(data).paidWei,'30');assert.equal(campaignStatus(data.items[0]),'claiming');
  assert.equal(data.checkedAt,'2027-01-15T08:00:10.000Z');assert.equal(data.refreshStatus,'published');
  assert.match(headers['Server-Timing'],/^summaries;dur=[0-9]+\.[0-9];desc="1 saved"$/);
 }
 // A late older verification must not replace a newer saved observation.
 await saveDirectorySummary(item,summaryCache);
 assert.equal([...entries.values()][0].items[0].campaign.blockNumber,'101');
});

test('cache misses, failures, foreign identity and private fields retain original dated publications',async()=>{
 const {readDirectorySummaries,saveDirectorySummary,hostedPublicDirectoryCache}=await import('../dist/features/rewards/public-directory-cache.js');
 const warm=structuredClone(directory);warm.items[0].campaign.blockNumber='101';warm.items[0].campaign.blockTimestamp='1800000010';
 const bad=[null,{...warm,wallet:'private'}, {...warm,chainId:31337}];
 for(const mutate of [d=>d.items[0].publishedAt='2026-10-01T00:00:00Z',d=>d.items[0].verified=false,
  d=>d.items[0].campaign.address='0x'+'22'.repeat(20),d=>d.items[0].campaign.name='Replaced campaign',
  d=>d.items[0].campaign.pots[0].groups[0].name='Changed category',d=>d.items[0].campaign.blockTimestamp='1799999999']){
  const value=structuredClone(warm);mutate(value);bad.push(value);
 }
 for(const value of bad){const result=await readDirectorySummaries(directory,{get:async()=>value,set:async()=>{}});assert.deepEqual(result.items,directory.items);}
 const failed={get:async()=>{throw Error('offline');},set:async()=>{throw Error('offline');}};
 assert.deepEqual((await readDirectorySummaries(directory,failed)).items,directory.items);
 await saveDirectorySummary(item,failed);
 await assert.rejects(()=>saveDirectorySummary({...item,campaign:{...campaign,wallet:'private'}},failed));
 assert.equal(hostedPublicDirectoryCache({}),undefined);assert.equal(hostedPublicDirectoryCache({VERCEL:'1'}),undefined);
});

test('stalled shared cache has a bounded fallback and never holds publication loading indefinitely',async t=>{
 const {readDirectorySummaries}=await import('../dist/features/rewards/public-directory-cache.js');
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=readDirectorySummaries(directory,{get:()=>new Promise(()=>{}),set:async()=>{}});
 await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(1001);
 assert.deepEqual((await pending).items,directory.items);
});

test('public merges preserve membership, publication identity, monotonic observations and the freshness window',async()=>{
 const {mergePublicDirectory,publicDirectoryIsFresh}=await import('@raceson/domain/rewards/public-directory');
 const newer=structuredClone(directory);newer.items[0].campaign.blockNumber='101';newer.items[0].campaign.blockTimestamp='1800000010';
 const merged=mergePublicDirectory(directory,newer);
 assert.equal(merged.items[0].campaign.blockNumber,'101');assert.equal(merged.checkedAt,'2027-01-15T08:00:10.000Z');
 assert.deepEqual(mergePublicDirectory(merged,directory),merged);
 assert.deepEqual(mergePublicDirectory({...directory,items:[],sponsors:0},newer).items,[]);
 assert.deepEqual(mergePublicDirectory({...directory,items:[{...item,publishedAt:'2026-10-10T00:00:00Z'}]},newer).items[0].campaign,campaign);
 const at=Date.parse(merged.checkedAt);
 assert.equal(publicDirectoryIsFresh(merged,at),true);assert.equal(publicDirectoryIsFresh(merged,at+59999),true);
 assert.equal(publicDirectoryIsFresh(merged,at+60000),false);assert.equal(publicDirectoryIsFresh(merged,at-1),false);
 assert.equal(publicDirectoryIsFresh({...merged,items:[{...merged.items[0],verified:false}]},at),false);
});
