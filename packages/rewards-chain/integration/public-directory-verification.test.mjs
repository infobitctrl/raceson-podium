import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPublicClient,encodeDeployData,http} from 'viem';
import {startOwnedRewardChain,fixtureSigner} from './owned-chain.mjs';
import {controllerReadBatch,publicDirectoryRpcBatch} from '../dist/canary-public-client.js';
import {observePublicSponsorProgramme,sponsorFactoryData,sponsorFactoryProgrammeAddress,sponsorFundingData} from '../dist/sponsor-v4.js';
import {sponsorFactoryBuildV5,walletRegistryBuildV1} from '../dist/sponsor-v5-build.js';
const artifact=name=>JSON.parse(readFileSync(new URL(`../../../contracts/out/${name}.sol/${name}.json`,import.meta.url)));

// The hosted directory has many independent programmes sharing one factory and
// registry. This fixture deploys its own contracts and never uses hosted data.
test('15 independently funded programmes retain exact full observations with less directory RPC work',{timeout:180000},async()=>{
 const chain=await startOwnedRewardChain();
 try{
  const send=async tx=>{
   const hash=await chain.operatorClient.sendTransaction({...tx,gas:tx.gas??2_000_000n});
   const receipt=await chain.publicClient.waitForTransactionReceipt({hash});
   assert.equal(receipt.status,'success');return receipt;
  };
  const issuer=fixtureSigner(0x901).address.toLowerCase();
  const registry=(await send({data:encodeDeployData({abi:artifact('RacesOnWalletRegistryV1').abi,bytecode:walletRegistryBuildV1.bytecode,args:[issuer]})})).contractAddress;
  const factory=(await send({data:sponsorFactoryBuildV5.bytecode,gas:8_000_000n})).contractAddress;
  const records=[];
  for(let index=0;index<15;index++){
   const caps=index<10?['100','100','100','100','100','100']:['100','0','0','0','0','0'];
   const plan={version:5,chainId:31337,launchId:`73000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,
    setupRevision:1,configurationHash:'a'.repeat(64),funder:chain.operator.address.toLowerCase(),
    operator:fixtureSigner(0x902).address.toLowerCase(),unallocatedTreasury:chain.treasury.toLowerCase(),
    expiredTreasury:chain.operator.address.toLowerCase(),walletRegistry:registry.toLowerCase(),identityIssuer:issuer,
    claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps,budgetWei:caps.reduce((sum,n)=>sum+BigInt(n),0n).toString()};
   const deployment=await send({to:factory,data:sponsorFactoryData(plan),gas:25_000_000n});
   const address=sponsorFactoryProgrammeAddress(plan,factory);
   const funding=await send({to:address,data:sponsorFundingData(),value:BigInt(plan.budgetWei)});
   records.push({plan,deploymentHash:deployment.transactionHash,fundingHash:funding.transactionHash});
  }
  await chain.testClient.mine({blocks:96,interval:1});
  const endpoint=chain.publicClient.transport.url;assert.match(endpoint,/^http:\/\/127\.0\.0\.1:\d+$/);
  async function measure(shared){
   const requests={};let httpRequests=0,maxBatch=0,tail=Promise.resolve(),next=0;
   const reader=createPublicClient({chain:chain.publicClient.chain,cacheTime:0,batch:controllerReadBatch,
    transport:http(endpoint,{retryCount:0,...(shared?{batch:publicDirectoryRpcBatch}:{}),onFetchRequest:async request=>{
     const body=await request.clone().json(),calls=Array.isArray(body)?body:[body];httpRequests++;maxBatch=Math.max(maxBatch,calls.length);
     for(const {method} of calls)requests[method]=(requests[method]??0)+1;
     // A 20 ms start interval keeps CI short; the live transport remains 200 ms.
     const turn=tail.then(async()=>{const wait=next-performance.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));next=performance.now()+20;});
     tail=turn.catch(()=>{});await turn;
    }})});
   const observe=(plan,deployment,funding)=>observePublicSponsorProgramme(reader,plan,deployment,funding);
   let nextIndex=0;const results=Array(records.length),start=performance.now();
   await Promise.all(Array.from({length:4},async()=>{while(nextIndex<records.length){const i=nextIndex++,r=records[i];results[i]=await observe(r.plan,r.deploymentHash,r.fundingHash);}}));
   return {results,requests,httpRequests,maxBatch,total:Object.values(requests).reduce((a,b)=>a+b,0),milliseconds:Math.round(performance.now()-start)};
  }
  const before=await measure(false),after=await measure(true);
  console.log(JSON.stringify({directoryCampaigns:15,pots:65,modelStartIntervalMs:20,
   before:{requests:before.requests,httpRequests:before.httpRequests,total:before.total,milliseconds:before.milliseconds},
   after:{requests:after.requests,httpRequests:after.httpRequests,total:after.total,milliseconds:after.milliseconds}}));
  assert.deepEqual(after.results,before.results);
  assert.equal(after.results.length,15);assert.equal(after.results.flatMap(r=>r.pots).length,65);
  assert.ok(after.httpRequests<before.httpRequests*0.65,'directory must reduce network requests, not just hide loading');
  assert.equal(after.maxBatch,2);assert.equal(before.maxBatch,1);
  assert.equal(after.requests.eth_getTransactionByHash,before.requests.eth_getTransactionByHash);
  assert.equal(after.requests.eth_getTransactionReceipt,before.requests.eth_getTransactionReceipt);
  assert.equal(after.requests.eth_getBalance,before.requests.eth_getBalance);

 }finally{await chain.stop();}
});
