import test from 'node:test';import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';import {toHex,hashMessage,getContractAddress} from 'viem';
import {fixture,saved,id,setupId} from './fixtures/hosted-approval-fixture.mjs';
import {createSponsorExecutionPlan} from '../../../packages/domain/dist/rewards/sponsor-execution.js';
import {sponsorAllocationDocumentHashV4 as digest,copyRewardLedgerDocument as copy} from '../../../packages/db/dist/rewards/index.js';
import {sponsorLifecycleCommitmentV4} from '../../../packages/rewards-chain/dist/sponsor-lifecycle-v4.js';
import {sponsorClaimMessagesV4,verifySponsorClaimProofV4} from '../../../packages/rewards-chain/dist/sponsor-claims-v4.js';
import {prepareAthleteWalletProof} from '../dist/features/rewards/athlete-wallet-service.js';
import {verifiedSponsorClaimExecutionV4} from '../dist/features/rewards/sponsor-claims-v4-service.js';
import {advanceControllerTransaction,controllerTransactionRequest} from '../dist/features/rewards/controller-transactions.js';
const h=n=>toHex(BigInt(n),{size:32}),origin='https://podium.raceson.com',recipient=privateKeyToAccount(h(1907)),operator=privateKeyToAccount(h(1908)),cid=id(4),actor={userId:id(1),sessionId:id(2)};
// Deterministic owned signers and invented facts; no provider, DB or chain writes.
async function facts(){
 const launch={id:id(9902),state:'prepared',configurationHash:'f'.repeat(64),createdAt:'2026-10-05T00:00:00Z',setup:saved(fixture())};
 const plan=createSponsorExecutionPlan(launch,recipient.address,{operator:operator.address.toLowerCase(),treasury:'0x'+'3'.repeat(40),reviewPeriods:[0,0,0,0,0,0]});
 const evidence={synthetic:true},publication={approvalId:id(6),evidence,timing:{reviewPeriod:'0',reviewStartedAt:'100',officialPublishedAt:'100',publicationEvidenceHash:'0x'+digest(evidence)}};
 const awards=[{entitlementId:h(1),beneficiaryId:h(2),pot:1,amount:101n,explanationHash:h(3),beneficiaryKind:0}];
 const input={plan,slot:0,deploymentHash:h(10),fundingHash:h(11),campaignAddress:getContractAddress({from:getContractAddress({from:operator.address,nonce:0n}),nonce:1n}).toLowerCase(),snapshotDigest:h(12),awards,publication:publication.timing};
 const allocation=sponsorLifecycleCommitmentV4(input),{plan:unusedPlan,publication:unusedPublication,...packageInput}=input,pkg=copy({...packageInput,approvalId:id(6),chainId:10143,uploadDigest:allocation.uploadDigest,entitlementCount:allocation.entitlementCount});publication.packageHash=digest(pkg);
 const challenge={challengeId:id(3),...actor,chainId:10143,address:recipient.address.toLowerCase(),origin,nonce:'e'.repeat(64),issuedAt:'2026-10-06T01:00:00Z',expiresAt:'2026-10-06T01:10:00Z',checkedAt:'2026-10-06T01:00:01Z',idempotencyKey:'owned-claim-wallet',proof:null};
 const prepared=await prepareAthleteWalletProof(actor,{address:challenge.address,idempotencyKey:challenge.idempotencyKey},{chainId:10143,origin,rpc:async()=>({data:challenge,error:null})});challenge.proof={proofId:id(5),messageHash:hashMessage(prepared.message),signature:await recipient.signMessage({message:prepared.message}),verifiedAt:'2026-10-06T01:00:02Z'};
 const context={environment:'monad-testnet',chainId:10143,verifyingContract:input.campaignAddress},claim={entitlementId:h(1),recipient:challenge.address,amount:101n,pot:'league',nonce:0n,issuedAt:100n,expiresAt:200n,allocationDigest:allocation.allocationDigest};
 const messages=sponsorClaimMessagesV4(context,claim),proofs={};
 for(const[role,account,message]of[['recipient',recipient,messages.consent],['operator',operator,messages.authorization]])proofs[role]=await verifySponsorClaimProofV4(context,claim,role,plan.operator,await account.signTypedData(message));
 return{claimId:cid,entitlementId:h(1),approvalId:id(6),setupId,slot:0,current:true,sourceStamp:'b'.repeat(64),profileFingerprint:'c'.repeat(64),plan,
  destination:{requestId:id(7),...actor,athleteProfileId:id(8),proofId:id(5),address:challenge.address,chainId:10143,requestedAt:'2026-10-06T01:00:03Z',idempotencyKey:'owned-claim-choice',withdrawnAt:null,status:'pending_review'},challenge,package:pkg,packageHash:digest(pkg),publication,
  events:copy({intent:{sourceStamp:'b'.repeat(64),profileFingerprint:'c'.repeat(64),claim,witness:{finalizedBlock:{number:'1',hash:h(4),timestamp:'100'}}},...proofs})};
}
test('native journal binding verifies real EIP191/EIP712 signatures and returns no raw signature in its source',async()=>{
 const f=await facts(),result=await verifiedSponsorClaimExecutionV4(cid,{origin,readFacts:async()=>f},false);
 assert.equal(result.transaction.from,operator.address.toLowerCase());assert.equal(result.transaction.to,f.package.campaignAddress);assert.equal(result.transaction.value,'0');
 const source=JSON.parse(result.source);assert.equal(source.claim.amount,'101');assert.equal(source.claimId,cid);assert.equal(source.recipient.signer,recipient.address.toLowerCase());assert.equal(source.operator.signer,operator.address.toLowerCase());assert(!result.source.includes('signature'));
 assert.equal(Object.keys(source).length,9);
});
test('wrong consent, source drift, revoked readiness and absent live observer cannot reserve claim gas',async()=>{
 for(const mutate of [f=>f.current=false,f=>delete f.events.recipient,f=>f.events.operator.signature=f.events.recipient.signature,f=>f.events.revoked={reason:'operator_hold'}]){
  const f=await facts();mutate(f);await assert.rejects(verifiedSponsorClaimExecutionV4(cid,{origin,readFacts:async()=>f},false));
 }
 const f=await facts();let reads=0;await assert.rejects(verifiedSponsorClaimExecutionV4(cid,{origin,readFacts:async()=>++reads===1?f:{...f,profileFingerprint:'d'.repeat(64)}},false),/reward_planning_revision_changed/);
 await assert.rejects(verifiedSponsorClaimExecutionV4(cid,{origin,readFacts:async()=>f}),/reward_sponsor_claim_not_ready/);
});
test('claim preparation strictly binds reviewed stamps and refuses non-hosted facts before estimation',async()=>{
 const r={action:'prepare',kind:'claim',claimId:cid,expectedSourceStamp:'b'.repeat(64),expectedProfileFingerprint:'c'.repeat(64)};assert.deepEqual(controllerTransactionRequest.parse(r),r);
 for(const patch of [{amountWei:'1'},{recipient:recipient.address},{expectedSourceStamp:'wrong'},{chainId:1}])assert.throws(()=>controllerTransactionRequest.parse({...r,...patch}));
 const calls=[],deps={actor:{subject:'did:privy:synthetic',wallet:operator.address.toLowerCase()},assertActive:async()=>{},reader:{getChainId:async()=>10143,estimateGas:async()=>assert.fail('unverified claim cannot estimate')},rpc:async(n,a)=>{calls.push(a.p_action);return{data:null,error:null};}};
 await assert.rejects(advanceControllerTransaction(deps,r),/controller_source_not_ready/);assert.deepEqual(calls,['read']);
});
test('native claim pending diagnostics remain visible without rechecking held recipient readiness or broadcasting',async()=>{
 const {controllerTransactionStatus}=await import('../dist/features/rewards/controller-transactions.js');let called=0;
 const job={id:cid,subject:'did:privy:synthetic',sender:operator.address.toLowerCase(),context:{kind:'claim',claimId:cid,setupId,approvalId:id(6),source:'immutable'},transaction:{chainId:10143,to:'0x'+'4'.repeat(40),data:'0xaa',value:'0',nonce:'10',gas:'200000',gasPrice:'100000000000'},signedTransaction:null,hash:null,confirmed:false};
 const status=await controllerTransactionStatus({actor:{subject:job.subject,wallet:job.sender},assertActive:async()=>{},reader:{getChainId:async()=>10143,getTransactionCount:async()=>10,sendRawTransaction:async()=>assert.fail('diagnostic broadcast')},nativeClaim:{origin,facts:()=>{called++;throw Error('held readiness must not hide pending nonce');}},rpc:async(_n,a)=>({data:a.p_id?null:job,error:null})});
 assert.equal(status.pending.context.claimId,cid);assert.equal(status.pending.confirmed,false);assert.equal(status.nonceStatus.state,'unused');assert.equal(called,0);assert(!JSON.stringify(status).includes('signedTransaction'));
});
test('native claim journal reserves, signs, survives ambiguous broadcast and confirms only its exact finalized payment',async()=>{
 const {hostedClaimChain}=await import('./fixtures/hosted-claim-chain.mjs'),f=await facts(),chain=hostedClaimChain(f),calls=[];let job=null;
 const deps={actor:{subject:'did:privy:synthetic',wallet:f.plan.operator},assertActive:async()=>{},reader:chain.reader,nativeClaim:{origin,facts:()=>async write=>{if(write){assert.equal(write.action,'receipt');f.events.receipt=write.body;calls.push('verified-payment');}return f;}},rpc:async(n,a)=>{assert.equal(n,'service_reward_controller_transaction');calls.push(a.p_action);
  if(a.p_action==='reserve')job={id:a.p_id,subject:a.p_subject,sender:a.p_sender,context:a.p_context,transaction:a.p_transaction,signedTransaction:null,hash:null,confirmed:false};
  if(a.p_action==='signed')job={...job,signedTransaction:a.p_signed,hash:a.p_hash};
  if(a.p_action==='confirm'){assert.equal(f.events.receipt.transactionHash,a.p_hash);job={...job,confirmed:true};}return{data:job,error:null};}};
 const request={action:'prepare',kind:'claim',claimId:cid,expectedSourceStamp:f.sourceStamp,expectedProfileFingerprint:f.profileFingerprint},prepared=await advanceControllerTransaction(deps,request);
 assert.equal(prepared.context.claimId,cid);assert.equal(prepared.transaction.nonce,'10');assert.equal(prepared.transaction.gas,'240000');assert.equal(chain.sent.length,0);
 const t=prepared.transaction,bytes=await operator.signTransaction({type:'legacy',chainId:10143,to:t.to,data:t.data,value:0n,nonce:10,gas:BigInt(t.gas),gasPrice:BigInt(t.gasPrice)});
 const wrong=await operator.signTransaction({type:'legacy',chainId:10143,to:t.to,data:t.data,value:1n,nonce:10,gas:BigInt(t.gas),gasPrice:BigInt(t.gasPrice)});
 await assert.rejects(advanceControllerTransaction(deps,{action:'submit',id:prepared.id,signedTransaction:wrong}),/controller_transaction_invalid/);assert.equal(chain.sent.length,0);assert.equal(job.signedTransaction,null);
 const submitted=await advanceControllerTransaction(deps,{action:'submit',id:prepared.id,signedTransaction:bytes});assert.equal(submitted.confirmed,false);assert.equal(chain.sent.length,1);assert.equal(f.events.receipt,undefined);
 chain.payment.value=1n;await assert.rejects(advanceControllerTransaction(deps,{action:'resume',id:prepared.id}),/reward_sponsor_claim_not_ready/);assert.equal(f.events.receipt,undefined);assert.equal(job.confirmed,false);chain.payment.value=0n;
 const confirmed=await advanceControllerTransaction(deps,{action:'resume',id:prepared.id});assert.equal(confirmed.confirmed,true);assert.equal(confirmed.hash,submitted.hash);assert.equal(chain.sent.length,1);assert.equal(f.events.receipt.amountWei,'101');assert.equal(f.events.receipt.recipient,recipient.address.toLowerCase());assert.deepEqual(calls.slice(-2),['verified-payment','confirm']);
});
