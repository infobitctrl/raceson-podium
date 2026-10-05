import { workflowHttpFixtureV3, athleteWorkflowTargetV3 } from "../../../apps/api/test/fixtures/reward-workflow-v3.mjs";
import { readWorkflowStatusV3 } from "../../../apps/api/dist/features/rewards/workflow-status-v3-service.js";
import assert from "node:assert/strict";
import { parseEther } from "viem";
import { fixtureSigner } from "../../rewards-chain/integration/owned-chain.mjs";
import { encodeRewardProgrammeAthletePaymentV3 } from "../../rewards-chain/dist/index.js";
import { paymentLedgerV3,readPaymentStatusV3,createPaymentOperatorClientV3,createPaymentSigningClientV3 } from "../dist/rewards/index.js";
import { preparePaymentV3,loadPaymentV3,recordPaymentAttemptV3,queuePaymentV3 } from "../../../apps/api/dist/features/rewards/athlete-payment-v3-service.js";
import { runPaymentJobV3 } from "../../../apps/api/dist/features/rewards/athlete-payment-worker-v3.js";
import { runAuthenticatedPaymentOperatorV3 } from "../../../apps/api/dist/features/rewards/athlete-payment-operator-v3.js";
import { programmeOperatorAuthFixtureV3 } from "../../../apps/api/test/fixtures/reward-programme-operator-v3.mjs";
import { dispatchPaymentActionsV3 } from "../../../apps/api/dist/routes/rewards/athlete-payment-actions-v3.js";
import { inspectPaymentSigningV3,signPaymentV3 } from "../../../apps/api/dist/features/rewards/athlete-payment-signing-v3.js";
import { literal as q } from "./reward-integration-fixture.mjs";
const id=n=>`8f400000-0000-4000-8000-${String(n).padStart(12,"0")}`;

