import assert from "node:assert/strict";
import { rewardFinaleBindingV3, rewardHistoricalSourceV3, rewardProgrammeApprovalV3, rewardProgrammeDeploymentV3,
  readRewardSourceMappingV2, saveRewardSourceMappingV2, readRewardPublishedPreviewV2 } from "../dist/rewards/index.js";
import { createDefaultRewardProgrammeDraftV2 } from "../../domain/dist/rewards/programme-draft-v2.js";
import { programmeApprovalMissingSlotsV3 } from "../../domain/dist/rewards/programme-approval-v3.js";
import { publishedSnapshot, publishedMapping } from "../../../apps/api/test/fixtures/published-reward-v2.mjs";
import { integrationFixtureSql, literal as q } from "./reward-integration-fixture.mjs";
import { fixtureSigner } from "../../rewards-chain/integration/owned-chain.mjs";
const id = n => `8c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export async function finaleBindingV3Scenarios({ harness, scenario }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  await query(integrationFixtureSql().replaceAll("78000000-", "8c000000-")
    .replaceAll("reward-integration", "finale-v3-integration").replaceAll("Synthetic ", "Synthetic finale V3 ")
    .replaceAll("synthetic-round-", "synthetic-finale-v3-round-")
    .replaceAll("reward-operator@example.invalid", "finale-operator@example.invalid")
    .replaceAll("reward-successor@example.invalid", "finale-successor@example.invalid"));
  const identity = { userId: id(4), sessionId: id(981001) }, draftId = id(981000), editionId = id(981002), raceId = id(981003);
  const snapshot = publishedSnapshot(), mapping = publishedMapping();
  // This fixture explicitly approves a league club category before funding.
  // Club results alone must never allocate an otherwise unassigned prize share.
  mapping.leagueCategories.push({ categoryId: snapshot.catalogue.categories.find(c => c.target === "club").id, shareBps: 10000 });
  snapshot.results.forEach((r, i) => r.clubId = snapshot.clubs[i % 2].clubId);
  await query(`insert into auth.sessions(id,user_id,not_after) values(${q(identity.sessionId)},${q(identity.userId)},clock_timestamp()+interval '1 hour');
    insert into app_private.reward_planning_drafts(id,organization_id,season_id,chain_id,rules,updated_by_user_id)
      values(${q(draftId)},${q(id(1))},${q(id(3))},31337,${q(JSON.stringify(createDefaultRewardProgrammeDraftV2()))}::jsonb,${q(identity.userId)});
    insert into app_private.reward_public_snapshots_v2(season_id,organization_id,payload,source_hash)
      values(${q(id(3))},${q(id(1))},${q(JSON.stringify(snapshot))}::jsonb,repeat('0',64));
    insert into public.event_editions(id,event_series_id,slug,name,start_date,status)
      values(${q(editionId)},${q(id(11))},'synthetic-native-finale','Synthetic native finale — not an actual race','2026-10-03','draft');
    insert into public.event_categories(id,event_edition_id,slug,name,distance_km,status)
      values(${q(raceId)},${q(editionId)},'synthetic-short','Synthetic short race',5,'draft');`);
  const read = async () => { await query(rpcSql("service_read_reward_finale_v3", args)); return rewardFinaleBindingV3(identity, 31337, draftId, undefined, rpc); };
  const save = c => rewardFinaleBindingV3(identity, 31337, draftId, c, rpc);
  const args = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: 31337, p_draft_id: draftId };
  const sql = c => rpcSql("service_bind_reward_finale_v3", { ...args, p_request_id: c.requestId, p_expected_binding_id: c.expectedBindingId,
    p_context_hash: c.contextHash, p_edition_id: c.editionId, p_races: c.races });
  const setMapping = async value => {
    // Surface SQL diagnostics only inside this owned synthetic scratch database.
    await query(rpcSql("service_read_reward_mapping_v2", args));
    const w = await readRewardSourceMappingV2(identity, 31337, draftId, rpc);
    return saveRewardSourceMappingV2(identity, 31337, w, w.revision, w.rulesRevision, w.catalogueHash, value, rpc);
  };
  await setMapping(mapping);
  const before = await scalar(`select payload from app_private.reward_public_snapshots_v2 where season_id=${q(id(3))}`);
  const initial = await read();
  const decision = { requestId: id(981010), expectedBindingId: null, contextHash: initial.contextHash, editionId,
    races: [{ competitionId: snapshot.catalogue.categories.find(c => c.target === "individual").competitionId, raceId }] };
  let latest;
  await scenario("hybrid finale requires explicit native scope; four imported rounds cannot fund a five-round programme", async () => {
    const a = await rewardProgrammeApprovalV3(identity, 31337, draftId, undefined, rpc);
    assert.deepEqual(programmeApprovalMissingSlotsV3(a.workspace), [5]);
    assert.equal(initial.binding, null); assert.equal(initial.locked, false);
    assert.ok(initial.editions.some(e => e.id === editionId));
    assert.doesNotMatch(JSON.stringify(initial), /athleteName|privateKey|email|birthYear/);
    for (const patch of [{ editionId: id(989999) }, { races: [{ ...decision.races[0], raceId: id(989999) }] },
      { races: [{ ...decision.races[0], competitionId: id(989999) }] }]) await assert.rejects(save({ ...decision, ...patch }));
    const [a1, a2] = await Promise.all([save(decision), save(decision)]);
    assert.deepEqual(a1, a2); assert.equal(a1.binding.id, decision.requestId);
    assert.equal(await scalar(`select count(*) from app_private.reward_finale_bindings_v3 where draft_id=${q(draftId)}`), 1);
    let w = await readRewardSourceMappingV2(identity, 31337, draftId, rpc);
    assert.equal(w.catalogue.rounds.length, 5); assert.equal(w.mapping.rounds[4].roundId, null);
    assert.notEqual(w.catalogueHash, w.boundCatalogueHash);
    mapping.rounds[4].roundId = decision.requestId; w = await setMapping(mapping);
    assert.deepEqual(programmeApprovalMissingSlotsV3(w), []);
    const imported = await readRewardPublishedPreviewV2(identity, 31337, draftId, rpc);
    assert.equal(imported.snapshot.catalogue.rounds.length, 4); assert.equal(imported.workspace.catalogue.rounds.length, 5);
    const historical = await rewardHistoricalSourceV3(identity, 31337, draftId, undefined, rpc);
    assert.equal(historical.source.rounds[4].roundId, decision.requestId); assert.equal(historical.source.rounds[4].evidence, null);
    assert.equal(historical.preview.rounds[4].proposedWei, 0n); assert.equal(historical.preview.league.proposedWei, 0n);
    assert.deepEqual(await scalar(`select payload from app_private.reward_public_snapshots_v2 where season_id=${q(id(3))}`), before);
  });
  await scenario("native finale stale edits and exact retries cannot overwrite a newer explicit binding", async () => {
    latest = { ...decision, requestId: id(981011), expectedBindingId: decision.requestId, contextHash: (await read()).contextHash };
    await save(latest);
    const recovered = await save(decision); assert.equal(recovered.recordedId, decision.requestId); assert.equal(recovered.binding.id, latest.requestId);
    await assert.rejects(save({ ...decision, requestId: id(981012) }), { code: "reward_planning_revision_changed" });
    mapping.rounds[4].roundId = latest.requestId; await setMapping(mapping);
    await query(`update public.event_editions set status='archived' where id=${q(editionId)}`);
    const w = await readRewardSourceMappingV2(identity, 31337, draftId, rpc);
    assert.throws(() => programmeApprovalMissingSlotsV3(w), { code: "invalid_v2_source_mapping" });
    await query(`update public.event_editions set status='draft' where id=${q(editionId)}`);
  });
  await scenario("finale binding rechecks expired Auth after a real lock wait and leaves no new binding", async () => {
    const c = { ...latest, requestId: id(981013), expectedBindingId: latest.requestId, contextHash: (await read()).contextHash };
    const release = await lock(`select id from app_private.reward_planning_drafts where id=${q(draftId)} for update`);
    const pending = assert.rejects(query(sql(c)), /reward_account_session_required/); pending.catch(() => {});
    try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`); }
    finally { await release(); }
    await pending;
    assert.equal(await scalar(`select count(*) from app_private.reward_finale_bindings_v3 where draft_id=${q(draftId)}`), 2);
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
  });
  await scenario("hybrid programme exact approval and nonce reservation lock the native finale before deployment", async () => {
    const view = await rewardProgrammeApprovalV3(identity, 31337, draftId, undefined, rpc);
    // Exact upfront terms for this disposable fixture. Its native finale has
    // a one-second platform review; league publication inherits that review.
    const terms = { operatorAddress: fixtureSigner(0x8c0001).address.toLowerCase(), funderAddress: fixtureSigner(0x8c0002).address.toLowerCase(), reviewPeriods: [86400, 86400, 86400, 86400, 1, 1] };
    const approved = await rewardProgrammeApprovalV3(identity, 31337, draftId,
      { requestId: id(981020), expectedApprovalId: null, contextHash: view.contextHash, terms }, rpc);
    assert.equal(approved.approval.current, true); assert.equal(approved.workspace.catalogue.rounds[4].races[0].id, raceId);
    await rewardProgrammeDeploymentV3(identity, 31337, draftId, { requestId: id(981021), approvalId: approved.approval.id,
      contextHash: approved.contextHash, pendingNonce: 0n, maximumGasCostWei: 10n ** 18n }, rpc);
    const locked = await read(); assert.equal(locked.locked, true);
    await assert.rejects(save({ ...latest, requestId: id(981022), expectedBindingId: latest.requestId, contextHash: locked.contextHash }), { code: "reward_finale_locked" });
    assert.equal((await save(decision)).binding.id, latest.requestId);
  });
  await scenario("native finale bindings remain immutable, service-only and scoped to the authorized draft and chain", async () => {
    const table = "app_private.reward_finale_bindings_v3";
    for (const role of ["anon", "authenticated"]) {
      assert.equal(await scalar(`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE')`), false);
      assert.equal(await scalar(`select has_function_privilege('${role}','public.service_read_reward_finale_v3(uuid,uuid,integer,uuid)','EXECUTE')`), false);
    }
    assert.equal(await scalar(`select relrowsecurity from pg_class where oid='${table}'::regclass`), true);
    assert.equal(await scalar(`select prosecdef from pg_proc where oid='public.service_bind_reward_finale_v3(uuid,uuid,integer,uuid,uuid,uuid,text,uuid,jsonb)'::regprocedure`), false);
    await assert.rejects(query(`update ${table} set edition_id=edition_id`), /reward_result_review_immutable/);
    await assert.rejects(query(`delete from ${table}`), /reward_result_review_immutable/);
    await assert.rejects(rewardFinaleBindingV3(identity, 10143, draftId, undefined, rpc), { code: "reward_planning_not_found" });
  });
  return { identity, draftId, editionId, raceId, intentId: id(981021), approvalId: id(981020) };
}
