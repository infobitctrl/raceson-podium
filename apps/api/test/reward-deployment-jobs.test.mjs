import assert from "node:assert/strict";
import { test } from "node:test";
import { queueRewardDeploymentJob,readRewardDeploymentJob,stepRewardDeploymentJob } from "../../../packages/db/dist/rewards/index.js";
const id=n=>`75000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const fixture=()=>({jobId:id(1),campaignId:id(2),intentId:id(3),attemptId:id(4),transactionHash:`0x${'1'.repeat(64)}`,
  createdByUserId:id(5),createdAt:"2026-09-08T03:30:00Z",idempotencyKey:"job-unit-fixture",state:"queued",mayHaveBroadcast:false,
  leaseOwner:null,leaseToken:null,leaseExpiresAt:null,leaseGeneration:0,confirmationObservationId:null});
const queueInput=()=>({campaignId:id(2),actorUserId:id(5),intentId:id(3),attemptId:id(4),idempotencyKey:"job-unit-fixture"});
const stepInput=()=>({jobId:id(1),actorUserId:id(5),workerId:id(6),leaseToken:null,action:"lease"});
const leased=()=>({...fixture(),state:"leased",leaseOwner:id(6),leaseToken:id(7),leaseGeneration:1,leaseExpiresAt:"2026-09-08T03:31:00Z"});
test("deployment queue calls one exact private RPC and copies request scope",async()=>{
  const input=queueInput(); let calls=0;
  const job=await queueRewardDeploymentJob(input,async(name,args)=>{
    calls++;assert.equal(name,"service_queue_reward_deployment_job");input.campaignId=id(99);input.actorUserId=id(99);
    assert.equal(args.p_campaign_id,id(2));assert.equal(args.p_actor_user_id,id(5));return{data:fixture(),error:null};});
  assert.equal(calls,1);assert.equal(job.attemptId,id(4));assert.equal(job.state,"queued");
});
test("lease busy is distinct from missing write acknowledgement and stale tokens are rejected",async()=>{
  assert.equal(await stepRewardDeploymentJob(stepInput(),async()=>({data:null,error:null})),null);
  const lease=await stepRewardDeploymentJob(stepInput(),async()=>({data:leased(),error:null}));assert.equal(lease.leaseToken,id(7));
  await assert.rejects(stepRewardDeploymentJob({...stepInput(),leaseToken:id(7),action:"arm"},async()=>({data:null,error:null})));
  await assert.rejects(stepRewardDeploymentJob({...stepInput(),leaseToken:id(7),action:"arm"},async()=>({data:leased(),error:null})),{code:"invalid_reward_deployment_job"});
  await assert.rejects(stepRewardDeploymentJob({...stepInput(),workerId:id(8)},async()=>({data:leased(),error:null})),{code:"invalid_reward_deployment_job"});
  await assert.rejects(stepRewardDeploymentJob({...stepInput(),leaseToken:id(8),action:"arm"},async()=>({data:{...leased(),state:"broadcasting",mayHaveBroadcast:true},error:null})),{code:"invalid_reward_deployment_job"});
});
test("job wire decoders reject identity, state, lease and private-field substitution",async()=>{
  for(const mutation of [j=>{j.jobId=id(99);},j=>{j.createdByUserId=id(99);},j=>{j.extra="signed bytes";},j=>{j.transactionHash="0x";},
    j=>{j.state="confirmed";},j=>{j.state="broadcasting";},j=>{j.leaseToken=id(7);},j=>{j.leaseGeneration=1.5;}]){
    const job=fixture();mutation(job);await assert.rejects(readRewardDeploymentJob({jobId:id(1),actorUserId:id(5)},async()=>({data:job,error:null})));
  }
  const job=fixture();let accessed=0;Object.defineProperty(job,"state",{enumerable:true,get(){accessed++;return"queued";}});
  await assert.rejects(readRewardDeploymentJob({jobId:id(1),actorUserId:id(5)},async()=>({data:job,error:null})));assert.equal(accessed,0);
});
test("confirmed jobs carry a persisted observation and cannot be mistaken for an active lease",async()=>{
  const job={...fixture(),state:"confirmed",confirmationObservationId:id(9),leaseGeneration:2,mayHaveBroadcast:true};
  assert.equal((await stepRewardDeploymentJob(stepInput(),async()=>({data:job,error:null}))).state,"confirmed");
  await assert.rejects(stepRewardDeploymentJob(stepInput(),async()=>({data:{...job,leaseOwner:id(6),leaseToken:id(7),leaseExpiresAt:"2026-09-08T03:31:00Z"},error:null})));
});
test("job transport only propagates known safe error codes",async()=>{
  await assert.rejects(stepRewardDeploymentJob(stepInput(),async()=>({data:null,error:{message:"reward_deployment_job_lease_lost"}})),{code:"reward_deployment_job_lease_lost"});
  await assert.rejects(readRewardDeploymentJob({jobId:id(1),actorUserId:id(5)},async()=>{throw new Error("private endpoint credential");}),
    e=>e.code==="reward_ledger_unavailable" && e.cause===undefined && !e.stack.includes("credential"));
  await assert.rejects(queueRewardDeploymentJob(queueInput(),async()=>({data:null,error:{message:"private SQL detail"}})),{code:"reward_ledger_store_failed"});
});
