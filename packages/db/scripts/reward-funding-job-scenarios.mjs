import assert from "node:assert/strict";
import { getContractAddress } from "viem";
import { queueRewardFundingJob,readRewardFundingJob,stepRewardFundingJob,confirmRewardFundingJob,
  storeRewardDeploymentAttempt,queueRewardDeploymentJob,stepRewardDeploymentJob } from "../dist/rewards/index.js";
import { literal } from "./reward-integration-fixture.mjs";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";

// SQL structural/concurrency fixtures, NOT signed or mined funding evidence.
export async function fundingJobScenarios({harness,scenario,programmeLock,campaign,fundingContext,fundingAttempt,fundingBody,checkpointInput,sqlAttempt,roleBefore}) {
  const {query,scalar,rpc,rpcSql,waiting}=harness;
  const rejects=(code,promise)=>assert.rejects(promise,{code});
  const input={campaignId:campaign.id,actorUserId:id(4),intentId:fundingContext.intent.id,attemptId:fundingAttempt.attemptId,idempotencyKey:"funding-job-01"};
  let job; let lease;
  await scenario("funding jobs keep one exact attempt and serialize deployment/funding leases across programmes",async()=>{
    await query(`begin; alter role service_role bypassrls; set local role service_role;
      ${rpcSql("service_queue_reward_funding_job",{p_campaign_id:input.campaignId,p_actor_user_id:input.actorUserId,p_intent_id:input.intentId,p_attempt_id:input.attemptId,p_idempotency_key:input.idempotencyKey})}
      select public.service_step_reward_funding_job((select id from app_private.reward_funding_jobs where campaign_id=${literal(campaign.id)}),
        ${literal(id(4))},${literal(id(89001))},null,'lease'); rollback;`);
    assert.equal(await scalar("select count(*) from app_private.reward_funding_jobs"),0);
    assert.equal(await scalar("select count(*) from app_private.reward_funding_job_events"),0);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
    const unlock=await programmeLock(); const pending=Promise.all([queueRewardFundingJob(input,rpc),queueRewardFundingJob(input,rpc)]); pending.catch(()=>{});
    try{await waiting(2);}finally{await unlock();}
    const[first,retry]=await pending; assert.deepEqual(first,retry); job=first;
    await rejects("reward_funding_job_already_queued",queueRewardFundingJob({...input,idempotencyKey:"other-funding-job"},rpc));
    const other=await scalar(`select jsonb_build_object('id',i.id,'campaign',i.campaign_id,'nonce',i.nonce::text,'operator',i.operator_address)
      from app_private.reward_deployment_intents i join app_private.reward_campaigns c on c.id=i.campaign_id
      where c.programme_id=${literal(id(98701))}`);
    const otherAttempt=await storeRewardDeploymentAttempt({campaignId:other.campaign,actorUserId:id(4),intentId:other.id,idempotencyKey:"cross-job-attempt",
      attempt:{...sqlAttempt,nonce:other.nonce,contractAddress:getContractAddress({from:other.operator,nonce:BigInt(other.nonce)}).toLowerCase(),transactionHash:`0x${'2'.repeat(64)}`}},rpc);
    const otherJob=await queueRewardDeploymentJob({campaignId:other.campaign,actorUserId:id(4),intentId:other.id,attemptId:otherAttempt.attemptId,idempotencyKey:"cross-job-queue"},rpc);
    const fundingLease={jobId:job.jobId,actorUserId:id(4),workerId:id(89001),leaseToken:null,action:"lease"};
    const deploymentLease={jobId:otherJob.jobId,actorUserId:id(4),workerId:id(89002),leaseToken:null,action:"lease"};
    const release=await programmeLock();
    const fund=stepRewardFundingJob(fundingLease,rpc); fund.catch(()=>{}); await waiting(1);
    const deploy=stepRewardDeploymentJob(deploymentLease,rpc); deploy.catch(()=>{});
    try{await waiting(2);}finally{await release();}
    lease=await fund; assert(lease); assert.equal(await deploy,null);
    assert.deepEqual(await stepRewardFundingJob(fundingLease,rpc),lease,"Same-worker retry does not extend lease");
    await query(`update app_private.reward_funding_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(job.jobId)};`);
    assert(await stepRewardDeploymentJob(deploymentLease,rpc));
    assert.equal(await stepRewardFundingJob(fundingLease,rpc),null,"Deployment lease excludes funding in the other direction");
    await query(`update app_private.reward_deployment_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(otherJob.jobId)};`);
    const renewed=await stepRewardFundingJob({...fundingLease,workerId:id(89003)},rpc);
    assert.equal(renewed.leaseGeneration,2); assert.notEqual(renewed.leaseToken,lease.leaseToken);
    await rejects("reward_funding_job_lease_lost",stepRewardFundingJob({...fundingLease,leaseToken:lease.leaseToken,action:"arm"},rpc));
    lease=renewed;
    await rejects("invalid_reward_funding_job",query(rpcSql("service_step_reward_funding_job",{p_job_id:job.jobId,p_actor_user_id:id(4),p_worker_id:lease.leaseOwner,p_lease_token:lease.leaseToken,p_action:"confirm"})));
  });
  const observation=structuredClone(checkpointInput.observation);
  observation.finalizedBlock={number:"205",hash:`0x${'5'.repeat(64)}`,timestamp:"1800000205"};
  Object.assign(observation.accounting,{state:1,accountedFunding:campaign.budgetWei.toString(),budgets:[campaign.budgetWei.toString(),"0"],nativeBalance:(campaign.budgetWei+100n).toString()});
  const funding={schemaVersion:1,action:"complete_funding",chainId:31337,contractAddress:fundingBody.contractAddress,operatorAddress:fundingBody.operatorAddress,
    transactionHash:fundingBody.transactionHash,nonce:fundingBody.nonce,blockNumber:"204",blockHash:`0x${'6'.repeat(64)}`,fundingClosedLogIndex:1,
    depositedValue:fundingBody.value,expectedAccountedFunding:fundingBody.expectedAccountedFunding,budget:fundingBody.expectedBudget,enabledPot:0,
    runtimeCodeHash:checkpointInput.deployment.runtimeCodeHash,finalizedBlock:structuredClone(observation.finalizedBlock)};
  const confirmation={jobId:job.jobId,actorUserId:id(4),workerId:lease.leaseOwner,leaseToken:lease.leaseToken,funding,deployment:checkpointInput.deployment,observation};
  const confirmSql=body=>rpcSql("service_confirm_reward_funding_job",{p_job_id:body.jobId,p_actor_user_id:body.actorUserId,p_worker_id:body.workerId,p_lease_token:body.leaseToken,
    p_funding:body.funding,p_deployment:body.deployment,p_observation:body.observation});
  await scenario("exact funding receipt, accounting and completion are atomic, immutable and lease-fenced",async()=>{
    const count=await scalar("select count(*) from app_private.reward_campaign_observations");
    await rejects("reward_funding_job_lease_lost",confirmRewardFundingJob({...confirmation,leaseToken:id(89999)},rpc));
    for(const mutate of [f=>{f.transactionHash=`0x${'9'.repeat(64)}`;},f=>{f.nonce="99";},f=>{f.depositedValue="1";},f=>{f.runtimeCodeHash=`0x${'9'.repeat(64)}`;},
      f=>{f.blockNumber="206";},f=>{f.chainId=10143;},f=>{f.extra=true;},f=>{f.finalizedBlock.hash=`0x${'9'.repeat(64)}`;},f=>{f.expectedAccountedFunding="41";}]){
      const body=structuredClone(confirmation);mutate(body.funding);
      await rejects("invalid_reward_funding_confirmation",query(confirmSql(body)));
    }
    assert.equal(await scalar("select count(*) from app_private.reward_campaign_observations"),count);
    // A failure AFTER checkpoint insert must roll back the new observation too.
    await query(`create function app_private.test_reject_funding_receipt() returns trigger language plpgsql as $$ begin raise exception 'synthetic_receipt_failure'; end $$;
      create trigger test_reject_funding_receipt before insert on app_private.reward_funding_confirmations for each row execute function app_private.test_reject_funding_receipt();`);
    try{await rejects("synthetic_receipt_failure",query(confirmSql(confirmation)));}
    finally{await query("drop trigger test_reject_funding_receipt on app_private.reward_funding_confirmations; drop function app_private.test_reject_funding_receipt();");}
    assert.equal(await scalar("select count(*) from app_private.reward_campaign_observations"),count);
    assert.equal(await scalar("select count(*) from app_private.reward_funding_confirmations"),0);
    assert.equal((await readRewardFundingJob({jobId:job.jobId,actorUserId:id(4)},rpc)).state,"leased");
    const result=JSON.parse(await query(`begin; alter role service_role bypassrls; set local role service_role; ${confirmSql(confirmation)} rollback;`));
    assert.equal(result.state,"confirmed");
    assert.equal(await scalar("select count(*) from app_private.reward_funding_confirmations"),0);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
    const unlock=await programmeLock(); const pending=Promise.all([confirmRewardFundingJob(confirmation,rpc),confirmRewardFundingJob(confirmation,rpc)]); pending.catch(()=>{});
    try{await waiting(2);}finally{await unlock();}
    const [first,retry]=await pending;assert.deepEqual(first,retry);assert.equal(first.state,"confirmed");assert.equal(first.leaseToken,null);
    assert.equal(await scalar("select count(*) from app_private.reward_funding_confirmations"),1);
    assert.equal(await scalar("select count(*) from app_private.reward_campaign_observations"),count+1);
    const saved=await scalar(`select funding_body from app_private.reward_funding_confirmations where job_id=${literal(job.jobId)}`);assert.deepEqual(saved,funding);
    await rejects("reward_ledger_idempotency_conflict",confirmRewardFundingJob({...confirmation,funding:{...funding,blockHash:`0x${'9'.repeat(64)}`}},rpc));
    await rejects("reward_ledger_is_immutable",query("delete from app_private.reward_funding_confirmations;"));
    await rejects("reward_job_identity_is_immutable",query(`update app_private.reward_funding_jobs set state='queued',confirmation_observation_id=null where id=${literal(job.jobId)};`));
  });
  return {job,input,confirmation};
}
