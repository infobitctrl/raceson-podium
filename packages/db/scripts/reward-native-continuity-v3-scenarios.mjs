import assert from "node:assert/strict";
import { nativeContinuityReviewV3 as review } from "../../../apps/api/dist/features/rewards/native-finale-continuity-service.js";
import { dispatchRewardPlanningRoutes } from "../../../apps/api/dist/routes/rewards/planning.js";
import { literal as q } from "./reward-integration-fixture.mjs";
const id = n => `8c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export async function nativeContinuityV3Scenarios({ harness, scenario, fixture }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness, { identity, draftId, raceId } = fixture;
  const read = (change, transport = rpc) => review(identity, 31337, draftId, change, transport);
  const args = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: 31337, p_draft_id: draftId, p_request_id: null };
  let initial, confirm, saved, held, writerArgs;
  const profiles = () => scalar("select encode(sha256(convert_to(jsonb_agg(to_jsonb(a) order by id)::text,'UTF8')),'hex') from public.athlete_profiles a");
  await scenario("native continuity saves exact links and reloads proposals without claiming profiles", async () => {
    await query(`update public.registrations set participation_status='finished' where id=${q(id(983011))}`);
    initial = await read(); assert.equal(initial.reviewState, "missing"); assert.equal(initial.proposedWei, "0");
    assert.equal(initial.options.athletes.length, 2); assert.equal(initial.sourceReady, true);
    const selection = { schema: "raceson-native-finale-continuity-v3", athletes: initial.options.athletes.map(a => ({ nativeAthleteId: a.id,
      target: { kind: initial.options.historicalAthletes.some(h => h.id === a.id) ? "historical" : "new_native", beneficiaryId: a.id } })), clubs: [],
      classifications: initial.options.rows.filter(r => r.finished).map(r => ({ resultId: r.id,
        categoryId: initial.options.categories.find(c => c.competitionId === r.competitionId).id })) };
    confirm = { requestId: id(984001), expectedReviewId: null, contextHash: initial.contextHash, selection, decision: "confirmed" };
    const before = await profiles();
    saved = await read(confirm, async (name, args) => { if (name === "service_review_reward_native_continuity_v3") writerArgs = structuredClone(args); return rpc(name, args); });
    assert.equal(saved.reviewState, "confirmed_selection"); assert.equal(saved.recordedReview.id, confirm.requestId);
    assert.ok(BigInt(saved.proposedWei) > 0n); assert.equal(saved.payableWei, "0"); assert.equal(saved.allocationApproved, false);
    assert.equal((await read()).review.id, saved.review.id); assert.equal(await profiles(), before);
  });
  await scenario("native continuity exact retry never reverses a subsequent stored hold", async () => {
    held = await read({ ...confirm, requestId: id(984002), expectedReviewId: confirm.requestId, decision: "held" });
    assert.equal(held.reviewState, "held"); assert.equal(held.proposedWei, "0");
    const retry = await read(confirm); assert.equal(retry.review.id, held.review.id); assert.equal(retry.recordedReview.id, confirm.requestId);
    assert.equal(retry.reviewState, "held");
    const sqlRetry = await rpc("service_review_reward_native_continuity_v3", writerArgs);
    assert.equal(sqlRetry.error, null); assert.equal(sqlRetry.data.review.id, held.review.id);
    await assert.rejects(read({ ...confirm, decision: "held" }), { code: "reward_continuity_conflict" });
    await assert.rejects(read({ ...confirm, requestId: id(984003) }), { code: "reward_continuity_conflict" });
    assert.equal(await scalar(`select count(*) from app_private.reward_native_continuity_reviews_v3 where draft_id=${q(draftId)}`), 2);
  });
  await scenario("native continuity rejects missing and foreign choices; concurrent review has one winner", async () => {
    const base = { ...confirm, expectedReviewId: held.review.id };
    await assert.rejects(read({ ...base, requestId: id(984004), selection: { ...confirm.selection, athletes: [] } }), { code: "reward_continuity_not_ready" });
    const foreign = structuredClone(confirm.selection); foreign.athletes[0].target = { kind: "historical", beneficiaryId: id(999999) };
    await assert.rejects(read({ ...base, requestId: id(984005), selection: foreign }), /invalid_reward_finale_continuity/);
    const attempts = await Promise.allSettled([984006, 984007].map(n => read({ ...base, requestId: id(n), decision: "held" })));
    assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(attempts.filter(r => r.status === "rejected")[0].reason.code, "reward_continuity_conflict"); held = await read();
  });
  await scenario("native source changes stale reviews and SQL rejects drift between read and write", async () => {
    const attempt = { ...confirm, requestId: id(984008), expectedReviewId: held.review.id, decision: "held" };
    await assert.rejects(read(attempt, async (name, args) => {
      if (name === "service_review_reward_native_continuity_v3") await query(`update public.result_rows set finish_time_ms=finish_time_ms+1 where id=${q(id(983021))}`);
      return rpc(name, args);
    }), { code: "reward_planning_revision_changed" });
    const stale = await read(); assert.equal(stale.reviewState, "stale"); assert.equal(stale.proposedWei, "0"); assert.notEqual(stale.contextHash, initial.contextHash);
    const retry = await read(confirm); assert.equal(retry.reviewState, "stale"); assert.equal(retry.recordedReview.id, confirm.requestId);
    assert.equal(await scalar(`select count(*) from app_private.reward_native_continuity_reviews_v3 where id=${q(id(984008))}`), 0);
  });
  await scenario("native continuity rechecks revoked Auth after actual category lock wait", async () => {
    const release = await lock(`select id from public.event_categories where id=${q(raceId)} for update`);
    const pending = assert.rejects(read(), { code: "reward_account_session_required" }); pending.catch(() => {});
    try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
    finally { await release(); } await pending;
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
  });
  await scenario("native continuity HTTP is private and SQL invoker functions deny browser roles", async () => {
    const res = {};
    await dispatchRewardPlanningRoutes({ method: "GET" }, res, new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${draftId}/native-continuity`), {
      config: () => ({ chainId: 31337 }), requireIdentity: async () => identity, rpc,
      applyPrivateSessionHeaders: () => res.private = true, sendSuccess: (_, data) => Object.assign(res, { status: 200, data }), sendError: (_, status, code) => Object.assign(res, { status, code }) });
    assert.equal(res.status, 200); assert.equal(res.private, true); assert.equal(res.data.reviewState, "stale");
    assert.doesNotMatch(JSON.stringify(res.data), /date_of_birth|claimed_by|password|email|complaint_text|guardHash|context_text|walletAddress/);
    for (const sig of ["public.service_read_reward_native_continuity_v3(uuid,uuid,integer,uuid,uuid)", "public.service_review_reward_native_continuity_v3(uuid,uuid,integer,uuid,uuid,uuid,text,text,jsonb,text)"]) {
      assert.equal(await scalar(`select prosecdef from pg_proc where oid=${q(sig)}::regprocedure`), false);
      for (const role of ["anon", "authenticated"]) assert.equal(await scalar(`select has_function_privilege('${role}',${q(sig)},'EXECUTE')`), false);
    }
    for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin;set local role ${role};${rpcSql("service_read_reward_native_continuity_v3", args)}rollback;`), /permission denied/);
    const positive = JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;${rpcSql("service_read_reward_native_continuity_v3", args)}rollback;`));
    assert.equal(positive.native.document.draftId, draftId);
    await assert.rejects(query(`update app_private.reward_native_continuity_reviews_v3 set decision='confirmed' where id=${q(confirm.requestId)}`), /immutable/);
  });
}
