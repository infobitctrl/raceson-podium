import assert from "node:assert/strict";
import test from "node:test";
import { createRewardAllocationRehearsalV3 } from "../../../packages/domain/dist/rewards/allocation-rehearsal-v3.js";
import { decodeLeagueScoringPolicyV3, proposeLeagueStandingsV3 } from "../../../packages/domain/dist/rewards/league-standings-v3.js";
function fixture(stage) {
  const f = createRewardAllocationRehearsalV3(stage);
  const policy = { schema: "raceson-league-scoring-policy-v3", categories: f.policy.pointsTables.map(p => ({ categoryId: p.categoryId,
    points: p.points, participationPoints: 0, bestN: 4, minimumRounds: 2, tieBreak: "best_finish" })),
    club: { categoryId: f.source.categories.find(c => c.target === "club").id, membersPerRound: 3 } };
  return { ...f, policy };
}
test("five-round source proposal shares portal math and reconciles all athlete/club contributions", () => {
  const f = fixture(), before = structuredClone(f), p = proposeLeagueStandingsV3(f.source, f.policy);
  assert.deepEqual(f, before); assert.equal(p.state, "unapproved_proposal"); assert.equal(p.athleteTables.length, 7);
  assert.equal(p.clubTables.length, 6); assert.equal(p.participation.totalMetres, "6705000");
  assert.equal(p.finalPublished, false); assert.equal(p.allocationApproved, false); assert.equal(p.payableWei, "0");
  for (const table of p.athleteTables) {
    const old = f.scoringTables.find(t => t.slot === null && t.categoryId === table.categoryId);
    for (const r of table.rows) {
      assert.equal(r.points, r.rounds.filter(r => r.counted).reduce((sum, r) => sum + r.points, 0));
      assert.equal(r.points, old.rows.find(o => o.beneficiaryId === r.beneficiaryId).points);
    }
  }
  for (const table of p.clubTables) for (const row of table.rows) {
    assert.equal(row.points, row.contributions.filter(c => c.counted).reduce((sum, c) => sum + c.points, 0));
    for (let slot = 1; slot <= 5; slot++) assert.ok(row.contributions.filter(c => c.slot === slot && c.counted).length <= 3);
  }
  const winner = p.athleteTables[0].rows[0]; assert.equal(winner.points, 400); assert.equal(winner.rounds[0].counted, false);
  assert.equal(p.participation.rows.find(r => r.beneficiaryId === winner.beneficiaryId).metres, "25000");
});
test("proposal keeps tied ranks and minimum-finish exclusions rather than name/ID tie-break prizes", () => {
  const f = fixture();
  const category = f.policy.categories[0].categoryId;
  for (const t of f.source.standings.filter(t => t.slot !== null && t.categoryId === category)) {
    t.rows.sort((a, b) => a.beneficiaryId.localeCompare(b.beneficiaryId));
    t.rows.forEach((r, i) => r.rank = i < 2 ? 1 : i + 1);
  }
  let p = proposeLeagueStandingsV3(f.source, f.policy);
  const rows = p.athleteTables.find(t => t.categoryId === category).rows;
  assert.deepEqual(rows.slice(0, 3).map(r => r.rank), [1, 1, 3]);
  assert.equal(rows[0].points, rows[1].points);
  f.policy.categories[0].minimumRounds = 5; f.policy.categories[0].bestN = 5;
  p = proposeLeagueStandingsV3(f.source, f.policy);
  assert.ok(p.athleteTables.find(t => t.categoryId === category).rows.some(r => !r.eligible && r.rank === null));
});
test("incomplete/held/foreign/category-changing sources never become final standings", () => {
  const unfinished = fixture("four_rounds"); assert.equal(proposeLeagueStandingsV3(unfinished.source, unfinished.policy).state, "held");
  for (const change of [
    f => f.source.rounds[4].evidence.held = true,
    f => f.source.rounds[0].expectedResultCount++,
    f => f.source.rounds[0].results[0].categoryId = null,
    f => f.source.rounds[0].results[0].status = "unknown",
    f => f.source.rounds[0].results[0].athleteId = f.source.rounds[0].results[1].athleteId,
    f => f.source.standings.find(t => t.slot === 1 && t.categoryId === f.policy.categories[0].categoryId).rows[0].sourceRowId = f.source.rounds[0].results[40].id,
    f => f.source.standings.find(t => t.slot === 1).rows[0].rank = 2,
    f => f.source.standings.find(t => t.slot === 1).roundDigests[0] = "f".repeat(64),
  ]) { const f = fixture(); change(f); const p = proposeLeagueStandingsV3(f.source, f.policy);
    assert.equal(p.state, "held"); assert.deepEqual(p.athleteTables, []); assert.deepEqual(p.clubTables, []); assert.equal(p.payableWei, "0"); }
  const f = fixture("distance_hold"), p = proposeLeagueStandingsV3(f.source, f.policy);
  assert.equal(p.state, "unapproved_proposal"); assert.equal(p.participation.hold, "missing_distance"); assert.deepEqual(p.participation.rows, []);
});
test("policy decoder refuses unbounded, incomplete, overlapping or accessor input", () => {
  const f = fixture(); assert.deepEqual(decodeLeagueScoringPolicyV3(f.policy).categories.length, 7);
  for (const change of [
    p => p.categories[0].points = [Infinity], p => p.categories[0].points = [], p => p.categories[0].bestN = 0,
    p => p.categories[0].minimumRounds = 5, p => p.categories[0].tieBreak = "wallet", p => p.categories.push(p.categories[0]),
    p => p.club.membersPerRound = 11, p => p.categories[0].points = [1.5], p => p.categories[0].points = Array(3),
  ]) { const p = structuredClone(f.policy); change(p); assert.throws(() => decodeLeagueScoringPolicyV3(p)); }
  let touched = false; const p = structuredClone(f.policy);
  Object.defineProperty(p, "categories", { enumerable: true, get() { touched = true; return []; } });
  assert.throws(() => decodeLeagueScoringPolicyV3(p)); assert.equal(touched, false);
  const short = structuredClone(f.policy); short.categories.pop(); assert.throws(() => proposeLeagueStandingsV3(f.source, short));
});
test("a beneficiary changing category across rounds requires an explicit adjudication", () => {
  const f = fixture(), categories = f.policy.categories.slice(0, 2).map(c => c.categoryId);
  const rows = categories.map(c => f.source.rounds[4].results.find(r => r.categoryId === c && r.status === "finished"));
  const ids = rows.map(r => r.athleteId);
  rows.forEach((r, i) => r.athleteId = ids[1 - i]);
  categories.forEach((categoryId, i) => {
    const table = f.source.standings.find(t => t.slot === 5 && t.categoryId === categoryId);
    table.rows.find(r => r.sourceRowId === rows[i].id).beneficiaryId = ids[1 - i];
  });
  const p = proposeLeagueStandingsV3(f.source, f.policy);
  assert.equal(p.state, "held"); assert.ok(p.holds.some(h => h.reason === "category_changed")); assert.deepEqual(p.athleteTables, []);
});
