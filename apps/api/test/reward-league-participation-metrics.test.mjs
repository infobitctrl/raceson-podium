import assert from "node:assert/strict";
import test from "node:test";
import { deriveLeagueParticipationMetrics } from "../../../packages/domain/dist/rewards/league-participation-metrics.js";
import { createDefaultRewardProgrammeDraftV2 } from "../../../packages/domain/dist/rewards/programme-draft-v2.js";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";
import { publishedSnapshot, publishedMapping, id } from "./fixtures/published-reward-v2.mjs";

const hash = "b".repeat(64);
test("one evidence projection reconciles finishes, athlete distance and represented-club distance", () => {
  const source = publishedSnapshot();
  source.results[0].clubId = id(20); source.results[0].clubName = "Club A";
  source.results[3].clubId = id(21); source.results[3].clubName = "Club B";
  const metrics = deriveLeagueParticipationMetrics(source, hash);
  assert.equal(metrics.state, "historical_progress"); assert.equal(metrics.availableRounds, 4); assert.equal(metrics.plannedRounds, 5);
  assert.equal(metrics.summary.rawFinishes, 12); assert.equal(metrics.summary.athletes, 3);
  assert.equal(metrics.summary.rawMetres, "60000"); assert.equal(metrics.summary.rawClubMetres, "10000");
  assert.equal(metrics.summary.rawUnattributedMetres, "50000");
  assert.equal(metrics.athletes[0].finishedRounds, 4); assert.equal(metrics.athletes[0].rawMetres, "20000");
  assert.deepEqual(metrics.clubs.map(c => [c.id, c.rawMetres]), [[id(20), "5000"], [id(21), "5000"]]);
  assert.equal(metrics.contributions.find(c => c.resultId === source.results[3].id).clubId, id(21));
  assert.equal(metrics.sourceHash, hash); assert.equal(metrics.sourceSeasonId, source.sourceSeasonId);
});
test("club distance includes contributors absent from points standings and does not count category overlap twice", () => {
  const source = publishedSnapshot();
  source.results[0].clubId = id(99); source.results[0].clubName = "Non-scoring club";
  source.catalogue.categories.push({ ...source.catalogue.categories[0], id: id(98), name: "Overall" });
  source.results[0].classificationIds.push(id(98));
  const metrics = deriveLeagueParticipationMetrics(source, hash);
  assert.equal(metrics.clubs.length, 1); assert.equal(metrics.clubs[0].id, id(99));
  assert.equal(metrics.clubs[0].rawMetres, "5000"); assert.equal(metrics.summary.rawFinishes, 12);
});
test("missing distance preserves finish counts and identifies only the affected metric families", () => {
  const source = publishedSnapshot(); source.catalogue.rounds[0].races[0].distanceMetres = null;
  const metrics = deriveLeagueParticipationMetrics(source, hash);
  assert.equal(metrics.summary.rawFinishes, 12); assert.equal(metrics.summary.missingDistances, 3);
  assert.equal(metrics.athletes[0].finishedRounds, 4); assert.equal(metrics.athletes[0].missingDistances, 1);
  assert.equal(metrics.summary.rawMetres, "45000");
  assert.ok(metrics.issues.filter(i => i.code === "missing_distance").every(i => !i.affects.includes("athlete_finishes")));
});
test("multiple starts and conflicting clubs remain visible without silently choosing a finish", () => {
  const source = publishedSnapshot();
  source.results[1].athleteId = source.results[0].athleteId;
  source.results[0].clubId = id(20); source.results[1].clubId = id(21);
  const metrics = deriveLeagueParticipationMetrics(source, hash);
  assert.equal(metrics.summary.duplicateAthleteRounds, 1);
  assert.equal(metrics.summary.rawFinishes, 12); assert.equal(metrics.summary.finishedAthleteRounds, 11);
  const issue = metrics.issues.find(i => i.code === "duplicate_athlete_round");
  assert.deepEqual(issue.resultIds, [source.results[0].id, source.results[1].id]);
  assert.deepEqual(issue.affects, ["athlete_finishes", "athlete_metres", "club_metres"]);
});
test("non-finishes and contradictory finish evidence cannot create contributions", () => {
  const source = publishedSnapshot();
  source.results[0].participationStatus = "dns"; source.results[1].participationStatus = "dnf";
  source.results[2].participationStatus = "dsq"; source.results[3].participationStatus = null;
  source.results[4].finishTimeMs = null; source.results[5].classificationIds = [];
  const metrics = deriveLeagueParticipationMetrics(source, hash);
  assert.equal(metrics.summary.rawFinishes, 7);
  assert.equal(metrics.issues.filter(i => i.code === "unknown_outcome").length, 1);
  assert.equal(metrics.issues.filter(i => i.code === "invalid_finish_time").length, 1);
  assert.deepEqual(metrics.issues.find(i => i.code === "unclassified_finish").affects, []);
});
test("projection is independent of input order and refuses mismatched source evidence", () => {
  const source = publishedSnapshot(), reversed = structuredClone(source); reversed.results.reverse();
  assert.deepEqual(deriveLeagueParticipationMetrics(source, hash), deriveLeagueParticipationMetrics(reversed, hash));
  assert.throws(() => deriveLeagueParticipationMetrics(source, "bad"));
  source.results[0].publicationId = id(90);
  assert.throws(() => deriveLeagueParticipationMetrics(source, hash));
});

