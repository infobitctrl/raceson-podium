import assert from "node:assert/strict";
import test from "node:test";
import { createRewardAllocationRehearsalV3 as fixture } from "../../../packages/domain/dist/rewards/allocation-rehearsal-v3.js";
import { previewRewardAllocationV3 as calculate } from "../../../packages/domain/dist/rewards/allocation-preview-v3.js";
const mon = 10n ** 18n;
const preview = f => calculate(f.rules, f.mapping, f.source);

test("compact rehearsal has 20 recurring invented identities, 100 entries, seven categories and a separate 100-MON budget", () => {
  const f = fixture("five_rounds", "compact_20"), p = preview(f);
  assert.equal(f.source.kind, "synthetic_rehearsal");
  assert.equal(f.source.categories.filter(c => c.target === "individual").length, 7);
  assert.deepEqual(f.source.rounds.map(r => r.results.length), [20, 20, 20, 20, 20]);
  assert.equal(new Set(f.source.rounds.flatMap(r => r.results.map(a => a.athleteId))).size, 20);
  assert.ok(f.source.rounds.every(r => r.results.every(a => a.athleteId.startsWith("8a000000-"))));
  assert.equal(p.budgetWei, 100n * mon); assert.equal(p.league.budgetWei, 50n * mon);
  assert.deepEqual(p.rounds.map(r => r.budgetWei), Array(5).fill(10n * mon));
  assert.equal(p.proposedWei + p.retainedWei, p.budgetWei); assert.equal(p.payableWei, 0n);
  assert.ok(p.retainedWei > 0n, "unused top-10/top-25 slots are not renormalized");
  assert.equal(p.league.participation.totalMetres, 635000n);
  assert.equal(p.league.participation.awards.reduce((sum, r) => sum + r.finishes, 0), 97);
  assert.equal(p.league.participation.proposedWei, 15n * mon);
  for (const pot of [...p.rounds, p.league]) {
    assert.equal(pot.proposedWei + pot.retainedWei, pot.budgetWei);
    for (const family of pot.families) for (const c of family.categories) assert.equal(c.hold, null);
  }
  const baseline = fixture();
  assert.equal(baseline.rules.budgetMon, "100000"); assert.equal(baseline.source.rounds[0].results.length, 210);
  assert.ok(!baseline.source.rounds[0].results.some(a => f.source.rounds[0].results.some(b => a.athleteId === b.athleteId)));
  assert.throws(() => fixture("five_rounds", "arbitrary"));
});

test("compact four-round wave retains the finale and league; missing distance holds participation", () => {
  const four = preview(fixture("four_rounds", "compact_20"));
  assert.equal(four.rounds[4].proposedWei, 0n); assert.equal(four.league.proposedWei, 0n);
  assert.ok(four.retainedWei >= 60n * mon); assert.equal(four.league.participation.awards.length, 0);
  const missing = preview(fixture("distance_hold", "compact_20"));
  assert.equal(missing.league.participation.proposedWei, 0n);
  assert.equal(missing.league.participation.retainedWei, 15n * mon);
  assert.equal(missing.league.participation.hold, "missing_distance");
});
