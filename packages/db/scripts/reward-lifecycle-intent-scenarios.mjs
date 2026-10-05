import assert from "node:assert/strict";
import { readRewardLifecycleContext,reserveRewardLifecycleIntent,storeRewardLifecycleAttempt,readRewardLifecycleAttempt,readRewardCampaignCheckpoint,
  storeRewardCampaignCheckpoint } from "../dist/rewards/index.js";
import { literal } from "./reward-integration-fixture.mjs";
import { rewardId as id,rewardWire } from "../../../apps/api/test/fixtures/reward-calculation.mjs";

// Actual SQL/locks/roles, synthetic checkpoint and signature witnesses. Crypto
// and live canonical state are separately exercised by the continuous rehearsal.
export async function lifecycleIntentScenarios({harness,scenario,programmeLock,campaign,preparedUpload,checkpointInput,roleBefore}){
  const {query,scalar,rpc,rpcSql,waiting}=harness;const reject=(code,promise)=>assert.rejects(promise,{code});
  const scope={campaignId:campaign.id,actorUserId:id(4),uploadId:preparedUpload.uploadId};const upload=preparedUpload.upload;
  let context=await readRewardLifecycleContext(scope,rpc);const initial=structuredClone(context);
  const input={...scope,action:"upload_awards",idempotencyKey:"lifecycle-upload-01",observationId:context.checkpoint.observationId,observedChainId:31337,pendingNonce:0n};
  const reserveSql=body=>rpcSql("service_reserve_reward_lifecycle",{p_campaign_id:body.campaignId,p_actor_user_id:body.actorUserId,p_upload_id:body.uploadId,
    p_action:body.action,p_idempotency_key:body.idempotencyKey,p_observation_id:body.observationId,p_observed_chain_id:body.observedChainId,p_pending_nonce:body.pendingNonce.toString()});
  let attemptInput;let savedAttempt;
  await scenario("lifecycle intents bind one public-shaped package and reserve one shared nonce under competing retries",async()=>{
    assert.equal(context.intent,null);assert.equal(context.upload.body.allocationDigest,upload.allocationDigest);
    assert.doesNotMatch(JSON.stringify(rewardWire(context.upload.body)),/snapshotSalt|explanationSalt|entityId|evidence_body|email|claimedBy/);
    const slots=await scalar("select count(*) from app_private.reward_operator_nonce_slots");
    const next=BigInt(await scalar("select (max(nonce)+1)::text from app_private.reward_operator_nonce_slots"));
    await reject("reward_lifecycle_checkpoint_changed",reserveRewardLifecycleIntent({...input,observationId:id(99999)},rpc));
    await query(`create function app_private.test_fail_lifecycle_intent() returns trigger language plpgsql as $$ begin raise exception 'synthetic_lifecycle_insert_failure'; end $$;
      create trigger zzz_test_fail_lifecycle_intent after insert on app_private.reward_lifecycle_intents for each row execute function app_private.test_fail_lifecycle_intent();`);
    try{await reject("synthetic_lifecycle_insert_failure",query(reserveSql(input)));}
    finally{await query("drop trigger zzz_test_fail_lifecycle_intent on app_private.reward_lifecycle_intents; drop function app_private.test_fail_lifecycle_intent();");}
    assert.equal(await scalar("select count(*) from app_private.reward_operator_nonce_slots"),slots,"Failed intent rolls back its already-inserted slot");
    assert.equal(await scalar("select count(*) from app_private.reward_campaign_upload_bindings"),0,"Failed intent also rolls back its package binding");
    await query(`begin; alter role service_role bypassrls; set local role service_role; ${reserveSql(input)} rollback;`);
    assert.equal(await scalar("select count(*) from app_private.reward_lifecycle_intents"),0);
    assert.equal(await scalar("select count(*) from app_private.reward_campaign_upload_bindings"),0);
    assert.equal(await scalar("select count(*) from app_private.reward_operator_nonce_slots"),slots);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
    const unlock=await programmeLock();const pending=Promise.all([reserveRewardLifecycleIntent(input,rpc),reserveRewardLifecycleIntent(input,rpc)]);pending.catch(()=>{});
    try{await waiting(2);}finally{await unlock();}
    const[first,retry]=await pending;assert.deepEqual(first,retry);context=first;assert.equal(context.intent.nonce,next);
    assert.equal(context.intent.batchStart,0);assert.equal(context.intent.batchSize,6);
    assert.equal(await scalar("select count(*) from app_private.reward_operator_nonce_slots"),slots+1);
    const slot=await scalar(`select jsonb_build_object('intent',lifecycle_intent_id,'deployment',deployment_intent_id,'funding',funding_intent_id)
      from app_private.reward_operator_nonce_slots where nonce=${next} and chain_id=31337`);
    assert.deepEqual(slot,{intent:context.intent.id,deployment:null,funding:null});
    await query(`do $$ begin
      begin insert into app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,campaign_id)
        values(31337,${literal(context.deploymentContext.operatorAddress)},${next+1000n},${literal(campaign.id)});
        raise exception 'ownerless nonce slot allowed'; exception when check_violation then null; end;
      begin insert into app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,campaign_id,deployment_intent_id,lifecycle_intent_id)
        values(31337,${literal(context.deploymentContext.operatorAddress)},${next+1000n},${literal(campaign.id)},gen_random_uuid(),gen_random_uuid());
        raise exception 'two-owner nonce slot allowed'; exception when check_violation then null; end;
    end $$;`);
    await reject("reward_lifecycle_already_planned",reserveRewardLifecycleIntent({...input,idempotencyKey:"duplicate-slice-key"},rpc));
    await reject("reward_ledger_idempotency_conflict",reserveRewardLifecycleIntent({...input,action:"stage_allocation"},rpc));
    await reject("reward_lifecycle_prestate_mismatch",reserveRewardLifecycleIntent({...input,action:"stage_allocation",idempotencyKey:"incomplete-staging"},rpc));
    await reject("reward_upload_reference_mismatch",readRewardLifecycleContext({...scope,uploadId:id(99999)},rpc));
    await reject("reward_ledger_is_immutable",query("delete from app_private.reward_lifecycle_intents;"));
    await reject("reward_ledger_is_immutable",query("delete from app_private.reward_campaign_upload_bindings;"));
  });
  await scenario("lifecycle signed-attempt storage is scoped, private, immutable and exact-retry only",async()=>{
    const d=context.checkpoint.deployment;
    const body={schemaVersion:1,action:"upload_awards",chainId:31337,operatorAddress:context.deploymentContext.operatorAddress,nonce:context.intent.nonce,
      contractAddress:d.contractAddress,transactionHash:`0x${"a".repeat(64)}`,signedTransaction:"0x02aa",buildId:d.buildId,calldataHash:`0x${"b".repeat(64)}`,
      allocationDigest:upload.allocationDigest,batchStart:0,batchSize:6,value:0n,gasLimit:1000000n,maxFeePerGas:100n,maxPriorityFeePerGas:1n};
    attemptInput={...scope,intentId:context.intent.id,idempotencyKey:"lifecycle-attempt-01",attempt:body};
    const wire=rewardWire(body);
    const attemptSql=value=>rpcSql("service_record_reward_lifecycle_attempt",{p_campaign_id:scope.campaignId,p_actor_user_id:scope.actorUserId,p_upload_id:scope.uploadId,
      p_intent_id:context.intent.id,p_idempotency_key:attemptInput.idempotencyKey,p_attempt:value});
    for(const patch of [{value:"1"},{batchSize:5},{batchStart:null},{allocationDigest:`0x${"e".repeat(64)}`},{extra:true},{chainId:143},{gasLimit:"0"},
      {signedTransaction:`0x02${"aa".repeat(16385)}`},{nonce:"999"}])await reject("invalid_reward_lifecycle_attempt",query(attemptSql({...wire,...patch})));
    assert.equal(await scalar("select count(*) from app_private.reward_lifecycle_attempts"),0);
    await query(`begin; alter role service_role bypassrls; set local role service_role; ${attemptSql(wire)} rollback;`);
    assert.equal(await scalar("select count(*) from app_private.reward_lifecycle_attempts"),0);
    const unlock=await programmeLock();const pending=Promise.all([storeRewardLifecycleAttempt(attemptInput,rpc),storeRewardLifecycleAttempt(attemptInput,rpc)]);pending.catch(()=>{});
    try{await waiting(2);}finally{await unlock();}
    const[first,retry]=await pending;assert.deepEqual(first,retry);savedAttempt=first;
    assert.deepEqual((await readRewardLifecycleAttempt({...scope,intentId:context.intent.id,attemptId:first.attemptId},rpc)).attempt.body,body);
    await reject("reward_ledger_idempotency_conflict",storeRewardLifecycleAttempt({...attemptInput,attempt:{...body,gasLimit:2000000n}},rpc));
    await reject("reward_lifecycle_transaction_already_recorded",storeRewardLifecycleAttempt({...attemptInput,idempotencyKey:"another-attempt-key"},rpc));
    await reject("reward_ledger_is_immutable",query("delete from app_private.reward_lifecycle_attempts;"));
  });
  await scenario("complete upload and both activation clocks gate new nonces while original plans remain replayable",async()=>{
    let number=206n;
    const checkpoint=async(accounting,timestamp)=>{
      const observation=rewardWire(initial.checkpoint.observation);
      observation.finalizedBlock={number:String(number),hash:`0x${number.toString(16).padStart(64,"0")}`,timestamp:String(timestamp)};number++;
      Object.assign(observation.accounting,rewardWire(accounting));
      return storeRewardCampaignCheckpoint({...checkpointInput,idempotencyKey:`lifecycle-checkpoint-${number}`,observation},rpc);
    };
    const completed={entitlementCount:upload.entitlementCount,uploadDigest:upload.uploadDigest,allocated:upload.allocated};
    const full=await checkpoint(completed,1800000206n);
    await reject("reward_lifecycle_upload_complete",reserveRewardLifecycleIntent({...input,observationId:full.observationId,idempotencyKey:"extra-upload-slice"},rpc));
    const stagedIntent=await reserveRewardLifecycleIntent({...input,action:"stage_allocation",observationId:full.observationId,idempotencyKey:"lifecycle-stage-01"},rpc);
    assert.equal(stagedIntent.intent.batchStart,null);assert.equal(stagedIntent.intent.batchSize,null);assert.equal(stagedIntent.intent.nonce,context.intent.nonce+1n);
    const staged={...completed,state:2,snapshotDigest:upload.snapshotDigest,allocationDigest:upload.allocationDigest,activationNotBefore:1800086607n};
    const early=await checkpoint(staged,1800000207n);
    const activate={...input,action:"activate",idempotencyKey:"lifecycle-activate-01",observationId:early.observationId};
    const slots=await scalar("select count(*) from app_private.reward_operator_nonce_slots");
    await reject("reward_lifecycle_review_not_finished",reserveRewardLifecycleIntent(activate,rpc));
    assert.equal(await scalar("select count(*) from app_private.reward_operator_nonce_slots"),slots,"Early activation leaves no reserved nonce");
    const ready=await checkpoint(staged,1800086607n);
    const activatedIntent=await reserveRewardLifecycleIntent({...activate,observationId:ready.observationId},rpc);
    assert.equal(activatedIntent.intent.nonce,stagedIntent.intent.nonce+1n);
    assert.deepEqual(await reserveRewardLifecycleIntent({...input,observationId:ready.observationId,pendingNonce:999n},rpc),context);
    assert.deepEqual(await readRewardLifecycleContext({...scope,idempotencyKey:input.idempotencyKey},rpc),context);
    assert.equal((await readRewardCampaignCheckpoint({campaignId:scope.campaignId,actorUserId:scope.actorUserId},rpc)).observationId,ready.observationId);
  });
  return{input,attemptInput,savedAttempt,scope,intentId:context.intent.id};
}
