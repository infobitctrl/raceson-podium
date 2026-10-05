import assert from "node:assert/strict";
import { dispatchOrganizerRewardRoutes } from "../../../apps/api/dist/routes/rewards/organizer.js";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";

export async function organizerPreparationScenarios({harness,scenario,programmeId,campaignId,emptyCampaignId,reviewId}) {
  const {query,scalar,rpc,rpcSql,lock,waiting}=harness;
  const identity={userId:id(4),sessionId:id(98500)},other={userId:id(5),sessionId:id(98501)};
  await query(`insert into auth.sessions(id,user_id,not_after) values
    (${literal(identity.sessionId)},${literal(identity.userId)},clock_timestamp()+interval '1 hour'),
    (${literal(other.sessionId)},${literal(other.userId)},clock_timestamp()+interval '1 hour')`);
  const scope={programmeId,campaignId,chainId:31337},base=`/api/v1/organizer/rewards/programmes/${programmeId}/campaigns/${campaignId}`;
  let confirmation,writeArgs;
  const http=async(path,method="GET",body=null,who=identity,chainId=31337)=>{
    const res={status:200,body:null,private:false};
    assert.equal(await dispatchOrganizerRewardRoutes({method},res,new URL(path,"http://127.0.0.1:3101"),{
      config:()=>({chainId,origin:"http://127.0.0.1:3101"}),requireIdentity:async()=>who,readJsonBody:async()=>body,
      rpc:async(name,args)=>{if(name==="service_reserve_reward_operator_allocation")writeArgs=structuredClone(args);return rpc(name,args);},
      applyPrivateSessionHeaders:r=>{r.private=true;},sendSuccess:(r,d)=>{r.body=d;},sendError:(r,status,code)=>{r.status=status;r.body={error:{code}};},
    }),true);assert.equal(res.private,true);
    assert.doesNotMatch(JSON.stringify(res.body),/profileBirthYear|dateOfBirth|snapshotSalt|recordApprovals|sourceFingerprint|sessionId|operatorUserId|signature|wallet/);
    return res;
  };
  const reserve=()=>http(`${base}/reviews/${reviewId}/reserve`,"POST",confirmation);
  const counts=()=>scalar("select jsonb_build_object('allocations',(select count(*) from app_private.reward_allocations),'awards',(select count(*) from app_private.reward_entitlements),'sources',(select count(*) from app_private.reward_source_reservations))");
  await scenario("organizer HTTP previews a real stored review including verified records, clubs and unclaimed weights without writing awards",async()=>{
    const before=await counts(),response=await http(`${base}/preparation`);assert.equal(response.status,200);
    const p=response.body.preview;assert.equal(response.body.stage,"preview");assert.equal(p.reviewId,reviewId);assert.equal(p.selectedFinishCount,6);
    assert.ok(p.items.some(a=>a.kind==="club"));assert.ok(p.items.some(a=>a.breakdown.some(b=>b.family==="record"&&BigInt(b.amountWei)>0n)));
    assert.ok(p.items.every(a=>a.name!==null));assert.equal(p.items.reduce((s,a)=>s+BigInt(a.amountWei),0n).toString(),p.allocatedWei);
    assert.equal((await http(`${base}/preparation`,"GET",null,other)).status,403);
    assert.equal((await http(`${base}/preparation`,"GET",null,identity,10143)).status,404);
    assert.equal((await http(`${base}/preparation`.replace(campaignId,emptyCampaignId))).body.stage,"awaiting_review");
    confirmation={previewDigest:p.previewDigest,idempotencyKey:"same-reserve-key-01",confirmAllocation:true};
    assert.equal((await http(`${base}/reviews/${reviewId}/reserve`,"POST",{...confirmation,previewDigest:"0".repeat(64)})).status,409);
    assert.deepEqual(await counts(),before);
  });
  await scenario("preparation read drops private results after an actual session-expiry table wait",async()=>{
    const original=await scalar(`select not_after from auth.sessions where id=${literal(identity.sessionId)}`);
    const release=await lock(`lock table app_private.reward_sporting_reviews in access exclusive mode;
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
    const pending=http(`${base}/preparation`);pending.catch(()=>{});
    try{try{await waiting(1);}finally{await release();}assert.equal((await pending).status,401);}
    finally{await query(`update auth.sessions set not_after=${literal(original)}::timestamptz where id=${literal(identity.sessionId)}`);}
  });
  await scenario("explicit HTTP reservation rolls back allocations, beneficiaries and source consumption when session expires while INSERT waits",async()=>{
    const before=await counts(),beneficiaries=await scalar("select count(*) from app_private.reward_beneficiaries"),
      original=await scalar(`select not_after from auth.sessions where id=${literal(identity.sessionId)}`);
    const release=await lock(`lock table app_private.reward_entitlements in share mode;
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(identity.sessionId)}`);
    const pending=reserve();pending.catch(()=>{});
    try{try{await waiting(1);}finally{await release();}assert.equal((await pending).status,401);}
    finally{await query(`update auth.sessions set not_after=${literal(original)}::timestamptz where id=${literal(identity.sessionId)}`);}
    assert.deepEqual(await counts(),before);assert.equal(await scalar("select count(*) from app_private.reward_beneficiaries"),beneficiaries);
    const readArgs={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_programme_id:programmeId,p_chain_id:31337,p_campaign_id:campaignId,p_review_id:null};
    for(const[method,args]of[["service_read_reward_operator_preparation",readArgs],["service_reserve_reward_operator_allocation",writeArgs]]){
      for(const role of["anon","authenticated"])await assert.rejects(query(`begin;set local role ${role};${rpcSql(method,args)}rollback;`),/permission denied for function/);
      const reply=JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;${rpcSql(method,args)}rollback;`));
      assert.equal(reply.campaignId,campaignId);
    }
    assert.deepEqual(await counts(),before);
  });
  return {
    async reserve(){const response=await reserve();assert.equal(response.status,200);
      const {programmeId:ignoredProgramme,chainId:ignoredChain,...result}=response.body;
      return {...result,allocatedWei:BigInt(result.allocatedWei),unallocatedWei:BigInt(result.unallocatedWei)};},
    async assertReserved(){const response=await http(`${base}/preparation`);assert.equal(response.status,200);assert.equal(response.body.stage,"reserved");assert.equal(response.body.preview,null);},
  };
}
