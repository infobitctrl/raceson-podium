import assert from "node:assert/strict";
import test from "node:test";
import { readRewardAthletePaymentContext,reserveRewardAthletePaymentIntent,readRewardAthletePaymentAttempt } from "../../../packages/db/dist/rewards/index.js";
import { prepareAthleteRewardPayment,recordSignedAthleteRewardPayment,loadVerifiedAthleteRewardPaymentAttempt } from "../dist/features/rewards/athlete-payment-service.js";
import { rewardId as id } from "./fixtures/reward-calculation.mjs";

const identity={userId:id(4),sessionId:id(99201)};
const input={claimIntentId:id(99301),paymentIntentId:id(99302),relayerAddress:`0x${"ab".repeat(20)}`,idempotencyKey:"payment-test"};
const config={chainId:31337,origin:"http://127.0.0.1:5173",reader:{},creationCode:"0x"};
test("payment requests reject malformed scope and retry keys before private IO",async()=>{
  let calls=0;const rpc=async()=>{calls++;throw new Error("not expected");};const deps={...config,rpc};
  await assert.rejects(prepareAthleteRewardPayment(identity,{...input,relayerAddress:"0x"},deps));
  await assert.rejects(prepareAthleteRewardPayment({...identity,sessionId:"invalid"},input,deps));
  await assert.rejects(recordSignedAthleteRewardPayment(identity,{...input,idempotencyKey:"tiny",signedTransaction:"0x"},deps));
  await assert.rejects(loadVerifiedAthleteRewardPaymentAttempt(identity,{...input,attemptId:"invalid"},deps));
  await assert.rejects(reserveRewardAthletePaymentIntent(identity,{...input,observedChainId:143,pendingNonce:0n,witness:{},observedAt:"invalid"},rpc));
  await assert.rejects(readRewardAthletePaymentAttempt(identity,{...input,attemptId:id(99303)},rpc),"Cannot select by both key and ID");
  assert.equal(calls,0);
});
test("payment repository freezes actual operator identity and claim scope before awaiting transport",async()=>{
  const actor={...identity};const request={...input};let params;
  const pending=readRewardAthletePaymentContext(actor,request,async(name,args)=>{
    assert.equal(name,"service_read_reward_athlete_payment_context");params=args;await Promise.resolve();
    return{data:null,error:{message:"reward_claim_proof_scope_required"}};
  });
  actor.userId=id(5);actor.sessionId=id(99202);request.claimIntentId=id(99304);
  await assert.rejects(pending,{code:"reward_claim_proof_scope_required"});
  assert.deepEqual(params,{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_claim_intent_id:input.claimIntentId});
});
test("payment transport preserves actionable bounded errors without private diagnostics",async()=>{
  for(const code of ["reward_account_session_required","reward_payment_approvals_required","reward_payment_already_planned",
    "reward_separate_relayer_required","reward_claim_observation_stale","reward_review_source_changed"]){
    await assert.rejects(readRewardAthletePaymentContext(identity,input,async()=>({data:null,error:{message:code}})),{code});
  }
  await assert.rejects(readRewardAthletePaymentContext(identity,input,async()=>({data:null,error:{message:"private signed bytes"}})),{code:"reward_ledger_store_failed"});
  await assert.rejects(readRewardAthletePaymentContext(identity,input,async()=>{throw new Error("private provider credentials");}),{code:"reward_ledger_unavailable"});
});
test("payment context decoder rejects incomplete or unexpected documents",async()=>{
  for(const data of [null,[],{}, {claimContext:{},paymentIntent:null}, {claimContext:{},paymentIntent:null,extra:true}]){
    await assert.rejects(readRewardAthletePaymentContext(identity,input,async()=>({data,error:null})));
  }
});
