import assert from "node:assert/strict";
import test from "node:test";
import { readRewardAthleteClaimProofs,storeRewardAthleteClaimProof } from "../../../packages/db/dist/rewards/index.js";
import { submitAthleteRewardClaimProof } from "../dist/features/rewards/athlete-claim-proof-service.js";
import { rewardId as id } from "./fixtures/reward-calculation.mjs";

const identity={userId:id(4),sessionId:id(99201)};
const input={intentId:id(99301),role:"operator"};
test("claim proof scope and malformed requests fail before private RPC",async()=>{
  let calls=0;const rpc=async()=>{calls++;throw new Error("not expected");};
  await assert.rejects(readRewardAthleteClaimProofs(identity,{...input,role:"admin"},rpc));
  await assert.rejects(readRewardAthleteClaimProofs({...identity,sessionId:"invalid"},input,rpc));
  await assert.rejects(submitAthleteRewardClaimProof(identity,{...input,signature:"0x",idempotencyKey:"tiny"},
    {chainId:31337,origin:"http://127.0.0.1:5173",rpc,reader:{},creationCode:"0x"}),{code:"invalid_reward_claim_proof_request"});
  await assert.rejects(storeRewardAthleteClaimProof(identity,{...input,idempotencyKey:"proof-input",proof:{},witness:{},observedAt:new Date().toISOString()},rpc));
  assert.equal(calls,0);
});
test("claim proof transport freezes actual actor and requested role without borrowing operator identity",async()=>{
  const actor={...identity};const request={...input};let args;
  const pending=readRewardAthleteClaimProofs(actor,request,async(name,params)=>{
    assert.equal(name,"service_read_reward_athlete_claim_proofs");args=params;
    await Promise.resolve();return {data:null,error:{message:"reward_claim_proof_scope_required"}};
  });
  actor.userId=id(5);actor.sessionId=id(99202);request.intentId=id(99302);request.role="recipient";
  await assert.rejects(pending,{code:"reward_claim_proof_scope_required"});
  assert.deepEqual(args,{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_intent_id:input.intentId,p_role:input.role});
});
test("claim proof errors preserve bounded authorization codes without exposing private diagnostics",async()=>{
  for(const code of ["reward_account_session_required","reward_claim_readiness_required","reward_claim_not_live","reward_review_source_changed"]){
    await assert.rejects(readRewardAthleteClaimProofs(identity,input,async()=>({data:null,error:{message:code}})),{code});
  }
  await assert.rejects(readRewardAthleteClaimProofs(identity,input,async()=>({data:null,error:{message:"private database signature details"}})),{code:"reward_ledger_store_failed"});
  await assert.rejects(readRewardAthleteClaimProofs(identity,input,async()=>{throw new Error("private RPC credentials");}),{code:"reward_ledger_unavailable"});
});
test("claim proof response decoder refuses incomplete or extra-field contexts",async()=>{
  for(const data of [null,[],{}, {actorUserId:identity.userId,role:"operator",privateKey:"synthetic-forbidden-field"}]){
    await assert.rejects(readRewardAthleteClaimProofs(identity,input,async()=>({data,error:null})));
  }
});
