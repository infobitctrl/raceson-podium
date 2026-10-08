import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeEventLog,encodeDeployData,encodeFunctionData,hashTypedData,keccak256,toHex} from 'viem';
import {startOwnedRewardChain,fixtureSigner} from './owned-chain.mjs';
import {deployOriginalClubSafeFixture} from './safe-deployment-fixture.mjs';
import {clubOwnersHashV1,walletBindingMessageV2,encodeWalletRegistrationV2,clubClaimMessageV6,encodeClubClaimV6} from '../dist/club-signatures-v6.js';
import {directSafeMessageV5,verifyDirectSafeSignaturesV5,encodeDirectSafeCallV5} from '../dist/sponsor-club-direct-v5.js';
import {sponsorProgrammeBuildV6,sponsorCampaignBuildV6,sponsorFactoryBuildV6,walletRegistryBuildV2} from '../dist/sponsor-v6-build.js';
const artifact=name=>JSON.parse(readFileSync(new URL(`../../../contracts/out/${name}.sol/${name}.json`,import.meta.url)));
const h=n=>toHex(BigInt(n),{size:32});
for(const chainId of [31337,10143])test(`V6 two fresh owners: factory → funding → approval → registration → claim, owned chain ${chainId}`,{timeout:120000},async()=>{
 const chain=await startOwnedRewardChain({chainId});
 try{
  for(const [name,pin] of [['RacesOnRewardProgrammeV6',sponsorProgrammeBuildV6],['RacesOnRewardCampaignV6',sponsorCampaignBuildV6],['RacesOnSponsorFactoryV6',sponsorFactoryBuildV6],['RacesOnWalletRegistryV2',walletRegistryBuildV2]]){
   const a=artifact(name);assert.equal(keccak256(a.bytecode.object),pin.creationCodeHash);assert.equal(keccak256(a.deployedBytecode.object),pin.runtimeTemplateHash);
   assert.deepEqual(Object.values(a.deployedBytecode.immutableReferences??{}).flat().map(x=>x.start).sort((a,b)=>a-b),Object.values(pin.offsets).flat().sort((a,b)=>a-b));
   assert(pin.runtimeBytes<24576);
  }
  const issuer=fixtureSigner(0x990),reviewer=fixtureSigner(0x991),owners=chain.clubOwners.map(o=>o.address);
  await chain.testClient.setBalance({address:reviewer.address,value:10n**19n});
  const send=async(tx,ok=true)=>{const hash=await chain.operatorClient.sendTransaction({...tx,gas:tx.gas??2_000_000n});const receipt=await chain.publicClient.waitForTransactionReceipt({hash});assert.equal(receipt.status,ok?'success':'reverted');return receipt;};
  const reg=artifact('RacesOnWalletRegistryV2'),factoryArtifact=artifact('RacesOnSponsorFactoryV6'),programmeArtifact=artifact('RacesOnRewardProgrammeV6'),campaignArtifact=artifact('RacesOnRewardCampaignV6');
  const registry=(await send({data:encodeDeployData({abi:reg.abi,bytecode:walletRegistryBuildV2.bytecode,args:[issuer.address]})})).contractAddress;
  const factory=(await send({data:sponsorFactoryBuildV6.bytecode,gas:8_000_000n})).contractAddress;
  const configuration={funder:chain.operator.address,operator:reviewer.address,walletRegistry:registry,unallocatedTreasury:chain.treasury,expiredTreasury:chain.operator.address,programmeId:h(1),manifestHash:h(2),budget:10n**18n,claimLifetime:86400n*7n,caps:[10n**18n,0n,0n,0n,0n,0n],campaignIds:[11,12,13,14,15,16].map(h),reviewPeriods:[0n,0n,0n,0n,0n,0n]};
  const deployment=await send({to:factory,data:encodeFunctionData({abi:factoryArtifact.abi,functionName:'deploy',args:[configuration]}),gas:12_000_000n});
  const created=deployment.logs.flatMap(log=>{try{return[decodeEventLog({abi:factoryArtifact.abi,...log})];}catch{return[];}}).find(e=>e.eventName==='ProgrammeCreated');
  assert(created);const programme=created.args.programme;
  await send({to:programme,data:encodeFunctionData({abi:programmeArtifact.abi,functionName:'fundProgramme'}),value:configuration.budget});
  const campaign=await chain.publicClient.readContract({address:programme,abi:programmeArtifact.abi,functionName:'campaigns',args:[0n]});
  const read=(functionName,args=[])=>chain.publicClient.readContract({address:campaign,abi:campaignArtifact.abi,functionName,args});
  const award={entitlementId:h(100),beneficiaryId:h(200),pot:1,amount:configuration.budget,explanationHash:h(300),beneficiaryKind:1};
  await send({account:reviewer,to:campaign,data:encodeFunctionData({abi:campaignArtifact.abi,functionName:'uploadAwards',args:[[award]]})});
  const timestamp=(await chain.publicClient.getBlock()).timestamp;
  await send({account:reviewer,to:campaign,data:encodeFunctionData({abi:campaignArtifact.abi,functionName:'stageAllocation',args:[h(400),await read('uploadDigest'),1n,timestamp,timestamp,h(500)]})});
  await send({account:reviewer,to:campaign,data:encodeFunctionData({abi:campaignArtifact.abi,functionName:'activate',args:[await read('allocationDigest'),h(400)]})});
  // No wallet exists for this beneficiary yet; approval reserves its entire share.
  assert.equal(await read('allocated',[1]),award.amount);assert.equal(await read('paid',[1]),0n);
  const safeFixture=await deployOriginalClubSafeFixture(chain),safe=safeFixture.expected.context.verifyingContract;
  const safeExecute=async(to,data)=>{
   const nonce=await chain.publicClient.readContract({address:safe,abi:safeFixture.artifacts.singleton.abi,functionName:'nonce'});
   const call={chainId,safe,to,data,nonce};
   const signatures=await Promise.all(chain.clubOwners.slice(0,2).map(o=>o.signTypedData(directSafeMessageV5(call))));
   const verified=await verifyDirectSafeSignaturesV5(call,owners,signatures);
   return send({to:safe,data:encodeDirectSafeCallV5(call,verified.signature)});
  };
  const issuedAt=(await chain.publicClient.getBlock()).timestamp,expiresAt=issuedAt+3600n;
  const binding={beneficiaryId:award.beneficiaryId,recipient:safe,beneficiaryKind:1,nonce:0n,issuedAt,expiresAt,clubOwnersHash:clubOwnersHashV1(owners)};
  const registryContext={chainId,registry};
  assert.equal(hashTypedData(walletBindingMessageV2(registryContext,binding)),await chain.publicClient.readContract({address:registry,abi:reg.abi,functionName:'bindingDigest',args:[binding]}));
  const identityProof=await issuer.signTypedData(walletBindingMessageV2(registryContext,binding));
  await safeExecute(registry,encodeWalletRegistrationV2(registryContext,binding,identityProof));
  const claim={entitlementId:award.entitlementId,recipient:safe,amount:award.amount,pot:1,nonce:0n,issuedAt,expiresAt,allocationDigest:await read('allocationDigest'),clubOwnersHash:binding.clubOwnersHash,registrationNonce:1n};
  const context={chainId,campaign},typed=clubClaimMessageV6(context,claim);
  assert.equal(hashTypedData(typed),await read('clubClaimDigest',[award.entitlementId,0n,issuedAt,expiresAt]));
  const proofs=await Promise.all(chain.clubOwners.slice(0,2).map(o=>o.signTypedData(typed)));
  await assert.rejects(encodeClubClaimV6(context,claim,owners,[proofs[0]]));
  const data=await encodeClubClaimV6(context,claim,owners,proofs);
  const nonceBefore=await chain.publicClient.getTransactionCount({address:reviewer.address});
  const receipt=await send({to:campaign,data});
  const paidEvent=receipt.logs.filter(log=>log.address.toLowerCase()===campaign.toLowerCase()).map(log=>decodeEventLog({abi:campaignArtifact.abi,...log})).find(e=>e.eventName==='RewardPaid');
  assert.equal(paidEvent.args.recipient.toLowerCase(),safe.toLowerCase());assert.equal(paidEvent.args.amount,award.amount);
  assert.equal(await chain.publicClient.getBalance({address:safe}),award.amount);assert.equal(await read('paid',[1]),award.amount);assert.equal(await chain.publicClient.getBalance({address:campaign}),0n);
  assert.equal(await chain.publicClient.getTransactionCount({address:reviewer.address}),nonceBefore);
  await send({to:campaign,data},false);
 }finally{await chain.stop();}
});
