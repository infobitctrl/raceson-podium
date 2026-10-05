import {sponsorCreationScenarios} from "./reward-sponsor-creation-scenarios.mjs";
import {sponsorAllocationV4Scenarios} from "./reward-sponsor-allocation-v4-scenarios.mjs";
import {sponsorLaunchScenarios} from "./reward-sponsor-launch-scenarios.mjs";
import {sponsorSourceV4Scenarios} from "./reward-sponsor-source-v4-scenarios.mjs";
import assert from "node:assert/strict";
import { openRewardTestDatabase } from "./reward-test-database.mjs";
import { createRewardProgramme, decodeRewardConfiguration, captureRewardSourceSnapshot, captureRewardRecordSource, readRewardRecordSource,
  readRewardRecordApproval, rewardRecordApprovalRequest, checkRewardUploadEvidence, readRewardAllocationExport,
  reserveRewardDeploymentIntent, storeRewardDeploymentAttempt, readRewardDeploymentAttempt,
  storeRewardCampaignCheckpoint, readRewardCampaignCheckpoint, queueRewardDeploymentJob, readRewardDeploymentJob, stepRewardDeploymentJob,
  readRewardFundingContext,reserveRewardFundingIntent,storeRewardFundingAttempt,readRewardFundingAttempt,
  queueRewardFundingJob,readRewardFundingJob,stepRewardFundingJob,confirmRewardFundingJob } from "../dist/rewards/index.js";
