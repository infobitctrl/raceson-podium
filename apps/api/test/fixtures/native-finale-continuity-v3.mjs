import { nativeFinaleFixture, nativeId as n } from "./native-finale-v3.mjs";
import { publishedSnapshot, publishedMapping, id as h } from "./published-reward-v2.mjs";
import { createDefaultRewardProgrammeDraftV2 } from "../../../../packages/domain/dist/rewards/programme-draft-v2.js";

// Entirely synthetic: seven individual categories, two native races, returning
// and new participants, a DNF, a tie and represented historical/new clubs.
export function nativeContinuityFixture() {
  const snapshot = publishedSnapshot(), native = nativeFinaleFixture(), longCompetition = h(1006);
  snapshot.catalogue.categories.splice(1, 0,
    ...["Male", "Female U16", "Male U16", "Senior"].map((name, i) => ({ ...snapshot.catalogue.categories[0], id: h(1002 + i), name })),
    ...["Female", "Male"].map((name, i) => ({ ...snapshot.catalogue.categories[0], id: h(1007 + i), competitionId: longCompetition,
      competitionName: "Synthetic long", name })));
  for (const [i, round] of snapshot.catalogue.rounds.entries()) {
    round.races.push({ id: h(1800 + i), competitionId: longCompetition, name: "Synthetic long", distanceMetres: "12000",
      publicationId: h(1900 + i), publicationState: "official", resultCount: 2 });
    snapshot.results.push(...[0, 1].map(j => ({ id: h(2000 + 10 * i + j), publicationId: h(1900 + i), publicationState: "official",
      publishedAt: "2026-09-01T12:00:00Z", runId: h(2100 + i), athleteId: h(13 + j), athleteName: `Synthetic long athlete ${j}`,
      raceId: h(1800 + i), classificationIds: [h(1007 + j)], participationStatus: "finished", finishTimeMs: 3600000 + j,
      rankOverall: j + 1, clubId: h(20 + j), clubName: `Synthetic club ${j}` })));
  }
  snapshot.results.forEach((r, i) => { r.clubId = h(20 + i % 2); r.clubName = `Synthetic club ${i % 2}`; });
  native.document.binding.races[0].competitionId = h(1);
  const first = native.document.races[0]; first.competitionId = h(1);
  const template = structuredClone(first.rows[0]);
  first.rows = [0, 1, 2, 3].map(i => ({ ...template, id: n(100 + i), athleteId: n(200 + i),
    participationStatus: i === 3 ? "dnf" : "finished", finishTimeMs: i === 3 ? null : String(1800000 + i),
    rankOverall: i === 3 ? null : i + 1, clubId: i < 2 ? n(12) : n(90) }));
  first.expectedResultCount = first.rows.length;
  const long = structuredClone(first); long.raceId = n(60); long.competitionId = longCompetition; long.distanceMetres = "12000";
  long.review.categoryId = n(60); long.review.policyId = n(61);
  for (const k of ["startedByPublicationId", "latestPublicationId", "finalPublicationId"]) long.review[k] = n(62);
  Object.assign(long.publication, { id: n(62), raceId: n(60), runId: n(63) });
  Object.assign(long.run, { id: n(63), raceId: n(60) });
  long.rows = [0, 1].map(i => ({ ...template, id: n(110 + i), raceId: n(60), runId: n(63), athleteId: n(210 + i),
    finishTimeMs: "3600000", rankOverall: 1, clubId: n(12) }));
  long.expectedResultCount = long.rows.length;
  native.document.races.push(long); native.document.binding.races.push({ competitionId: longCompetition, raceId: long.raceId });
  const record = { draftId: native.document.draftId, organizationId: native.document.organizationId, seasonId: n(80), chainId: 31337,
    organizationName: "Synthetic demo", seasonName: "Synthetic five rounds", revision: 1, updatedAt: "2026-09-10T03:00:00.000Z",
    rules: createDefaultRewardProgrammeDraftV2() };
  const mapping = publishedMapping(), shares = snapshot.catalogue.categories.map((c, i) => ({ categoryId: c.id,
    shareBps: c.target === "club" ? 10000 : i < 6 ? 1430 : 1420 }));
  mapping.rounds.forEach(r => r.categories = structuredClone(shares)); mapping.rounds[4].roundId = native.document.binding.id;
  mapping.leagueCategories = structuredClone(shares);
  const catalogue = structuredClone(snapshot.catalogue);
  catalogue.rounds.push({ id: native.document.binding.id, editionId: native.document.binding.editionId, slot: 5,
    name: "Synthetic finale (not real event results)", date: "2026-09-10", status: "completed",
    races: native.document.races.map(r => ({ id: r.raceId, competitionId: r.competitionId, name: "Synthetic native race",
      distanceMetres: r.distanceMetres, publicationId: r.publication.id, publicationState: r.publication.state, resultCount: r.rows.length })) });
  const historicalContextHash = "a".repeat(64);
  const selection = { schema: "raceson-native-finale-continuity-v3",
    athletes: [
      { nativeAthleteId: n(200), target: { kind: "historical", beneficiaryId: h(10) } },
      { nativeAthleteId: n(201), target: { kind: "historical", beneficiaryId: h(11) } },
      { nativeAthleteId: n(202), target: { kind: "new_native", beneficiaryId: n(202) } },
      { nativeAthleteId: n(203), target: { kind: "new_native", beneficiaryId: n(203) } },
      { nativeAthleteId: n(210), target: { kind: "historical", beneficiaryId: h(13) } },
      { nativeAthleteId: n(211), target: { kind: "new_native", beneficiaryId: n(211) } }
    ], clubs: [{ nativeClubId: n(12), target: { kind: "historical", beneficiaryId: h(20) } },
      { nativeClubId: n(90), target: { kind: "new_native", beneficiaryId: n(90) } }],
    classifications: first.rows.map(r => ({ resultId: r.id, categoryId: h(2) })).concat(long.rows.map((r, i) => ({ resultId: r.id, categoryId: h(1007 + i) }))) };
  return { record, workspace: { draftId: record.draftId, revision: 1, rulesRevision: 1, catalogueHash: "b".repeat(64),
    boundCatalogueHash: "b".repeat(64), catalogue, mapping }, snapshot, native, historicalContextHash,
    historicalDecisions: [1, 2, 3, 4].map(slot => ({ id: h(900 + slot), slot, contextHash: historicalContextHash,
      decision: "confirmed_final", reviewedAt: "2026-09-10T04:30:00.000Z", current: true })), review: null, selection };
}
