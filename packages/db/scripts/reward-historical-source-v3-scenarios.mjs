import assert from "node:assert/strict";
import { rewardHistoricalSourceV3 } from "../dist/rewards/index.js";
import { createDefaultRewardProgrammeDraftV2 } from "../../domain/dist/rewards/programme-draft-v2.js";
import { publishedSnapshot, publishedMapping } from "../../../apps/api/test/fixtures/published-reward-v2.mjs";
import { integrationFixtureSql, literal as q } from "./reward-integration-fixture.mjs";
const id = n => `8b000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export async function historicalSourceV3Scenarios({ harness, scenario }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  await query(integrationFixtureSql().replaceAll("78000000-", "8b000000-")
    .replaceAll("reward-integration", "historical-v3-integration").replaceAll("Synthetic ", "Synthetic historical V3 ")
    .replaceAll("synthetic-round-", "synthetic-historical-v3-round-")
    .replaceAll("reward-operator@example.invalid", "historical-operator@example.invalid")
    .replaceAll("reward-successor@example.invalid", "historical-successor@example.invalid"));
  const identity = { userId: id(4), sessionId: id(980001) }, draftId = id(980000);
  const snapshot = publishedSnapshot(); snapshot.results.forEach((r, i) => r.clubId = snapshot.clubs[i % 2].clubId);
  const args = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: 31337, p_draft_id: draftId };
  await query(`insert into auth.sessions(id,user_id,not_after) values(${q(identity.sessionId)},${q(identity.userId)},clock_timestamp()+interval '1 hour');
    insert into app_private.reward_planning_drafts(id,organization_id,season_id,chain_id,rules,updated_by_user_id)
      values(${q(draftId)},${q(id(1))},${q(id(3))},31337,${q(JSON.stringify(createDefaultRewardProgrammeDraftV2()))}::jsonb,${q(identity.userId)});
    insert into app_private.reward_public_snapshots_v2(season_id,organization_id,payload,source_hash)
      values(${q(id(3))},${q(id(1))},${q(JSON.stringify(snapshot))}::jsonb,repeat('0',64));
    select public.service_save_reward_mapping_v2(${q(identity.userId)},${q(identity.sessionId)},31337,${q(draftId)},0,1,
      (public.service_read_reward_mapping_v2(${q(identity.userId)},${q(identity.sessionId)},31337,${q(draftId)})->>'catalogueHash'),${q(JSON.stringify(publishedMapping()))}::jsonb);`);
  const read = () => rewardHistoricalSourceV3(identity, 31337, draftId, undefined, rpc);
  const save = change => rewardHistoricalSourceV3(identity, 31337, draftId, change, rpc);
  const table = "app_private.reward_historical_source_reviews_v3";
  const count = () => scalar(`select count(*) from ${table} where draft_id=${q(draftId)}`);
  const sqlDecision = change => rpcSql("service_review_reward_historical_source_v3", { ...args, p_slot: change.slot, p_request_id: change.requestId,
    p_expected_review_id: change.expectedReviewId, p_context_hash: change.contextHash, p_decision: change.decision });
  let first, latest;
  await scenario("historical V3 decisions use actual immutable imported evidence and recompute four-round proposals", async () => {
    const initial = await read(); assert.equal(initial.preview.proposedWei, 0n); assert.equal(initial.decisions.length, 0);
    first = { slot: 1, requestId: id(980010), expectedReviewId: null, contextHash: initial.contextHash, decision: "confirmed_final" };
    const [a, b] = await Promise.all([save(first), save(first)]);
    assert.deepEqual(a.recordedDecision, b.recordedDecision); assert.equal(await count(), 1);
    assert.ok(a.preview.rounds[0].proposedWei > 0n); assert.equal(a.preview.league.proposedWei, 0n); assert.equal(a.preview.rounds[4].proposedWei, 0n);
    assert.equal(a.preview.payableWei, 0n);
    assert.doesNotMatch(JSON.stringify(a.source), /athleteName|clubName|reviewSeconds|startedAt|wallet/);
    assert.equal(await scalar(`select count(*) from app_private.reward_result_review_policies_v3 where organization_id=${q(id(1))}`), 0);
    assert.equal(await scalar(`select context->>'sourceHash' from ${table} where id=${q(first.requestId)}`), initial.sourceHash);
    assert.equal(await scalar(`select context#>>'{record,organizationId}' from ${table} where id=${q(first.requestId)}`), id(1));
  });
  await scenario("simultaneous opposite source decisions use CAS; exact old retry cannot undo a subsequent hold", async () => {
    const a = { ...first, requestId: id(980011), expectedReviewId: first.requestId, decision: "held" };
    const b = { ...a, requestId: id(980012), decision: "confirmed_final" };
    const results = await Promise.allSettled([save(a), save(b)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.find(r => r.status === "rejected").reason.code, "reward_historical_review_conflict");
    const current = await read();
    latest = { ...a, requestId: id(980013), expectedReviewId: current.decisions[0].id };
    await save(latest);
    const recovered = await save(first); assert.equal(recovered.recordedDecision.id, first.requestId);
    assert.equal(recovered.decisions[0].id, latest.requestId); assert.equal(recovered.preview.proposedWei, 0n);
    await assert.rejects(save({ ...first, decision: "held" }), { code: "reward_historical_review_conflict" });
    assert.equal(await count(), 3);
  });
  await scenario("changed economic revision invalidates historical source review and rejects stale new decisions", async () => {
    await query(`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)};`);
    assert.equal((await read()).decisions[0].current, false);
    const retry = await save(first); assert.equal(retry.recordedDecision.current, false);
    await assert.rejects(save({ ...latest, requestId: id(980014), expectedReviewId: latest.requestId }), { code: "reward_planning_revision_changed" });
    await query(`update app_private.reward_planning_drafts set revision=revision-1 where id=${q(draftId)};`);
  });
  await scenario("source-review lock wait cannot preserve revoked session authority or write an orphan decision", async () => {
    const before = await count(), release = await lock(`select id from app_private.reward_planning_drafts where id=${q(draftId)} for update`);
    const pending = assert.rejects(query(sqlDecision({ ...latest, requestId: id(980015), expectedReviewId: latest.requestId })), /reward_account_session_required/);
    pending.catch(() => {});
    try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)};`); }
    finally { await release(); }
    await pending; assert.equal(await count(), before);
    await assert.rejects(read(), { code: "reward_account_session_required" });
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)};`);
  });
  await scenario("source-review insert rechecks context; trigger-induced changes roll back both records", async () => {
    const before = await count();
    await assert.rejects(query(`begin;
      create function pg_temp.synthetic_historical_drift() returns trigger language plpgsql as $$ begin
        update app_private.reward_planning_drafts set revision=revision+1 where id=${q(draftId)}; return new; end $$;
      create trigger synthetic_historical_drift after insert on ${table} for each row execute function pg_temp.synthetic_historical_drift();
      ${sqlDecision({ ...latest, requestId: id(980016), expectedReviewId: latest.requestId })} rollback;`), /reward_planning_revision_changed/);
    assert.equal(await count(), before); assert.equal((await read()).record.revision, 1);
  });
  await scenario("historical decisions are immutable and service-only; RLS also works without bypass and cross-scope reads fail", async () => {
    assert.equal(await scalar(`select relrowsecurity from pg_class where oid='${table}'::regclass`), true);
    await assert.rejects(query(`update ${table} set decision=decision`), /reward_result_review_immutable/);
    await assert.rejects(query(`delete from ${table}`), /reward_result_review_immutable/);
    for (const role of ["anon", "authenticated"]) {
      assert.equal(await scalar(`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE')`), false);
      for (const fn of ["public.service_read_reward_historical_source_v3(uuid,uuid,integer,uuid)", "public.service_review_reward_historical_source_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text)"]) {
        assert.equal(await scalar(`select has_function_privilege('${role}','${fn}','EXECUTE')`), false);
        assert.equal(await scalar(`select prosecdef from pg_proc where oid='${fn}'::regprocedure`), false);
      }
      await assert.rejects(query(`begin;set local role ${role};${rpcSql("service_read_reward_historical_source_v3", args)}rollback;`), /permission denied/);
    }
    const roleBefore = await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
    assert.equal(Number(await query(`begin;alter role service_role nobypassrls;set local role service_role;select count(*) from ${table};rollback;`)), await count());
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
    await assert.rejects(rewardHistoricalSourceV3(identity, 10143, draftId, undefined, rpc), { code: "reward_planning_not_found" });
    await assert.rejects(query(sqlDecision({ ...latest, slot: 5, requestId: id(980017), expectedReviewId: null })), /invalid_reward_historical_source/);
    await query(`update public.organization_memberships set expires_at=clock_timestamp()-interval '1 second' where organization_id=${q(id(1))};`);
    await assert.rejects(read(), { code: "reward_planning_not_found" });
  });
}
