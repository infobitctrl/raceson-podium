export const id = n => `85000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function publishedSnapshot() {
  const catalogue = { rounds: Array.from({ length: 4 }, (_, i) => ({ id: id(100 + i), editionId: id(200 + i), slot: i + 1, name: `Synthetic round ${i + 1}`, date: "2026-09-01", status: "completed",
    races: [{ id: id(300 + i), competitionId: id(1), name: "Synthetic short", distanceMetres: "5000", publicationId: id(400 + i), publicationState: "official", resultCount: 3 }] })),
    categories: [{ id: id(2), competitionId: id(1), competitionName: "Synthetic short", name: "Female", target: "individual", eligibility: { demoOnly: true } },
      { id: id(3), competitionId: id(4), competitionName: "Synthetic clubs", name: "Clubs", target: "club", eligibility: { demoOnly: true } }] };
  return { version: 2, sourceOrigin: "https://www.raceson.com", sourceLeagueId: id(5), sourceSeasonId: id(6), capturedAt: "2026-09-09T12:00:00Z", catalogue,
    results: catalogue.rounds.flatMap((r, i) => Array.from({ length: 3 }, (_, j) => ({ id: id(500 + i * 10 + j), publicationId: id(400 + i), publicationState: "official", publishedAt: "2026-09-01T12:00:00Z", runId: id(600 + i),
      athleteId: id(10 + j), athleteName: `Synthetic athlete ${j}`, raceId: id(300 + i), classificationIds: [id(2)], participationStatus: "finished", finishTimeMs: 50000 + j, rankOverall: j + 1, clubId: null, clubName: null }))),
    clubs: [0, 1].map(i => ({ clubId: id(20 + i), name: `Synthetic club ${i}`, rounds: catalogue.rounds.map(r => ({ slot: r.slot, sourceRoundId: r.id, points: 100 - i * 20 })) })) };
}
export function publishedMapping() { return { version: 2, rounds: Array.from({ length: 5 }, (_, i) => ({ slot: i + 1, roundId: i < 4 ? id(100 + i) : null,
  categories: [{ categoryId: id(2), shareBps: 10000 }, { categoryId: id(3), shareBps: 10000 }] })), leagueCategories: [{ categoryId: id(2), shareBps: 10000 }] }; }
