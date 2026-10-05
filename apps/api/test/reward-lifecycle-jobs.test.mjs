import assert from "node:assert/strict";
import { test } from "node:test";
import { queueRewardLifecycleJob,readRewardLifecycleJob,stepRewardLifecycleJob,confirmRewardLifecycleJob } from "../../../packages/db/dist/rewards/index.js";
const id=n=>`75000000-0000-4000-8000-${String(n).padStart(12,"0")}`;const hash=n=>`0x${String(n).repeat(64)}`;const addr=n=>`0x${String(n).repeat(40)}`;
const fixture=()=>({jobId:id(1),campaignId:id(2),uploadId:id(10),intentId:id(3),attemptId:id(4),transactionHash:hash(1),
  predecessorFundingJobId:id(11),predecessorLifecycleJobId:null,createdByUserId:id(5),createdAt:"2026-09-08T06:00:00Z",idempotencyKey:"lifecycle-job-fixture",
  state:"queued",mayHaveBroadcast:false,leaseOwner:null,leaseToken:null,leaseExpiresAt:null,leaseGeneration:0,confirmationObservationId:null});
const queueInput=()=>({campaignId:id(2),actorUserId:id(5),uploadId:id(10),intentId:id(3),attemptId:id(4),idempotencyKey:"lifecycle-job-fixture"});
const stepInput=()=>({jobId:id(1),actorUserId:id(5),workerId:id(6),leaseToken:null,action:"lease"});
const leased=()=>({...fixture(),state:"leased",leaseOwner:id(6),leaseToken:id(7),leaseGeneration:1,leaseExpiresAt:"2026-09-08T06:01:00Z"});
const confirmed=()=>({...fixture(),state:"confirmed",mayHaveBroadcast:true,leaseGeneration:2,confirmationObservationId:id(9)});
test("lifecycle queue preserves request scope and never accepts caller-selected predecessor IDs",async()=>{
  const input=queueInput();let calls=0;
  const job=await queueRewardLifecycleJob(input,async(name,args)=>{
    calls++;assert.equal(name,"service_queue_reward_lifecycle_job");input.uploadId=id(99);input.actorUserId=id(99);
    assert.equal(args.p_upload_id,id(10));assert.equal(args.p_actor_user_id,id(5));assert(!Object.keys(args).some(key=>/predecessor/.test(key)));
    return{data:fixture(),error:null};
  });assert.equal(calls,1);assert.equal(job.uploadId,id(10));assert.equal(job.predecessorFundingJobId,id(11));
});
test("lifecycle jobs reject zero/two/self predecessor references, foreign scope and invalid lease states",async()=>{
  for(const mutate of [j=>{j.predecessorFundingJobId=null;},j=>{j.predecessorLifecycleJobId=id(12);},j=>{j.predecessorFundingJobId=null;j.predecessorLifecycleJobId=j.jobId;},
    j=>{j.uploadId="invalid";},j=>{j.jobId=id(99);},j=>{j.createdByUserId=id(99);},j=>{j.state="confirmed";},j=>{j.leaseToken=id(7);},j=>{j.leaseGeneration=1.5;},
    j=>{j.extra="signed bytes";},j=>{j.state="broadcasting";},j=>{j.transactionHash="0x";}]){
    const value=fixture();mutate(value);await assert.rejects(readRewardLifecycleJob({jobId:id(1),actorUserId:id(5)},async()=>({data:value,error:null})));
  }
  const value=fixture();Object.defineProperty(value,"state",{enumerable:true,get:()=>assert.fail("getter must not execute")});
  await assert.rejects(readRewardLifecycleJob({jobId:id(1),actorUserId:id(5)},async()=>({data:value,error:null})));
});
test("busy leases, stale capabilities and completed states have distinct private semantics",async()=>{
  assert.equal(await stepRewardLifecycleJob(stepInput(),async()=>({data:null,error:null})),null);
  assert.deepEqual(await stepRewardLifecycleJob(stepInput(),async()=>({data:leased(),error:null})),leased());
  for(const result of [null,leased(),{...leased(),state:"broadcasting",mayHaveBroadcast:true,leaseToken:id(8)}])
    await assert.rejects(stepRewardLifecycleJob({...stepInput(),leaseToken:id(7),action:"arm"},async()=>({data:result,error:null})));
  assert.deepEqual(await stepRewardLifecycleJob(stepInput(),async()=>({data:confirmed(),error:null})),confirmed());
  await assert.rejects(stepRewardLifecycleJob(stepInput(),async()=>({data:{...confirmed(),leaseOwner:id(6),leaseToken:id(7),leaseExpiresAt:"2026-09-08T06:01:00Z"},error:null})));
  await assert.rejects(stepRewardLifecycleJob(stepInput(),async()=>({data:{...confirmed(),mayHaveBroadcast:false},error:null})));
});
test("known source/authority/predecessor errors remain actionable without leaking provider details",async()=>{
  for(const code of ["reward_lifecycle_job_lease_lost","reward_review_source_changed","reward_record_approval_withdrawn","reward_lifecycle_predecessor_not_confirmed","reward_operator_permission_required"])
    await assert.rejects(stepRewardLifecycleJob(stepInput(),async()=>({data:null,error:{message:code}})),{code});
  await assert.rejects(readRewardLifecycleJob({jobId:id(1),actorUserId:id(5)},async()=>{throw new Error("synthetic secret endpoint");}),
    e=>e.code==="reward_ledger_unavailable" && e.cause===undefined && !e.stack.includes("secret endpoint"));
  await assert.rejects(queueRewardLifecycleJob(queueInput(),async()=>({data:null,error:{message:"private SQL detail"}})),{code:"reward_ledger_store_failed"});
});
function proof(action="upload_awards"){
  const at=1800000000n;const finalizedBlock={number:"205",hash:hash(5),timestamp:String(at+100n)};
  const deployment={schemaVersion:1,chainId:31337,contractAddress:addr(1),buildId:"synthetic-build",creationCodeHash:hash(2),runtimeCodeHash:hash(3),
    deploymentTransactionHash:hash(4),deploymentNonce:"0",deploymentBlockNumber:"100",deploymentBlockHash:hash(4)};
  const observation={schemaVersion:1,finalizedBlock:structuredClone(finalizedBlock),accounting:{state:action==="upload_awards"?1:action==="stage_allocation"?2:3,
    paused:false,accountedFunding:"12",treasuryReturned:"0",budgets:["12","0"],allocated:["2","0"],paid:["0","0"],nativeBalance:"112",
    entitlementCount:"2",uploadDigest:hash(2),snapshotDigest:action==="upload_awards"?hash(0):hash(6),allocationDigest:action==="upload_awards"?hash(0):hash(7),
    activationNotBefore:action==="upload_awards"?"0":String(action==="stage_allocation"?at+86400n:at-1n),claimDeadline:action==="activate"?String(at+31536000n):"0",pausedAt:"0"}};
  const lifecycle={schemaVersion:1,action,chainId:31337,contractAddress:addr(1),operatorAddress:addr(2),transactionHash:hash(1),nonce:"3",blockNumber:"204",blockHash:hash(6),
    blockTimestamp:String(at),firstLogIndex:1,lastLogIndex:action==="upload_awards"?2:1,batchStart:action==="upload_awards"?0:null,batchSize:action==="upload_awards"?2:null,
    allocationDigest:hash(7),activationNotBefore:action==="stage_allocation"?String(at+86400n):null,claimDeadline:action==="activate"?String(at+31536000n):null,
    runtimeCodeHash:hash(3),finalizedBlock};
  return{jobId:id(1),actorUserId:id(5),workerId:id(6),leaseToken:id(7),lifecycle,deployment,observation};
}
test("all three receipt types commit one copied proof/accounting bundle and only return confirmed metadata",async()=>{
  for(const action of ["upload_awards","stage_allocation","activate"]){
    const input=proof(action);let calls=0;const original=structuredClone(input);
    const result=await confirmRewardLifecycleJob(input,async(name,args)=>{
      calls++;assert.equal(name,"service_confirm_reward_lifecycle_job");input.actorUserId=id(99);input.lifecycle.blockTimestamp="1";
      input.observation.finalizedBlock.hash=hash(9);assert.deepEqual(args.p_lifecycle,original.lifecycle);assert.deepEqual(args.p_observation,original.observation);
      assert.equal(args.p_actor_user_id,id(5));return{data:confirmed(),error:null};
    });assert.deepEqual(result,confirmed());assert.equal(calls,1);
  }
});
test("malformed provenance, receipt clocks and log/slice bounds never reach confirmation SQL",async()=>{
  const mutations=[v=>{v.lifecycle.extra=true;},v=>{v.lifecycle.nonce="0";},v=>{v.lifecycle.chainId=143;},v=>{v.lifecycle.runtimeCodeHash=hash(9);},v=>{v.lifecycle.blockNumber="206";},
    v=>{v.lifecycle.blockTimestamp="1800000101";},v=>{v.lifecycle.finalizedBlock.timestamp="0";},v=>{v.lifecycle.firstLogIndex=0.5;},v=>{v.lifecycle.lastLogIndex=3;},
    v=>{v.lifecycle.batchSize=65;},v=>{v.lifecycle.batchStart=1;},v=>{v.lifecycle.claimDeadline="1";},v=>{v.observation.accounting.state=0;}];
  for(const mutate of mutations){const input=proof();mutate(input);await assert.rejects(confirmRewardLifecycleJob(input,()=>assert.fail("must not write")));}
  for(const action of ["stage_allocation","activate"]){
    for(const mutate of [v=>{v.lifecycle.batchStart=0;},v=>{v.lifecycle.lastLogIndex=2;},v=>{v.lifecycle.allocationDigest=hash(9);},
      v=>{v.lifecycle[action==="activate"?"claimDeadline":"activationNotBefore"]="1";}]){
      const input=proof(action);mutate(input);await assert.rejects(confirmRewardLifecycleJob(input,()=>assert.fail("must not write")));
    }
  }
  await assert.rejects(confirmRewardLifecycleJob(proof(),async()=>({data:{...confirmed(),transactionHash:hash(9)},error:null})),{code:"invalid_reward_lifecycle_job"});
});
