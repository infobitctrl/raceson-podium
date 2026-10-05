import assert from "node:assert/strict";
import { readNativeFinaleSourceV3, rewardResultReviewV3 } from "../dist/rewards/index.js";
import { dispatchRewardPlanningRoutes } from "../../../apps/api/dist/routes/rewards/planning.js";
import { literal as q } from "./reward-integration-fixture.mjs";
const id = n => `8c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Native result rows and short review clocks exist only in the parent's owned
// disposable database. No copied real source decision, identity link or payout.
export async function nativeFinaleV3Scenarios({ harness, scenario, fixture }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  const { identity, draftId, editionId, raceId } = fixture;
  const args = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: 31337, p_draft_id: draftId };
  const read = () => readNativeFinaleSourceV3(identity, 31337, draftId, rpc);
  const importHash = await scalar(`select encode(sha256(convert_to(payload::text,'UTF8')),'hex') from app_private.reward_public_snapshots_v2 where season_id=${q(id(3))}`);
  const publish = (n, state, parent = null, runId = id(983001)) => query(`insert into public.result_publications(id,event_category_id,result_run_id,
    publication_state,published_by_user_id,supersedes_publication_id,change_note) values(${q(id(n))},${q(raceId)},${q(runId)},${q(state)},
    ${q(identity.userId)},${q(parent)},'Synthetic native finale inspection');`);
  let final;
  await scenario("native finale reader starts held and reads only bound same-organization races", async () => {
    const before = await read(); assert.equal(before.inspection.state, "held"); assert.equal(before.inspection.resultCount, 0);
    assert.equal(before.document.races[0].raceId, raceId); assert.equal(before.document.races[0].review.state, "unconfigured");
    await assert.rejects(readNativeFinaleSourceV3(identity, 10143, draftId, rpc), { code: "reward_planning_not_found" });
    await query(`update public.event_editions set status='completed' where id=${q(editionId)};
      update public.event_categories set status='completed' where id=${q(raceId)};
      insert into public.result_runs(id,event_category_id,trigger_type,status,started_at,completed_at)
      values(${q(id(983001))},${q(raceId)},'manual','succeeded',clock_timestamp()-interval '1 hour',clock_timestamp());
      insert into public.registrations(id,event_category_id,athlete_profile_id,status,participation_status,result_status,source)
      select ('8c000000-0000-4000-8000-'||lpad((983010+row_number()over(order by a.id))::text,12,'0'))::uuid,
        ${q(raceId)},a.id,'confirmed',case when row_number()over(order by a.id)=1 then 'finished' else 'dnf' end::public.participation_status,
        'official','direct' from (select id from public.athlete_profiles where id::text like '8c000000-%' order by id limit 2) a;
      insert into public.result_rows(id,result_run_id,registration_id,athlete_profile_id,event_category_id,result_status,finish_time_ms,rank_overall)
      select ('8c000000-0000-4000-8000-'||lpad((983020+row_number()over(order by r.id))::text,12,'0'))::uuid,
        ${q(id(983001))},r.id,r.athlete_profile_id,${q(raceId)},'official',case when r.participation_status='finished' then 1800000 end,
        case when r.participation_status='finished' then 1 end from public.registrations r where r.event_category_id=${q(raceId)};`);
    await rewardResultReviewV3(identity, raceId, { expectedRevision: 0, reviewSeconds: 1 }, rpc);
    await publish(983030, "provisional"); assert.equal((await read()).inspection.state, "held");
    await query("select pg_sleep(1.05)"); await publish(983031, "official");
  });
  await scenario("actual native final publication supplies all rows, exact server clock and a stable private HTTP observation", async () => {
    final = await read(); assert.equal(final.inspection.state, "final_source_observed"); assert.equal(final.inspection.finishedCount, 1);
    assert.equal(final.inspection.resultCount, 2); assert.equal(final.inspection.observedFinishedMetres, "5000");
    assert.equal(final.inspection.payableWei, "0"); assert.equal(final.document.races[0].review.reviewSeconds, 1);
    assert.equal((await read()).sourceHash, final.sourceHash);
    const res = {};
    assert.equal(await dispatchRewardPlanningRoutes({ method: "GET" }, res,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${draftId}/native-finale`), {
        config: () => ({ chainId: 31337 }), requireIdentity: async () => identity, rpc,
        applyPrivateSessionHeaders: () => res.private = true, sendSuccess: (_, data) => Object.assign(res, { status: 200, data }),
        sendError: (_, status, code) => Object.assign(res, { status, code }) }), true);
    assert.equal(res.private, true); assert.equal(res.status, 200); assert.equal(res.data.sourceHash, final.sourceHash);
    assert.doesNotMatch(JSON.stringify(res.data), /date_of_birth|birthYear|password|email|complaint_text|wallet|Synthetic private/);
  });
  await scenario("new native complaints and corrections invalidate observations without altering the four-round import", async () => {
    await query(`insert into public.result_complaints(id,event_category_id,complainant_name,complaint_text,created_by_user_id)
      values(${q(id(983040))},${q(raceId)},'Synthetic private runner','Synthetic private complaint',${q(identity.userId)});`);
    const held = await read(); assert.equal(held.inspection.state, "held"); assert.notEqual(held.sourceHash, final.sourceHash);
    assert.doesNotMatch(JSON.stringify(held), /Synthetic private/);
    await query(`update public.result_complaints set status='resolved',resolved_by_user_id=${q(identity.userId)},resolved_at=clock_timestamp()
      where id=${q(id(983040))};`);
    assert.equal((await read()).sourceHash, final.sourceHash);
    await publish(983032, "corrected", id(983031));
    const corrected = await read(); assert.notEqual(corrected.sourceHash, final.sourceHash);
    assert.equal(corrected.document.races[0].publication.id, id(983032)); assert.equal(corrected.inspection.state, "final_source_observed");
    await query(`update public.registrations set participation_status='dnf' where id=${q(id(983011))}`);
    assert.notEqual((await read()).sourceHash, corrected.sourceHash);
    assert.equal(await scalar(`select encode(sha256(convert_to(payload::text,'UTF8')),'hex') from app_private.reward_public_snapshots_v2 where season_id=${q(id(3))}`), importHash);
  });
  await scenario("native source Auth is rechecked after a genuine category lock wait", async () => {
    const release = await lock(`select id from public.event_categories where id=${q(raceId)} for update`);
    const pending = assert.rejects(read(), { code: "reward_account_session_required" }); pending.catch(() => {});
    try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
    finally { await release(); } await pending;
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
  });
  await scenario("native source functions are invoker-only and unavailable to browser roles", async () => {
    for (const signature of ["public.service_read_reward_native_finale_v3(uuid,uuid,integer,uuid)", "app_private.reward_native_finale_document_v3(uuid,jsonb)"]) {
      assert.equal(await scalar(`select prosecdef from pg_proc where oid=${q(signature)}::regprocedure`), false);
      for (const role of ["anon", "authenticated"]) assert.equal(await scalar(`select has_function_privilege('${role}',${q(signature)},'EXECUTE')`), false);
    }
    for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin;set local role ${role};${rpcSql("service_read_reward_native_finale_v3", args)}rollback;`), /permission denied/);
    const positive = JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;${rpcSql("service_read_reward_native_finale_v3", args)}rollback;`));
    assert.equal(positive.document.draftId, draftId);
  });
}