const record = () => ({ draftId: id(30), organizationId: id(31), seasonId: id(32), chainId: 31337,
  organizationName: "Synthetic", seasonName: "Synthetic", revision: 1, updatedAt: "2026-09-09T12:00:00Z", rules: createDefaultRewardProgrammeDraftV2() });
const stored = () => ({ record: record(), workspace: { draftId: id(30), revision: 1, rulesRevision: 1,
  catalogueHash: "a".repeat(64), boundCatalogueHash: "a".repeat(64), mapping: publishedMapping(), catalogue: publishedSnapshot().catalogue },
  snapshot: publishedSnapshot(), sourceHash: hash });
async function request({ data = stored(), method = "GET", error, authError, query = "" } = {}) {
  const res = {}, calls = [];
  const handled = await dispatchRewardPlanningRoutes({ method }, res, new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${id(30)}/participation-metrics${query}`), {
    config: () => ({ chainId: 31337 }), requireIdentity: async () => { if (authError) throw Error(authError); return { userId: id(40), sessionId: id(41) }; },
    applyPrivateSessionHeaders: () => res.private = true, sendSuccess: (_, data) => Object.assign(res, { status: 200, data }),
    sendError: (_, status, code) => Object.assign(res, { status, code }),
    rpc: async (name, args) => { calls.push({ name, args }); return { data, error: error ? { message: error } : null }; },
  });
  return { res, calls, handled };
}
test("private metric endpoint uses the atomic authorized source read and server calculation", async () => {
  const { res, calls } = await request();
  assert.equal(res.status, 200); assert.equal(res.private, true); assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "service_read_reward_published_preview_v2"); assert.equal(calls[0].args.p_actor_session_id, id(41));
  assert.deepEqual(res.data.metrics, deriveLeagueParticipationMetrics(publishedSnapshot(), hash));
});
test("metric endpoint rejects writes, query overrides, revoked access and changed catalogue", async () => {
  for (const method of ["POST", "PATCH", "DELETE"]) assert.equal((await request({ method })).handled, false);
  assert.equal((await request({ query: "?clubId=other" })).res.status, 400);
  const data = stored(); data.workspace.catalogue.rounds[0].name = "Changed";
  assert.equal((await request({ data })).res.status, 503);
  for (const [error, status] of [["reward_planning_not_found", 404], ["reward_account_session_required", 401], ["SECRET", 503]]) {
    const result = await request({ error }); assert.equal(result.res.status, status); assert.ok(!JSON.stringify(result.res).includes("SECRET"));
  }
  assert.equal((await request({ authError: "Untrusted browser origin" })).res.status, 403);
});
test("missing imported source remains unknown, never zero participation", async () => {
  const data = stored(); data.snapshot = null; data.sourceHash = null;
  const { res } = await request({ data }); assert.equal(res.status, 200); assert.equal(res.data.metrics, null);
});
