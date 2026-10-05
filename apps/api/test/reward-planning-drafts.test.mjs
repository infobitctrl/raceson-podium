import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultRewardProgrammeDraftV2 } from "../../../packages/domain/dist/rewards/programme-draft-v2.js";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";
import { validateContainers, localAppEnvironment, project, workdir, network, database } from "../../../demo/rewards/scripts/local-demo.mjs";

const id = n => `82000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const record = () => ({ draftId:id(5), organizationId:id(2), seasonId:id(4), chainId:31337,
  organizationName:"Synthetic organization",seasonName:"Synthetic league · 2026",revision:1,
  updatedAt:"2026-09-09T12:00:00Z",rules:createDefaultRewardProgrammeDraftV2() });
async function request({method="GET", path="", body, error, raw}={}) {
  const calls=[], res={};
  const deps={config:()=>({chainId:31337,origin:"http://127.0.0.1:3101"}),
    requireIdentity:async()=>({userId:id(10),sessionId:id(11)}),readJsonBody:async()=>body,
    applyPrivateSessionHeaders:()=>{res.private=true},sendSuccess:(_,data)=>Object.assign(res,{status:200,data}),
    sendError:(_,status,code)=>Object.assign(res,{status,code}),
    rpc:async(name,args)=>{calls.push({name,args});return{data:raw??(path?record():[record()]),error:error?{message:error}:null}}};
  const matched=await dispatchRewardPlanningRoutes({method},res,new URL("http://127.0.0.1:3101/api/v1/organizer/rewards/drafts"+path),deps);
  return{matched,res,calls};
}
test("planning list uses verified account/session and fixed server chain",async()=>{
  const{res,calls}=await request();assert.equal(res.status,200);assert.equal(res.private,true);
  assert.equal(res.data.items[0].draftId,id(5));assert.deepEqual(calls[0].args,{p_actor_user_id:id(10),p_actor_session_id:id(11),p_chain_id:31337});
});
test("read returns a server-calculated planning-only preview with exact wei",async()=>{
  const{res}=await request({path:`/${id(5)}`});assert.equal(res.status,200);
  assert.equal(res.data.preview.kind,"planning_only");assert.equal(res.data.preview.budgetWei,"100000000000000000000000");
  assert.equal(res.data.preview.reviewSeconds,86400);
});
test("validated save binds expected revision without browser identity or funding fields",async()=>{
  const rules=createDefaultRewardProgrammeDraftV2(); const{res,calls}=await request({method:"PATCH",path:`/${id(5)}`,body:{expectedRevision:1,rules}});
  assert.equal(res.status,200);assert.equal(calls[0].name,"service_save_reward_planning_draft");
  assert.equal(calls[0].args.p_expected_revision,1);assert.deepEqual(calls[0].args.p_rules,rules);
});
test("invalid splits, clocks, version, identity injection and query fields never reach SQL",async()=>{
  for(const patch of [{reviewSeconds:172800},{leagueShareBps:5100},{network:"monad-mainnet"},{raceRankWeights:[1]},{funded:true}]){
    const r=await request({method:"PATCH",path:`/${id(5)}`,body:{expectedRevision:1,rules:{...createDefaultRewardProgrammeDraftV2(),...patch}}});
    assert.equal(r.res.status,400);assert.equal(r.calls.length,0);
  }
  for(const body of [{expectedRevision:0,rules:record().rules},{expectedRevision:1,rules:record().rules,userId:id(99)}]){
    const r=await request({method:"PATCH",path:`/${id(5)}`,body});assert.equal(r.res.status,400);assert.equal(r.calls.length,0);
  }
  const query=await request({path:"?chainId=10143"});assert.equal(query.res.status,400);assert.equal(query.calls.length,0);
});
test("stale writes, revoked sessions and unavailable scopes are distinct safe errors",async()=>{
  for(const[error,status]of[["reward_planning_revision_changed",409],["reward_account_session_required",401],["reward_planning_not_found",404]]){
    const r=await request({path:`/${id(5)}`,error});assert.equal(r.res.status,status);assert.equal(r.res.data,undefined);
  }
});
test("mismatched chain or draft returned by storage fails closed",async()=>{
  for(const patch of [{chainId:10143},{draftId:id(98)}]){
    const r=await request({path:`/${id(5)}`,raw:{...record(),...patch}});assert.equal(r.res.status,503);
  }
});
test("local launcher drops inherited app secrets and never exposes server keys to the browser",()=>{
  const e=localAppEnvironment({API_URL:database,ANON_KEY:"synthetic-anon",PUBLISHABLE_KEY:"synthetic-public",SERVICE_ROLE_KEY:"synthetic-server"});
  assert.equal(e.SUPABASE_URL,database);assert.equal(e.NEXT_PUBLIC_SUPABASE_URL,database);
  assert.equal(e.NEXT_PUBLIC_RACESON_API_BASE_URL,"/api");assert.equal(e.STRIPE_SECRET_KEY,undefined);
  for(const[k,v]of Object.entries(e))if(k.startsWith("NEXT_PUBLIC_"))assert.notEqual(v,"synthetic-server");
  assert.throws(()=>localAppEnvironment({API_URL:"https://www.raceson.com"}));
});
test("local stack guard rejects exposed ports, foreign networks, labels and host data",()=>{
  const fixture=()=>["db","kong","auth","rest","storage","inbucket"].map(name=>({Name:`/supabase_${name}_${project}`,
    State:{Running:true},Config:{Labels:{"com.supabase.cli.project":project,"com.supabase.cli.workdir":workdir}},
    NetworkSettings:{Networks:{[network]:{}},Ports:name==="db"?{"5432/tcp":[{HostIp:"127.0.0.1",HostPort:"55322"}]}:{}},Mounts:[]}));
  validateContainers(fixture());
  for(const change of [items=>items[0].NetworkSettings.Ports["5432/tcp"][0].HostIp="0.0.0.0",
    items=>items[0].NetworkSettings.Networks.production={},items=>items[0].Config.Labels["com.supabase.cli.project"]="sitrail",
    items=>items[0].Mounts=[{Type:"bind",Source:"/Users/work/production",RW:false,Destination:"/mnt"}]]){
    const items=fixture();change(items);assert.throws(()=>validateContainers(items));
  }
});
