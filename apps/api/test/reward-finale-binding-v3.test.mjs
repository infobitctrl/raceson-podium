import assert from "node:assert/strict";
import test from "node:test";
import { decodeFinaleBindingChangeV3, decodeFinaleBindingViewV3 } from "../../../packages/domain/dist/rewards/finale-binding-v3.js";
import { requireHistoricalCatalogueV3, historicalMappingOnlyV3 } from "../../../packages/domain/dist/rewards/historical-catalogue-v3.js";
import { historicalAllocationSourceV3 } from "../../../packages/domain/dist/rewards/historical-source-v3.js";
import { previewPublishedRewardsV2 } from "../../../packages/domain/dist/rewards/published-preview-v2.js";
import { createDefaultRewardProgrammeDraftV2 } from "../../../packages/domain/dist/rewards/programme-draft-v2.js";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";
import { publishedSnapshot, publishedMapping, id } from "./fixtures/published-reward-v2.mjs";

const hash = "a".repeat(64);
function view() { return { schema: "raceson-finale-binding-v3", draftId: id(30), chainId: 31337, recordRevision: 1, sourceHash: hash,
  categories: publishedSnapshot().catalogue.categories, editions: [{ id: id(600), name: "Synthetic finale", date: "2026-10-03",
    races: [{ id: id(601), name: "Synthetic race", distanceMetres: "5000" }] }], binding: null, locked: false, contextHash: hash, recordedId: null }; }
const change = () => ({ requestId: id(700), expectedBindingId: null, contextHash: hash, editionId: id(600),
  races: [{ competitionId: publishedSnapshot().catalogue.categories[0].competitionId, raceId: id(601) }] });
test("hybrid catalogue preserves exact four-round evidence and represents mapped fifth as unrun", () => {
  const snapshot = publishedSnapshot(), catalogue = structuredClone(snapshot.catalogue), mapping = publishedMapping();
  catalogue.rounds.push({ id: id(700), editionId: id(600), slot: 5, name: "Synthetic finale", date: "2026-10-03", status: "draft", races: [] });
  mapping.rounds[4].roundId = id(700);
  assert.equal(requireHistoricalCatalogueV3(snapshot, catalogue).rounds.length, 5);
  const source = historicalAllocationSourceV3(snapshot, mapping, hash, [], "2026-09-10T04:00:00Z");
  assert.equal(source.rounds[4].roundId, id(700)); assert.equal(source.rounds[4].evidence, null); assert.equal(source.rounds[4].resultsComplete, false);
  const preview = previewPublishedRewardsV2(createDefaultRewardProgrammeDraftV2(), historicalMappingOnlyV3(mapping, catalogue), snapshot);
  assert.ok(preview); assert.equal(mapping.rounds[4].roundId, id(700)); assert.equal(snapshot.catalogue.rounds.length, 4);
  for (const mutate of [c => c.rounds[0].name = "changed", c => c.categories[0].name = "changed",
    c => c.rounds[4].slot = 6, c => c.rounds[4].editionId = c.rounds[0].editionId,
    c => c.rounds[0].races[0].distanceMetres = "9999"]) { const copy = structuredClone(catalogue); mutate(copy); assert.throws(() => requireHistoricalCatalogueV3(snapshot, copy)); }
});
test("finale transport forbids extra payloads, duplicate race mappings and missing scope", () => {
  assert.ok(decodeFinaleBindingViewV3(view())); assert.ok(decodeFinaleBindingChangeV3(change()));
  for (const patch of [{ approved: true }, { races: [...change().races, ...change().races] }, { races: [] }, { contextHash: "no" }, { expectedBindingId: undefined }])
    assert.throws(() => decodeFinaleBindingChangeV3({ ...change(), ...patch }));
  assert.throws(() => decodeFinaleBindingViewV3({ ...view(), wallet: "not part of scope" }));
});
async function request({ method = "GET", body, error, authError, query = "", mutate } = {}) {
  const res = {}, calls = [], v = view(); if (mutate) mutate(v);
  const handled = await dispatchRewardPlanningRoutes({ method }, res, new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${id(30)}/finale${query}`), {
    config: () => ({ chainId: 31337 }), requireIdentity: async () => { if (authError) throw Error(authError); return { userId: id(40), sessionId: id(41) }; },
    readJsonBody: async () => body, applyPrivateSessionHeaders: () => res.private = true,
    sendSuccess: (_, data) => Object.assign(res, { status: 200, data }), sendError: (_, status, code) => Object.assign(res, { status, code }),
    rpc: async (name, args) => { calls.push({ name, args }); if (name === "service_bind_reward_finale_v3") v.recordedId = args.p_request_id;
      return { data: v, error: error ? { message: error } : null }; } });
  return { res, calls, handled };
}
test("finale route is private, scoped and accepts only explicit source identifiers", async () => {
  const get = await request(); assert.equal(get.res.status, 200); assert.equal(get.res.private, true);
  assert.equal(get.calls[0].name, "service_read_reward_finale_v3");
  const post = await request({ method: "POST", body: change() }); assert.equal(post.res.status, 200);
  assert.equal(post.calls[0].args.p_actor_session_id, id(41)); assert.equal(post.calls[0].args.p_draft_id, id(30));
  assert.equal(post.calls[0].args.p_chain_id, 31337); assert.equal(post.calls[0].name, "service_bind_reward_finale_v3");
  assert.equal((await request({ method: "PATCH", body: change() })).handled, false);
  for (const params of [{ method: "POST", body: { ...change(), paidWei: "1" } }, { query: "?chainId=143" }]) {
    const r = await request(params); assert.equal(r.res.status, 400); assert.equal(r.calls.length, 0);
  }
});
test("finale errors expose no provider detail and fail closed on expired identity, stale scope or deployment lock", async () => {
  const unauth = await request({ authError: "Unauthorized" }); assert.equal(unauth.res.status, 401); assert.equal(unauth.calls.length, 0);
  for (const [error, status] of [["reward_finale_locked", 409], ["reward_finale_conflict", 409], ["reward_planning_not_found", 404],
    ["reward_account_session_required", 401], ["private provider detail", 503]]) {
    const r = await request({ error }); assert.equal(r.res.status, status); assert.doesNotMatch(JSON.stringify(r.res), /private provider detail/);
  }
  assert.equal((await request({ mutate: v => v.chainId = 10143 })).res.status, 400);
});
