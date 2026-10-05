import assert from "node:assert/strict";
import { rewardResultReviewV3 } from "../dist/rewards/index.js";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal as q } from "./reward-integration-fixture.mjs";

// Synthetic-only fixtures in the parent validator's disposable database.
export async function resultReviewV3Scenarios({harness,scenario}) {
  const {query,scalar,rpc,rpcSql,lock,waiting}=harness;
  const identity={userId:id(4),sessionId:id(970999)};
  const race=n=>id(971000+n),run=n=>id(972000+n),pub=n=>id(973000+n);
  const read=n=>rewardResultReviewV3(identity,race(n),undefined,rpc);
  const save=(n,seconds,revision=0)=>rewardResultReviewV3(identity,race(n),{expectedRevision:revision,reviewSeconds:seconds},rpc);
  const publish=(n,p,state="provisional",parent=null)=>`insert into public.result_publications(id,event_category_id,result_run_id,publication_state,
    published_by_user_id,published_at,supersedes_publication_id,change_note) values(${q(pub(p))},${q(race(n))},${q(run(n))},${q(state)},${q(id(4))},
    '2020-01-01T00:00:00Z',${q(parent)},'Synthetic local V3 review test');`;
  await query(`insert into auth.sessions(id,user_id,not_after) values(${q(identity.sessionId)},${q(identity.userId)},clock_timestamp()+interval '1 hour');
    insert into public.event_editions(id,event_series_id,slug,name,start_date,status) values(${q(id(970000))},${q(id(11))},
      'synthetic-v3-review','Synthetic V3 review tests','2026-09-09','completed');
    ${Array.from({length:14},(_,i)=>`insert into public.event_categories(id,event_edition_id,slug,name,distance_km,status)
      values(${q(race(i))},${q(id(970000))},'review-${i}','Synthetic review ${i}',5,'completed');
      insert into public.result_runs(id,event_category_id,trigger_type,status,started_at,completed_at)
      values(${q(run(i))},${q(race(i))},'manual','succeeded',clock_timestamp()-interval '1 hour',clock_timestamp());`).join("\n")}`);

  await scenario("V3 service-only review policies are explicit, revisioned, scoped and not retrofitted onto historical results",async()=>{
    assert.equal((await read(0)).state,"unconfigured");
    const a=await save(0,86400);assert.equal(a.state,"awaiting_provisional");assert.equal(a.revision,1);assert.equal(a.allocationApproved,false);
    assert.equal((await save(0,86400,1)).revision,1);assert.equal((await save(0,3600,1)).revision,2);
    await assert.rejects(save(0,0,1),{code:"reward_result_review_revision_changed"});
    for(const seconds of[-1,2592001])await assert.rejects(save(0,seconds,2),{code:"invalid_reward_result_review"});
    await query(publish(1,1,"official"));assert.equal((await read(1)).state,"unconfigured");
    await assert.rejects(save(1,0),{code:"reward_result_review_locked"});
    assert.equal(await scalar(`select count(*) from app_private.reward_result_review_clocks_v3 where event_category_id=${q(race(1))}`),0);
    await assert.rejects(rewardResultReviewV3({...identity,userId:id(5)},race(0),undefined,rpc),{code:"reward_account_session_required"});
  });
  await scenario("V3 provisional publication owns its start; early final and shortening fail without changing original clock",async()=>{
    await query(publish(0,2));const before=await read(0);assert.equal(before.state,"in_review");assert.equal(before.locked,true);
    assert.ok(Date.parse(before.startedAt)>Date.parse("2026-01-01T00:00:00Z"),"Caller backdate was ignored");
    assert.equal(Date.parse(before.endsAt)-Date.parse(before.startedAt),3600000);
    await assert.rejects(save(0,0,2),{code:"reward_result_review_locked"});
    await assert.rejects(query(publish(0,3,"official")),/reward_result_review_not_finished/);
    await query(publish(0,4));const again=await read(0);assert.equal(again.startedAt,before.startedAt);assert.equal(again.startedByPublicationId,pub(2));
    assert.equal(await scalar(`select count(*) from public.result_publications where id=${q(pub(3))}`),0);
  });
  await scenario("V3 explicit zero publishes final immediately, while corrections and new holds invalidate current evidence",async()=>{
    await save(2,0);await query(publish(2,10,"official"));const final=await read(2);
    assert.equal(final.state,"final");assert.equal(final.finalPublicationId,pub(10));assert.equal(final.startedAt,final.officialPublishedAt);
    assert.equal(final.allocationApproved,false);
    await query(publish(2,11,"corrected",pub(10)));const corrected=await read(2);
    assert.equal(corrected.finalPublicationId,pub(11));assert.equal(corrected.startedAt,final.startedAt);
    await query(`insert into public.result_complaints(id,event_category_id,complainant_name,complaint_text,created_by_user_id)
      values(${q(id(974000))},${q(race(2))},'Synthetic private runner','Private synthetic complaint must not leave SQL',${q(id(4))});`);
    const held=await read(2);assert.equal(held.state,"held");assert.equal(held.finalPublicationId,null);assert.ok(!JSON.stringify(held).includes("Private synthetic"));
    await assert.rejects(query(publish(2,12,"corrected",pub(11))),/reward_result_review_held/);
    await query(`update public.result_complaints set status='resolved',resolved_by_user_id=${q(id(4))},resolved_at=clock_timestamp() where id=${q(id(974000))};`);
    await query(publish(2,13,"provisional"));assert.equal((await read(2)).state,"awaiting_final");
    await query(publish(2,14,"corrected",pub(11)));assert.equal((await read(2)).finalPublicationId,pub(14));
    assert.equal(await scalar(`select count(*) from app_private.reward_final_publication_evidence_v3 where event_category_id=${q(race(2))}`),3);
  });
  await scenario("V3 completed one-hour, 24-hour and 48-hour fixture clocks permit final publication without a second wait",async()=>{
    // Immutable synthetic past rows, not an API time override or a public-chain
    // bypass. Normal RPC explicitly refuses this historical backfill above.
    for(const[n,seconds]of[[3,3600],[4,86400],[5,172800]]){
      await query(publish(n,20+n));
      await query(`insert into app_private.reward_result_review_policies_v3(id,event_category_id,organization_id,revision,review_seconds,configured_at,configured_by_user_id)
        values(${q(id(975000+n))},${q(race(n))},${q(id(1))},1,${seconds},'2019-12-31T00:00:00Z',${q(id(4))});
        insert into app_private.reward_result_review_clocks_v3(event_category_id,policy_id,started_by_publication_id,started_at)
        values(${q(race(n))},${q(id(975000+n))},${q(pub(20+n))},'2020-01-01T00:00:00Z');`);
      assert.equal((await read(n)).state,"awaiting_final");
      await query(publish(n,30+n,"official"));const final=await read(n);
      assert.equal(final.state,"final");assert.equal(final.reviewSeconds,seconds);assert.equal(final.allocationApproved,false);
    }
    await save(6,1);await query(publish(6,40));await query("select pg_sleep(1.05);");
    assert.equal((await read(6)).state,"awaiting_final");await query(publish(6,41,"official"));assert.equal((await read(6)).state,"final");
    await save(7,86400);await assert.rejects(query(publish(7,42,"official")),/reward_result_review_not_finished/);
    assert.equal((await read(7)).startedAt,null);
  });
  await scenario("V3 open adjudication prevents final publication and never exports restricted evidence",async()=>{
    await save(8,0);
    await query(`insert into public.result_adjudication_cases(id,organization_id,event_category_id,case_number,case_type,submitted_by_source,
      rule_reference,claim_summary,public_summary,response_deadline,client_event_id,restricted_evidence_json)
      values(${q(id(976000))},${q(id(1))},${q(race(8))},'V3-SYNTHETIC','protest','official','Synthetic rule','Synthetic claim','Synthetic notice',
        clock_timestamp()+interval '1 hour',${q(id(976001))},'{"private":"never expose"}');`);
    await assert.rejects(query(publish(8,50,"official")),/reward_result_review_held/);
    assert.equal((await read(8)).state,"held");
    await query(`update public.result_adjudication_cases set case_state='withdrawn' where id=${q(id(976000))};`);
    await query(publish(8,51,"official"));assert.equal((await read(8)).state,"final");
  });
  await scenario("V3 compare-and-swap and Auth are rechecked after real overlapping database locks",async()=>{
    const results=await Promise.allSettled([save(9,0),save(9,86400)]);
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(results.find(r=>r.status==="rejected").reason.code,"reward_result_review_revision_changed");
    const release=await lock(`select id from public.event_categories where id=${q(race(10))} for update`);
    const pending=assert.rejects(save(10,0),{code:"reward_account_session_required"});pending.catch(()=>{});
    try{await waiting(1);await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)};`)}finally{await release()}
    await pending;assert.equal(await scalar(`select count(*) from app_private.reward_result_review_policies_v3 where event_category_id=${q(race(10))}`),0);
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)};`);
  });
  await scenario("V3 final publication sees a concurrent complaint before committing evidence",async()=>{
    await save(11,0);
    const release=await lock(`insert into public.result_complaints(id,event_category_id,complainant_name,complaint_text,created_by_user_id)
      values(${q(id(974001))},${q(race(11))},'Synthetic','Synthetic concurrency complaint',${q(id(4))});`);
    const pending=assert.rejects(query(publish(11,60,"official")),/reward_result_review_held/);pending.catch(()=>{});
    try{await waiting(1)}finally{await release()}await pending;
    assert.equal(await scalar(`select count(*) from app_private.reward_final_publication_evidence_v3 where event_category_id=${q(race(11))}`),0);
  });
  await scenario("V3 private tables are append-only with RLS and explicit invoker-only service grants",async()=>{
    // The plain PostgreSQL harness creates a NO-BYPASS service_role stub.
    // Match Supabase only inside a rolled-back grant test, never change the
    // shared role permanently or weaken the migration's invoker/RLS boundary.
    const roleBefore=await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
    const positive=JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;
      ${rpcSql("service_save_reward_result_review_policy_v3",{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,
        p_category_id:race(13),p_expected_revision:0,p_review_seconds:86400})}rollback;`));
    assert.equal(positive.reviewSeconds,86400);assert.equal(positive.state,"awaiting_provisional");
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
    assert.equal((await read(13)).revision,0);
    for(const table of["reward_result_review_policies_v3","reward_result_review_clocks_v3","reward_final_publication_evidence_v3"]){
      assert.equal(await scalar(`select relrowsecurity from pg_class where oid='app_private.${table}'::regclass`),true);
      for(const role of["anon","authenticated"]){assert.equal(await scalar(`select has_table_privilege('${role}','app_private.${table}','SELECT,INSERT,UPDATE,DELETE')`),false)}
      await assert.rejects(query(`update app_private.${table} set ${table==="reward_final_publication_evidence_v3"?"publication_id=publication_id":"event_category_id=event_category_id"}`),/reward_result_review_immutable/);
      await assert.rejects(query(`delete from app_private.${table}`),/reward_result_review_immutable/);
    }
    const functionName="public.service_read_reward_result_review_v3(uuid,uuid,uuid)";
    assert.equal(await scalar(`select prosecdef from pg_proc where oid='${functionName}'::regprocedure`),false);
    for(const role of["anon","authenticated"]){
      assert.equal(await scalar(`select has_function_privilege('${role}','${functionName}','EXECUTE')`),false);
      await assert.rejects(query(`begin;set local role ${role};${rpcSql("service_read_reward_result_review_v3",{
        p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_category_id:race(0)})}rollback;`),/permission denied/);
    }
  });
}
