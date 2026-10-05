import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultRewardProgrammeDraftV2 } from "../../../packages/domain/dist/rewards/programme-draft-v2.js";
import { emptyProgrammeFundingV3 } from "../../../packages/domain/dist/rewards/programme-funding-v3.js";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";
const id = n => `86000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const record = () => ({ draftId:id(5),organizationId:id(2),seasonId:id(4),chainId:31337,organizationName:"Synthetic organization",
  seasonName:"Synthetic league",revision:1,updatedAt:"2026-09-09T12:00:00Z",rules:createDefaultRewardProgrammeDraftV2() });
async function request({method="GET",path=`${id(5)}/funding`,authError,firstError,secondError,second=record(),registryError,disabled=false}={}) {
  const calls=[],res={};let bindings=0;
  const matched=await dispatchRewardPlanningRoutes({method},res,new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${path}`),{
    config:()=>disabled?null:{chainId:31337,origin:"http://127.0.0.1:3101"},
    requireIdentity:async()=>{if(authError)throw new Error(authError);return{userId:id(10),sessionId:id(11)}},
    readJsonBody:async()=>{throw new Error("Unexpected body read")},applyPrivateSessionHeaders:()=>{res.private=true},
    sendSuccess:(_,data)=>Object.assign(res,{status:200,data}),sendError:(_,status,code)=>Object.assign(res,{status,code}),
    programmeFundingRegistry:async()=>{bindings++;if(registryError)throw new Error(registryError);return null},
    rpc:async(name,args)=>{calls.push({name,args});const error=calls.length===1?firstError:secondError;
      return{data:calls.length===1?record():second,error:error?{message:error}:null}},
  });return{matched,res,calls,bindings};
}
test("funding without an approved deployment is unknown, not zero, and uses twice-verified private scope",async()=>{
  const r=await request();assert.equal(r.res.status,200);assert.equal(r.res.private,true);
  assert.deepEqual(r.res.data,emptyProgrammeFundingV3(record()));assert.equal(r.res.data.observation,null);assert.equal(r.bindings,1);
  assert.equal(r.calls.length,2);
  for(const call of r.calls){assert.equal(call.name,"service_read_reward_planning_draft");assert.deepEqual(call.args,{
    p_actor_user_id:id(10),p_actor_session_id:id(11),p_chain_id:31337,p_draft_id:id(5)})}
});
test("funding registry is not consulted before draft authorization",async()=>{
  for(const error of["reward_account_session_required","reward_planning_not_found"]){
    const r=await request({firstError:error});assert.equal(r.res.status,error==="reward_account_session_required"?401:404);assert.equal(r.bindings,0);
  }
  for(const authError of["Missing bearer token","Untrusted browser origin"]){
    const r=await request({authError});assert.equal(r.calls.length,0);assert.equal(r.bindings,0);assert.equal(r.res.status,authError==="Missing bearer token"?401:403);
  }
});
test("revised rules, revoked sessions and removed scope after observation suppress the funding response",async()=>{
  const revised=await request({second:{...record(),revision:2}});assert.equal(revised.res.status,409);assert.equal(revised.res.data,undefined);
  for(const secondError of["reward_account_session_required","reward_planning_not_found"]){
    const r=await request({secondError});assert.equal(r.res.status,secondError==="reward_account_session_required"?401:404);assert.equal(r.res.data,undefined);
  }
});
test("browser chain, address, approval and write requests cannot select or operate a deployment",async()=>{
  for(const query of["chainId=1","address=0x123","approved=true"]){const r=await request({path:`${id(5)}/funding?${query}`});
    assert.equal(r.res.status,400);assert.equal(r.calls.length,0);assert.equal(r.bindings,0)}
  for(const args of[{method:"POST"},{method:"PATCH"},{method:"DELETE"},{disabled:true}]){
    const r=await request(args);assert.equal(r.matched,false);assert.equal(r.calls.length,0);assert.equal(r.bindings,0);
  }
});
test("private provider failures never leak credential-bearing errors to the browser",async()=>{
  const r=await request({registryError:"private provider URL and authorization token"});assert.equal(r.res.status,503);
  assert.equal(r.res.data,undefined);assert.doesNotMatch(JSON.stringify(r.res),/provider URL|authorization token/);
});
