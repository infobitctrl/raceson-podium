import assert from "node:assert/strict";
import { leaguePolicyWorkspaceV3 as review } from "../../../apps/api/dist/features/rewards/league-policy-v3-service.js";
import { nativeContinuityReviewV3 } from "../../../apps/api/dist/features/rewards/native-finale-continuity-service.js";
import { rewardHistoricalSourceV3 } from "../dist/rewards/historical-source-v3.js";
import { dispatchRewardPlanningRoutes } from "../../../apps/api/dist/routes/rewards/planning.js";
import { literal as q } from "./reward-integration-fixture.mjs";
const id = n => `8c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export async function leaguePolicyV3Scenarios({ harness, scenario, fixture }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness, { identity, draftId, raceId } = fixture;
  const run = (change, transport = rpc) => review(identity, 31337, draftId, change, transport);
  let initial, selected, request, writerArgs;
  const args = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: 31337, p_draft_id: draftId, p_request_id: null };
  await scenario("league policy persists a versioned selection without final-publication or payout authority", async () => {
    initial = await run(); assert.equal(initial.reviewState, "missing"); assert.equal(initial.proposal, null);
    const policy = { schema: "raceson-league-scoring-policy-v3", categories: initial.categories.filter(c => c.target === "individual")
      .map(c => ({ categoryId: c.id, points: [100, 80, 60], participationPoints: 1, bestN: 4, minimumRounds: 2, tieBreak: "best_finish" })),
      club: { categoryId: initial.categories.find(c => c.target === "club").id, membersPerRound: 3 } };
    request = { requestId: id(985001), expectedReviewId: null, contextHash: initial.contextHash, policy, decision: "selected" };
    selected = await run(request, async (name, args) => { if (name === "service_review_reward_league_policy_v3") writerArgs = structuredClone(args); return rpc(name, args); });
    assert.equal(selected.reviewState, "selected"); assert.equal(selected.proposal.state, "held", "previous continuity hold is not bypassed");
    assert.equal(selected.finalPublished, false); assert.equal(selected.allocationApproved, false); assert.equal(selected.payableWei, "0");
    assert.equal((await run()).review.id, request.requestId);
  });
  await scenario("current official sources and continuity feed persisted-policy proposal; refresh is stable", async () => {
    let h = await rewardHistoricalSourceV3(identity, 31337, draftId, undefined, rpc);
    // Synthetic fixture only: explicit ordinary source-review commands.
    for (let slot = 1; slot <= 4; slot++) {
      const previous = h.decisions.find(d => d.slot === slot);
      h = await rewardHistoricalSourceV3(identity, 31337, draftId, { slot, requestId: id(985010 + slot), expectedReviewId: previous?.id ?? null,
        contextHash: h.contextHash, decision: "confirmed_final" }, rpc);
    }
    const native = await nativeContinuityReviewV3(identity, 31337, draftId, undefined, rpc);
    await nativeContinuityReviewV3(identity, 31337, draftId, { requestId: id(985020), expectedReviewId: native.review.id,
      contextHash: native.contextHash, selection: native.review.selection, decision: "confirmed" }, rpc);
    const current = await run(); assert.equal(current.contextHash, selected.contextHash); assert.equal(current.review.id, request.requestId);
    assert.equal(current.proposal.state, "unapproved_proposal"); assert.ok(current.proposal.athleteTables.length > 0);
    assert.equal(current.proposal.clubTables.length, 6); assert.equal(current.proposal.finalPublished, false);
    assert.equal((await run()).proposalHash, current.proposalHash);
  });
  await scenario("league policy exact replay cannot undo a hold and concurrent changes have one winner", async () => {
    const held = await run({ ...request, requestId: id(985002), expectedReviewId: request.requestId, decision: "held" });
    const retry = await run(request); assert.equal(retry.review.id, held.review.id); assert.equal(retry.recordedReview.id, request.requestId); assert.equal(retry.proposal, null);
    assert.equal((await rpc("service_review_reward_league_policy_v3", writerArgs)).error, null);
    await assert.rejects(run({ ...request, decision: "held" }), { code: "reward_league_policy_conflict" });
    const attempts = await Promise.allSettled([985003, 985004].map(n => run({ ...request, requestId: id(n), expectedReviewId: held.review.id })));
    assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(attempts.filter(r => r.status === "rejected")[0].reason.code, "reward_league_policy_conflict");
  });
  await scenario("policy SQL rejects source drift between read and write without a partial revision", async () => {
    const current = await run(), c = { ...request, requestId: id(985005), expectedReviewId: current.review.id, contextHash: current.contextHash };
    await assert.rejects(run(c, async (name, args) => {
      if (name === "service_review_reward_league_policy_v3") await query(`update public.result_rows set finish_time_ms=finish_time_ms+1 where id=${q(id(983021))}`);
      return rpc(name, args);
    }), { code: "reward_planning_revision_changed" });
    assert.equal(await scalar(`select count(*) from app_private.reward_league_policy_reviews_v3 where id=${q(c.requestId)}`), 0);
    const after = await run(); assert.equal(after.reviewState, "selected"); assert.equal(after.proposal.state, "held");
    assert.deepEqual(after.proposal.athleteTables, []);
  });
  await scenario("policy read rechecks current Auth after a real category lock wait", async () => {
    const release = await lock(`select id from public.event_categories where id=${q(raceId)} for update`);
    const pending = assert.rejects(run(), { code: "reward_account_session_required" }); pending.catch(() => {});
    try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
    finally { await release(); } await pending;
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
  });
  await scenario("policy grants, RLS, immutability and private HTTP projection remain isolated", async () => {
    const res = {};
    await dispatchRewardPlanningRoutes({ method: "GET" }, res, new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${draftId}/league-policy`), {
      config: () => ({ chainId: 31337 }), requireIdentity: async () => identity, rpc, applyPrivateSessionHeaders: () => res.private = true,
      sendSuccess: (_, data) => Object.assign(res, { status: 200, data }), sendError: (_, status, code) => Object.assign(res, { status, code }) });
    assert.equal(res.status, 200); assert.equal(res.private, true);
    assert.doesNotMatch(JSON.stringify(res.data), /date_of_birth|claimed_by|password|email|complaint_text|guardHash|context_text|walletAddress/);
    const table = "app_private.reward_league_policy_reviews_v3";
    assert.equal(await scalar(`select relrowsecurity from pg_class where oid=${q(table)}::regclass`), true);
    for (const sig of ["public.service_read_reward_league_policy_v3(uuid,uuid,integer,uuid,uuid)",
      "public.service_review_reward_league_policy_v3(uuid,uuid,integer,uuid,uuid,uuid,text,text,jsonb,text)"]) {
      assert.equal(await scalar(`select prosecdef from pg_proc where oid=${q(sig)}::regprocedure`), false);
      for (const role of ["anon", "authenticated"]) assert.equal(await scalar(`select has_function_privilege('${role}',${q(sig)},'EXECUTE')`), false);
    }
    for (const role of ["anon", "authenticated"]) {
      for (const action of ["SELECT", "INSERT", "UPDATE", "DELETE"]) assert.equal(await scalar(`select has_table_privilege('${role}',${q(table)},'${action}')`), false);
      await assert.rejects(query(`begin;set local role ${role};${rpcSql("service_read_reward_league_policy_v3", args)}rollback;`), /permission denied/);
    }
    await assert.rejects(query(`update ${table} set decision='selected' where id=${q(request.requestId)}`), /immutable/);
    await assert.rejects(query(`delete from ${table} where id=${q(request.requestId)}`), /immutable/);
  });
}
