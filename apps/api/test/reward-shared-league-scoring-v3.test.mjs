import assert from "node:assert/strict";
import test from "node:test";
import { createRewardAllocationRehearsalV3 } from "../../../packages/domain/dist/rewards/allocation-rehearsal-v3.js";
import { previewRewardAllocationV3 } from "../../../packages/domain/dist/rewards/allocation-preview-v3.js";
import { deriveLeagueStandings, deriveLeagueClubStandings } from "../../../packages/domain/dist/leagues/standings.js";

test("rehearsal league rank follows category scores and best four, not reversed race order", () => {
  const f = createRewardAllocationRehearsalV3(), p = previewRewardAllocationV3(f.rules, f.mapping, f.source);
  const category = f.source.categories[0].id;
  const winner = f.scoringTables.find(t => t.slot === null && t.categoryId === category).rows[0];
  assert.equal(winner.beneficiaryId, "89000000-0000-4000-8000-000000001001");
  assert.deepEqual(winner.roundScores, [97, 100, 100, 100, 100]);
  assert.deepEqual(winner.countedRounds, [false, true, true, true, true]);
  assert.equal(winner.points, 400);
  assert.equal(p.league.families[0].categories[0].awards[0].beneficiaryId, winner.beneficiaryId);
  assert.equal(p.league.participation.awards.find(a => a.beneficiaryId === winner.beneficiaryId).metres, 25000n);
  assert.equal(p.payableWei, 0n);
});

test("all displayed athlete and club totals reconcile to counted contributions", () => {
  const f = createRewardAllocationRehearsalV3();
  for (const table of f.scoringTables) for (const row of table.rows) {
    assert.equal(row.points, row.roundScores.reduce((sum, points, i) => sum + (row.countedRounds[i] ? points : 0), 0));
    if (table.categoryId === f.source.categories[7].id) {
      for (let round = 1; round <= 5; round++) {
        const contributors = row.contributors.filter(c => c.round === round && c.counted);
        assert.ok(contributors.length <= f.policy.clubMembersPerRound);
        assert.equal(row.roundScores[round - 1], contributors.reduce((sum, c) => sum + c.points, 0));
        assert.equal(new Set(contributors.map(c => c.athleteId)).size, contributors.length);
      }
    } else if (table.slot === null) assert.ok(row.countedRounds.filter(Boolean).length <= f.policy.bestN);
  }
  const clubs = f.scoringTables.find(t => t.slot === 1 && t.categoryId === f.source.categories[7].id);
  assert.ok(clubs.rows.some(r => r.contributors.some(c => !c.counted)));
  assert.ok(clubs.rows.some(r => r.contributors.some(c => c.counted && c.points === 150)));
  // Pooling happens before selecting three. A short-course winner can be
  // excluded when that club has three larger long-course contributions.
  assert.ok(clubs.rows.some(r => r.contributors.some(c => !c.counted && c.points === 100)));
});

test("unfinished season exposes no final scoring table and never synthesizes final source authority", () => {
  const f = createRewardAllocationRehearsalV3("four_rounds");
  assert.equal(f.source.kind, "synthetic_rehearsal"); assert.equal(f.source.league, null);
  assert.ok(f.scoringTables.every(t => t.slot !== null && t.slot !== 5));
  assert.ok(f.source.standings.every(t => t.evidence.kind === "synthetic"));
  const p = previewRewardAllocationV3(f.rules, f.mapping, f.source);
  assert.equal(p.league.proposedWei, 0n); assert.equal(p.rounds[4].proposedWei, 0n);
});

test("shared backend scorer preserves minimum finishes, best-N, tie-break and represented club semantics", () => {
  const entry = (athleteId, roundNumber, overall, participationStatus = "finished") => ({ athleteId, athleteSlug: athleteId, name: athleteId,
    club: "club", clubSlug: "club", gender: "U", ageCategory: "", roundNumber, roundStatus: "completed", participationStatus, overall });
  const entries = [entry("a", 1, 1), entry("a", 2, 3), entry("a", 3, 2), entry("b", 1, 1), entry("b", 2, 2), entry("b", 3, 3),
    entry("c", 1, 1), entry("c", 2, 1, "dnf")];
  const input = structuredClone(entries), rows = deriveLeagueStandings(entries, [100, 80, 60], 0, 2, 2, "last_round");
  assert.deepEqual(entries, input);
  assert.deepEqual(rows.map(s => [s.athleteId, s.points, s.eligible]), [["a", 180, true], ["b", 180, true], ["c", 100, false]]);
  const clubs = deriveLeagueClubStandings(entries, [100, 80, 60], 0, "best_2");
  assert.deepEqual(clubs[0].roundPoints, [200, 140, 140]);
  assert.equal(clubs[0].points, 480);
  assert.deepEqual(deriveLeagueClubStandings(entries, [100, 80, 60], 0, "none"), []);
});
