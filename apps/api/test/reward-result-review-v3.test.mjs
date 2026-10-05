import assert from "node:assert/strict";
import test from "node:test";
import { decodeRewardResultReviewV3 } from "../../../packages/domain/dist/rewards/result-review-v3.js";
import { dispatchRewardResultReviewV3 } from "../dist/routes/rewards/result-review-v3.js";
const id = n => `85000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const record = () => ({ schema:"raceson-result-review-v3",categoryId:id(1),organizationId:id(2),observedAt:"2026-09-09T12:00:00Z",
  state:"awaiting_provisional",revision:1,reviewSeconds:86400,policyId:id(3),configuredAt:"2026-09-09T11:00:00Z",locked:false,held:false,
  startedAt:null,startedByPublicationId:null,endsAt:null,latestPublicationId:null,finalPublicationId:null,officialPublishedAt:null,allocationApproved:false });
async function request({method="GET",body,raw=record(),error,authError,path=id(1),disabled=false}={}) {
  const calls=[],res={};
  const matched=await dispatchRewardResultReviewV3({method},res,new URL(`http://127.0.0.1:3102/api/v1/organizer/rewards/result-review/${path}`),{
    config:()=>disabled?null:{chainId:10143,origin:"http://127.0.0.1:3102"},requireIdentity:async()=>{if(authError)throw new Error(authError);return{userId:id(4),sessionId:id(5)}} ,
    readJsonBody:async()=>body,applyPrivateSessionHeaders:()=>{res.private=true},sendSuccess:(_,data)=>Object.assign(res,{status:200,data}),
    sendError:(_,status,code)=>Object.assign(res,{status,code}),rpc:async(name,args)=>{calls.push({name,args});return{data:raw,error:error?{message:error}:null}} });
  return{matched,res,calls};
}
test("V3 review reads bind verified identity and category; private sporting evidence is not payment approval",async()=>{
  const r=await request();assert.equal(r.res.status,200);assert.equal(r.res.private,true);assert.equal(r.res.data.allocationApproved,false);
  assert.deepEqual(r.calls,[{name:"service_read_reward_result_review_v3",args:{p_actor_user_id:id(4),p_actor_session_id:id(5),p_category_id:id(1)}}]);
});
test("zero, custom, 24-hour and maximum review saves are explicit revisioned choices",async()=>{
  for(const reviewSeconds of[0,3600,86400,2592000]){
    const r=await request({method:"PATCH",body:{expectedRevision:0,reviewSeconds},raw:{...record(),reviewSeconds}});
    assert.equal(r.res.status,200);assert.equal(r.calls[0].name,"service_save_reward_result_review_policy_v3");assert.equal(r.calls[0].args.p_review_seconds,reviewSeconds);
  }
});
test("browser timestamps, identities, approval, query fields and invalid periods never reach SQL",async()=>{
  for(const body of[{expectedRevision:0,reviewSeconds:-1},{expectedRevision:0,reviewSeconds:1.5},{expectedRevision:0,reviewSeconds:2592001},
    {expectedRevision:0},{expectedRevision:0,reviewSeconds:0,startedAt:"2020-01-01T00:00:00Z"},{expectedRevision:0,reviewSeconds:0,allocationApproved:true},
    {expectedRevision:0,reviewSeconds:0,userId:id(99)}]){
    const r=await request({method:"PATCH",body});assert.equal(r.res.status,400);assert.equal(r.calls.length,0);
  }
  for(const path of[`${id(1)}?chainId=1`,"invalid-id"]){const r=await request({path});assert.equal(r.res.status,400);assert.equal(r.calls.length,0)}
});
test("locked policy, revision conflict, expired session and forbidden race use sanitized errors",async()=>{
  for(const[error,status]of[["reward_result_review_locked",409],["reward_result_review_revision_changed",409],["reward_account_session_required",401],
    ["reward_result_review_not_found",404],["SQL failed with private complaint details",503]]){
    const r=await request({error});assert.equal(r.res.status,status);assert.equal(r.res.data,undefined);assert.ok(!JSON.stringify(r.res).includes("private complaint"));
  }
  for(const authError of["Missing bearer token","Untrusted browser origin"]){const r=await request({authError});assert.equal(r.calls.length,0);assert.equal(r.res.status,authError==="Missing bearer token"?401:403)}
});
test("wrong category, extra private fields and inconsistent final evidence fail closed",async()=>{
  for(const patch of[{categoryId:id(99)},{complaints:["private"]},{allocationApproved:true},{state:"final"},{reviewSeconds:-1},{revision:0},
    {startedAt:"2026-09-09T12:00:00Z"},{locked:true}]){
    const r=await request({raw:{...record(),...patch}});assert.equal(r.res.status,503);assert.equal(r.res.data,undefined);
  }
});
test("final publication requires completed exact clock; a hold suppresses the final approval-ready evidence",()=>{
  const r={...record(),reviewSeconds:3600,locked:true,configuredAt:"2026-09-09T09:00:00Z",startedAt:"2026-09-09T10:00:00Z",endsAt:"2026-09-09T11:00:00Z",
    startedByPublicationId:id(10),latestPublicationId:id(11),finalPublicationId:id(11),officialPublishedAt:"2026-09-09T11:00:00Z",state:"final"};
  assert.deepEqual(decodeRewardResultReviewV3(r),r);
  for(const patch of[{officialPublishedAt:"2026-09-09T10:59:59Z"},{endsAt:"2026-09-09T10:00:00Z"},{finalPublicationId:id(12)},{held:true}])
    assert.throws(()=>decodeRewardResultReviewV3({...r,...patch}));
  assert.equal(decodeRewardResultReviewV3({...r,held:true,state:"held",finalPublicationId:null,officialPublishedAt:null}).allocationApproved,false);
});
test("historical unconfigured publications are not manufactured review clocks",()=>{
  const r={...record(),revision:0,reviewSeconds:null,policyId:null,configuredAt:null,state:"unconfigured",latestPublicationId:id(10),locked:true};
  assert.deepEqual(decodeRewardResultReviewV3(r),r);
  assert.throws(()=>decodeRewardResultReviewV3({...r,startedByPublicationId:id(10)}));
});
test("disabled demo and unrelated methods never invoke private storage",async()=>{
  for(const args of[{disabled:true},{method:"POST"},{path:`${id(1)}/activate`}]){const r=await request(args);assert.equal(r.matched,false);assert.equal(r.calls.length,0)}
});
