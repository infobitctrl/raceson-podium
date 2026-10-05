import assert from "node:assert/strict";
import test from "node:test";
import { getOrganizerRewardPreparation, reserveOrganizerRewardPreparation } from "../dist/features/rewards/organizer-preparation-service.js";
import { dispatchOrganizerRewardRoutes } from "../dist/routes/rewards/organizer.js";
import { decodeRewardPreparation } from "../../../packages/domain/dist/rewards/index.js";
import { calculationFixture, rewardId as id } from "./fixtures/reward-calculation.mjs";

function fixture(pot="race") {
  const f=calculationFixture(pot,1,10000n*10n**18n), identity={userId:f.actorId,sessionId:id(99001)},
    scope={programmeId:f.context.programme.id,campaignId:f.campaignId,chainId:31337};
  let reserved=null;const calls=[];
  const bundle={...scope,budgetWei:f.context.campaign.budgetWei,latestReviewId:f.reviewId,allocationId:null,context:f.context,recordApprovals:[],
    names:[...new Map(f.source.rows.map(r=>[r.canonicalAthleteId,{kind:"athlete",id:r.canonicalAthleteId,name:"Synthetic runner"}])).values(),{kind:"club",id:id(2000),name:"Synthetic club"}]};
  const rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});
    assert.equal(args.p_actor_user_id,identity.userId);assert.equal(args.p_actor_session_id,identity.sessionId);
    if(name==="service_read_reward_operator_preparation")return{data:structuredClone(bundle),error:null};
    if(name==="service_check_reward_operator_preparation")return{data:{...scope},error:null};
    assert.equal(name,"service_reserve_reward_operator_allocation");
    if(reserved)assert.deepEqual(args.p_allocation,reserved);reserved=structuredClone(args.p_allocation);
    return{data:{allocationId:id(919),campaignId:scope.campaignId,reviewId:f.reviewId,
      allocatedWei:String(BigInt(reserved.budgetWei)-BigInt(reserved.unallocatedWei)),unallocatedWei:reserved.unallocatedWei,
      entitlementCount:reserved.entitlements.length,reservedAt:"2026-09-09T10:00:00Z"},error:null};
  };
  return {f,identity,scope,bundle,rpc,calls,get reserved(){return reserved;}};
}
const confirmation=p=>({reviewId:p.reviewId,previewDigest:p.previewDigest,idempotencyKey:"synthetic-ui-reserve",confirmAllocation:true});
test("saved race/league reviews become exact private previews then confirmed server-derived reservations",async()=>{
  for(const pot of ["race","league"]){const h=fixture(pot), view=await getOrganizerRewardPreparation(h.identity,h.scope,null,h.rpc),p=view.preview;
    assert.equal(view.stage,"preview");assert.equal(p.selectedFinishCount,pot==="race"?6:30);
    assert.equal(BigInt(p.allocatedWei)+BigInt(p.unallocatedWei),BigInt(view.budgetWei));
    assert.ok(p.items.some(a=>a.kind==="club"));assert.equal(p.items.reduce((s,a)=>s+BigInt(a.amountWei),0n).toString(),p.allocatedWei);
    assert.doesNotMatch(JSON.stringify(view),/dateOfBirth|profileBirthYear|signature|operatorUserId|sourceFingerprint|evidenceIds|recordApprovals/);
    assert.equal(h.reserved,null);assert.deepEqual(h.calls.map(c=>c.name),["service_read_reward_operator_preparation","service_check_reward_operator_preparation"]);
    const request=confirmation(p), a=await reserveOrganizerRewardPreparation(h.identity,h.scope,request,h.rpc),b=await reserveOrganizerRewardPreparation(h.identity,h.scope,request,h.rpc);
    assert.deepEqual(a,b);assert.equal(a.entitlementCount,p.awardCount);assert.equal(h.reserved.selectedSourceIds.length,p.selectedFinishCount);
  }
});
test("no review and already reserved remain distinct from a new allocation preview",async()=>{
  const h=fixture();h.bundle.context=null;h.bundle.latestReviewId=null;h.bundle.names=[];
  assert.equal((await getOrganizerRewardPreparation(h.identity,h.scope,null,h.rpc)).stage,"awaiting_review");
  const s=fixture();s.bundle.allocationId=id(919);
  assert.equal((await getOrganizerRewardPreparation(s.identity,s.scope,null,s.rpc)).stage,"reserved");assert.equal(s.reserved,null);
});
test("league previews page 31 calculated beneficiaries without changing the confirmation or losing amounts",async()=>{
  const h=fixture("league");
  h.f.source.rows.forEach((r,n)=>{
    const athlete=id(5000+n);r.sourceAthleteId=athlete;r.canonicalAthleteId=athlete;r.registrationAthleteId=athlete;r.identityPath=[athlete];
  });
  h.bundle.names=h.f.source.rows.map(r=>({kind:"athlete",id:r.canonicalAthleteId,name:"Synthetic participant"}));
  h.bundle.names.push({kind:"club",id:id(2000),name:"Synthetic club"});
  const first=await getOrganizerRewardPreparation(h.identity,h.scope,null,h.rpc);
  assert.equal(first.preview.awardCount,31);assert.equal(first.preview.items.length,25);assert.ok(first.preview.nextCursor);
  const second=await getOrganizerRewardPreparation(h.identity,h.scope,first.preview.nextCursor,h.rpc);
  assert.equal(second.preview.items.length,6);assert.equal(second.preview.nextCursor,null);
  assert.equal(second.preview.previewDigest,first.preview.previewDigest);
  const items=[...first.preview.items,...second.preview.items];assert.equal(new Set(items.map(a=>a.key)).size,31);
  assert.equal(items.reduce((sum,a)=>sum+BigInt(a.amountWei),0n).toString(),first.preview.allocatedWei);
  h.bundle.names[0].name="Renamed synthetic label";
  assert.equal((await getOrganizerRewardPreparation(h.identity,h.scope,null,h.rpc)).preview.previewDigest,first.preview.previewDigest);
  assert.equal(h.reserved,null);
});
test("reservation freezes browser confirmation, identity and scope before awaiting its saved-review read",async()=>{
  const h=fixture(),p=(await getOrganizerRewardPreparation(h.identity,h.scope,null,h.rpc)).preview;
  const request=confirmation(p),scope={...h.scope},identity={...h.identity};
  const result=await reserveOrganizerRewardPreparation(identity,scope,request,async(name,args)=>{
    request.previewDigest="0".repeat(64);request.idempotencyKey="changed-late-key";request.confirmAllocation=false;
    scope.campaignId=id(999);identity.userId=id(888);
    return h.rpc(name,args);
  });
  assert.equal(result.campaignId,h.scope.campaignId);
  const write=h.calls.find(c=>c.name==="service_reserve_reward_operator_allocation");
  assert.equal(write.args.p_idempotency_key,"synthetic-ui-reserve");
});
test("changed confirmation, absent explicit consent and invalid request never reserve",async()=>{
  const h=fixture(),p=(await getOrganizerRewardPreparation(h.identity,h.scope,null,h.rpc)).preview;
  for(const [patch,code]of[[{previewDigest:"0".repeat(64)},"reward_preparation_changed"],[{confirmAllocation:false},"invalid_reward_preparation_request"],[{idempotencyKey:"x"},"invalid_reward_preparation_request"]]){
    await assert.rejects(reserveOrganizerRewardPreparation(h.identity,h.scope,{...confirmation(p),...patch},h.rpc),{code});
  }assert.equal(h.reserved,null);
});
test("shared preview rejects extra private fields, amount drift, wrong beneficiary categories and executable getters",async()=>{
  const h=fixture(),v=await getOrganizerRewardPreparation(h.identity,h.scope,null,h.rpc);
  for(const mutate of [d=>d.context={},d=>d.preview.allocatedWei="1",d=>d.preview.items[0].kind="club",d=>d.preview.families.pop(),d=>d.preview.items[0].amountWei="1"]){
    const d=structuredClone(v);mutate(d);assert.throws(()=>decodeRewardPreparation(d,h.scope));
  }
  let called=false;const d=structuredClone(v);Object.defineProperty(d,"preview",{enumerable:true,get(){called=true;return v.preview;}});
  assert.throws(()=>decodeRewardPreparation(d,h.scope));assert.equal(called,false);
});
test("preview rechecks access after computation and preserves scope during asynchronous mutation",async()=>{
  const h=fixture(),scope={...h.scope},identity={...h.identity};
  const v=await getOrganizerRewardPreparation(identity,scope,null,async(name,args)=>{
    scope.campaignId=id(999);identity.userId=id(888);return h.rpc(name,args);
  });assert.equal(v.campaignId,h.scope.campaignId);
  await assert.rejects(getOrganizerRewardPreparation(h.identity,h.scope,null,async(name,args)=>name==="service_check_reward_operator_preparation"
    ?{data:null,error:{message:"reward_account_session_required",details:"private"}}:h.rpc(name,args)),{code:"reward_account_session_required"});
});
test("HTTP preparation and reserve reject browser amounts, arbitrary queries and lost authority without leaking internals",async()=>{
  const h=fixture(),base=`/api/v1/organizer/rewards/programmes/${h.scope.programmeId}/campaigns/${h.scope.campaignId}`;
  const run=async(path,method="GET",body=null,rpc=h.rpc)=>{const res={status:200,body:null};const handled=await dispatchOrganizerRewardRoutes({method},res,new URL(base+path,"http://localhost"),{
    config:()=>({chainId:31337,origin:"http://localhost"}),requireIdentity:async()=>h.identity,readJsonBody:async()=>body,
    applyPrivateSessionHeaders:r=>{r.private=true;},sendSuccess:(r,data)=>{r.body=data;},sendError:(r,status,code)=>{r.status=status;r.body={error:{code}};},rpc,
  });return{...res,handled};};
  const preview=await run("/preparation");assert.equal(preview.status,200);assert.equal(preview.private,true);
  const {reviewId,...body}=confirmation(preview.body.preview),url=`/reviews/${reviewId}/reserve`;
  assert.equal((await run(url,"GET")).handled,false);assert.equal((await run("/preparation","POST",{})).handled,false);
  for(const payload of[{...body,amountWei:"999"},{...body,confirmAllocation:false},{...body,actorId:id(1)}])assert.equal((await run(url,"POST",payload)).status,400);
  assert.equal((await run("/preparation?chainId=143")).status,400);assert.equal((await run(url+"?after=x","POST",body)).status,400);
  for (const after of ["athlete:"+"-".repeat(36),"club:00000000-0000-0000-0000-000000000000"])
    assert.equal((await run("/preparation?after="+encodeURIComponent(after))).status,400);
  assert.equal(h.reserved,null);assert.equal((await run(url,"POST",body)).status,200);
  for(const[code,status]of[["reward_account_session_required",401],["reward_operator_permission_required",403],["reward_preparation_scope_required",404],["reward_review_source_changed",409],["private database failure",503]]){
    const r=await run("/preparation","GET",null,async()=>({data:null,error:{message:code,details:"private query"}}));assert.equal(r.status,status);assert.doesNotMatch(JSON.stringify(r),/private query|private database failure/);
  }
});
