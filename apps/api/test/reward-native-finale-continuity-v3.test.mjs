import assert from "node:assert/strict";
import test from "node:test";
import { previewNativeFinaleContinuityV3 as preview } from "../dist/features/rewards/native-finale-continuity-service.js";
import { decodeNativeFinaleContinuityV3, inspectNativeFinaleContinuityV3 } from "../../../packages/domain/dist/rewards/native-finale-continuity-v3.js";
import { previewRewardAllocationV3 } from "../../../packages/domain/dist/rewards/allocation-preview-v3.js";
import { nativeContinuityFixture } from "./fixtures/native-finale-continuity-v3.mjs";
import { nativeId as n } from "./fixtures/native-finale-v3.mjs";
import { id as h } from "./fixtures/published-reward-v2.mjs";
import { createPrivyTestnetPilotV3, privyPilotIdV3 as p } from "../../../packages/domain/dist/rewards/privy-testnet-pilot-v3.js";
import { decodeNativeContinuityFactsV3 } from "../../../packages/db/dist/rewards/native-continuity-v3.js";
import { decodePublishedRewardSnapshotV2 } from "../../../packages/domain/dist/rewards/published-preview-v2.js";
const mon = 10n ** 18n;
function syntheticContinuityFixture() {
  const f = nativeContinuityFixture(), pilot = createPrivyTestnetPilotV3("2026-09-10T03:00:00.000Z");
  f.snapshot = pilot.snapshot;
  Object.assign(f.record, { draftId: pilot.draftId, chainId: 10143, rules: pilot.rules });
  Object.assign(f.workspace, { draftId: pilot.draftId, catalogue: structuredClone(pilot.snapshot.catalogue), mapping: pilot.mapping });
  f.native.document.draftId = pilot.draftId; f.native.document.chainId = 10143;
  return f;
}
test("synthetic ten-athlete history reaches finale review without becoming a real V2 export", () => {
  const f = syntheticContinuityFixture(), value = preview(f);
  assert.equal(value.source.rounds[0].evidence.kind, "synthetic");
  assert.equal(value.source.rounds.slice(0, 4).flatMap(r => r.results).length, 40);
  assert.equal(value.preview.rounds[4].proposedWei, 0n);
  assert.equal(value.preview.league.proposedWei, 0n);
  assert.equal(value.preview.budgetWei, 100n * mon);
  assert.throws(() => decodePublishedRewardSnapshotV2(f.snapshot), /invalid_v2_published_snapshot/);
  const facts = decodeNativeContinuityFactsV3({ historical: { record: f.record, workspace: f.workspace,
    snapshot: f.snapshot, sourceHash: "a".repeat(64), contextHash: f.historicalContextHash,
    decisions: f.historicalDecisions, observedAt: f.native.observedAt, recordedDecision: null },
    native: f.native, guardHash: "b".repeat(64), labels: { athletes: [], clubs: [] }, review: null, recordedReview: null },
    { chainId: 10143, draftId: f.record.draftId, requestId: null });
  assert.equal(facts.snapshot.version, 3);
});
test("synthetic finale reader rejects altered namespace and unlabelled synthetic sources", () => {
  for (const change of [f => f.snapshot.results[0].athleteId = n(202),
    f => f.snapshot.sourceOrigin = "https://www.raceson.com",
    f => f.snapshot.catalogue.categories[0].eligibility = {}]) {
    const f = syntheticContinuityFixture(); change(f); assert.throws(() => preview(f), /invalid_/);
  }
});
test("synthetic native-workflow finale keeps synthetic evidence and requires explicit continuity", () => {
  const f = syntheticContinuityFixture(), d = f.native.document, template = structuredClone(d.races[0]);
  d.binding = { id: p(800001), editionId: p(54), races: [0, 1].map(i => ({ competitionId: p(60 + i), raceId: p(55 + i) })) };
  d.edition.id = p(54);
  const classifications = [];
  d.races = d.binding.races.map((binding, i) => {
    const r = structuredClone(template), historical = f.snapshot.catalogue.rounds[3].races[i];
    const publicationId = p(910001 + i), runId = p(920001 + i);
    Object.assign(r, binding, { distanceMetres: historical.distanceMetres });
    Object.assign(r.review, { categoryId: r.raceId, policyId: p(930001 + i), startedByPublicationId: publicationId,
      latestPublicationId: publicationId, finalPublicationId: publicationId });
    Object.assign(r.publication, { id: publicationId, raceId: r.raceId, runId });
    Object.assign(r.run, { id: runId, raceId: r.raceId });
    r.rows = f.snapshot.results.filter(row => row.raceId === historical.id).map((row, j) => {
      const id = p(900001 + i * 100 + j);
      classifications.push({ resultId: id, categoryId: row.classificationIds[0] });
      return { ...template.rows[0], id, raceId: r.raceId, runId, athleteId: row.athleteId, clubId: row.clubId,
        participationStatus: row.participationStatus, finishTimeMs: row.finishTimeMs === null ? null : String(row.finishTimeMs),
        rankOverall: row.rankOverall };
    });
    r.expectedResultCount = r.rows.length; return r;
  });
  f.workspace.mapping.rounds[4].roundId = d.binding.id;
  f.workspace.catalogue.rounds.push({ id: d.binding.id, editionId: d.edition.id, slot: 5,
    name: "Synthetic finale rehearsal", date: "2026-09-10", status: "completed", races: d.races.map(r => ({
      id: r.raceId, competitionId: r.competitionId, name: "Synthetic race", distanceMetres: r.distanceMetres,
      publicationId: r.publication.id, publicationState: "official", resultCount: r.rows.length })) });
  const rows = d.races.flatMap(r => r.rows);
  f.selection = { schema: "raceson-native-finale-continuity-v3", classifications,
    athletes: [...new Set(rows.map(r => r.athleteId))].map(id => ({ nativeAthleteId: id, target: { kind: "historical", beneficiaryId: id } })),
    clubs: [...new Set(rows.map(r => r.clubId))].map(id => ({ nativeClubId: id, target: { kind: "historical", beneficiaryId: id } })) };
  const before = preview(f);
  assert.equal(before.preview.rounds[4].proposedWei, 0n);
  const value = preview(confirmed(f));
  assert.equal(value.reviewState, "confirmed_selection");
  assert.equal(value.source.kind, "synthetic_rehearsal");
  assert.equal(value.source.rounds[4].evidence.kind, "synthetic");
  assert.equal(value.source.rounds[4].results.length, 10);
  assert.ok(value.preview.rounds[4].proposedWei > 0n);
  assert.deepEqual(value.source.rounds.slice(0, 4), before.source.rounds.slice(0, 4));
  assert.equal(value.preview.league.proposedWei, 0n);
});
function confirmed(f = nativeContinuityFixture()) {
  f.review = { id: n(500), contextHash: preview({ ...f, review: null }).contextHash, decision: "confirmed",
    reviewedAt: "2026-09-10T04:45:00.000Z", selection: structuredClone(f.selection) };
  return f;
}
function conserved(p) {
  assert.equal(p.budgetWei, 100000n * mon); assert.equal(p.proposedWei + p.retainedWei, p.budgetWei); assert.equal(p.payableWei, 0n);
  for (const pot of [...p.rounds, p.league]) {
    assert.equal(pot.proposedWei + pot.retainedWei, pot.budgetWei);
    for (const family of pot.families) {
      assert.equal(family.proposedWei + family.retainedWei, family.budgetWei);
      assert.equal(family.categories.reduce((v, c) => v + c.budgetWei, family.unassignedWei), family.budgetWei);
      for (const category of family.categories) assert.equal(category.awards.reduce((v, a) => v + a.amountWei, category.retainedWei), category.budgetWei);
    }
  }
}
test("native finale joins four historical rounds via explicit sporting identities and seven categories", () => {
  const f = confirmed(), before = structuredClone(f), v = preview(f); conserved(v.preview);
  assert.deepEqual(f, before); assert.equal(v.reviewState, "confirmed_selection");
  assert.equal(v.source.categories.filter(c => c.target === "individual").length, 7);
  const finale = v.source.rounds[4]; assert.equal(finale.results.length, 6); assert.equal(finale.resultsComplete, true);
  assert.equal(finale.results[0].athleteId, h(10)); assert.equal(finale.results[2].athleteId, n(202));
  assert.equal(finale.results[0].clubId, h(20)); assert.equal(finale.results[2].clubId, n(90));
  assert.equal(finale.evidence.kind, "native_final"); assert.equal(finale.evidence.digest, v.commitment);
  assert.equal(v.preview.rounds[4].budgetWei, 10000n * mon); assert.ok(v.preview.rounds[4].proposedWei > 0n);
  assert.equal(v.preview.league.retainedWei, 50000n * mon); assert.equal(v.source.league, null);
  assert.equal(v.preview.league.participation.totalMetres, 0n); assert.equal(v.payableWei, "0"); assert.equal(v.allocationApproved, false);
  const noReview = preview({ ...f, review: null });
  assert.deepEqual(v.source.rounds.slice(0, 4), noReview.source.rounds.slice(0, 4));
  assert.deepEqual(v.preview.rounds.slice(0, 4), noReview.preview.rounds.slice(0, 4));
  assert.doesNotMatch(JSON.stringify(v.source), /athleteName|clubName|wallet|dateOfBirth|privateKey|Synthetic/);
});
test("missing, held, stale and partial continuity retain the full finale without changing earlier pots", () => {
  for (const mutate of [f => f.review = null, f => f.review.decision = "held", f => f.review.contextHash = "f".repeat(64),
    f => f.review.selection.athletes.pop(), f => f.review.selection.clubs.pop(), f => f.review.selection.classifications.shift()]) {
    const f = confirmed(), earlier = preview(f).preview.rounds.slice(0, 4); mutate(f); const v = preview(f); conserved(v.preview);
    assert.equal(v.preview.rounds[4].retainedWei, 10000n * mon); assert.deepEqual(v.preview.rounds.slice(0, 4), earlier);
    assert.equal(v.preview.league.retainedWei, 50000n * mon);
  }
});
test("a changed native result, complaint, draft rule or source map cannot reuse continuity approval", () => {
  for (const mutate of [f => f.native.document.races[0].rows[0].finishTimeMs = "1800001",
    f => { const r = f.native.document.races[0].review; r.state = "held"; r.held = true; r.finalPublicationId = null; r.officialPublishedAt = null; },
    f => f.record.rules.raceRankWeights[0] += 1, f => f.workspace.mapping.rounds[4].categories[0].shareBps = 100,
    f => f.snapshot.results[0].athleteName = "Changed source label"]) {
    const f = confirmed(); mutate(f);
    const v = preview(f); assert.equal(v.reviewState, "stale"); assert.equal(v.preview.rounds[4].proposedWei, 0n); assert.equal(v.commitment, null);
  }
});
test("unchanged refresh is stable; changing a reviewed identity or classification changes the round commitment", () => {
  const f = confirmed(), v = preview(f); f.native.observedAt = "2026-09-10T06:00:00.000Z";
  assert.equal(preview(f).contextHash, v.contextHash); assert.equal(preview(f).commitment, v.commitment);
  f.review.selection.athletes[0].target.beneficiaryId = h(12);
  const changed = preview(f); assert.notEqual(changed.commitment, v.commitment); assert.equal(changed.source.rounds[4].results[0].athleteId, h(12));
  f.review.selection.classifications[0].categoryId = h(1002); assert.notEqual(preview(f).commitment, changed.commitment);
});
test("foreign targets, arbitrary new IDs, unknown rows and cross-competition/category assignments are rejected", () => {
  for (const mutate of [s => s.athletes[0].target.beneficiaryId = n(999), s => s.athletes[2].target.beneficiaryId = n(999),
    s => s.athletes[0].nativeAthleteId = n(999), s => s.clubs[0].target.beneficiaryId = n(999),
    s => s.clubs[1].target.beneficiaryId = n(999), s => s.classifications[0].resultId = n(999),
    s => s.classifications[0].categoryId = h(1007), s => s.classifications[0].categoryId = h(3),
    s => s.athletes[1].target.beneficiaryId = s.athletes[0].target.beneficiaryId]) {
    const f = confirmed(); mutate(f.review.selection); assert.throws(() => preview(f), /invalid_reward_/);
  }
});
test("equal imported/native UUID is not an implicit identity match or permitted newcomer collision", () => {
  const f = nativeContinuityFixture(), row = f.native.document.races[0].rows[0]; row.athleteId = h(10);
  f.selection.athletes[0] = { nativeAthleteId: h(10), target: { kind: "new_native", beneficiaryId: h(10) } };
  assert.throws(() => inspectNativeFinaleContinuityV3(f.snapshot, f.native, f.selection));
  f.selection.athletes[0].target.kind = "historical";
  assert.equal(inspectNativeFinaleContinuityV3(f.snapshot, f.native, f.selection).state, "complete_selection");
});
test("dense/gapped overall ranks cannot be repaired by repartitioning into reward classifications", () => {
  for (const ranks of [[1, 1, 2], [2, 3, 4], [1, 3, 4]]) {
    const f = nativeContinuityFixture(); f.native.document.races[0].rows.slice(0, 3).forEach((r, i) => r.rankOverall = ranks[i]);
    const v = preview(confirmed(f)); assert.ok(v.inspection.holds.includes("invalid_overall_ranks")); assert.equal(v.preview.rounds[4].proposedWei, 0n);
  }
  const f = nativeContinuityFixture(); f.native.document.races[0].rows[1].rankOverall = 1;
  const v = preview(confirmed(f)), cat = v.preview.rounds[4].families[0].categories.find(c => c.categoryId === h(2));
  assert.equal(cat.awards[0].rank, 1); assert.equal(cat.awards[1].rank, 1); assert.equal(cat.awards[2].rank, 3);
  assert.equal(cat.awards[0].amountWei + cat.awards[1].amountWei, cat.slots[0].amountWei + cat.slots[1].amountWei);
});
test("DNF/DNS/DSQ preserve source rows and do not become ranked finishers or add completed distance", () => {
  for (const status of ["dnf", "dns", "dsq"]) {
    const f = nativeContinuityFixture(); f.native.document.races[0].rows[3].participationStatus = status;
    const v = preview(confirmed(f)); assert.equal(v.source.rounds[4].results[3].status, status);
    assert.equal(v.source.rounds[4].results.filter(r => r.status === "finished").length, 5);
    assert.ok(v.source.standings.filter(t => t.slot === 5).every(t => t.rows.every(r => r.beneficiaryId !== n(203))));
  }
});
test("native duplicate result identities, unknown statuses and fractional distance keep the source held", () => {
  for (const mutate of [f => f.native.document.races[0].rows[1].athleteId = n(200),
    f => f.native.document.races[0].rows[0].participationStatus = "unknown",
    f => f.native.document.races[0].distanceMetres = "5000.5"]) {
    const f = nativeContinuityFixture(); mutate(f);
    if (f.native.document.races[0].rows[1].athleteId === n(200)) f.selection.athletes.splice(1, 1);
    const v = preview(confirmed(f)); assert.ok(v.inspection.holds.includes("source_not_final")); assert.equal(v.preview.rounds[4].proposedWei, 0n);
  }
});
test("native club ranks are not guessed by summing points; final league ranks cannot be inferred from race closure", () => {
  const f = confirmed(), v = preview(f); const clubs = v.preview.rounds[4].families.find(f => f.key === "club_standings");
  assert.equal(clubs.retainedWei, 2000n * mon); assert.equal(clubs.categories[0].hold, "standings_missing");
  assert.equal(v.source.standings.filter(t => t.slot === 5 && t.categoryId === h(3)).length, 0);
  assert.equal(v.preview.league.hold, "league_not_final"); assert.equal(v.preview.league.participation.awards.length, 0);
});
test("source mapping, Auth-scope context and cross-source result collisions fail closed", () => {
  for (const mutate of [f => f.native.document.draftId = n(999), f => f.native.document.organizationId = n(999),
    f => f.native.document.chainId = 10143, f => f.native.document.recordRevision = 2,
    f => f.workspace.draftId = n(999), f => f.workspace.catalogue.rounds[4].editionId = n(999),
    f => f.workspace.catalogue.rounds[4].races[0].id = n(999),
    f => f.native.document.races[0].rows[0].id = f.snapshot.results[0].id]) {
    const f = confirmed(); mutate(f); assert.throws(() => preview(f));
  }
});
test("strict choices and review reject private extras, accessor properties and invented review dates", () => {
  for (const mutate of [s => s.wallet = "private", s => s.athletes[0].target.userId = n(900),
    s => s.classifications[0].dateOfBirth = "private", s => s.athletes.push(s.athletes[0]),
    s => delete s.athletes[0], s => s.athletes.extra = "private",
    s => Object.defineProperty(s.athletes, "0", { enumerable: true, get() { throw Error("must not run accessor"); } }),
    s => Object.defineProperty(s, "athletes", { enumerable: true, get() { throw Error("must not run accessor"); } })]) {
    const f = nativeContinuityFixture(); mutate(f.selection); assert.throws(() => decodeNativeFinaleContinuityV3(f.selection), /invalid_reward_/);
  }
  for (const patch of [{ reviewedAt: "2026-02-30T00:00:00.000Z" }, { reviewedAt: "2026-09-11T00:00:00.000Z" },
    { reviewedAt: "2026-09-10T03:59:59.999Z" }, { privateKey: "private" }]) {
    const f = confirmed(); Object.assign(f.review, patch); assert.throws(() => preview(f));
  }
});
test("reordered choices canonicalize identically without changing award arithmetic", () => {
  const f = confirmed(), first = preview(f);
  f.review.selection.athletes.reverse(); f.review.selection.clubs.reverse(); f.review.selection.classifications.reverse();
  const second = preview(f); assert.equal(second.commitment, first.commitment); assert.deepEqual(second.preview, first.preview);
  assert.deepEqual(previewRewardAllocationV3(f.record.rules, f.workspace.mapping, second.source), second.preview);
});
test("new U16 source beneficiaries keep top-10 shares, including a tie across the cutoff, without payment readiness", () => {
  const f = nativeContinuityFixture(), first = f.native.document.races[0], oldRows = first.rows, template = first.rows[0];
  first.rows = Array.from({ length: 32 }, (_, i) => ({ ...template, id: n(1000 + i), athleteId: n(2000 + i),
    finishTimeMs: String(1800000 + i), rankOverall: i === 10 ? 10 : i + 1 }));
  first.expectedResultCount = 32; f.workspace.catalogue.rounds[4].races[0].resultCount = 32;
  f.selection.athletes = f.selection.athletes.filter(a => !oldRows.some(r => r.athleteId === a.nativeAthleteId));
  f.selection.athletes.push(...first.rows.map(r => ({ nativeAthleteId: r.athleteId, target: { kind: "new_native", beneficiaryId: r.athleteId } })));
  f.selection.classifications = f.selection.classifications.filter(c => !oldRows.some(r => r.id === c.resultId));
  f.selection.classifications.push(...first.rows.map(r => ({ resultId: r.id, categoryId: h(1003) })));
  f.selection.clubs = f.selection.clubs.filter(c => c.nativeClubId === n(12));
  const v = preview(confirmed(f)), category = v.preview.rounds[4].families[0].categories.find(c => c.categoryId === h(1003));
  conserved(v.preview); assert.equal(category.hold, null); assert.equal(category.awards.length, 32);
  assert.ok(category.awards[0].amountWei > 0n); assert.equal(category.awards.filter(a => a.rank === 10).length, 2);
  assert.equal(category.awards.filter(a => a.rank === 10).reduce((n, a) => n + a.amountWei, 0n), category.slots[9].amountWei);
  assert.ok(category.awards.filter(a => a.rank > 10).every(a => a.amountWei === 0n));
  assert.equal(v.allocationApproved, false); assert.equal(v.payableWei, "0");
});
test("absence of a selected fifth-round mapping keeps source and awards absent even with complete choices", () => {
  const f = nativeContinuityFixture(); f.workspace.mapping.rounds[4].roundId = null;
  const v = preview(confirmed(f)); conserved(v.preview); assert.equal(v.source.rounds[4].evidence, null);
  assert.equal(v.source.rounds[4].roundId, null); assert.equal(v.preview.rounds[4].proposedWei, 0n);
});
