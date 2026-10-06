import test from 'node:test';import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';import {toHex,getContractAddress,hashTypedData,keccak256} from 'viem';
import {fixture,saved,id,setupId} from './fixtures/hosted-approval-fixture.mjs';
import {hostedClaimChain} from './fixtures/hosted-claim-chain.mjs';
import {clubSafeDeploymentFixture} from '../../../packages/rewards-chain/test/club-safe-deployment-fixture.mjs';
import {createSponsorExecutionPlan} from '../../../packages/domain/dist/rewards/sponsor-execution.js';
import {sponsorAllocationDocumentHashV4 as digest,copyRewardLedgerDocument as copy} from '../../../packages/db/dist/rewards/index.js';
import {sponsorLifecycleCommitmentV4} from '../../../packages/rewards-chain/dist/sponsor-lifecycle-v4.js';
import {sponsorClaimMessagesV4,verifySponsorClaimProofV4,sponsorSafeConsentMessageV4} from '../../../packages/rewards-chain/dist/sponsor-claims-v4.js';
import {verifySponsorClubSafeConsentV4} from '../../../packages/rewards-chain/dist/index.js';
import {verifiedSponsorClubClaimExecutionV4} from '../dist/features/rewards/sponsor-club-claims-v4-service.js';
import {advanceControllerTransaction,controllerTransactionRequest} from '../dist/features/rewards/controller-transactions.js';
const h=n=>toHex(BigInt(n),{size:32}),operator=privateKeyToAccount(h(1908)),cid=id(4);
// Owned synthetic chain: pinned original Safe artifacts/initialization, known
// ERC1271 oracle responses, and real test-key operator signatures. No network.
async function clubFixture(){
 const safe=clubSafeDeploymentFixture({chainId:10143}),candidate={safeAddress:safe.input.safe.context.verifyingContract.toLowerCase(),singletonAddress:safe.input.safe.singletonAddress,fallbackHandlerAddress:safe.input.safe.fallbackHandlerAddress,owners:[...safe.owners].sort()},
 launch={id:id(9902),state:'prepared',configurationHash:'f'.repeat(64),createdAt:'2026-10-05T00:00:00Z',setup:saved(fixture())};
 const plan=createSponsorExecutionPlan(launch,'0x'+'3'.repeat(40),{operator:operator.address.toLowerCase(),treasury:'0x'+'4'.repeat(40),reviewPeriods:[0,0,0,0,0,0]}),evidence={synthetic:true};
 const publication={approvalId:id(6),evidence,timing:{reviewPeriod:'0',reviewStartedAt:'100',officialPublishedAt:'100',publicationEvidenceHash:'0x'+digest(evidence)}};
 const input={plan,slot:0,deploymentHash:h(10),fundingHash:h(11),campaignAddress:getContractAddress({from:getContractAddress({from:operator.address,nonce:0n}),nonce:1n}).toLowerCase(),snapshotDigest:h(12),
 awards:[{entitlementId:h(1),beneficiaryId:h(2),pot:1,amount:101n,explanationHash:h(3),beneficiaryKind:1}],publication:publication.timing},allocation=sponsorLifecycleCommitmentV4(input);
 const {plan:unusedPlan,publication:unusedPublication,...packageInput}=input,pkg=copy({...packageInput,approvalId:id(6),chainId:10143,uploadDigest:allocation.uploadDigest,entitlementCount:allocation.entitlementCount});publication.packageHash=digest(pkg);
 const context={environment:'monad-testnet',chainId:10143,verifyingContract:input.campaignAddress},claim={entitlementId:h(1),recipient:candidate.safeAddress,amount:101n,pot:'league',nonce:0n,issuedAt:150n,expiresAt:300n,allocationDigest:allocation.allocationDigest},signature='0x'+'d'.repeat(260);
 const attestation={schemaVersion:1,policy:'operator-reviewed-original-safe-v1',chainId:10143,candidate,factoryAddress:safe.input.factoryAddress,deploymentTransactionHash:safe.input.deploymentTransactionHash,initializerHash:keccak256(safe.initializer),
 deploymentBlock:{number:'50',hash:h(150),timestamp:'151'},reviewedBlock:{number:'100',hash:h(200),timestamp:'151'},authorityEvidenceRef:id(20),controlEvidenceRef:id(21),recoveryEvidenceRef:id(22),executionHistoryEvidenceRef:id(23)};
 const f={claimId:cid,entitlementId:h(1),approvalId:id(6),setupId,slot:0,current:true,sourceStamp:'b'.repeat(64),profileFingerprint:'c'.repeat(64),plan,
 nomination:{requestId:id(7),userId:id(1),sessionId:id(2),clubId:id(8),chainId:10143,candidate,requestedAt:'2026-10-06T01:00:00Z',withdrawnAt:null,status:'pending_review',idempotencyKey:'owned-club-choice'},package:pkg,packageHash:digest(pkg),publication,events:{}};
 const chain=hostedClaimChain(f,{paymentBlock:101n});chain.anchor=100n;const base=chain.reader;
 const chainBlock=base.getBlock;chain.reader.getBlock=async p=>{const b=await chainBlock(p);return{...b,parentHash:h(100n+b.number-1n)};};
 safe.tx.blockHash=h(150);safe.receipt.blockHash=h(150);safe.receipt.logs.forEach(log=>log.blockHash=h(150));
 const getCode=base.getCode,readContract=base.readContract,getTx=base.getTransaction,getReceipt=base.getTransactionReceipt;
 let magic=true,threshold=2n;
 chain.reader.getCode=async p=>(await getCode(p))==='0x'?await safe.reader.getCode(p):getCode(p);
 chain.reader.getStorageAt=safe.reader.getStorageAt;
 chain.reader.getTransaction=async p=>p.hash===safe.tx.hash?safe.tx:getTx(p);
 chain.reader.getTransactionReceipt=async p=>p.hash===safe.tx.hash?safe.receipt:getReceipt(p);
 chain.reader.readContract=async p=>{
  if(p.address?.toLowerCase()!==input.campaignAddress&&p.address?.toLowerCase()!==getContractAddress({from:plan.operator,nonce:0n}).toLowerCase()){
   if(p.functionName==='getMessageHash')return hashTypedData(sponsorSafeConsentMessageV4(context,claim));
   if(p.functionName==='isValidSignature'){assert.equal(p.args[1],signature);return magic?'0x1626ba7e':'0xffffffff';}
   if(p.functionName==='nonce')return 0n;if(p.functionName==='getThreshold')return threshold;return safe.reader.readContract(p);
  }return readContract(p);
 };
 const {observation,...recipient}=await verifySponsorClubSafeConsentV4(chain.reader,{safe:{...safe.input.safe,owners:candidate.owners},campaignContext:context,claim,signature,checkpoint:{number:100n,hash:h(200),timestamp:151n}});
 recipient.signer=recipient.signer.toLowerCase();recipient.signature=recipient.signature.toLowerCase();
 const messages=sponsorClaimMessagesV4(context,claim),approved=await verifySponsorClaimProofV4(context,claim,'operator',plan.operator,await operator.signTypedData(messages.authorization));
 f.events=copy({intent:{sourceStamp:f.sourceStamp,profileFingerprint:f.profileFingerprint,attestation,claim,witness:{finalizedBlock:{number:100n,hash:h(200),timestamp:151n},treasury:null}},recipient,operator:approved});
 // The actual Safe observation is computed below from the same pinned reader.
 const {readSponsorClubClaimV4}=await import('../../../packages/rewards-chain/dist/sponsor-claim-reader-v4.js');
 const observed=await readSponsorClubClaimV4(chain.reader,{plan,slot:0,deploymentHash:input.deploymentHash,fundingHash:input.fundingHash,allocation,entitlementId:h(1),recipient:candidate.safeAddress,
 treasury:{...safe.input,safe:{...safe.input.safe,owners:candidate.owners}},review:{reviewedBlock:{number:100n,hash:h(200),timestamp:151n},deploymentBlock:{number:50n,hash:h(150),timestamp:151n},initializerHash:attestation.initializerHash}});
 f.events.intent.witness.treasury=copy(observed.treasury);
 return{f,chain,setMagic:v=>magic=v,setThreshold:v=>threshold=v};
}
test('club execution binds the verified original Safe quorum and actual operator proof; changed Safe cannot prepare gas',async()=>{
 const {f,chain,setMagic,setThreshold}=await clubFixture(),readFacts=async()=>f;
 const verified=await verifiedSponsorClubClaimExecutionV4(cid,{reader:chain.reader,readFacts});assert.equal(verified.transaction.from,f.plan.operator);assert.equal(verified.transaction.value,'0');assert(!verified.source.includes('signature'));
 setMagic(false);await assert.rejects(verifiedSponsorClubClaimExecutionV4(cid,{reader:chain.reader,readFacts}),/reward_club_consent_invalid/);setMagic(true);
 setThreshold(1n);await assert.rejects(verifiedSponsorClubClaimExecutionV4(cid,{reader:chain.reader,readFacts}),/reward_club_two_signatures_required/);
});
test('club native journal preserves exact bytes across ambiguous broadcast and confirms the Safe payout only after receipt verification',async()=>{
 const {f,chain}=await clubFixture();let job=null;const calls=[];
 const deps={actor:{subject:'did:privy:synthetic',wallet:f.plan.operator},assertActive:async()=>{},reader:chain.reader,nativeClubClaim:{reader:chain.reader,facts:()=>async write=>{if(write){assert.equal(write.action,'receipt');f.events.receipt=write.body;calls.push('verified-safe-payment');}return f;}},rpc:async(_n,a)=>{
 if(a.p_action==='reserve')job={id:a.p_id,subject:a.p_subject,sender:a.p_sender,context:a.p_context,transaction:a.p_transaction,signedTransaction:null,hash:null,confirmed:false};
 if(a.p_action==='signed')job={...job,signedTransaction:a.p_signed,hash:a.p_hash};if(a.p_action==='confirm'){assert.equal(f.events.receipt.transactionHash,a.p_hash);job={...job,confirmed:true};calls.push('confirm');}return{data:job,error:null};}};
 const request={action:'prepare',kind:'clubClaim',claimId:cid,expectedSourceStamp:f.sourceStamp,expectedProfileFingerprint:f.profileFingerprint};assert.deepEqual(controllerTransactionRequest.parse(request),request);
 const prepared=await advanceControllerTransaction(deps,request);assert.equal(prepared.context.kind,'clubClaim');assert.equal(chain.sent.length,0);
 const t=prepared.transaction,bytes=await operator.signTransaction({type:'legacy',chainId:10143,to:t.to,data:t.data,value:0n,nonce:Number(t.nonce),gas:BigInt(t.gas),gasPrice:BigInt(t.gasPrice)});
 const submitted=await advanceControllerTransaction(deps,{action:'submit',id:prepared.id,signedTransaction:bytes});assert.equal(submitted.confirmed,false);assert.equal(chain.sent.length,1);assert.equal(f.events.receipt,undefined);
 chain.payment.value=1n;await assert.rejects(advanceControllerTransaction(deps,{action:'resume',id:prepared.id}));assert.equal(f.events.receipt,undefined);chain.payment.value=0n;
 const confirmed=await advanceControllerTransaction(deps,{action:'resume',id:prepared.id});assert.equal(confirmed.confirmed,true);assert.equal(confirmed.hash,submitted.hash);assert.equal(chain.sent.length,1);assert.equal(f.events.receipt.recipient,f.nomination.candidate.safeAddress);assert.deepEqual(calls.slice(-2),['verified-safe-payment','confirm']);
});
