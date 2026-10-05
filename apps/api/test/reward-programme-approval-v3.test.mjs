import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultRewardProgrammeDraftV2 } from "../../../packages/domain/dist/rewards/programme-draft-v2.js";
import { decodeProgrammeApprovalV3, decodeProgrammeFundingTermsV3, programmeApprovalMissingSlotsV3 } from "../../../packages/domain/dist/rewards/programme-approval-v3.js";
import { dispatchProgrammeApprovalV3 } from "../dist/routes/rewards/programme-approval-v3.js";
const id=n=>`87000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const terms=()=>({funderAddress:`0x${"a".repeat(40)}`,operatorAddress:`0x${"b".repeat(40)}`,reviewPeriods:Array(6).fill(86400)});
function view() {
  const record={draftId:id(1),organizationId:id(2),seasonId:id(3),chainId:31337,organizationName:"Synthetic org",seasonName:"Synthetic season",
    revision:1,updatedAt:"2026-09-10T00:00:00Z",rules:createDefaultRewardProgrammeDraftV2()};
  const rounds=Array.from({length:5},(_,i)=>({id:id(10+i),editionId:id(20+i),slot:i+1,name:`Synthetic round ${i+1}`,date:"2026-10-03",status:"draft",
    races:[{id:id(30+i),competitionId:id(40),name:"Synthetic race",distanceMetres:"15000",publicationId:null,publicationState:null,resultCount:0}]}));
  return {schema:"raceson-programme-approval-v3",record,workspace:{draftId:id(1),revision:1,rulesRevision:1,catalogueHash:"a".repeat(64),boundCatalogueHash:"a".repeat(64),
    mapping:{version:2,leagueCategories:[],rounds:rounds.map(r=>({slot:r.slot,roundId:r.id,categories:[]}))},catalogue:{rounds,categories:[]}},
    contextHash:"c".repeat(64),approval:null,operationsEnabled:false};
}
const body=()=>({requestId:id(80),expectedApprovalId:null,contextHash:view().contextHash,terms:terms()});
const saved=(v=view(),b=body())=>({...v,approval:{id:b.requestId,rulesRevision:1,mappingRevision:1,contextHash:b.contextHash,terms:b.terms,approvedAt:"2026-09-10T00:01:00Z",current:v.contextHash===b.contextHash}});
async function request({method="GET",input=body(),query="",state=view(),result,authError,error,disabled=false}={}) {
  const calls=[],res={};
  const matched=await dispatchProgrammeApprovalV3({method},res,new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${id(1)}/funding-approval${query}`),{
    config:()=>disabled?null:{chainId:31337},requireIdentity:async()=>{if(authError)throw new Error(authError);return{userId:id(50),sessionId:id(51)}},
    readJsonBody:async()=>input,applyPrivateSessionHeaders:()=>{res.private=true},sendSuccess:(_,data)=>Object.assign(res,{status:200,data}),
    sendError:(_,status,code)=>Object.assign(res,{status,code}),rpc:async(name,args)=>{calls.push({name,args});return{data:name.includes("service_approve")?(result??saved(state,input)):state,error:error?{message:error}:null}},
  });return{res,calls,matched};
}
test("strict approval document preserves exact rules and five scopes, without execution permission",()=>{
  assert.deepEqual(decodeProgrammeApprovalV3(view()),view());assert.deepEqual(programmeApprovalMissingSlotsV3(view().workspace),[]);
  for(const mutate of[v=>v.operationsEnabled=true,v=>v.secret="no",v=>v.workspace.rulesRevision=2,v=>v.contextHash="invalid",v=>v.approval={...saved().approval,current:false}]){
    const v=view();mutate(v);assert.throws(()=>decodeProgrammeApprovalV3(v));
  }
  const partial=view();partial.workspace.mapping.rounds[4].roundId=null;assert.deepEqual(programmeApprovalMissingSlotsV3(partial.workspace),[5]);
});
test("nominated public addresses and six clocks reject malformed, same-address and out-of-range inputs",()=>{
  assert.deepEqual(decodeProgrammeFundingTermsV3({...terms(),funderAddress:`0x${"A".repeat(40)}`}),terms());
  for(const patch of[{funderAddress:"0x0"},{funderAddress:terms().operatorAddress},{operatorAddress:`0x${"0".repeat(40)}`},
    {reviewPeriods:[86400]},{reviewPeriods:[0,0,0,0,0,-1]},{reviewPeriods:[0,0,0,0,0,2592001]},{reviewPeriods:Array(6).fill("0")},
    {reviewPeriods:Array(6).fill(0.5)},{privateKey:"never accepted"}])assert.throws(()=>decodeProgrammeFundingTermsV3({...terms(),...patch}));
});
test("funding specification GET/POST retains live session, exact CAS and idempotency inputs",async()=>{
  const r=await request();assert.equal(r.res.status,200);assert.equal(r.res.private,true);assert.deepEqual(r.res.data,view());
  const w=await request({method:"POST"});assert.equal(w.res.status,200);assert.equal(w.calls.length,2);
  assert.deepEqual(w.calls[1],{name:"service_approve_reward_programme_v3",args:{p_actor_user_id:id(50),p_actor_session_id:id(51),p_chain_id:31337,p_draft_id:id(1),
    p_request_id:id(80),p_expected_approval_id:null,p_context_hash:body().contextHash,p_terms:terms()}});
  assert.equal(w.res.data.operationsEnabled,false);
});
test("missing scopes, stale rules and altered write receipts never produce approved funding",async()=>{
  const partial=view();partial.workspace.mapping.rounds[4].roundId=null;
  assert.equal((await request({method:"POST",state:partial})).res.code,"reward_programme_scope_incomplete");
  assert.equal((await request({method:"POST",input:{...body(),contextHash:"d".repeat(64)}})).res.code,"reward_planning_revision_changed");
  assert.equal((await request({method:"POST",result:saved(view(),{...body(),requestId:id(81)})})).res.code,"reward_programme_request_conflict");
  const old=saved();old.contextHash="d".repeat(64);old.approval.current=false;old.record.revision=2;old.workspace.rulesRevision=2;
  const retry=await request({method:"POST",state:old,result:old});assert.equal(retry.res.status,200);assert.equal(retry.res.data.approval.current,false);
});
test("approval rejects browser amount/signature/chain injection and unauthenticated requests",async()=>{
  for(const patch of[{chainId:1},{value:"100000"},{approved:true},{signedTransaction:"private"},{expectedApprovalId:undefined}]){
    const r=await request({method:"POST",input:{...body(),...patch}});assert.equal(r.res.status,400);assert.equal(r.calls.length,0);
  }
  for(const authError of["Missing bearer token","Untrusted browser origin"]){const r=await request({authError});assert.equal(r.res.status,authError.startsWith("Missing")?401:403);assert.equal(r.calls.length,0)}
  assert.equal((await request({query:"?chainId=1"})).res.status,400);
  for(const args of[{method:"DELETE"},{disabled:true}])assert.equal((await request(args)).matched,false);
});
test("approval errors are redacted and revoked sessions/roles fail closed",async()=>{
  for(const[error,status]of[["reward_account_session_required",401],["reward_planning_not_found",404],["reward_programme_request_conflict",409],["private credential-bearing error",503]]){
    const r=await request({error});assert.equal(r.res.status,status);assert.equal(r.res.data,undefined);assert.doesNotMatch(JSON.stringify(r.res),/credential-bearing/);
  }
});
