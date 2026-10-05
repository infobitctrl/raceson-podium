import assert from "node:assert/strict";
import test from "node:test";
import { decodeNativeFinaleSourceV3, inspectNativeFinaleSourceV3 } from "../../../packages/domain/dist/rewards/native-finale-source-v3.js";
import { readNativeFinaleSourceV3 } from "../../../packages/db/dist/rewards/native-finale-source-v3.js";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";
import { nativeFinaleFixture, nativeId as id } from "./fixtures/native-finale-v3.mjs";

test("native final source preserves exact rows, has stable digest and never creates awards or imported identities", async () => {
  const source = nativeFinaleFixture(), decoded = decodeNativeFinaleSourceV3(source), inspection = inspectNativeFinaleSourceV3(decoded);
  assert.equal(inspection.state, "final_source_observed"); assert.equal(inspection.observedFinishedMetres, "5000");
  assert.equal(inspection.allocationApproved, false); assert.equal(inspection.payableWei, "0"); assert.equal(inspection.identityNamespace, "native_demo");
  const rpc = async () => ({ data: source, error: null }), identity = { userId: id(20), sessionId: id(21) };
  const first = await readNativeFinaleSourceV3(identity, 31337, id(1), rpc);
  source.observedAt = "2026-09-10T06:00:00.000Z";
  assert.equal((await readNativeFinaleSourceV3(identity, 31337, id(1), rpc)).sourceHash, first.sourceHash);
  source.document.races[0].rows[0].finishTimeMs = "1800001";
  assert.notEqual((await readNativeFinaleSourceV3(identity, 31337, id(1), rpc)).sourceHash, first.sourceHash);
});
test("native review diagnostics retain ambiguous, incomplete, non-final and fractional-distance sources", () => {
  for (const [mutate, expected] of [
    [r => r.status = "draft", "race_not_completed"], [r => r.expectedResultCount = 2, "source_inconsistent"],
    [r => r.distanceMetres = "5000.5", "distance_missing"], [r => r.rows[0].registrationMatches = false, "ambiguous_results"],
    [r => r.rows[0].participationStatus = "unknown", "ambiguous_results"], [r => r.rows[0].finishTimeMs = null, "ambiguous_results"],
    [r => r.run.completedAt = "2026-09-10T04:01:00.000Z", "source_inconsistent"],
    [r => { r.review.state = "held"; r.review.held = true; r.review.finalPublicationId = null; r.review.officialPublishedAt = null; }, "review_not_final"],
    [r => { r.rows.push({ ...r.rows[0], id: id(99) }); r.expectedResultCount = 2; }, "ambiguous_results"]
  ]) { const source = nativeFinaleFixture(); mutate(source.document.races[0]); assert.ok(inspectNativeFinaleSourceV3(source).holds.includes(expected)); }
  for (const status of ["dns", "dnf", "dsq"]) { const f = nativeFinaleFixture(); f.document.races[0].rows[0].participationStatus = status;
    assert.equal(inspectNativeFinaleSourceV3(f).observedFinishedMetres, "0"); assert.equal(inspectNativeFinaleSourceV3(f).finishedCount, 0); }
});
test("native source refuses private extras, wrong result scope and false review clocks", () => {
  for (const mutate of [v => v.wallet = "private", v => v.document.athleteEmail = "private",
    v => v.document.races[0].rows[0].dateOfBirth = "private", v => v.document.races[0].rows[0].runId = id(99),
    v => v.document.races[0].competitionId = id(99), v => v.document.races[0].review.reviewSeconds = 86400,
    v => v.document.races[0].review.officialPublishedAt = "2026-09-10T06:00:00.000Z",
    v => Object.defineProperty(v.document, "recordRevision", { get() { throw Error("getter should not execute"); }, enumerable: true })]) {
    const v = nativeFinaleFixture(); mutate(v); assert.throws(() => decodeNativeFinaleSourceV3(v), /invalid_reward_|Invalid/);
  }
});
async function request({ method = "GET", query = "", error, authError, source = nativeFinaleFixture() } = {}) {
  const res = {}, calls = [];
  const handled = await dispatchRewardPlanningRoutes({ method }, res, new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${id(1)}/native-finale${query}`), {
    config: () => ({ chainId: 31337 }), requireIdentity: async () => { if (authError) throw Error(authError); return { userId: id(20), sessionId: id(21) }; },
    readJsonBody: async () => { throw Error("read route must not accept results"); }, applyPrivateSessionHeaders: () => res.private = true,
    sendSuccess: (_, data) => Object.assign(res, { status: 200, data }), sendError: (_, status, code) => Object.assign(res, { status, code }),
    rpc: async (name, args) => { calls.push({ name, args }); return { data: source, error: error && { message: error } }; } });
  return { res, calls, handled };
}
test("native finale HTTP is private GET-only, ignores no source inputs and sanitizes errors", async () => {
  const v = await request(); assert.equal(v.res.status, 200); assert.equal(v.res.private, true);
  assert.deepEqual(v.calls, [{ name: "service_read_reward_native_finale_v3", args: { p_actor_user_id: id(20), p_actor_session_id: id(21), p_chain_id: 31337, p_draft_id: id(1) } }]);
  for (const method of ["POST", "PATCH", "DELETE"]) { const r = await request({ method }); assert.equal(r.handled, false); assert.equal(r.calls.length, 0); }
  const query = await request({ query: "?raceId=arbitrary" }); assert.equal(query.res.status, 400); assert.equal(query.calls.length, 0);
  const denied = await request({ authError: "Unauthorized" }); assert.equal(denied.res.status, 401); assert.equal(denied.calls.length, 0);
  for (const [error, status] of [["reward_account_session_required", 401], ["reward_planning_not_found", 404], ["reward_planning_revision_changed", 409], ["private upstream detail", 503]]) {
    const r = await request({ error }); assert.equal(r.res.status, status); assert.doesNotMatch(JSON.stringify(r.res), /private upstream detail/);
  }
  const source = nativeFinaleFixture(); source.document.chainId = 10143;
  assert.equal((await request({ source })).res.status, 503);
});
