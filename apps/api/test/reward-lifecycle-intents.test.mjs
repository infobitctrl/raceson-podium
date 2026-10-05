import assert from "node:assert/strict";
import test from "node:test";
import { getContractAddress,keccak256,serializeTransaction,toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readRewardLifecycleContext,reserveRewardLifecycleIntent,storeRewardLifecycleAttempt,readRewardLifecycleAttempt,decodeRewardLifecycleUpload } from "../../../packages/db/dist/rewards/index.js";
import { rewardAllocationCommitment,rewardCampaignBuild,encodeRewardLifecycle,rewardUploadDigest } from "../../../packages/rewards-chain/dist/index.js";
import { prepareRewardLifecycle,recordSignedRewardLifecycle,loadVerifiedRewardLifecycleAttempt } from "../dist/features/rewards/lifecycle-service.js";
import { calculationFixture,rewardId as id,rewardWire } from "./fixtures/reward-calculation.mjs";

// Synthetic SQL-shaped history and ephemeral test signer, no actual chain proof.
const operator=privateKeyToAccount(toHex(0xA11CEn,{size:32}));const stranger=privateKeyToAccount(toHex(0xB0Bn,{size:32}));
const hash=n=>toHex(BigInt(n),{size:32});const zero=hash(0);const code=expected=>error=>error.code===expected;
function fixture(action="upload_awards",count=3,start=0){
  const session=calculationFixture().session;const actorUserId=session.account.userId;const campaignId=id(901);const intentId=id(904);const uploadId=id(906);
  const address=getContractAddress({from:operator.address,nonce:0n}).toLowerCase();
  const upload=rewardAllocationCommitment({programmeId:hash(1),campaignId:hash(2),programmeManifestHash:hash(3),snapshotDigest:hash(4),latestPublicationAt:1700000000n,
    enabledPot:0,budget:1000n,awards:Array.from({length:count},(_,i)=>({entitlementId:hash(10+i),beneficiaryId:hash(100+i),pot:0,amount:1n,explanationHash:hash(200+i),beneficiaryKind:i%2}))});
  const deploymentContext={schemaVersion:1,programmeId:id(900),campaignId,environment:"local_simulation",chainId:31337,operatorAddress:operator.address.toLowerCase(),
    treasuryAddress:stranger.address.toLowerCase(),programmeOnChainId:upload.programmeId,campaignOnChainId:upload.campaignId,manifestHash:upload.programmeManifestHash,pot:"race",budgetWei:"1000",
    intent:{id:id(902),nonce:"0",buildId:rewardCampaignBuild.id,creationCodeHash:rewardCampaignBuild.creationCodeHash,createdByUserId:actorUserId,createdAt:"2026-09-08T01:00:00Z",idempotencyKey:"deployment-test-01"}};
  const prefix=rewardUploadDigest(upload.awards.slice(0,action==="upload_awards"?start:count),0,1000n);
  const checkpoint={campaignId,intentId:id(902),attemptId:id(903),deployment:{schemaVersion:1,chainId:31337,contractAddress:address,
    buildId:rewardCampaignBuild.id,creationCodeHash:rewardCampaignBuild.creationCodeHash,runtimeCodeHash:hash(5),deploymentTransactionHash:hash(6),deploymentNonce:"0",deploymentBlockNumber:"100",deploymentBlockHash:hash(7)},
    observationId:id(909),observation:{schemaVersion:1,finalizedBlock:{number:"200",hash:hash(8),timestamp:"1800000000"},accounting:{
      state:action==="activate"?2:1,paused:false,accountedFunding:"1000",treasuryReturned:"0",budgets:["1000","0"],allocated:[prefix.total.toString(),"0"],paid:["0","0"],nativeBalance:"1000",
      entitlementCount:String(action==="upload_awards"?start:count),uploadDigest:prefix.digest,snapshotDigest:action==="activate"?upload.snapshotDigest:zero,
      allocationDigest:action==="activate"?upload.allocationDigest:zero,activationNotBefore:action==="activate"?"1799999999":"0",claimDeadline:"0",pausedAt:"0"}},
    observedByUserId:actorUserId,observedAt:"2026-09-08T01:00:01Z",idempotencyKey:"checkpoint-test-01"};
  const input={campaignId,uploadId,action,idempotencyKey:"lifecycle-test-01"};const scope={campaignId,actorUserId,uploadId,intentId};
  const context={deploymentContext,checkpoint,upload:{id:uploadId,allocationId:id(910),preparedByUserId:actorUserId,preparedAt:"2026-09-08T01:00:01Z",
    body:rewardWire({...upload,schemaVersion:1,chainId:31337,operatorAddress:deploymentContext.operatorAddress,treasuryAddress:deploymentContext.treasuryAddress,sourceReviewEndsAt:upload.latestPublicationAt+259200n})},
    intent:{id:intentId,observationId:checkpoint.observationId,nonce:"6",action,batchStart:action==="upload_awards"?start:null,batchSize:action==="upload_awards"?Math.min(64,count-start):null,
      createdByUserId:actorUserId,createdAt:"2026-09-08T01:00:02Z",idempotencyKey:input.idempotencyKey}};
  let stored;let corrupt=body=>body;const calls=[];
  const metadata=body=>({attemptId:id(905),intentId,campaignId,recordedByUserId:actorUserId,recordedAt:"2026-09-08T01:00:03Z",transactionHash:body.transactionHash});
  const rpc=async(name,args)=>{
    calls.push({name,args:structuredClone(args)});
    if(name==="service_read_reward_lifecycle_context"||name==="service_reserve_reward_lifecycle")return{data:structuredClone(context),error:null};
    if(name==="service_record_reward_lifecycle_attempt"){stored=structuredClone(args.p_attempt);return{data:metadata(stored),error:null};}
    if(name==="service_read_reward_lifecycle_attempt")return{data:{context:structuredClone(context),attempt:{id:id(905),intentId,body:corrupt(structuredClone(stored)),
      recordedByUserId:actorUserId,recordedAt:"2026-09-08T01:00:03Z",idempotencyKey:"signed-lifecycle-test"}},error:null};
    assert.fail(`Unexpected ${name}`);
  };
  const prepare=()=>prepareRewardLifecycle(session,input,{rpc,reader:{},creationCode:"0x00"});
  const sign=async()=>operator.signTransaction({...encodeRewardLifecycle((await prepare()).plan),type:"eip1559",gas:20000000n,maxFeePerGas:10000000000n,maxPriorityFeePerGas:100000000n});
  return{session,input,scope,intentId,campaignId,uploadId,actorUserId,context,rpc,calls,prepare,sign,setCorrupt:fn=>{corrupt=fn;}};
}

