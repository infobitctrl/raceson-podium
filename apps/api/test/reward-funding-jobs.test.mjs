import assert from "node:assert/strict";
import { test } from "node:test";
import { queueRewardFundingJob,readRewardFundingJob,stepRewardFundingJob,confirmRewardFundingJob } from "../../../packages/db/dist/rewards/index.js";
const id=n=>`75000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const fixture=()=>({jobId:id(1),campaignId:id(2),intentId:id(3),attemptId:id(4),transactionHash:`0x${'1'.repeat(64)}`,
  createdByUserId:id(5),createdAt:"2026-09-08T03:30:00Z",idempotencyKey:"job-unit-fixture",state:"queued",mayHaveBroadcast:false,
  leaseOwner:null,leaseToken:null,leaseExpiresAt:null,leaseGeneration:0,confirmationObservationId:null});
const queueInput=()=>({campaignId:id(2),actorUserId:id(5),intentId:id(3),attemptId:id(4),idempotencyKey:"job-unit-fixture"});
const stepInput=()=>({jobId:id(1),actorUserId:id(5),workerId:id(6),leaseToken:null,action:"lease"});
const leased=()=>({...fixture(),state:"leased",leaseOwner:id(6),leaseToken:id(7),leaseGeneration:1,leaseExpiresAt:"2026-09-08T03:31:00Z"});
test("funding queue calls one exact private RPC and copies request scope",async()=>{
  const input=queueInput(); let calls=0;
  const job=await queueRewardFundingJob(input,async(name,args)=>{
    calls++;assert.equal(name,"service_queue_reward_funding_job");input.campaignId=id(99);input.actorUserId=id(99);
    assert.equal(args.p_campaign_id,id(2));assert.equal(args.p_actor_user_id,id(5));return{data:fixture(),error:null};});
  assert.equal(calls,1);assert.equal(job.attemptId,id(4));assert.equal(job.state,"queued");
});
test("lease busy is distinct from missing write acknowledgement and stale tokens are rejected",async()=>{
  assert.equal(await stepRewardFundingJob(stepInput(),async()=>({data:null,error:null})),null);
  const lease=await stepRewardFundingJob(stepInput(),async()=>({data:leased(),error:null}));assert.equal(lease.leaseToken,id(7));
  await assert.rejects(stepRewardFundingJob({...stepInput(),leaseToken:id(7),action:"arm"},async()=>({data:null,error:null})));
  await assert.rejects(stepRewardFundingJob({...stepInput(),leaseToken:id(7),action:"arm"},async()=>({data:leased(),error:null})),{code:"invalid_reward_funding_job"});
  await assert.rejects(stepRewardFundingJob({...stepInput(),workerId:id(8)},async()=>({data:leased(),error:null})),{code:"invalid_reward_funding_job"});
  await assert.rejects(stepRewardFundingJob({...stepInput(),leaseToken:id(8),action:"arm"},async()=>({data:{...leased(),state:"broadcasting",mayHaveBroadcast:true},error:null})),{code:"invalid_reward_funding_job"});
});
test("job wire decoders reject identity, state, lease and private-field substitution",async()=>{
  for(const mutation of [j=>{j.jobId=id(99);},j=>{j.createdByUserId=id(99);},j=>{j.extra="signed bytes";},j=>{j.transactionHash="0x";},
    j=>{j.state="confirmed";},j=>{j.state="broadcasting";},j=>{j.leaseToken=id(7);},j=>{j.leaseGeneration=1.5;}]){
    const job=fixture();mutation(job);await assert.rejects(readRewardFundingJob({jobId:id(1),actorUserId:id(5)},async()=>({data:job,error:null})));
  }
  const job=fixture();let accessed=0;Object.defineProperty(job,"state",{enumerable:true,get(){accessed++;return"queued";}});
  await assert.rejects(readRewardFundingJob({jobId:id(1),actorUserId:id(5)},async()=>({data:job,error:null})));assert.equal(accessed,0);
});
test("confirmed jobs carry a persisted observation and cannot be mistaken for an active lease",async()=>{
  const job={...fixture(),state:"confirmed",confirmationObservationId:id(9),leaseGeneration:2,mayHaveBroadcast:true};
  assert.equal((await stepRewardFundingJob(stepInput(),async()=>({data:job,error:null}))).state,"confirmed");
  await assert.rejects(stepRewardFundingJob(stepInput(),async()=>({data:{...job,leaseOwner:id(6),leaseToken:id(7),leaseExpiresAt:"2026-09-08T03:31:00Z"},error:null})));
});
test("job transport only propagates known safe error codes",async()=>{
  await assert.rejects(stepRewardFundingJob(stepInput(),async()=>({data:null,error:{message:"reward_funding_job_lease_lost"}})),{code:"reward_funding_job_lease_lost"});
  await assert.rejects(readRewardFundingJob({jobId:id(1),actorUserId:id(5)},async()=>{throw new Error("private endpoint credential");}),
    e=>e.code==="reward_ledger_unavailable" && e.cause===undefined && !e.stack.includes("credential"));
  await assert.rejects(queueRewardFundingJob(queueInput(),async()=>({data:null,error:{message:"private SQL detail"}})),{code:"reward_ledger_store_failed"});
});

const confirmation=()=>{
  const h=n=>`0x${String(n).repeat(64)}`;const a=n=>`0x${String(n).repeat(40)}`;
  const finalizedBlock={number:"205",hash:h(5),timestamp:"1800000000"};
  const deployment={schemaVersion:1,chainId:31337,contractAddress:a(1),buildId:"synthetic-build",creationCodeHash:h(2),runtimeCodeHash:h(3),
    deploymentTransactionHash:h(4),deploymentNonce:"0",deploymentBlockNumber:"100",deploymentBlockHash:h(4)};
  const observation={schemaVersion:1,finalizedBlock:structuredClone(finalizedBlock),accounting:{state:1,paused:false,accountedFunding:"12",treasuryReturned:"0",
    budgets:["12","0"],allocated:["0","0"],paid:["0","0"],nativeBalance:"112",entitlementCount:"0",uploadDigest:h(0),snapshotDigest:h(0),allocationDigest:h(0),
    activationNotBefore:"0",claimDeadline:"0",pausedAt:"0"}};
  const funding={schemaVersion:1,action:"complete_funding",chainId:31337,contractAddress:a(1),operatorAddress:a(2),transactionHash:h(1),nonce:"1",
    blockNumber:"204",blockHash:h(6),fundingClosedLogIndex:1,depositedValue:"9",expectedAccountedFunding:"3",budget:"12",enabledPot:0,runtimeCodeHash:h(3),finalizedBlock};
  return{jobId:id(1),actorUserId:id(5),workerId:id(6),leaseToken:id(7),funding,deployment,observation};
};
test("funding confirmation copies exact receipt/accounting and performs one atomic private RPC",async()=>{
  const input=confirmation();let calls=0;
  const confirmed={...fixture(),state:"confirmed",confirmationObservationId:id(9),leaseGeneration:1,mayHaveBroadcast:true};
  assert.deepEqual(await confirmRewardFundingJob(input,async(name,args)=>{
    calls++;assert.equal(name,"service_confirm_reward_funding_job");
    input.funding.budget="999";input.observation.finalizedBlock.hash=`0x${'9'.repeat(64)}`;input.actorUserId=id(99);
    assert.equal(args.p_funding.budget,"12");assert.equal(args.p_observation.finalizedBlock.hash,`0x${'5'.repeat(64)}`);assert.equal(args.p_actor_user_id,id(5));
    return{data:confirmed,error:null};
  }),confirmed);assert.equal(calls,1);
});
test("funding confirmation rejects disconnected, lossy or malformed proofs before SQL",async()=>{
  for(const mutate of [v=>{v.funding.budget="13";},v=>{v.funding.chainId=143;},v=>{v.funding.blockNumber="206";},v=>{v.funding.blockNumber="205";},
    v=>{v.funding.nonce="0";},v=>{v.funding.fundingClosedLogIndex=0.5;},v=>{v.funding.extra=true;},v=>{v.observation.accounting.state=0;},
    v=>{v.funding.finalizedBlock.timestamp="99";},v=>{v.funding.runtimeCodeHash=`0x${'8'.repeat(64)}`;},v=>{v.funding.depositedValue=9;}]){
    const input=confirmation();mutate(input);await assert.rejects(confirmRewardFundingJob(input,()=>assert.fail("invalid proof must not call SQL")));
  }
  const badResult={...fixture(),state:"confirmed",confirmationObservationId:id(9),transactionHash:`0x${'9'.repeat(64)}`};
  await assert.rejects(confirmRewardFundingJob(confirmation(),async()=>({data:badResult,error:null})),{code:"invalid_reward_funding_job"});
});