// Only the parent's rollback-only database and fresh owned loopback Anvil.
// These synthetic identities/signers are never added to the saved demo.
export async function athletePaymentsV3Scenarios({query,rpc,scope,draftId,operator,athlete,other,runtime,deps,sourceHoldSql}) {
  assert.equal(await runtime.reader.getChainId(),31337);
  const s={...scope,paymentId:id(1)},relayer=fixtureSigner(0xFEED71),attemptId=id(2),jobId=id(3),workerId=id(4);
  await runtime.test.setBalance({address:relayer.address,value:parseEther("5")});
  const fees={gasLimit:"500000",maxFeePerGas:"30000000000",maxPriorityFeePerGas:"0",maxGasCostWei:"15000000000000000"};
  const denied=async(code,fn)=>{await query("savepoint payment_denied;");try{await assert.rejects(fn,{code});}finally{await query("rollback to savepoint payment_denied;");}};
  const held=async(fn)=>{await query(`savepoint payment_held;${sourceHoldSql??`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)};`}`);
    try{await fn();}finally{await query("rollback to savepoint payment_held;");}};
  const request={...s,relayerAddress:relayer.address,fees};
  const recipientScope={...scope,role:"recipient"},ownStatus=()=>readPaymentStatusV3(athlete,recipientScope,rpc);
  const http=async(who,body)=>{
    const res={headers:{}},reads=[],url=new URL(`${deps.origin}/api/v1/organizer/rewards/uploads/${s.uploadId}/destinations/${s.destinationId}/awards/${s.entitlementId}/claims/${s.claimId}/payment-actions/${s.paymentId}`);
    await query("savepoint payment_http;");
    assert.equal(await dispatchPaymentActionsV3({method:body===undefined?"GET":"POST"},res,url,{
      config:()=>deps,requireIdentity:async()=>who,readJsonBody:async()=>body,rpc:async(name,args)=>{reads.push(name);return rpc(name,args);},paymentReaderV3:runtime.reader,
      applyPrivateSessionHeaders:r=>{r.headers["Cache-Control"]="private, no-store";},sendSuccess:(r,data)=>{r.status=200;r.body=data;},
      sendError:(r,status,code)=>{r.status=status;r.body={code};},
    }),true);
    if(res.status!==200)await query("rollback to savepoint payment_http;");
    assert.match(res.headers["Cache-Control"],/no-store/);
    assert.doesNotMatch(JSON.stringify(res),/signature|signedTransaction|sessionId|leaseToken|EvidenceRef|dateOfBirth/);res.ledgerReadCount=reads.filter(name=>name==="service_read_reward_athlete_payment_v3").length;return res;
  };
  assert.equal((await ownStatus()).state,"not_prepared");
  await denied("reward_readiness_scope_required",()=>readPaymentStatusV3(other,recipientScope,rpc));
  const initialHttp=await http(operator);assert.equal(initialHttp.body.state,"not_prepared");
  assert.equal(initialHttp.ledgerReadCount,1,"unprepared GET performs one current scoped ledger read, not two");
  assert.equal((await http(other)).status,404);assert.equal((await http(athlete)).status,404);
  const beforePrepare=await paymentLedgerV3(operator,s,undefined,rpc);
  const prepareBody={kind:"prepare",relayerAddress:relayer.address.toLowerCase(),fees,
    recipientAddress:beforePrepare.claimContext.intent.recipientAddress,amountWei:beforePrepare.claimContext.intent.witness.amountWei.toString()};
  assert.equal((await http(operator,{...prepareBody,amountWei:"1"})).status,409);
  assert.equal((await http(operator,{...prepareBody,recipientAddress:relayer.address.toLowerCase()})).status,409);
  assert.equal((await http(operator,{...prepareBody,signedTransaction:"private"})).status,400);
  const preparedHttp=await http(operator,prepareBody);assert.equal(preparedHttp.status,200);assert.equal(preparedHttp.body.state,"prepared");
  assert.deepEqual((await http(operator,prepareBody)).body,preparedHttp.body);
  const prepared=await preparePaymentV3(operator,request,deps);assert.equal(prepared.state,"prepared");assert.equal(prepared.confirmed,false);
  assert.equal((await ownStatus()).state,"prepared");
  assert.deepEqual(await preparePaymentV3(operator,request,deps),prepared);
  await denied("reward_payment_conflict",()=>preparePaymentV3(operator,{...request,fees:{...fees,gasLimit:"499999"}},deps));
  await denied("reward_readiness_scope_required",()=>paymentLedgerV3(other,s,undefined,rpc));
  const loaded=await loadPaymentV3(operator,s,rpc),nonce=loaded.plan.nonce;
  assert.equal(nonce,0n);
  assert.equal(JSON.parse(await query(`select to_jsonb(count(*)) from app_private.reward_relayer_nonce_slots where athlete_payment_v3_id=${q(s.paymentId)};`)),1);
  const signedTransaction=await relayer.signTransaction({...encodeRewardProgrammeAthletePaymentV3(loaded.plan),type:"eip1559",
    gas:BigInt(fees.gasLimit),maxFeePerGas:BigInt(fees.maxFeePerGas),maxPriorityFeePerGas:0n});
  const signed={...s,attemptId,signedTransaction};
  await held(()=>denied("reward_claim_readiness_required",()=>recordPaymentAttemptV3(operator,signed,deps)));
  const signingAuth=programmeOperatorAuthFixtureV3(operator,rpc,createPaymentSigningClientV3),controller=new AbortController();
  const signingClient=signingAuth.clientFactory({target:signingAuth.target,...signingAuth.credentials,signal:controller.signal});
  const signingIdentity=(await signingClient.authenticate(signingAuth.credentials.accessToken,operator.userId)).identity;
  const signingDeps={...deps,rpc:signingClient.rpc},signingScope={...s,attemptId};
  const inspected=await inspectPaymentSigningV3(signingIdentity,signingScope,signingDeps);
  assert.equal(inspected.recorded,false);assert.equal(inspected.plan.recipientAddress,prepareBody.recipientAddress);
  assert.equal(inspected.plan.amountWei,prepareBody.amountWei);assert.doesNotMatch(JSON.stringify(inspected),/signature|signedTransaction|sessionId/);
  let keyReads=0,signs=0;
  const loadSigner=async()=>{keyReads++;return{address:relayer.address,signTransaction:async tx=>{signs++;return relayer.signTransaction(tx);}};};
  const signRequest={...signingScope,planHash:inspected.plan.planHash},signOptions={...signingDeps,signal:controller.signal,loadSigner};
  await assert.rejects(signPaymentV3(signingIdentity,{...signRequest,planHash:"0x"+"a".repeat(64)},signOptions),/reward_payment_signing_plan_changed/);
  assert.equal(keyReads,0);
  await assert.rejects(signPaymentV3(signingIdentity,signRequest,{...signOptions,loadSigner:async()=>{throw Error("private-key-sentinel");}}),
    {message:"reward_payment_signer_unavailable"});
  await assert.rejects(signPaymentV3(signingIdentity,signRequest,{...signOptions,loadSigner:async()=>({address:runtime.operator.address,signTransaction:()=>assert.fail("no signing")})}),
    /reward_payment_signer_mismatch/);
  const cancel=new AbortController();
  await assert.rejects(signPaymentV3(signingIdentity,signRequest,{...signOptions,signal:cancel.signal,loadSigner:async()=>{cancel.abort();return relayer;}}),/reward_payment_signing_stopped/);
  await query("savepoint signing_after_key;");
  await denied("reward_claim_readiness_required",()=>signPaymentV3(signingIdentity,signRequest,{...signOptions,loadSigner:async()=>{
    await query(`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)};`);return relayer;}}));
  await query("rollback to savepoint signing_after_key;");
  await denied("reward_account_session_required",()=>signPaymentV3(signingIdentity,signRequest,{...signOptions,loadSigner:async()=>{
    await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(operator.sessionId)};`);return relayer;}}));
  assert.equal(signs,0);
  const workflow=workflowHttpFixtureV3({identity:signingIdentity,rpc:signingDeps.rpc,reader:runtime.reader,loadSigner});
  try {
    const target=athleteWorkflowTargetV3(signingScope),inspect=await workflow.http('inspect',{target});
    assert.equal(inspect.status,200,inspect.code);assert.equal(inspect.data.plan.planHash,inspected.plan.planHash);
    const signedHttp=await workflow.http('sign',{target,planHash:inspected.plan.planHash});
    assert.equal(signedHttp.status,200,signedHttp.code);assert.equal(signedHttp.data.recorded,true);
    assert.deepEqual((await workflow.http('sign',{target,planHash:inspected.plan.planHash})).data,signedHttp.data);
  } finally {workflow.close();}
  const stored=await signPaymentV3(signingIdentity,signRequest,{...signOptions,loadSigner:()=>assert.fail('already signed by workflow')});assert.equal(stored.state,"signed");assert.equal(keyReads,1);assert.equal(signs,1);
  assert.deepEqual(await signPaymentV3(signingIdentity,signRequest,{...signOptions,reader:{},loadSigner:()=>assert.fail("no retry key read")}),stored);
  assert.equal((await inspectPaymentSigningV3(signingIdentity,signingScope,signingDeps)).plan.planHash,inspected.plan.planHash);
  controller.abort();
  assert.deepEqual(await recordPaymentAttemptV3(operator,signed,deps),stored);
  await denied("reward_payment_conflict",()=>recordPaymentAttemptV3(operator,{...signed,attemptId:id(9)},deps));
  const queue={...s,jobId,attemptId};
  await held(()=>denied("reward_claim_readiness_required",()=>queuePaymentV3(operator,queue,deps)));
  const queueBody={kind:"queue",jobId,attemptId,transactionHash:stored.transactionHash};
  assert.equal((await http(operator,{...queueBody,transactionHash:"0x"+"a".repeat(64)})).status,409);
  assert.equal((await paymentLedgerV3(operator,s,undefined,rpc)).job,null);
  const queuedHttp=await http(operator,queueBody);assert.equal(queuedHttp.status,200);assert.equal(queuedHttp.body.state,"queued");
  assert.deepEqual((await http(operator,queueBody)).body,queuedHttp.body);
  const queued=await queuePaymentV3(operator,queue,deps);assert.equal(queued.state,"queued");
  assert.equal((await ownStatus()).state,"queued");assert.equal((await ownStatus()).confirmed,false);
  assert.deepEqual(await queuePaymentV3(operator,queue,deps),queued);
  await denied("reward_payment_conflict",()=>queuePaymentV3(operator,{...queue,jobId:id(9)},deps));
  let sends=0;const input={...s,jobId,workerId},broadcast=async bytes=>{sends++;assert.equal(bytes,signedTransaction);
    await runtime.reader.sendRawTransaction({serializedTransaction:bytes});throw Error("synthetic_lost_payment_reply");};
  const work=(extra={})=>runPaymentJobV3(operator,input,{...deps,broadcast,...extra});
  const abort=new AbortController();abort.abort();assert.equal((await work({signal:abort.signal})).outcome,"cancelled");assert.equal(sends,0);
  await held(async()=>{assert.equal((await work()).outcome,"held");assert.equal(sends,0);});
  const leasePayload={jobId,workerId,leaseToken:null,execution:null,receipt:null,observedAt:null};
  const lease=await paymentLedgerV3(operator,s,{action:"lease",payload:leasePayload},rpc);assert.equal(lease.job.leaseGeneration,1);
  assert.equal(await paymentLedgerV3(operator,s,{action:"lease",payload:{...leasePayload,workerId:id(5)}},rpc),null);
  for(const kind of ["athlete","club","club-v3"])
    assert.equal(JSON.parse(await query(`select to_jsonb(app_private.reward_relayer_lane_busy(31337,${q(relayer.address.toLowerCase())},${q(kind)},${q(id(8))}));`)),true);
  assert.equal(JSON.parse(await query(`select to_jsonb(app_private.reward_relayer_lane_busy(31337,${q(relayer.address.toLowerCase())},'athlete-v3',${q(jobId)}));`)),false);
  await denied("reward_payment_lease_lost",()=>paymentLedgerV3(operator,s,{action:"submitted",payload:{...leasePayload,leaseToken:id(8)}},rpc));
  await denied("invalid_reward_payment_v3",()=>paymentLedgerV3(operator,s,{action:"confirm",payload:{...leasePayload,leaseToken:lease.job.leaseToken,receipt:{payment:{},accounting:{}}}},rpc));
  // Cancellation after the durable arm must still prevent a broadcast.
  const afterArm=new AbortController(),cancelRpc=async(name,args)=>{const r=await rpc(name,args);
    if(name==="service_change_reward_athlete_payment_v3" && args.p_action==="arm" && !r.error)afterArm.abort();return r;};
  assert.equal((await work({rpc:cancelRpc,signal:afterArm.signal})).outcome,"cancelled");assert.equal(sends,0);
  assert.equal((await paymentLedgerV3(operator,s,undefined,rpc)).job.mayHaveBroadcast,true);
  const providerUnavailable={...runtime.reader,getTransaction:async()=>{throw Error("provider_is_unavailable");}};
  assert.equal((await work({reader:providerUnavailable})).outcome,"unavailable");assert.equal(sends,0);
  // The real SDK verifies an in-memory synthetic Auth authority; its scoped
  // transport then calls the actual rollback-only SQL RPCs. No hosted login.
  const auth=programmeOperatorAuthFixtureV3(operator,rpc,createPaymentOperatorClientV3);
  assert.equal(deps.origin,auth.target.origin);
  const operatorInput={target:auth.target,...auth.credentials,draftId,
    programmeAddress:loaded.plan.expectation.programme.context.verifyingContract.toLowerCase(),
    operatorAddress:loaded.plan.expectation.programme.operatorAddress.toLowerCase(),relayerAddress:relayer.address.toLowerCase(),
    operatorUserId:operator.userId,workerId,durationMs:60000,maxGasCostWei:BigInt(fees.maxGasCostWei),maxPayoutWei:loaded.plan.claim.amount,
    jobs:[{uploadId:s.uploadId,destinationId:s.destinationId,entitlementId:s.entitlementId,claimId:s.claimId,paymentId:s.paymentId,attemptId,jobId,
      transactionHash:stored.transactionHash,recipientAddress:loaded.plan.claim.recipient.toLowerCase(),amountWei:loaded.plan.claim.amount.toString()}]};
  const deliver=(patch={})=>runAuthenticatedPaymentOperatorV3({...operatorInput,...patch},{reader:runtime.reader,broadcast},auth.clientFactory);
  const eventCount=()=>query(`select count(*) from app_private.reward_athlete_payment_events_v3 where job_id=${q(jobId)};`);
  const eventsBefore=await eventCount();
  for(const patch of [{maxGasCostWei:BigInt(fees.maxGasCostWei)-1n},{maxPayoutWei:loaded.plan.claim.amount-1n},
    {programmeAddress:'0x'+'a'.repeat(40)},{jobs:[{...operatorInput.jobs[0],amountWei:(loaded.plan.claim.amount+1n).toString()}]},
    {target:{...auth.target,origin:'http://127.0.0.1:3102'}}]){
    const r=await deliver(patch);assert.equal(r.stop,"attention_required");assert.equal(r.entries.length,0);assert.equal(sends,0);
  }
  assert.equal(await eventCount(),eventsBefore);
  const before=await runtime.reader.getBalance({address:loaded.plan.claim.recipient});
  const sent=await deliver();assert.equal(sent.stop,"deferred");assert.equal(sent.entries[0].outcome,"broadcast_unknown");assert.equal(sends,1);
  assert.equal(sent.verifiedPayoutWei,loaded.plan.claim.amount.toString());assert.equal(sent.verifiedGasCeilingWei,fees.maxGasCostWei);
  assert.doesNotMatch(JSON.stringify(sent),/accessToken|serverKey|sessionId|signedTransaction|signature|sb_secret/);
  const receipt=await runtime.reader.waitForTransactionReceipt({hash:stored.transactionHash});assert.equal(receipt.status,"success");
  await runtime.test.mine({blocks:96,interval:1});
  // A new source hold prevents NEW sends, but must not hide an already-paid award.
  await held(async()=>{assert.equal((await deliver()).stop,"jobs_confirmed");
    const paid=await paymentLedgerV3(operator,s,undefined,rpc);assert.equal(paid.job.state,"confirmed");assert.equal(paid.job.leaseToken,null);
    assert.equal(paid.receipt.payment.transactionHash,stored.transactionHash);
    const status=await ownStatus();assert.equal(status.confirmed,true);assert.equal(status.readinessHeld,true);
    const workflowStatus=await readWorkflowStatusV3(athlete,recipientScope,{rpc});
    assert.equal(workflowStatus.payment.verified,true);assert.equal(workflowStatus.readiness.current,false);
    assert.equal(workflowStatus.receipt.transactionHash,stored.transactionHash);assert.equal(workflowStatus.eligibility.claimable,false);
    assert.equal(status.transactionHash,stored.transactionHash);assert.equal(status.blockNumber,receipt.blockNumber.toString());
    assert.doesNotMatch(JSON.stringify(status),/signature|signedTransaction|session|leaseToken|EvidenceRef|dateOfBirth/);
    assert.equal((await work()).outcome,"confirmed");assert.equal(sends,1);});
  // Rollback above deliberately removed only SQL confirmation; recover again
  // from the same chain receipt with no additional transaction.
  assert.equal((await deliver()).stop,"jobs_confirmed");assert.equal(sends,1);
  assert.equal((await ownStatus()).readinessHeld,false);assert.equal((await ownStatus()).confirmed,true);
  assert.deepEqual(await readPaymentStatusV3(operator,scope,rpc),await ownStatus());
  assert.equal(await runtime.reader.getBalance({address:loaded.plan.claim.recipient}),before+loaded.plan.claim.amount);
  assert.equal(await runtime.reader.getTransactionCount({address:relayer.address}),Number(nonce)+1);
  const withoutChain=new Proxy({}, {get:()=>()=>{throw Error("confirmed_retry_must_not_observe_or_send");}});
  assert.equal((await work({reader:withoutChain,broadcast:withoutChain.send})).outcome,"confirmed");
  assert.equal(JSON.parse(await query(`select to_jsonb(count(*)) from app_private.reward_athlete_payment_receipts_v3 where payment_id=${q(s.paymentId)};`)),1);
  for(const table of ["reward_athlete_payments_v3","reward_athlete_payment_attempts_v3","reward_athlete_payment_receipts_v3","reward_athlete_payment_events_v3"]){
    await denied("reward_ledger_is_immutable",()=>query(`delete from app_private.${table};`));
  }
  for(const role of ["anon","authenticated"]){
    for(const table of ["reward_athlete_payments_v3","reward_athlete_payment_attempts_v3","reward_athlete_payment_jobs_v3","reward_athlete_payment_receipts_v3","reward_athlete_payment_events_v3"])
      assert.equal(JSON.parse(await query(`select to_jsonb(has_table_privilege('${role}','app_private.${table}','SELECT,INSERT,UPDATE,DELETE'));`)),false);
    assert.equal(JSON.parse(await query(`select to_jsonb(has_function_privilege('${role}','public.service_change_reward_athlete_payment_v3(uuid,uuid,integer,uuid,uuid,text,uuid,uuid,text,jsonb)','EXECUTE'));`)),false);
    assert.equal(JSON.parse(await query(`select to_jsonb(has_function_privilege('${role}','public.service_read_reward_payment_status_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text)','EXECUTE'));`)),false);
  }
  await query(`savepoint payment_recipient_session;update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(athlete.sessionId)};`);
  await denied("reward_account_session_required",()=>ownStatus());await query("rollback to savepoint payment_recipient_session;");
  await query(`savepoint payment_session;update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(operator.sessionId)};`);
  await denied("reward_account_session_required",()=>work());await query("rollback to savepoint payment_session;");
}
