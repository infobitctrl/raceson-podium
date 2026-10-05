import assert from "node:assert/strict";
import { dispatchOrganizerRewardRoutes } from "../../../apps/api/dist/routes/rewards/organizer.js";
import { literal } from "./reward-integration-fixture.mjs";
export async function organizerClubScenarios({ harness, scenario, roleBefore, programmeId, operator, nomination, evidence, chainReader }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness, config = { chainId:31337, origin:"http://127.0.0.1:3101" };
  const base=`/api/v1/organizer/rewards/programmes/${programmeId}/club-treasuries`, detail=`${base}/${nomination.requestId}/review`;
  const privateCheck = body => assert.doesNotMatch(JSON.stringify(body), /sessionId|SessionId|userId|UserId|EvidenceRef|signature|idempotencyKey|privateKey/);
  const total=await scalar("select sum(amount_wei)::text from app_private.reward_entitlements");
  const expire=expired=>query(`update auth.sessions set not_after=clock_timestamp()+interval '${expired?"-1 second":"1 hour"}' where id=${literal(operator.sessionId)}`);
  async function http({url=detail,method="GET",body,reader=chainReader}={}) {
    const res={status:200,body:null}; await dispatchOrganizerRewardRoutes({method},res,new URL(url,config.origin),{
      config:()=>config,requireIdentity:async()=>operator,rpc,clubReader:reader,readJsonBody:async()=>body,applyPrivateSessionHeaders:()=>{},
      sendSuccess:(r,v)=>{r.body=v;},sendError:(r,status,code,message)=>{r.status=status;r.body={error:{code,message}};},
    });privateCheck(res.body);return res;
  }
  await scenario("operator club HTTP discovery/detail use actual programme-bound SQL and expose only nominated public addresses and current labels",async()=>{
    const page=await http({url:base});assert.equal(page.status,200);assert.ok(page.body.items.some(r=>r.requestId===nomination.requestId));
    assert.ok(page.body.items.every(r=>r.clubId===nomination.clubId));
    const d=await http();assert.equal(d.status,200);assert.equal(d.body.clubId,nomination.clubId);assert.equal(d.body.reviewState,"unreviewed");
    assert.equal(d.body.ownerName,"Synthetic treasury owner");assert.deepEqual(d.body.candidate,evidence.candidate);
    const args={p_actor_user_id:operator.userId,p_actor_session_id:operator.sessionId,p_programme_id:programmeId,p_chain_id:31337};
    for(const [name,extra] of [["service_list_reward_operator_club_treasuries",{p_after_id:null}],["service_read_reward_operator_club_treasury",{p_request_id:nomination.requestId}]]){
      const sql=rpcSql(name,{...args,...extra});
      for(const role of ["anon","authenticated"])await assert.rejects(query(`begin;set local role ${role};${sql}rollback;`));
      await query(`begin;alter role service_role bypassrls;set local role service_role;${sql}rollback;`);
      assert.equal(await scalar(`select prosecdef from pg_proc where proname=${literal(name)}`),false);
    }
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
  });
  await scenario("operator club preview/saving/revocation connect HTTP to real immutable SQL; synthetic chain observations never move funds",async()=>{
    const d=(await http()).body, version={expectedIdentityFingerprintSha256:d.identityFingerprintSha256,expectedRevision:0};
    const seen=await http({url:`${base}/${nomination.requestId}/observe`,method:"POST",body:{...version,factoryAddress:evidence.factoryAddress,deploymentTransactionHash:evidence.deploymentTransactionHash}});
    assert.equal(seen.status,200);assert.deepEqual(seen.body.reviewedBlock,evidence.reviewedBlock);assert.equal(seen.body.executionHistoryReviewRequired,true);
    const body={...version,evidence,confirmReview:true,idempotencyKey:"operator-club-http-review"};
    const saved=await http({method:"POST",body});assert.equal(saved.status,200);assert.equal((await http()).body.reviewState,"reviewed");
    const revoked=await http({url:`${base}/${nomination.requestId}/reviews/${saved.body.review.reviewId}/revoke`,method:"POST",body:{reason:"operator_correction",confirmRevoke:true}});
    assert.equal(revoked.status,200);assert.equal((await http()).body.reviewState,"revoked");
    const retry=await http({method:"POST",body,reader:()=>{throw Error("Historical retry must not need chain configuration");}});
    assert.equal(retry.status,200);assert.equal(retry.body.review.reviewId,saved.body.review.reviewId);assert.ok(retry.body.review.revokedAt);
    assert.equal(await scalar("select count(*) from app_private.reward_club_treasury_reviews where idempotency_key='operator-club-http-review'"),1);
    assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"),total);
  });
  await scenario("operator club list/detail and read-only chain previews cannot return private data after actual session expiry",async()=>{
    for(const url of [base,detail]){
      const release=await lock("lock table app_private.reward_club_treasury_requests in access exclusive mode"), pending=http({url});pending.catch(()=>{});
      try{await waiting(1);await expire(true);}finally{await release();}assert.equal((await pending).status,401);await expire(false);
    }
    const c=(await http()).body;let expired=false;
    const reader={...chainReader,getChainId:async()=>{if(!expired){expired=true;await expire(true);}return chainReader.getChainId();}};
    try{
      const response=await http({url:`${base}/${nomination.requestId}/observe`,method:"POST",reader,body:{
        expectedIdentityFingerprintSha256:c.identityFingerprintSha256,expectedRevision:c.latestReview.revision,
        factoryAddress:evidence.factoryAddress,deploymentTransactionHash:evidence.deploymentTransactionHash}});
      assert.equal(response.status,401);
    }finally{await expire(false);}
    assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"),total);
  });
}
