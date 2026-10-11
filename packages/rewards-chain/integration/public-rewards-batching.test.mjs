import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPublicClient,http} from 'viem';
import {startOwnedRewardChain} from './owned-chain.mjs';
import {sponsorDeploymentData,sponsorFundingData} from '../dist/sponsor-v4.js';
import {controllerReadBatch} from '../dist/canary-public-client.js';
import {rewardUploadDigest} from '../dist/index.js';
import {publicAwardPage} from '../../../apps/api/dist/features/rewards/public-awards-service.js';
import {createPublicPotObserver} from '../../../apps/api/dist/features/rewards/public-pot-observation.js';

// Real EVM reads on an owned, disposable chain. Counts transport work with the
// hosted deployless batching configuration; does not call testnet or use keys.
test('302 league rewards keep identical verified rows while batching cuts repeated RPC work',{timeout:120000},async()=>{
 const chain=await startOwnedRewardChain();
 try{
  const h=n=>'0x'+n.toString(16).padStart(64,'0'),budget=10n**18n;
  const plan={version:4,launchId:'73000000-0000-4000-8000-000000000096',setupRevision:1,configurationHash:'d'.repeat(64),chainId:31337,
   funder:chain.relayer.address.toLowerCase(),operator:chain.operator.address.toLowerCase(),unallocatedTreasury:chain.treasury.toLowerCase(),expiredTreasury:chain.operator.address.toLowerCase(),
   claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:[budget.toString(),'0','0','0','0','0'],budgetWei:budget.toString()};
  const receipt=async hash=>{const r=await chain.publicClient.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return r;};
  const deployment=await chain.operatorClient.sendTransaction({data:sponsorDeploymentData(plan),gas:25_000_000n}),created=await receipt(deployment);
  const funding=await chain.relayerClient.sendTransaction({to:created.contractAddress,data:sponsorFundingData(),value:budget,gas:2_000_000n});await receipt(funding);
  await chain.testClient.mine({blocks:96,interval:1});
  const endpoint=chain.publicClient.transport.url;assert.match(endpoint,/^http:\/\/127\.0\.0\.1:\d+$/);
  const rpc=[];
  const reader=createPublicClient({chain:chain.publicClient.chain,cacheTime:0,batch:controllerReadBatch,
   transport:http(endpoint,{retryCount:0,onFetchRequest:async req=>{rpc.push((await req.clone().json()).method);}})});
  const observer=createPublicPotObserver(),funded=await observer.programme(reader,plan,deployment,funding),pot=funded.pots[0];
  const abi=JSON.parse(readFileSync(new URL('../../../contracts/out/RacesOnRewardCampaignV4.sol/RacesOnRewardCampaignV4.json',import.meta.url))).abi;
  const awards=Array.from({length:302},(_,i)=>({entitlementId:h(i+1),beneficiaryId:h(i+1001),explanationHash:h(i+2001),pot:1,beneficiaryKind:0,amount:BigInt(i+1)}));
  for(let offset=0;offset<awards.length;offset+=25)await receipt(await chain.operatorClient.writeContract({address:pot.address,abi,functionName:'uploadAwards',args:[awards.slice(offset,offset+25)],gas:6_000_000n}));
  await chain.testClient.mine({blocks:96,interval:1});
  const current=await observer.programme(reader,plan,deployment,funding),block=BigInt(current.blockNumber);
  const raw={chainId:31337,slot:0,programmeAddress:funded.address,campaignAddress:pot.address,fundingHash:funding,
   uploadDigest:rewardUploadDigest(awards,1,budget).digest,awards:awards.map(a=>({...a,amount:a.amount.toString()}))};
  const scope={id:plan.launchId,chainId:31337,slot:0};
  async function collect(limit){
   rpc.length=0;
   const pages=[];
   const read=async offset=>{
    const observed=await observer(reader,plan,deployment,funding,0,block);
    pages[offset/limit]=await publicAwardPage(reader,observed,scope,raw,{offset,sort:'reward',direction:'asc',blockNumber:current.blockNumber,limit});
   };
   // Isolate per-request RPC cost from incidental same-process coalescing.
   // The UI regression separately verifies four-worker scheduling.
   for(let offset=0;offset<302;offset+=limit)await read(offset);
   return {rows:pages.flatMap(p=>p.rows),requests:pages.length,rpc:rpc.length,calls:rpc.filter(method=>method==='eth_call').length};
  }
  const legacy=await collect(25),batch=await collect(500);
  assert.equal(legacy.requests,13);assert.equal(batch.requests,1);
  assert.equal(batch.rows.length,302);assert.deepEqual(batch.rows,legacy.rows);
  assert.ok(batch.rpc<=legacy.rpc*0.4,JSON.stringify({legacy,batch},(key,value)=>key==='rows'?undefined:value));
  assert.ok(batch.calls<=legacy.calls*0.4);
  console.log(JSON.stringify({leagueRows:302,legacy:{requests:legacy.requests,rpc:legacy.rpc,calls:legacy.calls},batch:{requests:batch.requests,rpc:batch.rpc,calls:batch.calls}}));
 }finally{await chain.stop();}
});
