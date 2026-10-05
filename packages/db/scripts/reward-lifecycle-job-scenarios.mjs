import assert from "node:assert/strict";
import { queueRewardLifecycleJob,readRewardLifecycleJob,stepRewardLifecycleJob,confirmRewardLifecycleJob,storeRewardLifecycleAttempt,readRewardLifecycleContext,
  storeRewardCampaignCheckpoint,readRewardCampaignCheckpoint,reserveRewardFundingIntent,storeRewardFundingAttempt,queueRewardFundingJob,stepRewardFundingJob,stepRewardDeploymentJob } from "../dist/rewards/index.js";
import { literal } from "./reward-integration-fixture.mjs";
import { rewardId as id,rewardWire } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
const h=char=>`0x${char.repeat(64)}`;

// Actual SQL and competing backends. Witnesses are intentionally structural
// fixtures, not cryptographic proof; the continuous worker/chain suite is real.
export async function lifecycleJobScenarios({harness,scenario,programmeLock,campaign,preparedUpload,lifecycle,checkpointInput,roleBefore}){
  const {query,scalar,rpc,rpcSql,waiting}=harness;const reject=(code,promise)=>assert.rejects(promise,{code});
  const scope={campaignId:campaign.id,actorUserId:id(4),uploadId:preparedUpload.uploadId};const u=preparedUpload.upload;
  const first=await readRewardLifecycleContext({...scope,intentId:lifecycle.intentId},rpc);
  const stage=await readRewardLifecycleContext({...scope,idempotencyKey:"lifecycle-stage-01"},rpc);
  const activate=await readRewardLifecycleContext({...scope,idempotencyKey:"lifecycle-activate-01"},rpc);
  const input={...scope,intentId:first.intent.id,attemptId:lifecycle.savedAttempt.attemptId,idempotencyKey:"lifecycle-job-upload"};
  const queueSql=body=>rpcSql("service_queue_reward_lifecycle_job",{p_campaign_id:body.campaignId,p_actor_user_id:body.actorUserId,p_upload_id:body.uploadId,
    p_intent_id:body.intentId,p_attempt_id:body.attemptId,p_idempotency_key:body.idempotencyKey});
  const makeAttempt=async(context,hex)=>storeRewardLifecycleAttempt({...scope,intentId:context.intent.id,idempotencyKey:`job-attempt-${context.intent.action}`,
    attempt:{...lifecycle.attemptInput.attempt,action:context.intent.action,nonce:context.intent.nonce,batchStart:context.intent.batchStart,batchSize:context.intent.batchSize,transactionHash:h(hex)}},rpc);
  const stageAttempt=await makeAttempt(stage,"b");const activateAttempt=await makeAttempt(activate,"c");
  const stageInput={...scope,intentId:stage.intent.id,attemptId:stageAttempt.attemptId,idempotencyKey:"lifecycle-job-stage"};
  const activateInput={...scope,intentId:activate.intent.id,attemptId:activateAttempt.attemptId,idempotencyKey:"lifecycle-job-activate"};
  let job;let lease;let confirmation;let activationJob;let activationLease;let activationConfirmation;
  await scenario("lifecycle queue refuses manual-prefix adoption and binds one exact confirmed predecessor",async()=>{
    await reject("reward_lifecycle_predecessor_not_confirmed",queueRewardLifecycleJob(stageInput,rpc));
    await reject("reward_lifecycle_predecessor_not_confirmed",queueRewardLifecycleJob(activateInput,rpc));
    assert.equal(await scalar("select count(*) from app_private.reward_lifecycle_jobs"),0);
    await query(`begin; alter role service_role bypassrls; set local role service_role; ${queueSql(input)} rollback;`);
    assert.equal(await scalar("select count(*) from app_private.reward_lifecycle_jobs"),0);
    const unlock=await programmeLock();const pending=Promise.all([queueRewardLifecycleJob(input,rpc),queueRewardLifecycleJob(input,rpc)]);pending.catch(()=>{});
    try{await waiting(2);}finally{await unlock();}const[first,retry]=await pending;assert.deepEqual(first,retry);job=first;
    assert.equal(job.predecessorLifecycleJobId,null);assert(job.predecessorFundingJobId);
    assert.equal(await scalar(`select state from app_private.reward_funding_jobs where id=${literal(job.predecessorFundingJobId)}`),"confirmed");
    await reject("reward_lifecycle_job_already_queued",queueRewardLifecycleJob({...input,idempotencyKey:"changed-job-key"},rpc));
    await reject("reward_job_identity_is_immutable",query(`update app_private.reward_lifecycle_jobs set predecessor_funding_job_id=null,predecessor_lifecycle_job_id=${literal(job.jobId)} where id=${literal(job.jobId)};`));
  });
  await scenario("lifecycle, funding and deployment workers exclude each other across actual programmes",async()=>{
    const other=await scalar(`select jsonb_build_object('jobId',j.id,'campaignId',j.campaign_id,'intentId',j.intent_id,'attemptId',j.attempt_id,
      'nonce',i.nonce::text,'attempt',a.attempt_body,'budget',c.budget_wei::text) from app_private.reward_deployment_jobs j
      join app_private.reward_deployment_intents i on i.id=j.intent_id join app_private.reward_deployment_attempts a on a.id=j.attempt_id
      join app_private.reward_campaigns c on c.id=j.campaign_id where c.programme_id=${literal(id(98701))}`);
    const observation=structuredClone(checkpointInput.observation);Object.assign(observation.accounting,{accountedFunding:"0",nativeBalance:"0"});
    observation.finalizedBlock={number:"300",hash:h("c"),timestamp:"1800000300"};
    const otherCheckpoint=await storeRewardCampaignCheckpoint({...checkpointInput,campaignId:other.campaignId,intentId:other.intentId,attemptId:other.attemptId,
      idempotencyKey:"lifecycle-other-checkpoint",observation,deployment:{...checkpointInput.deployment,contractAddress:other.attempt.contractAddress,
        deploymentNonce:other.nonce,deploymentTransactionHash:other.attempt.transactionHash}},rpc);
    const f=await reserveRewardFundingIntent({campaignId:other.campaignId,actorUserId:id(4),idempotencyKey:"lifecycle-other-funding",observationId:otherCheckpoint.observationId,
      observedChainId:31337,pendingNonce:0n},rpc);
    const fa=await storeRewardFundingAttempt({campaignId:other.campaignId,actorUserId:id(4),intentId:f.intent.id,idempotencyKey:"lifecycle-other-fund-attempt",
      attempt:{schemaVersion:1,action:"complete_funding",chainId:31337,operatorAddress:f.deploymentContext.operatorAddress,nonce:f.intent.nonce,
        contractAddress:other.attempt.contractAddress,transactionHash:h("d"),signedTransaction:"0x02aa",buildId:f.checkpoint.deployment.buildId,calldataHash:h("e"),
        expectedAccountedFunding:0n,expectedBudget:BigInt(other.budget),value:BigInt(other.budget),gasLimit:1000000n,maxFeePerGas:100n,maxPriorityFeePerGas:1n}},rpc);
    const fj=await queueRewardFundingJob({campaignId:other.campaignId,actorUserId:id(4),intentId:f.intent.id,attemptId:fa.attemptId,idempotencyKey:"lifecycle-other-fund-job"},rpc);
    const li={jobId:job.jobId,actorUserId:id(4),workerId:id(90001),leaseToken:null,action:"lease"};
    const fi={jobId:fj.jobId,actorUserId:id(4),workerId:id(90002),leaseToken:null,action:"lease"};
    const di={jobId:other.jobId,actorUserId:id(4),workerId:id(90003),leaseToken:null,action:"lease"};
    const release=await programmeLock();const live=stepRewardLifecycleJob(li,rpc);live.catch(()=>{});await waiting(1);
    const fund=stepRewardFundingJob(fi,rpc);fund.catch(()=>{});const deploy=stepRewardDeploymentJob(di,rpc);deploy.catch(()=>{});
    try{await waiting(3);}finally{await release();}
    lease=await live;assert(lease);assert.equal(await fund,null);assert.equal(await deploy,null);
    assert.deepEqual(await stepRewardLifecycleJob(li,rpc),lease,"Same-worker retry retains expiry and token");
    await query(`update app_private.reward_lifecycle_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(job.jobId)};`);
    assert(await stepRewardFundingJob(fi,rpc));assert.equal(await stepRewardLifecycleJob(li,rpc),null);
    await query(`update app_private.reward_funding_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(fj.jobId)};`);
    assert(await stepRewardDeploymentJob(di,rpc));assert.equal(await stepRewardLifecycleJob(li,rpc),null);
    await query(`update app_private.reward_deployment_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(other.jobId)};`);
    const renewed=await stepRewardLifecycleJob({...li,workerId:id(90004)},rpc);assert.equal(renewed.leaseGeneration,2);assert.notEqual(renewed.leaseToken,lease.leaseToken);
    await reject("reward_lifecycle_job_lease_lost",stepRewardLifecycleJob({...li,leaseToken:lease.leaseToken,action:"arm"},rpc));lease=renewed;
  });
  const makeConfirmation=async(context,job,lease,action,hex,block,at)=>{
    const current=await readRewardCampaignCheckpoint({campaignId:campaign.id,actorUserId:id(4)},rpc);const observation=rewardWire(current.observation);
    if(action==="activate"){
      observation.finalizedBlock={number:block.toString(),hash:h("f"),timestamp:at.toString()};
      Object.assign(observation.accounting,{state:3,claimDeadline:String(at+31536000n)});
    }
    return{jobId:job.jobId,actorUserId:id(4),workerId:lease.leaseOwner,leaseToken:lease.leaseToken,deployment:checkpointInput.deployment,observation,
      lifecycle:{schemaVersion:1,action,chainId:31337,contractAddress:current.deployment.contractAddress,operatorAddress:context.deploymentContext.operatorAddress,
        transactionHash:h(hex),nonce:context.intent.nonce.toString(),blockNumber:block.toString(),blockHash:action==="activate"?h("f"):`0x${block.toString(16).padStart(64,"0")}`,
        blockTimestamp:at.toString(),firstLogIndex:0,lastLogIndex:context.intent.batchSize===null?0:context.intent.batchSize-1,
        batchStart:context.intent.batchStart,batchSize:context.intent.batchSize,allocationDigest:u.allocationDigest,
        activationNotBefore:action==="stage_allocation"?String(at+86400n):null,claimDeadline:action==="activate"?String(at+31536000n):null,
        runtimeCodeHash:current.deployment.runtimeCodeHash,finalizedBlock:structuredClone(observation.finalizedBlock)}};
  };
  const confirmSql=v=>rpcSql("service_confirm_reward_lifecycle_job",{p_job_id:v.jobId,p_actor_user_id:v.actorUserId,p_worker_id:v.workerId,p_lease_token:v.leaseToken,
    p_lifecycle:v.lifecycle,p_deployment:v.deployment,p_observation:v.observation});
  await scenario("exact lifecycle receipt, accounting and job completion are atomic and unlock only their next action",async()=>{
    confirmation=await makeConfirmation(first,job,lease,"upload_awards","a",206n,1800000206n);
    const count=await scalar("select count(*) from app_private.reward_campaign_observations");
    await reject("reward_lifecycle_job_lease_lost",confirmRewardLifecycleJob({...confirmation,leaseToken:id(99999)},rpc));
    for(const mutate of [v=>{v.lifecycle.nonce="999";},v=>{v.lifecycle.transactionHash=h("9");},v=>{v.lifecycle.allocationDigest=h("9");},v=>{v.lifecycle.batchSize=5;},
      v=>{v.lifecycle.blockTimestamp="1800086608";},v=>{v.lifecycle.lastLogIndex=4;},v=>{v.lifecycle.extra=true;},v=>{v.lifecycle.runtimeCodeHash=h("9");}]){
      const v=structuredClone(confirmation);mutate(v);await reject("invalid_reward_lifecycle_confirmation",query(confirmSql(v)));
    }
    await query(`create function app_private.test_fail_lifecycle_receipt() returns trigger language plpgsql as $$ begin raise exception 'synthetic_lifecycle_receipt_failure'; end $$;
      create trigger test_fail_lifecycle_receipt before insert on app_private.reward_lifecycle_confirmations for each row execute function app_private.test_fail_lifecycle_receipt();`);
    try{await reject("synthetic_lifecycle_receipt_failure",query(confirmSql(confirmation)));}
    finally{await query("drop trigger test_fail_lifecycle_receipt on app_private.reward_lifecycle_confirmations; drop function app_private.test_fail_lifecycle_receipt();");}
    assert.equal(await scalar("select count(*) from app_private.reward_campaign_observations"),count);assert.equal(await scalar("select count(*) from app_private.reward_lifecycle_confirmations"),0);
    assert.equal((await readRewardLifecycleJob({jobId:job.jobId,actorUserId:id(4)},rpc)).state,"leased");
    await query(`begin; alter role service_role bypassrls; set local role service_role; ${confirmSql(confirmation)} rollback;`);
    assert.equal(await scalar("select count(*) from app_private.reward_campaign_observations"),count);
    const unlock=await programmeLock();const pending=Promise.all([confirmRewardLifecycleJob(confirmation,rpc),confirmRewardLifecycleJob(confirmation,rpc)]);pending.catch(()=>{});
    try{await waiting(2);}finally{await unlock();}const[a,b]=await pending;assert.deepEqual(a,b);assert.equal(a.state,"confirmed");assert.equal(a.leaseToken,null);
    await reject("reward_ledger_idempotency_conflict",confirmRewardLifecycleJob({...confirmation,lifecycle:{...confirmation.lifecycle,blockHash:h("9")}},rpc));
    const sj=await queueRewardLifecycleJob(stageInput,rpc);assert.equal(sj.predecessorLifecycleJobId,job.jobId);assert.equal(sj.predecessorFundingJobId,null);
    const sl=await stepRewardLifecycleJob({jobId:sj.jobId,actorUserId:id(4),workerId:id(90005),leaseToken:null,action:"lease"},rpc);
    const sp=await makeConfirmation(stage,sj,sl,"stage_allocation","b",207n,1800000207n);
    await reject("invalid_reward_lifecycle_confirmation",query(confirmSql({...sp,lifecycle:{...sp.lifecycle,activationNotBefore:"1800086606"}})));
    await confirmRewardLifecycleJob(sp,rpc);
    activationJob=await queueRewardLifecycleJob(activateInput,rpc);assert.equal(activationJob.predecessorLifecycleJobId,sj.jobId);
    activationLease=await stepRewardLifecycleJob({jobId:activationJob.jobId,actorUserId:id(4),workerId:id(90006),leaseToken:null,action:"lease"},rpc);
    activationConfirmation=await makeConfirmation(activate,activationJob,activationLease,"activate","c",209n,1800086608n);
    await reject("invalid_reward_lifecycle_confirmation",query(confirmSql({...activationConfirmation,lifecycle:{...activationConfirmation.lifecycle,claimDeadline:"1"}})));
    await reject("reward_ledger_is_immutable",query("delete from app_private.reward_lifecycle_confirmations;"));
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
  });
  return{input,job,confirmation,activationJob,activationLease,activationConfirmation,activateInput};
}
