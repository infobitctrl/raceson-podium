import assert from "node:assert/strict";
import { TransactionNotFoundError } from "viem";
import { queueVerifiedAthleteRewardPayment,runAthleteRewardPaymentJob } from "../../../apps/api/dist/features/rewards/athlete-payment-worker.js";
import { runStoredRewardOperatorJob } from "../../../apps/api/dist/features/rewards/operator-runner.js";
import { readRewardAthletePaymentJob,stepRewardAthletePaymentJob } from "../dist/rewards/index.js";
import { recordSignedAthleteRewardPayment } from "../../../apps/api/dist/features/rewards/athlete-payment-service.js";
import { encodeRewardAthletePayment } from "../../rewards-chain/dist/index.js";
import { calculationFixture, rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";
import { createRewardOperatorProcess } from "./reward-operator-process.mjs";
import { getAthleteRewardPaymentStatus } from "../../../apps/api/dist/features/rewards/athlete-payment-status-service.js";
import { paymentStatusSystemScenarios } from "./reward-payment-status-system-scenarios.mjs";

// Only the parent-owned synthetic SQL/chain rehearsal supplies these clients.
export async function paymentJobSystemScenarios({harness,scenario,chain,identity,recipient,deps,storedPayment,finalize,programmeId}){
  const {query,scalar,rpc}=harness;const {publicClient,relayerClient,testClient}=chain;
  const scope={claimIntentId:storedPayment.payment.claimIntentId,paymentIntentId:storedPayment.payment.paymentIntentId,
    attemptId:storedPayment.attempt.attemptId,idempotencyKey:"payment-main-job"};
  const gasPolicy={maxGasLimit:500000n,maxFeePerGas:30000000000n,maxTotalFeeWei:15000000000000000n,minimumRemainingBalanceWei:1000000n};
  let sends=0;const broadcast=async signed=>{assert.equal(signed,storedPayment.signed);sends++;return relayerClient.sendRawTransaction({serializedTransaction:signed});};
  const config={...deps,gasPolicy,broadcast};const workerId=id(99401);let job;const additionalJobs=[];
  const read=()=>readRewardAthletePaymentJob(identity,{jobId:job.jobId},rpc);
  const status=()=>getAthleteRewardPaymentStatus(recipient,scope.claimIntentId,deps);
  const session=calculationFixture().session;
  assert.equal(session.account.userId,identity.userId);
  const run=(overrides={},worker=workerId)=>runStoredRewardOperatorJob(session,identity,
    {kind:"athlete_payment",jobId:job.jobId,campaignId:job.campaignId,intentId:job.paymentIntentId,attemptId:job.attemptId,
      transactionHash:job.transactionHash,signerAddress:chain.relayer.address.toLowerCase(),nonce:storedPayment.payment.plan.nonce,state:job.state},
    {programmeId,workerId:worker,maxJobs:1,deadlineMs:Date.now()+60000},
    {...config,...overrides});
  await scenario("payment queue retries bind the exact signed attempt and confirmed activation without issuing a new nonce",async()=>{
    assert.equal((await status()).status,"no_confirmation");assert.equal((await status()).receipt,null);
    await assert.rejects(queueVerifiedAthleteRewardPayment(recipient,scope,deps),{code:"reward_claim_proof_scope_required"});
    const jobs=await Promise.all([queueVerifiedAthleteRewardPayment(identity,scope,deps),queueVerifiedAthleteRewardPayment(identity,scope,deps)]);
    assert.deepEqual(jobs[0],jobs[1]);job=jobs[0];assert.equal(job.state,"queued");
    assert.equal((await status()).status,"queued");assert.equal((await status()).receipt,null);
    assert.deepEqual(await queueVerifiedAthleteRewardPayment(identity,scope,{...deps,reader:{}}),job);
    await assert.rejects(queueVerifiedAthleteRewardPayment(identity,{...scope,idempotencyKey:"different-job-key"},deps),{code:"reward_payment_job_already_queued"});
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_jobs"),1);
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_job_events"),1);
    assert.equal(await scalar("select count(*) from app_private.reward_relayer_nonce_slots where athlete_payment_intent_id is not null"),3);
    await assert.rejects(query(`update app_private.reward_athlete_payment_jobs set idempotency_key='altered-key' where id=${literal(job.jobId)}`),{code:"reward_job_identity_is_immutable"});
  });
  await scenario("separate race campaigns share a relayer lease and retain their reserved nonce gaps",async()=>{
    for(const payment of storedPayment.additionalPayments){
      const signed=await chain.relayer.signTransaction({...encodeRewardAthletePayment(payment.plan),...storedPayment.fees});
      const attempt=await recordSignedAthleteRewardPayment(identity,{claimIntentId:payment.claimIntentId,paymentIntentId:payment.paymentIntentId,
        idempotencyKey:`payment-other-attempt-${payment.plan.nonce}`,signedTransaction:signed},deps);
      const queued=await queueVerifiedAthleteRewardPayment(identity,{claimIntentId:payment.claimIntentId,paymentIntentId:payment.paymentIntentId,
        attemptId:attempt.attemptId,idempotencyKey:`payment-other-job-${payment.plan.nonce}`},deps);
      additionalJobs.push({payment,attempt,signed,job:queued});
    }
    const future=additionalJobs.find(p=>p.payment.plan.nonce===2n);assert(future);
    assert.equal((await runAthleteRewardPaymentJob(identity,{jobId:future.job.jobId,workerId:id(99403)},config)).outcome,"awaiting_nonce");
    assert.equal((await run()).outcome,"busy");assert.equal(sends,0);
    await query(`update app_private.reward_athlete_payment_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(future.job.jobId)}`);
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_jobs"),3);
    assert.equal(await scalar("select count(*) from app_private.reward_relayer_nonce_slots where athlete_payment_intent_id is not null"),3);
  });
  await scenario("payment leases fence competing workers and expired tokens; wrong chain, unavailable estimates and gas caps cannot send",async()=>{
    const nullSql=harness.rpcSql("service_step_reward_athlete_payment_job",{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,
      p_job_id:job.jobId,p_worker_id:workerId,p_lease_token:null,p_action:"lease",p_execution:null,p_observed_at:null});
    assert.ok(nullSql.includes("p_execution => null::jsonb"),"Optional JSON arguments must preserve SQL NULL, not a JSON null value");
    const lease=await stepRewardAthletePaymentJob(identity,{jobId:job.jobId,workerId,leaseToken:null,action:"lease"},rpc);
    assert.equal((await status()).status,"processing");assert.equal((await status()).receipt,null);
    assert.deepEqual(await stepRewardAthletePaymentJob(identity,{jobId:job.jobId,workerId,leaseToken:null,action:"lease"},rpc),lease);
    assert.equal((await run({},id(99402))).outcome,"busy");
    for(const other of additionalJobs)assert.equal((await runAthleteRewardPaymentJob(identity,{jobId:other.job.jobId,workerId:id(99403)},config)).outcome,"busy");
    await query(`update app_private.reward_athlete_payment_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(job.jobId)}`);
    await assert.rejects(stepRewardAthletePaymentJob(identity,{jobId:job.jobId,workerId,leaseToken:lease.leaseToken,action:"submitted"},rpc),{code:"reward_payment_job_lease_lost"});
    assert.equal((await run({reader:{...publicClient,getChainId:async()=>143}})).outcome,"unavailable");
    assert.equal((await run({gasPolicy:{...gasPolicy,maxGasLimit:1n}})).outcome,"gas_guard");
    assert.equal((await run({reader:{...publicClient,estimateGas:async()=>{throw new Error("synthetic private RPC error");}}})).outcome,"unavailable");
    assert.equal((await read()).mayHaveBroadcast,false);assert.equal(sends,0);
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_job_events where kind='armed'"),0);
    const delayedRpc=async(name,args)=>{const response=await rpc(name,args);
      if(name==="service_reward_operator_session_call"&&args.p_method==="service_step_reward_athlete_payment_job"&&args.p_arguments.p_action==="arm"&&!response.error){
        await query(`update app_private.reward_athlete_payment_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(job.jobId)}`);
        response.data.result.leaseExpiresAt="2020-01-01T00:00:00Z";
      }return response;};
    assert.equal((await run({rpc:delayedRpc})).outcome,"busy","An arm response arriving after expiry cannot start a send");assert.equal(sends,0);
  });
  await scenario("an actual operator process killed after payment submission recovers the exact pending attempt without another nonce or send",async()=>{
    const childRun=createRewardOperatorProcess({...config,identity,programmeId});
    const expire=()=>query(`update app_private.reward_athlete_payment_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(job.jobId)}`);
    await expire();
    await testClient.setAutomine(false);
    try{
      const killed=await childRun({crashAt:"after_broadcast",jobId:job.jobId});
      assert.equal(killed.signal,"SIGKILL");
      assert.equal(sends,1);assert.equal((await read()).mayHaveBroadcast,true);
      assert.equal((await status()).status,"submission_unconfirmed");assert.equal((await status()).receipt,null);
      const busy=await childRun();assert.notEqual(busy.pid,killed.pid);
      assert.deepEqual(busy.result.entries,[{kind:"athlete_payment",jobId:job.jobId,outcome:"busy"}]);
      await expire();
      const recovered=await childRun();assert.notEqual(recovered.pid,killed.pid);assert.notEqual(recovered.pid,busy.pid);
      assert.deepEqual(recovered.result.entries,[{kind:"athlete_payment",jobId:job.jobId,outcome:"pending"}]);assert.equal(sends,1);
      await expire(); // test-only clock injection before the existing low-level RPC-visibility probe
      const reader={...publicClient,getTransaction:async args=>{
        if(args.hash===job.transactionHash)throw new TransactionNotFoundError({hash:args.hash});return publicClient.getTransaction(args);
      }};
      assert.equal((await run({reader})).outcome,"nonce_conflict");assert.equal(sends,1);
      assert.equal(await scalar("select count(*) from app_private.reward_relayer_nonce_slots where athlete_payment_intent_id is not null"),3);
    }finally{await testClient.setAutomine(true);}
    await testClient.mine({blocks:1});
    assert.equal((await publicClient.waitForTransactionReceipt({hash:job.transactionHash,timeout:10000})).status,"success");await finalize();
  });
  await scenario("payment receipt, paid projection and checkpoint roll back together and recover a lost committed response",async()=>{
    const before=await scalar("select count(*) from app_private.reward_campaign_observations");
    await query(`create function app_private.reward_payment_confirmation_test_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic confirmation failure';end$$;
      create trigger reward_payment_confirmation_test_fail before insert on app_private.reward_athlete_payment_confirmations for each row execute function app_private.reward_payment_confirmation_test_fail();`);
    try{
      assert.equal((await run()).outcome,"unavailable");
      assert.equal(await scalar("select count(*) from app_private.reward_campaign_observations"),before);
      assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_confirmations"),0);
      assert.notEqual((await read()).state,"confirmed");
      assert.equal((await status()).status,"submission_unconfirmed");assert.equal((await status()).receipt,null,"mined payment without committed verification stays unconfirmed");
    }finally{
      await query("drop trigger reward_payment_confirmation_test_fail on app_private.reward_athlete_payment_confirmations;drop function app_private.reward_payment_confirmation_test_fail();");
    }
    let lost=true;let confirmationError=null;
    const uncertainRpc=async(name,args)=>{const result=await rpc(name,args);if(name==="service_reward_operator_session_call"&&args.p_method==="service_confirm_reward_athlete_payment_job"){
      confirmationError=result.error?.message??null;if(!result.error&&lost){lost=false;throw new Error("synthetic lost commit acknowledgement");}}return result;};
    assert.equal((await run({rpc:uncertainRpc})).outcome,"unavailable");assert.equal(confirmationError,null,"SQL confirmation must commit before losing its response");
    assert.equal(lost,false);assert.equal((await read()).state,"confirmed");
    assert.equal((await status()).status,"confirmed");assert.equal((await status()).receipt.transactionHash,job.transactionHash);
    assert.equal((await run({reader:{}})).outcome,"confirmed");assert.equal(sends,1);
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_confirmations"),1);
    assert.equal(await scalar("select count(*) from app_private.reward_campaign_observations"),before+1);
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_job_events where kind='confirmed'"),1);
    await assert.rejects(query("update app_private.reward_athlete_payment_confirmations set confirmed_at=clock_timestamp()"),{code:"reward_ledger_is_immutable"});
    await assert.rejects(query("delete from app_private.reward_athlete_payment_confirmations"),{code:"reward_ledger_is_immutable"});
  });
  await paymentStatusSystemScenarios({harness,scenario,chain,recipient,identity,deps,job});
  return{job,additionalJobs,gasPolicy};
}
