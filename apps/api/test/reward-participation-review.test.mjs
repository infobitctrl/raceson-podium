import assert from "node:assert/strict";
import test from "node:test";
import {decodeParticipationReview,decodeParticipationReviewWorkspace,validateParticipationReviewEvidence} from "../../../packages/domain/dist/rewards/participation-review.js";
import {deriveLeagueParticipationMetrics} from "../../../packages/domain/dist/rewards/league-participation-metrics.js";
import {createDefaultRewardProgrammeDraftV2} from "../../../packages/domain/dist/rewards/programme-draft-v2.js";
import {dispatchRewardPlanningRoutes} from "../dist/routes/rewards/planning.js";
import {publishedSnapshot,publishedMapping,id} from "./fixtures/published-reward-v2.mjs";
const hash="b".repeat(64),empty=()=>({version:1,sourceHash:hash,duplicates:[],confirmedUnaffiliatedResultIds:[]});
function stored() {return {record:{draftId:id(30),organizationId:id(31),seasonId:id(32),chainId:31337,organizationName:"Synthetic",seasonName:"Synthetic",revision:1,updatedAt:"2026-09-09T12:00:00Z",rules:createDefaultRewardProgrammeDraftV2()},
  workspace:{draftId:id(30),revision:1,rulesRevision:1,catalogueHash:"a".repeat(64),boundCatalogueHash:"a".repeat(64),mapping:publishedMapping(),catalogue:publishedSnapshot().catalogue},
  snapshot:publishedSnapshot(),sourceHash:hash,review:null,history:[],recordedReview:null};}
function saved(review=empty()) {return {id:id(50),previousReviewId:null,revision:1,review,reason:"Reviewed published source",reviewedAt:"2026-09-21T12:00:00.123456+00:00",reviewedByUserId:id(40),current:true};}
async function request({data=stored(),method="GET",body,error,authError,query=""}={}) {
  const res={},calls=[];
  const handled=await dispatchRewardPlanningRoutes({method},res,new URL(`http://localhost/api/v1/organizer/rewards/drafts/${id(30)}/participation-review${query}`),{
    config:()=>({chainId:31337}),requireIdentity:async()=>{if(authError)throw Error(authError);return {userId:id(40),sessionId:id(41)};},
    applyPrivateSessionHeaders:()=>res.private=true,readJsonBody:async()=>body,sendSuccess:(_,data)=>Object.assign(res,{status:200,data}),sendError:(_,status,code)=>Object.assign(res,{status,code}),
    rpc:async(name,args)=>{calls.push({name,args});return {data,error:error?{message:error}:null};}});
  return {res,calls,handled};
}
test("review shape rejects forged fields, repeated confirmations and empty reasons",()=>{
  assert.deepEqual(decodeParticipationReview(empty()),empty());
  for(const change of [r=>r.other=true,r=>r.confirmedUnaffiliatedResultIds=[id(1),id(1)],r=>r.sourceHash="other",r=>r.duplicates=[{round:1,athleteId:id(10),resultIds:[id(500),id(501)],keepResultId:id(500),reason:""}]]) {
    const r=empty();change(r);assert.throws(()=>decodeParticipationReview(r));
  }
});
test("complete duplicate evidence includes DNS; unaffiliated confirmation requires a real finish",()=>{
  const source=publishedSnapshot();source.results[1].athleteId=source.results[0].athleteId;source.results[1].participationStatus="dns";
  const metrics=deriveLeagueParticipationMetrics(source,hash),review=empty();
  review.duplicates=[{round:1,athleteId:id(10),resultIds:[id(500),id(501)],keepResultId:id(500),reason:"Second start DNS"}];
  review.confirmedUnaffiliatedResultIds=[id(500)];assert.deepEqual(validateParticipationReviewEvidence(metrics,review),review);
  review.confirmedUnaffiliatedResultIds=[id(501)];assert.throws(()=>validateParticipationReviewEvidence(metrics,review));
});
test("workspace distinguishes current, historical and missing-source reviews and rejects inconsistent history",()=>{
  const data=stored();data.review=saved();data.history=[data.review];assert.equal(decodeParticipationReviewWorkspace(data).review.current,true);
  data.snapshot=null;data.sourceHash=null;assert.throws(()=>decodeParticipationReviewWorkspace(data));
  data.review.current=false;assert.equal(decodeParticipationReviewWorkspace(data).review.current,false);
  data.history=[];assert.throws(()=>decodeParticipationReviewWorkspace(data));
});
test("private GET derives metrics from authorized source and POST acknowledges exact immutable revision",async()=>{
  const read=await request();assert.equal(read.res.status,200);assert.equal(read.res.private,true);assert.equal(read.calls[0].name,"service_read_reward_participation_review");
  assert.equal(read.res.data.metrics.summary.rawFinishes,12);
  const data=stored();data.review=saved();data.history=[data.review];data.recordedReview=data.review;
  const body={requestId:id(50),expectedReviewId:null,review:empty(),reason:data.review.reason};
  const write=await request({method:"POST",body,data});assert.equal(write.res.status,200);assert.equal(write.calls[0].name,"service_save_reward_participation_review");
  assert.equal(write.calls[0].args.p_actor_session_id,id(41));assert.deepEqual(write.calls[0].args.p_review,body.review);
  data.recordedReview={...data.review,reason:"Unexpected"};assert.equal((await request({method:"POST",body,data})).res.status,503);
});
test("old retry returns an old acknowledgment without claiming the superseded review is current",async()=>{
  const data=stored(),old=saved();old.current=false;
  data.review={...saved(),id:id(51),previousReviewId:old.id,revision:2,reason:"Correction"};data.history=[data.review,old];data.recordedReview=old;
  const body={requestId:old.id,expectedReviewId:null,review:old.review,reason:old.reason};
  const result=await request({method:"POST",body,data});assert.equal(result.res.status,200);assert.equal(result.res.data.recordedReview.current,false);assert.equal(result.res.data.review.id,id(51));
});
test("review endpoint fails closed for malformed bodies, stale data, auth and scope errors",async()=>{
  for(const method of ["PATCH","DELETE"])assert.equal((await request({method})).handled,false);
  assert.equal((await request({query:"?source=other"})).res.status,400);
  assert.equal((await request({method:"POST",body:{}})).res.status,400);
  for(const [error,status] of [["reward_participation_review_conflict",409],["reward_participation_source_changed",409],["reward_participation_source_missing",409],["invalid_reward_participation_review",400],["reward_account_session_required",401],["reward_planning_not_found",404],["secret",503]]) {
    const result=await request({error});assert.equal(result.res.status,status);assert.ok(!JSON.stringify(result.res).includes("secret"));
  }
  const data=stored();data.record.draftId=id(99);assert.equal((await request({data})).res.status,503);
  assert.equal((await request({authError:"Untrusted browser origin"})).res.status,403);
});
