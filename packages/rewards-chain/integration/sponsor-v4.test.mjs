import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {keccak256} from 'viem';
import {startOwnedRewardChain,fixtureSigner} from './owned-chain.mjs';
import {sponsorDeploymentData,sponsorFundingData,sponsorProgrammeBuild,sponsorCampaignBuild,observeSponsorProgramme} from '../dist/sponsor-v4.js';
import {dispatchSponsorExecution} from '../../../apps/api/dist/routes/rewards/sponsor-execution.js';

test('V4 exact saved policy → sponsor CREATE → atomic flexible funding → finalized receipt and runtime verification',{timeout:120000},async t=>{
 const chain=await startOwnedRewardChain();
 try {
  const p={version:4,launchId:'73000000-0000-4000-8000-000000000003',setupRevision:4,configurationHash:'a'.repeat(64),chainId:31337,
   funder:chain.operator.address.toLowerCase(),operator:fixtureSigner(0x881).address.toLowerCase(),unallocatedTreasury:chain.treasury.toLowerCase(),
   expiredTreasury:chain.operator.address.toLowerCase(),claimLifetime:7*86400,reviewPeriods:[0,86400,0,0,0,0],caps:['310000000000000000','0','130000000000000000','170000000000000000','200000000000000000','200000000000000000'],budgetWei:'1010000000000000000'};
  await t.test('compiled artifacts match the committed pins',()=>{
   for(const [name,pin]of [['RacesOnRewardProgrammeV4',sponsorProgrammeBuild],['RacesOnRewardCampaignV4',sponsorCampaignBuild]]){
    const a=JSON.parse(readFileSync(new URL(`../../../contracts/out/${name}.sol/${name}.json`,import.meta.url)));
    assert.equal(keccak256(a.bytecode.object),pin.creationCodeHash);assert.equal(keccak256(a.deployedBytecode.object),pin.runtimeTemplateHash);
    assert.deepEqual(Object.values(a.deployedBytecode.immutableReferences).flat().map(r=>r.start).sort((a,b)=>a-b),Object.values(pin.offsets).flat().sort((a,b)=>a-b));
   }
  });
  await t.test('operator pays deployment; sponsor remains the exact funder and refund recipient',async()=>{
   const operator=fixtureSigner(0x881);
   await chain.testClient.setBalance({address:operator.address,value:10n**19n});
   const sponsorBefore=await chain.publicClient.getBalance({address:p.funder});
   const operatorBefore=await chain.publicClient.getBalance({address:operator.address});
   const hash=await chain.operatorClient.sendTransaction({account:operator,data:sponsorDeploymentData(p),gas:25_000_000n});
   const receipt=await chain.publicClient.waitForTransactionReceipt({hash});assert.equal(receipt.status,'success');
   assert.equal(await chain.publicClient.getBalance({address:p.funder}),sponsorBefore);
   assert.equal(operatorBefore-await chain.publicClient.getBalance({address:operator.address}),(await chain.publicClient.getTransaction({hash})).gas*receipt.effectiveGasPrice);
   await chain.testClient.mine({blocks:96,interval:1});
   const observed=await observeSponsorProgramme(chain.publicClient,p,hash);assert.equal(observed.address.toLowerCase(),receipt.contractAddress.toLowerCase());assert.equal(observed.funded,false);
   const funding=await chain.operatorClient.sendTransaction({to:observed.address,data:sponsorFundingData(),value:BigInt(p.budgetWei),gas:2_000_000n});
   assert.equal((await chain.publicClient.waitForTransactionReceipt({hash:funding})).status,'success');
   await chain.testClient.mine({blocks:96,interval:1});assert.equal((await observeSponsorProgramme(chain.publicClient,p,hash,funding)).funded,true);
   const outsider=await chain.relayerClient.sendTransaction({data:sponsorDeploymentData(p),gas:25_000_000n});
   await chain.publicClient.waitForTransactionReceipt({hash:outsider});await chain.testClient.mine({blocks:96,interval:1});
   const sponsored=await observeSponsorProgramme(chain.publicClient,p,outsider);
   assert.equal(sponsored.funded,false);
   assert.equal((await chain.publicClient.readContract({address:sponsored.address,abi:[{type:"function",name:"operator",inputs:[],outputs:[{type:"address"}],stateMutability:"view"}],functionName:"operator"})).toLowerCase(),p.operator);
  });
  const deployment=await chain.operatorClient.sendTransaction({data:sponsorDeploymentData(p),gas:25_000_000n});
  const receipt=await chain.publicClient.waitForTransactionReceipt({hash:deployment});assert.equal(receipt.status,'success');
  await chain.testClient.mine({blocks:96,interval:1});
  const first=await observeSponsorProgramme(chain.publicClient,p,deployment);
  assert.equal(first.funded,false);assert.equal(first.pots.length,5);assert.deepEqual(first.pots.map(x=>x.slot),[0,2,3,4,5]);
  await t.test('wrong authority, policies, source commitment, chain and runtime reject',async()=>{
   for(const patch of [{operator:fixtureSigner(0x882).address.toLowerCase()},{claimLifetime:86400},{configurationHash:'b'.repeat(64)},{chainId:10143}])
    await assert.rejects(observeSponsorProgramme(chain.publicClient,{...p,...patch},deployment));
   await assert.rejects(observeSponsorProgramme({...chain.publicClient,getCode:async()=> '0x6000'},p,deployment));
   await assert.rejects(observeSponsorProgramme({...chain.publicClient,getBlock:async args=>{const block=await chain.publicClient.getBlock(args);return args.blockNumber===receipt.blockNumber?{...block,hash:'0x'+'b'.repeat(64)}:block;}},p,deployment));
  });
  const funding=await chain.operatorClient.sendTransaction({to:first.address,data:sponsorFundingData(),value:BigInt(p.budgetWei),gas:2_000_000n});
  assert.equal((await chain.publicClient.waitForTransactionReceipt({hash:funding})).status,'success');
  await chain.testClient.mine({blocks:96,interval:1});
  const funded=await observeSponsorProgramme(chain.publicClient,p,deployment,funding);
  assert.equal(funded.funded,true);assert.equal(funded.fundingHash,funding);assert.equal(funded.pots.reduce((sum,p)=>sum+BigInt(p.amountWei),0n),BigInt(p.budgetWei));
  await assert.rejects(observeSponsorProgramme(chain.publicClient,p,deployment,deployment));
  await t.test('API persists only independently verified receipts and rechecks the live owner session',async()=>{
   let record={plan:p,deploymentHash:null,fundingHash:null},body={action:'deployment',hash:deployment},response,writes=0;
   const deps={config:()=>({chainId:31337}),requireIdentity:async()=>({userId:'73000000-0000-4000-8000-000000000004',sessionId:'73000000-0000-4000-8000-000000000005'}),
    sponsorReader:chain.publicClient,sponsorPolicy:()=>null,readJsonBody:async()=>body,applyPrivateSessionHeaders(){},
    sendSuccess:(_r,data)=>response={status:200,data},sendError:(_r,status,code)=>response={status,code},
    rpc:async(_name,args)=>{if(args.p_deployment_hash){writes++;record={...record,deploymentHash:args.p_deployment_hash};}if(args.p_funding_hash){writes++;record={...record,fundingHash:args.p_funding_hash};}return{data:record,error:null};}};
   const res={setHeader(){}},url=new URL('http://local/api/v1/rewards/distribution-setups/73000000-0000-4000-8000-000000000001/execution');
   await dispatchSponsorExecution({method:'POST'},res,url,deps);assert.equal(response.status,200);assert.equal(writes,1);
   body={action:'funding',hash:deployment};await dispatchSponsorExecution({method:'POST'},res,url,deps);assert.equal(response.status,422);assert.equal(response.code,'sponsor_receipt_mismatch');assert.equal(writes,1);
   body={action:'funding',hash:funding};await dispatchSponsorExecution({method:'POST'},res,url,deps);assert.equal(response.status,200);assert.equal(writes,2);
   assert.equal(response.data.observation.funded,true);
   let calls=0;await dispatchSponsorExecution({method:'GET'},res,url,{...deps,rpc:async()=>++calls===1?{data:record,error:null}:{data:null,error:{message:'reward_account_session_required'}}});
   assert.equal(response.status,401);assert.equal(calls,2);
  });
  // Replaying funding cannot create a second set of balances.
  const duplicate=await chain.operatorClient.sendTransaction({to:first.address,data:sponsorFundingData(),value:BigInt(p.budgetWei),gas:2_000_000n});
  assert.equal((await chain.publicClient.waitForTransactionReceipt({hash:duplicate})).status,'reverted');
  await t.test('finalized payout projection follows allocation, consent, payment, pause and separate returns',async()=>{
   // Entirely synthetic sporting evidence and signers, confined to this owned Anvil.
   const operator=fixtureSigner(0x881),recipient=fixtureSigner(0x883),child=funded.pots.find(p=>p.slot===0).address;
   const abi=JSON.parse(readFileSync(new URL('../../../contracts/out/RacesOnRewardCampaignV4.sol/RacesOnRewardCampaignV4.json',import.meta.url))).abi;
   await chain.testClient.setBalance({address:operator.address,value:10n**18n});
   const read=functionName=>chain.publicClient.readContract({address:child,abi,functionName});
   async function write(functionName,args=[]){const hash=await chain.operatorClient.writeContract({account:operator,address:child,abi,functionName,args,gas:2_000_000n});assert.equal((await chain.publicClient.waitForTransactionReceipt({hash})).status,'success');}
   async function inspect(){await chain.testClient.mine({blocks:96,interval:1});return(await observeSponsorProgramme(chain.publicClient,p,deployment,funding)).pots.find(p=>p.slot===0);}
   const h=n=>'0x'+String(n).padStart(64,'0'),awardAmount=100000000000000000n;
   await write('uploadAwards',[ [1,2].map(n=>({entitlementId:h(n),beneficiaryId:h(n+10),pot:1,amount:awardAmount,explanationHash:h(n+20),beneficiaryKind:0})) ]);
   let pot=await inspect();assert.equal(pot.state,1);assert.equal(pot.allocatedWei,(2n*awardAmount).toString());assert.equal(pot.entitlementCount,'2');assert.equal(pot.paidWei,'0');
   const timestamp=(await chain.publicClient.getBlock()).timestamp;
   await write('stageAllocation',[h(31),await read('uploadDigest'),2n,timestamp,timestamp,h(32)]);
   assert.equal((await inspect()).state,2);
   const digest=await read('allocationDigest');await write('activate',[digest,h(31)]);
   pot=await inspect();assert.equal(pot.state,3);assert.equal(pot.paidWei,'0');
   const issuedAt=(await chain.publicClient.getBlock()).timestamp,expiresAt=issuedAt+600n;
   const [approvalHash,receiptHash]=await chain.publicClient.readContract({address:child,abi,functionName:'claimDigests',args:[h(1),recipient.address,0n,issuedAt,expiresAt]});
   const before=await chain.publicClient.getBalance({address:recipient.address});
   await write('claim',[h(1),recipient.address,0n,issuedAt,expiresAt,await operator.sign({hash:approvalHash}),await recipient.sign({hash:receiptHash})]);
   pot=await inspect();assert.equal(pot.paidWei,awardAmount.toString());assert.equal(BigInt(pot.remainingWei),BigInt(pot.amountWei)-awardAmount);
   assert.equal(await chain.publicClient.getBalance({address:recipient.address}),before+awardAmount);
   await write('pause');assert.equal((await inspect()).paused,true);
   await write('resume');assert.equal((await inspect()).paused,false);
   await chain.testClient.setNextBlockTimestamp({timestamp:await read('claimDeadline')+1n});await chain.testClient.mine({blocks:1});
   await write('close');await write('returnExpired');await write('returnUnallocated');
   pot=await inspect();assert.equal(pot.state,4);assert.equal(pot.remainingWei,'0');
   assert.equal(BigInt(pot.paidWei)+BigInt(pot.returnedWei),BigInt(pot.amountWei));
   // Other race pots have not been allocated or drained by the league's lifecycle.
   const final=await observeSponsorProgramme(chain.publicClient,p,deployment,funding);
   assert.ok(final.pots.filter(p=>p.slot!==0).every(p=>p.state===1&&p.remainingWei===p.amountWei&&p.paidWei==='0'));
  });
 } finally {await chain.stop();}
});
