import assert from "node:assert/strict";
import test from "node:test";
import { historicalAllocationSourceV3 } from "../../../packages/domain/dist/rewards/historical-source-v3.js";
import { previewRewardAllocationV3 } from "../../../packages/domain/dist/rewards/allocation-preview-v3.js";
import { createDefaultRewardProgrammeDraftV2 } from "../../../packages/domain/dist/rewards/programme-draft-v2.js";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";
import { publishedSnapshot, publishedMapping, id } from "./fixtures/published-reward-v2.mjs";

const now = "2026-09-10T03:00:00.000Z", hash = "a".repeat(64);
const wire = value => JSON.parse(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v));
function fixture() {
  const snapshot = publishedSnapshot(); snapshot.results.forEach((r, i) => r.clubId = id(20 + i % 2));
  const record = { draftId: id(30), organizationId: id(31), seasonId: id(32), chainId: 31337,
    organizationName: "Synthetic", seasonName: "Synthetic", revision: 1, updatedAt: now, rules: createDefaultRewardProgrammeDraftV2() };
  const workspace = { draftId: record.draftId, revision: 1, rulesRevision: 1, catalogueHash: hash, boundCatalogueHash: hash,
    mapping: publishedMapping(), catalogue: snapshot.catalogue };
  return { record, workspace, snapshot, sourceHash: hash, contextHash: hash, decisions: [], observedAt: now, recordedDecision: null };
}
const decision = (slot = 1, patch = {}) => ({ id: id(900 + slot), slot, contextHash: hash, decision: "confirmed_final", reviewedAt: now, current: true, ...patch });
const adapt = (f = fixture()) => historicalAllocationSourceV3(f.snapshot, f.workspace.mapping, f.contextHash, f.decisions, f.observedAt);
const preview = (f = fixture()) => previewRewardAllocationV3(f.record.rules, f.workspace.mapping, adapt(f));
test("historical review, not generic official flags, gates the new calculator; fifth and league stay held", () => {
  const f = fixture(); assert.equal(preview(f).proposedWei, 0n);
  f.decisions = [1, 2, 3, 4].map(slot => decision(slot));
  const p = preview(f); assert.ok(p.proposedWei > 0n); assert.equal(p.rounds[4].proposedWei, 0n); assert.equal(p.league.proposedWei, 0n);
  assert.equal(p.budgetWei, p.proposedWei + p.retainedWei); assert.equal(p.payableWei, 0n);
  const source = adapt(f); assert.equal(source.league, null);
  assert.doesNotMatch(JSON.stringify(source), /athleteName|clubName|wallet|reviewSeconds|startedAt|approval|email/);
  assert.equal(source.rounds[0].evidence.publishedAt, "2026-09-01T12:00:00.000Z");
  assert.equal(source.rounds[0].evidence.kind, "historical_final");
});
test("superseding holds and changed source contexts retain awards without re-dating publications", () => {
  const f = fixture(); f.decisions = [decision()]; const proposed = preview(f).proposedWei; assert.ok(proposed > 0n);
  f.decisions = [decision(1, { decision: "held" })]; assert.equal(preview(f).proposedWei, 0n);
  f.decisions = [decision(1, { contextHash: "b".repeat(64), current: false })]; assert.equal(preview(f).proposedWei, 0n);
  f.decisions[0].current = true; assert.throws(() => adapt(f));
});
test("ambiguous athlete records and missing ranks hold affected awards, not silently repair sporting results", () => {
  const f = fixture(); f.decisions = [decision()]; f.snapshot.results[0].classificationIds = [];
  assert.equal(preview(f).rounds[0].families[0].proposedWei, 0n);
  f.snapshot.results[0].classificationIds = [id(2)]; f.snapshot.results[0].rankOverall = null;
  assert.equal(preview(f).rounds[0].families[0].proposedWei, 0n);
  f.snapshot.results[0].rankOverall = 1; f.snapshot.results[1].athleteId = f.snapshot.results[0].athleteId;
  assert.equal(preview(f).rounds[0].proposedWei, 0n);
});
test("source integrity rejects mixed publication timestamps, future evidence, extra secrets and foreign mapping", () => {
  for (const change of [f => f.snapshot.results[0].publishedAt = "2026-09-02T00:00:00Z",
    f => f.snapshot.results.forEach(r => r.publishedAt = "2026-09-11T00:00:00Z"),
    f => f.snapshot.results[0].privateKey = "never-copy", f => f.workspace.mapping.rounds[0].roundId = id(999),
    f => f.decisions = [decision(1, { reviewedAt: "2026-09-11T00:00:00Z" })],
    f => f.snapshot.results.forEach(r => r.publishedAt = "2026-02-30T00:00:00Z")]) {
    const f = fixture(); change(f); assert.throws(() => adapt(f));
  }
});
async function request({ method = "GET", body, mutate, error, query = "", authError } = {}) {
  const f = fixture(), res = {}, calls = []; if (mutate) mutate(f);
  const handled = await dispatchRewardPlanningRoutes({ method }, res, new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${id(30)}/historical-source${query}`), {
    config: () => ({ chainId: 31337 }), requireIdentity: async () => { if (authError) throw Error(authError); return { userId: id(40), sessionId: id(41) }; },
    readJsonBody: async () => body, applyPrivateSessionHeaders: () => res.private = true,
    sendSuccess: (_, data) => Object.assign(res, { status: 200, data }), sendError: (_, status, code) => Object.assign(res, { status, code }),
    rpc: async (name, args) => { calls.push({ name, args }); if (name === "service_review_reward_historical_source_v3") {
      f.recordedDecision = decision(args.p_slot, { id: args.p_request_id, decision: args.p_decision }); f.decisions = [f.recordedDecision];
    } return { data: wire(f), error: error ? { message: error } : null }; } });
  return { res, calls, handled };
}
const body = { slot: 1, requestId: id(901), expectedReviewId: null, contextHash: hash, decision: "confirmed_final" };
test("demo HTTP reads and records reviewed source, sends no client amounts/times/identity, exposes no imported names", async () => {
  const r = await request({ method: "POST", body }); assert.equal(r.res.status, 200); assert.equal(r.res.private, true);
  assert.equal(r.calls.length, 2); assert.equal(r.calls[1].args.p_actor_session_id, id(41));
  assert.doesNotMatch(JSON.stringify(r.calls[1].args), /amount|started|source_body|snapshot|calculation/);
  assert.doesNotMatch(JSON.stringify(r.res.data), /athleteName|clubName|Synthetic athlete/);
  assert.equal(r.res.data.preview.payableWei, "0"); assert.equal(r.res.data.recordedDecision.id, body.requestId);
  assert.equal((await request()).res.data.decisions.length, 0);
});
test("historical HTTP rejects backdated clocks/client amounts, malformed decisions, query and method overrides", async () => {
  for (const patch of [{ amount: "1" }, { source: {} }, { userId: id(40) }, { reviewedAt: now }, { slot: 5 }, { decision: "approved" }]) {
    const r = await request({ method: "POST", body: { ...body, ...patch } }); assert.equal(r.res.status, 400); assert.equal(r.calls.length, 0);
  }
  assert.equal((await request({ query: "?chain=1" })).res.status, 400);
  assert.equal((await request({ method: "PATCH" })).handled, false);
});
test("fresh session/conflict/source failures stay scoped; corrupt backend replies cannot authorize output", async () => {
  for (const [error, status] of [["reward_account_session_required", 401], ["reward_planning_not_found", 404],
    ["reward_historical_review_conflict", 409], ["reward_historical_source_missing", 409], ["secret upstream failure", 503]]) {
    const r = await request({ error }); assert.equal(r.res.status, status); assert.doesNotMatch(JSON.stringify(r.res), /secret upstream failure/);
  }
  assert.equal((await request({ authError: "Untrusted browser origin" })).res.status, 403);
  for (const mutate of [f => f.record.chainId = 10143, f => f.privateData = "secret", f => f.decisions = [decision(), decision()],
    f => f.workspace.rulesRevision = 2, f => f.decisions = [decision(1, { contextHash: "b".repeat(64) })]])
    assert.notEqual((await request({ mutate })).res.status, 200);
});
