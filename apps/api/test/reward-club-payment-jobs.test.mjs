import assert from "node:assert/strict";
import test from "node:test";
import { readRewardClubPaymentJob,stepRewardClubPaymentJob } from "../../../packages/db/dist/rewards/index.js";
import { runClubRewardPaymentJob } from "../dist/features/rewards/club-payment-worker.js";
import { rewardId as id } from "./fixtures/reward-calculation.mjs";

const identity={userId:id(4),sessionId:id(99201)};
const job={jobId:id(99401),campaignId:id(99402),uploadId:id(99403),entitlementId:id(99404),claimIntentId:id(99405),paymentIntentId:id(99406),
  attemptId:id(99407),transactionHash:`0x${"ab".repeat(32)}`,activationJobId:id(99408),createdByUserId:identity.userId,createdSessionId:identity.sessionId,
  createdAt:"2026-09-08T12:00:00Z",idempotencyKey:"payment-job-test",state:"queued",mayHaveBroadcast:false,leaseOwner:null,leaseToken:null,leaseExpiresAt:null,
  leaseGeneration:0,confirmationObservationId:null};
const gasPolicy={maxGasLimit:500000n,maxFeePerGas:30000000000n,maxTotalFeeWei:15000000000000000n,minimumRemainingBalanceWei:1000000n};
const result=data=>async()=>({data:structuredClone(data),error:null});
test("club payment job reads freeze actual actor and exact selector before awaiting IO",async()=>{
  const actor={...identity};const input={jobId:job.jobId};let args;
  const pending=readRewardClubPaymentJob(actor,input,async(name,p)=>{assert.equal(name,"service_read_reward_club_payment_job");args=p;await Promise.resolve();return{data:job,error:null};});
  actor.userId=id(99);actor.sessionId=id(98);input.jobId=id(97);
  assert.deepEqual(await pending,job);assert.deepEqual(args,{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_job_id:job.jobId,p_payment_intent_id:null});
});
test("club payment job lookup permits missing queue only by a validated payment intent",async()=>{
  assert.equal(await readRewardClubPaymentJob(identity,{paymentIntentId:job.paymentIntentId},result(null)),null);
  await assert.rejects(readRewardClubPaymentJob(identity,{jobId:job.jobId},result(null)));
  let calls=0;const rpc=async()=>{calls++;throw new Error("unexpected");};
  for(const input of [{},{jobId:"bad"},{jobId:job.jobId,paymentIntentId:job.paymentIntentId}])await assert.rejects(readRewardClubPaymentJob(identity,input,rpc));
  assert.equal(calls,0);
});
test("club payment job decoder rejects cross-scope, extra private fields and incoherent lease/completion state",async()=>{
  for(const change of [{jobId:id(99)},{createdByUserId:id(99)},{secret:"signed bytes"},{transactionHash:"0x"},{leaseOwner:id(99)},
    {leaseGeneration:-1},{state:"confirmed"},{state:"submitted"},{mayHaveBroadcast:true},{createdAt:"bad"},{confirmationObservationId:id(99)}]){
    await assert.rejects(readRewardClubPaymentJob(identity,{jobId:job.jobId},result({...job,...change})));
  }
});
test("club payment job transport returns bounded operational codes without private provider diagnostics",async()=>{
  for(const code of ["reward_account_session_required","reward_payment_job_lease_lost","reward_payment_gas_guard","reward_review_source_changed"]){
    await assert.rejects(readRewardClubPaymentJob(identity,{jobId:job.jobId},async()=>({data:null,error:{message:code}})),{code});
  }
  await assert.rejects(readRewardClubPaymentJob(identity,{jobId:job.jobId},async()=>({data:null,error:{message:"private bytes"}})),{code:"reward_ledger_store_failed"});
  await assert.rejects(readRewardClubPaymentJob(identity,{jobId:job.jobId},async()=>{throw new Error("private credential");}),{code:"reward_ledger_unavailable"});
});
test("club payment job steps accept lease contention but reject a different worker/token and invalid actions",async()=>{
  const input={jobId:job.jobId,workerId:id(99410),leaseToken:null,action:"lease"};
  assert.equal(await stepRewardClubPaymentJob(identity,input,result(null)),null);
  const leased={...job,state:"leased",leaseOwner:input.workerId,leaseToken:id(99411),leaseExpiresAt:"2026-09-08T12:01:00Z",leaseGeneration:1};
  assert.deepEqual(await stepRewardClubPaymentJob(identity,input,result(leased)),leased);
  await assert.rejects(stepRewardClubPaymentJob(identity,input,result({...leased,leaseOwner:id(99)})));
  await assert.rejects(stepRewardClubPaymentJob(identity,{...input,leaseToken:leased.leaseToken,action:"submitted"},result({...leased,state:"submitted",mayHaveBroadcast:true,leaseToken:id(99)})));
  let calls=0;const rpc=async()=>{calls++;throw new Error("unexpected");};
  for(const change of [{action:"cancel"},{leaseToken:leased.leaseToken},{execution:{}},{action:"arm",execution:{},observedAt:"2026-09-08T12:00:00Z"}]){
    await assert.rejects(stepRewardClubPaymentJob(identity,{...input,...change},rpc));
  }assert.equal(calls,0);
});
test("club payment worker requires explicit finite gas policy before any database or chain IO",async()=>{
  let calls=0;const rpc=async()=>{calls++;throw new Error("unexpected");};
  for(const change of [{maxGasLimit:0n},{maxGasLimit:1n<<64n},{maxFeePerGas:-1n},{maxTotalFeeWei:0n},{minimumRemainingBalanceWei:1n<<256n},{maxGasLimit:500000}]){
    await assert.rejects(runClubRewardPaymentJob(identity,{jobId:job.jobId,workerId:id(99410)},{rpc,gasPolicy:{...gasPolicy,...change}}),{code:"invalid_reward_payment_gas_policy"});
  }assert.equal(calls,0);
});
test("confirmed club payment history needs no signer, RPC connection, send or newly issued nonce",async()=>{
  let reads=0;const confirmed={...job,state:"confirmed",mayHaveBroadcast:true,leaseGeneration:1,confirmationObservationId:id(99412)};
  const response=await runClubRewardPaymentJob(identity,{jobId:job.jobId,workerId:id(99410)},{gasPolicy,rpc:async(name)=>{
    assert.equal(name,"service_read_reward_club_payment_job");reads++;return{data:confirmed,error:null};
  }});
  assert.deepEqual(response,{jobId:job.jobId,outcome:"confirmed"});assert.equal(reads,1);
});
test("club worker defers unavailable historical attempt verification without arming or sending",async()=>{
  const workerId=id(99410),calls=[];
  const leased={...job,state:"leased",leaseOwner:workerId,leaseToken:id(99411),leaseExpiresAt:new Date(Date.now()+60000).toISOString(),leaseGeneration:1};
  const response=await runClubRewardPaymentJob(identity,{jobId:job.jobId,workerId},{gasPolicy,rpc:async(name)=>{
    calls.push(name);
    if(name==="service_read_reward_club_payment_job")return{data:job,error:null};
    if(name==="service_step_reward_club_payment_job")return{data:leased,error:null};
    throw new Error("Synthetic unavailable private history");
  },broadcast:async()=>{assert.fail("unverified attempt must not be sent");}});
  assert.deepEqual(response,{jobId:job.jobId,outcome:"unavailable"});
  assert.deepEqual(calls,["service_read_reward_club_payment_job","service_step_reward_club_payment_job","service_read_reward_club_payment_attempt"]);
});