import { fundingJobScenarios } from "./reward-funding-job-scenarios.mjs";
import { lifecycleIntentScenarios } from "./reward-lifecycle-intent-scenarios.mjs";
import { lifecycleJobScenarios } from "./reward-lifecycle-job-scenarios.mjs";
import { walletScenarios } from "./reward-wallet-scenarios.mjs";
import { clubTreasuryScenarios } from "./reward-club-treasury-scenarios.mjs";
import { clubReviewScenarios } from "./reward-club-review-scenarios.mjs";
import { operatorSessionScenarios } from "./reward-operator-session-scenarios.mjs";
import { organizerPreparationScenarios } from "./reward-organizer-preparation-scenarios.mjs";
import { organizerSportingScenarios } from "./reward-organizer-sporting-scenarios.mjs";
import { organizerRecordScenarios } from "./reward-organizer-record-scenarios.mjs";
import { resultReviewV3Scenarios } from "./reward-result-review-v3-scenarios.mjs";
import { programmeApprovalV3Scenarios } from "./reward-programme-approval-v3-scenarios.mjs";
import { historicalSourceV3Scenarios } from "./reward-historical-source-v3-scenarios.mjs";
import { syntheticPilotV3Scenarios } from "./reward-synthetic-pilot-v3-scenarios.mjs";
import { finaleBindingV3Scenarios } from "./reward-finale-binding-v3-scenarios.mjs";
import { allocationApprovalV3Scenarios } from "./reward-allocation-approval-v3-scenarios.mjs";
import { nativeFinaleV3Scenarios } from "./reward-native-finale-v3-scenarios.mjs";
import { nativeContinuityV3Scenarios } from "./reward-native-continuity-v3-scenarios.mjs";
import { leaguePolicyV3Scenarios } from "./reward-league-policy-v3-scenarios.mjs";
import { leaguePublicationV3Scenarios } from "./reward-league-publication-v3-scenarios.mjs";
import { finalAllocationV3Scenarios } from "./reward-final-allocation-v3-scenarios.mjs";
import { finalAllocationActionsV3Scenarios } from "./reward-final-allocation-actions-v3-scenarios.mjs";
import { programmeDeploymentV3Scenarios } from "./reward-programme-deployment-v3-scenarios.mjs";
import { programmeAttemptV3Scenarios } from "./reward-programme-attempt-v3-scenarios.mjs";
import { queueRewardLifecycleJob,readRewardLifecycleJob,stepRewardLifecycleJob,confirmRewardLifecycleJob } from "../dist/rewards/index.js";
import { reserveRewardLifecycleIntent,storeRewardLifecycleAttempt,readRewardLifecycleContext,readRewardLifecycleAttempt } from "../dist/rewards/index.js";
import { previewRewardSportingReview, submitRewardSportingReview, reserveReviewedRewardAllocation } from "../../../apps/api/dist/features/rewards/calculation-service.js";
import { captureRewardRecordCandidate } from "../../../apps/api/dist/features/rewards/record-candidate-service.js";
import { approveRewardRecordCandidate, withdrawApprovedRewardRecord } from "../../../apps/api/dist/features/rewards/record-approval-service.js";
import { prepareReservedRewardUpload } from "../../../apps/api/dist/features/rewards/upload-service.js";
import { prepareRewardDeployment } from "../../../apps/api/dist/features/rewards/deployment-service.js";
import { canonicalRewardJson, commitPrivateRewardDocument, rewardUploadDigest } from "../../rewards-chain/dist/index.js";
import { calculationFixture, rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { recordFixture } from "../../../apps/api/test/fixtures/reward-record.mjs";
import { integrationFixtureSql, correctionSql, recordFixtureSql, recordCorrectionSql, literal } from "./reward-integration-fixture.mjs";
import { privyTestnetPilotV3Scenarios } from "./reward-privy-testnet-pilot-v3-scenarios.mjs";
import { participationReviewScenarios } from "./reward-participation-review-scenarios.mjs";
import { draftDeletionScenarios } from "./reward-draft-deletion-scenarios.mjs";
import { guidedSetupScenarios } from "./reward-guided-setup-scenarios.mjs";

// Only invoked by the validator against its own disposable database.
const databaseHarness = openRewardTestDatabase(process.argv.slice(2));
const { database, query, scalar, rpc, rpcSql, lock, waiting } = databaseHarness;
const rejectCode = (code, promise) => assert.rejects(promise, (error) => error.code === code);
let passed = 0;
async function scenario(name, work) { await work(); passed++; console.log(`reward DB scenario ${passed}: ${name}`); }

try {
  assert.equal(await scalar("select current_database()"), database);
  assert.ok(["127.0.0.1", "::1"].includes(await scalar("select host(inet_server_addr())")));
  assert.equal(await scalar("select inet_server_port()"), 5432);
  assert.equal(await scalar("select count(*) from app_private.reward_programmes"), 0, "scratch ledger must start empty");
  const roleBefore = await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
  await query(integrationFixtureSql());
  await query(recordFixtureSql());
  await sponsorLaunchScenarios({harness:databaseHarness,scenario});
  await sponsorSourceV4Scenarios({harness:databaseHarness,scenario});
  await sponsorCreationScenarios({harness:databaseHarness,scenario});
  await draftDeletionScenarios({harness:databaseHarness,scenario});
  await guidedSetupScenarios({harness:databaseHarness,scenario});
  await participationReviewScenarios({harness:databaseHarness,scenario});
  await resultReviewV3Scenarios({harness:databaseHarness,scenario});
  const fixture = calculationFixture("league"); const configuration = decodeRewardConfiguration(fixture.configuration);
  const session = fixture.session; const budgetWei = 100000000000000000001n;
  const programmeInput = { actorUserId: id(4), operatorUserId: id(4), environment: "local_simulation",
    idempotencyKey: "real-db-programme-01", budgetWei, operatorAddress: `0x${"1".repeat(40)}`, treasuryAddress: `0x${"2".repeat(40)}`,
    manifestHash: `0x${"3".repeat(64)}`, configuration };
  const programme = await createRewardProgramme(programmeInput, rpc);
  const campaign = (n) => programme.campaigns.find((row) => row.scopeKey === (n === 0 ? "rounds-1-5" : id(100 + n)));
  const capture = (n, key) => captureRewardSourceSnapshot({ organizationId: id(1), leagueSeasonId: id(3),
    roundIds: campaign(n).roundIds, actorUserId: id(4), idempotencyKey: key }, rpc);
  const reviews = new Map(); const snapshots = new Map(); const allocations = new Map(); const uploads = new Map();
  let recordApproval = null;
  const reviewBody = (n, approved = recordApproval) => {
    const review = calculationFixture(n === 0 ? "league" : "race", n || 1).review;
    if (n === 1 && approved) review.roundReviews[0].records[0].baseline = {
      approvalId: approved.approvalId, publicationId: approved.body.baseline.publicationId,
      establishedAtMs: approved.body.baseline.establishedAtMs.toString(), finishTimeMs: approved.body.baseline.finishTimeMs.toString(),
      courseComparisonKey: approved.body.baseline.courseComparisonKey };
    return review;
  };
  const submit = (n, snapshot, key, review = reviewBody(n)) => submitRewardSportingReview(session,
    { campaignId: campaign(n).id, snapshotId: snapshot.snapshotId, idempotencyKey: key, review }, rpc);
  const reserve = (n, key, review = reviews.get(n)) => reserveReviewedRewardAllocation(session,
    { campaignId: campaign(n).id, reviewId: review.reviewId, idempotencyKey: key }, rpc);
  const programmeLock = () => lock(`select id from app_private.reward_programmes where id=${literal(programme.programmeId)} for update`);
  const priorCapture = (key) => captureRewardRecordSource({ campaignId: campaign(1).id, targetSnapshotId: snapshots.get(1).snapshotId,
    actorUserId: id(4), priorRaceId: id(60001), idempotencyKey: key }, rpc);
  const recordLock = (key) => lock(`select pg_advisory_xact_lock(hashtextextended(${literal(`reward-record:${campaign(1).id}:${id(4)}:${key}`)},0))`);
  const approve = (snapshot, key, baselineSourceId = id(60120)) => approveRewardRecordCandidate(session,
    { ...recordFixture().input, campaignId: campaign(1).id, priorSnapshotId: snapshot.snapshotId, baselineSourceId, idempotencyKey: key }, rpc);
  const withdrawal = (approved, key) => ({ campaignId: campaign(1).id, approvalId: approved.approvalId,
    idempotencyKey: key, reason: "Synthetic comparison withdrawal; no real sporting decision." });
  const prepareUpload = (n, key, transport = rpc) => prepareReservedRewardUpload(session,
    { campaignId: campaign(n).id, allocationId: allocations.get(n).allocationId, idempotencyKey: key }, transport);
  const checkUpload = (n) => checkRewardUploadEvidence({ campaignId: campaign(n).id, actorUserId: id(4), uploadId: uploads.get(n).uploadId }, rpc);

  const deploymentPlans = new Map();
  const pendingReader = { getChainId: async () => 31337, getTransactionCount: async () => 7 };
  const prepareDeployment = (n) => prepareRewardDeployment(session, { campaignId: campaign(n).id, idempotencyKey: `deployment-plan-${n}` }, { rpc, reader: pendingReader });
  await scenario("build revision preserves legacy intents without permitting mismatched build/hash pairs", async () => {
    const oldId = 'raceson-reward-campaign-v2-solc-0.8.36-cancun-ir-200';
    const oldHash = '8195f9fe8d307325596d3610f12e8627c42748cc55d0755c0da9b4e47d0314b3';
    const currentId = 'raceson-reward-campaign-v2-funding-v1-solc-0.8.36-cancun-ir-200';
    const currentHash = '57486b6aee9c3f6cc7182982b67243919bea1e2ca05dd034501450bc6d22641e';
    const insert = (build, hash) => `insert into app_private.reward_deployment_intents(campaign_id,chain_id,operator_address,nonce,
      build_id,creation_code_hash,created_by_user_id,idempotency_key) values(${literal(campaign(1).id)},31337,
      ${literal(programmeInput.operatorAddress)},0,${literal(build)},decode(${literal(hash)},'hex'),${literal(id(4))},'legacy-build-retry');`;
    const replay = JSON.parse(await query(`begin; ${insert(oldId, oldHash)}
      ${rpcSql('service_reserve_reward_deployment',{p_campaign_id:campaign(1).id,p_actor_user_id:id(4),p_idempotency_key:'legacy-build-retry',p_observed_chain_id:31337,p_pending_nonce:'99'})}
      rollback;`));
    assert.equal(replay.intent.buildId,oldId); assert.equal(replay.intent.creationCodeHash,`0x${oldHash}`); assert.equal(replay.intent.nonce,'0');
    for (const [build, hash] of [[oldId,currentHash],[currentId,oldHash],['unknown-build',currentHash]]) {
      await assert.rejects(query(`begin; ${insert(build,hash)} rollback;`), /reward_deployment_intents_build_pair_check/);
    }
    const current = JSON.parse(await query(`begin; ${rpcSql('service_reserve_reward_deployment',{p_campaign_id:campaign(1).id,
      p_actor_user_id:id(4),p_idempotency_key:'current-build-retry',p_observed_chain_id:31337,p_pending_nonce:'7'})} rollback;`));
    assert.equal(current.intent.buildId,currentId); assert.equal(current.intent.creationCodeHash,`0x${currentHash}`);
    assert.equal(await scalar('select count(*) from app_private.reward_deployment_intents'),0);
  });
  await scenario("same-key concurrent deployment preparation reserves one nonce and six campaigns receive unique slots", async () => {
    const unlock = await programmeLock();
    const pending = Promise.all([prepareDeployment(1), prepareDeployment(1)]); pending.catch(() => {});
    try { await waiting(2); } finally { await unlock(); }
    const [first, replay] = await pending; assert.deepEqual(first,replay); deploymentPlans.set(1,first); assert.equal(first.nonce,7n);
    const rest = await Promise.all([2,3,4,5,0].map(async (n) => [n,await prepareDeployment(n)]));
    rest.forEach(([n,plan]) => deploymentPlans.set(n,plan));
    assert.deepEqual([...deploymentPlans.values()].map((row)=>Number(row.nonce)).sort((a,b)=>a-b),[7,8,9,10,11,12]);
    assert.equal(new Set([...deploymentPlans.values()].map((row)=>row.deployment.context.verifyingContract)).size,6);
    assert.equal(await scalar("select count(*) from app_private.reward_deployment_intents"),6);
    const higherPending = await reserveRewardDeploymentIntent({ campaignId:campaign(1).id,actorUserId:id(4),idempotencyKey:'deployment-plan-1',observedChainId:31337,pendingNonce:99n },rpc);
    assert.equal(higherPending.intent.nonce,7n);
    await rejectCode("reward_deployment_already_planned",reserveRewardDeploymentIntent({ campaignId:campaign(1).id,actorUserId:id(4),idempotencyKey:'different-deployment-key',observedChainId:31337,pendingNonce:7n },rpc));
    const replayRole = JSON.parse(await query(`begin; alter role service_role bypassrls; set local role service_role;
      ${rpcSql('service_reserve_reward_deployment',{p_campaign_id:campaign(1).id,p_actor_user_id:id(4),p_idempotency_key:'deployment-plan-1',p_observed_chain_id:31337,p_pending_nonce:'7'})} rollback;`));
    assert.equal(replayRole.intent.id,first.intentId);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
    await assert.rejects(query(`update app_private.reward_deployment_intents set nonce=100 where id=${literal(first.intentId)};`),{code:'reward_ledger_is_immutable'});
  });

  // This is deliberately a SQL structural/authorization fixture, NOT a valid
  // signature, a deployment or a broadcast. Real signed bytes are checked by the
  // chain/API integration test; SQL does not reimplement secp256k1 or keccak.
  const sqlAttempt = { schemaVersion:1,chainId:31337,operatorAddress:programmeInput.operatorAddress,nonce:'7',
    contractAddress:deploymentPlans.get(1).deployment.context.verifyingContract.toLowerCase(),transactionHash:`0x${'4'.repeat(64)}`,
    signedTransaction:'0x02aa',creationCodeHash:deploymentPlans.get(1).creationCodeHash,calldataHash:`0x${'5'.repeat(64)}`,
    gasLimit:'5000000',maxFeePerGas:'1000000000',maxPriorityFeePerGas:'100000000' };
  const attemptInput = { campaignId:campaign(1).id,actorUserId:id(4),intentId:deploymentPlans.get(1).intentId,idempotencyKey:'sql-attempt-01',attempt:sqlAttempt };
  let deploymentAttempt;
  await scenario("deployment attempts are append-only, idempotent and scoped; SQL validates the service witness", async () => {
    const unlock = await programmeLock(); const pending = Promise.all([storeRewardDeploymentAttempt(attemptInput,rpc),storeRewardDeploymentAttempt(attemptInput,rpc)]); pending.catch(()=>{});
    try { await waiting(2); } finally { await unlock(); }
    const [first,replay] = await pending; assert.deepEqual(first,replay); deploymentAttempt=first;
    const stored = await readRewardDeploymentAttempt({...attemptInput,attemptId:first.attemptId},rpc);
    assert.equal(stored.attempt.body.nonce,7n); assert.equal(stored.attempt.body.transactionHash,sqlAttempt.transactionHash);
    await rejectCode('reward_deployment_transaction_already_recorded',storeRewardDeploymentAttempt({...attemptInput,idempotencyKey:'duplicate-tx-key'},rpc));
    await rejectCode('reward_ledger_idempotency_conflict',storeRewardDeploymentAttempt({...attemptInput,attempt:{...sqlAttempt,maxFeePerGas:'2000000000'}},rpc));
    await rejectCode('reward_deployment_intent_mismatch',readRewardDeploymentAttempt({...attemptInput,campaignId:campaign(2).id,attemptId:first.attemptId},rpc));
    await rejectCode('reward_deployment_attempt_mismatch',readRewardDeploymentAttempt({...attemptInput,attemptId:id(99999)},rpc));
    for (const mutation of [a=>{a.nonce=7;},a=>{a.nonce='8';},a=>{a.chainId=10143;},a=>{a.operatorAddress=programmeInput.treasuryAddress;},
      a=>{a.extra='private data';},a=>{a.gasLimit='1.5';},a=>{a.creationCodeHash=`0x${'9'.repeat(64)}`;},a=>{a.signedTransaction='0x01aa';}]) {
      const body=structuredClone(sqlAttempt); mutation(body);
      await assert.rejects(query(rpcSql('service_record_reward_deployment_attempt',{p_campaign_id:campaign(1).id,p_actor_user_id:id(4),p_intent_id:first.intentId,
        p_idempotency_key:'invalid-sql-attempt',p_attempt:body})),{code:'invalid_reward_deployment_attempt'});
    }
    const args={p_campaign_id:campaign(1).id,p_actor_user_id:id(4),p_intent_id:first.intentId,p_idempotency_key:'sql-role-attempt',
      p_attempt:{...sqlAttempt,transactionHash:`0x${'6'.repeat(64)}`,maxFeePerGas:'2000000000'}};
    await query(`begin; alter role service_role bypassrls; set local role service_role; ${rpcSql('service_record_reward_deployment_attempt',args)} rollback;`);
    assert.equal(await scalar("select count(*) from app_private.reward_deployment_attempts"),1);
    await assert.rejects(query(`delete from app_private.reward_deployment_attempts where id=${literal(first.attemptId)};`),{code:'reward_ledger_is_immutable'});
  });

  // Like sqlAttempt above, this is synthetic structural evidence, not a mined
  // deployment. Real RPC/code/signature validation is the separate Anvil gate.
  const zeroHash=`0x${'0'.repeat(64)}`;
  const checkpointInput={campaignId:campaign(1).id,actorUserId:id(4),intentId:deploymentPlans.get(1).intentId,attemptId:deploymentAttempt.attemptId,
    idempotencyKey:'sql-checkpoint-01',deployment:{schemaVersion:1,chainId:31337,contractAddress:sqlAttempt.contractAddress,
      buildId:deploymentPlans.get(1).buildId,creationCodeHash:sqlAttempt.creationCodeHash,runtimeCodeHash:`0x${'a'.repeat(64)}`,
      deploymentTransactionHash:sqlAttempt.transactionHash,deploymentNonce:'7',deploymentBlockNumber:'100',deploymentBlockHash:`0x${'b'.repeat(64)}`},
    observation:{schemaVersion:1,finalizedBlock:{number:'200',hash:`0x${'c'.repeat(64)}`,timestamp:'1800000200'},
      accounting:{state:0,paused:false,accountedFunding:'0',treasuryReturned:'0',budgets:['0','0'],allocated:['0','0'],paid:['0','0'],nativeBalance:'100',
        entitlementCount:'0',uploadDigest:zeroHash,snapshotDigest:zeroHash,allocationDigest:zeroHash,activationNotBefore:'0',claimDeadline:'0',pausedAt:'0'}}};
  const checkpointSql=(body)=>rpcSql('service_record_reward_campaign_checkpoint',{p_campaign_id:body.campaignId,p_actor_user_id:body.actorUserId,
    p_intent_id:body.intentId,p_attempt_id:body.attemptId,p_idempotency_key:body.idempotencyKey,p_deployment:body.deployment,p_observation:body.observation});
  await scenario("verified registry and observations are immutable, private, exact-attempt-bound and concurrent-idempotent",async()=>{
    assert.equal(await readRewardCampaignCheckpoint({campaignId:campaign(1).id,actorUserId:id(4)},rpc),null);
    const unlock=await programmeLock(); const pending=Promise.all([storeRewardCampaignCheckpoint(checkpointInput,rpc),storeRewardCampaignCheckpoint(checkpointInput,rpc)]); pending.catch(()=>{});
    try {await waiting(2);} finally {await unlock();}
    const [first,replay]=await pending; assert.deepEqual(first,replay);
    assert.equal(await scalar('select count(*) from app_private.reward_verified_deployments'),1);
    assert.equal(await scalar('select count(*) from app_private.reward_campaign_observations'),1);
    assert.equal(first.observation.accounting.accountedFunding,0n); assert.equal(first.observation.accounting.nativeBalance,100n);
    assert.deepEqual(await readRewardCampaignCheckpoint({campaignId:campaign(1).id,actorUserId:id(4)},rpc),first);
    await rejectCode('reward_deployment_intent_mismatch',storeRewardCampaignCheckpoint({...checkpointInput,campaignId:campaign(2).id},rpc));
    await rejectCode('reward_verified_deployment_conflict',storeRewardCampaignCheckpoint({...checkpointInput,deployment:{...checkpointInput.deployment,runtimeCodeHash:`0x${'d'.repeat(64)}`}},rpc));
    await rejectCode('invalid_reward_campaign_checkpoint',storeRewardCampaignCheckpoint({...checkpointInput,deployment:{...checkpointInput.deployment,deploymentTransactionHash:`0x${'d'.repeat(64)}`}},rpc));
    await assert.rejects(query(`update app_private.reward_verified_deployments set contract_address=${literal(sqlAttempt.contractAddress)};`),{code:'reward_ledger_is_immutable'});
    await assert.rejects(query(`delete from app_private.reward_campaign_observations where id=${literal(first.observationId)};`),{code:'reward_ledger_is_immutable'});
    await query(`begin; alter role service_role bypassrls; set local role service_role; ${checkpointSql(checkpointInput)} rollback;`);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
  });
  await scenario("checkpoint history detects conflicting finality, regression and impossible accounting without turning surplus into deposits",async()=>{
    const next=structuredClone(checkpointInput); next.idempotencyKey='sql-checkpoint-02';
    next.observation.finalizedBlock={number:'201',hash:`0x${'d'.repeat(64)}`,timestamp:'1800000201'};
    next.observation.accounting.accountedFunding='40'; next.observation.accounting.nativeBalance='140';
    const second=await storeRewardCampaignCheckpoint(next,rpc); assert.equal(second.observation.accounting.accountedFunding,40n);
    const old=await storeRewardCampaignCheckpoint(checkpointInput,rpc); assert.equal(old.observation.finalizedBlock.number,200n);
    assert.equal((await readRewardCampaignCheckpoint({campaignId:campaign(1).id,actorUserId:id(4)},rpc)).observation.finalizedBlock.number,201n);
    await rejectCode('reward_campaign_checkpoint_regressed',storeRewardCampaignCheckpoint({...checkpointInput,idempotencyKey:'older-checkpoint'},rpc));
    await rejectCode('reward_ledger_idempotency_conflict',storeRewardCampaignCheckpoint({...next,idempotencyKey:checkpointInput.idempotencyKey},rpc));
    const conflict=structuredClone(next); conflict.idempotencyKey='conflicting-block'; conflict.observation.finalizedBlock.hash=`0x${'e'.repeat(64)}`;
    await rejectCode('reward_campaign_checkpoint_conflict',storeRewardCampaignCheckpoint(conflict,rpc));
    const regressed=structuredClone(next); regressed.idempotencyKey='regressed-funding'; regressed.observation.finalizedBlock.number='202';
    regressed.observation.finalizedBlock.timestamp='1800000202'; regressed.observation.accounting.accountedFunding='39';
    await rejectCode('reward_campaign_checkpoint_regressed',storeRewardCampaignCheckpoint(regressed,rpc));
    for(const mutation of [a=>{a.state=6;},a=>{a.nativeBalance='39';},a=>{a.paid=['1','0'];},a=>{a.budgets=['0','1'];},
      a=>{a.paused=true;},a=>{a.treasuryReturned='1';},a=>{a.accountedFunding=40;},a=>{a.extra='private identity';}]){
      const invalid=structuredClone(next); invalid.idempotencyKey='invalid-accounting'; mutation(invalid.observation.accounting);
      await assert.rejects(query(checkpointSql(invalid)),{code:'invalid_reward_campaign_accounting'});
    }
    const invalid=structuredClone(next); invalid.idempotencyKey='not-finalized-checkpoint'; invalid.observation.finalizedBlock.number='99';
    await assert.rejects(query(checkpointSql(invalid)),{code:'invalid_reward_campaign_checkpoint'});
    assert.equal(await scalar('select count(*) from app_private.reward_campaign_observations'),2);
  });

  const fundingCheckpoint=await readRewardCampaignCheckpoint({campaignId:campaign(1).id,actorUserId:id(4)},rpc);
  const fundingInput={campaignId:campaign(1).id,actorUserId:id(4),idempotencyKey:'funding-intent-01',observationId:fundingCheckpoint.observationId,observedChainId:31337,pendingNonce:0n};
  let fundingContext; let fundingAttempt;
  await scenario("funding rejects absent/old checkpoints and cross-programme deployment/funding reserve distinct shared nonces",async()=>{
    const old=await readRewardCampaignCheckpoint({campaignId:campaign(1).id,actorUserId:id(4),idempotencyKey:'sql-checkpoint-01'},rpc);
    await rejectCode('reward_funding_checkpoint_changed',reserveRewardFundingIntent({...fundingInput,observationId:old.observationId},rpc));
    await rejectCode('reward_funding_deployment_not_verified',reserveRewardFundingIntent({...fundingInput,campaignId:campaign(2).id},rpc));
    const changed=structuredClone(checkpointInput); changed.idempotencyKey='sql-checkpoint-before-funding';
    changed.observation.finalizedBlock={number:'202',hash:`0x${'e'.repeat(64)}`,timestamp:'1800000202'};
    changed.observation.accounting.accountedFunding='40'; changed.observation.accounting.nativeBalance='140';
    const releaseCorrection=await lock(checkpointSql(changed));
    const staleReservation=rejectCode('reward_funding_checkpoint_changed',reserveRewardFundingIntent(fundingInput,rpc)); staleReservation.catch(()=>{});
    try{await waiting(1);}finally{await releaseCorrection();}
    await staleReservation;
    fundingInput.observationId=(await readRewardCampaignCheckpoint({campaignId:campaign(1).id,actorUserId:id(4)},rpc)).observationId;
    await query(`begin; alter role service_role bypassrls; set local role service_role;
      ${rpcSql('service_reserve_reward_funding',{p_campaign_id:campaign(1).id,p_actor_user_id:id(4),p_idempotency_key:'role-new-funding-intent',
        p_observation_id:fundingInput.observationId,p_observed_chain_id:31337,p_pending_nonce:'0'})}
      set constraints all immediate; rollback;`);
    assert.equal(await scalar('select count(*) from app_private.reward_funding_intents'),0);
    assert.equal(await scalar('select count(*) from app_private.reward_operator_nonce_slots'),6);
    // Structural nonce-isolation fixture only, NOT an approved sporting programme.
    // Separate private namespace, same authorized organization/operator/chain.
    await query(`insert into app_private.reward_programmes(id,organization_id,league_season_id,environment,chain_id,round_ids,budget_wei,
      operator_user_id,operator_address,treasury_address,configuration,manifest_hash,created_by_user_id,idempotency_key,request_body)
      select ${literal(id(98701))},organization_id,${literal(id(98702))},environment,chain_id,round_ids,budget_wei,operator_user_id,operator_address,
      treasury_address,configuration,manifest_hash,created_by_user_id,'synthetic-nonce-namespace',request_body
      from app_private.reward_programmes where id=${literal(programme.programmeId)};
      insert into app_private.reward_campaigns(programme_id,scope_key,pot,round_ids,budget_wei)
      select ${literal(id(98701))},scope_key,pot,round_ids,budget_wei from app_private.reward_campaigns where programme_id=${literal(programme.programmeId)};`);
    const otherCampaign=await scalar(`select id from app_private.reward_campaigns where programme_id=${literal(id(98701))} and scope_key=${literal(id(101))}`);
    const unlock=await programmeLock();
    const pendingFunding=reserveRewardFundingIntent(fundingInput,rpc); pendingFunding.catch(()=>{});
    await waiting(1);
    const pendingDeployment=reserveRewardDeploymentIntent({campaignId:otherCampaign,actorUserId:id(4),idempotencyKey:'other-namespace-deploy',observedChainId:31337,pendingNonce:0n},rpc);
    pendingDeployment.catch(()=>{});
    try{await waiting(2);}finally{await unlock();}
    const [first,other]=await Promise.all([pendingFunding,pendingDeployment]); fundingContext=first;
    assert.deepEqual([first.intent.nonce,other.intent.nonce],[13n,14n]);
    assert.equal(first.intent.expectedBudget,campaign(1).budgetWei); assert.equal(first.intent.expectedAccountedFunding,40n);
    assert.equal(first.checkpoint.observation.accounting.nativeBalance,140n,'Forced surplus is not the explicit prior deposit');
    const retry=await reserveRewardFundingIntent({...fundingInput,pendingNonce:999n},rpc); assert.deepEqual(retry,first);
    assert.equal(await scalar('select count(*) from app_private.reward_operator_nonce_slots'),8);
    assert.equal(await scalar('select count(*) from app_private.reward_operator_nonce_slots where funding_intent_id is not null'),1);
    assert.equal(await scalar(`select nonce from app_private.reward_operator_nonce_slots where funding_intent_id=${literal(first.intent.id)}`),13);
    await rejectCode('reward_funding_already_planned',reserveRewardFundingIntent({...fundingInput,idempotencyKey:'different-funding-key'},rpc));
    await assert.rejects(query(`update app_private.reward_operator_nonce_slots set nonce=100 where funding_intent_id=${literal(first.intent.id)};`),{code:'reward_ledger_is_immutable'});
    await assert.rejects(query(`delete from app_private.reward_funding_intents where id=${literal(first.intent.id)};`),{code:'reward_ledger_is_immutable'});
    await assert.rejects(query(`delete from app_private.reward_operator_nonce_slots where funding_intent_id=${literal(first.intent.id)};`),{code:'reward_ledger_is_immutable'});
    await assert.rejects(query(`insert into app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,campaign_id)
      values(31337,${literal(programmeInput.operatorAddress)},987,${literal(campaign(1).id)});`),/check constraint/);
    await assert.rejects(query(`insert into app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,campaign_id,funding_intent_id)
      values(31337,${literal(programmeInput.operatorAddress)},987,${literal(campaign(1).id)},${literal(id(98999))});`),/foreign key constraint/);
  });
  const fundingBody={schemaVersion:1,action:'complete_funding',chainId:31337,operatorAddress:programmeInput.operatorAddress,
    nonce:fundingContext.intent.nonce.toString(),contractAddress:sqlAttempt.contractAddress,transactionHash:`0x${'e'.repeat(64)}`,signedTransaction:'0x02aa',
    buildId:fundingContext.checkpoint.deployment.buildId,calldataHash:`0x${'f'.repeat(64)}`,expectedAccountedFunding:'40',expectedBudget:campaign(1).budgetWei.toString(),
    value:(campaign(1).budgetWei-40n).toString(),gasLimit:'300000',maxFeePerGas:'1000000000',maxPriorityFeePerGas:'100000000'};
  const fundingAttemptInput={campaignId:campaign(1).id,actorUserId:id(4),intentId:fundingContext.intent.id,idempotencyKey:'funding-attempt-01',attempt:fundingBody};
  await scenario("funding intents keep historical pre-state and signed structural witnesses are immutable, scoped and retry-safe",async()=>{
    const unlock=await programmeLock(); const pending=Promise.all([storeRewardFundingAttempt(fundingAttemptInput,rpc),storeRewardFundingAttempt(fundingAttemptInput,rpc)]); pending.catch(()=>{});
    try{await waiting(2);}finally{await unlock();}
    const [first,replay]=await pending; assert.deepEqual(first,replay); fundingAttempt=first;
    const loaded=await readRewardFundingAttempt({...fundingAttemptInput,attemptId:first.attemptId},rpc);
    assert.equal(loaded.attempt.body.value,campaign(1).budgetWei-40n); assert.equal(loaded.attempt.body.nonce,13n);
    await rejectCode('reward_funding_transaction_already_recorded',storeRewardFundingAttempt({...fundingAttemptInput,idempotencyKey:'same-tx-other-key'},rpc));
    await rejectCode('reward_ledger_idempotency_conflict',storeRewardFundingAttempt({...fundingAttemptInput,attempt:{...fundingBody,maxFeePerGas:'2000000000'}},rpc));
    await rejectCode('reward_funding_intent_mismatch',readRewardFundingAttempt({...fundingAttemptInput,campaignId:campaign(2).id,attemptId:first.attemptId},rpc));
    for(const mutate of [a=>{a.nonce=13;},a=>{a.value='1';},a=>{a.expectedBudget='1';},a=>{a.expectedAccountedFunding='41';},a=>{a.action='upload';},
      a=>{a.contractAddress=programmeInput.treasuryAddress;},a=>{a.chainId=10143;},a=>{a.buildId='old';},a=>{a.extra='private';},a=>{a.signedTransaction='0x01aa';}]){
      const body=structuredClone(fundingBody); mutate(body);
      await assert.rejects(query(rpcSql('service_record_reward_funding_attempt',{p_campaign_id:campaign(1).id,p_actor_user_id:id(4),p_intent_id:fundingContext.intent.id,
        p_idempotency_key:'invalid-funding-witness',p_attempt:body})),{code:'invalid_reward_funding_attempt'});
    }
    const newer=structuredClone(checkpointInput); newer.idempotencyKey='sql-checkpoint-post-funding-plan';
    newer.observation.finalizedBlock={number:'203',hash:`0x${'f'.repeat(64)}`,timestamp:'1800000203'};
    newer.observation.accounting.accountedFunding='41'; newer.observation.accounting.nativeBalance='141';
    await storeRewardCampaignCheckpoint(newer,rpc);
    assert.deepEqual(await readRewardFundingContext({campaignId:campaign(1).id,actorUserId:id(4)},rpc),fundingContext,'Original pre-state stays historical; a live worker must reconcile the changed deposit');
    await query(`begin; alter role service_role bypassrls; set local role service_role;
      ${rpcSql('service_reserve_reward_funding',{p_campaign_id:campaign(1).id,p_actor_user_id:id(4),p_idempotency_key:fundingInput.idempotencyKey,
        p_observation_id:fundingInput.observationId,p_observed_chain_id:31337,p_pending_nonce:'0'})}
      ${rpcSql('service_record_reward_funding_attempt',{p_campaign_id:campaign(1).id,p_actor_user_id:id(4),p_intent_id:fundingContext.intent.id,
        p_idempotency_key:'role-new-funding-attempt',p_attempt:{...fundingBody,transactionHash:`0x${'9'.repeat(64)}`,maxFeePerGas:'2000000000'}})} rollback;`);
    assert.equal(await scalar('select count(*) from app_private.reward_funding_attempts'),1);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
  });

  const jobInput={campaignId:campaign(1).id,actorUserId:id(4),intentId:deploymentPlans.get(1).intentId,attemptId:deploymentAttempt.attemptId,idempotencyKey:'deployment-job-01'};
  let deploymentJob;
  await scenario("deployment queue keeps exact attempt identity and one concurrent job; leases fence stale workers",async()=>{
    const unlock=await programmeLock(); const pending=Promise.all([queueRewardDeploymentJob(jobInput,rpc),queueRewardDeploymentJob(jobInput,rpc)]); pending.catch(()=>{});
    try{await waiting(2);}finally{await unlock();}
    const[first,replay]=await pending; assert.deepEqual(first,replay); deploymentJob=first;
    assert.equal(first.state,'queued'); assert.equal(first.transactionHash,sqlAttempt.transactionHash);
    const leaseUnlock=await programmeLock();
    const leases=Promise.all([id(88001),id(88002)].map(workerId=>stepRewardDeploymentJob({jobId:first.jobId,actorUserId:id(4),workerId,leaseToken:null,action:'lease'},rpc))); leases.catch(()=>{});
    try{await waiting(2);}finally{await leaseUnlock();}
    const claimed=(await leases).filter(Boolean); assert.equal(claimed.length,1); const lease=claimed[0];
    const act=(action,token=lease.leaseToken,workerId=lease.leaseOwner)=>stepRewardDeploymentJob({jobId:first.jobId,actorUserId:id(4),workerId,leaseToken:token,action},rpc);
    assert.deepEqual(await act('lease',null),lease,'Repeated same-worker lease must not extend its expiry');
    await rejectCode('reward_deployment_job_lease_lost',act('arm',id(88999)));
    const armed=await act('arm'); assert.equal(armed.state,'broadcasting'); assert.equal(armed.mayHaveBroadcast,true);
    await query(`update app_private.reward_deployment_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(first.jobId)};`);
    const renewed=await stepRewardDeploymentJob({jobId:first.jobId,actorUserId:id(4),workerId:id(88003),leaseToken:null,action:'lease'},rpc);
    assert.equal(renewed.leaseGeneration,2); assert.notEqual(renewed.leaseToken,lease.leaseToken); assert.equal(renewed.mayHaveBroadcast,true);
    assert.equal(renewed.transactionHash,first.transactionHash); await rejectCode('reward_deployment_job_lease_lost',act('submitted'));
    const confirmed=await stepRewardDeploymentJob({jobId:first.jobId,actorUserId:id(4),workerId:id(88003),leaseToken:renewed.leaseToken,action:'confirm'},rpc);
    assert.equal(confirmed.state,'confirmed'); assert(confirmed.confirmationObservationId); assert.equal(confirmed.leaseToken,null);
    assert.equal((await readRewardDeploymentJob({jobId:first.jobId,actorUserId:id(4)},rpc)).state,'confirmed');
    await rejectCode('reward_deployment_job_already_queued',queueRewardDeploymentJob({...jobInput,idempotencyKey:'another-job-key'},rpc));
    await assert.rejects(query(`update app_private.reward_deployment_jobs set state='queued',confirmation_observation_id=null where id=${literal(first.jobId)};`),{code:'reward_job_identity_is_immutable'});
    assert.equal(await scalar(`select count(*) from app_private.reward_deployment_job_events where job_id=${literal(first.jobId)}`),5);
  });
  await scenario("unverified deployments cannot complete a job and actual service-role lease writes preserve grants",async()=>{
    const plan=deploymentPlans.get(2);
    const attempt=await storeRewardDeploymentAttempt({campaignId:campaign(2).id,actorUserId:id(4),intentId:plan.intentId,idempotencyKey:'second-job-attempt',
      attempt:{...sqlAttempt,nonce:plan.nonce.toString(),contractAddress:plan.deployment.context.verifyingContract.toLowerCase(),transactionHash:`0x${'7'.repeat(64)}`}},rpc);
    const job=await queueRewardDeploymentJob({campaignId:campaign(2).id,actorUserId:id(4),intentId:plan.intentId,attemptId:attempt.attemptId,idempotencyKey:'deployment-job-02'},rpc);
    const args={p_job_id:job.jobId,p_actor_user_id:id(4),p_worker_id:id(88004),p_lease_token:null,p_action:'lease'};
    const rolledBack=JSON.parse(await query(`begin; alter role service_role bypassrls; set local role service_role; ${rpcSql('service_step_reward_deployment_job',args)} rollback;`));
    assert.equal(rolledBack.leaseGeneration,1); assert.equal((await readRewardDeploymentJob({jobId:job.jobId,actorUserId:id(4)},rpc)).leaseGeneration,0);
    const lease=await stepRewardDeploymentJob({jobId:job.jobId,actorUserId:id(4),workerId:id(88004),leaseToken:null,action:'lease'},rpc);
    await rejectCode('reward_job_deployment_not_verified',stepRewardDeploymentJob({jobId:job.jobId,actorUserId:id(4),workerId:id(88004),leaseToken:lease.leaseToken,action:'confirm'},rpc));
    const foreignObservation=(await readRewardDeploymentJob({jobId:deploymentJob.jobId,actorUserId:id(4)},rpc)).confirmationObservationId;
    await assert.rejects(query(`update app_private.reward_deployment_jobs set state='confirmed',confirmation_observation_id=${literal(foreignObservation)},
      lease_owner=null,lease_token=null,lease_expires_at=null where id=${literal(job.jobId)};`),{code:'reward_job_deployment_not_verified'});
    const thirdPlan=deploymentPlans.get(3);
    const thirdAttempt=await storeRewardDeploymentAttempt({campaignId:campaign(3).id,actorUserId:id(4),intentId:thirdPlan.intentId,idempotencyKey:'third-job-attempt',
      attempt:{...sqlAttempt,nonce:thirdPlan.nonce.toString(),contractAddress:thirdPlan.deployment.context.verifyingContract.toLowerCase(),transactionHash:`0x${'8'.repeat(64)}`}},rpc);
    const thirdJob=await queueRewardDeploymentJob({campaignId:campaign(3).id,actorUserId:id(4),intentId:thirdPlan.intentId,attemptId:thirdAttempt.attemptId,idempotencyKey:'deployment-job-03'},rpc);
    const thirdLeaseInput={jobId:thirdJob.jobId,actorUserId:id(4),workerId:id(88005),leaseToken:null,action:'lease'};
    assert.equal(await stepRewardDeploymentJob(thirdLeaseInput,rpc),null,'A different campaign must not share an active operator lease');
    await query(`update app_private.reward_deployment_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(job.jobId)};`);
    assert.equal((await stepRewardDeploymentJob(thirdLeaseInput,rpc)).leaseGeneration,1);
    await query(`update app_private.reward_deployment_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(thirdJob.jobId)};`);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
  });

  const fundingJobs=await fundingJobScenarios({harness:databaseHarness,scenario,programmeLock,campaign:campaign(1),
    fundingContext,fundingAttempt,fundingBody,checkpointInput,sqlAttempt,roleBefore});

  const organizerSporting = await organizerSportingScenarios({harness:databaseHarness,scenario,programmeId:programme.programmeId,
    campaignId:campaign(1).id,emptyCampaignId:campaign(5).id});
  await scenario("coherent real SQL capture plus simultaneous same-key HTTP capture replay", async () => {
    const key = "concurrent-capture-01";
    const unlock = await lock(`select pg_advisory_xact_lock(hashtextextended(${literal(`${id(1)}:${id(4)}:${key}`)},0))`);
    const pending = Promise.all([capture(1, key), organizerSporting.capture(key)]); pending.catch(() => {});
    try { await waiting(2); } finally { await unlock(); }
    const [first, second] = await pending; assert.equal(first.snapshotId, second.snapshotId); assert.equal(first.capturedAt, second.capturedAt); snapshots.set(1, first);
    assert.equal(first.source.rows.length, 7);
    assert.equal(first.source.classifications.length, 7);
    assert.equal(await scalar("select count(*) from app_private.reward_source_snapshots"), 1);
  });

  await organizerSporting.inspect(snapshots.get(1).snapshotId);
  const organizerRecords = await organizerRecordScenarios({harness:databaseHarness,scenario,programmeId:programme.programmeId,
    campaignId:campaign(1).id,snapshotId:snapshots.get(1).snapshotId});
  await organizerRecords.inspect();

  let priorSnapshot;
  await scenario("independent older-season record capture, concurrent replay and real service-role grants", async () => {
    const unlock = await recordLock("prior-capture-01");
    const pending = Promise.all([priorCapture("prior-capture-01"), organizerRecords.capture("prior-capture-01")]); pending.catch(() => {});
    try { await waiting(2); } finally { await unlock(); }
    const [first, second] = await pending; assert.equal(first.snapshotId, second.priorSnapshotId); assert.equal(first.capturedAt, second.capturedAt); priorSnapshot = first;
    assert.equal(await scalar("select count(*) from app_private.reward_record_source_snapshots"), 1);
    assert.equal(first.source.rows.length, 6);
    assert.doesNotMatch(JSON.stringify(first.source), /dateOfBirth|birthYear|claimedBy|wallet|privateKey|email|representedClub/i);
    const candidate = await captureRewardRecordCandidate(session, { ...recordFixture().input, campaignId: campaign(1).id,
      targetSnapshotId: snapshots.get(1).snapshotId, idempotencyKey: "prior-capture-01" }, { ledgerRpc: rpc, recordRpc: rpc });
    assert.equal(candidate.baseline.finishTimeMs, 1800000n); assert.equal(Object.hasOwn(candidate.baseline, "approvalId"), false);
    const serviceCapture = JSON.parse(await query(`begin; alter role service_role bypassrls; set local role service_role;
      select public.service_capture_reward_record_source(${literal(campaign(1).id)},${literal(snapshots.get(1).snapshotId)},
        ${literal(id(4))},${literal(id(60001))},'service-role-record-01'); rollback;`));
    assert.deepEqual(serviceCapture.source, first.source);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
    assert.equal(await scalar("select count(*) from app_private.reward_record_source_snapshots"), 1);
    await rejectCode("reward_record_source_scope_mismatch", captureRewardRecordSource({ campaignId: campaign(0).id,
      targetSnapshotId: snapshots.get(1).snapshotId, priorRaceId: id(60001), actorUserId: id(4), idempotencyKey: "cross-campaign-record" }, rpc));
    await rejectCode("reward_record_source_scope_mismatch", readRewardRecordSource({ campaignId: campaign(1).id,
      priorRaceId: id(999999), actorUserId: id(4) }, rpc));
    await rejectCode("reward_operator_permission_required", readRewardRecordSource({ campaignId: campaign(1).id,
      priorRaceId: id(60001), actorUserId: id(5) }, rpc));
    await assert.rejects(query(`update app_private.reward_record_source_snapshots set source_body='{}' where id=${literal(first.snapshotId)};`),
      { code: "reward_source_snapshot_is_immutable" });
  });

  await scenario("prior publication correction while capture waits changes new evidence and retains its old immutable packet", async () => {
    const unlock = await recordLock("prior-corrected-01"); const pending = priorCapture("prior-corrected-01"); pending.catch(() => {});
    try { await waiting(1); await query(recordCorrectionSql()); } finally { await unlock(); }
    const fresh = await pending; assert.notEqual(fresh.sourceFingerprintSha256, priorSnapshot.sourceFingerprintSha256);
    assert.equal(fresh.source.publication.id, id(60008)); assert.deepEqual(await priorCapture("prior-capture-01"), priorSnapshot);
    const candidate = await captureRewardRecordCandidate(session, { ...recordFixture().input, campaignId: campaign(1).id,
      targetSnapshotId: snapshots.get(1).snapshotId, baselineSourceId: id(60120), idempotencyKey: "prior-corrected-01" }, { ledgerRpc: rpc, recordRpc: rpc });
    assert.equal(candidate.baseline.finishTimeMs, 1700000n);
    assert.equal(candidate.sourceReviewEndsAt, BigInt(Date.parse("2026-06-05T12:00:01Z") / 1000));
    assert.equal(await scalar("select count(*) from app_private.reward_allocations"), 0);
  });

  const recordHttpApproval = await organizerRecords.prepare(await priorCapture("prior-corrected-01"),0,"record-approve-01");
  let originalRecordApproval;
  await scenario("stored record approval concurrent HTTP/service replay, immutable revisions and actual service-role writes", async () => {
    const snapshot = await priorCapture("prior-corrected-01"); const unlock = await programmeLock();
    const pending = Promise.all([approve(snapshot, "record-approve-01"), recordHttpApproval.approve()]); pending.catch(() => {});
    try { await waiting(2); } finally { await unlock(); }
    const [first, second] = await pending; assert.equal(first.approvalId, second.approvalId); assert.equal(first.revision, second.revision); recordApproval = first; originalRecordApproval = first;
    assert.equal(first.revision, 1); assert.equal(first.body.baseline.finishTimeMs, 1700000n);
    const request = rewardRecordApprovalRequest({ ...first.body, targetSnapshotId: first.targetSnapshotId, priorSnapshotId: first.priorSnapshotId });
    const serviceResult = JSON.parse(await query(`begin; alter role service_role bypassrls; set local role service_role;
      with approved as (select public.service_approve_reward_record(${literal(campaign(1).id)},${literal(id(4))},
        ${literal(snapshot.snapshotId)},'service-role-approve',${literal(JSON.stringify(request))}::jsonb) as doc)
      select public.service_withdraw_reward_record(${literal(campaign(1).id)},${literal(id(4))},(doc->>'approvalId')::uuid,
        'service-role-withdraw','Synthetic rollback-only approval withdrawal') from approved; rollback;`));
    assert.equal(serviceResult.campaignId, campaign(1).id);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
    assert.equal(await scalar("select count(*) from app_private.reward_record_approvals"), 1);
    assert.equal(await scalar("select count(*) from app_private.reward_record_withdrawals"), 0);
    await assert.rejects(query(`update app_private.reward_record_approvals set request_body='{}' where id=${literal(first.approvalId)};`),
      { code: "reward_ledger_is_immutable" });
    await rejectCode("reward_record_approval_required", readRewardRecordApproval({ campaignId: campaign(2).id,
      actorUserId: id(4), approvalId: first.approvalId }, rpc));
  });

  await organizerRecords.approvalChecks(originalRecordApproval,recordHttpApproval);
  await scenario("superseded and omitted records fail; prior correction during allocation wait is rechecked", async () => {
    const snapshot = await priorCapture("prior-corrected-01"); const old = recordApproval; const unlock = await programmeLock();
    const pending = Promise.all([approve(snapshot, "record-successor-a"), approve(snapshot, "record-successor-b")]); pending.catch(() => {});
    try { await waiting(2); } finally { await unlock(); }
    const versions = (await pending).sort((a, b) => a.revision - b.revision);
    assert.deepEqual(versions.map((a) => a.revision), [2, 3]); recordApproval = versions[1];
    assert.deepEqual(await approve(snapshot, "record-approve-01"), old, "exact old approval replay is historical, not a new revision");
    await rejectCode("reward_record_approval_superseded", submit(1, snapshots.get(1), "old-record-review", reviewBody(1, old)));
    await rejectCode("reward_record_approval_omitted", submit(1, snapshots.get(1), "omit-record-review", reviewBody(1, null)));
    const recaptured = await capture(1, "recapture-cannot-hide-record");
    await rejectCode("reward_record_approval_omitted", submit(1, recaptured, "recaptured-omit-record", reviewBody(1, null)));
    const savedBody = reviewBody(1); const saved = await submit(1, snapshots.get(1), "record-before-correction", savedBody);
    const correctionUnlock = await programmeLock();
    const attempted = rejectCode("reward_record_source_changed", reserve(1, "record-stale-reserve", saved)); attempted.catch(() => {});
    try { await waiting(1); await query(recordCorrectionSql(2)); } finally { await correctionUnlock(); }
    await attempted; assert.equal(await scalar("select count(*) from app_private.reward_allocations"), 0);
    assert.deepEqual(await submit(1, snapshots.get(1), "record-before-correction", savedBody), saved);
    await rejectCode("reward_record_source_changed", approve(snapshot, "stale-new-approval"));
    const fresh = await priorCapture("prior-corrected-02"); recordApproval = await approve(fresh, "record-approve-02", id(60220));
    assert.equal(recordApproval.revision, 4); assert.equal(recordApproval.body.baseline.finishTimeMs, 1600000n);
  });

  await scenario("withdrawal committed while reservation waits blocks it; historical review is not renewed authority", async () => {
    const approved = recordApproval; const body = reviewBody(1);
    const saved = await submit(1, snapshots.get(1), "record-before-withdrawal", body);
    const input = withdrawal(approved, "record-withdraw-01");
    // Holder itself writes the withdrawal before the next transaction starts,
    // avoiding any assumption about PostgreSQL lock queue ordering.
    const unlock = await lock(`select public.service_withdraw_reward_record(${literal(input.campaignId)},${literal(id(4))},
      ${literal(input.approvalId)},${literal(input.idempotencyKey)},${literal(input.reason)})`);
    const pending = rejectCode("reward_record_approval_withdrawn", reserve(1, "withdrawn-reserve", saved)); pending.catch(() => {});
    try { await waiting(1); } finally { await unlock(); }
    await pending; assert.equal(await scalar("select count(*) from app_private.reward_allocations"), 0);
    assert.deepEqual(await submit(1, snapshots.get(1), "record-before-withdrawal", body), saved);
    await rejectCode("reward_record_approval_withdrawn", submit(1, snapshots.get(1), "new-withdrawn-review", body));
    const first = await withdrawApprovedRewardRecord(session, input, rpc);
    await organizerRecords.withdrawn(approved,input);
    assert.deepEqual(await withdrawApprovedRewardRecord(session, input, rpc), first);
    await rejectCode("reward_ledger_idempotency_conflict", withdrawApprovedRewardRecord(session, { ...input, reason: "Different synthetic reason" }, rpc));
    await rejectCode("reward_record_approval_already_withdrawn", withdrawApprovedRewardRecord(session, { ...input, idempotencyKey: "withdraw-new-key" }, rpc));
    await assert.rejects(query(`delete from app_private.reward_record_withdrawals where id=${literal(first.withdrawalId)};`), { code: "reward_ledger_is_immutable" });
    // Explicitly withdrawn evidence may now be absent. It does not revive an
    // older approval. A fresh operator approval is required to use the record.
    const noRecord = await submit(1, snapshots.get(1), "explicit-no-record-review", reviewBody(1, null)); assert.equal(noRecord.revision, 3);
    recordApproval = await approve(await priorCapture("prior-corrected-02"), "record-approve-03", id(60220));
    assert.equal(recordApproval.revision, 5);
  });

  const organizerSportingReview = await organizerSporting.prepare(snapshots.get(1).snapshotId, reviewBody(1), 3);
  await scenario("real stored context -> verified record -> calculator -> same-key HTTP/service reviewed revision under concurrency", async () => {
    const preview = await previewRewardSportingReview(session, { campaignId: campaign(1).id,
      snapshotId: snapshots.get(1).snapshotId, review: reviewBody(1) }, rpc);
    assert.equal(preview.selectedSourceIds.length, 6);
    assert.equal(preview.recordEvidence[0].approvalId, recordApproval.approvalId);
    assert.equal(preview.sourceReviewEndsAt, BigInt(Date.parse("2026-06-06T12:00:01Z") / 1000));
    assert.ok(preview.result.awards.some((row) => row.family === "record" && row.amountWei > 0n));
    assert.equal(preview.result.awards.reduce((sum, row) => sum + row.amountWei, preview.result.unallocatedWei), campaign(1).budgetWei);
    const unlock = await programmeLock();
    const pending = Promise.all([submit(1, snapshots.get(1), "same-review-key-01"), organizerSportingReview.submit()]); pending.catch(() => {});
    try { await waiting(2); } finally { await unlock(); }
    const [first, second] = await pending; assert.deepEqual(first, second); reviews.set(1, first);
    assert.equal(first.revision, 4);
  });

  const organizerPreparation = await organizerPreparationScenarios({harness:databaseHarness,scenario,programmeId:programme.programmeId,
    campaignId:campaign(1).id,emptyCampaignId:campaign(5).id,reviewId:reviews.get(1).reviewId});
  await scenario("same-key concurrent HTTP and service reservations produce one allocation and stable opaque entitlements", async () => {
    const unlock = await programmeLock();
    const pending = Promise.all([reserve(1, "same-reserve-key-01"), organizerPreparation.reserve()]); pending.catch(() => {});
    try { await waiting(2); } finally { await unlock(); }
    const [first, second] = await pending; assert.deepEqual(first, second); allocations.set(1, first);
    const before = await scalar(`select jsonb_agg(to_jsonb(e) order by id) from app_private.reward_entitlements e where allocation_id=${literal(first.allocationId)}`);
    assert.equal(before.length, 6); assert.deepEqual(await reserve(1, "same-reserve-key-01"), first);
    assert.deepEqual(await organizerPreparation.reserve(), first); await organizerPreparation.assertReserved();
    assert.deepEqual(await organizerSportingReview.submit(), reviews.get(1)); await organizerSportingReview.assertReserved(snapshots.get(1));
    assert.deepEqual(await scalar(`select jsonb_agg(to_jsonb(e) order by id) from app_private.reward_entitlements e where allocation_id=${literal(first.allocationId)}`), before);
    await rejectCode("reward_campaign_allocation_already_reserved", reserve(1, "changed-reserve-key-01"));
  });

  await scenario("private ledger to deterministic public upload, service-role grants and concurrent save replay", async () => {
    // Every role-simulation query rolls back, including its temporary Supabase
    // role flag. The application still computes the actual persisted payload.
    let attemptedSave;
    await prepareUpload(1, "role-only-upload", async (name, args) => {
      if (name === "service_save_reward_upload") attemptedSave = structuredClone(args);
      const data = JSON.parse(await query(`begin; alter role service_role bypassrls; set local role service_role; ${rpcSql(name, args)} rollback;`));
      return { data, error: null };
    });
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
    assert.equal(await scalar("select count(*) from app_private.reward_upload_packages"), 0);
    for (const change of [(args) => { args.p_upload.awards[0].amount = "1"; },
      (args) => { args.p_upload.profileId = id(1000); }, (args) => { args.p_upload.sourceReviewEndsAt = "1"; },
      (args) => { args.p_upload.awards[0].beneficiaryId = `0x${"f".repeat(64)}`; },
      (args) => { args.p_evidence.recordApprovals = []; }, (args) => { args.p_upload.awards.reverse(); }]) {
      const args = structuredClone(attemptedSave); change(args);
      const response = await rpc("service_save_reward_upload", args);
      assert.equal(response.error?.message, "invalid_reward_upload");
    }
    assert.equal(await scalar("select count(*) from app_private.reward_upload_packages"), 0);
    const unlock = await programmeLock();
    const pending = Promise.all([prepareUpload(1, "same-upload-key-01"), prepareUpload(1, "same-upload-key-01")]); pending.catch(() => {});
    try { await waiting(2); } finally { await unlock(); }
    const [first, second] = await pending; assert.deepEqual(first, second); uploads.set(1, first);
    assert.equal(await scalar("select count(*) from app_private.reward_upload_packages"), 1);
    const exported = await readRewardAllocationExport({ campaignId: campaign(1).id, actorUserId: id(4), allocationId: allocations.get(1).allocationId }, rpc);
    assert.equal(first.upload.snapshotDigest, commitPrivateRewardDocument("snapshot", exported.evidenceDocument, exported.allocation.snapshotSalt));
    assert.equal(first.upload.sourceReviewEndsAt, BigInt(Date.parse("2026-06-06T12:00:01Z") / 1000));
    assert.doesNotMatch(canonicalRewardJson(first.upload), /78000000-|sourceFingerprint|snapshotSalt|explanationSalt|evidenceId|claimedBy|email/);
    assert.equal(first.upload.awards.length, 6);
    assert.equal(first.upload.uploadDigest, rewardUploadDigest(first.upload.awards, 0, campaign(1).budgetWei).digest);
    assert.equal((await checkUpload(1)).sourceReviewEndsAt, first.upload.sourceReviewEndsAt);
    await rejectCode("reward_upload_already_prepared", prepareUpload(1, "different-upload-key"));
    await assert.rejects(query(`update app_private.reward_upload_packages set upload_body='{}' where id=${literal(first.uploadId)};`), { code: "reward_ledger_is_immutable" });
  });

  await organizerRecords.historical(originalRecordApproval);
  const lifecycle=await lifecycleIntentScenarios({harness:databaseHarness,scenario,programmeLock,campaign:campaign(1),preparedUpload:uploads.get(1),checkpointInput,roleBefore});
  const lifecycleJobs=await lifecycleJobScenarios({harness:databaseHarness,scenario,programmeLock,campaign:campaign(1),preparedUpload:uploads.get(1),lifecycle,checkpointInput,roleBefore});
  await operatorSessionScenarios({harness:databaseHarness,scenario,programmeId:programme.programmeId,campaign,deploymentPlans,lifecycleJobs,roleBefore});

  await scenario("post-reservation withdrawal blocks current upload evidence but preserves historical idempotency", async () => {
    const before = await scalar(`select jsonb_agg(to_jsonb(e) order by id) from app_private.reward_entitlements e where allocation_id=${literal(allocations.get(1).allocationId)}`);
    const lifecycleSlots=await scalar("select count(*) from app_private.reward_operator_nonce_slots");
    const input = withdrawal(recordApproval, "post-reservation-withdraw");
    const unlock = await lock(rpcSql("service_withdraw_reward_record", { p_campaign_id: input.campaignId, p_actor_user_id: id(4),
      p_approval_id: input.approvalId, p_idempotency_key: input.idempotencyKey, p_reason: input.reason }));
    const pending = rejectCode("reward_record_approval_withdrawn", checkUpload(1)); pending.catch(() => {});
    const lifecyclePending=rejectCode("reward_record_approval_withdrawn",reserveRewardLifecycleIntent({...lifecycle.input,idempotencyKey:"withdrawn-source-plan"},rpc));
    lifecyclePending.catch(()=>{});
    const armInput={jobId:lifecycleJobs.activationJob.jobId,actorUserId:id(4),workerId:lifecycleJobs.activationLease.leaseOwner,leaseToken:lifecycleJobs.activationLease.leaseToken,action:"arm"};
    const armPending=rejectCode("reward_record_approval_withdrawn",stepRewardLifecycleJob(armInput,rpc));armPending.catch(()=>{});
    try { await waiting(3); } finally { await unlock(); }
    await Promise.all([pending,lifecyclePending,armPending]);
    assert.equal((await readRewardLifecycleJob({jobId:armInput.jobId,actorUserId:id(4)},rpc)).mayHaveBroadcast,false);
    // Structural already-mined receipt fixture: source withdrawal must stop new
    // arm, but cannot erase observed history or prevent reconciliation.
    await stepRewardLifecycleJob({...armInput,action:"submitted"},rpc);
    assert.equal((await confirmRewardLifecycleJob(lifecycleJobs.activationConfirmation,rpc)).state,"confirmed");
    assert.equal(await scalar("select count(*) from app_private.reward_operator_nonce_slots"),lifecycleSlots);
    assert.equal((await reserveRewardLifecycleIntent(lifecycle.input,rpc)).intent.id,lifecycle.intentId,"Original preparation stays historical, not a send permit");
    assert.deepEqual(await prepareUpload(1, "same-upload-key-01"), uploads.get(1));
    assert.deepEqual(await reserve(1, "same-reserve-key-01"), allocations.get(1));
    assert.deepEqual(await submit(1, snapshots.get(1), "same-review-key-01"), reviews.get(1));
    await rejectCode("reward_campaign_allocation_already_reserved", approve(await priorCapture("prior-corrected-02"), "post-reservation-approval", id(60220)));
    assert.deepEqual(await scalar(`select jsonb_agg(to_jsonb(e) order by id) from app_private.reward_entitlements e where allocation_id=${literal(allocations.get(1).allocationId)}`), before);
  });

  await scenario("different review keys serialize revisions and superseded review cannot allocate", async () => {
    const snapshot = await capture(2, "round-two-capture-01"); snapshots.set(2, snapshot);
    const unlock = await programmeLock();
    const pending = Promise.all([submit(2, snapshot, "different-review-a"), submit(2, snapshot, "different-review-b")]); pending.catch(() => {});
    try { await waiting(2); } finally { await unlock(); }
    const versions = (await pending).sort((a, b) => a.revision - b.revision);
    assert.deepEqual(versions.map((v) => v.revision), [1, 2]); reviews.set(2, versions[1]);
    await rejectCode("reward_review_superseded", reserve(2, "old-review-reserve", versions[0]));
    const unlockAgain = await programmeLock();
    const attempts = Promise.allSettled([reserve(2, "different-reserve-a"), reserve(2, "different-reserve-b")]);
    try { await waiting(2); } finally { await unlockAgain(); }
    const outcomes = await attempts; assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(outcomes.find((r) => r.status === "rejected").reason.code, "reward_campaign_allocation_already_reserved");
    allocations.set(2, outcomes.find((r) => r.status === "fulfilled").value);
  });

  await scenario("a committed correction while reservation waits invalidates new allocation, preserving old evidence", async () => {
    const old = await capture(3, "round-three-old-source"); snapshots.set(3, old);
    reviews.set(3, await submit(3, old, "round-three-old-review"));
    const unlock = await programmeLock();
    const attempted = rejectCode("reward_review_source_changed", reserve(3, "round-three-stale-reserve")); attempted.catch(() => {});
    try { await waiting(1); await query(correctionSql(3)); } finally { await unlock(); }
    await attempted;
    assert.equal(await scalar(`select count(*) from app_private.reward_allocations where campaign_id=${literal(campaign(3).id)}`), 0);
    assert.deepEqual(await capture(3, "round-three-old-source"), old);
    const fresh = await capture(3, "round-three-new-source"); assert.notEqual(fresh.sourceFingerprintSha256, old.sourceFingerprintSha256);
    const review = reviewBody(3); const oldShortSources = new Set(old.source.rows.filter((r) => r.raceId === configuration.rounds[2].races[0].id).map((r) => r.id));
    const corrected = (sourceId) => oldShortSources.has(sourceId) ? id(Number(sourceId.slice(-12)) + 20000) : sourceId;
    review.roundReviews[0].memberships.forEach((row) => { row.sourceId = corrected(row.sourceId); });
    review.roundReviews[0].podiums.forEach((podium) => podium.entries.forEach((row) => { row.sourceId = corrected(row.sourceId); }));
    reviews.set(3, await submit(3, fresh, "round-three-new-review", review));
    allocations.set(3, await reserve(3, "round-three-new-reserve"));
  });

  await scenario("five race campaigns plus all-five-round league preserve unclaimed/ownerless liabilities", async () => {
    for (const n of [4, 5, 0]) {
      const snapshot = await capture(n, `final-capture-${n}`);
      reviews.set(n, await submit(n, snapshot, `final-review-${n}`)); allocations.set(n, await reserve(n, `final-reserve-${n}`));
    }
    assert.equal(allocations.size, 6);
    assert.equal([...allocations.values()].reduce((sum, row) => sum + row.allocatedWei + row.unallocatedWei, 0n), budgetWei);
    assert.equal(await scalar("select count(*) from app_private.reward_allocations"), 6);
    assert.equal(await scalar("select count(*) from app_private.reward_entitlements"), 37);
    assert.equal(await scalar("select count(*) from app_private.reward_source_reservations"), 115);
    assert.equal(await scalar(`select count(*) from public.athlete_profiles where id::text like '78000000-%' and (is_claimed or claimed_by_user_id is not null)`), 0);
    assert.equal(await scalar(`select count(*) from public.club_memberships where club_id=${literal(id(2000))} and status='active' and membership_role='owner'`), 0);
    const league = await scalar(`select allocation_body from app_private.reward_allocations where id=${literal(allocations.get(0).allocationId)}`);
    assert.equal(league.selectedSourceIds.length, 30);
    assert.equal(league.entitlements.find((row) => row.entityId === id(1004)).explanation.breakdown[0].calculation.weight, "25000");
    assert.equal(league.entitlements.find((row) => row.entityId === id(2000)).explanation.breakdown[0].calculation.weight, "25");
  });

  await scenario("all six native-token upload packages preserve distinct opaque identities and the complete budget", async () => {
    for (const n of [2, 3, 4, 5, 0]) uploads.set(n, await prepareUpload(n, `final-upload-${n}`));
    assert.equal(uploads.size, 6); assert.equal(await scalar("select count(*) from app_private.reward_upload_packages"), 6);
    assert.equal([...uploads.values()].reduce((total, row) => total + row.upload.budgets[row.upload.enabledPot], 0n), budgetWei);
    assert.equal(new Set([...uploads.values()].map((row) => row.upload.allocationDigest)).size, 6);
    assert.equal(new Set([...uploads.values()].map((row) => row.upload.snapshotDigest)).size, 6);
    assert.equal([...uploads.values()].reduce((total, row) => total + row.upload.awards.length, 0), 37);
    for (const n of [2, 3, 4, 5, 0]) assert.equal((await checkUpload(n)).allocationId, allocations.get(n).allocationId);
    await rejectCode("reward_allocation_reference_mismatch", readRewardAllocationExport({ campaignId: campaign(2).id,
      actorUserId: id(4), allocationId: allocations.get(1).allocationId }, rpc));
  });

  await scenario("target correction during a blocked upload-evidence check holds later use, not historical audit", async () => {
    const unlock = await programmeLock(); const pending = rejectCode("reward_review_source_changed", checkUpload(4)); pending.catch(() => {});
    try { await waiting(1); await query(correctionSql(4)); } finally { await unlock(); }
    await pending;
    await rejectCode("reward_review_source_changed", checkUpload(0));
    assert.deepEqual(await prepareUpload(4, "final-upload-4"), uploads.get(4));
    assert.equal(await scalar("select count(*) from app_private.reward_entitlements"), 37);
  });

  await walletScenarios({harness:databaseHarness,scenario,roleBefore,programmeId:programme.programmeId});
  await clubTreasuryScenarios({harness:databaseHarness,scenario,roleBefore});
  const clubReviews = await clubReviewScenarios({harness:databaseHarness,scenario,roleBefore,programmeId:programme.programmeId});

  await scenario("owner/operator revocation during blocked programme/capture/review/reservation/upload is rechecked after locks", async () => {
    const latestPrior = await priorCapture("prior-corrected-02");
    const unlock = await programmeLock();
    const captureUnlock = await lock(`select pg_advisory_xact_lock(hashtextextended(${literal(`${id(1)}:${id(4)}:concurrent-capture-01`)},0))`);
    const newCaptureUnlock = await lock(`select pg_advisory_xact_lock(hashtextextended(${literal(`${id(1)}:${id(4)}:revoked-new-capture`)},0))`);
    const creationUnlock = await lock(`select pg_advisory_xact_lock(hashtextextended(${literal(`reward-programme:${id(1)}`)},0))`);
    const recordUnlock = await recordLock("prior-capture-01");
    const snapshotCount = await scalar("select count(*) from app_private.reward_source_snapshots");
    const attempts = [
      clubReviews.startRevocationCheck(),
      rejectCode("reward_operator_permission_required", reserve(4, "final-reserve-4")),
      rejectCode("reward_source_permission_required", capture(1, "concurrent-capture-01")),
      rejectCode("reward_source_permission_required", capture(1, "revoked-new-capture")),
      rejectCode("reward_operator_permission_required", submit(1, snapshots.get(1), "same-review-key-01")),
      rejectCode("reward_programme_owner_required", createRewardProgramme(programmeInput, rpc)),
      rejectCode("reward_programme_owner_required", createRewardProgramme({ ...programmeInput, idempotencyKey: "revoked-new-programme" }, rpc)),
      rejectCode("reward_operator_permission_required", priorCapture("prior-capture-01")),
      rejectCode("reward_operator_permission_required", approve(latestPrior, "record-approve-03", id(60220))),
      rejectCode("reward_operator_permission_required", withdrawApprovedRewardRecord(session, withdrawal(recordApproval, "post-reservation-withdraw"), rpc)),
      rejectCode("reward_operator_permission_required", prepareUpload(5, "final-upload-5")),
      rejectCode("reward_operator_permission_required", checkUpload(5)),
      rejectCode("reward_operator_permission_required",reserveRewardDeploymentIntent({campaignId:campaign(1).id,actorUserId:id(4),idempotencyKey:'deployment-plan-1',observedChainId:31337,pendingNonce:7n},rpc)),
      rejectCode("reward_operator_permission_required",storeRewardDeploymentAttempt(attemptInput,rpc)),
      rejectCode("reward_operator_permission_required",storeRewardCampaignCheckpoint(checkpointInput,rpc)),
      rejectCode("reward_operator_permission_required",queueRewardDeploymentJob(jobInput,rpc)),
      rejectCode("reward_operator_permission_required",stepRewardDeploymentJob({jobId:deploymentJob.jobId,actorUserId:id(4),workerId:id(88001),leaseToken:null,action:'lease'},rpc)),
      rejectCode("reward_operator_permission_required",reserveRewardFundingIntent(fundingInput,rpc)),
      rejectCode("reward_operator_permission_required",storeRewardFundingAttempt(fundingAttemptInput,rpc)),
      rejectCode("reward_operator_permission_required",queueRewardFundingJob(fundingJobs.input,rpc)),
      rejectCode("reward_operator_permission_required",stepRewardFundingJob({jobId:fundingJobs.job.jobId,actorUserId:id(4),workerId:id(89001),leaseToken:null,action:'lease'},rpc)),
      rejectCode("reward_operator_permission_required",confirmRewardFundingJob(fundingJobs.confirmation,rpc)),
      rejectCode("reward_operator_permission_required",reserveRewardLifecycleIntent(lifecycle.input,rpc)),
      rejectCode("reward_operator_permission_required",storeRewardLifecycleAttempt(lifecycle.attemptInput,rpc)),
      rejectCode("reward_operator_permission_required",queueRewardLifecycleJob(lifecycleJobs.activateInput,rpc)),
      rejectCode("reward_operator_permission_required",stepRewardLifecycleJob({jobId:lifecycleJobs.activationJob.jobId,actorUserId:id(4),workerId:id(90006),leaseToken:null,action:"lease"},rpc)),
      rejectCode("reward_operator_permission_required",confirmRewardLifecycleJob(lifecycleJobs.activationConfirmation,rpc)),
    ];
    attempts.forEach((attempt) => attempt.catch(() => {}));
    try {
      await waiting(27);
      await query(`select public.service_transfer_organization_ownership(${literal(id(1))},${literal(id(8))},${literal(id(9))},${literal(id(4))});`);
    } finally { await Promise.all([unlock(), captureUnlock(), newCaptureUnlock(), creationUnlock(), recordUnlock()]); }
    await Promise.all(attempts);
    await clubReviews.assertRevoked();
    await rejectCode("reward_operator_permission_required", reserve(4, "final-reserve-4"));
    await rejectCode("reward_operator_permission_required",readRewardDeploymentAttempt({...attemptInput,attemptId:deploymentAttempt.attemptId},rpc));
    await rejectCode("reward_operator_permission_required",readRewardCampaignCheckpoint({campaignId:campaign(1).id,actorUserId:id(4)},rpc));
    await rejectCode("reward_operator_permission_required",readRewardFundingContext({campaignId:campaign(1).id,actorUserId:id(4)},rpc));
    await rejectCode("reward_operator_permission_required",readRewardFundingAttempt({...fundingAttemptInput,attemptId:fundingAttempt.attemptId},rpc));
    await rejectCode("reward_operator_permission_required",readRewardFundingJob({jobId:fundingJobs.job.jobId,actorUserId:id(4)},rpc));
    await rejectCode("reward_operator_permission_required",readRewardLifecycleContext(lifecycle.scope,rpc));
    await rejectCode("reward_operator_permission_required",readRewardLifecycleAttempt({...lifecycle.scope,intentId:lifecycle.intentId,attemptId:lifecycle.savedAttempt.attemptId},rpc));
    await rejectCode("reward_operator_permission_required",readRewardLifecycleJob({jobId:lifecycleJobs.activationJob.jobId,actorUserId:id(4)},rpc));
    await rejectCode("reward_operator_permission_required", readRewardRecordApproval({ campaignId: campaign(1).id,
      actorUserId: id(4), approvalId: recordApproval.approvalId }, rpc));
    assert.equal(await scalar("select count(*) from app_private.reward_source_snapshots"), snapshotCount);
    assert.equal(await scalar("select count(*) from app_private.reward_programmes"), 2);
    assert.equal(await scalar("select count(*) from app_private.reward_allocations"), 6);
    assert.equal(await scalar("select count(*) from app_private.reward_entitlements"), 37);
  });
  await historicalSourceV3Scenarios({harness:databaseHarness,scenario});
  const approvalV3Fixture=await programmeApprovalV3Scenarios({harness:databaseHarness,scenario});
  await programmeDeploymentV3Scenarios({harness:databaseHarness,scenario,fixture:approvalV3Fixture});
  await programmeAttemptV3Scenarios({harness:databaseHarness,scenario,fixture:approvalV3Fixture});
  const finaleFixture = await finaleBindingV3Scenarios({harness:databaseHarness,scenario});
  await allocationApprovalV3Scenarios({harness:databaseHarness,scenario,fixture:finaleFixture,after:async({reader,chain,operator})=>{
    await nativeFinaleV3Scenarios({harness:databaseHarness,scenario,fixture:finaleFixture});
    await nativeContinuityV3Scenarios({harness:databaseHarness,scenario,fixture:finaleFixture});
    await leaguePolicyV3Scenarios({harness:databaseHarness,scenario,fixture:finaleFixture});
    await leaguePublicationV3Scenarios({harness:databaseHarness,scenario,fixture:finaleFixture});
    await finalAllocationV3Scenarios({harness:databaseHarness,scenario,fixture:finaleFixture,reader});
    await finalAllocationActionsV3Scenarios({harness:databaseHarness,scenario,fixture:finaleFixture,reader,chain,operator});
  }});
  // This fixture now deploys/funds a programme; run after legacy empty-registry checks.
  await syntheticPilotV3Scenarios({harness:databaseHarness,scenario});
  await privyTestnetPilotV3Scenarios({harness:databaseHarness,scenario});
  // V4 adds imported-source reviews; legacy fixtures above assert global empty/count boundaries.
  await sponsorAllocationV4Scenarios({harness:databaseHarness,scenario});
  assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
  console.log(`Reward real-database integration passed: ${passed} scenarios; actual overlapping backend locks; six immutable allocations.`);
} finally {
  // Never terminate other test/application backends. Each retained handle belongs
  // to a child spawned by this runner. Parent validator drops its scratch DB.
  await databaseHarness.close();
}
