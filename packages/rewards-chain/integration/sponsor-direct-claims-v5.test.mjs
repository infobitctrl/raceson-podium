import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encodeDeployData,keccak256,hashMessage} from 'viem';
import {rewardWalletControlMessage} from '../dist/wallet-control.js';
import {directClaimV5} from '../../../apps/api/dist/features/rewards/direct-claims-v5-service.js';
import {startOwnedRewardChain,fixtureSigner} from './owned-chain.mjs';
import {sponsorFactoryData,sponsorFundingData,sponsorFactoryProgrammeAddress,observeSponsorProgramme} from '../dist/sponsor-v4.js';
import {sponsorLifecycleDataV4,observeSponsorLifecycleV4} from '../dist/sponsor-lifecycle-v4.js';
import {walletBindingMessageV1,verifyWalletBindingProofV1,encodeWalletRegistrationV1,encodeSponsorDirectClaimV5,observeSponsorDirectClaimV5,verifySponsorDirectReceiptV5} from '../dist/sponsor-direct-claims-v5.js';
import {sponsorProgrammeBuildV5,sponsorCampaignBuildV5,sponsorFactoryBuildV5,walletRegistryBuildV1} from '../dist/sponsor-v5-build.js';
const artifact=name=>JSON.parse(readFileSync(new URL(`../../../contracts/out/${name}.sol/${name}.json`,import.meta.url)));
const h=n=>'0x'+String(n).padStart(64,'0');
for(const chainId of [31337,10143])test(`V5 publication → explicit wallet registration → direct claim, owned local chain ${chainId}`,{timeout:120000},async t=>{
 const chain=await startOwnedRewardChain({chainId});
 try{
  for(const [name,pin] of [['RacesOnRewardProgrammeV5',sponsorProgrammeBuildV5],['RacesOnRewardCampaignV5',sponsorCampaignBuildV5],['RacesOnSponsorFactoryV5',sponsorFactoryBuildV5],['RacesOnWalletRegistryV1',walletRegistryBuildV1]]){
   const a=artifact(name);assert.equal(keccak256(a.bytecode.object),pin.creationCodeHash);assert.equal(keccak256(a.deployedBytecode.object),pin.runtimeTemplateHash);
   assert.deepEqual(Object.values(a.deployedBytecode.immutableReferences??{}).flat().map(x=>x.start).sort((a,b)=>a-b),Object.values(pin.offsets).flat().sort((a,b)=>a-b));
  }
  const issuer=fixtureSigner(0x990),reviewer=fixtureSigner(0x991),athlete=fixtureSigner(0x992),wrong=fixtureSigner(0x993);
  for(const account of [reviewer,athlete,wrong])await chain.testClient.setBalance({address:account.address,value:10n**19n});
  const send=async(tx,ok=true)=>{const hash=await chain.operatorClient.sendTransaction({...tx,gas:tx.gas??2_000_000n});const r=await chain.publicClient.waitForTransactionReceipt({hash});assert.equal(r.status,ok?'success':'reverted');return r;};
  const registry=(await send({data:encodeDeployData({abi:artifact('RacesOnWalletRegistryV1').abi,bytecode:walletRegistryBuildV1.bytecode,args:[issuer.address]})})).contractAddress;
  const factory=(await send({data:sponsorFactoryBuildV5.bytecode,gas:8_000_000n})).contractAddress;
  const plan={version:5,chainId,launchId:'73000000-0000-4000-8000-000000000003',setupRevision:4,configurationHash:'a'.repeat(64),
   funder:chain.operator.address.toLowerCase(),operator:reviewer.address.toLowerCase(),walletRegistry:registry.toLowerCase(),identityIssuer:issuer.address.toLowerCase(),
   unallocatedTreasury:chain.treasury.toLowerCase(),expiredTreasury:chain.operator.address.toLowerCase(),claimLifetime:7*86400,reviewPeriods:[0,0,0,0,0,0],
   caps:['300000000000000000','0','0','0','0','0'],budgetWei:'300000000000000000'};
  const deployed=await send({to:factory,data:sponsorFactoryData(plan),gas:12_000_000n});
  const parent=sponsorFactoryProgrammeAddress(plan,factory);
  const funding=await send({to:parent,data:sponsorFundingData(),value:BigInt(plan.budgetWei)});
  const finalized=async()=>chain.testClient.mine({blocks:96,interval:1});await finalized();
  const initial=await observeSponsorProgramme(chain.publicClient,plan,deployed.transactionHash,funding.transactionHash);
  assert.equal(initial.pots.length,1);assert.equal(initial.funded,true);
  await assert.rejects(observeSponsorProgramme(chain.publicClient,{...plan,identityIssuer:wrong.address.toLowerCase()},deployed.transactionHash,funding.transactionHash));
  await assert.rejects(observeSponsorProgramme(chain.publicClient,{...plan,version:4},deployed.transactionHash,funding.transactionHash));
  const award={entitlementId:h(1),beneficiaryId:h(101),pot:1,amount:10n**17n,explanationHash:h(201),beneficiaryKind:0};
  const now=BigInt(initial.blockTimestamp);
  const publication={reviewPeriod:'0',reviewStartedAt:now.toString(),officialPublishedAt:now.toString(),publicationEvidenceHash:h(301)};
  const input={plan,slot:0,deploymentHash:deployed.transactionHash,fundingHash:funding.transactionHash,campaignAddress:initial.pots[0].address,snapshotDigest:h(401),awards:[award],publication};
  for(const action of ['upload','stage','activate']){
   assert.equal((await observeSponsorLifecycleV4(chain.publicClient,input)).next,action);
   await send({account:reviewer,to:input.campaignAddress,data:sponsorLifecycleDataV4(input,action)});await finalized();
  }
  const scope={...input,entitlementId:award.entitlementId,beneficiaryId:award.beneficiaryId,beneficiaryKind:0,amountWei:award.amount.toString(),explanationHash:award.explanationHash};
  const walletless=await observeSponsorDirectClaimV5(chain.publicClient,scope);
  assert.equal(walletless.claimable,false);assert.equal(walletless.registeredAddress,null);assert.equal(walletless.paid,false);
  const reviewerNonce=await chain.publicClient.getTransactionCount({address:reviewer.address});
  const bindingTime=(await chain.publicClient.getBlock()).timestamp;
  const binding={beneficiaryId:award.beneficiaryId,recipient:athlete.address,beneficiaryKind:0,nonce:0n,issuedAt:bindingTime,expiresAt:bindingTime+3600n};
  const context={chainId,registry};
  const proof=await issuer.signTypedData(walletBindingMessageV1(context,binding));
  await verifyWalletBindingProofV1(context,binding,issuer.address,proof);
  await assert.rejects(verifyWalletBindingProofV1(context,{...binding,recipient:wrong.address},issuer.address,proof));
  await send({account:wrong,to:registry,data:encodeWalletRegistrationV1(context,binding,proof)},false);
  await send({account:athlete,to:registry,data:encodeWalletRegistrationV1(context,binding,proof)});await finalized();
  assert.equal((await observeSponsorDirectClaimV5(chain.publicClient,scope)).claimable,true);
  await send({account:wrong,to:input.campaignAddress,data:encodeSponsorDirectClaimV5(award.entitlementId)},false);
  const before=await chain.publicClient.getBalance({address:athlete.address});
  const receipt=await send({account:athlete,to:input.campaignAddress,data:encodeSponsorDirectClaimV5(award.entitlementId)});await finalized();
  const transaction=await chain.publicClient.getTransaction({hash:receipt.transactionHash});
  const after=await chain.publicClient.getBalance({address:athlete.address});
  assert.equal(after,before+award.amount-transaction.gas*receipt.effectiveGasPrice);
  const verifiedReceipt=await verifySponsorDirectReceiptV5(chain.publicClient,scope,receipt.transactionHash);
  assert.equal(verifiedReceipt.recipient,athlete.address.toLowerCase());
  await assert.rejects(verifySponsorDirectReceiptV5(chain.publicClient,scope,funding.transactionHash));
  const paid=await observeSponsorDirectClaimV5(chain.publicClient,scope);
  assert.equal(paid.paid,true);assert.equal(paid.recipient,athlete.address.toLowerCase());assert.equal(paid.claimable,false);
  await send({account:athlete,to:input.campaignAddress,data:encodeSponsorDirectClaimV5(award.entitlementId)},false);
  assert.equal(await chain.publicClient.getTransactionCount({address:reviewer.address}),reviewerNonce);
  assert.equal(await chain.publicClient.getBalance({address:input.campaignAddress}),BigInt(plan.budgetWei)-award.amount);
  if(chainId===10143){
   await t.test('ordinary athlete service binds fresh wallet proof and returns only athlete calldata; no reviewer event',async()=>{
    const p={...plan,launchId:'73000000-0000-4000-8000-000000000004'};
    const deployment=await send({to:factory,data:sponsorFactoryData(p),gas:12_000_000n});
    const parent2=sponsorFactoryProgrammeAddress(p,factory),fund=await send({to:parent2,data:sponsorFundingData(),value:BigInt(p.budgetWei)});await finalized();
    const o=await observeSponsorProgramme(chain.publicClient,p,deployment.transactionHash,fund.transactionHash);
    const row={...award,entitlementId:h(2),beneficiaryId:h(102)};
    const i={...input,plan:p,deploymentHash:deployment.transactionHash,fundingHash:fund.transactionHash,campaignAddress:o.pots[0].address,awards:[row]};
    for(const action of ['upload','stage','activate']){await send({account:reviewer,to:i.campaignAddress,data:sponsorLifecycleDataV4(i,action)});await finalized();}
    const current=(await chain.publicClient.getBlock()).timestamp,realNow=Date.now;
    Date.now=()=>Number(current)*1000;
    try{
     const id=n=>`74000000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor={userId:id(1),sessionId:id(2)},proofId=id(4),approvalId=id(5);
     const challenge={...actor,challengeId:id(3),chainId,address:athlete.address.toLowerCase(),origin:'https://podium.raceson.com',nonce:'ab'.repeat(32),
      issuedAt:new Date(Number(current)*1000).toISOString(),expiresAt:new Date(Number(current+600n)*1000).toISOString(),idempotencyKey:'synthetic-v5-proof',checkedAt:new Date(Number(current)*1000).toISOString()};
     const message=rewardWalletControlMessage(challenge);
     challenge.proof={proofId,messageHash:hashMessage(message),signature:await athlete.signMessage({message}),verifiedAt:challenge.issuedAt};
     let savedReceipt=null,signatures=0,revoked=false,mode='normal';const writes=[];
     const rpc=async(name,args)=>{
      assert.equal(name,'service_reward_demo_copy_direct_claim_v5');assert.equal(args.p_user_id,actor.userId);assert.equal(args.p_session_id,actor.sessionId);
      if(revoked)return{data:null,error:{message:'reward_account_session_required'}};
      if(args.p_receipt){savedReceipt=args.p_receipt;writes.push(args.p_receipt);}
      const c=args.p_proof_id?structuredClone(challenge):null;
      if(c&&mode==='wrong-proof')c.proof.signature=await wrong.signMessage({message});
      return{error:null,data:{approvalId,slot:0,plan:p,deploymentHash:i.deploymentHash,fundingHash:i.fundingHash,
       award:{...row,amount:row.amount.toString()},challenge:c,receipt:savedReceipt,rehearsalPolicy:'podium-demo-alias-rehearsal-v1'}};
     };
     const deps={reader:chain.publicClient,rpc,issuer:{address:issuer.address,sign:async(context,binding)=>{signatures++;return issuer.signTypedData(walletBindingMessageV1(context,binding));}}};
     const get=command=>directClaimV5(actor,approvalId,row.entitlementId,command,deps);
     const beforeReviewer=await chain.publicClient.getTransactionCount({address:reviewer.address});
     assert.equal((await get()).status,'claimable');assert.equal(signatures,0);
     mode='wrong-proof';await assert.rejects(get({action:'prepare',proofId}));assert.equal(signatures,0);mode='normal';
     const prepared=await get({action:'prepare',proofId});assert.equal(signatures,1);assert.equal(prepared.transaction.to,registry.toLowerCase());
     assert.equal(prepared.transaction.from,athlete.address.toLowerCase());assert.equal(writes.length,0);
     const receipt=await send({account:athlete,to:prepared.transaction.to,data:prepared.transaction.data});await finalized();
     const verified=await get({action:'receipt',hash:receipt.transactionHash});assert.equal(verified.status,'paid');assert.equal(writes.length,1);
     assert.equal((await get()).status,'paid');assert.equal(signatures,1);
     assert.equal(await chain.publicClient.getTransactionCount({address:reviewer.address}),beforeReviewer);
     revoked=true;await assert.rejects(get(),{code:'reward_account_session_required'});
    }finally{Date.now=realNow;}
   });
  }

 }finally{await chain.stop();}
});
