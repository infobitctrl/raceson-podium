import test from 'node:test';
import assert from 'node:assert/strict';
import {startOwnedRewardChain} from './owned-chain.mjs';
import {sponsorDeploymentData,sponsorFundingData,observeSponsorProgramme} from '../dist/sponsor-v4.js';
import {observeSponsorLifecycleV4,sponsorLifecycleDataV4} from '../dist/sponsor-lifecycle-v4.js';
const h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
test('58 approved awards upload in bounded batches with exact prefix recovery and unchanged totals',{timeout:120000},async()=>{
 const c=await startOwnedRewardChain();
 try{
  const plan={version:4,launchId:'73000000-0000-4000-8000-000000000003',setupRevision:1,configurationHash:'a'.repeat(64),chainId:31337,
   funder:c.relayer.address.toLowerCase(),operator:c.operator.address.toLowerCase(),unallocatedTreasury:c.treasury.toLowerCase(),expiredTreasury:c.relayer.address.toLowerCase(),
   claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:['1000000000000000000','0','0','0','0','0'],budgetWei:'1000000000000000000'};
  const deploymentHash=await c.operatorClient.sendTransaction({data:sponsorDeploymentData(plan),gas:25000000n});
  const deployed=await c.publicClient.waitForTransactionReceipt({hash:deploymentHash});assert.equal(deployed.status,'success');await c.testClient.mine({blocks:96,interval:1});
  const fundingHash=await c.relayerClient.sendTransaction({to:deployed.contractAddress,data:sponsorFundingData(),value:BigInt(plan.budgetWei),gas:2000000n});
  assert.equal((await c.publicClient.waitForTransactionReceipt({hash:fundingHash})).status,'success');await c.testClient.mine({blocks:96,interval:1});
  const programme=await observeSponsorProgramme(c.publicClient,plan,deploymentHash,fundingHash);
  const awards=Array.from({length:58},(_,i)=>({entitlementId:h(i+1),beneficiaryId:h(i+101),pot:1,amount:1n,explanationHash:h(i+201),beneficiaryKind:0}));
  const input={plan,slot:0,deploymentHash,fundingHash,campaignAddress:programme.pots[0].address,snapshotDigest:h(900),awards,
   publication:{reviewPeriod:'0',reviewStartedAt:'1800000000',officialPublishedAt:'1800000000',publicationEvidenceHash:h(901)}};
  const estimate=async(start,end)=>c.publicClient.estimateGas({account:c.operator.address,to:input.campaignAddress,data:sponsorLifecycleDataV4(input,'upload',start,end),value:0n});
  const fee=gas=>((gas*12n+9n)/10n)*102000000000n;
  // A legacy valid 58-row receipt remains encodable; it is too costly as a new batch.
  assert.ok(fee(await estimate(0,58))>500000000000000000n);
  const larger={...input,awards:Array.from({length:65},(_,i)=>({...awards[0],entitlementId:h(i+1),beneficiaryId:h(i+101)}))};
  assert.throws(()=>sponsorLifecycleDataV4(larger,'upload',0,65));
  for(const [start,end] of [[0,32],[32,58]]){
   const observed=await observeSponsorLifecycleV4(c.publicClient,input);assert.equal(observed.next,'upload');assert.equal(observed.start,start);assert.equal(observed.end,end);
   const gas=await estimate(start,end);assert.ok(fee(gas)<=500000000000000000n);
   const hash=await c.operatorClient.sendTransaction({to:input.campaignAddress,data:sponsorLifecycleDataV4(input,'upload',start,end),gas:(gas*12n+9n)/10n});
   assert.equal((await c.publicClient.waitForTransactionReceipt({hash})).status,'success');await c.testClient.mine({blocks:96,interval:1});
  }
  const completed=await observeSponsorLifecycleV4(c.publicClient,input);assert.equal(completed.next,'stage');assert.equal(completed.start,58);assert.equal(completed.pot.allocatedWei,'58');assert.equal(completed.pot.paidWei,'0');
 }finally{await c.stop();}
});
