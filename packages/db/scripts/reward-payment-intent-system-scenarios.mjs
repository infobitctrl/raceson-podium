import assert from "node:assert/strict";
import { prepareAthleteRewardPayment,recordSignedAthleteRewardPayment,loadVerifiedAthleteRewardPaymentAttempt } from "../../../apps/api/dist/features/rewards/athlete-payment-service.js";
import { readRewardAthletePaymentContext,reserveRewardAthletePaymentIntent,storeRewardAthletePaymentAttempt } from "../dist/rewards/index.js";
import { canonicalRewardJson,encodeRewardAthletePayment,verifySignedRewardAthletePayment } from "../../rewards-chain/dist/index.js";
import { literal } from "./reward-integration-fixture.mjs";
import { clubPaymentTestRelayer } from "./reward-club-payment-system-scenarios.mjs";

// Only the owning continuous rehearsal may call this. All signatures/evidence
// are synthetic; no public endpoints or environment-derived signing keys.
export async function paymentIntentSystemScenarios({harness,scenario,chain,identity,recipient,deps,config,renewed,observe,approveAdditional,programmeId}){
  const {query,scalar,rpc,rpcSql,lock,waiting}=harness;const request={claimIntentId:renewed.intentId,idempotencyKey:"payment-main-reservation",relayerAddress:chain.relayer.address};
  const reserve=(input=request,options=deps)=>prepareAthleteRewardPayment(identity,input,options);
  const fees={type:"eip1559",gas:500000n,maxFeePerGas:20000000000n,maxPriorityFeePerGas:100000000n};
  const count=()=>scalar("select count(*) from app_private.reward_athlete_payment_intents");
  let payment,attempt,signed,additionalPayments;
  await scenario("payment reservations require current dual approvals, separate EOA gas payer and fresh source/chain evidence",async()=>{
    await assert.rejects(prepareAthleteRewardPayment(recipient,request,deps),{code:"reward_claim_proof_scope_required"});
    await assert.rejects(prepareAthleteRewardPayment({...identity,sessionId:recipient.sessionId},request,deps),{code:"reward_account_session_required"});
    const unapproved=await scalar("select id from app_private.reward_athlete_claim_intents order by prepared_at,id limit 1");
    await assert.rejects(reserve({...request,claimIntentId:unapproved}),{code:"reward_payment_approvals_required"});
    for(const relayerAddress of [chain.operator.address,chain.treasury,renewed.claim.recipient])await assert.rejects(reserve({...request,relayerAddress}),{code:"reward_separate_relayer_required"});
    const reader={...chain.publicClient,getCode:async args=>args.address.toLowerCase()===chain.relayer.address.toLowerCase()?"0xef010000":chain.publicClient.getCode(args)};
    await assert.rejects(reserve(request,{...deps,reader}),{code:"reward_relayer_eoa_required"});
    for(const bad of [null,"0x0","unavailable"]){
      const malformed={...chain.publicClient,getCode:async args=>args.address.toLowerCase()===chain.relayer.address.toLowerCase()?bad:chain.publicClient.getCode(args)};
      await assert.rejects(reserve(request,{...deps,reader:malformed}),{code:"reward_relayer_eoa_required"});
    }
    const unavailable={...chain.publicClient,getCode:async args=>{if(args.address.toLowerCase()===chain.relayer.address.toLowerCase())throw new Error("synthetic private RPC detail");return chain.publicClient.getCode(args);}};
    await assert.rejects(reserve(request,{...deps,reader:unavailable}),{code:"reward_payment_observation_unavailable"});
    await assert.rejects(reserve(request,{...deps,reader:{...chain.publicClient,getChainId:async()=>143}}),{code:"reward_observed_chain_mismatch"});
    const witness=await observe();const direct={...request,relayerAddress:request.relayerAddress.toLowerCase(),observedChainId:31337,pendingNonce:0n,witness,observedAt:new Date().toISOString()};
    await assert.rejects(reserveRewardAthletePaymentIntent(identity,{...direct,observedAt:"2020-01-01T00:00:00Z"},rpc),{code:"reward_claim_observation_stale"});
    for(const mutate of [w=>{w.award.nonce++;},w=>{w.award.amount++;},w=>{w.observation.accounting.paused=true;},w=>{w.recipient=chain.treasury.toLowerCase();}]){
      const w=structuredClone(witness);mutate(w);await assert.rejects(reserveRewardAthletePaymentIntent(identity,{...direct,witness:w},rpc));
    }
    assert.equal(await count(),0);
    const release=await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update;
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
    const pending=assert.rejects(reserveRewardAthletePaymentIntent(identity,direct,rpc),{code:"reward_account_session_required"});pending.catch(()=>{});
    try{await waiting(1);}finally{await release();}await pending;
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)}`);
    assert.equal(await count(),0);
  });
  await scenario("concurrent payment retries own one immutable relayer nonce; distinct campaigns reserve separate slots",async()=>{
    const results=await Promise.all([reserve(),reserve()]);assert.deepEqual(results[0],results[1]);payment=results[0];
    assert.equal(payment.plan.nonce,0n);assert.equal(payment.plan.claim.nonce,renewed.claim.nonce);
    assert.deepEqual(await reserve(request,{...deps,reader:{}}),payment);
    await assert.rejects(reserve({...request,idempotencyKey:"conflicting-reservation"}),{code:"reward_payment_already_planned"});
    await assert.rejects(reserve({...request,relayerAddress:`0x${"ab".repeat(20)}`}),{code:"reward_payment_already_planned"});
    const more=[await approveAdditional(3),await approveAdditional(4)];
    // A genuine approved athlete claim uses the club-reserved lane through the
    // real reservation service. Roll back that temporary intent so subsequent
    // athlete worker scenarios retain their own unconsumed 0/1/2 nonce lane.
    assert.equal(await scalar("select count(*) from app_private.reward_relayer_nonce_slots where club_payment_intent_id is not null"),1);
    const sharedRpc=async(name,args)=>name==="service_reserve_reward_athlete_payment"
      ? {data:JSON.parse(await query(`begin; ${rpcSql(name,args)} set constraints all immediate; rollback;`)),error:null}
      : rpc(name,args);
    const shared=await reserve({...request,claimIntentId:more[0].intentId,relayerAddress:clubPaymentTestRelayer,idempotencyKey:"athlete-club-lane-rollback"},{...deps,rpc:sharedRpc});
    assert.equal(shared.plan.nonce,1n,"The club's nonce 0 is not reused by an athlete payment");
    assert.equal(await count(),1,"Cross-kind reservation rolled back without changing the existing athlete intent");
    assert.equal(await scalar("select count(*) from app_private.reward_relayer_nonce_slots"),2);
    const prepared=await Promise.all(more.map((claim,n)=>reserve({...request,claimIntentId:claim.intentId,idempotencyKey:`payment-other-${n}`})));
    additionalPayments=prepared;
    assert.deepEqual(prepared.map(p=>p.plan.nonce).sort(),[1n,2n]);assert.equal(await count(),3);
    assert.equal(await scalar("select count(*) from app_private.reward_relayer_nonce_slots where athlete_payment_intent_id is not null"),3);
    assert.equal(await scalar("select count(*) from app_private.reward_relayer_nonce_slots"),4,"Three athlete owners plus one club owner");
    assert.equal(await scalar("select count(*) from app_private.reward_operator_nonce_slots"),30);
    for(const table of ["reward_athlete_payment_intents","reward_relayer_nonce_slots"]){
      await assert.rejects(query(`update app_private.${table} set nonce=99`),{code:"reward_ledger_is_immutable"});
      await assert.rejects(query(`delete from app_private.${table}`),{code:"reward_ledger_is_immutable"});
    }
    // Composite back references reject orphan or mismatched owners at commit.
    await assert.rejects(query(`begin;insert into app_private.reward_relayer_nonce_slots(chain_id,relayer_address,nonce,athlete_payment_intent_id)
      values(31337,'0x${"ab".repeat(20)}',0,${literal(payment.paymentIntentId)});commit;`));
    await assert.rejects(query(`insert into app_private.reward_relayer_nonce_slots(chain_id,relayer_address,nonce,athlete_payment_intent_id)
      values(31337,${literal(chain.operator.address.toLowerCase())},999,${literal(payment.paymentIntentId)})`),{code:"reward_separate_relayer_required"});
    await assert.rejects(query(`insert into app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,campaign_id,deployment_intent_id)
      select chain_id,${literal(chain.relayer.address.toLowerCase())},999,campaign_id,id from app_private.reward_deployment_intents limit 1`),{code:"reward_separate_relayer_required"});
    const observed=await observe();const c=await readRewardAthletePaymentContext(identity,request,rpc);
    assert.equal(c.paymentIntent.recipientProofId,c.claimContext.proofs.find(p=>p.role==="recipient").proofId);
    assert.equal(c.paymentIntent.operatorProofId,c.claimContext.proofs.find(p=>p.role==="operator").proofId);
    signed=await chain.relayer.signTransaction({...encodeRewardAthletePayment(payment.plan),...fees});
    const verified=await verifySignedRewardAthletePayment(payment.plan,signed);
    const scope={claimIntentId:renewed.intentId,paymentIntentId:payment.paymentIntentId,idempotencyKey:"payment-main-attempt",signedTransaction:signed};
    // Exercise SQL directly: the repository decoder must not mask a missing
    // database size/type/even-byte guard. No malformed attempt may be saved.
    for(const raw of [null,{},"0x02","0x020","0x02gg","0x02AA",`0x02${"00".repeat(2049)}`]){
      const result=await rpc("service_record_reward_athlete_payment_attempt",{
        p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_claim_intent_id:renewed.intentId,
        p_payment_intent_id:payment.paymentIntentId,p_idempotency_key:"payment-invalid-envelope",
        p_attempt:{...JSON.parse(canonicalRewardJson(verified)),signedTransaction:raw},
        p_witness:JSON.parse(canonicalRewardJson(observed)),p_observed_at:new Date().toISOString()});
      assert.equal(result.error?.message,"invalid_reward_payment_attempt");
    }
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_attempts"),0);
    let lost=true;let sqlError=null;const uncertainRpc=async(name,args)=>{const result=await rpc(name,args);
      if(name==="service_record_reward_athlete_payment_attempt"){
        sqlError=result.error?.message??null;
        if(!result.error&&lost){lost=false;throw new Error("synthetic lost committed response");}
      }return result;};
    const outcome=await recordSignedAthleteRewardPayment(identity,scope,{...deps,rpc:uncertainRpc}).then(()=>null,error=>error);
    assert.equal(sqlError,null,"The synthetic attempt must commit before simulating a lost response");
    assert.equal(outcome?.code,"reward_ledger_unavailable");
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_attempts"),1);
    attempt=await recordSignedAthleteRewardPayment(identity,scope,{...deps,reader:{}});
    assert.equal(attempt.transactionHash,verified.transactionHash);assert.deepEqual(Object.keys(attempt).sort(),["attemptId","paymentIntentId","claimIntentId","recordedByUserId","recordedAt","transactionHash"].sort());
    const reads=await Promise.all([recordSignedAthleteRewardPayment(identity,scope,{...deps,reader:{}}),recordSignedAthleteRewardPayment(identity,scope,{...deps,reader:{}})]);
    assert.deepEqual(reads,[attempt,attempt]);
    for(const mutate of [a=>{a.nonce++;},a=>{a.authorizationNonce++;},a=>{a.operatorDigest=`0x${"ab".repeat(32)}`;},a=>{a.amount++;},a=>{a.extra=true;}]){
      const body=structuredClone(verified);mutate(body);
      await assert.rejects(storeRewardAthletePaymentAttempt(identity,{...scope,idempotencyKey:"payment-invalid-attempt",attempt:body,witness:observed,observedAt:new Date().toISOString()},rpc));
    }
    await assert.rejects(query("update app_private.reward_athlete_payment_attempts set recorded_at=clock_timestamp()"),{code:"reward_ledger_is_immutable"});
    await assert.rejects(query("delete from app_private.reward_athlete_payment_attempts"),{code:"reward_ledger_is_immutable"});
  });
  await scenario("private signed-payment reload detects body/context tampering; fresh variants recheck actual session after locks",async()=>{
    const lookup={claimIntentId:renewed.intentId,paymentIntentId:payment.paymentIntentId,attemptId:attempt.attemptId};
    const loaded=await loadVerifiedAthleteRewardPaymentAttempt(identity,lookup,config);
    assert.equal(loaded.verified.signedTransaction,signed);assert.deepEqual(loaded.plan,payment.plan);
    for(const mutate of [r=>{r.attempt.body.signedTransaction=`0x02${"11".repeat(200)}`;},r=>{r.attempt.body.calldataHash=`0x${"ab".repeat(32)}`;},
      r=>{r.context.paymentIntent.nonce="99";},r=>{r.context.paymentIntent.operatorProofId=r.context.paymentIntent.recipientProofId;},
      r=>{r.context.paymentIntent.chainWitness.observation.accounting.paused=true;},r=>{r.context.claimContext.proofs[0].signature=`0x${"ff".repeat(65)}`;},
      r=>{r.attempt.recordedByUserId=recipient.userId;},r=>{r.attempt.body.maxFeePerGas="1";}]){
      const rpcTampered=async(name,args)=>{const result=await rpc(name,args);if(name==="service_read_reward_athlete_payment_attempt"&&!result.error)mutate(result.data);return result;};
      await assert.rejects(loadVerifiedAthleteRewardPaymentAttempt(identity,lookup,{...config,rpc:rpcTampered}));
    }
    const higher=await chain.relayer.signTransaction({...encodeRewardAthletePayment(payment.plan),...fees,maxFeePerGas:30000000000n});
    const verified=await verifySignedRewardAthletePayment(payment.plan,higher);const witness=await observe();
    const direct={claimIntentId:renewed.intentId,paymentIntentId:payment.paymentIntentId,idempotencyKey:"payment-fee-variant",attempt:verified,witness,observedAt:new Date().toISOString()};
    const release=await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update;
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
    const pending=assert.rejects(storeRewardAthletePaymentAttempt(identity,direct,rpc),{code:"reward_account_session_required"});pending.catch(()=>{});
    try{await waiting(1);}finally{await release();}await pending;
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(identity.sessionId)}`);
    const variant={claimIntentId:renewed.intentId,paymentIntentId:payment.paymentIntentId,idempotencyKey:direct.idempotencyKey,signedTransaction:higher};
    const variants=await Promise.all([recordSignedAthleteRewardPayment(identity,variant,deps),recordSignedAthleteRewardPayment(identity,variant,deps)]);
    assert.deepEqual(variants[0],variants[1]);assert.notEqual(variants[0].transactionHash,attempt.transactionHash);
    await assert.rejects(recordSignedAthleteRewardPayment(identity,{...variant,idempotencyKey:"payment-main-attempt"},deps),{code:"reward_ledger_idempotency_conflict"});
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_attempts"),2);
    const roleBefore=await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
    const roleSigned=await chain.relayer.signTransaction({...encodeRewardAthletePayment(payment.plan),...fees,maxFeePerGas:40000000000n});
    const roleAttempt=await verifySignedRewardAthletePayment(payment.plan,roleSigned);
    const serviceResult=JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
      ${rpcSql("service_record_reward_athlete_payment_attempt",{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,
        p_claim_intent_id:renewed.intentId,p_payment_intent_id:payment.paymentIntentId,p_idempotency_key:"service-role-payment-rollback",
        p_attempt:JSON.parse(canonicalRewardJson(roleAttempt)),p_witness:JSON.parse(canonicalRewardJson(witness)),p_observed_at:new Date().toISOString()})}rollback;`));
    assert.equal(serviceResult.transactionHash,roleAttempt.transactionHash);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_payment_attempts"),2,"Service-role test insert rolled back");
    assert.equal(await chain.publicClient.getTransactionCount({address:chain.relayer.address}),0,"Persistence never broadcasts");
  });
  return{payment,attempt,signed,fees,additionalPayments};
}
