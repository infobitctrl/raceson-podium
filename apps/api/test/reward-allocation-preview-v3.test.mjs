import assert from "node:assert/strict";
import test from "node:test";
import { decodeRewardAllocationSourceV3, previewRewardAllocationV3 } from "../../../packages/domain/dist/rewards/allocation-preview-v3.js";
import { createRewardAllocationRehearsalV3 } from "../../../packages/domain/dist/rewards/allocation-rehearsal-v3.js";
import { decodePublishedRewardSnapshotV2 } from "../../../packages/domain/dist/rewards/published-preview-v2.js";
const mon = 10n ** 18n;
const preview = f => previewRewardAllocationV3(f.rules, f.mapping, f.source);
const family = (p, key = "athlete_standings") => p.league.families.find(f => f.key === key);
function conserved(p) {
  assert.equal(p.proposedWei + p.retainedWei, p.budgetWei); assert.equal(p.payableWei, 0n);
  assert.equal(p.rounds.reduce((n, r) => n + r.budgetWei, p.league.budgetWei), p.budgetWei);
  for (const pot of [...p.rounds, p.league]) {
    assert.equal(pot.proposedWei + pot.retainedWei, pot.budgetWei);
    for (const f of pot.families) {
      assert.equal(f.proposedWei + f.retainedWei, f.budgetWei);
      assert.equal(f.categories.reduce((n, c) => n + c.budgetWei, f.unassignedWei), f.budgetWei);
      for (const c of f.categories) assert.equal(c.awards.reduce((n, a) => n + a.amountWei, c.retainedWei), c.budgetWei);
    }
  }
  const d = p.league.participation; assert.equal(d.awards.reduce((n, a) => n + a.amountWei, d.retainedWei), d.budgetWei);
}
test("V3 five-round rehearsal conserves 100000 MON and uses independent official league ranks", () => {
  const f = createRewardAllocationRehearsalV3(), p = preview(f); conserved(p);
  assert.equal(p.budgetWei, 100000n * mon);
  const club = family(p, "club_standings").categories[0];
  assert.equal(p.retainedWei, club.slots.slice(12).reduce((n, s) => n + s.amountWei, 0n));
  assert.equal(p.league.budgetWei, 50000n * mon); assert.ok(p.rounds.every(r => r.budgetWei === 10000n * mon));
  const first = family(p).categories[0]; assert.equal(first.awards[0].rank, 1);
  assert.equal(first.awards[0].beneficiaryId, f.source.standings.find(t => t.slot === null).rows[0].beneficiaryId);
  assert.notEqual(first.awards[0].beneficiaryId, p.rounds[0].families.find(f => f.key === "athlete_standings").categories[0].awards[0].beneficiaryId);
  assert.ok(first.awards.slice(25).every(a => a.amountWei === 0n));
  assert.ok(p.rounds[0].families[0].categories.every(c => c.awards.slice(10).every(a => a.amountWei === 0n)));
  assert.equal(p.state, "unapproved_allocation_preview"); assert.ok(!("reviewSeconds" in p));
  assert.throws(() => decodePublishedRewardSnapshotV2(f.source));
});
test("four completed rounds cannot consume fifth or league pots", () => {
  const p = preview(createRewardAllocationRehearsalV3("four_rounds")); conserved(p);
  assert.equal(p.proposedWei, 40000n * mon); assert.equal(p.retainedWei, 60000n * mon);
  assert.equal(p.league.hold, "league_not_final"); assert.equal(p.league.participation.totalMetres, 0n);
  assert.equal(p.league.participation.awards.length, 0);
});
test("distance pool includes every completed metre, excludes DNF, and never requires a wallet", () => {
  const f = createRewardAllocationRehearsalV3(), p = preview(f), d = p.league.participation; conserved(p);
  assert.equal(d.proposedWei, 15000n * mon); assert.equal(d.awards.length, 210);
  assert.equal(d.totalMetres, 6705000n);
  const first = d.awards.find(a => a.beneficiaryId === f.source.rounds[0].results[0].athleteId);
  const dnf = d.awards.find(a => a.beneficiaryId === f.source.rounds[1].results[29].athleteId);
  assert.equal(first.metres, 25000n); assert.equal(dnf.metres, 20000n); assert.equal(dnf.finishes, 4);
  assert.equal(first.resultIds.length, 5);
});
test("one unknown distance retains the entire participation denominator without blocking ranks", () => {
  const p = preview(createRewardAllocationRehearsalV3("distance_hold")); conserved(p);
  assert.equal(p.league.participation.hold, "missing_distance"); assert.equal(p.league.participation.retainedWei, 15000n * mon);
  assert.equal(p.league.participation.awards.length, 0); assert.equal(family(p).proposedWei, 25000n * mon);
});
test("duplicate athlete-round, unknown status, incomplete sources and holds prevent league release", () => {
  for (const mutate of [s => s.rounds[4].results[1].athleteId = s.rounds[4].results[0].athleteId,
    s => s.rounds[4].results[0].status = "unknown", s => s.rounds[4].resultsComplete = false,
    s => s.rounds[4].expectedResultCount++, s => s.rounds[4].evidence.held = true, s => s.rounds[4].evidence = null]) {
    const f = createRewardAllocationRehearsalV3(); mutate(f.source); const p = preview(f); conserved(p);
    assert.equal(p.league.retainedWei, 50000n * mon); assert.equal(p.rounds[4].retainedWei, 10000n * mon);
    assert.equal(p.rounds[0].proposedWei, 10000n * mon);
  }
});
test("changed final source digest or publication ordering holds stale league and table previews", () => {
  for (const mutate of [s => s.rounds[0].evidence.digest = "f".repeat(64), s => s.league.roundDigests.reverse(),
    s => s.league.evidence.publishedAt = "2026-09-09T23:00:00.000Z", s => s.league.evidence.held = true]) {
    const f = createRewardAllocationRehearsalV3(); mutate(f.source); const p = preview(f); conserved(p); assert.equal(p.league.proposedWei, 0n);
  }
  const f = createRewardAllocationRehearsalV3(); f.source.standings.find(t => t.slot === 1).roundDigests = [];
  assert.equal(preview(f).rounds[0].families.find(f => f.key === "athlete_standings").categories[0].hold, "source_changed");
});
test("official competition ties consume occupied rank slots across top-25 cutoff, independent of input ordering", () => {
  const f = createRewardAllocationRehearsalV3(), table = f.source.standings.find(t => t.slot === null);
  for (const row of table.rows.slice(23, 27)) row.rank = 24;
  const p = preview(f), cat = family(p).categories[0]; conserved(p);
  assert.equal(cat.hold, null); assert.equal(cat.awards.filter(a => a.rank === 24).length, 4);
  assert.equal(cat.awards.filter(a => a.rank === 24).reduce((n, a) => n + a.amountWei, 0n), cat.slots[23].amountWei + cat.slots[24].amountWei);
  const reversed = structuredClone(f); reversed.source.standings.reverse(); reversed.source.standings.forEach(t => t.rows.reverse());
  reversed.source.rounds.forEach(r => r.results.reverse()); assert.deepEqual(preview(reversed), p);
});
test("gaps, dense ties, partial tables and removed finishers cannot promote remaining athletes", () => {
  for (const mutate of [t => t.rows.shift(), t => { t.rows[1].rank = 1; t.rows[2].rank = 2; }, t => t.complete = false, t => t.evidence.held = true]) {
    const f = createRewardAllocationRehearsalV3(); mutate(f.source.standings.find(t => t.slot === null));
    const p = preview(f); conserved(p); assert.ok(family(p).categories[0].hold); assert.equal(family(p).categories[0].proposedWei, 0n);
  }
  const f = createRewardAllocationRehearsalV3(); f.source.standings.find(t => t.slot === 1).rows.pop();
  assert.equal(preview(f).rounds[0].families.find(f => f.key === "athlete_standings").categories[0].hold, "invalid_standings");
});
test("unassigned category shares and missing prize positions remain reserved", () => {
  const f = createRewardAllocationRehearsalV3(); f.mapping.leagueCategories[0].shareBps = 0;
  const t = f.source.standings.find(t => t.slot === null && t.categoryId === f.source.categories[1].id); t.rows = t.rows.slice(0, 3);
  const p = preview(f); conserved(p); assert.ok(family(p).unassignedWei > 0n); assert.ok(family(p).categories[1].retainedWei > 0n);
  assert.equal(family(p).categories[0].proposedWei, 0n);
});
test("unknown classification holds athlete ranks but not distance-only awards", () => {
  const f = createRewardAllocationRehearsalV3(); f.source.rounds[0].results[0].categoryId = null;
  const p = preview(f); conserved(p); assert.equal(family(p).retainedWei, 25000n * mon);
  assert.equal(p.league.participation.proposedWei, 15000n * mon);
});
test("strict minimized transport rejects secrets, personal fields, malformed dates and foreign scope", () => {
  for (const mutate of [s => s.privateKey = "secret", s => s.rounds[0].results[0].walletAddress = "private",
    s => s.rounds[0].results[0].dateOfBirth = "private", s => s.capturedAt = "2026-02-30T00:00:00.000Z",
    s => s.rounds[0].evidence.publishedAt = "2027-01-01T00:00:00.000Z", s => s.rounds[0].evidence.kind = "native_final",
    s => s.kind = "minimized_source", s => s.rounds[0].slot = 5, s => s.rounds.pop(),
    s => s.rounds[0].results[0].distanceMetres = "5.5", s => s.rounds[0].results[0].status = "FINISHED",
    s => s.rounds[0].results[1].id = s.rounds[0].results[0].id,
    s => s.standings[0].rows[0].rank = 0, s => s.standings.push(s.standings[0])]) {
    const f = createRewardAllocationRehearsalV3(); mutate(f.source); assert.throws(() => decodeRewardAllocationSourceV3(f.source));
  }
  const f = createRewardAllocationRehearsalV3(); f.mapping.rounds[0].roundId = f.source.rounds[1].roundId; assert.throws(() => preview(f));
});
test("small wei budgets conserve through all nested splits and never create negative reserves", () => {
  for (const n of [1, 7, 11, 63, 101, 7919]) {
    const f = createRewardAllocationRehearsalV3(); f.rules.budgetMon = `0.${String(n).padStart(18, "0")}`;
    const p = preview(f); conserved(p); assert.equal(p.budgetWei, BigInt(n)); assert.ok(p.retainedWei >= 0n);
  }
});
test("athlete and club category overlaps are held without reducing independent participation awards", () => {
  for (const target of ["individual", "club"]) {
    const f = createRewardAllocationRehearsalV3(), first = f.source.categories.find(c => c.target === target);
    const extra = { ...first, id: "89000000-0000-4000-8000-000000000999" }; f.source.categories.push(extra);
    const share = f.mapping.leagueCategories.find(s => s.categoryId === first.id); share.shareBps = Math.floor(share.shareBps / 2);
    f.mapping.leagueCategories.push({ categoryId: extra.id, shareBps: share.shareBps });
    const duplicate = structuredClone(f.source.standings.find(t => t.slot === null && t.categoryId === first.id)); duplicate.categoryId = extra.id;
    f.source.standings.push(duplicate); const p = preview(f); conserved(p);
    const affected = family(p, target === "club" ? "club_standings" : "athlete_standings").categories.filter(c => c.categoryId === first.id || c.categoryId === extra.id);
    assert.ok(affected.every(c => c.hold === "category_overlap" && c.proposedWei === 0n));
    assert.equal(p.league.participation.proposedWei, 15000n * mon);
  }
});
test("empty official categories and zero completed metres keep their budgets reserved", () => {
  const f = createRewardAllocationRehearsalV3();
  for (const r of f.source.rounds) r.results.forEach(row => row.status = "dnf");
  f.source.standings.forEach(t => t.rows = []);
  const before = structuredClone(f), p = preview(f); conserved(p); assert.deepEqual(f, before);
  assert.equal(p.proposedWei, 0n); assert.equal(p.retainedWei, 100000n * mon);
  assert.equal(p.league.participation.totalMetres, 0n); assert.equal(p.league.participation.awards.length, 0);
});
