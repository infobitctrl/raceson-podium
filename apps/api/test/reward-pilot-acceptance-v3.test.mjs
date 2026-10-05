import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { decodePilotChangeV3, decodePilotViewV3, pilotDraftIdV3 } from "../../../packages/domain/dist/rewards/pilot-acceptance-v3.js";
import { dispatchPilotAcceptanceV3 } from "../dist/routes/rewards/pilot-acceptance-v3.js";
const fixture=()=>({schema:"raceson-pilot-acceptance-v3",chainId:10143,draftId:pilotDraftIdV3,round:2,viewHash:"a".repeat(64),
  campaignAddress:"0x"+"1".repeat(40),budgetWei:"10000000000000000000",allocatedWei:"100",unallocatedWei:"9999999999999999900",
  awardCount:14,athleteAmountWei:"10",recipientAddress:"0x"+"2".repeat(40),reviewSeconds:0,nextAction:"review_results",held:false,
  waitingForConsent:false,expired:false,steps:[],recipientConsented:false,operatorApproved:false,paid:false,claimExpiresAt:null,
  paymentTransactionHash:null,claimId:null,maximumActionGasWei:"0"});
test("pilot view is exact, private-field rejecting, conservative and non-mutating",()=>{
  const value=Object.freeze(fixture());assert.deepEqual(decodePilotViewV3(value,2),value);
  for(const patch of [{chainId:143},{round:1},{draftId:"wrong"},{privateKey:"hidden"},{budgetWei:"100"},{paid:true},
    {unallocatedWei:"0"},{reviewSeconds:86400},{nextAction:"fund"},{steps:[{action:"pay",state:"confirmed",transactionHash:null}]}])
    assert.throws(()=>decodePilotViewV3({...fixture(),...patch},2));
});
test("pilot command cannot select a recipient, budget, key, network, SQL or clock",()=>{
  const valid={action:"activate",viewHash:"b".repeat(64)};assert.deepEqual(decodePilotChangeV3(valid),valid);
  for(const patch of [{recipient:"0x00"},{chainId:143},{value:"1000"},{command:"sh"},{action:"deploy"},{viewHash:""}])
    assert.throws(()=>decodePilotChangeV3({...valid,...patch}));
});
async function dispatch(options={}){
  const response=new EventEmitter(),calls=[];
  const req={method:options.method??"GET",headers:{host:"127.0.0.1:3102",origin:"http://127.0.0.1:3102",...options.headers},
    socket:{remoteAddress:options.remote??"127.0.0.1"}};
  const runner=async(identity,round,change)=>{calls.push({identity,round,change});if(options.failure)throw Error(options.failure);return {...fixture(),round};};
  const handled=await dispatchPilotAcceptanceV3(req,response,new URL(`http://127.0.0.1:3102/api/v1/organizer/rewards/local-pilot/${options.round??2}`+(options.query??"")),{
    config:()=>({chainId:options.chainId??10143}),requireIdentity:async()=>{if(options.auth)throw Error(options.auth);return{userId:"request-user",sessionId:"request-session"};},
    applyPrivateSessionHeaders:()=>response.private=true,readJsonBody:async()=>options.body,
    sendSuccess:(_,data)=>Object.assign(response,{status:200,data}),sendError:(_,status,code)=>Object.assign(response,{status,code}),
  },options.disabled?undefined:runner);
  return{response,calls,handled};
}
test("round four uses its own bounded identity namespace; finale and league cannot use historical controls",async()=>{
  const {pilotIds,pilotDestination}=await import("../../../demo/rewards/scripts/privy-testnet-pilot-ui.mjs");
  const r=await dispatch({round:4});assert.equal(r.response.status,200);assert.equal(r.calls[0].round,4);
  assert.equal(pilotIds(4)(7),"9a000000-0000-4000-8000-000000824007");
  assert.equal(new Set([2,3,4].map(n=>pilotIds(n)(7))).size,3);
  assert.equal(pilotDestination(4),"c1862a98-70bb-42d7-9730-9e9ec00c0a61");
  for(const round of [2,3])assert.equal(pilotDestination(round),"38e853f6-21ca-4bc1-a46b-b0c5135cce4c");
  for(const round of [1,5,6,143]){
    assert.throws(()=>pilotIds(round));assert.throws(()=>decodePilotViewV3({...fixture(),round},round));
    const refused=await dispatch({round});assert.equal(refused.handled,false);assert.equal(refused.calls.length,0);
  }
});
test("unarmed, remote, forwarded, other-chain and cross-origin mutation requests never invoke the signer capability",async()=>{
  for(const options of [{disabled:true},{remote:"10.0.0.2"},{headers:{host:"www.raceson.com"}},{headers:{"x-forwarded-for":"10.0.0.1"}},
    {chainId:143},{method:"POST",headers:{origin:"https://evil.example"}}]){
    const r=await dispatch(options);assert.equal(r.response.status,404);assert.equal(r.calls.length,0);
  }
});
test("verified request identity is forwarded, private failures sanitized, stale view cannot run another action",async()=>{
  const r=await dispatch();assert.equal(r.response.status,200);assert.equal(r.response.private,true);
  assert.deepEqual(r.calls[0].identity,{userId:"request-user",sessionId:"request-session"});
  for(const auth of ["Unauthorized","Missing bearer token","reward_account_session_required"]){const v=await dispatch({auth});assert.equal(v.response.status,401);assert.equal(v.calls.length,0);}
  assert.equal((await dispatch({failure:"reward_planning_not_found"})).response.status,403);
  assert.equal((await dispatch({failure:"reward_pilot_changed"})).response.status,409);
  assert.equal((await dispatch({failure:"private secret"})).response.code,"reward_pilot_unavailable");
  assert.equal((await dispatch({method:"POST",body:{action:"pay",viewHash:"a".repeat(64),recipient:"bad"}})).response.status,400);
  assert.equal((await dispatch({query:"?chainId=143"})).response.status,400);
});
test("operator child has fixed loopback capability, no athlete signer or borrowed organizer session",()=>{
  const text=readFileSync(new URL("../../../demo/rewards/scripts/privy-testnet-pilot-ui.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(text,/localOrganizer|signInWithPassword|generatePrivateKey|loadSigner\("athlete"\)/);
  assert.match(text,/view\.viewHash!==change\.viewHash/);assert.match(text,/view\.nextAction!==change\.action/);
  const adapter=readFileSync(new URL("../../../demo/rewards/web/server/local-pilot.ts",import.meta.url),"utf8");
  assert.match(adapter,/RACESON_REWARD_LOCAL_PILOT_SOURCE_SHA/);assert.doesNotMatch(adapter,/shell:|\.\.\.process\.env/);
});
test("receipt reconciliation cannot broadcast even when a caller supplies a sending function",async()=>{
  const {reconcilePilotLifecycle}=await import("../../../demo/rewards/scripts/privy-testnet-pilot-ui.mjs");
  let sends=0;const actor={userId:"actor",sessionId:"session"},scope={jobId:"original"};
  const result=await reconcilePilotLifecycle(actor,scope,{broadcast:()=>{sends++;}},async(a,s,deps)=>{
    assert.deepEqual(a,actor);assert.deepEqual(s,scope);
    assert.throws(()=>deps.broadcast("not-a-transaction"),/reward_pilot_receipt_only/);return{outcome:"confirmed"};
  });assert.equal(result.outcome,"confirmed");assert.equal(sends,0);
});
