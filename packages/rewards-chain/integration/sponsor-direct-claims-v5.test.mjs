import {clubOwnersHashV1,walletBindingMessageV2,verifyWalletBindingProofV2,encodeWalletRegistrationV2,encodeRegisterAndClaimV6,clubClaimMessageV6,encodeClubClaimV6} from '../dist/club-signatures-v6.js';
import {sponsorProgrammeBuildV6,sponsorCampaignBuildV6,sponsorFactoryBuildV6,walletRegistryBuildV2} from '../dist/sponsor-v6-build.js';
import {verifyClubRegistrationReceiptV6} from '../dist/sponsor-direct-claims-v5.js';
import {buildClubDirectClaimV5 as clubDirectClaimV5} from '../../../apps/api/dist/features/rewards/club-direct-claims-v5-service.js';
import {rewardClubSafeTestnetDependencies} from '../dist/club-safe-creation.js';
import {deployOriginalClubSafeFixture} from './safe-deployment-fixture.mjs';
import {directSafeMessageV5,verifyDirectSafeSignaturesV5,encodeDirectSafeCallV5,observeDirectClubTreasuryV5} from '../dist/sponsor-club-direct-v5.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {concatHex,encodeAbiParameters,encodeEventTopics,encodeDeployData,encodeFunctionData,keccak256,hashMessage,parseAbi,toHex,zeroAddress,zeroHash} from 'viem';
import {rewardWalletControlMessage} from '../dist/wallet-control.js';
import {directClaimV5} from '../../../apps/api/dist/features/rewards/direct-claims-v5-service.js';
import {startOwnedRewardChain,fixtureSigner} from './owned-chain.mjs';
import {sponsorFactoryData,sponsorFundingData,sponsorFactoryProgrammeAddress,observeSponsorProgramme} from '../dist/sponsor-v4.js';
import {sponsorLifecycleDataV4,observeSponsorLifecycleV4} from '../dist/sponsor-lifecycle-v4.js';
import {walletBindingMessageV1,verifyWalletBindingProofV1,encodeWalletRegistrationV1,encodeRegisterAndClaimV5,encodeSponsorDirectClaimV5,observeSponsorDirectClaimV5,verifySponsorDirectReceiptV5} from '../dist/sponsor-direct-claims-v5.js';
import {sponsorProgrammeBuildV5,sponsorCampaignBuildV5,sponsorFactoryBuildV5,walletRegistryBuildV1} from '../dist/sponsor-v5-build.js';
const artifact=name=>JSON.parse(readFileSync(new URL(`../../../contracts/out/${name}.sol/${name}.json`,import.meta.url)));
const h=n=>'0x'+String(n).padStart(64,'0');
// A carrier transport fixture around actual local Safe/registry/campaign
// receipts. It models Privy's public bundler envelope, not a hosted SDK send.
const carrierAbi=parseAbi(['function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)','function execute(bytes32 mode,bytes executionCalldata)','event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)']);
const carrierEntry='0x0000000071727de22e5e9d8baf0edac6f37da032';
function clubCarrierReader(reader,hash,sender){
 return {...reader,
  getTransaction:async args=>{const tx=await reader.getTransaction(args);if(args.hash!==hash)return tx;
   const callData=encodeFunctionData({abi:carrierAbi,functionName:'execute',args:[zeroHash,concatHex([tx.to,toHex(0n,{size:32}),tx.input])]});
   const op={sender,nonce:7n,initCode:'0x',callData,accountGasLimits:zeroHash,preVerificationGas:0n,gasFees:zeroHash,paymasterAndData:'0x',signature:'0x'};
   return {...tx,to:carrierEntry,input:encodeFunctionData({abi:carrierAbi,functionName:'handleOps',args:[[op],zeroAddress]})};
  },
  getTransactionReceipt:async args=>{const r=await reader.getTransactionReceipt(args);if(args.hash!==hash)return r;
   return {...r,to:carrierEntry,logs:[...r.logs,{address:carrierEntry,transactionHash:hash,blockHash:r.blockHash,blockNumber:r.blockNumber,removed:false,
    topics:encodeEventTopics({abi:carrierAbi,eventName:'UserOperationEvent',args:{userOpHash:h(999),sender,paymaster:zeroAddress}}),
    data:encodeAbiParameters([{type:'uint256'},{type:'bool'},{type:'uint256'},{type:'uint256'}],[7n,true,1n,1n])}]};
  },
 };
}
for(const version of [5,6])for(const chainId of [31337,10143])test(`V${version} publication → explicit wallet registration → direct claim, owned local chain ${chainId}`,{timeout:120000},async t=>{
 const chain=await startOwnedRewardChain({chainId});
 const bindingMessage=version===6?walletBindingMessageV2:walletBindingMessageV1,verifyBinding=version===6?verifyWalletBindingProofV2:verifyWalletBindingProofV1,register=version===6?encodeWalletRegistrationV2:encodeWalletRegistrationV1;
 const programmeBuild=version===6?sponsorProgrammeBuildV6:sponsorProgrammeBuildV5,campaignBuild=version===6?sponsorCampaignBuildV6:sponsorCampaignBuildV5,factoryBuild=version===6?sponsorFactoryBuildV6:sponsorFactoryBuildV5,registryBuild=version===6?walletRegistryBuildV2:walletRegistryBuildV1;
 const registryName=version===6?'RacesOnWalletRegistryV2':'RacesOnWalletRegistryV1';
 try{
  for(const [name,pin] of [[`RacesOnRewardProgrammeV${version}`,programmeBuild],[`RacesOnRewardCampaignV${version}`,campaignBuild],[`RacesOnSponsorFactoryV${version}`,factoryBuild],[registryName,registryBuild]]){
   const a=artifact(name);assert.equal(keccak256(a.bytecode.object),pin.creationCodeHash);assert.equal(keccak256(a.deployedBytecode.object),pin.runtimeTemplateHash);
   assert.deepEqual(Object.values(a.deployedBytecode.immutableReferences??{}).flat().map(x=>x.start).sort((a,b)=>a-b),Object.values(pin.offsets).flat().sort((a,b)=>a-b));
  }
  const issuer=fixtureSigner(0x990),reviewer=fixtureSigner(0x991),athlete=fixtureSigner(0x992),wrong=fixtureSigner(0x993);
  for(const account of [reviewer,athlete,wrong])await chain.testClient.setBalance({address:account.address,value:10n**19n});
  const send=async(tx,ok=true)=>{const hash=await chain.operatorClient.sendTransaction({...tx,gas:tx.gas??2_000_000n});const r=await chain.publicClient.waitForTransactionReceipt({hash});assert.equal(r.status,ok?'success':'reverted');return r;};
  const registry=(await send({data:encodeDeployData({abi:artifact(registryName).abi,bytecode:registryBuild.bytecode,args:[issuer.address]})})).contractAddress;
  const factory=(await send({data:factoryBuild.bytecode,gas:8_000_000n})).contractAddress;
  const plan={version,chainId,launchId:'73000000-0000-4000-8000-000000000003',setupRevision:4,configurationHash:'a'.repeat(64),
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
  const clubAward={...award,entitlementId:h(3),beneficiaryId:h(103),beneficiaryKind:1};
  const now=BigInt(initial.blockTimestamp);
  const publication={reviewPeriod:'0',reviewStartedAt:now.toString(),officialPublishedAt:now.toString(),publicationEvidenceHash:h(301)};
  const input={plan,slot:0,deploymentHash:deployed.transactionHash,fundingHash:funding.transactionHash,campaignAddress:initial.pots[0].address,snapshotDigest:h(401),awards:[award,clubAward],publication};
  const scope={...input,entitlementId:award.entitlementId,beneficiaryId:award.beneficiaryId,beneficiaryKind:0,amountWei:award.amount.toString(),explanationHash:award.explanationHash};
  const unpublished=await observeSponsorDirectClaimV5(chain.publicClient,scope);
  assert.equal(unpublished.state,1);assert.equal(unpublished.paid,false);assert.equal(unpublished.claimable,false);assert.equal(unpublished.deadline,'0');
  for(const action of ['upload','stage','activate']){
   assert.equal((await observeSponsorLifecycleV4(chain.publicClient,input)).next,action);
   await send({account:reviewer,to:input.campaignAddress,data:sponsorLifecycleDataV4(input,action)});await finalized();
   await assert.rejects(observeSponsorDirectClaimV5(chain.publicClient,{...scope,amountWei:'1'}),/direct_claim_award_mismatch/);
   if(action==='stage')await assert.rejects(observeSponsorDirectClaimV5(chain.publicClient,{...scope,entitlementId:h(999)}),/direct_claim_award_mismatch/);
  }
  await assert.rejects(observeSponsorDirectClaimV5(chain.publicClient,{...scope,entitlementId:h(999)}),/direct_claim_award_mismatch/);
  await assert.rejects(observeSponsorDirectClaimV5(chain.publicClient,{...scope,amountWei:'1'}),/direct_claim_award_mismatch/);
  const walletless=await observeSponsorDirectClaimV5(chain.publicClient,scope);
  assert.equal(walletless.claimable,false);assert.equal(walletless.registeredAddress,null);assert.equal(walletless.paid,false);
  const reviewerNonce=await chain.publicClient.getTransactionCount({address:reviewer.address});
  const bindingTime=(await chain.publicClient.getBlock()).timestamp;
  const binding={beneficiaryId:award.beneficiaryId,recipient:athlete.address,beneficiaryKind:0,nonce:0n,issuedAt:bindingTime,expiresAt:bindingTime+3600n,...(version===6?{clubOwnersHash:h(0)}:{})};
  const context={chainId,registry};
  const proof=await issuer.signTypedData(bindingMessage(context,binding));
  await verifyBinding(context,binding,issuer.address,proof);
  await assert.rejects(verifyBinding(context,{...binding,recipient:wrong.address},issuer.address,proof));
  await send({account:wrong,to:registry,data:register(context,binding,proof)},false);
  await send({account:athlete,to:registry,data:register(context,binding,proof)});await finalized();
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
  await t.test('original Safe claims with two owners and no further reviewer transaction',async()=>{
   const fixture=await deployOriginalClubSafeFixture(chain);
   fixture.provenance.safe.context={...fixture.provenance.safe.context,chainId,environment:chainId===10143?'monad-testnet':'local-simulation'};
   await finalized();const treasury=fixture.provenance,observed=await observeDirectClubTreasuryV5(chain.publicClient,treasury);
   const cscope={...scope,entitlementId:clubAward.entitlementId,beneficiaryId:clubAward.beneficiaryId,beneficiaryKind:1};
   const at=(await chain.publicClient.getBlock()).timestamp;
   const b={beneficiaryId:clubAward.beneficiaryId,recipient:treasury.safe.context.verifyingContract,beneficiaryKind:1,nonce:0n,issuedAt:at,expiresAt:at+3600n,...(version===6?{clubOwnersHash:clubOwnersHashV1(treasury.safe.owners)}:{})};
   const proof=await issuer.signTypedData(bindingMessage(context,b));
   const call={chainId,safe:b.recipient,to:registry,data:version===6?register(context,b,proof):encodeRegisterAndClaimV5(context,b,proof,input.campaignAddress,clubAward.entitlementId),nonce:observed.nonce};
   const signatures=await Promise.all(chain.clubOwners.slice(0,2).map(owner=>owner.signTypedData(directSafeMessageV5(call))));
   await assert.rejects(verifyDirectSafeSignaturesV5(call,treasury.safe.owners,[signatures[0],signatures[0]]));
   await assert.rejects(verifyDirectSafeSignaturesV5({...call,nonce:1n},treasury.safe.owners,signatures));
   const consent=await verifyDirectSafeSignaturesV5(call,treasury.safe.owners,signatures);
   let receipt=await send({to:call.safe,data:encodeDirectSafeCallV5(call,consent.signature)});await finalized();
   if(version===6){
    await verifyClubRegistrationReceiptV6(chain.publicClient,cscope,receipt.transactionHash,treasury);
    await assert.rejects(verifySponsorDirectReceiptV5(chain.publicClient,cscope,receipt.transactionHash,treasury));
    const view=await observeSponsorDirectClaimV5(chain.publicClient,cscope);assert.equal(view.paid,false);
    const claim={entitlementId:clubAward.entitlementId,recipient:b.recipient,amount:clubAward.amount,pot:1,nonce:0n,issuedAt:at,expiresAt:at+3600n,allocationDigest:view.allocationDigest,clubOwnersHash:b.clubOwnersHash,registrationNonce:1n};
    const ctx={chainId,campaign:input.campaignAddress},proofs=await Promise.all(chain.clubOwners.slice(0,2).map(o=>o.signTypedData(clubClaimMessageV6(ctx,claim))));
    receipt=await send({to:input.campaignAddress,data:await encodeClubClaimV6(ctx,claim,treasury.safe.owners,proofs)});await finalized();
   }
   const checked=await verifySponsorDirectReceiptV5(chain.publicClient,cscope,receipt.transactionHash,treasury);
   assert.equal(checked.recipient,call.safe.toLowerCase());assert.equal(await chain.publicClient.getBalance({address:call.safe}),clubAward.amount);
   await assert.rejects(verifySponsorDirectReceiptV5(chain.publicClient,scope,receipt.transactionHash,treasury));
   await assert.rejects(verifySponsorDirectReceiptV5(chain.publicClient,cscope,receipt.transactionHash));
   await send({to:call.safe,data:encodeDirectSafeCallV5(call,consent.signature)},false);
   assert.equal(await chain.publicClient.getTransactionCount({address:reviewer.address}),reviewerNonce);
  });
  if(chainId===10143){
   await t.test('ordinary athlete service binds fresh wallet proof and returns only athlete calldata; no reviewer event',async()=>{
    const p={...plan,launchId:'73000000-0000-4000-8000-000000000004'};
    const deployment=await send({to:factory,data:sponsorFactoryData(p),gas:12_000_000n});
    const parent2=sponsorFactoryProgrammeAddress(p,factory),fund=await send({to:parent2,data:sponsorFundingData(),value:BigInt(p.budgetWei)});await finalized();
    const o=await observeSponsorProgramme(chain.publicClient,p,deployment.transactionHash,fund.transactionHash);
    const row={...award,entitlementId:h(2),beneficiaryId:h(102)},clubrow={...clubAward,entitlementId:h(4),beneficiaryId:h(104)};
    const i={...input,plan:p,deploymentHash:deployment.transactionHash,fundingHash:fund.transactionHash,campaignAddress:o.pots[0].address,awards:[row,clubrow]};
    const pendingFacts={approvalId:'73000000-0000-4000-8000-000000000001',slot:0,plan:p,deploymentHash:deployment.transactionHash,fundingHash:fund.transactionHash,award:{...row,amount:row.amount.toString()},challenge:null,receipt:null,rehearsalPolicy:'podium-demo-alias-rehearsal-v1'};
    const pendingView=await directClaimV5({userId:pendingFacts.approvalId,sessionId:pendingFacts.approvalId},pendingFacts.approvalId,row.entitlementId,undefined,{reader:chain.publicClient,rpc:async()=>({data:pendingFacts,error:null}),issuer:null});
    assert.equal(pendingView.status,'not_open');assert.equal(pendingView.transaction,null);assert.equal(pendingView.recipient,null);
    await assert.rejects(directClaimV5({userId:pendingFacts.approvalId,sessionId:pendingFacts.approvalId},pendingFacts.approvalId,row.entitlementId,{action:'prepare',proofId:pendingFacts.approvalId},{reader:chain.publicClient,rpc:async()=>({data:pendingFacts,error:null}),issuer:null}));
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
     const deps={reader:chain.publicClient,rpc,issuer:{address:issuer.address,sign:async(context,binding)=>{signatures++;return issuer.signTypedData(bindingMessage(context,binding));}}};
     deps.issuerV2=deps.issuer;
     const get=command=>directClaimV5(actor,approvalId,row.entitlementId,command,deps);
     const beforeReviewer=await chain.publicClient.getTransactionCount({address:reviewer.address});
     assert.equal((await get()).status,'claimable');assert.equal(signatures,0);
     mode='wrong-proof';await assert.rejects(get({action:'prepare',proofId}));assert.equal(signatures,0);mode='normal';
     const prepared=await get({action:'prepare',proofId});assert.equal(signatures,1);assert.equal(prepared.transaction.to,registry.toLowerCase());
     assert.equal(prepared.transaction.from,athlete.address.toLowerCase());assert.equal(writes.length,0);
     // Real EIP7702 envelope on this disposable loopback chain. The fixture
     // models the sponsored routing, not Privy's hosted bundler/paymaster.
     const delegate=artifact('SponsoredClaimFixture');
     const implementation=(await send({data:encodeDeployData({abi:delegate.abi,bytecode:delegate.bytecode.object,args:[chain.operator.address]})})).contractAddress;
     await chain.testClient.setBalance({address:athlete.address,value:0n});
     assert.equal(await chain.publicClient.getBalance({address:athlete.address}),0n);
     const authorization=await chain.operatorClient.signAuthorization({account:athlete,contractAddress:implementation});
     const outer={to:athlete.address,data:encodeFunctionData({abi:delegate.abi,functionName:'execute',args:[prepared.transaction.to,prepared.transaction.data]}),authorizationList:[authorization]};
     const receipt=await send(outer);await finalized();
     assert.equal(await chain.publicClient.getBalance({address:athlete.address}),row.amount);
     assert.notEqual(receipt.from.toLowerCase(),athlete.address.toLowerCase());
     // Replaying the same atomic register+claim cannot pay again.
     await send({...outer,authorizationList:undefined},false);
     assert.equal(await chain.publicClient.getBalance({address:athlete.address}),row.amount);
     const receiptScope={...i,entitlementId:row.entitlementId,beneficiaryId:row.beneficiaryId,beneficiaryKind:0,amountWei:row.amount.toString(),explanationHash:row.explanationHash};
     for(const change of [r=>({...r,logs:[]}),r=>({...r,status:'reverted'}),r=>({...r,logs:r.logs.map(l=>({...l,transactionHash:h(999)}))}),r=>({...r,logs:r.logs.map(l=>({...l,blockHash:h(999)}))})]){
      const reader={...chain.publicClient,getTransactionReceipt:async args=>change(await chain.publicClient.getTransactionReceipt(args))};
      await assert.rejects(verifySponsorDirectReceiptV5(reader,receiptScope,receipt.transactionHash));
     }

     const verified=await get({action:'receipt',hash:receipt.transactionHash});assert.equal(verified.status,'paid');assert.equal(writes.length,1);
     assert.equal((await get()).status,'paid');assert.equal(signatures,1);
     assert.equal(await chain.publicClient.getTransactionCount({address:reviewer.address}),beforeReviewer);
     const fixture=await deployOriginalClubSafeFixture(chain,{},rewardClubSafeTestnetDependencies);await finalized();
     const creationId=id(6),clubActor=chain.clubOwners[0],safeAddress=fixture.expected.context.verifyingContract.toLowerCase();
     const clubChallenge={...challenge,address:clubActor.address.toLowerCase()},clubMessage=rewardWalletControlMessage(clubChallenge);
     clubChallenge.proof={...challenge.proof,messageHash:hashMessage(clubMessage),signature:await clubActor.signMessage({message:clubMessage})};
     let clubReceipt=null;
     const clubRpc=async(name,args)=>{assert.equal(name,'service_reward_demo_copy_club_direct_claim_v5');assert.equal(args.p_creation_id,creationId);
      if(args.p_receipt)clubReceipt=args.p_receipt;
      return {error:null,data:{approvalId,slot:0,plan:p,deploymentHash:i.deploymentHash,fundingHash:i.fundingHash,award:{...clubrow,amount:clubrow.amount.toString()},
       challenge:args.p_proof_id?clubChallenge:null,receipt:clubReceipt,rehearsalPolicy:'podium-demo-alias-rehearsal-v1',
       treasury:{creationId,clubId:id(7),owners:chain.clubOwners.map(o=>o.address.toLowerCase()),safeAddress,deploymentTransactionHash:fixture.deployment.transactionHash}}};
     };
     const clubDeps={...deps,rpc:clubRpc},clubGet=command=>clubDirectClaimV5(actor,approvalId,clubrow.entitlementId,creationId,command,clubDeps);
     const cp=await clubGet({action:'prepare',proofId});assert.equal(cp.transaction.from,safeAddress);assert.equal(cp.transaction.binding.beneficiaryKind,1);
     const call={chainId,safe:safeAddress,to:cp.transaction.to,data:cp.transaction.data,nonce:BigInt(cp.safeNonce)};
     const clubSignatures=await Promise.all(chain.clubOwners.slice(0,2).map(o=>o.signTypedData(directSafeMessageV5(call))));
     const consent=await verifyDirectSafeSignaturesV5(call,chain.clubOwners.map(o=>o.address),clubSignatures);
     let paidClub=await send({to:safeAddress,data:encodeDirectSafeCallV5(call,consent.signature)});await finalized();
     if(version===6){
      assert.equal(cp.phase,'register');await assert.rejects(clubGet({action:'receipt',hash:paidClub.transactionHash}));assert.equal(clubReceipt,null);
      const registered=await clubGet({action:'registrationReceipt',hash:paidClub.transactionHash});assert.equal(registered.phase,'claim');assert.equal(registered.status,'claimable');assert.equal(clubReceipt,null);
      const bundled=await clubDirectClaimV5(actor,approvalId,clubrow.entitlementId,creationId,{action:'registrationReceipt',hash:paidClub.transactionHash},{...clubDeps,reader:clubCarrierReader(chain.publicClient,paidClub.transactionHash,clubActor.address)});
      assert.equal(bundled.phase,'claim');assert.equal(bundled.status,'claimable');assert.equal(clubReceipt,null);
      await assert.rejects(clubDirectClaimV5(actor,approvalId,clubrow.entitlementId,creationId,{action:'registrationReceipt',hash:paidClub.transactionHash},{...clubDeps,reader:clubCarrierReader(chain.publicClient,paidClub.transactionHash,wrong.address)}));
      const ready=await clubGet({action:'prepare',proofId});assert.equal(ready.phase,'claim');
      const c=ready.clubClaim,claim={...c,amount:BigInt(c.amount),nonce:BigInt(c.nonce),issuedAt:BigInt(c.issuedAt),expiresAt:BigInt(c.expiresAt),registrationNonce:BigInt(c.registrationNonce)};
      const ctx={chainId,campaign:ready.campaignAddress},owners=chain.clubOwners.map(o=>o.address),proofs=await Promise.all(chain.clubOwners.slice(0,2).map(o=>o.signTypedData(clubClaimMessageV6(ctx,claim))));
      await assert.rejects(encodeClubClaimV6(ctx,claim,owners,[proofs[0],proofs[0]]));
      paidClub=await send({to:ready.campaignAddress,data:await encodeClubClaimV6(ctx,claim,owners,proofs)});await finalized();
     }
     assert.equal((await clubGet({action:'receipt',hash:paidClub.transactionHash})).status,'paid');assert.equal(clubReceipt.recipient,safeAddress);
     const bundledPayment=await clubDirectClaimV5(actor,approvalId,clubrow.entitlementId,creationId,{action:'receipt',hash:paidClub.transactionHash},{...clubDeps,reader:clubCarrierReader(chain.publicClient,paidClub.transactionHash,clubActor.address)});
     assert.equal(bundledPayment.status,'paid');assert.equal(bundledPayment.receipt.recipient,safeAddress);assert.equal(bundledPayment.receipt.amountWei,clubrow.amount.toString());
     await assert.rejects(clubDirectClaimV5(actor,approvalId,clubrow.entitlementId,creationId,{action:'receipt',hash:paidClub.transactionHash},{...clubDeps,reader:clubCarrierReader(chain.publicClient,paidClub.transactionHash,wrong.address)}));
     assert.equal((await clubGet()).status,'paid');assert.equal(await chain.publicClient.getTransactionCount({address:reviewer.address}),beforeReviewer);
     revoked=true;await assert.rejects(get(),{code:'reward_account_session_required'});
    }finally{Date.now=realNow;}
   });
  }

 }finally{await chain.stop();}
});
