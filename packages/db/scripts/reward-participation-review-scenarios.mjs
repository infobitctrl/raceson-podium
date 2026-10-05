import assert from "node:assert/strict";
import {rewardParticipationReview} from "../dist/rewards/index.js";
import {createDefaultRewardProgrammeDraftV2} from "../../domain/dist/rewards/programme-draft-v2.js";
import {publishedSnapshot} from "../../../apps/api/test/fixtures/published-reward-v2.mjs";
import {integrationFixtureSql,literal as q} from "./reward-integration-fixture.mjs";
const id=n=>`97000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export async function participationReviewScenarios({harness,scenario}) {
  const {query,scalar,rpc,rpcSql,lock,waiting}=harness;
  await query(integrationFixtureSql().replaceAll("78000000-","97000000-")
    .replaceAll("reward-integration","participation-review-integration").replaceAll("Synthetic ","Synthetic participation ")
    .replaceAll("synthetic-round-","synthetic-participation-round-")
    .replaceAll("reward-operator@example.invalid","participation-operator@example.invalid").replaceAll("reward-successor@example.invalid","participation-successor@example.invalid"));
  const identity={userId:id(4),sessionId:id(980001)},draftId=id(980000),snapshot=publishedSnapshot();
  snapshot.results[1].athleteId=snapshot.results[0].athleteId;
  snapshot.results[1].participationStatus="dns";
  const args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:31337,p_draft_id:draftId};
  await query(`insert into auth.sessions(id,user_id,not_after) values(${q(identity.sessionId)},${q(identity.userId)},clock_timestamp()+interval '1 hour');
    insert into app_private.reward_planning_drafts(id,organization_id,season_id,chain_id,rules,updated_by_user_id)
    values(${q(draftId)},${q(id(1))},${q(id(3))},31337,${q(JSON.stringify(createDefaultRewardProgrammeDraftV2()))}::jsonb,${q(identity.userId)});
    insert into app_private.reward_public_snapshots_v2(season_id,organization_id,payload,source_hash)
    values(${q(id(3))},${q(id(1))},${q(JSON.stringify(snapshot))}::jsonb,repeat('0',64));`);
  const read=()=>rewardParticipationReview(identity,31337,draftId,undefined,rpc);
  const save=change=>rewardParticipationReview(identity,31337,draftId,change,rpc);
  const sqlSave=c=>rpcSql("service_save_reward_participation_review",{...args,p_request_id:c.requestId,p_expected_review_id:c.expectedReviewId,p_review:c.review,p_reason:c.reason});
  const table="app_private.reward_participation_reviews",count=()=>scalar(`select count(*) from ${table} where draft_id=${q(draftId)}`);
  let first,latest;
  await scenario("contribution review persists exact source decisions and reopens with authenticated audit",async()=>{
    const initial=await read();assert.equal(initial.review,null);assert.equal(initial.metrics.summary.rawFinishes,11);
    first={requestId:id(980010),expectedReviewId:null,reason:"Confirmed official finish and unaffiliated entry",review:{version:1,sourceHash:initial.sourceHash,
      duplicates:[{round:1,athleteId:snapshot.results[0].athleteId,resultIds:[snapshot.results[0].id,snapshot.results[1].id],keepResultId:snapshot.results[0].id,reason:"Second start is DNS"}],
      confirmedUnaffiliatedResultIds:[snapshot.results[0].id]}};
    const [a,b]=await Promise.all([save(first),save(first)]);assert.deepEqual(a.recordedReview,b.recordedReview);assert.equal(await count(),1);
    const reopened=await read();assert.deepEqual(reopened.review,a.recordedReview);assert.equal(reopened.review.current,true);
    assert.equal(reopened.review.reviewedByUserId,identity.userId);assert.equal(await scalar(`select reviewed_session_id from ${table} where id=${q(first.requestId)}`),identity.sessionId);
  });
  await scenario("concurrent corrections use CAS and an old retry cannot restore superseded decisions",async()=>{
    const a={...first,requestId:id(980011),expectedReviewId:first.requestId,reason:"Withdraw unaffiliated confirmation",review:{...first.review,confirmedUnaffiliatedResultIds:[]}};
    const b={...a,requestId:id(980012),reason:"Hold duplicate pending source correction",review:{...first.review,duplicates:[]}};
    const outcomes=await Promise.allSettled([save(a),save(b)]);assert.equal(outcomes.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(outcomes.find(r=>r.status==="rejected").reason.code,"reward_participation_review_conflict");
    latest=(await read()).review;
    const retry=await save(first);assert.equal(retry.recordedReview.id,first.requestId);assert.equal(retry.recordedReview.current,false);assert.equal(retry.review.id,latest.id);
    assert.equal(retry.history.length,2);assert.equal(retry.history[0].previousReviewId,first.requestId);assert.equal(await count(),2);
    await assert.rejects(save({...first,reason:"Different content"}),{code:"reward_participation_review_conflict"});
  });
  await scenario("SQL refuses fabricated decisions, incomplete duplicate evidence and DNS club confirmations",async()=>{
    const base={...first,requestId:id(980013),expectedReviewId:latest.id};
    for(const mutate of [
      r=>r.duplicates[0].resultIds.pop(),r=>r.duplicates[0].resultIds.push(snapshot.results[2].id),
      r=>r.duplicates[0].keepResultId=id(9),r=>r.duplicates[0].round=2,r=>r.duplicates[0].reason="",
      r=>r.duplicates.push({...r.duplicates[0]}),r=>r.confirmedUnaffiliatedResultIds=[snapshot.results[1].id],
      r=>r.confirmedUnaffiliatedResultIds=[id(9)],r=>r.confirmedUnaffiliatedResultIds.push(snapshot.results[0].id),
      r=>r.payout="forbidden",r=>r.duplicates[0].resultIds=[null,null],
    ]) {const c=structuredClone(base);mutate(c.review);await assert.rejects(query(sqlSave(c)),/invalid_reward_participation_review/);}
    assert.equal(await count(),2);
  });
  await scenario("source-bound sporting review survives budget changes but rejects another source hash",async()=>{
    await query(`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)}`);
    assert.equal((await read()).review.current,true);
    await assert.rejects(save({...first,requestId:id(980014),expectedReviewId:latest.id,review:{...first.review,sourceHash:"a".repeat(64)}}),{code:"reward_participation_source_changed"});
  });
  await scenario("source changes retain stale history and require a new explicit review",async()=>{
    // Disposable transaction only: emulate a future versioned source replacement
    // by changing the draft's season. The immutable imported snapshot is untouched.
    const target=id(980090);
    await query(`insert into public.league_seasons(id,league_id,year,name,status) values(${q(target)},${q(id(2))},2027,'Synthetic alternative season','active')`);
    // The source can also become absent; the latest decision must never stay current.
    await query(`update app_private.reward_planning_drafts set season_id=${q(target)} where id=${q(draftId)}`);
    const stale=await read();assert.equal(stale.sourceHash,null);assert.equal(stale.review.current,false);assert.equal(stale.history.length,2);
    assert.equal((await save(first)).recordedReview.current,false);
    await assert.rejects(save({...first,requestId:id(980015),expectedReviewId:latest.id}),{code:"reward_participation_source_missing"});
    const revised=structuredClone(snapshot);revised.capturedAt="2026-09-21T12:00:00Z";revised.results[0].finishTimeMs++;
    await query(`insert into app_private.reward_public_snapshots_v2(season_id,organization_id,payload,source_hash) values(${q(target)},${q(id(1))},${q(JSON.stringify(revised))}::jsonb,repeat('0',64))`);
    const changed=await read();assert.notEqual(changed.sourceHash,first.review.sourceHash);assert.equal(changed.review.current,false);
    await assert.rejects(save({...first,requestId:id(980017),expectedReviewId:latest.id}),{code:"reward_participation_source_changed"});
    await query(`update app_private.reward_planning_drafts set season_id=${q(id(3))} where id=${q(draftId)}`);
  });
  await scenario("revoked sessions cannot save after waiting for a concurrent draft edit",async()=>{
    const before=await count(),release=await lock(`select id from app_private.reward_planning_drafts where id=${q(draftId)} for update`);
    const pending=assert.rejects(query(sqlSave({...first,requestId:id(980016),expectedReviewId:latest.id})),/reward_account_session_required/);pending.catch(()=>{});
    try {await waiting(1);await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`);}finally{await release();}
    await pending;assert.equal(await count(),before);
    await assert.rejects(read(),{code:"reward_account_session_required"});
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
  });
  await scenario("source drift during insertion rolls back the review and source switch together",async()=>{
    const before=await count();
    await assert.rejects(query(`begin;
      create function pg_temp.synthetic_participation_drift() returns trigger language plpgsql as $$ begin
        update app_private.reward_planning_drafts set season_id=${q(id(980090))} where id=${q(draftId)};return new;end $$;
      create trigger synthetic_participation_drift after insert on ${table} for each row execute function pg_temp.synthetic_participation_drift();
      ${sqlSave({...first,requestId:id(980018),expectedReviewId:latest.id})} rollback;`),/reward_participation_source_changed/);
    assert.equal(await count(),before);assert.equal((await read()).sourceHash,first.review.sourceHash);
  });
  await scenario("bounded history retains the latest ten revisions without erasing earlier audit records",async()=>{
    for(let n=0;n<10;n++) {const next=await save({...first,requestId:id(981000+n),expectedReviewId:latest.id,reason:`Correction ${n+1}`});latest=next.review;}
    const current=await read();assert.equal(current.history.length,10);assert.equal(current.review.revision,12);assert.equal(current.history[9].revision,3);assert.equal(await count(),12);
    const old=await save(first);assert.equal(old.recordedReview.revision,1);assert.equal(old.recordedReview.current,false);assert.equal(old.review.id,latest.id);
  });
  await scenario("contribution review is append-only and unavailable to public roles or another chain",async()=>{
    await assert.rejects(query(`update ${table} set reason=reason`),/reward_result_review_immutable/);
    await assert.rejects(query(`delete from ${table}`),/reward_result_review_immutable/);
    for(const role of ["anon","authenticated"]) {
      assert.equal(await scalar(`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE')`),false);
      for(const fn of ["public.service_read_reward_participation_review(uuid,uuid,integer,uuid)","public.service_save_reward_participation_review(uuid,uuid,integer,uuid,uuid,uuid,jsonb,text)"])
        assert.equal(await scalar(`select has_function_privilege('${role}','${fn}','EXECUTE')`),false);
    }
    assert.equal(await scalar(`select relrowsecurity from pg_class where oid='${table}'::regclass`),true);
    await assert.rejects(rewardParticipationReview(identity,10143,draftId,undefined,rpc),{code:"reward_planning_not_found"});
  });
}