test("lifecycle retries preserve complete package, action, original prestate and nonce for all three actions",async()=>{
  for(const action of ["upload_awards","stage_allocation","activate"]){
    const f=fixture(action);const first=await f.prepare();assert.equal(first.reused,true);assert.equal(first.plan.nonce,6n);assert.equal(first.plan.action,action);
    assert.equal(first.plan.upload.awards.length,3);assert.equal(encodeRewardLifecycle(first.plan).value,0n);assert.deepEqual(await f.prepare(),first);
    assert(f.calls.every(call=>call.name==="service_read_reward_lifecycle_context"));
    await assert.rejects(prepareRewardLifecycle(f.session,{...f.input,action:action==="activate"?"stage_allocation":"activate"},{rpc:f.rpc,reader:{},creationCode:"0x00"}),code("reward_ledger_idempotency_conflict"));
  }
});
test("private lifecycle decoding rejects foreign context, mixed upload identity, clock changes and lossy amounts",async()=>{
  const f=fixture();
  for(const mutate of [c=>{c.extra=true;},c=>{c.upload.id=id(999);},c=>{c.upload.body.chainId=143;},c=>{c.upload.body.programmeId=hash(99);},
    c=>{c.upload.body.sourceReviewEndsAt="1";},c=>{c.upload.body.awards[0].amount=1;},c=>{c.upload.body.entitlementCount="2";},c=>{c.upload.body.budgets[0]="1001";},
    c=>{c.upload.body.awards[0].beneficiaryKind=2;},c=>{c.intent.nonce="0";},c=>{c.intent.batchStart=1; c.intent.batchSize=3;},c=>{c.intent.observationId=id(999);},
    c=>{c.checkpoint.intentId=id(999);},c=>{c.checkpoint.deployment.creationCodeHash=hash(99);},c=>{c.intent.createdByUserId=id(999);},c=>{c.checkpoint=null;}]){
    const copy=structuredClone(f.context);mutate(copy);await assert.rejects(readRewardLifecycleContext(f.scope,async()=>({data:copy,error:null})));
  }
  const body=structuredClone(f.context.upload.body);Object.defineProperty(body,"awards",{get:()=>assert.fail("getter must not run"),enumerable:true});
  assert.throws(()=>decodeRewardLifecycleUpload(body));
});
test("service recomputes hashes and canonical prefix instead of trusting structurally valid stored upload",async()=>{
  for(const mutate of [c=>{c.upload.body.awards[0].explanationHash=hash(999);},c=>{c.upload.body.uploadDigest=hash(999);},
    c=>{c.upload.body.awards.reverse();},c=>{c.checkpoint.observation.accounting.uploadDigest=hash(999);},c=>{c.checkpoint.observation.accounting.state=0;}]){
    const f=fixture();mutate(f.context);await assert.rejects(f.prepare());assert(!f.calls.some(call=>call.name==="service_reserve_reward_lifecycle"));
  }
});
test("reservation sends references only; SQL derives the slice, and exact replay need not bind a newer checkpoint",async()=>{
  const f=fixture();const input={campaignId:f.campaignId,actorUserId:f.actorUserId,uploadId:f.uploadId,action:"upload_awards",idempotencyKey:f.input.idempotencyKey,
    observationId:id(911),observedChainId:31337,pendingNonce:2n};
  const result=await reserveRewardLifecycleIntent(input,async(name,args)=>{
    assert.equal(name,"service_reserve_reward_lifecycle");assert.equal(args.p_pending_nonce,"2");assert.doesNotMatch(Object.keys(args).join(),/batchStart|amount|budget|calldata|awards/);
    input.campaignId=id(999);input.actorUserId=id(998);input.pendingNonce=99n;return{data:structuredClone(f.context),error:null};
  });
  assert.equal(result.intent.nonce,6n);assert.equal(result.intent.observationId,id(909));assert.equal(result.deploymentContext.campaignId,f.campaignId);
});
test("all lifecycle actions store real signed bytes privately, return metadata and revalidate complete witnesses",async()=>{
  for(const action of ["upload_awards","stage_allocation","activate"]){
    const f=fixture(action);const signedTransaction=await f.sign();const input={...f.input,intentId:f.intentId,idempotencyKey:"signed-lifecycle-test",signedTransaction};
    const saved=await recordSignedRewardLifecycle(f.session,input,f.rpc);assert.equal(saved.transactionHash,keccak256(signedTransaction));
    assert.doesNotMatch(JSON.stringify(saved),/signedTransaction|calldata|privateKey/);
    const loaded=await loadVerifiedRewardLifecycleAttempt(f.session,{...f.scope,attemptId:saved.attemptId},f.rpc);
    assert.equal(loaded.verified.signedTransaction,signedTransaction);assert.equal(loaded.verified.action,action);assert.equal(Object.keys(loaded.verified).length,17);
    assert.deepEqual(await recordSignedRewardLifecycle(f.session,input,f.rpc),saved);
  }
});
test("wrong signers, calldata, unsigned and oversize payloads never reach lifecycle storage",async()=>{
  const f=fixture();const plan=(await f.prepare()).plan;const unsigned={...encodeRewardLifecycle(plan),type:"eip1559",gas:300000n,maxFeePerGas:10000000000n,maxPriorityFeePerGas:100000000n};
  for(const signedTransaction of ["0x02aa",serializeTransaction(unsigned),await stranger.signTransaction(unsigned),await operator.signTransaction({...unsigned,value:1n}),`0x02${"aa".repeat(16385)}`])
    await assert.rejects(recordSignedRewardLifecycle(f.session,{...f.input,intentId:f.intentId,signedTransaction},f.rpc));
  assert(!f.calls.some(call=>call.name==="service_record_reward_lifecycle_attempt"));
});
test("corrupted stored signature witness or a slice from a different intent cannot become worker bytes",async()=>{
  const f=fixture();const saved=await recordSignedRewardLifecycle(f.session,{...f.input,intentId:f.intentId,signedTransaction:await f.sign(),idempotencyKey:"signed-lifecycle-test"},f.rpc);
  f.setCorrupt(body=>({...body,calldataHash:hash(99)}));await assert.rejects(loadVerifiedRewardLifecycleAttempt(f.session,{...f.scope,attemptId:saved.attemptId},f.rpc),code("reward_stored_lifecycle_attempt_mismatch"));
  f.setCorrupt(body=>({...body,batchSize:2}));await assert.rejects(readRewardLifecycleAttempt({...f.scope,attemptId:saved.attemptId},f.rpc),code("invalid_reward_lifecycle_document"));
});
test("64-row signed batches and final remainder preserve the entire package on the plan",async()=>{
  for(const start of [0,64]){
    const f=fixture("upload_awards",65,start);const result=await f.prepare();assert.equal(result.plan.batchSize,start===0?64:1);assert.equal(result.plan.upload.awards.length,65);
    const signedTransaction=await f.sign();const saved=await recordSignedRewardLifecycle(f.session,{...f.input,intentId:f.intentId,signedTransaction},f.rpc);
    assert.equal((await loadVerifiedRewardLifecycleAttempt(f.session,{...f.scope,attemptId:saved.attemptId},f.rpc)).plan.batchStart,start);
  }
});
test("empty allocation can stage or activate, while early activation and mismatched stage hashes fail closed",async()=>{
  for(const action of ["stage_allocation","activate"]){const f=fixture(action,0);assert.equal((await f.prepare()).plan.upload.entitlementCount,0n);}
  const f=fixture("activate");f.context.checkpoint.observation.finalizedBlock.timestamp="1799999998";
  await assert.rejects(f.prepare(),code("reward_lifecycle_review_not_finished"));
  f.context.checkpoint.observation.finalizedBlock.timestamp="1800000000";f.context.checkpoint.observation.accounting.allocationDigest=hash(99);
  await assert.rejects(f.prepare(),code("reward_lifecycle_staging_mismatch"));
});
test("signed recording captures scope before I/O and refuses malformed repository documents without revealing errors",async()=>{
  const f=fixture();const signedTransaction=await f.sign();const input={...f.input,intentId:f.intentId,signedTransaction,idempotencyKey:"signed-lifecycle-test"};
  const rpc=async(name,args)=>{const result=await f.rpc(name,args);if(name==="service_read_reward_lifecycle_context"){
    f.session.account.userId=id(999);input.uploadId=id(998);input.signedTransaction="0x02aa";input.idempotencyKey="mutated-key";}return result;};
  const saved=await recordSignedRewardLifecycle(f.session,input,rpc);assert.equal(saved.recordedByUserId,f.actorUserId);
  const write=f.calls.find(call=>call.name==="service_record_reward_lifecycle_attempt");assert.equal(write.args.p_upload_id,f.uploadId);assert.equal(write.args.p_idempotency_key,"signed-lifecycle-test");
  for(const patch of [{value:"1"},{batchStart:null},{extra:true},{gasLimit:"0"},{nonce:6}])
    await assert.rejects(storeRewardLifecycleAttempt({...f.scope,idempotencyKey:"invalid-attempt",attempt:{...write.args.p_attempt,...patch}},()=>assert.fail("must not write")));
  await assert.rejects(readRewardLifecycleContext(f.scope,async()=>({data:null,error:{message:"reward_operator_permission_required"}})),code("reward_operator_permission_required"));
  await assert.rejects(readRewardLifecycleContext(f.scope,async()=>({data:null,error:{message:"synthetic secret endpoint"}})),code("reward_ledger_store_failed"));
  await assert.rejects(readRewardLifecycleContext(f.scope,async()=>{throw new Error("synthetic token");}),code("reward_ledger_unavailable"));
});
