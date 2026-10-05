import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openRewardTestDatabase } from "./reward-test-database.mjs";
import { integrationFixtureSql, literal } from "./reward-integration-fixture.mjs";
import { claimSystemScenarios } from "./reward-claim-system-scenarios.mjs";
import { clubClaimSystemScenarios } from "./reward-club-claim-system-scenarios.mjs";
import { createRewardOperatorProcess } from "./reward-operator-process.mjs";
import { calculationFixture, rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { startOwnedRewardChain } from "../../rewards-chain/integration/owned-chain.mjs";
import { createRewardProgramme, decodeRewardConfiguration, captureRewardSourceSnapshot, checkRewardUploadEvidence,
  readRewardDeploymentJob, readRewardCampaignCheckpoint, stepRewardDeploymentJob, readRewardFundingJob, stepRewardFundingJob } from "../dist/rewards/index.js";
import { prepareRewardDeployment, recordSignedRewardDeployment } from "../../../apps/api/dist/features/rewards/deployment-service.js";
import { queueVerifiedRewardDeployment, runRewardDeploymentJob } from "../../../apps/api/dist/features/rewards/deployment-worker.js";
import { runStoredRewardOperatorJob, drainRewardOperatorQueue } from "../../../apps/api/dist/features/rewards/operator-runner.js";
import { submitRewardSportingReview, reserveReviewedRewardAllocation } from "../../../apps/api/dist/features/rewards/calculation-service.js";
import { prepareReservedRewardUpload } from "../../../apps/api/dist/features/rewards/upload-service.js";
import { observeVerifiedRewardCampaign } from "../../../apps/api/dist/features/rewards/campaign-checkpoint-service.js";
import { prepareRewardFunding, recordSignedRewardFunding, loadVerifiedRewardFundingAttempt } from "../../../apps/api/dist/features/rewards/funding-service.js";
import { queueVerifiedRewardFunding } from "../../../apps/api/dist/features/rewards/funding-worker.js";
import { prepareRewardLifecycle,recordSignedRewardLifecycle,loadVerifiedRewardLifecycleAttempt } from "../../../apps/api/dist/features/rewards/lifecycle-service.js";
import { queueVerifiedRewardLifecycle } from "../../../apps/api/dist/features/rewards/lifecycle-worker.js";
import { readRewardLifecycleJob,stepRewardLifecycleJob } from "../dist/rewards/index.js";
import { encodeRewardDeployment, encodeRewardFunding, readVerifiedRewardFunding,readVerifiedRewardCampaign,
  encodeRewardLifecycle,readVerifiedRewardLifecycle,requireRewardLifecyclePrestate } from "../../rewards-chain/dist/index.js";

// Opt-in, parent-owned PostgreSQL plus a fresh unforked loopback Monad simulator.
// No mock repository/RPC data, environment-supplied keys or remote endpoints.
const databaseHarness = openRewardTestDatabase(process.argv.slice(2), { chainRehearsal: true });
const { query, scalar, rpc, database } = databaseHarness;
let chain;
let passed = 0;
const scenario = async (name, work) => { await work(); passed++; console.log(`reward system scenario ${passed}: ${name}`); };
try {
  assert.equal(await scalar("select current_database()"), database);
  assert.ok(["127.0.0.1", "::1"].includes(await scalar("select host(inet_server_addr())")));
  assert.equal(await scalar("select inet_server_port()"), 5432);
  assert.equal(await scalar("select count(*) from app_private.reward_programmes"), 0);
  const roleBefore = await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
  await query(integrationFixtureSql());
  // Synthetic adult evidence predates every sporting capture. Later profile
  // claiming changes ownership only, never the frozen sporting denominators.
  await query(`update public.athlete_profiles set date_of_birth='1990-01-01' where id=${literal(id(1000))}`);
  chain = await startOwnedRewardChain();
  const { artifact, operator, treasury, publicClient, testClient, operatorClient } = chain;
  const fixture = calculationFixture("league");
  const session = fixture.session;
  const operatorIdentity = { userId: id(4), sessionId: id(99511) };
  await query(`insert into auth.sessions(id,user_id,not_after) values
    (${literal(operatorIdentity.sessionId)},${literal(operatorIdentity.userId)},clock_timestamp()+interval '1 hour')`);
  const budgetWei = 100000000000000000001n;
  const programme = await createRewardProgramme({ actorUserId: id(4), operatorUserId: id(4), environment: "local_simulation",
    idempotencyKey: "system-programme-01", budgetWei, operatorAddress: operator.address, treasuryAddress: treasury,
    manifestHash: `0x${"3".repeat(64)}`, configuration: decodeRewardConfiguration(fixture.configuration) }, rpc);
  const entries = [];
  let sends = 0;

  await scenario("six actual SQL plans, signed attempts and jobs preserve exact retry identity", async () => {
    for (const n of [1, 2, 3, 4, 5, 0]) {
      const campaign = programme.campaigns.find(row => row.scopeKey === (n ? id(100 + n) : "rounds-1-5"));
      assert(campaign);
      const planInput = { campaignId: campaign.id, idempotencyKey: `system-plan-${n}` };
      const plan = await prepareRewardDeployment(session, planInput, { rpc, reader: publicClient });
      assert.equal(plan.nonce, BigInt(entries.length));
      const signed = await operator.signTransaction({ type: "eip1559", chainId: 31337, nonce: Number(plan.nonce), gas: 5000000n,
        maxFeePerGas: 10000000000n, maxPriorityFeePerGas: 100000000n, value: 0n, data: encodeRewardDeployment(plan.deployment, artifact.bytecode.object) });
      const attemptInput = { campaignId: campaign.id, intentId: plan.intentId, idempotencyKey: `system-attempt-${n}`, signedTransaction: signed };
      const attempt = await recordSignedRewardDeployment(session, attemptInput, rpc);
      assert.deepEqual(await recordSignedRewardDeployment(session, attemptInput, rpc), attempt);
      const jobInput = { campaignId: campaign.id, intentId: plan.intentId, attemptId: attempt.attemptId, idempotencyKey: `system-job-${n}` };
      const job = await queueVerifiedRewardDeployment(session, jobInput, rpc);
      assert.deepEqual(await queueVerifiedRewardDeployment(session, jobInput, rpc), job);
      assert.deepEqual(await prepareRewardDeployment(session, planInput, { rpc, reader: publicClient }), plan);
      entries.push({ n, campaign, plan, attempt, job, workerId: randomUUID() });
    }
    assert.equal(await scalar("select count(*) from app_private.reward_deployment_jobs"), 6);
    assert.equal(await scalar("select count(*) from app_private.reward_deployment_attempts"), 6);
    assert.equal(await publicClient.getTransactionCount({ address: operator.address }), 0);
  });

  const broadcast = async bytes => { sends++; return operatorClient.sendRawTransaction({ serializedTransaction: bytes }); };
  const runnerDependencies = { rpc, reader: publicClient, creationCode: artifact.bytecode.object, broadcast,
    chainId: 31337, origin: "http://127.0.0.1:5173",
    gasPolicy: { maxGasLimit: 500000n, maxFeePerGas: 30000000000n, maxTotalFeeWei: 15000000000000000n, minimumRemainingBalanceWei: 1000000n } };
  const runnerInput = workerId => ({ programmeId: programme.programmeId, workerId, maxJobs: 1, deadlineMs: Date.now() + 60000 });
  // Actual persisted job/plan identities, not a mocked queue or worker result.
  // The default dispatcher wraps every worker DB call in the session envelope.
  const runStored = (kind, job, nonce, workerId, sender, transport = rpc) => runStoredRewardOperatorJob(session, operatorIdentity,
    { kind, jobId: job.jobId, campaignId: job.campaignId, intentId: job.intentId, attemptId: job.attemptId,
      transactionHash: job.transactionHash, signerAddress: operator.address.toLowerCase(), nonce, state: job.state },
    runnerInput(workerId), { ...runnerDependencies, rpc: transport, broadcast: sender });
  const run = (entry, sender = broadcast, workerId = entry.workerId) =>
    runStored("deployment", entry.job, entry.plan.nonce, workerId, sender);
  const readJob = entry => readRewardDeploymentJob({ jobId: entry.job.jobId, actorUserId: id(4) }, rpc);
  const expireLease = entry => query(`update app_private.reward_deployment_jobs set lease_expires_at=clock_timestamp()-interval '1 second'
    where id=${literal(entry.job.jobId)};`); // test clock injection, never an operator recovery operation

  // Exercise all three durable crash boundaries on the SAME funding/lifecycle
  // job, through the actual authenticated coordinator in seven fresh processes.
  // Lease expiry is an explicit scratch-only clock injection, never an operation
  // offered by the public command or a replacement for waiting on a live lease.
  const recoverProcessJob = async ({ kind, job, read, broadcast: sender, sendCount }) => {
    assert.ok(["funding", "lifecycle"].includes(kind));
    const table = kind === "funding" ? "reward_funding_jobs" : "reward_lifecycle_jobs";
    const expire = () => query(`update app_private.${table} set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(job.jobId)}`);
    const childRun = createRewardOperatorProcess({ ...runnerDependencies, identity: operatorIdentity,
      programmeId: programme.programmeId, broadcast: sender });
    const pids = new Set(); const before = sendCount();
    const invoke = async (crashAt = null) => {
      const result = await childRun(crashAt ? { crashAt, jobId: job.jobId } : {});
      assert.ok(!pids.has(result.pid)); pids.add(result.pid); return result;
    };
    const expect = async outcome => assert.deepEqual((await invoke()).result.entries, [{ kind, jobId: job.jobId, outcome }]);
    await testClient.setAutomine(false);
    try {
      await invoke("after_arm");
      const armed = await read();
      assert.equal(armed.state, "broadcasting"); assert.equal(armed.mayHaveBroadcast, true);
      assert.equal(armed.transactionHash, job.transactionHash); assert.equal(sendCount(), before);
      await expect("busy"); await expire();
      await invoke("after_broadcast");
      assert.equal(sendCount(), before + 1); assert.equal((await read()).state, "broadcasting");
      await expect("busy"); await expire(); await expect("pending");
      assert.equal(sendCount(), before + 1, "pending recovery must never send again");
    } finally { await testClient.setAutomine(true); }
    await testClient.mine({ blocks: 96, interval: 1 }); await expire();
    await invoke("after_confirm");
    const confirmed = await read();
    assert.equal(confirmed.state, "confirmed"); assert.equal(confirmed.transactionHash, job.transactionHash);
    assert.equal(confirmed.leaseToken, null);
    // This sequential fixture queues its next funding/lifecycle job only after
    // this function returns; the final restart must not rediscover a paid job.
    const resumed = (await invoke()).result;
    assert.equal(resumed.stop, "queue_empty"); assert.deepEqual(resumed.entries, []);
    assert.equal(pids.size, 7); assert.equal(sendCount(), before + 1);
  };

  await scenario("real DB gates deny a non-operator and wait on an earlier reserved nonce without sending", async () => {
    // Keep a direct low-level denial to prove actual DB operator authorization,
    // not merely the dispatcher's matching-session precondition.
    await assert.rejects(runRewardDeploymentJob({ ...session, account: { ...session.account, userId: id(7) } },
      { jobId: entries[0].job.jobId, workerId: randomUUID() }, runnerDependencies),
      { code: "reward_operator_permission_required" });
    assert.equal((await run(entries[1])).outcome, "awaiting_nonce");
    assert.equal(sends, 0);
    await expireLease(entries[1]);
  });

  await scenario("lost send acknowledgement survives SQL persistence, pending reads and lease takeover", async () => {
    const entry = entries[0];
    await testClient.setAutomine(false);
    const lost = await run(entry, async bytes => {
      const armed = await readJob(entry);
      assert.equal(armed.state, "broadcasting"); assert.equal(armed.mayHaveBroadcast, true);
      await broadcast(bytes);
      throw new Error("Synthetic lost acknowledgement after the node accepted a real local transaction");
    });
    assert.equal(lost.outcome, "broadcast_unknown"); assert.equal(sends, 1);
    const armed = await readJob(entry);
    assert.equal(armed.state, "broadcasting"); assert.equal(armed.mayHaveBroadcast, true);
    assert.equal((await run(entries[1])).outcome, "busy", "A different campaign cannot share this signer lease");
    assert.equal((await run(entry, broadcast, randomUUID())).outcome, "busy");
    assert.equal((await run(entry)).outcome, "pending"); assert.equal(sends, 1);
    assert.equal((await readJob(entry)).state, "submitted");
    await testClient.setAutomine(true);
    await testClient.mine({ blocks: 96, interval: 1 });
    await expireLease(entry);
    const nextWorker = randomUUID();
    // Takeover itself uses the real SQL lease RPC; the old token cannot mutate it.
    const nextLease = await stepRewardDeploymentJob({ jobId: entry.job.jobId, actorUserId: id(4), workerId: nextWorker, leaseToken: null, action: "lease" }, rpc);
    assert.equal(nextLease.leaseGeneration, 2); assert.notEqual(nextLease.leaseToken, armed.leaseToken);
    await assert.rejects(stepRewardDeploymentJob({ jobId: entry.job.jobId, actorUserId: id(4), workerId: entry.workerId,
      leaseToken: armed.leaseToken, action: "submitted" }, rpc), { code: "reward_deployment_job_lease_lost" });
    assert.equal((await run(entry, broadcast, nextWorker)).outcome, "confirmed");
    assert.equal((await readJob(entry)).leaseToken, null);
    assert.equal((await run(entry)).outcome, "confirmed");
    assert.equal(sends, 1);
    assert.equal(await publicClient.getTransactionCount({ address: operator.address }), 1);
  });

  await scenario("actual operator queue dispatches the next five deployments and confirms all six exact attempts", async () => {
    const childRun = createRewardOperatorProcess({ ...runnerDependencies, identity: operatorIdentity, programmeId: programme.programmeId });
    const pids = new Set();
    const execute = async options => {
      const value = await childRun(options); assert.ok(!pids.has(value.pid), "restart must launch a new process"); pids.add(value.pid); return value;
    };
    for (const entry of entries.slice(1)) {
      const before = sends;
      if (entry.n === 2) {
        await execute({ crashAt: "after_arm", jobId: entry.job.jobId });
        const armed = await readJob(entry); assert.equal(armed.state, "broadcasting"); assert.equal(armed.mayHaveBroadcast, true);
        assert.equal(sends, before, "process died before broadcast was invoked");
        assert.equal((await execute()).result.entries[0].outcome, "busy");
        await expireLease(entry);
      }
      if (entry.n === 3) {
        await testClient.setAutomine(false);
        try {
          await execute({ crashAt: "after_broadcast", jobId: entry.job.jobId });
          assert.equal(sends, before + 1); assert.equal((await readJob(entry)).state, "broadcasting");
          assert.equal((await execute()).result.entries[0].outcome, "busy");
          await expireLease(entry);
          assert.equal((await execute()).result.entries[0].outcome, "pending");
          assert.equal(sends, before + 1, "fresh authenticated process must not send the pending transaction again");
        } finally { await testClient.setAutomine(true); }
      } else {
        const submitted = (await execute()).result;
        assert.deepEqual(submitted.entries, [{ kind: "deployment", jobId: entry.job.jobId, outcome: "submitted" }]);
        assert.equal(submitted.stop, "limit_reached");
      }
      await testClient.mine({ blocks: 96, interval: 1 });
      await expireLease(entry);
      if (entry.n === 0) {
        await execute({ crashAt: "after_confirm", jobId: entry.job.jobId });
        assert.equal((await readJob(entry)).state, "confirmed", "SQL committed before the process was killed");
        const resumed = (await execute()).result;
        assert.equal(resumed.stop, "queue_empty"); assert.deepEqual(resumed.entries, []);
      } else assert.deepEqual((await execute()).result.entries, [{ kind: "deployment", jobId: entry.job.jobId, outcome: "confirmed" }]);
      assert.equal(sends, before + 1);
    }
    assert.ok(pids.size >= 15);
    for (const entry of entries) {
      const job = await readJob(entry); assert.equal(job.state, "confirmed"); assert(job.confirmationObservationId);
      const checkpoint = await readRewardCampaignCheckpoint({ campaignId: entry.campaign.id, actorUserId: id(4) }, rpc);
      assert.equal(checkpoint.attemptId, entry.attempt.attemptId);
      assert.equal(checkpoint.deployment.contractAddress, entry.plan.deployment.context.verifyingContract.toLowerCase());
      assert.equal(checkpoint.deployment.deploymentTransactionHash, entry.job.transactionHash);
      assert.equal(checkpoint.observation.accounting.accountedFunding, 0n);
      assert.equal((await run(entry)).outcome, "confirmed");
    }
    assert.equal(sends, 6);
    assert.equal(await publicClient.getTransactionCount({ address: operator.address }), 6);
    assert.equal(await scalar("select count(*) from app_private.reward_verified_deployments"), 6);
    assert.equal(await scalar("select count(*) from app_private.reward_deployment_jobs where state='confirmed'"), 6);
    const empty = await drainRewardOperatorQueue(session, operatorIdentity, runnerInput(randomUUID()), runnerDependencies);
    assert.equal(empty.stop, "queue_empty"); assert.deepEqual(empty.entries, []);
  });

  await scenario("real source/review/reservation/upload services prepare all six wallet-independent packages", async () => {
    for (const entry of entries) {
      const snapshot = await captureRewardSourceSnapshot({ organizationId: id(1), leagueSeasonId: id(3), roundIds: entry.campaign.roundIds,
        actorUserId: id(4), idempotencyKey: `system-source-${entry.n}` }, rpc);
      const review = await submitRewardSportingReview(session, { campaignId: entry.campaign.id, snapshotId: snapshot.snapshotId,
        idempotencyKey: `system-review-${entry.n}`, review: calculationFixture(entry.n ? "race" : "league", entry.n || 1).review }, rpc);
      entry.allocation = await reserveReviewedRewardAllocation(session, { campaignId: entry.campaign.id, reviewId: review.reviewId,
        idempotencyKey: `system-allocation-${entry.n}` }, rpc);
      entry.prepared = await prepareReservedRewardUpload(session, { campaignId: entry.campaign.id, allocationId: entry.allocation.allocationId,
        idempotencyKey: `system-upload-${entry.n}` }, rpc);
      assert.equal(entry.prepared.upload.programmeId, entry.plan.deployment.programmeId);
      assert.equal(entry.prepared.upload.campaignId, entry.plan.deployment.campaignId);
    }
    assert.equal(await scalar("select count(*) from app_private.reward_upload_packages"), 6);
  });

  // Actual SQL lifecycle jobs now own all sends and atomic receipt confirmation.
  // Test-only operator signing and injected response loss remain explicit.
  const lifecycleInput=(entry,action,start=0)=>({campaignId:entry.campaign.id,uploadId:entry.prepared.uploadId,action,idempotencyKey:`system-${action}-${entry.n}-${start}`});
  const lifecycleDependencies={rpc,reader:publicClient,creationCode:artifact.bytecode.object};
  let lifecycleSends=0;
  const writeLifecycle=async(entry,action,start=0)=>{
    const input=lifecycleInput(entry,action,start);const prepared=await prepareRewardLifecycle(session,input,lifecycleDependencies);const {plan}=prepared;
    if(action==="upload_awards")assert.equal(plan.batchStart,start);
    const retry=await prepareRewardLifecycle(session,input,{rpc,reader:{},creationCode:"0x00"});
    assert.equal(retry.reused,true);assert.deepEqual(retry.plan,plan);
    const current=await readVerifiedRewardCampaign(publicClient,plan.deployment,artifact.bytecode.object);
    requireRewardLifecyclePrestate(plan,current.observation.accounting,current.observation.finalizedBlock.timestamp);
    const evidence=await checkRewardUploadEvidence({campaignId:entry.campaign.id,actorUserId:id(4),uploadId:entry.prepared.uploadId},rpc);
    assert.equal(evidence.sourceReviewEndsAt,entry.prepared.upload.sourceReviewEndsAt);
    if(action==="activate")assert(BigInt(Math.floor(Date.parse(evidence.checkedAt)/1000))>=evidence.sourceReviewEndsAt,"Database source-review clock must also be complete");
    const signed=await operator.signTransaction({...encodeRewardLifecycle(plan),type:"eip1559",gas:5000000n,maxFeePerGas:10000000000n,maxPriorityFeePerGas:100000000n});
    const attemptInput={...input,intentId:prepared.intentId,signedTransaction:signed,idempotencyKey:`attempt-${input.idempotencyKey}`};
    const attempt=await recordSignedRewardLifecycle(session,attemptInput,rpc);
    assert.deepEqual(await recordSignedRewardLifecycle(session,attemptInput,rpc),attempt);
    const loaded=await loadVerifiedRewardLifecycleAttempt(session,{...attemptInput,attemptId:attempt.attemptId},rpc);
    assert.deepEqual(loaded.plan,plan);assert.equal(loaded.verified.signedTransaction,signed);
    const jobInput={...input,intentId:prepared.intentId,attemptId:attempt.attemptId,idempotencyKey:`job-${input.idempotencyKey}`};
    const job=await queueVerifiedRewardLifecycle(session,jobInput,rpc);assert.deepEqual(await queueVerifiedRewardLifecycle(session,jobInput,rpc),job);
    const workerId=randomUUID();const send=async bytes=>{lifecycleSends++;return operatorClient.sendRawTransaction({serializedTransaction:bytes});};
    const run=(sender=send,worker=workerId,transport=rpc)=>runStored("lifecycle",job,plan.nonce,worker,sender,transport);
    const count=lifecycleSends;let firstLease;
    const processRecovery = entry.n === 2;
    if(processRecovery){
      await recoverProcessJob({kind:"lifecycle",job,broadcast:send,sendCount:()=>lifecycleSends,
        read:()=>readRewardLifecycleJob({jobId:job.jobId,actorUserId:id(4)},rpc)});
    }else if(entry.n===1 && action==="upload_awards"){
      await testClient.setAutomine(false);
      assert.equal((await run(async bytes=>{await send(bytes);throw new Error("Synthetic lost lifecycle send response");})).outcome,"broadcast_unknown");
      firstLease=await readRewardLifecycleJob({jobId:job.jobId,actorUserId:id(4)},rpc);
      assert.equal(firstLease.state,"broadcasting");assert.equal(firstLease.mayHaveBroadcast,true);
      assert.equal((await run()).outcome,"pending");assert.equal(lifecycleSends,count+1);
      assert.equal((await run(send,randomUUID())).outcome,"busy");
      await testClient.setAutomine(true);
    }else assert.equal((await run()).outcome,"submitted");
    assert.equal((await publicClient.waitForTransactionReceipt({hash:attempt.transactionHash,timeout:10000})).status,"success");
    if(!processRecovery)await testClient.mine({blocks:96,interval:1});
    if(firstLease){
      await query(`update app_private.reward_lifecycle_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(job.jobId)};`);
      await assert.rejects(stepRewardLifecycleJob({jobId:job.jobId,actorUserId:id(4),workerId,leaseToken:firstLease.leaseToken,action:"arm"},rpc),
        {code:"reward_lifecycle_job_lease_lost"});
      const replacement=randomUUID();let lost=false;
      const lostConfirmation=async(name,args)=>{const result=await rpc(name,args);if(name==="service_reward_operator_session_call"&&args.p_method==="service_confirm_reward_lifecycle_job"&&!result.error){lost=true;return{data:null,error:{message:"Synthetic lost committed lifecycle confirmation response"}};}return result;};
      assert.equal((await run(send,replacement,lostConfirmation)).outcome,"unavailable");assert.equal(lost,true);
      assert.equal((await run()).outcome,"confirmed");
      const saved=await readRewardLifecycleJob({jobId:job.jobId,actorUserId:id(4)},rpc);assert.equal(saved.leaseGeneration,2);assert.equal(saved.leaseToken,null);
      // Already-confirmed reads are safe retries; stale capabilities were also
      // rejected before completion in the actual SQL concurrency suite.
    }else assert.equal((await run()).outcome,"confirmed");
    assert.equal((await run()).outcome,"confirmed");assert.equal(lifecycleSends,count+1);
    const proof=await readVerifiedRewardLifecycle(publicClient,plan,signed,artifact.bytecode.object);
    assert.equal(proof.lifecycle.action,action);
    const savedProof=await scalar(`select lifecycle_body from app_private.reward_lifecycle_confirmations where job_id=${literal(job.jobId)}`);
    assert.equal(Object.keys(savedProof).length,19);assert.equal(savedProof.transactionHash,attempt.transactionHash);assert.equal(savedProof.action,action);
    const savedJob=await readRewardLifecycleJob({jobId:job.jobId,actorUserId:id(4)},rpc);assert.equal(savedJob.state,"confirmed");assert.equal(savedJob.leaseToken,null);
    assert.deepEqual((await prepareRewardLifecycle(session,input,{rpc,reader:{},creationCode:"0x00"})).plan,plan,"Mined actions replay their original private prestate");
    return proof;
  };

  await scenario("six persisted funding jobs confirm exact receipts, recover lost responses and preserve staged reserves", async () => {
    // Funding and lifecycle use real workers/SQL jobs/receipts. Only the fixture
    // data, operator signing and loopback chain are synthetic.
    let deposited = 0n; let fundingSends=0;
    for (const entry of entries) {
      const upload = entry.prepared.upload;
      await checkRewardUploadEvidence({ campaignId: entry.campaign.id, actorUserId: id(4), uploadId: entry.prepared.uploadId }, rpc);
      const fundingInput = { campaignId: entry.campaign.id, idempotencyKey: `system-funding-${entry.n}` };
      const funding = await prepareRewardFunding(session, fundingInput, { rpc, reader: publicClient, creationCode: artifact.bytecode.object });
      const fundingPlan = funding.plan;
      assert.equal(fundingPlan.expectedBudget, entry.campaign.budgetWei); assert.equal(fundingPlan.expectedAccountedFunding, 0n);
      const replay = await prepareRewardFunding(session, fundingInput, { rpc, reader: {}, creationCode: artifact.bytecode.object });
      assert.equal(replay.intentId, funding.intentId); assert.deepEqual(replay.plan, fundingPlan); assert.equal(replay.reused, true);
      const signed = await operator.signTransaction({ ...encodeRewardFunding(fundingPlan), type: "eip1559", gas: 300000n,
        maxFeePerGas: 10000000000n, maxPriorityFeePerGas: 100000000n });
      const attemptInput = { campaignId: entry.campaign.id, intentId: funding.intentId, idempotencyKey: `system-funding-attempt-${entry.n}`, signedTransaction: signed };
      const saved = await recordSignedRewardFunding(session, attemptInput, rpc);
      assert.deepEqual(await recordSignedRewardFunding(session, attemptInput, rpc), saved);
      const attempt = await loadVerifiedRewardFundingAttempt(session, { campaignId: entry.campaign.id, intentId: funding.intentId, attemptId: saved.attemptId }, rpc);
      assert.equal(attempt.verified.signedTransaction, signed); assert.deepEqual(attempt.plan, fundingPlan);
      const jobInput={campaignId:entry.campaign.id,intentId:funding.intentId,attemptId:saved.attemptId,idempotencyKey:`system-funding-job-${entry.n}`};
      const job=await queueVerifiedRewardFunding(session,jobInput,rpc);
      assert.deepEqual(await queueVerifiedRewardFunding(session,jobInput,rpc),job);
      let workerId=randomUUID();
      const send=async bytes=>{fundingSends++;return operatorClient.sendRawTransaction({serializedTransaction:bytes});};
      const runFunding=(sender=send,worker=workerId,transport=rpc)=>runStored("funding",job,fundingPlan.nonce,worker,sender,transport);
      const fundingHash=saved.transactionHash;
      const processRecovery = entry.n === 2;
      if(processRecovery) {
        await recoverProcessJob({kind:"funding",job,broadcast:send,sendCount:()=>fundingSends,
          read:()=>readRewardFundingJob({jobId:job.jobId,actorUserId:id(4)},rpc)});
      } else if(entry===entries[0]) {
        await testClient.setAutomine(false);
        const lost=await runFunding(async bytes=>{
          const armed=await readRewardFundingJob({jobId:job.jobId,actorUserId:id(4)},rpc);
          assert.equal(armed.state,"broadcasting");assert.equal(armed.mayHaveBroadcast,true);
          await send(bytes);throw new Error("Synthetic funding acknowledgement loss");
        });
        assert.equal(lost.outcome,"broadcast_unknown");assert.equal(fundingSends,1);
        const old=await readRewardFundingJob({jobId:job.jobId,actorUserId:id(4)},rpc);
        assert.equal((await runFunding(send,randomUUID())).outcome,"busy");
        assert.equal((await runFunding()).outcome,"pending");assert.equal(fundingSends,1);
        await testClient.setAutomine(true);await testClient.mine({blocks:96,interval:1});
        await query(`update app_private.reward_funding_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(job.jobId)};`);
        workerId=randomUUID();
        const next=await stepRewardFundingJob({jobId:job.jobId,actorUserId:id(4),workerId,leaseToken:null,action:"lease"},rpc);
        assert.equal(next.leaseGeneration,2);assert.notEqual(next.leaseToken,old.leaseToken);
        await assert.rejects(stepRewardFundingJob({jobId:job.jobId,actorUserId:id(4),workerId:old.leaseOwner,leaseToken:old.leaseToken,action:"submitted"},rpc),
          {code:"reward_funding_job_lease_lost"});
      } else {
        assert.equal((await runFunding()).outcome,"submitted");await testClient.mine({blocks:96,interval:1});
      }
      if(entry===entries[0]) {
        let lostConfirmation=false;
        const loss=async(name,args)=>{const response=await rpc(name,args);if(name==="service_reward_operator_session_call"&&args.p_method==="service_confirm_reward_funding_job"&&!response.error){lostConfirmation=true;throw new Error("Synthetic committed confirmation response loss");}return response;};
        assert.equal((await runFunding(send,workerId,loss)).outcome,"unavailable");assert.equal(lostConfirmation,true);
      } else assert.equal((await runFunding()).outcome,"confirmed");
      assert.equal((await runFunding()).outcome,"confirmed");
      const confirmed=await readRewardFundingJob({jobId:job.jobId,actorUserId:id(4)},rpc);
      assert.equal(confirmed.state,"confirmed");assert.equal(confirmed.leaseToken,null);
      const proof=await scalar(`select funding_body from app_private.reward_funding_confirmations where job_id=${literal(job.jobId)}`);
      assert.equal(proof.transactionHash,fundingHash);assert.equal(BigInt(proof.budget),entry.campaign.budgetWei);
      assert.equal((await publicClient.waitForTransactionReceipt({ hash: fundingHash, timeout: 10000 })).status, "success");
      for (let start=0;start<upload.awards.length;start+=64) await writeLifecycle(entry,"upload_awards",start);
      entry.staged=await writeLifecycle(entry,"stage_allocation");
      const funded = await readVerifiedRewardFunding(publicClient, fundingPlan, signed, artifact.bytecode.object);
      assert.equal(funded.funding.transactionHash, fundingHash);
      assert.equal(funded.funding.budget, entry.campaign.budgetWei);
      assert.equal(funded.funding.depositedValue, entry.campaign.budgetWei);
      assert.equal(funded.checkpoint.observation.accounting.state, 2);
      const observed = await observeVerifiedRewardCampaign(session, { campaignId: entry.campaign.id, intentId: entry.plan.intentId,
        attemptId: entry.attempt.attemptId, idempotencyKey: `system-staged-${entry.n}` }, { rpc, reader: publicClient, creationCode: artifact.bytecode.object });
      assert.equal(observed.funding.fixedBudgetMatches, true);
      const checkpoint = await readRewardCampaignCheckpoint({ campaignId: entry.campaign.id, actorUserId: id(4) }, rpc);
      const accounting = checkpoint.observation.accounting;
      assert.deepEqual(accounting, funded.checkpoint.observation.accounting);
      assert.equal(accounting.state, 2); assert.equal(accounting.entitlementCount, BigInt(upload.awards.length));
      assert.equal(accounting.uploadDigest, upload.uploadDigest); assert.equal(accounting.allocationDigest, upload.allocationDigest);
      assert.deepEqual(accounting.paid, [0n, 0n]);
      assert.equal(accounting.nativeBalance, entry.campaign.budgetWei);
      assert.equal(accounting.accountedFunding, entry.campaign.budgetWei);
      deposited += accounting.accountedFunding;
    }
    assert.equal(deposited, budgetWei);
    assert.equal(fundingSends,6);
    assert.equal(await scalar("select count(*) from app_private.reward_campaign_observations"), 48);
    assert.equal(await scalar("select count(*) from app_private.reward_funding_intents"), 6);
    assert.equal(await scalar("select count(*) from app_private.reward_funding_attempts"), 6);
    assert.equal(await scalar("select count(*) from app_private.reward_operator_nonce_slots"), 24);
    assert.equal(await scalar("select count(*) from app_private.reward_lifecycle_intents"),12);
    assert.equal(await scalar("select count(*) from app_private.reward_lifecycle_attempts"),12);
    assert.equal(await scalar("select count(*) from app_private.reward_lifecycle_jobs where state='confirmed'"),12);
    assert.equal(await scalar("select count(*) from app_private.reward_lifecycle_confirmations"),12);
    assert.equal(await scalar("select count(*) from app_private.reward_funding_jobs where state='confirmed'"),6);
    assert.equal(await scalar("select count(*) from app_private.reward_funding_confirmations"),6);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
  });
  await scenario("all six reviewed packages reject early activation then activate with current SQL evidence and exact receipt checks",async()=>{
    let ready=0n;
    for(const entry of entries){
      await assert.rejects(prepareRewardLifecycle(session,lifecycleInput(entry,"activate"),lifecycleDependencies),{code:"reward_lifecycle_review_not_finished"});
      const checkpoint=await readRewardCampaignCheckpoint({campaignId:entry.campaign.id,actorUserId:id(4)},rpc);
      if(checkpoint.observation.accounting.activationNotBefore>ready)ready=checkpoint.observation.accounting.activationNotBefore;
    }
    assert.equal(await scalar("select count(*) from app_private.reward_operator_nonce_slots"),24,"Early activation has not reserved a nonce");
    await testClient.setNextBlockTimestamp({timestamp:ready});await testClient.mine({blocks:96,interval:1});
    for(const entry of entries){
      const proof=await writeLifecycle(entry,"activate");assert.equal(proof.lifecycle.claimDeadline,proof.lifecycle.blockTimestamp+31536000n);
      const saved=await observeVerifiedRewardCampaign(session,{campaignId:entry.campaign.id,intentId:entry.plan.intentId,attemptId:entry.attempt.attemptId,
        idempotencyKey:`system-active-${entry.n}`},{rpc,reader:publicClient,creationCode:artifact.bytecode.object});
      assert.equal(saved.checkpoint.observation.accounting.state,3);assert.deepEqual(saved.checkpoint.observation.accounting.paid,[0n,0n]);
      assert.equal(saved.checkpoint.observation.accounting.nativeBalance,entry.campaign.budgetWei);
    }
    assert.equal(await scalar("select count(*) from app_private.reward_campaign_observations"),72);
    assert.equal(await scalar("select count(*) from app_private.reward_operator_nonce_slots"),30);
    assert.equal(await scalar("select count(*) from app_private.reward_lifecycle_intents"),18);
    assert.equal(await scalar("select count(*) from app_private.reward_lifecycle_attempts"),18);
    assert.equal(await scalar("select count(*) from app_private.reward_campaign_upload_bindings"),6);
    assert.equal(await scalar("select count(*) from app_private.reward_lifecycle_jobs where state='confirmed'"),18);
    assert.equal(await scalar("select count(*) from app_private.reward_lifecycle_confirmations"),18);
    assert.equal(lifecycleSends,18);
  });
  await clubClaimSystemScenarios({harness:databaseHarness,scenario,chain,entries,programmeId:programme.programmeId});
  await claimSystemScenarios({harness:databaseHarness,scenario,chain,entries,programmeId:programme.programmeId});
  assert.equal(await scalar("select count(*) from app_private.reward_relayer_nonce_slots"),4);
  assert.equal(await scalar("select count(*) from app_private.reward_relayer_nonce_slots where club_payment_intent_id is not null and athlete_payment_intent_id is null"),1);
  assert.equal(await scalar("select count(*) from app_private.reward_club_payment_confirmations"),1);
  console.log(`Reward real-database/chain rehearsal passed: ${passed} scenarios; six deployment/funding and eighteen lifecycle worker jobs; two durable synthetic athlete payments and one club payment, all other reserves retained.`);
} finally {
  try { await chain?.stop(); }
  finally { await databaseHarness.close(); }
}
